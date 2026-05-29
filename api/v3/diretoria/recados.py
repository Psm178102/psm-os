"""
GET  /api/v3/diretoria/recados — lista recados ativos (data_fim NULL ou > now)
POST /api/v3/diretoria/recados — upsert (Sócio/Gerente)
                                  body: { id?, texto, audiencia?, prioridade?,
                                          data_fim?, fixado?, _delete? }
Header: Authorization: Bearer <token>
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify  # type: ignore


ALLOWED_PRIORIDADE = {"info", "alerta", "critica"}
# Audiências suportadas. 'equipe:<nome>' mira uma equipe específica.
ALLOWED_AUDIENCIA = {"todos", "corretores", "lideres", "gerencia", "diretoria"}


def _audience_match(aud, user):
    """Recado visível pra este usuário? Regra fail-open: audiência desconhecida
    não esconde (comunicação não deve sumir por engano)."""
    a = (aud or "todos").strip().lower()
    lvl = user.get("lvl") or 0
    if a in ("", "todos", "all"):
        return True
    if a.startswith("equipe:"):
        return (user.get("team") or "").strip().lower() == a.split(":", 1)[1].strip()
    if a == "corretores":
        return lvl <= 2
    if a == "lideres":
        return lvl >= 5
    if a == "gerencia":
        return lvl >= 7
    if a == "diretoria":
        return lvl >= 10
    return True  # desconhecida → não esconde


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            # Recados ativos: data_fim IS NULL OR data_fim > now
            rows = sb.table("recados").select("*") \
                .or_(f"data_fim.is.null,data_fim.gte.{now_iso}") \
                .order("fixado", desc=True) \
                .order("data_inicio", desc=True) \
                .limit(200).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Filtro de audiência: gerência/diretoria (lvl>=7) veem tudo (gestão);
        # os demais só veem recados endereçados a eles.
        if (user.get("lvl") or 0) < 7:
            rows = [r for r in rows if _audience_match(r.get("audiencia"), user)]

        return self._send(200, {
            "ok": True,
            "count": len(rows),
            "recados": rows,
        })

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
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

        rec_id = (body.get("id") or "").strip() or None

        # Delete?
        if body.get("_delete") and rec_id:
            try:
                cur = sb.table("recados").select("*").eq("id", rec_id).limit(1).execute().data or []
                if cur:
                    sb.table("recados").delete().eq("id", rec_id).execute()
                    audit(self, actor, "recado.delete", target_type="recado", target_id=rec_id, before=cur[0])
                return self._send(200, {"ok": True, "deleted": rec_id})
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"delete: {e}"})

        # Update or Create
        prior = (body.get("prioridade") or "info").lower()
        if prior not in ALLOWED_PRIORIDADE:
            return self._send(400, {"ok": False, "error": "prioridade inválida"})

        texto = (body.get("texto") or "").strip()
        if not texto and not rec_id:
            return self._send(400, {"ok": False, "error": "texto obrigatório"})

        if rec_id:
            patch = {}
            for k in ("texto", "audiencia", "prioridade", "data_fim", "fixado"):
                if k in body: patch[k] = body[k]
            try:
                cur = sb.table("recados").select("*").eq("id", rec_id).limit(1).execute().data or []
                if not cur:
                    return self._send(404, {"ok": False, "error": "não encontrado"})
                sb.table("recados").update(patch).eq("id", rec_id).execute()
                audit(self, actor, "recado.update", target_type="recado", target_id=rec_id,
                      before={k: cur[0].get(k) for k in patch.keys()}, after=patch)
                return self._send(200, {"ok": True, "id": rec_id, "updated": True})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        # Create
        new_id = "rc_" + uuid.uuid4().hex[:12]
        aud = (body.get("audiencia") or "todos").strip()
        if aud not in ALLOWED_AUDIENCIA and not aud.lower().startswith("equipe:"):
            aud = "todos"
        row = {
            "id": new_id,
            "texto": texto,
            "autor_id": actor["id"],
            "audiencia": aud,
            "prioridade": prior,
            "data_fim": body.get("data_fim") or None,
            "fixado": bool(body.get("fixado")),
        }
        try:
            res = sb.table("recados").insert(row).execute()
            inserted = (res.data or [row])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"insert: {e}"})

        # Notifica todos os users ativos se recado for crítico ou alerta
        if prior in ("critica", "alerta"):
            try:
                aus = sb.table("users").select("id").eq("status", "ativo").execute().data or []
                uids = [u["id"] for u in aus if u["id"] != actor["id"]]
                ico = "🔴" if prior == "critica" else "⚠️"
                preview = texto[:140] + ("…" if len(texto) > 140 else "")
                notify(uids, tipo="recado.novo",
                       title=f"{ico} {prior.upper()}: {actor.get('name')}",
                       body=preview, link="#/diretoria",
                       target_type="recado", target_id=new_id)
            except Exception as e:
                print(f"[recado] notify err: {e}")

        audit(self, actor, "recado.create", target_type="recado", target_id=new_id, after=row)
        return self._send(200, {"ok": True, "recado": inserted, "created": True})
