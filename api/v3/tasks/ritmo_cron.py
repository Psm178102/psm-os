"""
GET /api/v3/tasks/ritmo_cron — 🔁 roda o Motor do Ritmo (api/v3/_ritmo_lib.py). v88.97

  ?cron=1  (Bearer CRON_SECRET — heartbeat de hora em hora) → gera a rotina, sincroniza os checks,
           sobe as tarefas vencidas (véspera → gestor → sócios) e avisa reunião sem ata.
           Só a partir das 7h BRT e nunca no domingo (o dedupe é por tarefa/estágio, então rodar
           várias vezes no dia não repete aviso).
  ?dry=1   (sócio, lvl ≥ 10) → mostra o que SERIA gerado/avisado agora, sem gravar nem enviar.
  ?agora=1 (sócio, lvl ≥ 10) → roda de verdade fora do cron (botão "Rodar agora" da tela).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
_V3 = os.path.dirname(_HERE)
if _V3 not in sys.path:
    sys.path.append(_V3)
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
import _ritmo_lib as CAD  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if q.get("cron") == "1":
            secret = os.environ.get("CRON_SECRET") or ""
            if not secret or (self.headers.get("Authorization") or "") != f"Bearer {secret}":
                return self._send(401, {"ok": False, "error": "cron sem CRON_SECRET"})
            agora = datetime.now(timezone.utc) - timedelta(hours=3)
            if agora.hour < 7 or agora.weekday() == 6:
                return self._send(200, {"ok": True, "skip": "fora da janela (7h+, seg–sáb)"})
            try:
                return self._send(200, CAD.rodar(sb, notify_all))
            except Exception as e:
                print(f"[cadencia_cron] {e}")
                return self._send(500, {"ok": False, "error": str(e)})
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        dry = q.get("agora") != "1"
        try:
            r = CAD.rodar(sb, notify_all, dry=dry)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if not dry:
            audit(self, user, "cadencia.rodar_agora", target_type="shared_kv", target_id=CAD.KV_ALERTAS)
        return self._send(200, r)
