"""
GET /api/v3/notifications/list[?only_unread=1&limit=50]
Lista notificações do user logado, ordem cronológica desc.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        only_unread = params.get("only_unread") == "1"
        try: limit = max(1, min(200, int(params.get("limit") or "50")))
        except: limit = 50

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            q = sb.table("notifications").select("*").eq("user_id", user["id"]).order("created_at", desc=True).limit(limit)
            if only_unread: q = q.eq("lida", False)
            rows = q.execute().data or []

            # Count unread total
            unread_q = sb.table("notifications").select("id", count="exact").eq("user_id", user["id"]).eq("lida", False).execute()
            unread_count = unread_q.count or 0
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        return self._send(200, {
            "ok": True,
            "count": len(rows),
            "unread_total": unread_count,
            "notifications": rows,
        })
