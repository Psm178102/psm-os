"""
GET/POST /api/v3/vault/creds — Cofre de Logins e Senhas (com controle de quem vê). v77.93

Guarda credenciais (apps, redes sociais, assinaturas…) em shared_kv key 'vault_creds'.
Cada credencial tem uma lista `viewers` (ids de usuários) que podem VÊ-LA. Só o sócio
(lvl 10) cria/edita/define quem vê. O backend NUNCA devolve a senha de uma credencial
pra quem não está autorizado — quem não pode ver, nem recebe a credencial.

GET  (qualquer autenticado): {ok, items:[...], can_manage}
     • sócio (lvl10): TODAS as credenciais (com senha) + can_manage:true
     • demais: só as credenciais em que o uid está em `viewers` (com senha) + can_manage:false
POST (lvl>=10): action add|update|delete. Audita (sem logar a senha).

⚠️ Segurança: armazenado no banco (Supabase, criptografado em repouso) com acesso só
via service-role do backend + filtro por viewers aqui. Não há cripto app-level (sem lib).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "vault_creds"
MAXN = 200


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    items = (val or {}).get("items") if isinstance(val, dict) else None
    return items if isinstance(items, list) else []


def _write(sb, items):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"items": items},
                                 "updated_at": datetime.now(timezone.utc).isoformat()},
                                on_conflict="key").execute()


def _clean(d):
    return {
        "titulo": str(d.get("titulo") or "").strip()[:120],
        "categoria": str(d.get("categoria") or "").strip()[:60],
        "url": str(d.get("url") or "").strip()[:500],
        "login": str(d.get("login") or "").strip()[:200],
        "senha": str(d.get("senha") or "")[:300],
        "obs": str(d.get("obs") or "").strip()[:500],
        "viewers": [str(v) for v in (d.get("viewers") or []) if str(v).strip()][:80],
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        items = _read(sb)
        uid = user.get("id")
        manage = (user.get("lvl") or 0) >= 10
        if manage:
            out = items
        else:
            # só as credenciais liberadas pra ESTE usuário (as outras nem saem do servidor)
            out = [it for it in items if uid in (it.get("viewers") or [])]
        return self._send(200, {"ok": True, "items": out, "can_manage": manage})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só o sócio gerencia o cofre
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        items = _read(sb)
        action = (body.get("action") or "").strip()

        if action == "add":
            c = _clean(body.get("item") or {})
            if not c["titulo"]:
                return self._send(400, {"ok": False, "error": "Título é obrigatório"})
            c["id"] = uuid.uuid4().hex[:12]
            c["created_by"] = actor.get("name")
            c["created_at"] = datetime.now(timezone.utc).isoformat()
            items.append(c)
        elif action == "update":
            iid = body.get("id")
            hit = next((it for it in items if it.get("id") == iid), None)
            if not hit:
                return self._send(404, {"ok": False, "error": "não encontrado"})
            c = _clean(body.get("item") or {})
            if not c["titulo"]:
                return self._send(400, {"ok": False, "error": "Título é obrigatório"})
            hit.update(c)
            hit["updated_at"] = datetime.now(timezone.utc).isoformat()
            hit["updated_by"] = actor.get("name")
        elif action == "delete":
            iid = body.get("id")
            items = [it for it in items if it.get("id") != iid]
        else:
            return self._send(400, {"ok": False, "error": "ação inválida"})

        try:
            _write(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        # audita SEM a senha
        audit(self, actor, f"vault.{action}", target_type="vault_creds", target_id=str(body.get("id") or ""))
        # devolve a lista completa (actor é sócio → pode ver tudo)
        return self._send(200, {"ok": True, "items": items})
