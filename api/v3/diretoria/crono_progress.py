# -*- coding: utf-8 -*-
"""
GET /api/v3/diretoria/crono_progress — 📈 progresso REAL dos itens do Cronograma. v84.96

Pedido do Paulo: metas/objetivos do kanban de Estratégia "linkados com o progresso
de várias outras coisas nutridas em outras fontes do House". Cada item pode apontar
uma FONTE + um ALVO; aqui a gente mede o realizado direto na origem e devolve o %.

Fontes v1 (todas de dados que JÁ existem no sistema; período = mês/ano CORRENTE):
  vgv_mes              → R$ ganhos no mês (deals win, closed_at no mês)
  vgv_ano              → R$ ganhos no ano
  corretores_conquista → corretores Conquista ATIVOS (users)
  corretores_total     → corretores ativos de todas as frentes
  captacoes_mes        → captações criadas no mês
  leads_lp_mes         → leads da LP recebidos no mês
  recebiveis_mes       → R$ marcados como RECEBIDOS no mês (radar)
Cada fonte é best-effort: falhou a consulta → item volta sem número (o card avisa),
nunca derruba o quadro. Auth: lvl>=7 (mesma alçada da Estratégia).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

BRT = timezone(timedelta(hours=-3))


def _kv_board(sb):
    try:
        rows = sb.table("estrategia_boards").select("data").eq("board", "cronograma").limit(1).execute().data or []
        v = rows[0]["data"] if rows else {}
        return v.get("items") if isinstance(v, dict) else None
    except Exception:
        return None


def _mes_ini(now):
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _fontes(sb):
    """Calcula cada fonte 1x (mesmo que vários itens usem). Falha → None."""
    now = datetime.now(BRT)
    out = {}
    mes_ini = _mes_ini(now).astimezone(timezone.utc).isoformat()
    ano_ini = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    try:
        ds = (sb.table("deals").select("amount,closed_at").eq("win", True)
              .gte("closed_at", ano_ini).limit(5000).execute().data or [])
        out["vgv_ano"] = sum(float(d.get("amount") or 0) for d in ds)
        out["vgv_mes"] = sum(float(d.get("amount") or 0) for d in ds if str(d.get("closed_at") or "") >= mes_ini)
    except Exception:
        out["vgv_ano"] = out["vgv_mes"] = None
    try:
        us = sb.table("users").select("role,status").execute().data or []
        ativos = [u for u in us if (u.get("status") or "ativo") == "ativo"]
        out["corretores_conquista"] = sum(1 for u in ativos if (u.get("role") or "") == "corretor_conquista")
        out["corretores_total"] = sum(1 for u in ativos if (u.get("role") or "").startswith("corretor"))
    except Exception:
        out["corretores_conquista"] = out["corretores_total"] = None
    try:
        cs = sb.table("captacoes").select("id,created_at").gte("created_at", mes_ini).limit(2000).execute().data or []
        out["captacoes_mes"] = len(cs)
    except Exception:
        out["captacoes_mes"] = None
    try:
        ls = sb.table("leads_lp").select("id").gte("ts_recebido", mes_ini).limit(5000).execute().data or []
        out["leads_lp_mes"] = len(ls)
    except Exception:
        out["leads_lp_mes"] = None
    try:
        rs = (sb.table("recebiveis").select("valor_liquido_estimado,status,atualizado_em")
              .eq("status", "recebido").gte("atualizado_em", mes_ini).limit(2000).execute().data or [])
        out["recebiveis_mes"] = sum(float(r.get("valor_liquido_estimado") or 0) for r in rs)
    except Exception:
        out["recebiveis_mes"] = None
    return out


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
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        items = _kv_board(sb)
        if not isinstance(items, list):
            return self._send(200, {"ok": True, "progresso": {}})
        com_fonte = [i for i in items if isinstance(i, dict) and i.get("fonte")]
        if not com_fonte:
            return self._send(200, {"ok": True, "progresso": {}})
        vals = _fontes(sb)
        prog = {}
        for i in com_fonte:
            fonte = i.get("fonte")
            real = vals.get(fonte)
            try:
                alvo = float(i.get("alvo") or 0)
            except Exception:
                alvo = 0
            if real is None or alvo <= 0:
                prog[i["id"]] = {"fonte": fonte, "real": real, "alvo": alvo or None, "pct": None}
                continue
            prog[i["id"]] = {"fonte": fonte, "real": real, "alvo": alvo,
                             "pct": max(0, min(100, round(100.0 * float(real) / alvo)))}
        return self._send(200, {"ok": True, "progresso": prog})
