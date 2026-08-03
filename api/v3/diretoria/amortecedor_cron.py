# -*- coding: utf-8 -*-
"""
GET /api/v3/diretoria/amortecedor_cron — 🎯 push de segunda do AMORTECEDOR (v2.3).

Regra do Amortecedor (03/08): o que a Conquista não atingir vira meta de venda
própria de Paulo/Isa — recalculada TODA SEGUNDA com o ritmo real. Este cron
(heartbeat semanal, converge na segunda de manhã) manda o número pra diretoria:
"Para fechar o mês no azul, faltam R$ X de VGV próprio ao ritmo atual."
Auth: Bearer CRON_SECRET ou lvl>=8.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify, send_web_push, lvl_of  # type: ignore
from plano_resgate import _kv_get, _real, SEED_V23  # type: ignore


def _fmt(v):
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


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
                require_user(self, min_lvl=8)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        plano = _kv_get(sb) or json.loads(json.dumps(SEED_V23))
        real = _real(sb, plano)
        am = real.get("amortecedor")
        if not am:
            return self._send(200, {"ok": False, "skip": "amortecedor indisponível"})
        emoji = {"verde": "🟢", "amarelo": "🟡", "vermelho": "🔴"}.get(am["semaforo"], "⚪")
        titulo = f"{emoji} Amortecedor da semana: faltam {_fmt(am['falta_proprio'])} de VGV próprio"
        corpo = (f"Pra fechar o mês no azul (conta cheia {_fmt(am['conta_cheia'])}): Conquista projetada "
                 f"{_fmt(am['contrib_conquista_projetada'])} de contribuição · próprio já vendido "
                 f"{_fmt(am['proprio_ja_vendido'])} · ritmo necessário {_fmt(am['regua_proprio_sem'])}/semana. "
                 f"Régua Conquista: {_fmt(am['regua_conquista_sem'])}/semana.")
        ids = []
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            ids = [u["id"] for u in us if (u.get("status") or "ativo") == "ativo" and lvl_of(u.get("role")) >= 8]
            notify(ids, "amortecedor", titulo, corpo, link="#/estrategia")
            send_web_push(ids, titulo, corpo, link="#/estrategia", tag="amortecedor")
        except Exception:
            pass
        return self._send(200, {"ok": True, "amortecedor": am, "notificados": len(ids)})
