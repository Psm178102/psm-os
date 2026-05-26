"""
POST /api/v3/settings/upsert
Body: { key: "rd_crm_token", value: "..." }

Atualiza UM setting. Apenas Sócio (lvl>=10). Audit log NÃO guarda
o valor (só nota de qual key mudou).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from _schema import whitelist, is_secret  # type: ignore


SHARED_KEY = "psm_os_settings"


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
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        key = (body.get("key") or "").strip()
        value = body.get("value")
        if value is None: value = ""
        if not isinstance(value, str):
            value = str(value)

        if not key:
            return self._send(400, {"ok": False, "error": "key obrigatório"})
        if key not in whitelist():
            return self._send(400, {"ok": False, "error": f"key não permitida: {key}"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            cur = sb.table("shared_kv").select("value").eq("key", SHARED_KEY).limit(1).execute().data or []
            stored = (cur[0].get("value") if cur else {}) or {}
            if not isinstance(stored, dict): stored = {}
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"read: {e}"})

        old_has = bool(stored.get(key))
        stored[key] = value

        try:
            payload = {"key": SHARED_KEY, "value": stored, "updated_at": datetime.now(timezone.utc).isoformat()}
            sb.table("shared_kv").upsert(payload, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"upsert: {e}"})

        # Audit (NÃO guarda valor real se secret)
        before_note = "had_value" if old_has else "empty"
        after_note  = "has_value" if value else "cleared"
        audit(self, actor, "setting.update", target_type="setting", target_id=key,
              notes=f"{before_note} -> {after_note}" + (" [SECRET]" if is_secret(key) else ""))

        return self._send(200, {"ok": True, "key": key, "saved": True})
