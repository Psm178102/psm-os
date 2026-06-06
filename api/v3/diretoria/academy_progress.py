"""GET/POST /api/v3/diretoria/academy_progress — Progresso do aluno na Academy

GET  (lvl>=2): { ok, completed: [item_id,...] } do usuário logado
POST (lvl>=2): { item_id, done } → marca/desmarca aula como concluída

Cada linha = (user_id, item_id) concluído. Degrada gracioso se a tabela não existir.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


def _missing(e):
    s = str(e)
    return "academy_progress" in s or "does not exist" in s or "schema cache" in s


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("academy_progress").select("item_id").eq("user_id", actor.get("id")).limit(5000).execute().data or []
            return self._send(200, {"ok": True, "completed": [r["item_id"] for r in rows]})
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": True, "completed": [], "pending": True})
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        item_id = (body.get("item_id") or "").strip()
        if not item_id:
            return self._send(400, {"ok": False, "error": "item_id obrigatório"})
        done = bool(body.get("done"))

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        uid = actor.get("id")
        try:
            if done:
                sb.table("academy_progress").upsert(
                    {"user_id": uid, "item_id": item_id, "completed_at": datetime.now(timezone.utc).isoformat()},
                    on_conflict="user_id,item_id",
                ).execute()
            else:
                sb.table("academy_progress").delete().eq("user_id", uid).eq("item_id", item_id).execute()
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": False, "pending": True,
                                        "error": "Tabela academy_progress não existe — rode supabase/sprint9_25_academy_faculdade.sql"})
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "item_id": item_id, "done": done})
