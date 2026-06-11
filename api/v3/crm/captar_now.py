"""GET/POST /api/v3/crm/captar_now — dispara a captura RD→Kanban SOB DEMANDA (lvl≥5).
Varre a etapa CAPTAR IMÓVEL do funil CARTEIRA MAP e cria as captações 'À fazer'
que faltam (idempotente, dedup por rd_deal_id). Não depende de cron nem de
CRON_SECRET — é o botão '🔄 Puxar do RD agora' do Kanban + também é chamado
pelo /crm/sync_if_stale (auto-cura pelo uso). Retorna quantas criou.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from _captar_lib import import_captar  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _run(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        token = os.environ.get("RD_API_TOKEN")
        if not token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN ausente no Vercel"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            res = import_captar(sb, token) or {}
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        try:
            audit(self, actor, "captacao.captar_now", target_type="captacoes", target_id="*",
                  notes=f"created={res.get('created')} na_etapa={res.get('deals_na_etapa')}")
        except Exception:
            pass
        return self._send(200, {"ok": True, **res})

    def do_GET(self):
        self._run()

    def do_POST(self):
        self._run()
