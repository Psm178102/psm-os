# -*- coding: utf-8 -*-
"""
GET /api/v3/psmhub/financeiro — 💵 FINANCEIRO do PSM HUB pela ponte. v84.97

O Hub (Equipe Conquista) ganhou módulo financeiro; o Paulo quer esses dados
dentro do Financeiro do House. Descoberta pela tela do próprio Hub (30/07):
a página /financeiro chama GET /api/financeiro (+ /api/sales/vendors).

Auth: lvl>=7 (mesma alçada do restante da ponte). Login do serviço via
_psmhub_lib (credencial SÓ no Vercel). Cache leve de 10min em shared_kv
(payload compartilhado entre instâncias) — ?nocache=1 força ao vivo.
Se o usuário de serviço não tiver a permissão 'Financeiro' no Hub, o Hub
devolve 401/403 — a resposta aqui explica exatamente o que liberar lá.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.error
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
import _psmhub_lib as hub  # type: ignore

KV_CACHE = "psmhub_financeiro_cache"
TTL_S = 600


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        if not hub.configured():
            return self._send(503, {"ok": False, "error": "ponte PSM HUB sem credenciais (PSMHUB_EMAIL/PASSWORD no Vercel)"})
        sb = supabase_client()
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        nocache = q.get("nocache") == "1"

        # cache compartilhado 10min (financeiro não muda a cada segundo; poupa o Hub)
        if sb and not nocache:
            try:
                rows = sb.table("shared_kv").select("value,updated_at").eq("key", KV_CACHE).limit(1).execute().data or []
                if rows:
                    v = rows[0].get("value") or {}
                    ts = v.get("_cached_at")
                    if ts:
                        idade = (datetime.now(timezone.utc) - datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).total_seconds()
                        if idade < TTL_S:
                            v["cache"] = {"hit": True, "age_s": int(idade)}
                            return self._send(200, v)
            except Exception:
                pass

        out = {"ok": True, "_cached_at": datetime.now(timezone.utc).isoformat()}
        try:
            out["financeiro"] = hub.get("/api/financeiro")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return self._send(200, {"ok": False, "sem_permissao": True,
                                        "error": "O usuário de serviço da ponte não tem a permissão 'Financeiro' no PSM HUB. "
                                                 "Abra o Hub → Configurações → permissões do usuário integracao@ e libere o menu Financeiro."})
            return self._send(502, {"ok": False, "error": f"Hub respondeu HTTP {e.code} em /api/financeiro"})
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"ponte: {str(e)[:180]}"})
        try:
            out["vendors"] = hub.get("/api/sales/vendors")
        except Exception:
            out["vendors"] = None   # best-effort (a tela do Hub usa pra nomes)

        if sb:
            try:
                sb.table("shared_kv").upsert({"key": KV_CACHE, "value": out,
                                              "updated_at": datetime.now(timezone.utc).isoformat()},
                                             on_conflict="key").execute()
            except Exception:
                pass
        out["cache"] = {"hit": False}
        return self._send(200, out)
