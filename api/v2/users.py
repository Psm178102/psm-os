"""
PSM-OS v2 — Users endpoint (SKELETON, Sprint 0)
GET  /api/v2/users           -> lista todos os usuários do Postgres
GET  /api/v2/users?id=paulo  -> retorna um usuário específico
POST /api/v2/users           -> upsert (cria ou atualiza)

Em Sprint 0 isso apenas valida que o cliente Supabase conecta.
Em Sprint 1 vira a fonte de verdade dos usuários (substitui USERS hardcoded).

Schema esperado (rodar /docs/v2_schema.sql no Supabase SQL editor):
  - users(id text PK, name, email, role, team, ini, color, rd_id, status, ...)
  - teams(id text PK, name, manager_id, ...)
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.parse


def _supabase_client():
    """Cria cliente Supabase server-side com service role.
    Retorna None se env vars ausentes (e o handler responde 503 nesse caso).
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
        return create_client(url, key)
    except Exception as e:
        # Log silencioso — handler retorna erro estruturado
        print(f"[v2/users] erro criar cliente Supabase: {e}")
        return None


def _hidden_from_pickers(u):
    """Some das OPÇÕES/dropdowns do sistema quando o usuário está INATIVO **ou**
    OCULTO (hide_from_ranking). Inativar OU ocultar OU excluir já tira a pessoa de
    todo seletor (responsável, talentos, etc.). v81.86"""
    inativo = (u.get("status") or "ativo") != "ativo"
    return inativo or bool(u.get("hide_from_ranking"))


def _list_users(sb, show_all=False):
    """Lista usuários da tabela `users`. Por PADRÃO exclui inativos/ocultos (pra não
    poluir dropdowns); passe show_all=True (?all=1) pra trazer todos. v81.86"""
    res = sb.table("users").select("*").order("name").execute()
    rows = res.data or []
    if not show_all:
        rows = [r for r in rows if not _hidden_from_pickers(r)]
    return rows


def _get_user(sb, user_id):
    """Retorna 1 usuário por id."""
    res = sb.table("users").select("*").eq("id", user_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


def _upsert_user(sb, payload):
    """Cria ou atualiza um usuário (id é PK)."""
    res = sb.table("users").upsert(payload).execute()
    return (res.data or [None])[0]


class handler(BaseHTTPRequestHandler):

    # ----- helpers -----
    def _send_json(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, indent=2, ensure_ascii=False).encode("utf-8"))

    def _query_params(self):
        try:
            url = urllib.parse.urlparse(self.path)
            return dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            return {}

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw) if raw else {}
        except Exception:
            return {}

    # ----- methods -----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        sb = _supabase_client()
        if not sb:
            return self._send_json(503, {
                "ok": False,
                "error": "Supabase nao configurado",
                "hint": "Adicione SUPABASE_URL e SUPABASE_SERVICE_KEY nas env vars do Vercel",
            })

        params = self._query_params()
        user_id = params.get("id")
        try:
            if user_id:
                u = _get_user(sb, user_id)
                if not u:
                    return self._send_json(404, {"ok": False, "error": f"user not found: {user_id}"})
                return self._send_json(200, {"ok": True, "user": u})
            else:
                show_all = (params.get("all", "") or "").lower() in ("1", "true", "yes")
                users = _list_users(sb, show_all)
                return self._send_json(200, {"ok": True, "count": len(users), "users": users})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        sb = _supabase_client()
        if not sb:
            return self._send_json(503, {"ok": False, "error": "Supabase nao configurado"})

        payload = self._read_body()
        if not payload.get("id") or not payload.get("name"):
            return self._send_json(400, {"ok": False, "error": "payload precisa de id e name"})

        try:
            result = _upsert_user(sb, payload)
            return self._send_json(200, {"ok": True, "user": result})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})
