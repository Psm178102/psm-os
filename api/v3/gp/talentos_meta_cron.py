"""GET /api/v3/gp/talentos_meta_cron — cron (Bearer CRON_SECRET). v89.15

Leads novos das campanhas de VAGAS no Meta → ficha em "Interessados" no kanban de R&S
(ver _talentos_meta_lib). Roda a cada 10 min.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, audit  # type: ignore
import _talentos_meta_lib as TM  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        secret = os.environ.get("CRON_SECRET")
        auth = self.headers.get("Authorization") or ""
        if not secret or auth != f"Bearer {secret}":
            return self._send(401, {"ok": False, "error": "não autorizado"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        r = TM.sincronizar(sb)
        if r.get("criadas"):
            audit(self, None, "gp.talento.meta_lead", target_type="gp_talentos", target_id="*",
                  notes=f"criadas={r['criadas']}")
        return self._send(200, r)
