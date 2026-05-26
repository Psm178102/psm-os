"""POST /api/v3/backup/drive — backup automático Google Drive (Sócio only)

Sem GOOGLE_DRIVE_TOKEN configurado, retorna 503 com instruções.
Quando token estiver disponível, faz dump completo via /backup/export
e upload pro Drive na pasta "PSM-OS Backups".

Pode ser chamado via Vercel Cron (config em vercel.json).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})

        token = os.environ.get("GOOGLE_DRIVE_TOKEN") or os.environ.get("GOOGLE_DRIVE_REFRESH_TOKEN")
        folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID")

        if not token:
            return self._send(503, {
                "ok": False,
                "error": "GOOGLE_DRIVE_TOKEN não configurado",
                "instructions": [
                    "1. Acesse https://console.cloud.google.com → APIs & Services → Credentials",
                    "2. Crie OAuth 2.0 Client ID (Web app) com redirect Vercel",
                    "3. Habilite Google Drive API",
                    "4. Gere refresh_token via OAuth playground com scope drive.file",
                    "5. Crie pasta 'PSM-OS Backups' no Drive e copie folder_id",
                    "6. Adicione GOOGLE_DRIVE_TOKEN + GOOGLE_DRIVE_FOLDER_ID nas env vars Vercel",
                    "7. Configure Vercel Cron 0 3 * * * → /api/v3/backup/drive (diário 3h)",
                ],
                "framework_ready": True,
                "what_will_happen": "Dump JSON completo → upload Drive folder, audit backup.drive_ok",
            })

        # TODO: implementar quando GOOGLE_DRIVE_TOKEN disponível
        # 1. Chamar /backup/export internamente pra gerar dump
        # 2. POST multipart https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
        #    com Authorization: Bearer {token} e parent=folder_id
        # 3. Audit backup.drive_ok com file_id e size

        audit(self, actor, "backup.drive_pending", target_type="system",
              notes="endpoint chamado, implementação real pendente do token Drive")

        return self._send(501, {
            "ok": False,
            "error": "Implementação Drive pendente",
            "next_step": "Configure GOOGLE_DRIVE_TOKEN e GOOGLE_DRIVE_FOLDER_ID e me avise pra finalizar",
        })
