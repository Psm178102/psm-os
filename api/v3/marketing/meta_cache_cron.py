"""
GET /api/v3/marketing/meta_cache_cron
  Auth: Authorization: Bearer <CRON_SECRET>  OU  ?key=<CRON_SECRET>

Pré-aquece o cache compartilhado de Meta Ads (tabela meta_ads_cache). Roda pelo
Vercel Cron a cada ~10min. Pra cada preset do dashboard, busca FRESCO no
/api/meta-ads (nocache=1) e grava o JSON pronto no Postgres. Assim todos os
logins leem do cache quente (rápido, sem bater na Graph API cada um).

Idempotente — pode rodar quantas vezes quiser; só atualiza as linhas.

Resp: { ok, warmed:[{preset, ok, accounts, age?}], errors:[], duration_s }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, audit  # type: ignore
from _meta_cache_lib import (  # type: ignore
    WARM_PRESETS, build_cache_key, fetch_live, write_cache,
)


def _authorized(headers, path):
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and auth[7:].strip() == secret:
        return True
    try:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))
        return q.get("key") == secret
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        if not _authorized(self.headers, self.path):
            return self._send(401, {"ok": False, "error": "CRON_SECRET ausente/inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        host = self.headers.get("Host") or "www.housepsm.com.br"
        t0 = time.time()
        warmed = []
        errors = []

        for preset in WARM_PRESETS:
            payload, err = fetch_live(host, preset, "", "", nocache=True)
            if err or not isinstance(payload, dict):
                errors.append({"preset": preset, "error": err or "payload inválido"})
                warmed.append({"preset": preset, "ok": False})
                continue
            # Só cacheia respostas inteiras (sem conta quebrada), igual ao Node:
            # evita servir estado parcial pra todo mundo.
            if payload.get("errors"):
                errors.append({"preset": preset, "error": "resposta parcial — não cacheada"})
                warmed.append({"preset": preset, "ok": False, "partial": True})
                continue
            key = build_cache_key(preset, "", "")
            ok = write_cache(sb, key, preset, "", "", payload, source="cron")
            warmed.append({
                "preset": preset,
                "ok": ok,
                "accounts": len(payload.get("accounts") or []),
            })

        dur = round(time.time() - t0, 2)
        audit(self, None, "marketing.meta_cache_cron", target_type="meta_ads_cache",
              target_id="*", notes="warmed=%d errors=%d %ss" % (
                  sum(1 for w in warmed if w.get("ok")), len(errors), dur))
        return self._send(200, {
            "ok": len(errors) == 0,
            "warmed": warmed,
            "errors": errors,
            "duration_s": dur,
            "ran_at": datetime.now(timezone.utc).isoformat(),
        })
