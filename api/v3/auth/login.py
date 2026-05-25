"""
POST /api/v3/auth/login
Body: { "email": "...", "password": "..." }
Resp: { ok, token, user, expires_at }

Sprint 7.0 — entrypoint principal de autenticação.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time

# Permite importar _auth_lib do mesmo dir
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (  # type: ignore
    supabase_client, verify_password, sign_jwt, enrich_user, audit
)


def _find_user_by_email(sb, email: str):
    """Procura user por email (case-insensitive). Retorna row com password_hash."""
    if not email:
        return None
    email = email.strip().lower()
    res = (
        sb.table("users")
        .select("id,name,email,role,team,ini,color,rd_id,meta_id,status,hide_from_ranking,last_login_at,password_hash")
        .ilike("email", email)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _record_login(sb, user_id: str, ip: str):
    """Atualiza last_login_at + last_login_ip (best effort)."""
    try:
        sb.table("users").update({
            "last_login_at": "now()",
            "last_login_ip": ip[:64] if ip else None,
        }).eq("id", user_id).execute()
    except Exception as e:
        print(f"[auth_login] falha gravar last_login: {e}")


def _record_session(sb, jti: str, user_id: str, expires_unix: int, ua: str, ip: str):
    """Best effort — se a tabela não existir ou falhar, segue."""
    try:
        import datetime as dt
        exp_iso = dt.datetime.utcfromtimestamp(expires_unix).isoformat() + "Z"
        sb.table("user_sessions").insert({
            "jti": jti,
            "user_id": user_id,
            "expires_at": exp_iso,
            "user_agent": (ua or "")[:255],
            "ip": (ip or "")[:64],
        }).execute()
    except Exception as e:
        print(f"[auth_login] falha gravar session: {e}")


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
        # Parse body
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""

        if not email or not password:
            return self._send(400, {"ok": False, "error": "email e password obrigatórios"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível (Supabase)"})

        # Pequeno delay anti-timing-attack
        t0 = time.time()
        try:
            user = _find_user_by_email(sb, email)
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro consulta: {e}"})

        # Mesma resposta pra "user inexistente" vs "senha errada" (não vaza email válido)
        if not user or not verify_password(password, user.get("password_hash")):
            # Atrasa pra mascarar timing
            elapsed = time.time() - t0
            if elapsed < 0.3:
                time.sleep(0.3 - elapsed)
            audit(self, None, "auth.login_fail", target_type="user",
                  target_id=(user or {}).get("id"), notes=f"email={email}")
            return self._send(401, {"ok": False, "error": "email ou senha inválidos"})

        # Status check (aceita variantes pt/en)
        st = (user.get("status") or "").lower()
        if st in ("inactive", "inativo", "disabled", "desativado"):
            return self._send(403, {"ok": False, "error": "usuário desativado"})

        # IP + user agent
        ip = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip() \
             or self.headers.get("X-Real-IP") or ""
        ua = self.headers.get("User-Agent") or ""

        # Assina JWT
        try:
            token, jti, exp = sign_jwt(user, user_agent=ua, ip=ip)
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro assinar JWT: {e}"})

        # Atualiza last_login + grava sessão (best effort, não bloqueia)
        _record_login(sb, user["id"], ip)
        _record_session(sb, jti, user["id"], exp, ua, ip)

        # Audit
        audit(self, user, "auth.login_ok", target_type="user", target_id=user["id"])

        # Remove password_hash + enriquece com lvl/is_lider/is_diretor
        safe_user = {k: v for k, v in user.items() if k != "password_hash"}
        safe_user = enrich_user(safe_user)

        return self._send(200, {
            "ok": True,
            "token": token,
            "expires_at": exp,
            "user": safe_user,
        })
