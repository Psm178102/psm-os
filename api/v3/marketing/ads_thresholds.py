# -*- coding: utf-8 -*-
"""
/api/v3/marketing/ads_thresholds — limiares de alerta do Cockpit Meta Ads. v88.18

Antes ficavam só no localStorage: TV, iPad e desktop mostravam alertas e
semáforo diferentes pra mesma campanha. Agora a regra é da empresa.

GET  (lvl>=3)  → {ok, th: {cpl_conquista, cpl_imoveis, cpl_locacao, freq, ctr, gasto}, updated_by, updated_at}
POST (lvl>=7)  → body {th: {...}} — valida faixas, grava em shared_kv, audit before/after.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "ads_thresholds"
# campo → (mínimo, máximo)
FIELDS = {
    "cpl_conquista": (1, 5000), "cpl_imoveis": (1, 5000), "cpl_locacao": (1, 5000),
    "freq": (0.5, 20), "ctr": (0.01, 20), "gasto": (1, 10000),
}


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        v = rows[0].get("value") if rows else None
        return v if isinstance(v, dict) else None
    except Exception:
        return None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=3)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        v = _read(sb) or {}
        return self._send(200, {"ok": True, "th": v.get("th"), "updated_by": v.get("updated_by"),
                                "updated_at": v.get("updated_at")})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        raw = body.get("th") or {}
        th = {}
        for k, (lo, hi) in FIELDS.items():
            try:
                x = float(raw.get(k))
            except Exception:
                return self._send(422, {"ok": False, "error": f"{k} ausente ou inválido"})
            if not (lo <= x <= hi):
                return self._send(422, {"ok": False, "error": f"{k} fora da faixa ({lo}–{hi})"})
            th[k] = x
        antes = _read(sb)
        novo = {"th": th, "updated_by": user.get("name") or user.get("email") or user.get("id"),
                "updated_at": datetime.now(timezone.utc).isoformat()}
        try:
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": novo,
                                          "updated_at": novo["updated_at"]}, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:150]})
        audit(self, user, "ads_thresholds.update", target_type="shared_kv", target_id=KV_KEY,
              before=antes, after=novo)
        return self._send(200, {"ok": True, **novo})
