"""
POST /api/v3/agenda/upsert
Body: { id?, tipo, titulo, descricao?, data, hora_inicio?, hora_fim?, all_day?,
        corretor_id?, participantes?[], local?, cor?, status? }
Header: Authorization: Bearer <token>

Cria ou atualiza evento. Todos podem criar.
Update: apenas Sócio/Gerente OU criador OU corretor_id do evento.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from _zoho_push import push_evento  # type: ignore


def _push_zoho(sb, ev, antes):
    """Espelha no Zoho na hora. O evento vai pro calendário do DONO (criador ou
    corretor responsável). Best-effort: se o Zoho falhar, o evento já está salvo
    no House e o cron de 2 min reconcilia — o save do usuário nunca quebra."""
    try:
        dono = ev.get("owner_id") or ev.get("corretor_id") or ev.get("criado_por")
        if not dono:
            return {}
        patch = push_evento(sb, ev, dono)
        if patch:
            sb.table("eventos").update({**patch, "owner_id": dono}).eq("id", ev["id"]).execute()
        return patch
    except Exception:
        return {}


ALLOWED_TIPO = {"plantao", "reuniao", "visita", "tarefa", "evento", "outro"}
ALLOWED_STATUS = {"agendado", "confirmado", "cancelado", "realizado"}


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        evento_id = (body.get("id") or "").strip() or None
        is_socio_gerente = (actor.get("lvl") or 0) >= 7

        # Validate
        tipo = (body.get("tipo") or "evento").strip().lower()
        if tipo not in ALLOWED_TIPO:
            return self._send(400, {"ok": False, "error": f"tipo inválido. Use: {sorted(ALLOWED_TIPO)}"})
        status = (body.get("status") or "agendado").strip().lower()
        if status not in ALLOWED_STATUS:
            return self._send(400, {"ok": False, "error": f"status inválido"})
        titulo = (body.get("titulo") or "").strip()
        if not titulo and not evento_id:
            return self._send(400, {"ok": False, "error": "titulo obrigatório"})
        if not body.get("data") and not evento_id:
            return self._send(400, {"ok": False, "error": "data obrigatória (YYYY-MM-DD)"})

        # Update
        if evento_id:
            try:
                cur = sb.table("eventos").select("*").eq("id", evento_id).limit(1).execute().data or []
                if not cur:
                    return self._send(404, {"ok": False, "error": "evento não encontrado"})
                cur = cur[0]
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

            owner = cur.get("criado_por") == actor["id"] or cur.get("corretor_id") == actor["id"]
            if not is_socio_gerente and not owner:
                return self._send(403, {"ok": False, "error": "apenas Sócio/Gerente ou dono pode editar"})

            patch = {}
            for k in ("tipo", "titulo", "descricao", "data", "hora_inicio", "hora_fim",
                      "all_day", "corretor_id", "participantes", "local", "cor", "status"):
                if k in body:
                    patch[k] = body[k]

            try:
                sb.table("eventos").update(patch).eq("id", evento_id).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"update: {e}"})

            audit(self, actor, "evento.update", target_type="evento", target_id=evento_id,
                  before={k: cur.get(k) for k in patch.keys()}, after=patch)

            # espelha no Zoho NA HORA (edição inclusa) — best-effort
            zres = _push_zoho(sb, {**cur, **patch, "id": evento_id}, cur)
            return self._send(200, {"ok": True, "id": evento_id, "updated": True, "zoho": zres})

        # Create
        new_id = "ev_" + uuid.uuid4().hex[:12]
        row = {
            "id": new_id,
            "tipo": tipo,
            "titulo": titulo,
            "descricao": body.get("descricao") or None,
            "data": body["data"],
            "hora_inicio": body.get("hora_inicio") or None,
            "hora_fim": body.get("hora_fim") or None,
            "all_day": bool(body.get("all_day")),
            "corretor_id": body.get("corretor_id") or None,
            "participantes": body.get("participantes") or [],
            "local": body.get("local") or None,
            "cor": body.get("cor") or None,
            "status": status,
            "criado_por": actor["id"],
        }
        try:
            res = sb.table("eventos").insert(row).execute()
            inserted = (res.data or [row])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"insert: {e}"})

        audit(self, actor, "evento.create", target_type="evento", target_id=new_id, after=row)
        zres = _push_zoho(sb, row, None)
        return self._send(200, {"ok": True, "evento": {**inserted, **zres}, "created": True, "zoho": zres})
