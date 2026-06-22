"""
GET/POST /api/v3/arena/tv_config — Config do Modo TV (shared_kv 'tv_config'). v81.9

Deixa o gestor escolher, sem mexer em código: quais painéis giram (e em que ordem),
o tempo de cada painel e os marcos de VGV que disparam celebração.

GET  (qualquer autenticado): { ok, config, can_edit }
POST (lvl >= 5): { config } → salva (valida painéis conhecidos / limites)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "tv_config"
PAINEIS_VALIDOS = ["placar", "ritmo", "ranking", "destaques", "funil", "hoje", "arena"]
DEFAULT = {
    "paineis": ["placar", "ritmo", "ranking", "destaques", "funil", "hoje", "arena"],
    "rotacao_s": 15,
    "marcos": [1000000, 5000000, 10000000, 17000000],
}


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
    except Exception:
        v = {}
    if not isinstance(v, dict):
        v = {}
    paineis = [p for p in (v.get("paineis") or DEFAULT["paineis"]) if p in PAINEIS_VALIDOS]
    if not paineis:
        paineis = DEFAULT["paineis"][:]
    try:
        rot = int(v.get("rotacao_s") or DEFAULT["rotacao_s"])
    except Exception:
        rot = DEFAULT["rotacao_s"]
    rot = max(6, min(120, rot))
    marcos = sorted({int(x) for x in (v.get("marcos") or DEFAULT["marcos"]) if str(x).strip().isdigit() or isinstance(x, (int, float))}) \
        if v.get("marcos") is not None else DEFAULT["marcos"][:]
    if not marcos:
        marcos = DEFAULT["marcos"][:]
    return {"paineis": paineis, "rotacao_s": rot, "marcos": marcos}


def _write(sb, cfg):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": cfg,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            return self._send(200, {"ok": True, "config": _read(sb),
                                    "can_edit": (user.get("lvl") or 0) >= 5,
                                    "paineis_validos": PAINEIS_VALIDOS})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cfg_in = body.get("config") or {}
        # normaliza pelo mesmo caminho do _read (defensivo)
        paineis = [p for p in (cfg_in.get("paineis") or []) if p in PAINEIS_VALIDOS]
        if not paineis:
            return self._send(400, {"ok": False, "error": "selecione ao menos um painel"})
        try:
            rot = max(6, min(120, int(cfg_in.get("rotacao_s") or 15)))
        except Exception:
            rot = 15
        marcos = sorted({int(x) for x in (cfg_in.get("marcos") or DEFAULT["marcos"]) if isinstance(x, (int, float))})
        cfg = {"paineis": paineis, "rotacao_s": rot, "marcos": marcos or DEFAULT["marcos"][:]}
        try:
            sb = supabase_client()
            _write(sb, cfg)
            audit(self, actor, "tv_config.save", target_type="kv", target_id=KV_KEY)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "config": cfg})
