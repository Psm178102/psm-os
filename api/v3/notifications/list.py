"""
GET /api/v3/notifications/list[?only_unread=1&limit=50]
Lista notificações do user logado, ordem cronológica desc.

GET ?por_tela=1 (v88.34) → { por_tela: { "/crm": {n, ids:[...]}, ... } } — não lidas agrupadas
pela TELA de destino (campo link). Alimenta os números vermelhos do menu lateral.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


def rota_de(link):
    """'#/crm-house?x=1' | '/crm' | '/#/crm/123' → '/crm-house' | '/crm' | '/crm'. Sem link → None.
    Mesma normalização do notifs.js (backends gravam link em 3 formatos)."""
    t = str(link or "").strip()
    if not t or t.startswith("http"):
        return None
    t = t.lstrip("/#")
    base = t.split("?", 1)[0].split("/", 1)[0].strip()
    return "/" + base if base else None


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

        if params.get("por_tela") == "1":
            try:
                rows = (sb.table("notifications").select("id,link").eq("user_id", user["id"]).eq("lida", False)
                        .order("created_at", desc=True).limit(2000).execute().data or [])
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            por = {}
            for r in rows:
                rota = rota_de(r.get("link"))
                if not rota:
                    continue
                e = por.setdefault(rota, {"n": 0, "ids": []})
                e["n"] += 1
                if len(e["ids"]) < 300:
                    e["ids"].append(r["id"])
            return self._send(200, {"ok": True, "por_tela": por, "unread_total": len(rows)})

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
