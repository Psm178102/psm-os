"""
GET/POST /api/v3/secretaria/links — Links úteis do dia a dia (Secretaria/Backoffice). v77.98

Catálogo dos atalhos operacionais que a secretaria/backoffice usa toda hora:
2ª via de energia (CPFL), IPTU por cidade (Rio Preto, Mirassol, Bady…), água/esgoto
(SEMAE), troca de titularidade, cartórios, prefeituras… Personalizável igual ao
Cofre: só o sócio (lvl 10) adiciona / edita / exclui; quem alcança a Secretaria vê
e abre os links.

Cada item = {id, titulo, categoria, orgao(concessionária/órgão), cidade, link, obs}.
Agrupa por `categoria` no front. Guarda em shared_kv key 'secretaria_links' (sem SQL).

GET  (qualquer autenticado que alcança a página): {ok, items[], categorias[], can_manage}
POST (lvl >= 10): action add|update|delete. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "secretaria_links"
MAXN = 400
# Categorias-referência (o sócio pode digitar qualquer outra; alimentam o datalist)
CATEGORIAS = ["⚡ Energia (CPFL)", "💧 Água / Esgoto (SEMAE)", "🏛 IPTU / Prefeitura",
              "📄 Cartórios", "📞 Telefonia / Internet", "🚗 Detran / Veículos",
              "🏦 Bancos", "🔁 Troca de titularidade", "Outros"]


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
        "titulo": str(d.get("titulo") or "").strip()[:160],
        "categoria": str(d.get("categoria") or "").strip()[:60],
        "orgao": str(d.get("orgao") or "").strip()[:120],
        "cidade": str(d.get("cidade") or "").strip()[:80],
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
        return self._send(200, {"ok": True, "items": items, "categorias": CATEGORIAS, "can_manage": manage})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só o sócio gerencia
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
            return self._send(400, {"ok": False, "error": "limite de links atingido"})
        try:
            _write(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"seclink.{action}", target_type="secretaria_links", target_id=str(body.get("id") or ""))
        return self._send(200, {"ok": True, "items": items, "categorias": CATEGORIAS})
