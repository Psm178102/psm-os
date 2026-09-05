# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/arena/tv2_config — Config da ARENA TV 2.0 (shared_kv 'arena_tv2_config'). v87.25

A engrenagem da própria TV (ranking-hub) edita: tempo por tela, de quantas em
quantas telas o ranking de vendas volta, e quais telas extras giram (e em que
ordem). Sem deploy pra calibrar — pedido do Paulo (05/set).

GET  (qualquer autenticado): { ok, config, can_edit }
POST (lvl >= 5): { config } → valida e salva; todas as TVs pegam no próximo poll.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "arena_tv2_config"
TELAS_VALIDAS = ["recado", "duelo", "doc", "aten", "prosp", "corrida", "premiacoes", "placar", "criativos"]
DEFAULT = {
    "slide_s": 20,
    "vendas_cada": 5,   # ranking de vendas volta a cada N telas extras
    "telas": ["recado", "duelo", "doc", "aten", "prosp", "corrida", "premiacoes", "placar"],
    # v87.36: sócios NUNCA na TV pública (Paulo, 05/set) — vale pra TODOS os
    # rankings/placar (o HUB não sabe quem é sócio; o filtro é por 1º nome).
    "ocultar_nomes": ["Isabella", "Paulo"],
}


def _norm(v):
    if not isinstance(v, dict):
        v = {}
    telas = [t for t in (v.get("telas") or DEFAULT["telas"]) if t in TELAS_VALIDAS]
    # remove duplicatas preservando ordem
    telas = list(dict.fromkeys(telas)) or DEFAULT["telas"][:]
    try:
        slide = int(v.get("slide_s") or DEFAULT["slide_s"])
    except Exception:
        slide = DEFAULT["slide_s"]
    slide = max(8, min(120, slide))
    try:
        cada = int(v.get("vendas_cada") or DEFAULT["vendas_cada"])
    except Exception:
        cada = DEFAULT["vendas_cada"]
    cada = max(1, min(8, cada))
    ocultar = v.get("ocultar_nomes")
    if not isinstance(ocultar, list):
        ocultar = DEFAULT["ocultar_nomes"][:]
    ocultar = [str(x).strip()[:40] for x in ocultar if str(x).strip()][:20]
    return {"slide_s": slide, "vendas_cada": cada, "telas": telas, "ocultar_nomes": ocultar}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
            v = rows[0]["value"] if rows else {}
            if isinstance(v, str):
                v = json.loads(v)
        except Exception:
            v = {}
        return self._send(200, {"ok": True, "config": _norm(v), "can_edit": (user.get("lvl") or 0) >= 5})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cfg = _norm(body.get("config") or {})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": cfg,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:180]})
        audit(self, user, "arena.tv2_config", target_type="shared_kv", target_id=KV_KEY,
              notes=f"slide {cfg['slide_s']}s · vendas a cada {cfg['vendas_cada']} · {len(cfg['telas'])} telas")
        return self._send(200, {"ok": True, "config": cfg})
