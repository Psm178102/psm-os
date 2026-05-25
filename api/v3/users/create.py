"""
POST /api/v3/users/create
Body: { "id": "...", "name": "...", "email": "...", "role": "...", "team": "..." }
Header: Authorization: Bearer <token>

Cria um novo user. Requer Sócio (lvl >= 10).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, enrich_user, audit  # type: ignore


_ID_RE = re.compile(r"^[a-z0-9_\-]{2,40}$")


def _normalize_id(s: str) -> str:
    """Normaliza nome → id slug (sem acentos, lowercase, underscore)."""
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return s[:40] or "user"


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)  # Apenas Sócio
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        name  = (body.get("name") or "").strip()
        email = (body.get("email") or "").strip().lower()
        role  = (body.get("role") or "corretor").strip().lower()
        team  = (body.get("team") or "geral").strip().lower()
        user_id = (body.get("id") or "").strip().lower() or _normalize_id(name)
        ini   = (body.get("ini") or name[:2]).upper()[:3]
        color = body.get("color") or "#64748b"

        if not name:
            return self._send(400, {"ok": False, "error": "name obrigatório"})
        if not _ID_RE.match(user_id):
            return self._send(400, {"ok": False, "error": "id inválido (use minúsculas, números, _ ou -, 2-40 chars)"})
        if email and "@" not in email:
            return self._send(400, {"ok": False, "error": "email inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # Confere se id ou email já existem
        try:
            existing = sb.table("users").select("id,email").eq("id", user_id).execute().data or []
            if existing:
                return self._send(409, {"ok": False, "error": f"id '{user_id}' já existe"})
            if email:
                e2 = sb.table("users").select("id").ilike("email", email).execute().data or []
                if e2:
                    return self._send(409, {"ok": False, "error": f"email '{email}' já cadastrado"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro verificação: {e}"})

        # Insert
        new_row = {
            "id": user_id,
            "name": name,
            "email": email or None,
            "role": role,
            "team": team,
            "ini": ini,
            "color": color,
            "status": "ativo",
            "hide_from_ranking": False,
        }
        try:
            res = sb.table("users").insert(new_row).execute()
            row = (res.data or [new_row])[0]
            audit(self, actor, "user.create", target_type="user", target_id=user_id,
                  after=new_row)
            return self._send(200, {"ok": True, "user": enrich_user(row)})
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro insert: {e}"})
