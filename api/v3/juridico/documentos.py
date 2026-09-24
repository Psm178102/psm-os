"""
GET/POST /api/v3/juridico/documentos — 📂 DOCUMENTOS PSM (Jurídico). v88.37

Pedido do Paulo (24/set): "dentro de jurídico crie uma aba Documentos PSM — lá vou
deixar separado por documento, pasta e o link do Google Drive".

É um ÍNDICE, não um repositório: o arquivo continua no Google Drive; aqui fica o nome
do documento, a pasta (agrupamento na tela) e o link. Guardado no shared_kv
'juridico_documentos' = {"itens": [{id, documento, pasta, link, obs, atualizado_em, por}]}.

GET                                   (lvl>=2 — quem tem o item no menu lê)
POST {action:'upsert', item:{...}}    (lvl>=8 — sócio/diretor edita)
POST {action:'delete', id}            (lvl>=8)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "juridico_documentos"
MAX_ITENS = 1000
MAX_BYTES = 40_000


def _ler(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
    val = rows[0]["value"] if rows else {}
    if isinstance(val, str):
        val = json.loads(val or "{}")
    itens = (val or {}).get("itens") or []
    return [i for i in itens if isinstance(i, dict) and i.get("id")]


def _gravar(sb, itens):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"itens": itens},
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _txt(v, n):
    return str(v or "").strip()[:n]


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
            me = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            itens = _ler(sb)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "itens": itens, "pode_editar": (me.get("lvl") or 0) >= 8})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=8)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "payload grande demais"})
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            itens = _ler(sb)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        action = body.get("action")
        if action == "delete":
            did = _txt(body.get("id"), 64)
            novos = [i for i in itens if i.get("id") != did]
            if len(novos) == len(itens):
                return self._send(404, {"ok": False, "error": "documento não encontrado"})
            _gravar(sb, novos)
            audit(self, actor, "juridico_documentos.delete", target_type="shared_kv", target_id=did)
            return self._send(200, {"ok": True, "itens": novos})

        if action != "upsert":
            return self._send(400, {"ok": False, "error": "action inválida"})
        it = body.get("item") or {}
        doc = _txt(it.get("documento"), 200)
        link = _txt(it.get("link"), 1000)
        if not doc:
            return self._send(400, {"ok": False, "error": "informe o nome do documento"})
        if link and not link.lower().startswith(("https://", "http://")):
            return self._send(400, {"ok": False, "error": "o link precisa começar com https://"})
        novo = {
            "id": _txt(it.get("id"), 64) or uuid.uuid4().hex[:12],
            "documento": doc,
            "pasta": _txt(it.get("pasta"), 120) or "Geral",
            "link": link,
            "obs": _txt(it.get("obs"), 500),
            "atualizado_em": datetime.now(timezone.utc).isoformat(),
            "por": actor.get("name") or actor.get("id"),
        }
        idx = next((k for k, i in enumerate(itens) if i.get("id") == novo["id"]), None)
        if idx is None:
            if len(itens) >= MAX_ITENS:
                return self._send(400, {"ok": False, "error": f"limite de {MAX_ITENS} documentos"})
            itens.append(novo)
        else:
            itens[idx] = novo
        _gravar(sb, itens)
        audit(self, actor, "juridico_documentos.upsert", target_type="shared_kv", target_id=novo["id"])
        return self._send(200, {"ok": True, "item": novo, "itens": itens})
