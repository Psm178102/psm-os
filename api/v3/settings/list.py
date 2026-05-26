"""
GET /api/v3/settings/list[?reveal=1]
Header: Authorization: Bearer <token>

Lista settings agrupados por categoria. Secrets mascarados por default.
?reveal=1 retorna valores reais (requer Sócio lvl>=10).

Apenas Sócio/Gerente (lvl>=7) pode acessar.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from _schema import whitelist, to_grouped, SETTINGS_SCHEMA, CATEGORIES  # type: ignore


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}
        reveal = params.get("reveal") == "1" and (user.get("lvl") or 0) >= 10

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            row = sb.table("shared_kv").select("value,updated_at").eq("key", SHARED_KEY).limit(1).execute().data or []
            stored = (row[0].get("value") if row else {}) or {}
            if not isinstance(stored, dict):
                stored = {}
            updated_at = row[0].get("updated_at") if row else None
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Filtra só chaves whitelisted
        valid_keys = whitelist()
        clean = {k: v for k, v in stored.items() if k in valid_keys}

        if reveal:
            # Retorna valores reais sem mascarar
            groups = {}
            for k, label, cat, sec, ph in SETTINGS_SCHEMA:
                groups.setdefault(cat, {"category": cat, **CATEGORIES.get(cat, {}), "items": []})
                val = clean.get(k) or ""
                groups[cat]["items"].append({
                    "key": k, "label": label, "is_secret": sec,
                    "placeholder": ph, "value": val, "has_value": bool(val),
                })
            grouped = list(groups.values())
        else:
            grouped = to_grouped(clean)

        return self._send(200, {
            "ok": True,
            "reveal": reveal,
            "updated_at": updated_at,
            "groups": grouped,
            "count": len(clean),
        })
