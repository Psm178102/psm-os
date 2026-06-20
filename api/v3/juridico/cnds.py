"""
GET/POST /api/v3/juridico/cnds — CND's (Certidões Negativas de Débitos). v77.96

Registro gerenciável das certidões da imobiliária (Federal, Estadual, Municipal,
Trabalhista, FGTS…). Personalizável igual ao Cofre de Logins: só o sócio (lvl 10)
adiciona / edita / exclui; quem alcança a aba do Jurídico visualiza e baixa.

Cada CND = {id, titulo, tipo, empresa, numero, emissao(YYYY-MM-DD),
            validade(YYYY-MM-DD), link(Drive), obs}. O status (válida / a vencer /
vencida) é calculado no front a partir de `validade`. Guarda em shared_kv
key 'juridico_cnds' (sem SQL novo).

GET  (qualquer autenticado que alcança a página): {ok, items[], tipos[], can_manage}
POST (lvl >= 10): action add|update|delete. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "juridico_cnds"
MAXN = 300
# Tipos-referência (o sócio pode digitar qualquer outro; estes alimentam o dropdown)
TIPOS = ["Federal (RFB/PGFN)", "Estadual", "Municipal", "Trabalhista (CNDT)",
         "FGTS (CRF)", "Falência/Concordata", "Outras"]


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


def _date(s):
    s = str(s or "").strip()[:10]
    if not s:
        return ""
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return s
    except Exception:
        return ""


def _clean(d):
    return {
        "titulo": str(d.get("titulo") or "").strip()[:140],
        "tipo": str(d.get("tipo") or "").strip()[:60],
        "empresa": str(d.get("empresa") or "").strip()[:120],
        "numero": str(d.get("numero") or "").strip()[:80],
        "emissao": _date(d.get("emissao")),
        "validade": _date(d.get("validade")),
        "link": str(d.get("link") or "").strip()[:1000],
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
        return self._send(200, {"ok": True, "items": items, "tipos": TIPOS, "can_manage": manage})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só o sócio gerencia as CND's
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

        if len(items) > MAXN:
            return self._send(400, {"ok": False, "error": "limite de CND's atingido"})
        try:
            _write(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"cnd.{action}", target_type="juridico_cnds", target_id=str(body.get("id") or ""))
        return self._send(200, {"ok": True, "items": items, "tipos": TIPOS})
