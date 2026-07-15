"""
POST /api/v3/agenda/convite — aceitar ou recusar um convite de evento. v84.57
Body: { id, acao: "aceitar" | "recusar" }

Só o PRÓPRIO convidado decide: o endpoint escreve exclusivamente a marca dele
em eventos.aceites — ninguém aceita ou recusa no lugar do outro, nem o sócio.

Aceitar → o evento entra na agenda dele e (se tiver Zoho conectado) no
calendário dele no próximo sync. Recusar → some da agenda e é removido do Zoho
dele na hora, se já tinha ido.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
from _zoho_push import push_evento, delete_evento  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n else "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        eid = (body.get("id") or "").strip()
        acao = (body.get("acao") or "").strip().lower()
        if not eid or acao not in ("aceitar", "recusar"):
            return self._send(400, {"ok": False, "error": "id e acao (aceitar|recusar) obrigatórios"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            cur = sb.table("eventos").select("*").eq("id", eid).limit(1).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if not cur:
            return self._send(404, {"ok": False, "error": "evento não encontrado"})
        ev = cur[0]

        uid = user["id"]
        parts = ev.get("participantes") or []
        if not (isinstance(parts, list) and uid in parts):
            return self._send(403, {"ok": False, "error": "você não foi convidado pra este evento"})

        aceites = dict(ev.get("aceites") or {})
        if acao == "aceitar":
            aceites.pop(uid, None)          # sem marca = aceito
        else:
            aceites[uid] = "recusado"
        try:
            sb.table("eventos").update({"aceites": aceites}).eq("id", eid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"update: {e}"})

        # reflete no Zoho DELE (não no de outra pessoa)
        zoho = None
        try:
            if acao == "aceitar":
                patch = push_evento(sb, {**ev, "aceites": aceites}, uid)
                zoho = bool(patch)
            elif ev.get("zoho_uid") and ev.get("owner_id") == uid:
                zoho = delete_evento(sb, ev, uid)
        except Exception:
            pass

        audit(self, user, f"evento.convite.{acao}", target_type="evento", target_id=eid)
        # avisa quem convidou — senão o dono nunca sabe que recusaram
        try:
            dono = ev.get("criado_por")
            if dono and dono != uid:
                notify_all([dono], tipo="evento.convite",
                           title=("✅ Convite aceito" if acao == "aceitar" else "❌ Convite recusado"),
                           body=f"{user.get('name')} · {ev.get('titulo')}",
                           link="#/", target_type="evento", target_id=eid)
        except Exception:
            pass
        return self._send(200, {"ok": True, "id": eid, "acao": acao, "zoho": zoho})
