"""
GET/POST /api/v3/settings/conclusao_forms — Campos exigidos ao CONCLUIR cada atividade. v77.90

O sócio define, por TIPO de atividade, quais campos o usuário precisa preencher ao
marcar como concluída no Home (ex.: Criativo publicado → link + número que constou).
Guarda em shared_kv key 'conclusao_forms'. Tipos sem campos = conclusão em 1 clique.

Estrutura: { "<kind>": [ {key,label,type,required,options?}, ... ] }
  kind ∈ criativo|conteudo|captacao|tarefa|plantao ; type ∈ text|url|number|textarea|select

GET  (qualquer autenticado): {ok, forms, kinds}  (semeia os padrões na 1ª vez).
POST (lvl>=7 diretoria): salva o mapa inteiro. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "conclusao_forms"
# rótulos dos tipos de atividade que admitem formulário de conclusão (pro editor)
KINDS = {"criativo": "🎨 Criativo", "conteudo": "🎬 Conteúdo", "captacao": "📥 Captação",
         "tarefa": "📋 Tarefa", "plantao": "🛡 Plantão"}
TYPES = ("text", "url", "number", "textarea", "select")

DEFAULTS = {
    "criativo": [
        {"key": "link", "label": "Link do material publicado", "type": "url", "required": True},
        {"key": "numero", "label": "Número que constou na arte", "type": "text", "required": True},
        {"key": "obs", "label": "Observação / print", "type": "text", "required": False},
    ],
    "conteudo": [
        {"key": "link", "label": "Link do post publicado", "type": "url", "required": True},
        {"key": "obs", "label": "Observação", "type": "text", "required": False},
    ],
    "captacao": [
        {"key": "desfecho", "label": "Desfecho", "type": "select", "options": ["Captada", "Perdida"], "required": True},
        {"key": "obs", "label": "Observação", "type": "textarea", "required": False},
    ],
}


def read_forms(sb):
    """Lê os forms salvos; se vazio, devolve os DEFAULTS. Usado aqui e no conclude.py."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else None
        if isinstance(val, str):
            val = json.loads(val)
        if isinstance(val, dict) and val:
            return val
    except Exception:
        pass
    return {k: [dict(f) for f in v] for k, v in DEFAULTS.items()}


def _clean(payload):
    out = {}
    for kind, fields in (payload or {}).items():
        if kind not in KINDS or not isinstance(fields, list):
            continue
        clean = []
        for f in fields[:20]:
            if not isinstance(f, dict):
                continue
            key = str(f.get("key") or "").strip()[:40]
            label = str(f.get("label") or "").strip()[:100]
            typ = f.get("type") if f.get("type") in TYPES else "text"
            if not key or not label:
                continue
            item = {"key": key, "label": label, "type": typ, "required": bool(f.get("required"))}
            if typ == "select":
                opts = [str(o).strip()[:60] for o in (f.get("options") or []) if str(o).strip()][:12]
                item["options"] = opts
            clean.append(item)
        out[kind] = clean
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
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, {"ok": True, "forms": read_forms(sb), "kinds": KINDS, "types": list(TYPES)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
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
        forms = _clean(body.get("forms") if isinstance(body.get("forms"), dict) else body)
        try:
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": forms,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "conclusao_forms.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "forms": forms})
