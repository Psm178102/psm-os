"""
GET /api/v3/realtime_config — config do Realtime (push <1s) p/ o frontend. v81.29

Devolve a URL do Supabase + a ANON KEY (pública) + o canal de broadcast, lidas de
variáveis de ambiente. Se a SUPABASE_ANON_KEY não estiver setada, retorna
enabled=false e o frontend segue só com o "pulso" (polling) — nada quebra.

⚠️ A anon key é PÚBLICA por design. Antes de ligar isto em produção, o acesso da
role `anon`/`authenticated` às tabelas deve estar TRANCADO (RLS habilitado), pra
que essa chave só sirva pro canal Realtime e NÃO consiga ler dados via PostgREST.

Auth: usuário logado (lvl>=0).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        url = (os.environ.get("SUPABASE_URL") or "").strip()
        anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
        return self._send(200, {
            "ok": True,
            "enabled": bool(url and anon),
            "url": url,
            "anon_key": anon,
            "channel": "psm-os",
        })
