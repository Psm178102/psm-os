# -*- coding: utf-8 -*-
"""
GET /api/v3/monitor/uptime — 🩺 SENTINELA (v87.40). Cron do Vercel a cada 5min.

Nasceu do apagão de 05/set/2026: o Postgres do Supabase morreu às 15h30 BRT
com o painel dizendo "healthy" e ninguém soube por HORAS. Este cron roda no
Vercel (domínio de falha separado do Supabase) e checa:
  1. REST do Supabase alcançável (timeout curto)
  2. Query REAL no banco (shared_kv) — pega banco travado/pool saturado
  3. Front estático (version.json no domínio) — pega regressão da public/
Falhou → alerta push via ntfy.sh (independente de banco: funciona no apagão).
Recuperou → manda o "✅ voltou" (transição guardada no shared_kv quando o
banco responde). Durante apagão alerta a CADA rodada (5min) de propósito.

Auth: Bearer CRON_SECRET (padrão dos crons) ou usuário lvl>=7 (teste manual).
Envs opcionais: NTFY_TOPIC (default abaixo), MONITOR_URLS extra.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

NTFY_TOPIC = os.environ.get("NTFY_TOPIC") or "psm-house-alerta-7k3m9x2f"
KV_KEY = "uptime_state"


def _authorized(handler):
    sec = os.environ.get("CRON_SECRET")
    auth = handler.headers.get("Authorization") or ""
    if sec and auth.lower().startswith("bearer ") and auth[7:].strip() == sec:
        return True
    try:
        require_user(handler, min_lvl=7)
        return True
    except AuthError:
        return False


def _http(url, timeout=6, headers=None):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PSM-Sentinela", **(headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, round(time.time() - t0, 2)
    except urllib.error.HTTPError as e:
        return e.code, round(time.time() - t0, 2)          # 401/404 etc = RESPONDEU
    except Exception:
        return 0, round(time.time() - t0, 2)               # timeout/conexão = morto


def _ntfy(titulo, corpo, prioridade="urgent"):
    try:
        req = urllib.request.Request(
            f"https://ntfy.sh/{NTFY_TOPIC}", data=corpo.encode("utf-8"), method="POST",
            headers={"Title": titulo.encode("ascii", "ignore").decode(), "Priority": prioridade, "Tags": "rotating_light"})
        urllib.request.urlopen(req, timeout=8)
        return True
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        if not _authorized(self):
            return self._send(401, {"ok": False, "error": "não autorizado"})
        agora = datetime.now(timezone.utc).isoformat()
        problemas = []

        # 1) gateway REST do Supabase alcançável? (401 sem apikey = vivo)
        su = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
        if su:
            st, dt = _http(su + "/rest/v1/", timeout=6)
            if st == 0:
                problemas.append(f"Supabase REST não responde (timeout {dt}s)")
        # 2) query REAL no banco (pega banco travado com gateway vivo — caso de hoje)
        sb = supabase_client()
        db_ok = False
        try:
            t0 = time.time()
            sb.table("shared_kv").select("key").eq("key", KV_KEY).limit(1).execute()
            db_ok = True
            db_ms = round((time.time() - t0) * 1000)
            if db_ms > 8000:
                problemas.append(f"banco MUITO lento ({db_ms}ms na query de 1 linha)")
        except Exception as e:
            problemas.append(f"banco não responde: {str(e)[:80]}")
        # 3) front estático no domínio (pega regressão public/ = 404 geral)
        st, dt = _http("https://www.housepsm.com.br/version.json", timeout=6)
        if st != 200:
            problemas.append(f"front do domínio quebrado (version.json HTTP {st})")

        # estado anterior (só legível com banco vivo)
        anterior = "ok"
        if db_ok:
            try:
                rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
                anterior = (rows[0]["value"] or {}).get("estado", "ok") if rows else "ok"
            except Exception:
                pass

        estado = "down" if problemas else "ok"
        alertou = False
        if problemas:
            alertou = _ntfy("🚨 House PSM com problema",
                            "Sentinela detectou:\n- " + "\n- ".join(problemas) +
                            f"\n({datetime.now(timezone.utc).strftime('%H:%M')} UTC · repete a cada 5min enquanto durar)")
        elif anterior == "down":
            alertou = _ntfy("✅ House PSM voltou ao normal", "Todos os checks do Sentinela passando de novo.", "default")

        if db_ok:
            try:
                sb.table("shared_kv").upsert({"key": KV_KEY,
                                              "value": {"estado": estado, "quando": agora, "problemas": problemas},
                                              "updated_at": agora}, on_conflict="key").execute()
            except Exception:
                pass
        return self._send(200, {"ok": estado == "ok", "estado": estado, "problemas": problemas,
                                "alerta_enviado": alertou, "ntfy_topic": NTFY_TOPIC, "em": agora})
