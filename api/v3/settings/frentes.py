"""
GET/POST /api/v3/settings/frentes — FONTE ÚNICA das frentes/empresas PSM. v84.0

Mata a duplicação apontada na auditoria (frentes hardcoded em 7 páginas do front
e mapeamento funil→frente em 20+ backends). Tudo passa a ler daqui.

shared_kv 'frentes_config' = [ { id, nome, icon, cor, funis:[...], ativa } ]
  • id     — map | conquista | terceiros | locacoes (fixos; não se cria frente nova aqui)
  • funis  — nomes de pipeline do RD (casefold/contains) que caem nessa frente
  • ativa  — false = frente pausada: o menu esconde as telas dela e os painéis marcam ⏸

GET  (autenticado): { ok, frentes } — sempre devolve as 4, mesclando salvo + default.
POST (sócio lvl>=10): { frentes: [ {id, nome?, icon?, cor?, funis?, ativa?} ] } — merge por id.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "frentes_config"

# default = comportamento histórico do sistema (espelha o mapeamento dos backends)
DEFAULT = [
    {"id": "map",       "nome": "PSM M.A.P",      "icon": "🏢", "cor": "#7c3aed",
     "funis": ["MAP"], "ativa": True},
    {"id": "conquista", "nome": "PSM Conquista",  "icon": "🏠", "cor": "#2563eb",
     "funis": ["CONQUISTA"], "ativa": True},
    {"id": "terceiros", "nome": "PSM Terceiros",  "icon": "🤝", "cor": "#0891b2",
     "funis": ["TERCEIRO"], "ativa": True},
    {"id": "locacoes",  "nome": "PSM Locações",   "icon": "🔑", "cor": "#d97706",
     "funis": ["LOCA"], "ativa": True},
]
IDS = [f["id"] for f in DEFAULT]


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else []
        if isinstance(val, str):
            val = json.loads(val)
        saved = {f.get("id"): f for f in val if isinstance(f, dict) and f.get("id") in IDS} if isinstance(val, list) else {}
    except Exception:
        saved = {}
    out = []
    for d in DEFAULT:
        m = dict(d)
        s = saved.get(d["id"]) or {}
        for k in ("nome", "icon", "cor"):
            if isinstance(s.get(k), str) and s[k].strip():
                m[k] = s[k].strip()[:40]
        if isinstance(s.get("funis"), list):
            fl = [str(x).strip()[:60] for x in s["funis"] if str(x).strip()][:10]
            if fl:
                m["funis"] = fl
        if isinstance(s.get("ativa"), bool):
            m["ativa"] = s["ativa"]
        out.append(m)
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
        return self._send(200, {"ok": True, "frentes": _read(sb)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
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
        incoming = body.get("frentes")
        if not isinstance(incoming, list):
            return self._send(400, {"ok": False, "error": "frentes inválido"})
        cur = {f["id"]: f for f in _read(sb)}
        for it in incoming:
            if not isinstance(it, dict) or it.get("id") not in IDS:
                continue
            f = cur[it["id"]]
            for k in ("nome", "icon", "cor"):
                if isinstance(it.get(k), str) and it[k].strip():
                    f[k] = it[k].strip()[:40]
            if isinstance(it.get("funis"), list):
                fl = [str(x).strip()[:60] for x in it["funis"] if str(x).strip()][:10]
                if fl:
                    f["funis"] = fl
            if isinstance(it.get("ativa"), bool):
                f["ativa"] = it["ativa"]
        val = [cur[i] for i in IDS]
        try:
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": val,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "frentes.update", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "frentes": val})
