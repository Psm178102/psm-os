"""
GET/POST /api/v3/settings/menu_labels — Rótulos do menu/páginas editáveis pelo sócio. v77.62

O sócio (lvl>=10, ex.: Paulo) pode renomear qualquer item do menu lateral e o título
da página correspondente. Os overrides valem para TODOS os usuários (a barra renderiza
com o nome custom). Guarda tudo em shared_kv key 'menu_labels'.

GET  (qualquer autenticado): retorna {ok, labels:{ "<chave>": "<rótulo>", ... }}.
     chave = rota (ex.: "/captacoes") para itens do menu, ou "sec:<texto padrão>" para
     títulos de seção (ex.: "sec:🏛 Diretoria").
POST (lvl>=10): substitui o mapa inteiro pelo enviado (vazios são removidos). Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "menu_labels"
MAX_LEN = 60  # rótulo de menu não deve ser gigante


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _clean(patch):
    """Normaliza: chaves/valores string, corta tamanho, remove vazios."""
    out = {}
    for k, v in (patch or {}).items():
        if not isinstance(k, str):
            continue
        if v is None:
            continue
        s = str(v).strip()[:MAX_LEN]
        if not s:
            continue  # vazio = volta pro padrão (não persiste override)
        out[k.strip()[:80]] = s
    return out


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
        try: require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, {"ok": True, "labels": _read(sb)})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=10)  # só sócio renomeia o menu
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        patch = body.get("labels") if isinstance(body.get("labels"), dict) else body
        labels = _clean(patch)
        try:
            sb.table("shared_kv").upsert({
                "key": KV_KEY, "value": labels,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "menu_labels.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "labels": labels})
