"""GET/POST /api/v3/diretoria/academy_treino — Sala de Treino da Academy. v86.92

Histórico de treinos de role-play (cenário + nota + feedback do avaliador IA).

GET  (lvl>=2): últimos 30 treinos do usuário logado
     ?user_id=X (lvl>=7): treinos de outro colaborador (gestão acompanha evolução)
POST: desativado (v88.56) — o treino é gravado pelo /api/v3/ia/chat (agent=treino_nota),
     com a nota tirada da resposta do avaliador. O navegador não grava nota.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


def _missing(e):
    s = str(e)
    return "academy_treinos" in s or "does not exist" in s or "schema cache" in s


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
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        uid = actor.get("id")
        alvo = (qs.get("user_id") or "").strip()
        if alvo and alvo != uid:
            if (actor.get("lvl") or 0) < 7:
                return self._send(403, {"ok": False, "error": "sem alçada pra ver treino de outro usuário"})
            uid = alvo
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = (sb.table("academy_treinos")
                    .select("id,cenario,nota,feedback,msgs,created_at")
                    .eq("user_id", uid).order("created_at", desc=True)
                    .limit(30).execute().data or [])
            return self._send(200, {"ok": True, "treinos": rows})
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": True, "treinos": [], "pending": True})
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        # v88.56: antes aceitava {nota} do navegador → nota forjável. Agora só o servidor grava.
        return self._send(410, {"ok": False, "error": "o treino é gravado pelo avaliador (/api/v3/ia/chat)"})
