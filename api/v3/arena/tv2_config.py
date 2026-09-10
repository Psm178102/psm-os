# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/arena/tv2_config — Config da ARENA TV 2.0 (shared_kv 'arena_tv2_config'). v87.73

A engrenagem da própria TV (ranking-hub) edita: tempo por tela e quais telas
extras giram (e em que ordem). Sem deploy pra calibrar — pedido do Paulo (05/set).
v87.73 (Paulo 10/set): o ranking geral passa 1× por volta — o "vendas volta a
cada N" (vendas_cada) saiu, era ele que duplicava a tela geral. + tela 🗓️ cronograma.

GET  (qualquer autenticado): { ok, config, can_edit }
POST (lvl >= 5): { config } → valida e salva; todas as TVs pegam no próximo poll.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "arena_tv2_config"
TELAS_VALIDAS = ["recado", "duelo", "doc", "aten", "prosp", "placar", "cronograma", "corrida", "premiacoes", "criativos"]
DEFAULT = {
    "slide_s": 20,
    "telas": ["recado", "duelo", "doc", "aten", "prosp", "placar", "cronograma", "corrida", "premiacoes"],
    # v87.36: sócios NUNCA na TV pública (Paulo, 05/set) — vale pra TODOS os
    # rankings/placar (o HUB não sabe quem é sócio; o filtro é por 1º nome).
    # v87.75 (Paulo 10/set): + a conta genérica "comercial" e a Yara.
    "ocultar_nomes": ["Isabella", "Paulo", "Comercial", "Yara"],
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
    ocultar = v.get("ocultar_nomes")
    if not isinstance(ocultar, list):
        ocultar = DEFAULT["ocultar_nomes"][:]
    ocultar = [str(x).strip()[:40] for x in ocultar if str(x).strip()][:20]
    return {"slide_s": slide, "telas": telas, "ocultar_nomes": ocultar}


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
              notes=f"slide {cfg['slide_s']}s · {len(cfg['telas'])} telas")
        return self._send(200, {"ok": True, "config": cfg})
