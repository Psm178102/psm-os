"""
GET /api/v3/intel/sales_brain[?team=&corretor_id=&lookback=120]
Header: Authorization: Bearer <token>   (Líder lvl>=5)

CÉREBRO DE VENDAS — inteligência preditiva sobre o pipeline real (RD):
  • Lead scoring (0-100) de cada negócio ABERTO + probabilidade calibrada
    (prior por etapa × taxa real do canal × recência × engajamento) + próxima
    melhor ação.
  • Clusterização dos motivos de PERDA (financiamento/preço/local/sumiu/...).
  • Forecast ponderado por pipeline (valor esperado) + run-rate vs meta.
  • Visão por corretor: leads quentes, parados, sem 1º contato.

Tudo DADO REAL. Probabilidade é heurística transparente (não ML treinado) —
o front rotula como estimativa calibrada. A narrativa estratégica é gerada
sob demanda pelo Opus 4.8 via /api/ai-analysis (camada no front).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _oo_lib import parse_dt, amount, meta_for_period  # type: ignore
from _brain_lib import (channel_winrates, score_open, loss_clusters,  # type: ignore
                        forecast, MS_PRIOR)


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

    # ── fetchers ──────────────────────────────────────────────────────────
    _COLS = ("id,amount,win,closed_at,created_at_rd,updated_at_rd,"
             "stage_name,user_id,user_email,rd_raw,pipeline_id,stage_id")

    def _fetch_open(self, sb):
        out, page, size = [], 0, 1000
        while page < 30:
            try:
                rows = (sb.table("deals").select(self._COLS)
                        .is_("win", "null")
                        .range(page * size, page * size + size - 1).execute().data or [])
            except Exception:
                break
            out.extend(rows)
            if len(rows) < size:
                break
            page += 1
        return out

    def _fetch_closed(self, sb, since_iso):
        out, page, size = [], 0, 1000
        while page < 30:
            try:
                rows = (sb.table("deals").select(self._COLS)
                        .gte("closed_at", since_iso)
                        .range(page * size, page * size + size - 1).execute().data or [])
            except Exception:
                break
            out.extend(rows)
            if len(rows) < size:
                break
            page += 1
        return out

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        now = datetime.now(timezone.utc)
        today = now.date()
        try:
            lookback = max(30, min(365, int(params.get("lookback") or 120)))
        except Exception:
            lookback = 120
        since_lb = (today - timedelta(days=lookback)).isoformat() + "T00:00:00+00:00"
        month_start = today.replace(day=1)

        # Usuários (corretor/líder ativos) — pra atribuir e filtrar
        try:
            users = (sb.table("users").select("id,name,email,role,team,ini,color,status")
                     .execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})
        team_f = (params.get("team") or "").strip().lower()
        only_id = (params.get("corretor_id") or "").strip()
        email_to_id = {(u.get("email") or "").lower(): u.get("id") for u in users if u.get("email")}
        user_by_id = {u.get("id"): u for u in users}

        # Deals
        open_deals = self._fetch_open(sb)
        closed = self._fetch_closed(sb, since_lb)
        closed_lost = [d for d in closed if d.get("win") is False]

        # Taxa REAL por canal (base do scoring)
        overall_wr, ch_wr, ch_n = channel_winrates(closed)

        # Score de cada lead aberto, atribuído ao dono
        def owner_of(d):
            return d.get("user_id") or email_to_id.get((d.get("user_email") or "").lower())

        scored_all = []      # todos os leads pontuados (com dono)
        by_owner = defaultdict(list)
        for d in open_deals:
            oid = owner_of(d)
            s = score_open(d, overall_wr, ch_wr, ch_n, now)
            if not s:
                continue
            s["owner_id"] = oid
            u = user_by_id.get(oid) or {}
            s["owner_name"] = u.get("name") or "—"
            s["owner_ini"] = u.get("ini")
            s["owner_color"] = u.get("color")
            s["team"] = u.get("team")
            scored_all.append(s)
            if oid:
                by_owner[oid].append(s)

        # Metas mensais (VGV) da empresa = soma por corretor (mês corrente)
        try:
            all_metas = sb.table("metas").select("*").execute().data or []
        except Exception:
            all_metas = []

        # Realizado do mês (vendas ganhas com closed_at no mês corrente)
        wins_month_vgv, wins_month_n = 0.0, 0
        for d in closed:
            if d.get("win") is True:
                cl = parse_dt(d.get("closed_at"))
                if cl and cl.date() >= month_start:
                    wins_month_vgv += amount(d)
                    wins_month_n += 1

        # ── Visão por corretor ──
        people = [u for u in users
                  if ((u.get("role") or "").lower().startswith("corretor") or (u.get("role") or "").lower() == "lider")
                  and (u.get("status") or "ativo") == "ativo"
                  and (not team_f or (u.get("team") or "").lower() == team_f)
                  and (not only_id or u.get("id") == only_id)]
        meta_total_vgv = 0.0
        corretores = []
        for u in people:
            cid = u.get("id")
            mine = sorted(by_owner.get(cid, []), key=lambda x: -x["score"])
            mp = meta_for_period(all_metas, cid, month_start, today)
            meta_total_vgv += (mp.get("meta_vgv") or 0)
            quentes = [s for s in mine if s["temp"] == "quente"]
            mornos = [s for s in mine if s["temp"] == "morno"]
            frios = [s for s in mine if s["temp"] == "frio"]
            sem_contato = [s for s in mine if s["ms"] == 0 and (s["dias_parado"] or 0) > 2]
            parados = [s for s in mine if (s["dias_parado"] or 0) > 14]
            corretores.append({
                "id": cid, "name": u.get("name"), "role": u.get("role"),
                "team": u.get("team"), "ini": u.get("ini"), "color": u.get("color"),
                "open_count": len(mine),
                "quentes": len(quentes), "mornos": len(mornos), "frios": len(frios),
                "sem_contato_48h": len(sem_contato),
                "parados_14d": len(parados),
                "pipeline_ponderado_vgv": round(sum(s["expected_vgv"] for s in mine), 2),
                "pipeline_quente_vgv": round(sum(s["expected_vgv"] for s in quentes), 2),
                "top_leads": mine[:6],
                "meta_vgv_mes": mp.get("meta_vgv") or 0,
            })
        # ordena: quem tem mais leads quentes + maior pipeline primeiro
        corretores.sort(key=lambda c: (-(c["quentes"]), -c["pipeline_ponderado_vgv"]))

        # ── Board global: leads mais prioritários (atacar primeiro) ──
        top_priority = sorted(scored_all, key=lambda s: -s["score"])[:20]
        # ação mais urgente (1º contato / reativar) — pra mesa de prioridade
        urgentes = sorted(
            [s for s in scored_all
             if (s["ms"] == 0 and (s["dias_parado"] or 0) > 2)
             or (s["dias_parado"] or 0) > 21],
            key=lambda s: -(s["dias_parado"] or 0))[:20]

        fc = forecast(scored_all, wins_month_vgv, wins_month_n, today, meta_total_vgv)

        # ── Distribuição por temperatura + por etapa (resumo) ──
        temp_dist = {"quente": 0, "morno": 0, "frio": 0}
        ms_dist = defaultdict(lambda: {"n": 0, "expected_vgv": 0.0})
        for s in scored_all:
            temp_dist[s["temp"]] += 1
            md = ms_dist[s["ms_label"]]
            md["n"] += 1
            md["expected_vgv"] += s["expected_vgv"]
        etapas = [{"etapa": k, "n": v["n"], "expected_vgv": round(v["expected_vgv"], 2)}
                  for k, v in sorted(ms_dist.items(), key=lambda x: -x[1]["n"])]

        loss = loss_clusters(closed_lost)

        return self._send(200, {
            "ok": True,
            "summary": {
                "open_total": len(scored_all),
                "quentes": temp_dist["quente"], "mornos": temp_dist["morno"], "frios": temp_dist["frio"],
                "pipeline_ponderado_vgv": fc["pipeline_ponderado_vgv"],
                "pipeline_quente_vgv": fc["pipeline_quente_vgv"],
                "closed_analisados": len(closed),
                "perdas_analisadas": len(closed_lost),
                "lookback_dias": lookback,
            },
            "forecast": fc,
            "winrate": {
                "overall_pct": round(overall_wr * 100, 2),
                "por_canal": sorted(
                    [{"canal": CHANNEL_LABEL_SAFE(k), "wr_pct": round(v * 100, 2), "n": ch_n.get(k, 0)}
                     for k, v in ch_wr.items() if ch_n.get(k, 0) >= 3],
                    key=lambda x: -x["wr_pct"]),
            },
            "temperatura": temp_dist,
            "etapas": etapas,
            "top_priority": top_priority,
            "urgentes": urgentes,
            "corretores": corretores,
            "loss": loss,
            "model": {
                "tipo": "heuristica_calibrada",
                "priors_etapa": MS_PRIOR,
                "nota": ("Probabilidade = prior da etapa × taxa real do canal × "
                         "recência × engajamento. Estimativa calibrada, não modelo treinado."),
            },
            "fetched_at": now.isoformat(),
        })


# CHANNEL_LABEL pode não ter a chave; helper seguro (import tardio p/ evitar ciclo)
def CHANNEL_LABEL_SAFE(k):
    try:
        from _oo_lib import CHANNEL_LABEL  # type: ignore
        return CHANNEL_LABEL.get(k, k)
    except Exception:
        return k
