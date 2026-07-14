"""
GET /api/v3/zoho/sync_cron — cron: sincroniza TODOS os usuários conectados.
Agendado no vercel.json (a cada 30 min). Best-effort por usuário: um erro em
uma conexão não derruba as outras.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
from sync import sync_user  # type: ignore


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        sb = supabase_client()
        if not sb:
            self.send_response(503); self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"backend"}'); return
        out = {"ok": True, "usuarios": 0, "por_user": {}}
        try:
            conns = sb.table("zoho_conexoes").select("*").limit(500).execute().data or []
        except Exception as e:
            conns = []
            out["erro_lista"] = str(e)[:150]
        for c in conns:
            uid = str(c.get("user_id"))
            try:
                out["por_user"][uid] = sync_user(sb, c)
            except Exception as e:
                out["por_user"][uid] = {"erro": str(e)[:120]}
            out["usuarios"] += 1
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8"); self.end_headers()
        self.wfile.write(json.dumps(out, ensure_ascii=False, default=str).encode("utf-8"))
