"""GET/POST /api/v3/diretoria/scorecard — 📊 Scorecards padrão da Diretoria (v88.26)

Um só formato de placar para a Presidência, cada Unidade de Negócio e cada Área:
indicador · realizado · meta · % · FAROL · dono · fonte. Mesma régua pra todos.

GET  ?ym=2026-09[&fresh=1]   (lvl >= 7)
POST (lvl >= 10 — sócio)
  {action:'set_meta',   ind, meta|null}         meta própria de um indicador (null = volta ao padrão)
  {action:'set_manual', ym, ind, valor|null}     valor de um indicador MANUAL no mês
  {action:'set_dono',   sc, dono|null}           dono (users.id) de um scorecard

FONTES (nada novo é calculado aqui — só lido dos motores oficiais):
  • Comercial/funil/leads/pipeline/pessoas: _metricas_lib.resumo (motor único, régua por EQUIPE)
    — a meta comercial vem da aba Metas (resumo.meta), igual ao 1:1, Ranking e Projeção.
  • Receita, comissões, contribuição por linha: viab.compute_snapshot (régua da tela
    Orçado × Realizado — classifica por FUNIL do RD, pode diferir 1–2 vendas da régua por equipe).
  • Custo fixo: viab_custos_orcado (custo_fixo_mes) · Mídia: meta_ads_monthly e
    trafego_real.consolidar (por marca) · Break-even: viab.break_even.
  • Locação: tabela locacoes · NPS: producao_eventos (nps_coletado) · Qualidade: consistencia_telas.
  • Manuais (eNPS, Morimatsu…): shared_kv scorecard_manual, lançados na própria tela.

FAROL (régua única, escrita aqui e na tela):
  maior-melhor, acumula no mês → compara com o RITMO (fração do mês decorrida):
      verde ≥ 90% do esperado · amarelo ≥ 70% · vermelho abaixo
  maior-melhor, foto (taxa/estoque) → verde ≥ 90% da meta · amarelo ≥ 70%
  menor-melhor → verde ≤ meta · amarelo ≤ meta + 15% · vermelho acima
  sem meta → "info" (📈 acompanhamento, não conta na saúde) · sem dado / manual sem valor → cinza
Mês fechado: ritmo = 100%.
"""
from http.server import BaseHTTPRequestHandler
import calendar
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)

KV_CFG, KV_MANUAL, KV_CACHE = "scorecard_cfg", "scorecard_manual", "scorecard_cache"
CACHE_TTL = 600
VERSAO_REGRAS = "v1"


# ─── catálogo ───────────────────────────────────────────────────────────────
# Cada scorecard: id, nome, grupo (presidencia|un|area), ícone, dono padrão, nota, indicadores.
# Indicador: id, label, un ('R$'|'n'|'%'), dir ('maior'|'menor'), acumula (bool),
#            src (chave do valor em _valores) · meta_src (chave da meta automática) · meta_pad (padrão).
def I(id, label, un, dir, acumula, src, meta_src=None, meta_pad=None, manual=False, nota=None):
    return {"id": id, "label": label, "un": un, "dir": dir, "acumula": acumula, "src": src,
            "meta_src": meta_src, "meta_pad": meta_pad, "manual": manual, "nota": nota}


CATALOGO = [
    {"id": "presidencia", "nome": "Presidência", "grupo": "presidencia", "ico": "🏛", "dono": "paulo",
     "nota": "A empresa inteira. Se estes estão verdes, a PSM está saudável.", "ind": [
        I("p.vgv", "VGV vendido", "R$", "maior", True, "E.vgv", "E.meta_vgv"),
        I("p.vendas", "Vendas", "n", "maior", True, "E.vendas", "E.meta_vendas"),
        I("p.receita", "Receita de comissão (bruta PSM)", "R$", "maior", True, "F.receita", "F.receita_orc"),
        I("p.contrib", "Margem de contribuição", "R$", "maior", True, "F.contrib", "F.contrib_orc", nota="receita − comissões − imposto"),
        I("p.resultado", "Resultado do mês (projetado)", "R$", "maior", False, "F.resultado_proj", meta_pad=0,
          nota="contribuição projetada pro fim do mês − custo fixo orçado (sem mídia) − mídia real. Regra do Positivo: ≥ 0"),
        I("p.breakeven", "Cobertura do ponto de equilíbrio", "%", "maior", True, "F.cobertura_be", meta_pad=100,
          nota="VGV do mês ÷ VGV necessário pra pagar o custo fixo"),
        I("p.midia", "Investimento em mídia (Meta)", "R$", "menor", True, "M.spend_total", "M.spend_orc", nota="meta = verba de tráfego orçada no mês"),
        I("p.cac", "CAC de mídia", "R$", "menor", False, "M.cac_total", nota="mídia ÷ vendas"),
        I("p.pipeline", "Pipeline ponderado × falta pra meta", "%", "maior", False, "E.cobertura_pipeline", meta_pad=100,
          nota="VGV ponderado em aberto ÷ o que falta pra bater a meta do mês"),
        I("p.corretores", "Corretores ativos", "n", "maior", False, "E.corretores", meta_pad=16,
          nota="Plano: 16–18 no Q1/2027"),
        I("p.nps", "NPS pós-visita", "n", "maior", False, "O.nps", meta_pad=70),
    ]},
    {"id": "un_conquista", "nome": "PSM Conquista", "grupo": "un", "ico": "🏠", "dono": "kbordini",
     "nota": "MCMV / primeiro imóvel. Régua por equipe (users.team = conquista).", "ind": [
        I("c.vgv", "VGV vendido", "R$", "maior", True, "Q.conquista.vgv", "Q.conquista.meta_vgv"),
        I("c.vendas", "Vendas", "n", "maior", True, "Q.conquista.vendas", "Q.conquista.meta_vendas"),
        I("c.leads", "Leads", "n", "maior", True, "Q.conquista.leads"),
        I("c.agend", "Agendamentos", "n", "maior", True, "Q.conquista.agendamentos", "Q.conquista.meta_agendamentos"),
        I("c.visitas", "Visitas", "n", "maior", True, "Q.conquista.visitas", "Q.conquista.meta_visitas"),
        I("c.propostas", "Propostas", "n", "maior", True, "Q.conquista.propostas", "Q.conquista.meta_propostas"),
        I("c.conv", "Conversão lead → venda", "%", "maior", False, "Q.conquista.conv"),
        I("c.cpl", "CPL (custo por lead)", "R$", "menor", False, "M.cpl.conquista"),
        I("c.contrib", "Margem de contribuição da linha", "R$", "maior", True, "F.linha.conquista", "F.linha.conquista_orc"),
        I("c.corretores", "Corretores ativos", "n", "maior", False, "Q.conquista.corretores"),
    ]},
    {"id": "un_imoveis", "nome": "PSM Imóveis (MAP + Terceiros)", "grupo": "un", "ico": "🏢", "dono": "paulo",
     "nota": "Alto padrão e terceiros. Soma das equipes map e terceiros.", "ind": [
        I("i.vgv", "VGV vendido", "R$", "maior", True, "Q.imoveis.vgv", "Q.imoveis.meta_vgv"),
        I("i.vendas", "Vendas", "n", "maior", True, "Q.imoveis.vendas", "Q.imoveis.meta_vendas"),
        I("i.visitas", "Visitas", "n", "maior", True, "Q.imoveis.visitas", "Q.imoveis.meta_visitas"),
        I("i.propostas", "Propostas", "n", "maior", True, "Q.imoveis.propostas", "Q.imoveis.meta_propostas"),
        I("i.quente", "Pipeline quente (VGV)", "R$", "maior", False, "Q.imoveis.quente_vgv"),
        I("i.cpl", "CPL (custo por lead) MAP", "R$", "menor", False, "M.cpl.map"),
        I("i.contrib", "Margem de contribuição (MAP + Terceiros)", "R$", "maior", True, "F.linha.imoveis", "F.linha.imoveis_orc"),
    ]},
    {"id": "un_locacao", "nome": "PSM Locação", "grupo": "un", "ico": "🔑", "dono": "paulo",
     "nota": "Pausada no Plano de Resgate — acompanhada pra não perder a carteira.", "ind": [
        I("l.ocupados", "Contratos ativos (ocupados)", "n", "maior", False, "L.ocupados"),
        I("l.ocupacao", "Ocupação da carteira", "%", "maior", False, "L.ocupacao", meta_pad=95),
        I("l.adm", "Receita de administração / mês", "R$", "maior", False, "L.receita_adm"),
        I("l.atraso", "Contratos em atraso", "n", "menor", False, "L.em_atraso", meta_pad=0),
        I("l.vence", "Contratos vencendo em 60 dias", "n", "menor", False, "L.vence_60d", nota="renovação a tratar"),
    ]},
    {"id": "un_morimatsu", "nome": "Morimatsu & Associados", "grupo": "un", "ico": "🏯", "dono": "paulo",
     "nota": "Leilões e venda direta Caixa. Lançamento manual até o escritório ter sistema próprio de números.", "ind": [
        I("m.operacoes", "Operações em andamento", "n", "maior", False, None, manual=True),
        I("m.arremates", "Arremates no mês", "n", "maior", True, None, manual=True),
        I("m.honorarios", "Honorários recebidos no mês", "R$", "maior", True, None, manual=True),
        I("m.investidores", "Investidores ativos", "n", "maior", False, None, manual=True),
    ]},
    {"id": "area_comercial", "nome": "Comercial", "grupo": "area", "ico": "🤝", "dono": "kbordini",
     "nota": "O funil da empresa inteira.", "ind": [
        I("co.agend", "Agendamentos", "n", "maior", True, "E.agendamentos", "E.meta_agendamentos"),
        I("co.visitas", "Visitas", "n", "maior", True, "E.visitas", "E.meta_visitas"),
        I("co.propostas", "Propostas", "n", "maior", True, "E.propostas", "E.meta_propostas"),
        I("co.lead_visita", "Taxa lead → visita", "%", "maior", False, "E.lead_visita"),
        I("co.ticket", "Ticket médio", "R$", "maior", False, "E.ticket"),
        I("co.semvalor", "Negócios abertos sem valor", "n", "menor", False, "E.sem_valor", meta_pad=0,
          nota="pipeline sem VGV não entra na previsão"),
    ]},
    {"id": "area_marketing", "nome": "Marketing", "grupo": "area", "ico": "📣", "dono": "paulo",
     "nota": "Geração de demanda e custo de aquisição.", "ind": [
        I("mk.leads", "Leads (tráfego pago)", "n", "maior", True, "E.leads"),
        I("mk.spend", "Investimento em mídia", "R$", "menor", True, "M.spend_total", "M.spend_orc"),
        I("mk.cpl", "CPL da empresa", "R$", "menor", False, "M.cpl_total"),
        I("mk.cac", "CAC de mídia", "R$", "menor", False, "M.cac_total"),
        I("mk.naoclass", "Leads sem origem classificada", "%", "menor", False, "E.pct_nao_class", meta_pad=10),
    ]},
    {"id": "area_financeiro", "nome": "Financeiro", "grupo": "area", "ico": "💰", "dono": "paulo",
     "nota": "Resultado e sustentação da operação.", "ind": [
        I("f.receita", "Receita de comissão", "R$", "maior", True, "F.receita", "F.receita_orc"),
        I("f.contrib", "Margem de contribuição", "R$", "maior", True, "F.contrib", "F.contrib_orc"),
        I("f.fixo", "Custo fixo orçado do mês (sem mídia)", "R$", "menor", False, "F.custo_fixo", nota="orçamento de custos (Orçado × Realizado), fora o tráfego pago"),
        I("f.resultado", "Resultado do mês (projetado)", "R$", "maior", False, "F.resultado_proj", meta_pad=0),
        I("f.be", "Cobertura do ponto de equilíbrio", "%", "maior", True, "F.cobertura_be", meta_pad=100),
        I("f.travados", "Recebíveis travados", "n", "menor", False, "R.travados", meta_pad=0),
    ]},
    {"id": "area_pessoas", "nome": "Pessoas", "grupo": "area", "ico": "👥", "dono": "isa",
     "nota": "Time, formação e clima.", "ind": [
        I("pe.corretores", "Corretores ativos", "n", "maior", False, "E.corretores", meta_pad=16),
        I("pe.gestores", "Gestores ativos", "n", "maior", False, "E.gestores"),
        I("pe.enps", "eNPS (clima)", "n", "maior", False, None, meta_pad=50, manual=True),
        I("pe.saidas", "Desligamentos no mês", "n", "menor", False, None, meta_pad=0, manual=True),
        I("pe.academy", "Alunos da Academy em formação", "n", "maior", False, None, manual=True),
    ]},
    {"id": "area_operacoes", "nome": "Operações & Dados", "grupo": "area", "ico": "⚙️", "dono": "paulo",
     "nota": "Pós-venda, relacionamento e confiabilidade dos números.", "ind": [
        I("o.nps", "NPS pós-visita", "n", "maior", False, "O.nps", meta_pad=70),
        I("o.nps_n", "Pesquisas NPS coletadas", "n", "maior", True, "O.nps_n"),
        I("o.indic", "Abordagens de indicação", "n", "maior", True, "O.indicacoes"),
        I("o.consist", "Divergências entre telas (teste noturno)", "n", "menor", False, "O.divergencias", meta_pad=0),
    ]},
]
IND_BY_ID = {i["id"]: i for sc in CATALOGO for i in sc["ind"]}


# ─── util ───────────────────────────────────────────────────────────────────
def _hoje():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


def _kv(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        v = json.loads(v) if isinstance(v, str) else v
        return v if v is not None else default
    except Exception:
        return default


def _kv_put(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _num(v):
    try: return float(v)
    except Exception: return None


def _div(a, b, mult=1.0):
    a, b = _num(a), _num(b)
    if a is None or not b: return None
    return round(a / b * mult, 2)


def farol(valor, meta, dir_, acumula, ritmo, manual):
    """→ (farol, pct, esperado_pct). farol: verde|amarelo|vermelho|cinza."""
    if valor is None:
        return ("cinza", None, None)
    if meta is None:
        return ("info", None, None)   # só acompanhamento até alguém definir a meta
    if dir_ == "menor":
        if meta <= 0:
            return ("verde" if valor <= meta else "vermelho", None, None)
        pct = round(valor / meta * 100)
        return ("verde" if valor <= meta else "amarelo" if valor <= meta * 1.15 else "vermelho", pct, 100)
    esperado = ritmo if acumula else 100
    if meta <= 0:   # ex.: resultado ≥ 0
        return ("verde" if valor >= meta else "vermelho", None, None)
    pct = round(valor / meta * 100)
    if esperado <= 0:
        return ("cinza", pct, 0)
    ref = esperado / 100.0
    return ("verde" if pct >= 90 * ref else "amarelo" if pct >= 70 * ref else "vermelho", pct, esperado)


# ─── coleta ─────────────────────────────────────────────────────────────────
def _valores(sb, ano, mes, hoje, avisos):
    """Dicionário plano {chave: valor} com tudo que os indicadores leem."""
    V = {}
    ini = date(ano, mes, 1)
    fim = date(ano, mes, calendar.monthrange(ano, mes)[1])
    corrente = (ano, mes) == (hoje.year, hoje.month)
    ritmo = 100 if hoje > fim else 0 if hoje < ini else round(hoje.day / fim.day * 100)
    V["_ritmo"] = ritmo

    # 1) motor comercial único
    try:
        from _metricas_lib import resumo  # type: ignore
        r = resumo(sb, {"since": ini.isoformat(), "until": fim.isoformat()}, hoje=hoje)
        V["_dados_de"] = r.get("dados_de_hhmm")

        def bloco(pref, b):
            if not b: return
            meta = b.get("meta") or {}
            pipe = b.get("pipeline") or {}
            for k in ("vgv", "vendas", "leads", "agendamentos", "visitas", "propostas", "ticket"):
                V[f"{pref}.{k}"] = b.get(k)
            for k in ("meta_vgv", "meta_vendas", "meta_agendamentos", "meta_visitas", "meta_propostas"):
                V[f"{pref}.{k}"] = meta.get(k) or None
            V[f"{pref}.quente_vgv"] = pipe.get("quente_vgv")
            V[f"{pref}.sem_valor"] = pipe.get("sem_valor")
            V[f"{pref}.ponderado_vgv"] = pipe.get("ponderado_vgv")
            V[f"{pref}.conv"] = _div(b.get("vendas"), b.get("leads"), 100)
            V[f"{pref}.lead_visita"] = _div(b.get("visitas"), b.get("leads"), 100)
            V[f"{pref}.corretores"] = b.get("n_corretores")
            V[f"{pref}.gestores"] = b.get("n_gestores")
            po = b.get("por_origem") or {}
            tot = sum(float(v or 0) for v in po.values()) if isinstance(po, dict) else 0
            V[f"{pref}.pct_nao_class"] = _div(po.get("nao_classificada"), tot, 100) if tot else None

        E = r.get("empresa") or {}
        eq = r.get("equipes") or {}
        bloco("E", E)
        V["E.corretores"] = sum(int((eq.get(t) or {}).get("n_corretores") or 0) for t in eq) or None
        V["E.gestores"] = sum(int((eq.get(t) or {}).get("n_gestores") or 0) for t in eq) or None
        falta = max(0.0, float(V.get("E.meta_vgv") or 0) - float(V.get("E.vgv") or 0))
        V["E.cobertura_pipeline"] = (100.0 if falta == 0 and V.get("E.meta_vgv") else _div(V.get("E.ponderado_vgv"), falta, 100))
        bloco("Q.conquista", eq.get("conquista"))
        # PSM Imóveis = map + terceiros (soma campo a campo)
        m_, t_ = eq.get("map") or {}, eq.get("terceiros") or {}
        V["Q.map.leads"] = m_.get("leads")
        soma = {}
        for k in ("vgv", "vendas", "leads", "agendamentos", "visitas", "propostas", "n_corretores", "n_gestores"):
            soma[k] = float(m_.get(k) or 0) + float(t_.get(k) or 0)
        soma["meta"] = {k: float((m_.get("meta") or {}).get(k) or 0) + float((t_.get("meta") or {}).get(k) or 0)
                        for k in ("meta_vgv", "meta_vendas", "meta_agendamentos", "meta_visitas", "meta_propostas")}
        soma["pipeline"] = {"quente_vgv": float((m_.get("pipeline") or {}).get("quente_vgv") or 0) + float((t_.get("pipeline") or {}).get("quente_vgv") or 0)}
        bloco("Q.imoveis", soma)
    except Exception as e:
        avisos.append(f"Motor comercial indisponível: {e}")

    # 2) financeiro (régua Orçado × Realizado)
    try:
        import viab  # type: ignore
        snap = viab.compute_snapshot(sb, ano, mes)
        cons, pl = snap["consolidado"], snap["por_linha"]
        contrib = lambda s: float(s.get("lucro") or 0) + float(s.get("custo") or 0)   # antes do custo
        V["F.receita"] = cons.get("receita")
        V["F.contrib"] = round(sum(contrib(s) for s in pl.values()), 2)
        V["F.linha.conquista"] = round(contrib(pl.get("conquista") or {}), 2)
        V["F.linha.imoveis"] = round(contrib(pl.get("map") or {}) + contrib(pl.get("terceiros") or {}), 2)
        itens = ((viab.read_kv(sb, "viab_custos_orcado").get(str(ano)) or {}).get("itens") or [])
        traf_orc = viab.trafego_por_marca(itens, viab.LINHA_IDS)
        # custo_fixo_mes inclui os itens de tráfego pago (classe fixo) → tira pra não contar mídia 2×
        fixo = round(viab.custo_fixo_mes(itens, mes) - float(traf_orc["total_mes"].get(mes) or 0), 2)
        spend = float(viab.meta_spend_ano(sb, ano).get(mes) or 0)
        V["M.spend_orc"] = float(traf_orc["total_mes"].get(mes) or 0) or None
        # orçado do mês (mesmo motor snapshot_linha, alimentado pelo orçamento) = meta financeira
        orcamento = viab.read_kv(sb, "viab_orcamento")
        orc_l = {}
        for i in viab.LINHA_IDS:
            o = viab.orc_for(orcamento, ano, i, mes)
            orc_l[i] = viab.snapshot_linha(o.get("vgv"), o.get("vendas"), dict(o, verba_mkt=0), 0)
        V["F.receita_orc"] = round(sum(s["receita"] for s in orc_l.values()), 2) or None
        V["F.contrib_orc"] = round(sum(s["lucro"] for s in orc_l.values()), 2) or None
        V["F.linha.conquista_orc"] = orc_l["conquista"]["lucro"] or None
        V["F.linha.imoveis_orc"] = round(orc_l["map"]["lucro"] + orc_l["terceiros"]["lucro"], 2) or None
        V["F.custo_fixo"] = fixo
        V["M.spend_total"] = spend or None
        contrib_proj = V["F.contrib"] / (ritmo / 100.0) if 0 < ritmo < 100 else V["F.contrib"]
        V["F.resultado_proj"] = round(contrib_proj - fixo - spend, 2)
        margens = viab.margens_ano(orcamento, ano, mes)
        be = viab.break_even(fixo + spend, margens)
        V["F.be_vgv"] = be.get("vgv_total")
        V["F.cobertura_be"] = _div(cons.get("vgv"), be.get("vgv_total"), 100)
    except Exception as e:
        avisos.append(f"Financeiro indisponível: {e}")

    # 3) mídia por marca (Meta Ads efetivo) → CPL / CAC
    try:
        import trafego_real  # type: ignore
        ef = (trafego_real.consolidar(sb, ano).get("efetivo") or {})
        V["M.cpl.conquista"] = _div((ef.get("conquista") or {}).get(mes), V.get("Q.conquista.leads"))
        V["M.cpl.map"] = _div((ef.get("map") or {}).get(mes), V.get("Q.map.leads"))
    except Exception as e:
        avisos.append(f"Mídia por marca indisponível: {e}")
    V["M.cpl_total"] = _div(V.get("M.spend_total"), V.get("E.leads"))
    V["M.cac_total"] = _div(V.get("M.spend_total"), V.get("E.vendas"))

    # 4) locação (foto da carteira)
    try:
        rows = sb.table("locacoes").select("status,valor_aluguel,taxa_adm_pct,data_fim_contrato").limit(2000).execute().data or []
        ativos = [x for x in rows if (x.get("status") or "") not in ("encerrado", "cancelado", "arquivado")]
        ocup = [x for x in ativos if x.get("status") in ("ocupado", "em_renovacao", "em_atraso")]
        V["L.ocupados"] = len(ocup)
        V["L.ocupacao"] = _div(len(ocup), len(ativos), 100) if ativos else None
        V["L.receita_adm"] = round(sum(float(x.get("valor_aluguel") or 0) * float(x.get("taxa_adm_pct") or 10) / 100 for x in ocup), 2)
        V["L.em_atraso"] = sum(1 for x in ativos if x.get("status") == "em_atraso")
        lim = hoje + timedelta(days=60)
        V["L.vence_60d"] = sum(1 for x in ocup if x.get("data_fim_contrato") and hoje.isoformat() <= str(x["data_fim_contrato"])[:10] <= lim.isoformat())
    except Exception as e:
        avisos.append(f"Locação indisponível: {e}")

    # 5) operações: NPS e indicações no mês (producao_eventos)
    try:
        ev = sb.table("producao_eventos").select("tipo,valor,ts").in_("tipo", ["nps_coletado", "abordagem_indicacao"]) \
            .gte("ts", ini.isoformat()).lt("ts", (fim + timedelta(days=1)).isoformat()).limit(5000).execute().data or []
        notas = [float(e["valor"]) for e in ev if e["tipo"] == "nps_coletado" and _num(e.get("valor")) is not None]
        V["O.nps_n"] = len(notas)
        V["O.nps"] = round((sum(1 for n in notas if n >= 9) - sum(1 for n in notas if n <= 6)) / len(notas) * 100) if notas else None
        V["O.indicacoes"] = sum(1 for e in ev if e["tipo"] == "abordagem_indicacao")
    except Exception as e:
        avisos.append(f"Produção indisponível: {e}")

    # 6) recebíveis travados (foto) e divergências do teste noturno (última rodada)
    try:
        V["R.travados"] = len(sb.table("recebiveis").select("id").eq("status", "travado").limit(500).execute().data or [])
    except Exception:
        pass
    try:
        rows = sb.table("shared_kv").select("key,value").like("key", "consistencia_telas:%").order("key", desc=True).limit(1).execute().data or []
        if rows:
            v = rows[0]["value"]; v = json.loads(v) if isinstance(v, str) else v
            V["O.divergencias"] = sum(1 for c in (v.get("checks") or []) if not c.get("ok"))
            V["_consist_de"] = rows[0]["key"].split(":", 1)[1]
    except Exception:
        pass
    return V


def montar(sb, ym, hoje, cfg, manual):
    ano, mes = int(ym[:4]), int(ym[5:7])
    avisos = []
    V = _valores(sb, ano, mes, hoje, avisos)
    ritmo = V.get("_ritmo", 100)
    man = (manual or {}).get(ym) or {}
    metas_cfg = (cfg or {}).get("metas") or {}
    donos = (cfg or {}).get("donos") or {}
    try:
        nomes = {u["id"]: u.get("name") for u in (sb.table("users").select("id,name").limit(500).execute().data or [])}
    except Exception:
        nomes = {}
    out = []
    for sc in CATALOGO:
        linhas = []
        for ind in sc["ind"]:
            if ind["manual"]:
                valor = _num(man.get(ind["id"]))
            else:
                valor = _num(V.get(ind["src"]))
            meta_auto = _num(V.get(ind["meta_src"])) if ind["meta_src"] else None
            if ind["id"] in metas_cfg and metas_cfg[ind["id"]] is not None:
                meta, meta_origem = _num(metas_cfg[ind["id"]]), "própria"
            elif meta_auto:
                meta, meta_origem = meta_auto, ("orçado" if str(ind["meta_src"]).endswith("_orc") else "aba Metas")
            elif ind["meta_pad"] is not None:
                meta, meta_origem = float(ind["meta_pad"]), "padrão"
            else:
                meta, meta_origem = None, None
            f, pct, esp = farol(valor, meta, ind["dir"], ind["acumula"], ritmo, ind["manual"])
            linhas.append({
                "id": ind["id"], "label": ind["label"], "un": ind["un"], "dir": ind["dir"], "acumula": ind["acumula"],
                "valor": valor, "meta": meta, "meta_origem": meta_origem, "pct": pct, "esperado": esp,
                "farol": f, "manual": ind["manual"], "nota": ind["nota"],
                "motivo": ("lançar valor" if ind["manual"] and valor is None else
                           "sem dado" if valor is None else
                           "acompanhamento — sem meta" if meta is None else None),
            })
        cont = {k: sum(1 for l in linhas if l["farol"] == k) for k in ("verde", "amarelo", "vermelho", "cinza", "info")}
        avaliados = cont["verde"] + cont["amarelo"] + cont["vermelho"]
        nota = round((cont["verde"] * 100 + cont["amarelo"] * 50) / avaliados) if avaliados else None
        dono = donos.get(sc["id"]) or sc["dono"]
        out.append({"id": sc["id"], "nome": sc["nome"], "grupo": sc["grupo"], "ico": sc["ico"], "nota_sc": sc["nota"],
                    "dono": dono, "dono_nome": nomes.get(dono) or dono,
                    "indicadores": linhas, "farois": cont, "saude": nota,
                    "farol": ("cinza" if nota is None else "verde" if nota >= 80 else "amarelo" if nota >= 55 else "vermelho")})
    return {"ok": True, "ym": ym, "ritmo": ritmo, "dados_de": V.get("_dados_de"), "consistencia_de": V.get("_consist_de"),
            "scorecards": out, "avisos": avisos, "regras": VERSAO_REGRAS,
            "calculado_em": datetime.now(timezone.utc).isoformat()}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try: params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception: params = {}
        hoje = _hoje()
        ym = (params.get("ym") or hoje.strftime("%Y-%m"))[:7]
        try: date(int(ym[:4]), int(ym[5:7]), 1)
        except Exception: return self._send(400, {"ok": False, "error": "ym inválido (AAAA-MM)"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        cfg, manual = _kv(sb, KV_CFG, {}), _kv(sb, KV_MANUAL, {})
        try:
            from _metricas_lib import versao_dados  # type: ignore
            versao = versao_dados(sb)
        except Exception:
            versao = ""
        assinatura = f"{VERSAO_REGRAS}|{versao}|{json.dumps(cfg, sort_keys=True)}|{json.dumps((manual or {}).get(ym), sort_keys=True)}"
        key = f"{KV_CACHE}:{ym}"
        if params.get("fresh") != "1":
            c = _kv(sb, key)
            if isinstance(c, dict) and c.get("assinatura") == assinatura:
                try:
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(c["_em"])).total_seconds()
                except Exception:
                    age = 1e9
                if age < CACHE_TTL:
                    return self._send(200, {**c["data"], "cached": True, "cache_age_s": int(age)})
        data = montar(sb, ym, hoje, cfg, manual)
        try: _kv_put(sb, key, {"assinatura": assinatura, "_em": datetime.now(timezone.utc).isoformat(), "data": data})
        except Exception: pass
        return self._send(200, {**data, "cached": False})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=10)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        act = body.get("action")
        try:
            if act == "set_meta":
                ind = body.get("ind")
                if ind not in IND_BY_ID: return self._send(400, {"ok": False, "error": "indicador desconhecido"})
                cfg = _kv(sb, KV_CFG, {}) or {}
                metas = cfg.setdefault("metas", {})
                v = body.get("meta")
                if v in (None, ""): metas.pop(ind, None)
                else: metas[ind] = float(v)
                _kv_put(sb, KV_CFG, cfg)
            elif act == "set_manual":
                ind, ym = body.get("ind"), str(body.get("ym") or "")[:7]
                if ind not in IND_BY_ID or not IND_BY_ID[ind]["manual"]:
                    return self._send(400, {"ok": False, "error": "indicador não é manual"})
                man = _kv(sb, KV_MANUAL, {}) or {}
                cell = man.setdefault(ym, {})
                v = body.get("valor")
                if v in (None, ""): cell.pop(ind, None)
                else: cell[ind] = float(v)
                _kv_put(sb, KV_MANUAL, man)
            elif act == "set_dono":
                sc = body.get("sc")
                if sc not in {s["id"] for s in CATALOGO}: return self._send(400, {"ok": False, "error": "scorecard desconhecido"})
                cfg = _kv(sb, KV_CFG, {}) or {}
                donos = cfg.setdefault("donos", {})
                if body.get("dono"): donos[sc] = str(body["dono"])
                else: donos.pop(sc, None)
                _kv_put(sb, KV_CFG, cfg)
            else:
                return self._send(400, {"ok": False, "error": "action inválida"})
        except (TypeError, ValueError):
            return self._send(400, {"ok": False, "error": "valor inválido"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"scorecard.{act}", target_type="scorecard", target_id=str(body.get("ind") or body.get("sc") or ""),
              notes=json.dumps({k: body.get(k) for k in ("ym", "meta", "valor", "dono") if k in body}, ensure_ascii=False)[:200])
        return self._send(200, {"ok": True})
