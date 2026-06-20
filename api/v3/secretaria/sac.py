"""
GET/POST /api/v3/secretaria/sac — SAC Incorporadoras (agenda de contatos). v77.99

Agenda dos contatos das incorporadoras: SAC (telefone/WhatsApp), e os contatos de
coordenador e gerente POR PRODUTO/empreendimento. Operacional da Secretaria/Backoffice:
gerencia lvl>=5 (backoffice/líder/gerente/sócio); quem alcança a Secretaria visualiza.

Cada item = {id, incorporadora, tipo, produto, nome, telefone, whatsapp, email, obs}.
Agrupa por `incorporadora` no front. Guarda em shared_kv key 'secretaria_sac' (sem SQL).

GET  (qualquer autenticado que alcança a página): {ok, items[], tipos[], can_manage}
POST (lvl >= 5): action add|update|delete. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "secretaria_sac"
MAXN = 600
EDIT_MIN_LVL = 5
# Tipos-referência de contato (o usuário pode digitar outro; alimentam o dropdown)
TIPOS = ["SAC", "Coordenador(a) de produto", "Gerente de produto", "Comercial",
         "Financeiro / Repasse", "Pós-venda / Relacionamento", "Outro"]


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
        "incorporadora": str(d.get("incorporadora") or "").strip()[:120],
        "tipo": str(d.get("tipo") or "").strip()[:60],
        "produto": str(d.get("produto") or "").strip()[:140],
        "nome": str(d.get("nome") or "").strip()[:120],
        "telefone": str(d.get("telefone") or "").strip()[:40],
        "whatsapp": str(d.get("whatsapp") or "").strip()[:40],
        "email": str(d.get("email") or "").strip()[:160],
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
        manage = (user.get("lvl") or 0) >= EDIT_MIN_LVL
        return self._send(200, {"ok": True, "items": items, "tipos": TIPOS, "can_manage": manage})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=EDIT_MIN_LVL)
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
            return self._send(400, {"ok": False, "error": "limite de contatos atingido"})
        try:
            _write(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"sac.{action}", target_type="secretaria_sac", target_id=str(body.get("id") or ""))
        return self._send(200, {"ok": True, "items": items, "tipos": TIPOS})
