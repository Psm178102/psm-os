"""
GET /api/v3/crm/captar_cron
Header: Authorization: Bearer <CRON_SECRET>

Cron dedicado (Vercel) que verifica a etapa CAPTAR IMÓVEL do funil CARTEIRA MAP
no RD CRM e cria uma captação "À fazer" no nosso Kanban pra cada lead novo.
Idempotente (dedup por rd_deal_id). Roda a cada 15min → quase tempo real.

Também aceita ?key=<CRON_SECRET> na query pra disparo manual/teste.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, audit  # type: ignore
from _captar_lib import import_captar  # type: ignore


def _verify(headers, path):
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False, "CRON_SECRET ausente no Vercel"
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and auth[7:].strip() == secret:
        return True, ""
    try:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))
        if q.get("key") == secret:
            return True, ""
    except Exception:
        pass
    return False, "não autorizado (CRON_SECRET)"


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        ok, msg = _verify(self.headers, self.path)
        if not ok:
            return self._send(401, {"ok": False, "error": msg})
        token = os.environ.get("RD_API_TOKEN")
        if not token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN ausente"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        t0 = time.time()
        res = import_captar(sb, token)
        res["duration_s"] = round(time.time() - t0, 2)
        res["ran_at"] = datetime.now(timezone.utc).isoformat()
        try:
            if res.get("created"):
                audit(self, None, "captacao.auto_rd", target_type="captacoes", target_id="*",
                      notes=f"criadas={res.get('created')} via cron CARTEIRA MAP")
        except Exception:
            pass
        return self._send(200, res)
