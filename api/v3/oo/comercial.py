"""
📊 GESTÃO COMERCIAL (v86.35) — o painel que responde as perguntas sem clareza:
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
from _auth_lib import require_user, AuthError, supabase_client, lvl_of, notify_all  # type: ignore
from _oo_lib import (  # type: ignore
    deal_max_milestone, channel, CHANNEL_LABEL, source, parse_dt, amount,
    build_stage_maps, read_meta_accounts, match_team_account, read_team_account_override,
    read_meta_campaigns, lead_campaign_name, match_campaign_cpl,
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

# 🏷 regra do Paulo (15/ago): lead SEM FONTE e OUTRO são classificados como
# TRÁFEGO PAGO IMOB (o grosso do não-atribuído é o próprio tráfego pago da casa)
CANAL_MERGE = {"nao_atribuido": "trafego_imob", "outro": "trafego_imob", "meta": "trafego_imob"}
CANAL_LBL = {**CHANNEL_LABEL, "trafego_imob": "Tráfego pago Imob"}

FUNIS_RD = {"conquista": "funil conquista", "map": "funil map",
            "terceiros": "funil terceiros", "locacao": "funil de locacao"}

# 👥 v86.35 (decisão do Paulo 17/ago): a Yara CONTA no MAP e também no
# Terceiros — caiu a whitelist excludente de 15/ago. O funil do deal manda na
# equipe; MAP_LOGINS só força isa/rafaela/paulo pro MAP em deal fora dos funis.
MAP_LOGINS = ("isa", "rafaela", "paulo")


def escopo_do(user):
    """Equipe que um gestor lvl<10 pode ver (regra do Paulo 15/ago: gerente
    Conquista SÓ Conquista, MAP só MAP, Locação só Locação, Terceiros só
    Terceiros). Sufixo do papel manda; senão o team do usuário."""
    if (user.get("lvl") or 0) >= 10:
        return None
    r = (user.get("role") or "").lower()
    for tk, _l in TEAMS:
        if tk in r:
            return tk
    return team_de(str(user.get("id") or ""), user.get("team"))


def _podio_de(lista, campo, flag):
    cand = [f for f in (lista or []) if f.get(flag)]
    return sorted(cand, key=lambda f: -(f.get(campo) or 0))[:3]


def filtra_escopo(p, tk):
    """Corta o payload consolidado pra UMA equipe (gerente/líder). Roda DEPOIS
    do cache (o cache guarda o payload completo, só sócio recebe inteiro)."""
    novo = dict(p)
    novo["escopo"] = tk
    novo["visao"] = [v for v in (p.get("visao") or []) if v.get("team") == tk]
    ft = (p.get("fontes") or {}).get(tk) or []
    novo["fontes"] = {"geral": ft, tk: ft,
                      "podio": {"visita": _podio_de(ft, "pc_visita", "rankeavel"),
                                "pasta": _podio_de(ft, "pc_pasta", "rankeavel"),
                                "venda": _podio_de(ft, "pc_venda", "rankeavel_venda")}}
    for chave in ("funil_rd", "forecast", "resposta", "tempos"):
        novo[chave] = {k: v for k, v in (p.get(chave) or {}).items() if k == tk}
    cust = p.get("custos") or {}
    novo["custos"] = {**cust,
                      "equipes": [c for c in (cust.get("equipes") or []) if c.get("team") == tk],
                      "payback_midia": cust.get("payback_midia") if tk == "conquista" else None}
    hist = []
    for h in (p.get("historico") or []):
        eq = (h.get("equipes") or {}).get(tk) or {}
        hist.append({**h, "equipes": {tk: eq}, "canais": {},
                     "total": {**eq, "spend": None, "cpl_global": None, "cac_global": None}})
    novo["historico"] = hist
    cp = p.get("campanhas") or {}
    novo["campanhas"] = {**cp, "itens": [i for i in (cp.get("itens") or []) if tk in (i.get("teams") or [])]}
    novo["safras"] = (p.get("safras_por_equipe") or {}).get(tk) or []
    novo["performance_corretores"] = [c for c in (p.get("performance_corretores") or []) if c.get("team") == tk]
    to = p.get("turnover") or {}
    novo["turnover"] = {**to, "saidas": [x for x in (to.get("saidas") or []) if x.get("team") == tk],
                        "ativos_risco": [x for x in (to.get("ativos_risco") or []) if x.get("team") == tk],
                        "intervalo_medio_dias": None, "dias_desde_ultima": None}
    al = p.get("alertas") or {}
    novo["alertas"] = {**al, "itens": [i for i in (al.get("itens") or []) if i.get("team") == tk]}
    novo["hub_conquista"] = p.get("hub_conquista") if tk == "conquista" else None
    if (p.get("coorte_por_equipe") or {}).get(tk) is not None:
        novo["coorte_n"] = p["coorte_por_equipe"][tk]
    prod = p.get("produtividade") or {}
    novo["produtividade"] = {"corretores": [c for c in (prod.get("corretores") or []) if c.get("team") == tk],
                             "equipes": {k: v for k, v in (prod.get("equipes") or {}).items() if k == tk},
                             "restrito_a": tk}
    return novo


def team_de(uid, team):
    """Equipe efetiva de um usuário pra fins de Gestão Comercial (fallback de
    deal fora dos 4 funis — o funil do deal é quem manda; v86.34/35)."""
    if uid in MAP_LOGINS:
        return "map"
    return team_key(team)


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
    """{stage_id: marco 0..5}, {(pid, position): marco} + mapas crus dos funis —
    venda é SEMPRE o win do deal (marco 6), nunca lane; por isso clamp em 5."""
    try:
        stages_rows = sb.table("rd_stages").select("*").execute().data or []
        pipes_rows = sb.table("rd_pipelines").select("*").execute().data or []
    except Exception:
        return {}, {}, {}, {}, {}
    pos_by_id, by_pipe, pipe_names = build_stage_maps(stages_rows, pipes_rows)
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
    return marco_sid, marco_pos, by_pipe, pos_by_id, pipe_names


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
        # 🎚 período do SPEND por campanha — editável (pedido 15/ago)
        SPEND_PRESETS = ("this_month", "last_7d", "last_14d", "last_30d", "last_month")
        spend_preset = q.get("spend_preset") if q.get("spend_preset") in SPEND_PRESETS else "last_30d"

        # cache compartilhado 10min por janela (cálculo caro; permissão filtra DEPOIS)
        ck = f"gc15_cache:{since_d}:{until_d}:{spend_preset}"   # v86.35: Yara conta MAP+Terceiros, corretor×equipe → chave nova
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
            payload = self._compute(sb, since_d, until_d, hoje, spend_preset)
            _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(), "data": payload})

        # 🚨 métrica fora da régua → notifica gestor da equipe + sócios (v86.33).
        # Só em janela ≥28d (janela curta distorce conversão/tempos) e 1×/dia por métrica.
        try:
            if (until_d - since_d).days >= 27:
                self._notifica_alertas(sb, payload.get("alertas") or {}, hoje)
        except Exception as e:
            print(f"[gc alertas] falha notificar: {e}")

        # 🔒 escopo por gestor (regra 15/ago): gerente/líder lvl<10 vê SOMENTE a
        # própria equipe — em TODAS as abas (visão, fontes, custos, funil,
        # campanhas, histórico, safras, forecast, resposta, produtividade)
        lvl = user.get("lvl") or 0
        if lvl < 10:
            tk = escopo_do(user)
            if tk in dict(TEAMS):
                payload = filtra_escopo(payload, tk)
            else:
                payload = {**payload, "visao": [], "fontes": {}, "funil_rd": {}, "forecast": {},
                           "resposta": {}, "tempos": {}, "custos": {}, "historico": [],
                           "campanhas": {}, "safras": [], "hub_conquista": None,
                           "produtividade": {"corretores": [], "equipes": {}},
                           "avisos": (payload.get("avisos") or []) + ["sua equipe não está mapeada nas frentes — fale com o sócio"]}
        return self._send(200, {"ok": True, **payload,
                                "janela": {"since": since_d.isoformat(), "until": until_d.isoformat()},
                                "viewer_lvl": lvl})

    def _notifica_alertas(self, sb, alertas, hoje):
        """Notificação por alçada (regra da casa: nunca broadcast): sócios (lvl≥10)
        sempre + gestor/gerente (5≤lvl<10) SÓ da equipe da métrica. Dedupe diário
        por métrica via shared_kv gc_alertas_notif:<dia>."""
        itens = (alertas or {}).get("itens") or []
        if not itens:
            return
        ck = f"gc_alertas_notif:{hoje.isoformat()}"
        feito = set((_kv_read(sb, ck)[0] or {}).get("ids") or [])
        novos = [i for i in itens if i["id"] not in feito]
        if not novos:
            return
        rows = sb.table("users").select("id,role,team,status").execute().data or []
        ativos = [u for u in rows if (u.get("status") or "ativo") == "ativo" and u.get("id")]
        socios = [str(u["id"]) for u in ativos if lvl_of(u.get("role") or "") >= 10]
        lbls = dict(TEAMS)
        for it in novos:
            dest = set(socios)
            for u in ativos:
                l = lvl_of(u.get("role") or "")
                if 5 <= l < 10 and team_key(u.get("team")) == it["team"]:
                    dest.add(str(u["id"]))
            seta = "▲" if it.get("acima") else "▼"
            titulo = f"🚨 Métrica fora da régua — {lbls.get(it['team'], it['team'])}"
            corpo = (f"{it['label']}: {it['valor']} ({seta} {abs(it.get('delta_pct') or 0)}% "
                     f"{'acima' if it.get('acima') else 'abaixo'} do limite {it['limite']})")
            notify_all(list(dest), "gc_alerta", titulo, body=corpo, link="#/gestao-comercial")
        _kv_write(sb, ck, {"ids": sorted(feito | {i["id"] for i in novos})})

    # ═══════════════ o cálculo pesado (1× por janela a cada 10min) ═══════════════
    def _compute(self, sb, since_d, until_d, hoje, spend_preset="last_30d"):
        avisos = []
        since_dt = datetime(since_d.year, since_d.month, since_d.day, tzinfo=timezone.utc)
        until_dt = datetime(until_d.year, until_d.month, until_d.day, 23, 59, 59, tzinfo=timezone.utc)
        mes_ini = date(hoje.year, hoje.month, 1)

        users = {str(u["id"]): u for u in (sb.table("users").select("id,name,email,role,team,status").execute().data or []) if u.get("id")}
        email2uid = {(u.get("email") or "").lower(): uid for uid, u in users.items() if u.get("email")}
        marco_sid, marco_pos, by_pipe, pos_by_id, pipe_names = mapa_marcos(sb)

        # 🧭 v86.34 (achado do Paulo 17/ago): a equipe do deal é o FUNIL onde ele
        # vive (MAP e Locação têm funil próprio no RD e estavam zerando na Visão
        # porque a régua antiga era só a equipe do DONO). Pipeline manda; deal
        # fora dos 4 funis cai na régua antiga (equipe do dono + whitelist MAP).
        pipe_team = {}
        for _pid, _nm in pipe_names.items():
            _n = (_nm or "").lower()
            for _tk, _alvo in FUNIS_RD.items():
                if _alvo in _n:
                    pipe_team[str(_pid)] = _tk

        def team_do_deal(pid, uid):
            tk = pipe_team.get(str(pid or ""))
            if tk:
                return tk
            return team_de(uid, (users.get(uid) or {}).get("team"))

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
                "canal": (lambda _c: CANAL_MERGE.get(_c, _c))(channel(source(d.get("rd_raw") or {}))),
                "atribuido": channel(source(d.get("rd_raw") or {})) != "nao_atribuido",
                "camp": lead_campaign_name(d),
                "team": team_do_deal(pid, uid),
                "uid": uid, "nome": u.get("name") or d.get("user_email") or "?",
                "marco": marco_do_deal(d, evs, marco_sid, marco_pos),
                "t_marco": t_marco,
            })

        na_janela = [e for e in eds if e["created"] and since_dt <= e["created"] <= until_dt]
        janela_dias = (until_d - since_d).days + 1

        # ⏱ horas até o 1º contato por deal (formato exato exigido pelo Paulo).
        # HONESTIDADE (achado da auditoria 16/ago): muitos leads NASCEM direto numa
        # etapa de atendimento no RD — o evento inicial tem o timestamp da criação
        # e a mediana virava 00min falso. Só conta MOVIMENTAÇÃO REAL (≥5min após
        # criar); quem nasce na etapa fica fora da conta (não medível por evento).
        def _h_contato(e):
            t1 = e["t_marco"].get(1) or e["t_marco"].get(2)
            if not (t1 and e["created"]):
                return None
            h = (t1 - e["created"]).total_seconds() / 3600.0
            return h if h >= (5.0 / 60.0) else None

        def _mediana(xs):
            xs = sorted(x for x in xs if x is not None)
            return round(xs[len(xs) // 2], 2) if xs else None

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
                res.append({"canal": k, "label": CANAL_LBL.get(k, k), **{kk: (round(vv, 2) if kk == "vgv" else vv) for kk, vv in c.items()},
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
        # v86.35: chave (uid, equipe) — corretor que atua em DOIS funis (ex.:
        # Yara no MAP e no Terceiros) aparece em cada equipe com os números dela lá
        por_corr = {}
        for e in na_janela:
            if not e["uid"]:
                continue
            c = por_corr.setdefault((e["uid"], e["team"]), {"nome": e["nome"], "team": e["team"], "leads": 0, "atend": 0,
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
                    "dias_por_venda": round(janela_dias / v, 1) if v else None,
                    "ticket": round(c["vgv"] / v, 2) if v else None}
        # 🏆 canal campeão por corretor + %% das vendas dele por canal (pedido 15/ago)
        cor_can = {}
        for e in na_janela:
            if not e["uid"]:
                continue
            k = cor_can.setdefault((e["uid"], e["team"]), {}).setdefault(e["canal"], {"leads": 0, "vendas": 0, "vgv": 0.0})
            k["leads"] += 1
            if e["win"]:
                k["vendas"] += 1
                k["vgv"] += e["vgv"]

        def canais_do(chave, tot_vendas):
            out = []
            for ck, k in (cor_can.get(chave) or {}).items():
                conv = round(k["vendas"] / k["leads"] * 100, 1) if k["leads"] else None
                out.append({"canal": ck, "label": CANAL_LBL.get(ck, ck), "leads": k["leads"],
                            "vendas": k["vendas"], "vgv": round(k["vgv"], 2), "conv_pct": conv,
                            "share_vendas_pct": round(k["vendas"] / tot_vendas * 100, 1) if tot_vendas else None})
            out.sort(key=lambda x: (-x["vendas"], -(x["conv_pct"] or 0), -x["leads"]))
            top = None
            cand = [c for c in out if c["vendas"] >= 1 and c["leads"] >= 5]
            if cand:
                top = max(cand, key=lambda x: x["conv_pct"] or 0)["label"]
            elif out and out[0]["vendas"]:
                top = out[0]["label"]
            return out[:8], top

        corretores = []
        for (uid, tk_c), c in por_corr.items():
            if c["team"] == "outros" and not c["venda"]:
                continue
            cls, top = canais_do((uid, tk_c), c["venda"])
            corretores.append({"uid": uid, **c, "vgv": round(c["vgv"], 2), **razoes(c),
                               "contato_h_mediana": _mediana([_h_contato(e) for e in na_janela if e["uid"] == uid and e["team"] == tk_c]),
                               "canais": cls, "top_canal": top})
        corretores.sort(key=lambda x: (-x["venda"], -x["vgv"]))
        equipes_prod = {}
        for tk, _l in TEAMS:
            pool = [e for e in na_janela if e["team"] == tk]
            agg = {"leads": len(pool), "atend": sum(1 for e in pool if e["marco"] >= 1),
                   "agend": sum(1 for e in pool if e["marco"] >= 2), "visita": sum(1 for e in pool if e["marco"] >= 3),
                   "proposta": sum(1 for e in pool if e["marco"] >= 4),
                   "pasta": sum(1 for e in pool if e["marco"] >= 5), "venda": sum(1 for e in pool if e["win"]),
                   "vgv": round(sum(e["vgv"] for e in pool if e["win"]), 2)}
            equipes_prod[tk] = {**agg, **razoes(agg),
                                "contato_h_mediana": _mediana([_h_contato(e) for e in pool])}

        # ── C) CUSTO DO FUNIL (mês corrente: spend ÷ atividade DO MÊS) ──
        _ma = read_meta_accounts(sb, preset="this_month") or read_meta_accounts(sb)
        _ma30 = read_meta_accounts(sb, preset="last_30d") or _ma
        d30 = hoje - timedelta(days=29)
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
            wins_tk = [e for e in eds if e["team"] == tk and e["win"] and e["closed"] and e["closed"].date() >= mes_ini]
            vendas = len(wins_tk)
            vgv = sum(e["vgv"] for e in wins_tk)
            # 🎯 v86.34 (achado do Paulo 17/ago): CAC MÍDIA divide o spend SÓ pelas
            # vendas de origem PAGA (tráfego/google) — venda de indicação/orgânico
            # não pode diluir o custo de mídia. CAC completo segue sobre TODAS.
            PAGO = ("trafego_imob", "google")
            vendas_pagas = sum(1 for e in wins_tk if e["canal"] in PAGO)
            vgv_pago = sum(e["vgv"] for e in wins_tk if e["canal"] in PAGO)
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
            # base 30d: quando o MÊS zera o denominador (ex.: agosto sem venda),
            # o custo cai pra janela de 30 dias em vez de sumir num "—"
            acc30 = match_team_account((_ma30 or {}).get("accounts") or [], tk, _ovr) if _ma30 else None
            spend30 = _num(acc30.get("spend")) if acc30 else spend
            l30 = sum(1 for e in eds if e["team"] == tk and e["created"] and e["created"].date() >= d30)
            a30 = sum(1 for e in eds if e["team"] == tk and e["t_marco"].get(2) and e["t_marco"][2].date() >= d30)
            v30 = sum(1 for e in eds if e["team"] == tk and e["t_marco"].get(3) and e["t_marco"][3].date() >= d30)
            p30 = sum(1 for e in eds if e["team"] == tk and e["t_marco"].get(5) and e["t_marco"][5].date() >= d30)
            wins30 = [e for e in eds if e["team"] == tk and e["win"] and e["closed"] and e["closed"].date() >= d30]
            vd30 = len(wins30)
            vd30_pagas = sum(1 for e in wins30 if e["canal"] in PAGO)
            custos.append({"team": tk, "label": lbl, "spend": round(spend, 2), "fixo_mes": round(fixo, 2),
                           "conta": acc.get("label") if acc else None,
                           "leads": leads, "agend": agend, "visita": visita, "pasta": pasta, "vendas": vendas,
                           "vendas_pagas": vendas_pagas,
                           "custo_lead": div(spend, leads), "custo_agend": div(spend, agend),
                           "custo_visita": div(spend, visita), "custo_pasta": div(spend, pasta),
                           "cac_midia": div(spend, vendas_pagas), "cac_completo": div(spend + fixo, vendas),
                           "custo_lead_30d": div(spend30, l30), "custo_agend_30d": div(spend30, a30),
                           "custo_visita_30d": div(spend30, v30), "custo_pasta_30d": div(spend30, p30),
                           "cac_midia_30d": div(spend30, vd30_pagas), "cac_completo_30d": div(spend30 + fixo, vd30),
                           "vendas_30d": vd30, "vendas_pagas_30d": vd30_pagas,
                           "roas": div(vgv_pago * 0.04, spend) if spend else None})

        # ── deals ABERTOS agora (leve, sem rd_raw): pipeline de HOJE + funil RD ──
        abertos, pg = [], 0
        while True:
            ch = (sb.table("deals").select("id,stage_id,pipeline_id,user_id,user_email")
                  .is_("win", "null").order("id")
                  .range(pg * 1000, pg * 1000 + 999).execute().data or [])
            abertos.extend(ch)
            if len(ch) < 1000 or pg >= 12:
                break
            pg += 1

        # ── A) VISÃO GERAL detalhada (real × projetado ×3 × meta, por equipe E corretor) ──
        import calendar as _cal
        dias_mes = _cal.monthrange(hoje.year, hoje.month)[1]
        visao = []
        ym = f"{hoje.year:04d}-{hoje.month:02d}"
        # 🎯 metas OFICIAIS do painel Metas (decisão do Paulo 15/ago: metas vêm de lá;
        # o Norte segue alimentando só a PROJEÇÃO)
        metas_idx = {}
        try:
            for m_ in (sb.table("metas").select("corretor_id,ano,mes,meta_vgv,meta_vendas").eq("ano", hoje.year).execute().data or []):
                metas_idx[(str(m_.get("corretor_id")), int(m_.get("mes") or 0))] = m_
        except Exception:
            avisos.append("tabela metas indisponível — metas zeradas na Visão")

        reais_mes_uid = {}
        for e in eds:
            if e["win"] and e["closed"] and e["closed"].date() >= mes_ini and e["uid"]:
                r = reais_mes_uid.setdefault(e["uid"], {"v": 0, "vgv": 0.0})
                r["v"] += 1
                r["vgv"] += e["vgv"]
        for tk, lbl in TEAMS:
            membros = [uid for uid, u in users.items()
                       if team_de(uid, u.get("team")) == tk and (u.get("status") or "ativo") == "ativo"]
            meta_v = meta_vgv = proj_v = 0.0
            com_meta = 0
            por_corr_v = []
            for uid in membros:
                mrow = metas_idx.get((uid, hoje.month)) or {}
                mv = _num(mrow.get("meta_vendas"))
                mvgv = _num(mrow.get("meta_vgv"))
                if mv or mvgv:
                    com_meta += 1
                meta_v += mv
                meta_vgv += mvgv
                pu = 0.0
                cfg, _okc = _kv_read(sb, f"oo_norte:{uid}:{ym}")
                if cfg:
                    at = _num(cfg.get("atendimentos_mes"))
                    for cn in (cfg.get("canais") or []):
                        pu += (at * _num(cn.get("mix")) / 100.0) * (_num(cn.get("taxa_base")) * _num(cn.get("energia")) / 100.0) / 100.0
                    proj_v += pu
                ru = reais_mes_uid.get(uid) or {}
                if mv or mvgv or cfg or ru.get("v"):
                    por_corr_v.append({"nome": (users.get(uid) or {}).get("name") or "?",
                                       "real": ru.get("v") or 0, "vgv": round(ru.get("vgv") or 0, 2),
                                       "meta": round(mv, 1), "meta_vgv": round(mvgv, 2), "proj": round(pu, 2)})
            por_corr_v.sort(key=lambda x: (-x["real"], -x["proj"]))
            reais = [e for e in eds if e["team"] == tk and e["win"] and e["closed"] and e["closed"].date() >= mes_ini]
            rv, rvgv = len(reais), round(sum(e["vgv"] for e in reais), 2)
            # projeção por ritmo: vendas até hoje ÷ dias corridos × dias do mês
            run_rate = round(rv / max(1, hoje.day) * dias_mes, 2)
            # pipeline de AGORA: abertos parados em proposta/pasta (marco da etapa atual)
            prop_ab = pasta_ab = vis_ab = 0
            for d in abertos:
                uid = str(d.get("user_id") or "") or email2uid.get((d.get("user_email") or "").lower(), "")
                if team_do_deal(d.get("pipeline_id"), uid) != tk:
                    continue
                m = marco_sid.get(str(d.get("stage_id") or ""))
                if m == 3:
                    vis_ab += 1
                elif m == 4:
                    prop_ab += 1
                elif m == 5:
                    pasta_ab += 1
            visao.append({"team": tk, "label": lbl, "real_vendas": rv, "real_vgv": rvgv,
                          "real_ticket": round(rvgv / rv, 2) if rv else None,
                          "meta_vendas": round(meta_v, 1), "meta_vgv": round(meta_vgv, 2),
                          "proj_vendas": round(proj_v, 2), "proj_ritmo": run_rate,
                          "pipeline_agora": {"visitas": vis_ab, "propostas": prop_ab, "pastas": pasta_ab},
                          "corretores_com_meta": com_meta, "por_corretor": por_corr_v[:15],
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
        safras_eq = {tk: {} for tk, _l in TEAMS}
        for e in eds:
            if not e["created"]:
                continue
            ymc = e["created"].strftime("%Y-%m")
            if ymc < safra_ini.strftime("%Y-%m"):
                continue
            for alvo in (safras, safras_eq.get(e["team"])):
                if alvo is None:
                    continue
                s = alvo.setdefault(ymc, {"leads": 0, "vendas": 0, "vgv": 0.0, "dias": []})
                s["leads"] += 1
                if e["win"]:
                    s["vendas"] += 1
                    s["vgv"] += e["vgv"]
                    if e["closed"]:
                        s["dias"].append((e["closed"] - e["created"]).days)
        def _safra_fmt(d_):
            return [{"ym": k, "leads": v["leads"], "vendas": v["vendas"], "vgv": round(v["vgv"], 2),
                     "pc": round(v["vendas"] / v["leads"] * 100, 2) if v["leads"] else None,
                     "dias_medio": round(sum(v["dias"]) / len(v["dias"])) if v["dias"] else None}
                    for k, v in sorted(d_.items())]
        safras_out = _safra_fmt(safras)
        safras_por_equipe = {tk: _safra_fmt(d_) for tk, d_ in safras_eq.items()}

        # ── F) TEMPOS entre marcos (mediana de dias, por equipe) ──
        tempos = {}
        PASSOS = [(0, 2, "lead→agendamento"), (2, 3, "agendamento→visita"), (3, 5, "visita→pasta")]
        for tk, _l in TEAMS:
            linhas = []
            for a, b, nome in PASSOS:
                hs = []
                for e in na_janela:
                    if e["team"] != tk:
                        continue
                    ta = e["created"] if a == 0 else e["t_marco"].get(a)
                    tb = e["t_marco"].get(b)
                    if ta and tb and tb >= ta:
                        hs.append((tb - ta).total_seconds() / 3600.0)
                hs.sort()
                linhas.append({"passo": nome, "mediana_h": round(hs[len(hs) // 2], 2) if hs else None,
                               "mediana_dias": round(hs[len(hs) // 2] / 24.0, 1) if hs else None, "n": len(hs)})
            # pasta→venda: da 1ª vez no marco 5 até o closed do win
            hs = sorted((e["closed"] - e["t_marco"][5]).total_seconds() / 3600.0 for e in na_janela
                        if e["team"] == tk and e["win"] and e["closed"] and e["t_marco"].get(5) and e["closed"] >= e["t_marco"][5])
            linhas.append({"passo": "pasta→venda", "mediana_h": round(hs[len(hs) // 2], 2) if hs else None,
                           "mediana_dias": round(hs[len(hs) // 2] / 24.0, 1) if hs else None, "n": len(hs)})
            tempos[tk] = linhas

        # ── G) HISTÓRICO DO ANO (fetch leve, sem rd_raw): mês a mês, real ──
        jan1 = date(hoje.year, 1, 1)
        hist_deals, seen_h = [], set()
        # ds:rd_raw->deal_source = SÓ a origem (leve — o Paulo tem razão: dá pra
        # ter histórico por fonte olhando a data de conversão + origem de cada deal)
        for filtro in (("created_at_rd", f"{jan1}T00:00:00+00:00"), ("closed_at", f"{jan1}T00:00:00+00:00")):
            pg = 0
            while True:
                qy = sb.table("deals").select("id,amount,win,closed_at,created_at_rd,user_id,user_email,pipeline_id,ds:rd_raw->deal_source").gte(*filtro)
                ch = qy.order("id").range(pg * 1000, pg * 1000 + 999).execute().data or []
                for d in ch:
                    if str(d.get("id")) not in seen_h:
                        seen_h.add(str(d.get("id")))
                        hist_deals.append(d)
                if len(ch) < 1000 or pg >= 25:
                    break
                pg += 1
        spend_mensal = {}
        try:
            for r in (sb.table("meta_ads_monthly").select("mes,spend").eq("ano", hoje.year).execute().data or []):
                spend_mensal[int(r.get("mes") or 0)] = _num(r.get("spend"))
        except Exception:
            avisos.append("meta_ads_monthly indisponível — histórico de spend ficou vazio")
        hist = []
        for m in range(1, hoje.month + 1):
            eqm = {tk: {"leads": 0, "vendas": 0, "vgv": 0.0} for tk, _l in TEAMS}
            tot = {"leads": 0, "vendas": 0, "vgv": 0.0}
            canais_m = {}
            for d in hist_deals:
                uid = str(d.get("user_id") or "") or email2uid.get((d.get("user_email") or "").lower(), "")
                tk = team_do_deal(d.get("pipeline_id"), uid)
                ck = channel(source({"deal_source": d.get("ds")}))
                ck = CANAL_MERGE.get(ck, ck)
                cm = canais_m.setdefault(ck, {"leads": 0, "vendas": 0, "vgv": 0.0})
                cr = parse_dt(d.get("created_at_rd"))
                cl = parse_dt(d.get("closed_at"))
                if cr and cr.year == hoje.year and cr.month == m:
                    tot["leads"] += 1
                    cm["leads"] += 1
                    if tk in eqm:
                        eqm[tk]["leads"] += 1
                if d.get("win") is True and cl and cl.year == hoje.year and cl.month == m:
                    v = amount(d)
                    tot["vendas"] += 1
                    tot["vgv"] += v
                    cm["vendas"] += 1
                    cm["vgv"] += v
                    if tk in eqm:
                        eqm[tk]["vendas"] += 1
                        eqm[tk]["vgv"] += v
            sp = spend_mensal.get(m, 0.0)
            hist.append({"ym": f"{hoje.year:04d}-{m:02d}", "parcial": m == hoje.month,
                         "canais": {k: {**v, "vgv": round(v["vgv"], 2)} for k, v in canais_m.items()
                                    if v["leads"] or v["vendas"]},
                         "equipes": {k: {**v, "vgv": round(v["vgv"], 2),
                                         "ticket": round(v["vgv"] / v["vendas"], 2) if v["vendas"] else None}
                                     for k, v in eqm.items()},
                         "total": {**tot, "vgv": round(tot["vgv"], 2),
                                   "ticket": round(tot["vgv"] / tot["vendas"], 2) if tot["vendas"] else None,
                                   "spend": round(sp, 2),
                                   "cpl_global": round(sp / tot["leads"], 2) if tot["leads"] and sp else None,
                                   "cac_global": round(sp / tot["vendas"], 2) if tot["vendas"] and sp else None}})

        # ── H) FUNIL RD (aba nova): lanes EXATAS de cada funil, abertos AGORA +
        # % de passagem histórica aproximada (etapa atual + win, mesma régua do
        # piso de equipe — sem inventar: contagem real de deals) ──
        funil_rd = {}
        for tk, alvo in FUNIS_RD.items():
            pids = {str(k) for k, nm in pipe_names.items() if alvo in (nm or "").lower()}
            pid = next((p for p in sorted(pids, key=lambda x: -len(by_pipe.get(x, []))) if len(by_pipe.get(p, [])) >= 2), None)
            if not pid:
                continue
            lanes = by_pipe[pid]
            chain, cauda = _dividir_funil(lanes)
            fonte_pos = {p for p, _n in cauda}
            entry = chain[0][0]
            ultima = chain[-1][0]
            # população: abertos (etapa atual) + fechados do ano (win → fim da cadeia)
            alc = {pos: 0 for pos, _n in chain}
            ab_lane = {pos: 0 for pos, _n in lanes}
            def _conta(pos_atual, win):
                p = entry if pos_atual in fonte_pos else pos_atual
                if win:
                    p = ultima
                for pos, _n in chain:
                    if p >= pos:
                        alc[pos] += 1
            for d in abertos:
                spid, spos = pos_by_id.get(str(d.get("stage_id") or "")) or ("", 0)
                if str(spid) in pids and spos:
                    ab_lane[spos] = ab_lane.get(spos, 0) + 1
                    _conta(spos, False)
            for d in hist_deals:
                if d.get("win") is not True:
                    continue
                # win do ano conta como chegou ao fim da cadeia deste funil?
                # só se o deal pertence ao funil (stage do histórico não vem — usa
                # o time do corretor como proxy do funil da equipe)
                uid = str(d.get("user_id") or "") or email2uid.get((d.get("user_email") or "").lower(), "")
                if team_do_deal(d.get("pipeline_id"), uid) == tk:
                    _conta(ultima, True)
            out_lanes = []
            for i, (pos, nome) in enumerate(lanes):
                na_chain = any(pos == p for p, _x in chain)
                passagem = None
                if na_chain:
                    idx = next(j for j, (p, _x) in enumerate(chain) if p == pos)
                    if idx < len(chain) - 1:
                        a, b = alc[chain[idx][0]], alc[chain[idx + 1][0]]
                        passagem = round(b / a * 100, 1) if a else None
                out_lanes.append({"nome": nome, "abertos": ab_lane.get(pos, 0),
                                  "alcancaram": alc.get(pos) if na_chain else None,
                                  "passagem_pct": passagem, "base": not na_chain})
            funil_rd[tk] = {"pipeline": pipe_names.get(pid), "lanes": out_lanes}

        # ── J) 🔮 PROJEÇÃO PONDERADA multi-horizonte (v86.34, pedido 17/ago):
        # SEMANA · MÊS · TRIMESTRE · SEMESTRE · ANO. Curto prazo = real do
        # período + pastas que CABEM no horizonte (mediana pasta→venda);
        # trimestre = real + pipeline inteiro ponderado; semestre/ano somam o
        # run-rate (média dos últimos ≤3 meses FECHADOS da equipe) nos meses
        # cheios que o pipeline não enxerga. Cada termo declarado — sem invenção.
        dias_rest = dias_mes - hoje.day
        seg = hoje - timedelta(days=hoje.weekday())
        tri_ini = date(hoje.year, (hoje.month - 1) // 3 * 3 + 1, 1)
        sem_ini = date(hoje.year, 1 if hoje.month <= 6 else 7, 1)
        ano_ini = date(hoje.year, 1, 1)
        fim_tri_m = (hoje.month - 1) // 3 * 3 + 3
        fim_sem_m = 6 if hoje.month <= 6 else 12
        HORIZ = [("semana", "Semana", seg, 6 - hoje.weekday(), 0),
                 ("mes", "Mês", mes_ini, dias_rest, 0),
                 ("tri", "Trimestre", tri_ini, None, fim_tri_m - hoje.month),
                 ("semestre", "Semestre", sem_ini, None, fim_sem_m - hoje.month),
                 ("ano", "Ano", ano_ini, None, 12 - hoje.month)]
        forecast = {}
        for tk, _l in TEAMS:
            agg = equipes_prod.get(tk) or {}
            vis = next((v for v in visao if v["team"] == tk), {})
            pa = (vis.get("pipeline_agora") or {})
            tx = {}
            for nome_tx, num_k, den_k, min_n in (("visita", "venda", "visita", 5),
                                                 ("proposta", "venda", "proposta", 3),
                                                 ("pasta", "venda", "pasta", 3)):
                den = agg.get(den_k) or 0
                tx[nome_tx] = round((agg.get(num_k) or 0) / den, 3) if den >= min_n else None
            termos = []
            esp = 0.0
            for etapa, ab in (("pasta", pa.get("pastas") or 0), ("proposta", pa.get("propostas") or 0),
                              ("visita", pa.get("visitas") or 0)):
                if ab and tx.get(etapa) is not None:
                    ganho = ab * tx[etapa]
                    esp += ganho
                    termos.append({"etapa": etapa, "abertos": ab, "taxa_pct": round(tx[etapa] * 100, 1),
                                   "vendas_esp": round(ganho, 2)})
            ticket = vis.get("real_ticket") or (agg.get("ticket") if agg.get("ticket") else None)
            med_pv = None
            for ln in (tempos.get(tk) or []):
                if ln.get("passo") == "pasta→venda":
                    med_pv = ln.get("mediana_dias")
            pastas_curto = (pa.get("pastas") or 0) * (tx.get("pasta") or 0)
            # run-rate: média de vendas dos últimos ≤3 meses FECHADOS da equipe
            fechados = [((h.get("equipes") or {}).get(tk) or {}).get("vendas") or 0
                        for h in hist if not h.get("parcial")]
            rr_m = round(sum(fechados[-3:]) / len(fechados[-3:]), 2) if fechados[-3:] else 0.0
            hz = {}
            for hk, hl, ini_p, dias_h, meses_cheios in HORIZ:
                real_p = sum(1 for e in eds if e["team"] == tk and e["win"] and e["closed"]
                             and e["closed"].date() >= ini_p)
                if hk in ("semana", "mes"):
                    extra = pastas_curto if (med_pv is not None and dias_h is not None and med_pv <= dias_h) else 0.0
                elif hk == "tri":
                    extra = esp
                else:
                    extra = esp + rr_m * max(0, meses_cheios)
                hz[hk] = {"label": hl, "real": real_p, "esp": round(real_p + extra, 2)}
            forecast[tk] = {"pipeline_vendas_esp": round(esp, 2),
                            "pipeline_vgv_esp": round(esp * ticket, 2) if ticket else None,
                            "mes_esp": hz["mes"]["esp"], "tri_esp": hz["tri"]["esp"],
                            "hz": hz, "run_rate_mensal": rr_m,
                            "termos": termos, "mediana_pasta_venda_d": med_pv,
                            "dias_restantes": dias_rest}

        # ── K) ⚡ VELOCIDADE DO 1º CONTATO × CONVERSÃO (por equipe, na safra) ──
        resposta = {}
        for tk, _l in TEAMS:
            pares = []          # (horas, win) só de quem tem movimentação REAL medível
            nasceram = sem_ctt = 0
            for e in na_janela:
                if e["team"] != tk:
                    continue
                h = _h_contato(e)
                if h is not None:
                    pares.append((h, e["win"]))
                else:
                    t1 = e["t_marco"].get(1) or e["t_marco"].get(2)
                    if t1:
                        nasceram += 1   # nasceu na etapa (não medível por evento)
                    else:
                        sem_ctt += 1
            pares.sort(key=lambda x: x[0])
            hs = [x[0] for x in pares]
            def _q(f):
                return round(hs[min(len(hs) - 1, int(len(hs) * f))], 2) if hs else None
            med = _q(0.5)
            rapidos = [x for x in pares if med is not None and x[0] <= med]
            lentos = [x for x in pares if med is not None and x[0] > med]
            cv = lambda xs: round(sum(1 for x in xs if x[1]) / len(xs) * 100, 1) if xs else None
            resposta[tk] = {"n_mediveis": len(pares), "nasceram_na_etapa": nasceram, "sem_contato": sem_ctt,
                            "mediana_h": med, "media_h": round(sum(hs) / len(hs), 2) if hs else None,
                            "p25_h": _q(0.25), "p75_h": _q(0.75),
                            "mais_rapido_h": round(hs[0], 2) if hs else None,
                            "mais_lento_h": round(hs[-1], 2) if hs else None,
                            "conv_rapidos_pct": cv(rapidos), "conv_lentos_pct": cv(lentos)}

        # ── L) 💸 PAYBACK DE MÍDIA (HUB: dataVenda → 1ª parcela no caixa) ──
        payback = None
        try:
            fin_kv, _okf = _kv_read(sb, "psmhub_financeiro_cache")
            fin = (fin_kv or {}).get("financeiro") or []
            dds = []
            for vd in fin:
                dv, dp = vd.get("dataVenda"), vd.get("dataPrimeiraParcela")
                if dv and dp:
                    try:
                        dds.append((date.fromisoformat(str(dp)[:10]) - date.fromisoformat(str(dv)[:10])).days)
                    except Exception:
                        pass
            dds = sorted(d for d in dds if 0 <= d <= 365)
            if dds:
                payback = {"mediana_dias": dds[len(dds) // 2], "n": len(dds),
                           "fonte": "HUB financeiro: dataVenda → 1ª parcela"}
        except Exception:
            payback = None

        # ── M) 🏃 PERFORMANCE INDIVIDUAL — média-base de 90 dias (métrica do Paulo:
        # o corretor comparado com a PRÓPRIA base dos 90d anteriores).
        # v86.33 (pedido 17/ago): SÓ corretores ATIVOS — quem saiu não entra em
        # análise de performance, aparece apenas no 🚪 Turnover.
        prev_ini = since_dt - timedelta(days=90)
        perf_corr = []
        # v86.35: par (corretor, equipe) — quem atua em dois funis (Yara: MAP +
        # Terceiros) é avaliado em CADA equipe contra a própria base daquela equipe
        uids_perf = {(e["uid"], e["team"]) for e in eds
                     if e["uid"] and e["team"] != "outros" and e["created"] and e["created"] >= prev_ini}
        for uid, tku in uids_perf:
            u = users.get(uid) or {}
            if (u.get("status") or "ativo") != "ativo":
                continue          # desligado: análise dele vive no turnover
            atu = [e for e in eds if e["uid"] == uid and e["team"] == tku and e["created"] and since_dt <= e["created"] <= until_dt]
            ant = [e for e in eds if e["uid"] == uid and e["team"] == tku and e["created"] and prev_ini <= e["created"] < since_dt]
            def _blk(pool):
                v = sum(1 for e in pool if e["win"])
                return {"leads": len(pool), "vendas": v,
                        "vgv": round(sum(e["vgv"] for e in pool if e["win"]), 2),
                        "conv_pct": round(v / len(pool) * 100, 2) if pool else None}
            a, b = _blk(atu), _blk(ant)
            if not a["leads"] and not b["leads"]:
                continue
            perf_corr.append({"uid": uid, "nome": u.get("name") or "?", "team": tku,
                              "atual": a, "base": b,
                              "delta_vendas_pct": round((a["vendas"] - b["vendas"]) / b["vendas"] * 100, 1) if b["vendas"] else None,
                              "delta_vgv_pct": round((a["vgv"] - b["vgv"]) / b["vgv"] * 100, 1) if b["vgv"] else None})
        perf_corr.sort(key=lambda x: (-x["atual"]["vendas"], -x["atual"]["vgv"]))

        # ── N) 🚪 TURNOVER — regra da casa: ciclo de ~90 dias por saída ──
        saidas = []
        for uid, u in users.items():
            if (u.get("status") or "ativo") == "ativo":
                continue
            r_ = (u.get("role") or "").lower()
            if not r_.startswith("corretor"):
                continue
            ult = None
            for d in hist_deals:
                du = str(d.get("user_id") or "") or email2uid.get((d.get("user_email") or "").lower(), "")
                if du != uid:
                    continue
                for t_ in (parse_dt(d.get("closed_at")), parse_dt(d.get("created_at_rd"))):
                    if t_ and (ult is None or t_ > ult):
                        ult = t_
            if ult:
                saidas.append({"nome": u.get("name") or uid, "team": team_key(u.get("team")),
                               "ultima_atividade": ult.date().isoformat()})
        saidas.sort(key=lambda x: x["ultima_atividade"])
        intervalos = []
        for i in range(1, len(saidas)):
            d1 = date.fromisoformat(saidas[i - 1]["ultima_atividade"])
            d2 = date.fromisoformat(saidas[i]["ultima_atividade"])
            if (d2 - d1).days > 0:
                intervalos.append((d2 - d1).days)
        dias_ultima = (hoje - date.fromisoformat(saidas[-1]["ultima_atividade"])).days if saidas else None
        # risco: corretor ATIVO com leads na janela e ZERO venda há 90d+
        risco = []
        for uid in {e["uid"] for e in na_janela if e["uid"]}:
            u = users.get(uid) or {}
            if (u.get("status") or "ativo") != "ativo" or not (u.get("role") or "").lower().startswith("corretor"):
                continue
            vendas_90 = sum(1 for e in eds if e["uid"] == uid and e["win"] and e["closed"] and (hoje - e["closed"].date()).days <= 90)
            leads_j = sum(1 for e in na_janela if e["uid"] == uid)
            if vendas_90 == 0 and leads_j >= 20:
                risco.append({"nome": u.get("name") or uid, "team": team_de(uid, u.get("team")),
                              "leads_janela": leads_j, "vendas_90d": 0})
        turnover = {"regra_dias": 90, "saidas": saidas[-12:],
                    "intervalo_medio_dias": round(sum(intervalos) / len(intervalos)) if intervalos else None,
                    "dias_desde_ultima": dias_ultima,
                    "nota": "saída aproximada pela ÚLTIMA atividade no CRM do corretor inativo (não há data de desligamento estruturada)",
                    "ativos_risco": sorted(risco, key=lambda x: -x["leads_janela"])[:10]}

        # ── O) 🚨 ALERTAS DE MÉTRICAS-CHAVE (v86.33, pedido 17/ago): régua por
        # métrica; fora da régua = vermelho no painel + notificação pra gestor da
        # equipe + sócios (dedupe diário). Régua editável no shared_kv gc_alertas_cfg.
        ALERTAS_DEFAULT = {
            "max_cpl": 120.0,            # R$/lead acima disso alerta
            "max_cac_midia": 3000.0,     # R$/venda (mídia) acima disso alerta
            "max_contato_h": 24.0,       # 1º contato mediano acima de 24h alerta
            "min_conv_venda_pct": 0.5,   # conversão lead→venda da safra abaixo disso alerta
            "max_sem_contato": 10,       # leads sem 1º contato até hoje
            "min_ritmo_meta_pct": 70.0,  # % do ritmo esperado da meta (proporcional aos dias)
            "min_roas": 1.0,             # receita ≈4% VGV ÷ spend abaixo de 1× alerta
        }
        _acfg_kv = _kv_read(sb, "gc_alertas_cfg")[0] or {}
        acfg = {**ALERTAS_DEFAULT, **{k: _num(v, ALERTAS_DEFAULT[k]) for k, v in _acfg_kv.items() if k in ALERTAS_DEFAULT}}
        alert_itens = []

        def _al(team, metrica, label, valor, limite, sentido, fmt="num"):
            # sentido "max": alerta quando valor > limite · "min": quando valor < limite
            if valor is None or limite in (None, 0):
                return
            fora = valor > limite if sentido == "max" else valor < limite
            if not fora:
                return
            alert_itens.append({"id": f"{team}:{metrica}", "team": team, "metrica": metrica,
                                "label": label, "valor": round(_num(valor), 2), "limite": round(_num(limite), 2),
                                "delta_pct": round((valor - limite) / abs(limite) * 100, 1),
                                "acima": valor > limite, "fmt": fmt})

        for cu in custos:
            _tk = cu["team"]
            if not (cu["leads"] or cu["vendas"] or cu["spend"]):
                continue
            _al(_tk, "custo_lead", "R$/lead", cu["custo_lead"] if cu["custo_lead"] is not None else cu["custo_lead_30d"], acfg["max_cpl"], "max", "brl")
            _al(_tk, "cac_midia", "CAC mídia (R$/venda)", cu["cac_midia"] if cu["cac_midia"] is not None else cu["cac_midia_30d"], acfg["max_cac_midia"], "max", "brl")
            if cu["spend"]:
                _al(_tk, "roas", "ROAS (receita ≈4% ÷ spend)", cu["roas"], acfg["min_roas"], "min", "x")
        for _tk, _l in TEAMS:
            ep = equipes_prod.get(_tk) or {}
            if ep.get("leads"):
                _al(_tk, "contato_h", "1º contato mediano (horas)", ep.get("contato_h_mediana"), acfg["max_contato_h"], "max", "h")
                _al(_tk, "conv_venda", "conversão lead→venda da safra (%)", round(ep["venda"] / ep["leads"] * 100, 2) if ep["leads"] >= 30 else None, acfg["min_conv_venda_pct"], "min", "pct")
            rz = resposta.get(_tk) or {}
            if rz.get("sem_contato"):
                _al(_tk, "sem_contato", "leads SEM 1º contato", rz["sem_contato"], acfg["max_sem_contato"], "max", "num")
        for v in visao:
            if (v.get("meta_vendas") or 0) > 0 and hoje.day >= 5:   # 5 dias de mês pra fazer sentido
                esperado = v["meta_vendas"] * (hoje.day / dias_mes)
                if esperado > 0:
                    _al(v["team"], "ritmo_meta", "% do ritmo esperado da meta do mês",
                        round(v["real_vendas"] / esperado * 100, 1), acfg["min_ritmo_meta_pct"], "min", "pct")
        alertas = {"itens": alert_itens, "cfg": acfg,
                   "nota": "régua editável no shared_kv gc_alertas_cfg · fora da régua = métrica vermelha + notificação pra gestor da equipe e sócios (1× por dia por métrica)"}

        # ── I) CAMPANHAS → FUNIL → VENDA (pedido do Paulo, 15/ago: escalar/pausar
        # pela VENDA, não pelo CPL — CPL barato sem venda não compensa; CPL acima
        # do previsto que VENDE pode compensar). Funil = safra da janela; spend =
        # cache de campanhas Meta (últimos ~30d, base de custo corrente — declarado).
        _mc = read_meta_campaigns(sb, preset=spend_preset)
        camps = {}
        for e in na_janela:
            nome = (e.get("camp") or "").strip()
            if not nome:
                continue
            c = camps.setdefault(nome, {"leads": 0, "agend": 0, "visita": 0, "proposta": 0,
                                        "pasta": 0, "venda": 0, "vgv": 0.0, "teams": set()})
            c["leads"] += 1
            c["teams"].add(e["team"])
            if e["marco"] >= 2: c["agend"] += 1
            if e["marco"] >= 3: c["visita"] += 1
            if e["marco"] >= 4: c["proposta"] += 1
            if e["marco"] >= 5: c["pasta"] += 1
            if e["win"]:
                c["venda"] += 1
                c["vgv"] += e["vgv"]
        itens_camp = []
        for nome, c in camps.items():
            rec = match_campaign_cpl(nome, _mc) or {}
            spend = _num(rec.get("spend"), None)
            receita = c["vgv"] * 0.04     # ≈ comissão bruta 4% (nota na tela)
            roas = round(receita / spend, 2) if spend else None
            if c["venda"] >= 1 and (not spend or receita >= 1.5 * spend):
                ver, vlbl = "escalar", "💰 ESCALAR"
            elif c["venda"] >= 1:
                ver, vlbl = "manter", "✅ VENDE — manter"
            elif (c["pasta"] + c["proposta"]) >= 2:
                ver, vlbl = "maturando", "⏳ MATURANDO (pastas/propostas na esteira)"
            elif spend and spend >= 300 and c["visita"] == 0:
                ver, vlbl = "pausar", "🔴 REVER/PAUSAR — gasta e não gera visita"
            else:
                ver, vlbl = "observar", "⚪ observar"
            st_meta = (rec.get("status") or "").lower() if rec else None
            itens_camp.append({"campanha": nome, "teams": sorted(c["teams"]),
                               "status_meta": st_meta,
                               "ativa": st_meta == "active",
                               "leads": c["leads"], "agend": c["agend"], "visita": c["visita"],
                               "proposta": c["proposta"], "pasta": c["pasta"], "venda": c["venda"],
                               "vgv": round(c["vgv"], 2), "receita_est": round(receita, 2),
                               "spend_30d": round(spend, 2) if spend is not None else None,
                               "cpl_30d": _num(rec.get("cpl"), None),
                               "roas": roas, "veredito": ver, "veredito_lbl": vlbl})
        itens_camp.sort(key=lambda x: (-x["venda"], -x["pasta"], -x["proposta"], -x["visita"], -x["leads"]))
        campanhas = {"itens": itens_camp[:60],
                     "sem_campanha": sum(1 for e in na_janela if not (e.get("camp") or "").strip()),
                     "spend_preset_pedido": spend_preset,
                     "spend_preset_usado": _mc.get("preset_used"),
                     "nota": f"funil = safra da janela (lead nascido nela, seguido até hoje) · spend/CPL da Meta no período '{_mc.get('preset_used') or spend_preset}' · receita ≈ 4% do VGV"}

        # cobertura = % com origem PREENCHIDA no RD (canal bruto, ANTES da fusão
        # do tráfego — o merge da v86.28 tinha derrubado a métrica pra 3% falso)
        cobertura = round(sum(1 for e in na_janela if e["atribuido"]) / len(na_janela) * 100, 1) if na_janela else None

        return {"visao": visao, "hub_conquista": hub_x, "fontes": fontes,
                "historico": hist, "funil_rd": funil_rd, "campanhas": campanhas,
                "forecast": forecast, "resposta": resposta,
                "custos": {"mes": ym, "equipes": custos, "payback_midia": payback,
                           "nota": "spend Meta this_month por conta da equipe ÷ atividade real do mês; CAC mídia divide SÓ pelas vendas de tráfego pago; CAC completo soma o custo fixo orçado da linha e divide por todas as vendas"},
                "produtividade": {"corretores": corretores, "equipes": equipes_prod},
                "safras": safras_out, "safras_por_equipe": safras_por_equipe, "tempos": tempos,
                "performance_corretores": perf_corr, "turnover": turnover, "alertas": alertas,
                "coorte_por_equipe": {tk: sum(1 for e in na_janela if e["team"] == tk) for tk, _l in TEAMS},
                "cobertura_origem_pct": cobertura, "avisos": avisos,
                "coorte_n": len(na_janela),
                "fetched_at": datetime.now(timezone.utc).isoformat()}
