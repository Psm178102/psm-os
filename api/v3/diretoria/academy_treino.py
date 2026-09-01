"""GET/POST /api/v3/diretoria/academy_treino — Sala de Treino da Academy. v86.92

Histórico de treinos de role-play (cenário + nota + feedback do avaliador IA).

GET  (lvl>=2): últimos 30 treinos do usuário logado
     ?user_id=X (lvl>=7): treinos de outro colaborador (gestão acompanha evolução)
POST (lvl>=2): { cenario, nota, feedback, msgs } → salva o treino concluído
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
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cenario = (body.get("cenario") or "").strip()[:80]
        if not cenario:
            return self._send(400, {"ok": False, "error": "cenario obrigatório"})
        try:
            nota = float(body.get("nota"))
            nota = max(0.0, min(10.0, nota))
        except Exception:
            nota = None
        row = {
            "user_id": actor.get("id"),
            "cenario": cenario,
            "nota": nota,
            "feedback": (body.get("feedback") or "").strip()[:8000] or None,
            "msgs": int(body.get("msgs") or 0),
        }
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            r = sb.table("academy_treinos").insert(row).execute()
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": False, "pending": True,
                                        "error": "Tabela academy_treinos ainda não existe"})
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "academy.treino", target_type="academy_treinos",
              notes=f"{cenario} nota={nota}")
        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})
