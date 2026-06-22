"""
GET/POST /api/v3/secretaria/sistemas — Sistema e Drive Incorporadoras. v78.1

Um registro por incorporadora reunindo TUDO num lugar: WhatsApp do gerente e do
coordenador, link do grupo PSM↔incorporadora, link de tabelas, link do Drive, e o
acesso ao sistema (nome, URL, login, senha). Pra centralizar o operacional de cada
incorporadora. Guarda em shared_kv key 'secretaria_sistemas' (sem SQL).

Acesso: quem alcança a Secretaria VÊ (a senha vem mascarável no front, com revelar/
copiar). Só o sócio (lvl 10) cria / edita / exclui — porque guarda senha.

Cada item = {id, incorporadora, gerente, gerente_whatsapp, coordenador,
            coordenador_whatsapp, grupo_link, tabelas_link, drive_link,
            sistema, sistema_url, sistema_login, sistema_senha, obs}.

GET  (qualquer autenticado que alcança a página): {ok, items[], can_manage}
POST (lvl >= 10): action add|update|delete. Audita SEM logar a senha.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "secretaria_sistemas"
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


def _norm_cidades(d):
    cid = d.get("cidades")
    if isinstance(cid, str):
        cid = cid.replace(";", ",").split(",")
    out, seen = [], set()
    for c in (cid or []):
        c = str(c).strip()[:80]
        k = c.lower()
        if c and k not in seen:
            seen.add(k); out.append(c)
        if len(out) >= 40:
            break
    return out


def _norm_cats(d):
    cats = d.get("categorias") or []
    if isinstance(cats, str):
        cats = [cats]
    up = {str(c).strip().upper() for c in cats}
    return [c for c in ("MAP", "MCMV") if c in up]   # ordem fixa, sem duplicar


def _clean(d):
    return {
        "incorporadora": str(d.get("incorporadora") or "").strip()[:120],
        "categorias": _norm_cats(d),
        "cidades": _norm_cidades(d),
        "gerente": str(d.get("gerente") or "").strip()[:120],
        "gerente_whatsapp": str(d.get("gerente_whatsapp") or "").strip()[:40],
        "coordenador": str(d.get("coordenador") or "").strip()[:120],
        "coordenador_whatsapp": str(d.get("coordenador_whatsapp") or "").strip()[:40],
        "grupo_link": str(d.get("grupo_link") or "").strip()[:1000],
        "tabelas_link": str(d.get("tabelas_link") or "").strip()[:1000],
        "drive_link": str(d.get("drive_link") or "").strip()[:1000],
        "sistema": str(d.get("sistema") or "").strip()[:120],
        "sistema_url": str(d.get("sistema_url") or "").strip()[:1000],
        "sistema_login": str(d.get("sistema_login") or "").strip()[:200],
        "sistema_senha": str(d.get("sistema_senha") or "")[:300],
        "obs": str(d.get("obs") or "").strip()[:600],
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
        manage = (user.get("lvl") or 0) >= 10
        return self._send(200, {"ok": True, "items": items, "can_manage": manage})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # guarda senha → só o sócio gerencia
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
            if not c["incorporadora"]:
                return self._send(400, {"ok": False, "error": "Incorporadora é obrigatória"})
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
            if not c["incorporadora"]:
                return self._send(400, {"ok": False, "error": "Incorporadora é obrigatória"})
            hit.update(c)
            hit["updated_at"] = datetime.now(timezone.utc).isoformat()
            hit["updated_by"] = actor.get("name")
        elif action == "delete":
            iid = body.get("id")
            items = [it for it in items if it.get("id") != iid]
        else:
            return self._send(400, {"ok": False, "error": "ação inválida"})

        if len(items) > MAXN:
            return self._send(400, {"ok": False, "error": "limite atingido"})
        try:
            _write(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        # audita SEM a senha
        audit(self, actor, f"sistinc.{action}", target_type="secretaria_sistemas", target_id=str(body.get("id") or ""))
        return self._send(200, {"ok": True, "items": items})
