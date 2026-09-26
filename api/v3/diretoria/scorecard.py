"""GET/POST /api/v3/diretoria/scorecard — 📊 Scorecards padrão da Diretoria (v88.26)

Um só formato de placar para a Presidência, cada Unidade de Negócio e cada Área:
indicador · realizado · meta · % · FAROL · dono · fonte. Mesma régua pra todos.

GET  ?ym=2026-09[&fresh=1]   (lvl >= 5) — sócio (lvl 10) vê todos os placares; os demais veem SÓ
     os placares de que são DONOS (ex.: Kaue → Conquista e Comercial), sem Presidência/Financeiro.
     A tela aparece no menu pra quem o sócio liberar na matriz de permissões.
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
    viab_trafego_real por conta → marca (mapa salvo; vazio = MAPA_PADRAO) · Pró-labore: Plano de Resgate.
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
KV_HIST = "scorecard_hist"   # v88.30: {ym: {tipo, em, ritmo, ind: {id: [valor, meta, farol]}, sc: {id: saude}}}
# Indicadores de FOTO (estado do momento, não soma do mês): não dá pra reconstruir o passado —
# só entram no histórico quando registrados no próprio mês (leitura do mês corrente ou fechamento do dia 1º).
FOTO_SRC = ("L.", "R.", "E.corretores", "E.gestores", "Q.conquista.corretores", "E.sem_valor",
            "E.sem_equipe_abertos", "E.cobertura_pipeline", "Q.imoveis.quente_vgv", "O.divergencias")
def _foto(ind):
    return bool(ind.get("src")) and str(ind["src"]).startswith(FOTO_SRC)
CACHE_TTL = 600
VERSAO_REGRAS = "v3"   # v3: histórico (fotos do passado não repetem o valor de hoje)
# (v2)   # v2: pró-labore na conta, cobertura pela contribuição, CPL sem gasto = sem dado, saúde c/ base mínima


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
        I("p.resultado", "Resultado do mês (projetado, com pró-labore)", "R$", "maior", False, "F.resultado_proj", meta_pad=0,
          nota="contribuição projetada pro fim do mês − custo fixo orçado − pró-labore − mídia real. Regra do Positivo: ≥ 0"),
        I("p.breakeven", "Cobertura da conta cheia (projetada)", "%", "maior", False, "F.cobertura_be", meta_pad=100,
          nota="contribuição projetada ÷ (custo fixo + pró-labore + mídia). 100% = mês no zero a zero"),
        I("p.midia", "Investimento em mídia (Meta)", "R$", "menor", True, "M.spend_total", "M.spend_orc", nota="meta = verba de tráfego orçada no mês"),
        I("p.cac", "CAC de mídia", "R$", "menor", False, "M.cac_total", nota="mídia ÷ vendas de tráfego pago"),
        I("p.pipeline", "Pipeline comprometido × falta pra meta", "%", "maior", False, "E.cobertura_pipeline", meta_pad=100,
          nota="VGV em proposta/pasta das equipes ativas ÷ o que falta pra bater a meta do mês (negócio sem equipe fica fora)"),
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
     "nota": "Alto padrão e terceiros: equipes map + terceiros + a venda própria dos sócios (Paulo e Isa estão sem equipe no cadastro).", "ind": [
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
        I("co.semequipe", "Negócios abertos sem equipe (higiene do RD)", "n", "menor", False, "E.sem_equipe_abertos", meta_pad=0,
          nota="abertos de corretor que saiu ou sem dono — redistribuir ou encerrar no RD"),
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
        I("f.fixo", "Conta cheia do mês", "R$", "menor", False, "F.conta_cheia",
          nota="custo fixo orçado (Orçado × Realizado, sem mídia) + pró-labore (Plano de Resgate) + mídia real"),
        I("f.resultado", "Resultado do mês (projetado, com pró-labore)", "R$", "maior", False, "F.resultado_proj", meta_pad=0),
        I("f.be", "Cobertura da conta cheia (projetada)", "%", "maior", False, "F.cobertura_be", meta_pad=100),
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
        erros_motor = [a.get("txt") for a in (r.get("avisos") or []) if isinstance(a, dict) and a.get("tipo") == "erro_dados"]
        if erros_motor:
            avisos.append("Motor comercial: leitura de negócios do RD falhou nesta rodada — pipeline e funil podem estar incompletos. Use ↻ Recalcular.")

        def bloco(pref, b):
            if not b: return
            meta = b.get("meta") or {}
            pipe = b.get("pipeline") or {}
            for k in ("vgv", "vendas", "vendas_pago_psm", "leads", "agendamentos", "visitas", "propostas", "ticket"):
                V[f"{pref}.{k}"] = b.get(k)
            for k in ("meta_vgv", "meta_vendas", "meta_agendamentos", "meta_visitas", "meta_propostas"):
                V[f"{pref}.{k}"] = meta.get(k) or None
            V[f"{pref}.quente_vgv"] = pipe.get("quente_vgv")
            V[f"{pref}.sem_valor"] = pipe.get("sem_valor")
            V[f"{pref}.ponderado_vgv"] = pipe.get("ponderado_vgv")
            V[f"{pref}.comprometido_vgv"] = pipe.get("comprometido_vgv")
            # v88.47 (§2): conversão lead→venda = vendas de tráfego pago ÷ leads (antes vendas de TODAS as
            # origens ÷ leads só pagos — inflava). Sem o campo no motor (versão velha), fica sem número.
            V[f"{pref}.conv"] = _div(b.get("vendas_pago_psm"), b.get("leads"), 100) if b.get("vendas_pago_psm") is not None else None
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
        if erros_motor:   # pipeline 0 por falha de leitura não é "pipeline vazio"
            for k in [k for k in V if k.endswith((".ponderado_vgv", ".quente_vgv", ".sem_valor", ".comprometido_vgv"))]:
                V[k] = None
        falta = max(0.0, float(V.get("E.meta_vgv") or 0) - float(V.get("E.vgv") or 0))
        # comprometido só das equipes ATIVAS: "sem_equipe" guarda ~9 mil abertos de quem saiu / leads antigos
        # e inflava o pipeline da empresa (ponderado R$ 89 mi num mês de meta R$ 4,5 mi)
        ativos = [t for t in eq if t not in ("sem_equipe", "geral")]
        comp = None if erros_motor else sum(float(((eq.get(t) or {}).get("pipeline") or {}).get("comprometido_vgv") or 0) for t in ativos)
        V["E.comprometido_ativos"] = comp
        V["E.sem_equipe_abertos"] = ((eq.get("sem_equipe") or {}).get("pipeline") or {}).get("abertos")
        V["E.cobertura_pipeline"] = (None if comp is None else
                                     100.0 if falta == 0 and V.get("E.meta_vgv") else _div(comp, falta, 100))
        bloco("Q.conquista", eq.get("conquista"))
        # PSM Imóveis = map + terceiros (soma campo a campo)
        m_, t_ = eq.get("map") or {}, eq.get("terceiros") or {}
        # sócios sem equipe no cadastro (Paulo/Isa = closers do MAP no Plano de Resgate): a meta e a venda
        # própria deles caem em "sem_equipe" — somam aqui pra PSM Imóveis não ficar sem os dois
        try:
            socios = [u["id"] for u in (sb.table("users").select("id,role,team,status").execute().data or [])
                      if (u.get("role") or "").lower() == "socio" and not (u.get("team") or "").strip()
                      and str(u.get("status") or "ativo").lower() in ("ativo", "active")]
        except Exception:
            socios = []
        pes = r.get("pessoas") or {}
        blocos_im = [m_, t_] + [pes[s] for s in socios if isinstance(pes.get(s), dict)]
        V["Q.map.leads"] = m_.get("leads")
        soma = {k: sum(float(b.get(k) or 0) for b in blocos_im)
                for k in ("vgv", "vendas", "leads", "agendamentos", "visitas", "propostas", "n_corretores", "n_gestores")}
        soma["meta"] = {k: sum(float((b.get("meta") or {}).get(k) or 0) for b in blocos_im)
                        for k in ("meta_vgv", "meta_vendas", "meta_agendamentos", "meta_visitas", "meta_propostas")}
        soma["pipeline"] = {k: sum(float((b.get("pipeline") or {}).get(k) or 0) for b in blocos_im)
                            for k in ("quente_vgv", "comprometido_vgv", "ponderado_vgv", "sem_valor")}
        bloco("Q.imoveis", soma)
        if erros_motor:   # repete depois dos blocos por equipe (Conquista/Imóveis) — nenhum pipeline 0 falso
            for k in [k for k in V if k.endswith((".ponderado_vgv", ".quente_vgv", ".sem_valor", ".comprometido_vgv"))]:
                V[k] = None
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
        # Regra do Positivo: pró-labore DENTRO da conta (não está no orçamento de custos — vem do Plano de Resgate)
        plano = viab.read_kv(sb, "plano_resgate_2026") or {}
        pro_labore = float(((plano.get("constantes") or {}).get("pro_labore_mes")) or 0)
        conta = fixo + pro_labore + spend
        V["F.pro_labore"] = pro_labore
        V["F.conta_cheia"] = round(conta, 2)
        contrib_proj = V["F.contrib"] / (ritmo / 100.0) if 0 < ritmo < 100 else V["F.contrib"]
        V["F.resultado_proj"] = round(contrib_proj - conta, 2)
        # cobertura pela CONTRIBUIÇÃO (não pelo break_even de mix igual: a Locação tem margem de 42%
        # sobre aluguel e distorcia a média — dava "141% coberto" com o mês no vermelho)
        V["F.cobertura_be"] = _div(contrib_proj, conta, 100)
    except Exception as e:
        avisos.append(f"Financeiro indisponível: {e}")

    # 3) mídia por marca (Meta Ads efetivo) → CPL / CAC
    try:
        import trafego_real  # type: ignore
        # o mapa conta→marca salvo (viab_trafego_map) pode estar sem contas — aí vale o MAPA_PADRAO
        mapa = trafego_real._mapa(sb)
        for l, contas in trafego_real.MAPA_PADRAO.items():
            if not mapa.get(l): mapa[l] = list(contas)
        real_m = ((viab.read_kv(sb, trafego_real.KV_REAL).get(str(ano)) or {}).get(str(mes)) or {})
        over_m = (viab.read_kv(sb, trafego_real.KV_OVER).get(str(ano)) or {})
        def gasto(l):
            ov = (over_m.get(l) or {}).get(str(mes))
            if ov not in (None, ""): return float(ov)
            return sum(float((real_m.get(a) or {}).get("spend") or 0) for a in mapa.get(l, []))
        for l, lk in (("conquista", "Q.conquista.leads"), ("map", "Q.map.leads")):
            g = gasto(l)
            V[f"M.spend.{l}"] = g or None
            V[f"M.cpl.{l}"] = _div(g, V.get(lk)) if g > 0 else None
    except Exception as e:
        avisos.append(f"Mídia por marca indisponível: {e}")
    V["M.cpl_total"] = _div(V.get("M.spend_total"), V.get("E.leads")) if V.get("M.spend_total") else None
    # v88.47 (§2): CAC de mídia = mídia ÷ vendas de TRÁFEGO PAGO PSM (antes ÷ todas as vendas → CAC menor)
    V["M.cac_total"] = _div(V.get("M.spend_total"), V.get("E.vendas_pago_psm")) if V.get("M.spend_total") else None

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
        V["_amostra.O.nps"] = f"amostra: {len(notas)} pesquisa(s) no mês" + (" — pequena demais pra conclusão" if 0 < len(notas) < 10 else "")
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


def montar(sb, ym, hoje, cfg, manual, hist=None, fotos=None):
    ano, mes = int(ym[:4]), int(ym[5:7])
    passado = ym < hoje.strftime("%Y-%m")
    reg = ((hist or {}).get(ym) or {}).get("ind") or {}
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
            sem_foto = False
            if ind["manual"]:
                valor = _num(man.get(ind["id"]))
            elif passado and _foto(ind):
                # mês passado: a foto de HOJE não vale pro passado — usa a registrada no mês, se houver
                valor = _num((reg.get(ind["id"]) or [None])[0])
                if valor is None and fotos is not None:   # fechamento do dia 1º: foto do fim do mês
                    valor = _num(fotos.get(ind["id"]))
                sem_foto = valor is None
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
                "farol": f, "manual": ind["manual"], "nota": ind["nota"], "amostra": V.get(f"_amostra.{ind['src']}"),
                "foto": _foto(ind),
                "motivo": ("foto não registrada neste mês" if sem_foto else
                           "lançar valor" if ind["manual"] and valor is None else
                           "sem dado" if valor is None else
                           "acompanhamento — sem meta" if meta is None else None),
            })
        cont = {k: sum(1 for l in linhas if l["farol"] == k) for k in ("verde", "amarelo", "vermelho", "cinza", "info")}
        avaliados = cont["verde"] + cont["amarelo"] + cont["vermelho"]
        # saúde só com base mínima: ≥ 2 indicadores e ≥ 40% do placar avaliados (senão 1 verde vira "100")
        base_ok = avaliados >= 2 and avaliados >= 0.4 * len(linhas)
        nota = round((cont["verde"] * 100 + cont["amarelo"] * 50) / avaliados) if base_ok else None
        dono = donos.get(sc["id"]) or sc["dono"]
        out.append({"id": sc["id"], "nome": sc["nome"], "grupo": sc["grupo"], "ico": sc["ico"], "nota_sc": sc["nota"],
                    "dono": dono, "dono_nome": nomes.get(dono) or dono,
                    "indicadores": linhas, "farois": cont, "saude": nota, "avaliados": avaliados, "total": len(linhas),
                    "farol": ("cinza" if nota is None else "verde" if nota >= 80 else "amarelo" if nota >= 55 else "vermelho")})
    return {"ok": True, "ym": ym, "ritmo": ritmo, "dados_de": V.get("_dados_de"), "consistencia_de": V.get("_consist_de"),
            "scorecards": out, "avisos": avisos, "regras": VERSAO_REGRAS,
            "calculado_em": datetime.now(timezone.utc).isoformat()}


def registrar(sb, ym, data, tipo):
    """Grava a foto compacta do mês no histórico. 'final' (fechamento do dia 1º) nunca é rebaixado."""
    hist = _kv(sb, KV_HIST, {}) or {}
    atual = hist.get(ym) or {}
    if atual.get("tipo") == "final" and tipo != "final":
        return False
    hist[ym] = {"tipo": tipo, "em": datetime.now(timezone.utc).isoformat(), "ritmo": data.get("ritmo"),
                "ind": {i["id"]: [i["valor"], i["meta"], i["farol"]] for s in data["scorecards"] for i in s["indicadores"]},
                "sc": {s["id"]: s["saude"] for s in data["scorecards"]}}
    _kv_put(sb, KV_HIST, hist)
    return True


def meses_ate(ym, n):
    a, m = int(ym[:4]), int(ym[5:7])
    out = []
    for _ in range(n):
        out.append(f"{a}-{m:02d}")
        m -= 1
        if m == 0: a, m = a - 1, 12
    return list(reversed(out))


def historico(sb, hoje, n, scs_visiveis=None):
    hist = _kv(sb, KV_HIST, {}) or {}
    atual = hoje.strftime("%Y-%m")
    meses = meses_ate(atual, n)
    cat = [sc for sc in CATALOGO if scs_visiveis is None or sc["id"] in scs_visiveis]
    return {
        "ok": True, "meses": meses,
        "registros": {ym: {"tipo": (hist.get(ym) or {}).get("tipo"), "em": (hist.get(ym) or {}).get("em")} for ym in meses},
        "faltando": [ym for ym in meses if ym < atual and ym not in hist and ym >= "2026-01"],
        "saude": {sc["id"]: [((hist.get(ym) or {}).get("sc") or {}).get(sc["id"]) for ym in meses] for sc in cat},
        "series": {i["id"]: [(((hist.get(ym) or {}).get("ind") or {}).get(i["id"]) or [None, None, None]) for ym in meses]
                   for sc in cat for i in sc["ind"]},
        "scorecards": [{"id": sc["id"], "nome": sc["nome"], "ico": sc["ico"]} for sc in cat],
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _visao(self, data, user):
        """Sócio vê tudo; os demais só os placares de que são donos (placar é do dono, não da empresa toda)."""
        if (user.get("lvl") or 0) >= 10:
            return data
        meus = [s for s in data.get("scorecards") or [] if s.get("dono") == user.get("id")]
        return {**data, "scorecards": meus, "escopo": "dono",
                "avisos": [] if meus else ["Você ainda não é dono de nenhum placar — o sócio define os donos nesta tela."]}

    def _cron_ok(self):
        secret = os.environ.get("CRON_SECRET")
        if not secret: return False
        auth = self.headers.get("Authorization") or self.headers.get("authorization") or ""
        return auth.lower().startswith("bearer ") and auth[7:].strip() == secret

    def do_GET(self):
        try: params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception: params = {}
        hoje = _hoje()
        # Cron do dia 1º (Vercel): FECHA o mês anterior no histórico (tipo 'final', com as fotos do fim do mês)
        if params.get("cron") == "1" and self._cron_ok():
            sb = supabase_client()
            if not sb: return self._send(503, {"ok": False, "error": "backend"})
            ant = meses_ate(hoje.strftime("%Y-%m"), 2)[0]
            cfg, manual = _kv(sb, KV_CFG, {}), _kv(sb, KV_MANUAL, {})
            hist = _kv(sb, KV_HIST, {}) or {}
            # fotos do mês que fechou = as últimas registradas nele (leitura do mês corrente) ou as de agora
            agora = montar(sb, hoje.strftime("%Y-%m"), hoje, cfg, manual, hist)
            fotos = {i["id"]: i["valor"] for s in agora["scorecards"] for i in s["indicadores"] if i.get("foto")}
            data = montar(sb, ant, hoje, cfg, manual, hist, fotos)
            registrar(sb, ant, data, "final")
            registrar(sb, hoje.strftime("%Y-%m"), agora, "parcial")
            return self._send(200, {"ok": True, "fechado": ant})
        try: user = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        if params.get("hist"):
            sb = supabase_client()
            if not sb: return self._send(503, {"ok": False, "error": "backend"})
            try: n = max(3, min(24, int(params["hist"])))
            except Exception: n = 12
            vis = None
            if (user.get("lvl") or 0) < 10:
                donos = ((_kv(sb, KV_CFG, {}) or {}).get("donos") or {})
                vis = {sc["id"] for sc in CATALOGO if (donos.get(sc["id"]) or sc["dono"]) == user.get("id")}
            return self._send(200, historico(sb, hoje, n, vis))
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
                    return self._send(200, {**self._visao(c["data"], user), "cached": True, "cache_age_s": int(age)})
        hist = _kv(sb, KV_HIST, {}) or {}
        data = montar(sb, ym, hoje, cfg, manual, hist)
        try: _kv_put(sb, key, {"assinatura": assinatura, "_em": datetime.now(timezone.utc).isoformat(), "data": data})
        except Exception: pass
        # histórico: mês corrente = parcial (atualiza a cada cálculo); mês passado sem registro = reconstruído
        try:
            if ym == hoje.strftime("%Y-%m"): registrar(sb, ym, data, "parcial")
            elif (hist.get(ym) or {}).get("tipo") != "final": registrar(sb, ym, data, "reconstruido")
        except Exception: pass
        return self._send(200, {**self._visao(data, user), "cached": False})

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
