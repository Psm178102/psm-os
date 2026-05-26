"""
GET /api/v3/comments/list?target_type=task&target_id=t_xxxxx
Lista comentários em ordem cronológica. Enriquecido com autor (name, ini, color).
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

        target_type = params.get("target_type") or ""
        target_id   = params.get("target_id") or ""
        if not target_type or not target_id:
            return self._send(400, {"ok": False, "error": "target_type e target_id obrigatórios"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            rows = sb.table("comments").select("*") \
                .eq("target_type", target_type).eq("target_id", target_id) \
                .order("created_at").limit(500).execute().data or []
            # Enrich author
            author_ids = list({r.get("autor_id") for r in rows if r.get("autor_id")})
            authors = {}
            if author_ids:
                au = sb.table("users").select("id,name,ini,color,role").in_("id", author_ids).execute().data or []
                authors = {a["id"]: a for a in au}
            for r in rows:
                r["autor"] = authors.get(r.get("autor_id"))
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        return self._send(200, {"ok": True, "count": len(rows), "comments": rows})
