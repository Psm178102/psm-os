"""
📊 GESTÃO COMERCIAL (v86.19) — o painel que responde as perguntas sem clareza:
qual fonte converte mais visita/pasta/venda · custo por etapa do funil (R$/lead,
R$/agendamento, R$/visita, R$/pasta, CAC mídia e CAC completo) · quantas
pastas/visitas/atendimentos/leads pra 1 venda (equipe E corretor) · ticket por
corretor/equipe · real × projetado × meta · safras e tempos de esteira.

FONTES (decisão do Paulo, 14/ago):
  • Conquista → esteira do PSM HUB (vendas/VGV oficiais da equipe) com o RD CRM
    como base do funil (leads/agendamentos/visitas/pastas por evento real).
  • MAP → funil RD MAP espelhado (mesma régua do simulador do 1:1).
  • "Qualificado" começa no AGENDAMENTO (funil de custo: lead → agendamento →
    visita → pasta → venda). CAC nos DOIS níveis: mídia e completo (mídia +
    custo fixo orçado da linha).
  • Fontes analisadas por SAFRA de lead (coorte criada na janela, seguida até
    hoje) — visão instantânea mente com jornada de meses.

GATE: lvl>=5 (líder/gerente/sócio). Produtividade individual: lvl<10 vê SÓ a
própria equipe. Cache compartilhado 10min por janela (cálculo pesado).
"""
from http.server import BaseHTTPRequestHandler
import json
import math
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _oo_lib import (  # type: ignore
    deal_max_milestone, channel, CHANNEL_LABEL, source, parse_dt, amount,
    build_stage_maps, read_meta_accounts, match_team_account, read_team_account_override,
)
from simulador import (  # type: ignore
    _dividir_funil, _marcos_monotonicos, _VENDA_RE, pois_faixa, _kv_read, _kv_write,
)
import _psmhub_lib as hub  # type: ignore

TEAMS = [("conquista", "🏠 Conquista"), ("map", "🏢 MAP"),
         ("terceiros", "🤝 Terceiros"), ("locacao", "🔑 Locação")]
LINHA_DA_EQUIPE = {"conquista": "conquista", "map": "map", "terceiros": "terceiros", "locacao": "locacoes"}
MIN_LEADS_RANK = 30   # amostra mínima pra fonte entrar no pódio
MIN_VENDAS_RANK = 3


def team_key(team):
    t = (team or "").strip().lower()
    if "conquista" in t:
        return "conquista"
    if "map" in t:
        return "map"
    if "tercei" in t:
        return "terceiros"
    if "loca" in t:
        return "locacao"
    return "outros"


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _hoje():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


# ─── marcos por etapa REAL de cada funil (mesma régua do simulador) ─────────
def mapa_marcos(sb):
    """{stage_id: marco 0..5} e {(pid, position): marco} — venda é SEMPRE o win
    do deal (marco 6), nunca lane; por isso clamp em 5."""
    try:
        stages_rows = sb.table("rd_stages").select("*").execute().data or []
        pipes_rows = sb.table("rd_pipelines").select("*").execute().data or []
    except Exception:
        return {}, {}
    pos_by_id, by_pipe, _names = build_stage_maps(stages_rows, pipes_rows)
    marco_sid, marco_pos = {}, {}
    for pid, stages in by_pipe.items():
        if len(stages) < 2:
            continue
        chain, cauda = _dividir_funil(stages)
        # nó de ganho sintético só pra régua monotônica fechar (descartado depois)
        tem_venda = bool(_VENDA_RE.search(chain[-1][1] or ""))
        base = chain + ([] if tem_venda else [(chain[-1][0] + 1, "💰 Ganho (win)")])
        marcos = _marcos_monotonicos(base)
        for i, (pos, _nm) in enumerate(chain):
            marco_pos[(str(pid), pos)] = min(5, marcos[i])
        for pos, _nm in cauda:                       # lanes de base = entrada
            marco_pos[(str(pid), pos)] = 0
    for sid, (pid, pos) in pos_by_id.items():
        marco_sid[str(sid)] = marco_pos.get((str(pid), pos), None)
    return marco_sid, marco_pos


def marco_do_deal(d, evs, marco_sid, marco_pos):
    """Marco máximo alcançado (0..6): win=6; senão máx(etapa atual, eventos),
    traduzido pela régua espelhada do funil do deal; fallback = régua canônica."""
    if d.get("win") is True:
        return 6
    sid = str(d.get("stage_id") or "")
    pid = str(d.get("pipeline_id") or "")
    mx = marco_sid.get(sid)
    conhecido = mx is not None
    mx = mx or 0
    for ev in (evs or []):
        if isinstance(ev[0], int):
            m = marco_pos.get((pid, ev[0]))
            if m is not None:
                conhecido = True
                mx = max(mx, m)
    if not conhecido:
        mx = deal_max_milestone(d, evs or [])
        if mx >= 6 and d.get("win") is not True:
            mx = 5
    return mx


# ─── HUB: esteira da Conquista (vendas/VGV oficiais) ────────────────────────
def hub_esteira_mes(sb, y, m):
    if not hub.configured():
        return None, "ponte HUB sem credenciais"
    try:
        est = hub.get(f"/api/dashboard/esteira?period=mensal&month={m}&year={y}")
        return est, None
    except Exception as e:
        return None, str(e)[:120]


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

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        hoje = _hoje()
        try:
            until_d = date.fromisoformat(q["until"]) if q.get("until") else hoje
            since_d = date.fromisoformat(q["since"]) if q.get("since") else (until_d - timedelta(days=89))
        except Exception:
            return self._send(400, {"ok": False, "error": "since/until inválidos (YYYY-MM-DD)"})

        # cache compartilhado 10min por janela (cálculo caro; permissão filtra DEPOIS)
        ck = f"gc_cache:{since_d}:{until_d}"
        payload = None
        cached, _ok = _kv_read(sb, ck)
        if cached and cached.get("ts"):
            try:
                idade = (datetime.now(timezone.utc) - parse_dt(cached["ts"])).total_seconds()
                if idade < 600 and q.get("fresh") != "1":
                    payload = cached.get("data")
            except Exception:
                payload = None
        if payload is None:
            payload = self._compute(sb, since_d, until_d, hoje)
            _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(), "data": payload})

        # 🔒 individual: lvl<10 vê só a própria equipe
        lvl = user.get("lvl") or 0
        if lvl < 10:
            minha = team_key(user.get("team"))
            prod = payload.get("produtividade") or {}
            payload = {**payload, "produtividade": {
                "corretores": [c for c in (prod.get("corretores") or []) if c.get("team") == minha],
                "equipes": prod.get("equipes"),
                "restrito_a": minha}}
        return self._send(200, {"ok": True, **payload,
                                "janela": {"since": since_d.isoformat(), "until": until_d.isoformat()},
                                "viewer_lvl": lvl})

    # ═══════════════ o cálculo pesado (1× por janela a cada 10min) ═══════════════
    def _compute(self, sb, since_d, until_d, hoje):
        avisos = []
        since_dt = datetime(since_d.year, since_d.month, since_d.day, tzinfo=timezone.utc)
        until_dt = datetime(until_d.year, until_d.month, until_d.day, 23, 59, 59, tzinfo=timezone.utc)
        mes_ini = date(hoje.year, hoje.month, 1)

        users = {str(u["id"]): u for u in (sb.table("users").select("id,name,email,role,team,status").execute().data or []) if u.get("id")}
        email2uid = {(u.get("email") or "").lower(): uid for uid, u in users.items() if u.get("email")}
        marco_sid, marco_pos = mapa_marcos(sb)

        # ── deals da SAFRA (criados em [since-180d, until] p/ safras + coorte) ──
        safra_ini = since_d - timedelta(days=120)   # safras de até ~6m antes do fim
        cols = "id,name,amount,win,closed_at,created_at_rd,stage_id,pipeline_id,user_id,user_email,rd_raw"
        deals, pg = [], 0
        while True:
            ch = (sb.table("deals").select(cols)
                  .gte("created_at_rd", f"{safra_ini}T00:00:00+00:00").order("id")
                  .range(pg * 1000, pg * 1000 + 999).execute().data or [])
            deals.extend(ch)
            if len(ch) < 1000 or pg >= 25:
                break
            pg += 1
        # vendas do mês corrente (podem ter sido criadas antes da safra)
        wins_mes = (sb.table("deals").select(cols).eq("win", True)
                    .gte("closed_at", f"{mes_ini}T00:00:00+00:00").limit(1000).execute().data or [])
        vistos = {str(d.get("id")) for d in deals}
        for d in wins_mes:
            if str(d.get("id")) not in vistos:
                deals.append(d)

        # eventos (marcos + tempos) — em blocos
        ev_map = {}
        ids = [str(d.get("id")) for d in deals if d.get("id")]
        for i in range(0, len(ids), 150):
            try:
                rows = (sb.table("deal_stage_events")
                        .select("deal_id,stage_position,occurred_at")
                        .in_("deal_id", ids[i:i + 150]).neq("source", "backfill").execute().data or [])
            except Exception:
                rows = []
            for r in rows:
                ev_map.setdefault(str(r.get("deal_id")), []).append((r.get("stage_position"), "", parse_dt(r.get("occurred_at"))))

        def uid_do(d):
            u = str(d.get("user_id") or "")
            if u in users:
                return u
            return email2uid.get((d.get("user_email") or "").lower(), "")

        # ── enriquecimento por deal ──
        eds = []
        for d in deals:
            uid = uid_do(d)
            u = users.get(uid) or {}
            evs = ev_map.get(str(d.get("id"))) or []
            pid = str(d.get("pipeline_id") or "")
            # 1ª vez em cada marco (tempos): pelo occurred_at dos eventos
            t_marco = {}
            for ev in evs:
                m = marco_pos.get((pid, ev[0])) if isinstance(ev[0], int) else None
                if m is not None and ev[2] and (m not in t_marco or ev[2] < t_marco[m]):
                    t_marco[m] = ev[2]
            eds.append({
                "created": parse_dt(d.get("created_at_rd")),
                "closed": parse_dt(d.get("closed_at")),
                "win": d.get("win") is True,
                "vgv": amount(d),
                "canal": channel(source(d.get("rd_raw") or {})),
                "team": team_key(u.get("team")),
                "uid": uid, "nome": u.get("name") or d.get("user_email") or "?",
                "marco": marco_do_deal(d, evs, marco_sid, marco_pos),
                "t_marco": t_marco,
            })

        na_janela = [e for e in eds if e["created"] and since_dt <= e["created"] <= until_dt]

        # ── B) FONTES & FUNIL (coorte da janela, por canal × equipe) ──
        def agrega_fontes(pool):
            out = {}
            for e in pool:
                c = out.setdefault(e["canal"], {"leads": 0, "agend": 0, "visita": 0, "pasta": 0, "venda": 0, "vgv": 0.0})
                c["leads"] += 1
                if e["marco"] >= 2: c["agend"] += 1
                if e["marco"] >= 3: c["visita"] += 1
                if e["marco"] >= 5: c["pasta"] += 1
                if e["win"]:
                    c["venda"] += 1
                    c["vgv"] += e["vgv"]
            res = []
            for k, c in sorted(out.items(), key=lambda x: -x[1]["leads"]):
                pc = lambda a, b: round(a / b * 100, 1) if b else None
                res.append({"canal": k, "label": CHANNEL_LABEL.get(k, k), **{kk: (round(vv, 2) if kk == "vgv" else vv) for kk, vv in c.items()},
                            "pc_visita": pc(c["visita"], c["leads"]), "pc_pasta": pc(c["pasta"], c["leads"]),
                            "pc_venda": pc(c["venda"], c["leads"]),
                            "rankeavel": c["leads"] >= MIN_LEADS_RANK,
                            "rankeavel_venda": c["leads"] >= MIN_LEADS_RANK and c["venda"] >= MIN_VENDAS_RANK})
            return res

        fontes = {"geral": agrega_fontes(na_janela)}
        for tk, _lbl in TEAMS:
            pool = [e for e in na_janela if e["team"] == tk]
            if pool:
                fontes[tk] = agrega_fontes(pool)

        def podio(lista, campo, flag):
            cand = [f for f in lista if f.get(flag)]
            return sorted(cand, key=lambda f: -(f.get(campo) or 0))[:3]
        fontes["podio"] = {"visita": podio(fontes["geral"], "pc_visita", "rankeavel"),
                           "pasta": podio(fontes["geral"], "pc_pasta", "rankeavel"),
                           "venda": podio(fontes["geral"], "pc_venda", "rankeavel_venda")}

        # ── D) PRODUTIVIDADE (coorte da janela, corretor × equipe) ──
        por_corr = {}
        for e in na_janela:
            if not e["uid"]:
                continue
            c = por_corr.setdefault(e["uid"], {"nome": e["nome"], "team": e["team"], "leads": 0, "atend": 0,
                                               "agend": 0, "visita": 0, "pasta": 0, "venda": 0, "vgv": 0.0})
            c["leads"] += 1
            if e["marco"] >= 1: c["atend"] += 1
            if e["marco"] >= 2: c["agend"] += 1
            if e["marco"] >= 3: c["visita"] += 1
            if e["marco"] >= 5: c["pasta"] += 1
            if e["win"]:
                c["venda"] += 1
                c["vgv"] += e["vgv"]

        def razoes(c):
            v = c["venda"]
            rz = lambda x: round(x / v, 1) if v else None
            return {"leads_por_venda": rz(c["leads"]), "atend_por_venda": rz(c["atend"]),
                    "visitas_por_venda": rz(c["visita"]), "pastas_por_venda": rz(c["pasta"]),
                    "ticket": round(c["vgv"] / v, 2) if v else None}
        corretores = [{"uid": uid, **c, "vgv": round(c["vgv"], 2), **razoes(c)}
                      for uid, c in por_corr.items() if c["team"] != "outros" or c["venda"] > 0]
        corretores.sort(key=lambda x: (-x["venda"], -x["vgv"]))
        equipes_prod = {}
        for tk, _l in TEAMS:
            pool = [e for e in na_janela if e["team"] == tk]
            agg = {"leads": len(pool), "atend": sum(1 for e in pool if e["marco"] >= 1),
                   "agend": sum(1 for e in pool if e["marco"] >= 2), "visita": sum(1 for e in pool if e["marco"] >= 3),
                   "pasta": sum(1 for e in pool if e["marco"] >= 5), "venda": sum(1 for e in pool if e["win"]),
                   "vgv": round(sum(e["vgv"] for e in pool if e["win"]), 2)}
            equipes_prod[tk] = {**agg, **razoes(agg)}

        # ── C) CUSTO DO FUNIL (mês corrente: spend ÷ atividade DO MÊS) ──
        _ma = read_meta_accounts(sb, preset="this_month") or read_meta_accounts(sb)
        _ovr = read_team_account_override(sb)
        orcado = _kv_read(sb, "viab_custos_orcado")[0] or {}
        itens_orc = (orcado.get(str(hoje.year)) or {}).get("itens") or []
        custos = []
        mes_pool = [e for e in eds if e["created"] and e["created"].date() >= mes_ini]
        for tk, lbl in TEAMS:
            acc = match_team_account((_ma or {}).get("accounts") or [], tk, _ovr) if _ma else None
            spend = _num(acc.get("spend")) if acc else 0.0
            pool = [e for e in mes_pool if e["team"] == tk]
            leads = len(pool)
            agend = sum(1 for e in eds if e["team"] == tk and e["t_marco"].get(2) and e["t_marco"][2].date() >= mes_ini)
            visita = sum(1 for e in eds if e["team"] == tk and e["t_marco"].get(3) and e["t_marco"][3].date() >= mes_ini)
            pasta = sum(1 for e in eds if e["team"] == tk and e["t_marco"].get(5) and e["t_marco"][5].date() >= mes_ini)
            vendas = sum(1 for e in eds if e["team"] == tk and e["win"] and e["closed"] and e["closed"].date() >= mes_ini)
            vgv = sum(e["vgv"] for e in eds if e["team"] == tk and e["win"] and e["closed"] and e["closed"].date() >= mes_ini)
            # custo fixo orçado da LINHA no mês (mesma leitura da Viabilidade:
            # ignora classe variável, respeita valor por_mes quando existir)
            fixo = 0.0
            for it in itens_orc:
                if (it.get("linha") or "") != LINHA_DA_EQUIPE.get(tk):
                    continue
                if (it.get("classe") or "fixo") == "variavel":
                    continue
                pm = it.get("por_mes") or {}
                v = pm.get(str(hoje.month), pm.get(hoje.month))
                fixo += _num(v) if v not in (None, "") else _num(it.get("valor"))
            div = lambda a, b: round(a / b, 2) if b else None
            custos.append({"team": tk, "label": lbl, "spend": round(spend, 2), "fixo_mes": round(fixo, 2),
                           "conta": acc.get("label") if acc else None,
                           "leads": leads, "agend": agend, "visita": visita, "pasta": pasta, "vendas": vendas,
                           "custo_lead": div(spend, leads), "custo_agend": div(spend, agend),
                           "custo_visita": div(spend, visita), "custo_pasta": div(spend, pasta),
                           "cac_midia": div(spend, vendas), "cac_completo": div(spend + fixo, vendas),
                           "roas": div(vgv * 0.04, spend) if spend else None})

        # ── A) VISÃO GERAL (real mês × meta × projetado do Norte) ──
        visao = []
        ym = f"{hoje.year:04d}-{hoje.month:02d}"
        for tk, lbl in TEAMS:
            membros = [uid for uid, u in users.items()
                       if team_key(u.get("team")) == tk and (u.get("status") or "ativo") == "ativo"]
            meta_v = meta_vgv = proj_v = 0.0
            com_meta = 0
            for uid in membros:
                cfg, _okc = _kv_read(sb, f"oo_norte:{uid}:{ym}")
                if not cfg:
                    continue
                com_meta += 1
                mv = _num((cfg.get("metas_etapas") or {}).get("venda"))
                meta_v += mv
                meta_vgv += mv * _num(cfg.get("ticket_medio"))
                at = _num(cfg.get("atendimentos_mes"))
                for cn in (cfg.get("canais") or []):
                    proj_v += (at * _num(cn.get("mix")) / 100.0) * (_num(cn.get("taxa_base")) * _num(cn.get("energia")) / 100.0) / 100.0
            reais = [e for e in eds if e["team"] == tk and e["win"] and e["closed"] and e["closed"].date() >= mes_ini]
            rv, rvgv = len(reais), round(sum(e["vgv"] for e in reais), 2)
            visao.append({"team": tk, "label": lbl, "real_vendas": rv, "real_vgv": rvgv,
                          "real_ticket": round(rvgv / rv, 2) if rv else None,
                          "meta_vendas": round(meta_v, 1), "meta_vgv": round(meta_vgv, 2),
                          "proj_vendas": round(proj_v, 2), "corretores_com_meta": com_meta,
                          "poisson": pois_faixa(meta_v) if meta_v > 0 else None})

        # Conquista: vendas oficiais da esteira do HUB (cruzamento RD × HUB)
        hub_x, hub_err = None, None
        est, hub_err = hub_esteira_mes(sb, hoje.year, hoje.month)
        if isinstance(est, (list, dict)):
            try:
                rows = est if isinstance(est, list) else (est.get("esteira") or est.get("rows") or est.get("data") or [])
                tv = tvgv = 0
                for r in rows if isinstance(rows, list) else []:
                    tv += int(_num(r.get("vendas") or r.get("sales") or r.get("qtd")))
                    tvgv += _num(r.get("vgv") or r.get("total"))
                hub_x = {"vendas": tv, "vgv": round(tvgv, 2)}
            except Exception:
                hub_x = None
        if hub_err:
            avisos.append(f"esteira HUB indisponível ({hub_err}) — Conquista mostrando só o RD")

        # ── E) SAFRAS (mês de criação × resultado até hoje) ──
        safras = {}
        for e in eds:
            if not e["created"]:
                continue
            ymc = e["created"].strftime("%Y-%m")
            if ymc < safra_ini.strftime("%Y-%m"):
                continue
            s = safras.setdefault(ymc, {"leads": 0, "vendas": 0, "vgv": 0.0, "dias": []})
            s["leads"] += 1
            if e["win"]:
                s["vendas"] += 1
                s["vgv"] += e["vgv"]
                if e["closed"]:
                    s["dias"].append((e["closed"] - e["created"]).days)
        safras_out = [{"ym": k, "leads": v["leads"], "vendas": v["vendas"], "vgv": round(v["vgv"], 2),
                       "pc": round(v["vendas"] / v["leads"] * 100, 2) if v["leads"] else None,
                       "dias_medio": round(sum(v["dias"]) / len(v["dias"])) if v["dias"] else None}
                      for k, v in sorted(safras.items())]

        # ── F) TEMPOS entre marcos (mediana de dias, por equipe) ──
        tempos = {}
        PASSOS = [(0, 2, "lead→agendamento"), (2, 3, "agendamento→visita"), (3, 5, "visita→pasta")]
        for tk, _l in TEAMS:
            linhas = []
            for a, b, nome in PASSOS:
                ds = []
                for e in na_janela:
                    if e["team"] != tk:
                        continue
                    ta = e["created"] if a == 0 else e["t_marco"].get(a)
                    tb = e["t_marco"].get(b)
                    if ta and tb and tb >= ta:
                        ds.append((tb - ta).days)
                ds.sort()
                linhas.append({"passo": nome, "mediana_dias": ds[len(ds) // 2] if ds else None, "n": len(ds)})
            # pasta→venda: da 1ª vez no marco 5 até o closed do win
            ds = sorted((e["closed"] - e["t_marco"][5]).days for e in na_janela
                        if e["team"] == tk and e["win"] and e["closed"] and e["t_marco"].get(5) and e["closed"] >= e["t_marco"][5])
            linhas.append({"passo": "pasta→venda", "mediana_dias": ds[len(ds) // 2] if ds else None, "n": len(ds)})
            tempos[tk] = linhas

        cobertura = round(sum(1 for e in na_janela if e["canal"] not in ("nao_atribuido",)) / len(na_janela) * 100, 1) if na_janela else None

        return {"visao": visao, "hub_conquista": hub_x, "fontes": fontes,
                "custos": {"mes": ym, "equipes": custos,
                           "nota": "spend Meta this_month por conta da equipe ÷ atividade real do mês; CAC completo soma o custo fixo orçado da linha"},
                "produtividade": {"corretores": corretores, "equipes": equipes_prod},
                "safras": safras_out, "tempos": tempos,
                "cobertura_origem_pct": cobertura, "avisos": avisos,
                "coorte_n": len(na_janela),
                "fetched_at": datetime.now(timezone.utc).isoformat()}
