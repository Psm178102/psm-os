"""
GET/POST /api/v3/settings/kv_config — editor das configs avançadas do shared_kv. v84.1

Auditoria A5: 'oo_meta_team_account' e 'custos_fixos_corretor' eram lidas pelo
sistema (One-on-One/CPL) mas NÃO tinham tela nem endpoint de escrita — só SQL
manual. Agora têm. Whitelist fechada: só as chaves listadas aqui.

GET  ?key=<k>            (lvl>=7)  → { ok, key, value }
POST { key, value }      (lvl>=10) → { ok } (value = JSON já validado no front)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

ALLOWED = {
    "oo_meta_team_account":  "Mapa equipe → account_id do Meta (override do One-on-One)",
    "custos_fixos_corretor": "Custo fixo mensal por equipe/corretor (CPL do 1:1)",
}
MAX_BYTES = 60_000


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        key = (qs.get("key") or "").strip()
        if key not in ALLOWED:
            return self._send(400, {"ok": False, "error": "chave fora da whitelist", "chaves": list(ALLOWED)})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("shared_kv").select("value,updated_at").eq("key", key).limit(1).execute().data or []
            val = rows[0]["value"] if rows else {}
            if isinstance(val, str):
                val = json.loads(val)
            up = rows[0].get("updated_at") if rows else None
        except Exception:
            val, up = {}, None
        return self._send(200, {"ok": True, "key": key, "desc": ALLOWED[key], "value": val, "updated_at": up})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "payload grande demais"})
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        key = (body.get("key") or "").strip()
        if key not in ALLOWED:
            return self._send(400, {"ok": False, "error": "chave fora da whitelist"})
        value = body.get("value")
        if not isinstance(value, dict):
            return self._send(400, {"ok": False, "error": "value precisa ser um objeto JSON"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("shared_kv").upsert({"key": key, "value": value,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "kv_config.update", target_type="shared_kv", target_id=key)
        return self._send(200, {"ok": True, "key": key})
