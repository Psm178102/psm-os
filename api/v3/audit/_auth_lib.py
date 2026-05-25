"""
PSM-OS v3 — Auth helpers (bcrypt + JWT)
========================================

Esse módulo NÃO é um endpoint (Vercel ignora arquivos com prefixo underscore).
É importado pelos endpoints reais (auth_login.py, auth_me.py, users.py, etc).

Env vars necessárias no Vercel:
  - SUPABASE_URL
  - SUPABASE_SERVICE_KEY
  - JWT_SECRET            (string aleatória >= 32 chars; gerada uma vez e nunca trocada)
  - JWT_ISSUER            (opcional, default 'psm-os')
  - JWT_TTL_HOURS         (opcional, default 12)
"""
from __future__ import annotations

import os
import time
import uuid
from typing import Optional, Tuple


# ─── Supabase client ───────────────────────────────────────────────────────
def supabase_client():
    """Singleton-ish (Vercel reusa o processo enquanto está hot)."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
        return create_client(url, key)
    except Exception as e:
        print(f"[auth_lib] erro criar Supabase client: {e}")
        return None


# ─── Password hashing ──────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    """Gera bcrypt hash com 12 rounds."""
    import bcrypt
    if not plain or len(plain) < 6:
        raise ValueError("senha precisa ter pelo menos 6 caracteres")
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    """Compara senha plain com hash bcrypt armazenado."""
    import bcrypt
    if not hashed or not plain:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─── JWT ───────────────────────────────────────────────────────────────────
def _jwt_secret() -> str:
    """Pega secret do env. Se ausente, gera erro (não permite default fraco)."""
    secret = os.environ.get("JWT_SECRET")
    if not secret or len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET ausente ou < 32 caracteres. "
            "Adicione no Vercel: openssl rand -hex 32"
        )
    return secret


def _jwt_issuer() -> str:
    return os.environ.get("JWT_ISSUER", "psm-os")


def _jwt_ttl_seconds() -> int:
    try:
        hours = int(os.environ.get("JWT_TTL_HOURS", "12"))
    except Exception:
        hours = 12
    return max(1, hours) * 3600


ROLE_LVL = {
    "socio": 10, "diretor": 10,
    "gerente": 7,
    "backoffice": 6, "back_office": 6, "back-office": 6,
    "lider": 5, "líder": 5,
    "marketing": 3,
    "corretor": 2,
}


def lvl_of(role: str) -> int:
    """Computa nível hierárquico a partir do role string. Default 2 (corretor)."""
    return ROLE_LVL.get((role or "").strip().lower(), 2)


def enrich_user(u: dict) -> dict:
    """Adiciona campos derivados (lvl, is_lider, is_diretor) sem persistir."""
    if not u:
        return u
    role = (u.get("role") or "corretor").lower()
    u["lvl"] = lvl_of(role)
    u["is_lider"] = role in ("lider", "líder", "gerente", "socio", "diretor")
    u["is_diretor"] = role in ("socio", "diretor")
    return u


def sign_jwt(user: dict, user_agent: str = "", ip: str = "") -> Tuple[str, str, int]:
    """
    Assina um JWT pro usuário. Retorna (token, jti, expires_at_unix).
    Claims incluem: sub (user id), name, role, lvl, jti, iss, iat, exp.
    """
    import jwt  # PyJWT
    jti = uuid.uuid4().hex
    now = int(time.time())
    exp = now + _jwt_ttl_seconds()
    role = (user.get("role") or "corretor").lower()
    payload = {
        "sub": user.get("id"),
        "name": user.get("name") or "",
        "email": user.get("email") or "",
        "role": role,
        "team": user.get("team") or "geral",
        "lvl": lvl_of(role),
        "iss": _jwt_issuer(),
        "iat": now,
        "exp": exp,
        "jti": jti,
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm="HS256")
    if isinstance(token, bytes):  # PyJWT < 2 retornava bytes
        token = token.decode("utf-8")
    return token, jti, exp


def verify_jwt(token: str) -> Optional[dict]:
    """Valida JWT. Retorna claims dict ou None se inválido/expirado."""
    import jwt
    if not token:
        return None
    try:
        return jwt.decode(
            token, _jwt_secret(),
            algorithms=["HS256"],
            issuer=_jwt_issuer(),
            options={"require": ["exp", "iat", "sub"]},
        )
    except Exception as e:
        print(f"[auth_lib] JWT inválido: {e}")
        return None


# ─── Helper p/ extrair Bearer do header ────────────────────────────────────
def bearer_from_headers(headers) -> str:
    """Lê Authorization: Bearer <token>. Aceita case-insensitive."""
    try:
        auth = headers.get("Authorization") or headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
    except Exception:
        pass
    return ""


# ─── Helper p/ obter user logado a partir do request ───────────────────────
def current_user(handler) -> Optional[dict]:
    """
    Dado um BaseHTTPRequestHandler, extrai o JWT do header e retorna o user
    completo do Postgres (ou None se sem token/token inválido/usuário sumiu).
    """
    token = bearer_from_headers(handler.headers)
    claims = verify_jwt(token)
    if not claims:
        return None
    sb = supabase_client()
    if not sb:
        return None
    try:
        res = sb.table("users").select(
            "id,name,email,role,team,ini,color,rd_id,meta_id,status,hide_from_ranking,last_login_at"
        ).eq("id", claims.get("sub")).limit(1).execute()
        rows = res.data or []
        if not rows:
            return None
        return enrich_user(rows[0])
    except Exception as e:
        print(f"[auth_lib] erro buscar user: {e}")
        return None


# ─── Helper: require auth (raise se não autenticado) ───────────────────────
class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def require_user(handler, min_lvl: int = 0) -> dict:
    """Eleva exceção se sem auth ou lvl insuficiente. Retorna user dict."""
    u = current_user(handler)
    if not u:
        raise AuthError(401, "autenticação necessária")
    if (u.get("lvl") or 0) < min_lvl:
        raise AuthError(403, f"requer nível ≥ {min_lvl}")
    return u


# ─── Audit log ─────────────────────────────────────────────────────────────
def audit(handler, actor, action: str, target_type: str = None,
          target_id: str = None, before=None, after=None, notes: str = None) -> None:
    """
    Grava entrada de audit_log. Best-effort — falha não bloqueia o request.
    Use em TODOS os endpoints que mudam dados.

    Args:
      handler: BaseHTTPRequestHandler (pra extrair ip/user-agent)
      actor:   dict do user logado (pode ser None p/ bootstrap)
      action:  string 'dominio.acao'  ex: 'user.update', 'auth.login'
      target_type: 'user', 'commission', etc.
      target_id:   id da entidade alvo
      before/after: snapshots JSON-serializable das mudanças
      notes:   string livre p/ contexto extra
    """
    try:
        sb = supabase_client()
        if not sb:
            return
        try:
            ip = (handler.headers.get("X-Forwarded-For") or "").split(",")[0].strip() \
                 or handler.headers.get("X-Real-IP") or ""
            ua = handler.headers.get("User-Agent") or ""
        except Exception:
            ip = ""
            ua = ""
        row = {
            "actor_id":    (actor or {}).get("id"),
            "actor_name":  (actor or {}).get("name"),
            "actor_role":  (actor or {}).get("role"),
            "action":      action,
            "target_type": target_type,
            "target_id":   target_id,
            "before_data": before,
            "after_data":  after,
            "ip":          (ip or "")[:64] or None,
            "user_agent":  (ua or "")[:255] or None,
            "notes":       notes,
        }
        sb.table("audit_log").insert(row).execute()
    except Exception as e:
        print(f"[audit] falha gravar: {e}")
