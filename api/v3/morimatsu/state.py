"""
GET/POST /api/v3/morimatsu/state — estado do módulo 🏯 Morimatsu & Associados. v87.51

Escritório de Gestão Patrimonial Imobiliária (boutique pessoal do Paulo — não é
imobiliária). Tudo vive numa ÚNICA chave do shared_kv, 'morimatsu_state':
  { investidores: [ {id, nome, fone, cidade, objetivo, pagamento, faixa, capital,
                     disp, modalidades[], regiao, ocupacao, origem, caixa, obs,
                     coluna, hist[], criado_em, atualizado_em} ],
    roteiro:      { <item_id>: {done:bool, em:iso} },      # checklist 90 dias
    notas:        "texto livre do sócio" }

SÓ SÓCIO (lvl>=10) — GET e POST. O módulo carrega honorários, tese e funil
de investidor do Paulo; nada disso é pra corretor/gerente. Abrir pra alguém =
baixar aqui E no ROUTE_MIN_LVL do main.js juntos.

GET                  → { ok, state, updated_at }
POST { patch:{...} } → merge de 1º nível (só as chaves acima) → { ok, state }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KEY = "morimatsu_state"
CAMPOS = {"investidores": list, "roteiro": dict, "notas": str}
MAX_BYTES = 400_000
DEFAULT = {"investidores": [], "roteiro": {}, "notas": ""}


def _load(sb):
    try:
        rows = sb.table("shared_kv").select("value,updated_at").eq("key", KEY).limit(1).execute().data or []
    except Exception:
        rows = []
    val = rows[0]["value"] if rows else {}
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except Exception:
            val = {}
    if not isinstance(val, dict):
        val = {}
    st = dict(DEFAULT)
    for k, t in CAMPOS.items():
        v = val.get(k)
        st[k] = v if isinstance(v, t) else DEFAULT[k]
    return st, (rows[0].get("updated_at") if rows else None)


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
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        st, up = _load(sb)
        return self._send(200, {"ok": True, "state": st, "updated_at": up})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "payload grande demais"})
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        patch = body.get("patch")
        if not isinstance(patch, dict) or not patch:
            return self._send(400, {"ok": False, "error": "patch precisa ser um objeto"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        st, _ = _load(sb)
        tocou = []
        for k, t in CAMPOS.items():
            if k in patch:
                if not isinstance(patch[k], t):
                    return self._send(400, {"ok": False, "error": f"{k} com tipo inválido"})
                st[k] = patch[k]; tocou.append(k)
        if not tocou:
            return self._send(400, {"ok": False, "error": "nada pra salvar", "chaves": list(CAMPOS)})
        try:
            sb.table("shared_kv").upsert({"key": KEY, "value": st,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "morimatsu.update", target_type="shared_kv", target_id=KEY)
        return self._send(200, {"ok": True, "state": st, "tocou": tocou})
