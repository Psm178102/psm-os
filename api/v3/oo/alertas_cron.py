"""
GET /api/v3/oo/alertas_cron — sentinela HORÁRIA da Gestão Comercial (v86.38).

Pedido do Paulo (17/ago): a régua de alerta rodava só quando alguém ABRIA o
painel — se ninguém abrisse num dia ruim, ninguém era avisado. Este cron roda
de 1h em 1h e:
  1. calcula (ou reusa o cache de ≤55min) o payload da janela padrão (90d);
  2. dispara as notificações de métrica fora da régua (dedupe DIÁRIO por
     métrica continua — checagem horária, aviso 1×/dia, sem spam);
  3. grava o snapshot mensal de spend POR EQUIPE (shared_kv gc_spend_mensal)
     — é o que constrói o histórico de CAC por equipe daqui pra frente
     (retroativo é impossível: a Meta não guarda split mensal por conta).

Auth: Bearer CRON_SECRET ou lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from simulador import _kv_read, _kv_write  # type: ignore
from comercial import handler as gc, _hoje, CACHE_VER  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):
            try:
                require_user(self, min_lvl=7)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        hoje = _hoje()
        until_d = hoje
        since_d = hoje - timedelta(days=89)
        spend_preset = "this_month"

        # mesmo cache da página (CACHE_VER importado — bump lá invalida aqui junto)
        ck = f"{CACHE_VER}_cache:{since_d}:{until_d}:{spend_preset}"
        payload = None
        cached, _ok = _kv_read(sb, ck)
        if cached and cached.get("ts"):
            try:
                idade = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["ts"])).total_seconds()
                if idade < 3300:   # 55min — o cron da próxima hora recalcula
                    payload = cached.get("data")
            except Exception:
                payload = None
        recalculado = payload is None
        if payload is None:
            payload = gc._compute(None, sb, since_d, until_d, hoje, spend_preset)
            _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(), "data": payload})

        # 🚨 notifica (dedupe diário por métrica dentro do próprio helper)
        n_alertas = len(((payload.get("alertas") or {}).get("itens")) or [])
        try:
            gc._notifica_alertas(None, sb, payload.get("alertas") or {}, hoje)
        except Exception as e:
            print(f"[gc cron] falha notificar: {e}")

        # 💾 snapshot mensal de spend por equipe (sobrescreve a cada hora; o
        # valor do fim do mês fica congelado quando o mês vira)
        ym = f"{hoje.year:04d}-{hoje.month:02d}"
        try:
            snap = _kv_read(sb, "gc_spend_mensal")[0] or {}
            snap[ym] = {**{c["team"]: c.get("spend") for c in ((payload.get("custos") or {}).get("equipes") or [])},
                        "_ts": datetime.now(timezone.utc).isoformat()}
            _kv_write(sb, "gc_spend_mensal", snap)
        except Exception as e:
            print(f"[gc cron] falha snapshot spend: {e}")

        return self._send(200, {"ok": True, "recalculado": recalculado,
                                "alertas_ativos": n_alertas, "snapshot": ym,
                                "janela": {"since": since_d.isoformat(), "until": until_d.isoformat()}})
