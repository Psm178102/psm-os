"""
GET /api/v3/intel/placar            → 🎯 Placares da Inteligência (lvl 10, cache 1 h; ?fresh=1 recalcula)
GET /api/v3/intel/placar?cron=1     → grava as fotos do dia (projeção) e da semana (notas). Bearer CRON_SECRET.
                                       Idempotente: rodar de novo no mesmo dia/semana não duplica. v89.2

Ver _placar_lib.py: projeção (acerta?), nota dos leads (quentes vendem mais?), decisões (resolvem?)
e qualidade do dado (lead trabalhado ou descartado cedo?).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import traceback
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore
import _placar_lib as PL  # type: ignore

KV = "intel_placares"
TTL_S = 3600


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _cron_ok(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        return bool(secret) and tok == secret

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        hoje = PL.MX.hoje_brt()

        if q.get("cron"):
            if not self._cron_ok():
                try:
                    require_user(self, min_lvl=10)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            out = {}
            for nome, fn in (("projecao", PL.gravar_projecao), ("notas", PL.gravar_notas)):
                try:
                    out.update(fn(sb, hoje))
                except Exception as e:
                    out[nome] = f"erro: {str(e)[:200]}"
                    print(f"[intel/placar] {nome}: {traceback.format_exc()[-600:]}")
            audit(self, None, "intel.placar_cron", target_type="intel_placar", target_id=hoje.isoformat(), notes=json.dumps(out)[:300])
            return self._send(200, {"ok": True, **out})

        try:
            require_user(self, min_lvl=10)   # seção Inteligência = só sócio
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        c = PL.MX._kv_read(sb, KV)
        ts = PL.MX.parse_dt((c or {}).get("_cached_at")) if isinstance(c, dict) else None
        if not q.get("fresh") and ts and (datetime.now(timezone.utc) - ts).total_seconds() < TTL_S:
            return self._send(200, {"ok": True, "cached": True, **c["data"]})
        data = {}
        for nome, fn in (("projecao", PL.placar_projecao), ("notas", PL.placar_notas),
                         ("decisoes", PL.placar_decisoes), ("qualidade", PL.qualidade)):
            try:
                data[nome] = fn(sb, hoje)
            except Exception as e:
                data[nome] = {"status": "erro", "erro": str(e)[:200]}
                print(f"[intel/placar] {nome}: {traceback.format_exc()[-600:]}")
        data["calculado_em"] = datetime.now(timezone.utc).isoformat()
        PL.MX._kv_write(sb, KV, {"_cached_at": data["calculado_em"], "data": data})
        return self._send(200, {"ok": True, "cached": False, **data})
