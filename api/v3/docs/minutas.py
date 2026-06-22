"""
GET/POST /api/v3/docs/minutas?scope=juridico|locacao — Biblioteca de minutas/documentos. v77.80

Cada escopo é uma LISTA de documentos {id, nome, categoria, url(Google Drive), obs}.
Guarda em shared_kv key 'minutas:<scope>' (sem SQL novo). Os links são do Drive
(visualização/download). Reaproveita o padrão de settings/links.py.

GET  (qualquer autenticado que alcança a página): {ok, scope, label, items[], can_edit}.
POST (lvl >= edit_min_lvl do escopo): action add|update|delete|reorder. Audita.

Escopos:
  juridico → 'Minutas padrão' (Diretoria), editar lvl>=7
  locacao  → 'Minutas e fichas · Locação', editar lvl>=5
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, re, uuid
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qsl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

SCOPES = {
    "juridico": {"label": "Minutas padrão", "edit_min_lvl": 7},
    "locacao":  {"label": "Minutas e fichas · Locação", "edit_min_lvl": 5},
}
MAXN, MAXURL, MAXCAT, MAXOBS = 120, 1000, 60, 500

# Categorias-base (editáveis pelo sócio; viram a lista inicial se nunca configurada).
DEFAULT_CATS = {
    "juridico": ['Compra e venda', 'Locação', 'Permuta', 'Distrato', 'Procuração', 'Aditivo',
                 'Confissão de dívida', 'Notificação', 'Parceria', 'Outros'],
    "locacao": ['Contrato de locação', 'Ficha cadastral', 'Vistoria', 'Renovação', 'Rescisão',
                'Garantia / Fiador', 'Termo de entrega', 'Notificação', 'Outros'],
}


def _key(scope):
    return f"minutas:{scope}"


def _read_val(sb, scope):
    """Devolve (items, categorias|None) do shared_kv."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", _key(scope)).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    if not isinstance(val, dict):
        val = {}
    items = val.get("items") if isinstance(val.get("items"), list) else []
    cats = val.get("categorias") if isinstance(val.get("categorias"), list) else None
    return items, cats


def _read(sb, scope):
    return _read_val(sb, scope)[0]


def _cats(sb, scope):
    cats = _read_val(sb, scope)[1]
    return cats if cats is not None else list(DEFAULT_CATS.get(scope, []))


def _write(sb, scope, items, cats=None):
    if cats is None:
        cats = _read_val(sb, scope)[1]
        if cats is None:
            cats = list(DEFAULT_CATS.get(scope, []))
    sb.table("shared_kv").upsert({
        "key": _key(scope), "value": {"items": items, "categorias": cats},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key").execute()


def _valid_url(u):
    return bool(re.match(r"^https?://", (u or "").strip(), re.I))


def _clean(d):
    return (str(d.get("nome") or "").strip()[:MAXN],
            str(d.get("url") or "").strip()[:MAXURL],
            str(d.get("categoria") or "").strip()[:MAXCAT],
            str(d.get("obs") or "").strip()[:MAXOBS])


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _qscope(self):
        q = dict(parse_qsl(urlparse(self.path).query))
        sc = (q.get("scope") or "").strip()
        return sc if sc in SCOPES else None

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        scope = self._qscope()
        if not scope:
            return self._send(400, {"ok": False, "error": "scope inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        items = _read(sb, scope)
        can_edit = (user.get("lvl") or 0) >= SCOPES[scope]["edit_min_lvl"]
        return self._send(200, {"ok": True, "scope": scope, "label": SCOPES[scope]["label"],
                                "items": items, "categorias": _cats(sb, scope), "can_edit": can_edit})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        scope = (body.get("scope") or self._qscope() or "").strip()
        if scope not in SCOPES:
            return self._send(400, {"ok": False, "error": "scope inválido"})
        try:
            actor = require_user(self, min_lvl=SCOPES[scope]["edit_min_lvl"])
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        items = _read(sb, scope)
        action = (body.get("action") or "").strip()

        if action == "add":
            nome, url, cat, obs = _clean(body.get("item") or {})
            if not nome:
                return self._send(400, {"ok": False, "error": "Nome é obrigatório"})
            if not _valid_url(url):
                return self._send(400, {"ok": False, "error": "Link inválido — use a URL do Google Drive (http/https)"})
            items.append({"id": uuid.uuid4().hex[:12], "nome": nome, "categoria": cat, "url": url, "obs": obs,
                          "created_at": datetime.now(timezone.utc).isoformat(), "created_by": actor.get("name")})
        elif action == "update":
            iid = body.get("id")
            nome, url, cat, obs = _clean(body.get("item") or {})
            if not nome:
                return self._send(400, {"ok": False, "error": "Nome é obrigatório"})
            if not _valid_url(url):
                return self._send(400, {"ok": False, "error": "Link inválido — use a URL do Google Drive (http/https)"})
            hit = next((it for it in items if it.get("id") == iid), None)
            if not hit:
                return self._send(404, {"ok": False, "error": "item não encontrado"})
            hit.update({"nome": nome, "categoria": cat, "url": url, "obs": obs,
                        "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": actor.get("name")})
        elif action == "delete":
            iid = body.get("id")
            items = [it for it in items if it.get("id") != iid]
        elif action == "reorder":
            order = body.get("order") or []
            pos = {iid: i for i, iid in enumerate(order)}
            items.sort(key=lambda it: pos.get(it.get("id"), 9999))
        elif action == "set_cats":
            # Lista de categorias personalizável + cascade de renomeação nos itens.
            raw = body.get("categorias") or []
            seen, cats = set(), []
            for c in raw:
                c = str(c or "").strip()[:MAXCAT]
                if c and c.lower() not in seen:
                    seen.add(c.lower()); cats.append(c)
            renames = body.get("renames") or {}
            if isinstance(renames, dict):
                for it in items:
                    novo = renames.get(it.get("categoria"))
                    if novo:
                        it["categoria"] = str(novo).strip()[:MAXCAT]
            try:
                _write(sb, scope, items, cats)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "minutas.set_cats", target_type="shared_kv", target_id=_key(scope))
            return self._send(200, {"ok": True, "scope": scope, "items": items, "categorias": cats})
        else:
            return self._send(400, {"ok": False, "error": "ação inválida"})

        try:
            _write(sb, scope, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"minutas.{action}", target_type="shared_kv", target_id=_key(scope))
        return self._send(200, {"ok": True, "scope": scope, "items": items, "categorias": _cats(sb, scope)})
