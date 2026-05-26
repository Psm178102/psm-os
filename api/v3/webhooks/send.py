"""POST /api/v3/webhooks/send — dispara webhook configurado (Zapier/Make/n8n)

Body: { title, body?, severity? (info|alert|critical), data? (extra payload) }
Header: Bearer

Lê webhook_url das Configurações (shared_kv 'psm_os_settings').
Útil pra: notificações WhatsApp via Zapier, Slack, custom integrations.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


def _get_webhook_url(sb):
    try:
        row = sb.table("shared_kv").select("value").eq("key", "psm_os_settings").limit(1).execute().data or []
        if not row: return None
        v = row[0].get("value") or {}
        return v.get("webhook_url") if isinstance(v, dict) else None
    except Exception:
        return None


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
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        title = (body.get("title") or "").strip()
        if not title: return self._send(400, {"ok": False, "error": "title obrigatório"})

        sb = supabase_client()
        url = _get_webhook_url(sb) if sb else None
        if not url:
            return self._send(503, {"ok": False, "error": "webhook_url não configurado em Configurações"})

        payload = {
            "title": title,
            "body": body.get("body") or "",
            "severity": body.get("severity") or "info",
            "data": body.get("data") or {},
            "actor": {"id": actor["id"], "name": actor.get("name")},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "PSM-OS-v2",
        }
        # Dispara
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={
                "Content-Type": "application/json", "User-Agent": "PSM-OS-v3/webhook"
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = resp.status
                resp_body = resp.read().decode("utf-8", errors="ignore")[:200]
        except urllib.error.HTTPError as e:
            audit(self, actor, "webhook.fail", target_type="webhook", notes=f"HTTP {e.code}")
            return self._send(502, {"ok": False, "error": f"webhook HTTP {e.code}"})
        except Exception as e:
            audit(self, actor, "webhook.fail", target_type="webhook", notes=str(e)[:200])
            return self._send(502, {"ok": False, "error": str(e)})

        audit(self, actor, "webhook.send", target_type="webhook", notes=f"sent: {title[:80]}")
        return self._send(200, {"ok": True, "status": status, "response_preview": resp_body})
