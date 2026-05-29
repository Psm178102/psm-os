"""
GET /api/v3/marketing/summary[?date_preset=last_30d|since=YYYY-MM-DD&until=YYYY-MM-DD][&nocache=1]
Header: Authorization: Bearer <token>

Wrapper autenticado pro /api/meta-ads (já em prod). Requer Líder (lvl>=5).

Escala p/ vários logins (Sprint 9.12): lê primeiro do cache COMPARTILHADO no
Postgres (meta_ads_cache, pré-aquecido pelo meta_cache_cron a cada ~10min), que
é o mesmo pra todas as instâncias/usuários. Só cai pro fetch live se o cache
estiver velho/ausente — e nesse caso faz write-through pra aquecer pros próximos.
?nocache=1 força ignorar o cache (e re-aquece).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _meta_cache_lib import build_cache_key, read_cache, write_cache, fetch_live, is_cacheable  # type: ignore

# Quão velho o cache pode estar e ainda ser servido. O cron aquece a cada ~10min;
# 15min dá folga pra um cron atrasado sem servir dado obsoleto.
CACHE_MAX_AGE_S = 15 * 60


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        host = self.headers.get("Host") or "www.housepsm.com.br"
        preset = params.get("date_preset") or ("" if (params.get("since") and params.get("until")) else "last_30d")
        since = params.get("since") or ""
        until = params.get("until") or ""
        nocache = bool(params.get("nocache"))
        key = build_cache_key(preset, since, until)

        sb = supabase_client()

        # 1) Cache compartilhado (Postgres) — rápido e igual pra todos os logins.
        if sb and not nocache:
            payload, age_s, csource = read_cache(sb, key, CACHE_MAX_AGE_S)
            if payload:
                payload["v3_scope"] = "team" if (user.get("lvl") or 0) >= 5 else "self"
                payload["v3_user_lvl"] = user.get("lvl")
                payload["cache"] = {"hit": True, "age_s": age_s, "source": csource, "shared": True}
                return self._send(200, payload)

        # 2) Miss/velho → busca live no /api/meta-ads e faz write-through.
        data, err = fetch_live(host, preset, since, until, nocache=nocache)
        if err or not isinstance(data, dict):
            # Último recurso: serve cache vencido se existir (degradação graciosa).
            if sb:
                stale, age_s, csource = read_cache(sb, key, 10 ** 9)
                if stale:
                    stale["v3_scope"] = "team" if (user.get("lvl") or 0) >= 5 else "self"
                    stale["v3_user_lvl"] = user.get("lvl")
                    stale["cache"] = {"hit": True, "age_s": age_s, "source": csource,
                                      "shared": True, "stale": True}
                    return self._send(200, stale)
            return self._send(502, {"ok": False, "error": err or "meta-ads payload inválido"})

        # Aquece o cache se pelo menos uma conta funcionou (parcial é útil e
        # compartilhado; só não cacheia se todas falharam).
        if sb and is_cacheable(data):
            write_cache(sb, key, preset, since, until, data, source="live")

        data["v3_scope"] = "team" if (user.get("lvl") or 0) >= 5 else "self"
        data["v3_user_lvl"] = user.get("lvl")
        data["cache"] = {"hit": False, "source": "live"}
        return self._send(200, data)
