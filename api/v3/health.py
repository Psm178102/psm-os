"""
GET /api/v3/health
Reporta status do backend Sprint 7 (Postgres + JWT + envs).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def do_GET(self):
        checks = {
            "supabase_url": bool(os.environ.get("SUPABASE_URL")),
            "supabase_service_key": bool(os.environ.get("SUPABASE_SERVICE_KEY")),
            "jwt_secret": bool(os.environ.get("JWT_SECRET")) and len(os.environ.get("JWT_SECRET", "")) >= 32,
        }

        sb_ok = False
        users_count = None
        users_with_password = None
        err = None
        try:
            sb = supabase_client()
            if sb:
                sb_ok = True
                res = sb.table("users").select("id,password_hash").execute()
                rows = res.data or []
                users_count = len(rows)
                users_with_password = sum(1 for r in rows if r.get("password_hash"))
        except Exception as e:
            err = str(e)

        all_ok = all(checks.values()) and sb_ok

        return self._send(200 if all_ok else 503, {
            "ok": all_ok,
            "version": "v3-sprint-7.0",
            "env": checks,
            "supabase": {
                "connected": sb_ok,
                "users_total": users_count,
                "users_with_password": users_with_password,
                "error": err,
            },
        })
