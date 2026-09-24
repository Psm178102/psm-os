"""
_metricas_lib.py — MOTOR ÚNICO de métricas comerciais do House PSM. v87.86

Implementa o Dicionário de Métricas v1 (docs/DICIONARIO-METRICAS.md, ratificado pelo
Paulo em 15/09/2026). Toda tela que mostra venda, VGV, lead, em atendimento, funil,
meta ou atingimento lê DAQUI — nunca recalcula por conta própria.

Como importar de qualquer pasta de api/v3/<modulo>/:
    _V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _V3 not in sys.path: sys.path.append(_V3)
    from _metricas_lib import resumo, janela_de, filtrar_por_viewer

"Tempo real" (pedido do Paulo 15/set): o cache é versionado pela ÚLTIMA sincronização do
RD (max(deals.synced_at)). Qualquer negócio novo/alterado muda a versão e todas as telas
recalculam juntas — nenhuma fica com retrato velho enquanto outra já mostra o novo.
"""
import json
import re
import time
import unicodedata
from datetime import datetime, timezone, timedelta, date

BRT = timezone(timedelta(hours=-3))
# ⚠️ Bumpar o sufixo (v2, v3…) SEMPRE que o formato do retrato mudar: o cache é versionado pelo
# sync do RD, não pelo código — em 16/09 a v87.87 leu retratos da v87.86 sem pipeline/previsto/norte.
CACHE_KEY = "metricas_resumo:v7"   # v88.37: visita do MAP = maior entre tarefa e coluna, creditada ao dono do negócio · v88.34: origem = "Origem do cliente" (campo personalizado do RD) antes do deal_source
CACHE_TTL = 600          # segurança: mesmo sem sync novo, recalcula a cada 10 min
LOCK_TTL = 90            # v88.40: janela da trava de cálculo único (o cálculo leva 5–40 s)
STALE_MAX = 3600         # v88.40: com cálculo em andamento, serve a foto anterior se tiver < 1 h
HUB_TTL = 300            # esteira do PSM HUB (externa) — 5 min
KV_ORIGENS = "dic_origens"   # override editável da tabela de origens (Configurações → Dicionário)

# ─── §2 Origem: nome no RD (minúsculo, sem acento) → categoria ───────────────
ORIGENS_PADRAO = {
    # tráfego pago da PSM (LEAD)
    "busca paga | ads psm": "trafego_pago_psm",
    "busca paga | facebook ads": "trafego_pago_psm",
    "busca paga | google": "trafego_pago_psm",
    "ads campanha whatsapp psm": "trafego_pago_psm",
    # tráfego pago do corretor (LEAD, linha separada)
    "busca paga | ads kaue": "trafego_pago_corretor",
    "busca paga | ads corretor": "trafego_pago_corretor",
    # orgânico e site
    "social | facebook": "organico_site",
    "social | instagram": "organico_site",
    "instagram corretor": "organico_site",
    "insta psm imoveis": "organico_site",
    "marketplace face corretor": "organico_site",
    "pap digital corretor": "organico_site",
    "grupo zap": "organico_site",
    "contato pelo site": "organico_site",
    "contato por cel da psm": "organico_site",
    "contato por e-mail": "organico_site",
    "referencia | psmconquista.com.br": "organico_site",
    "trafego direto": "organico_site",
    # carteira / indicação / networking / reativação
    "carteira do corretor": "carteira",
    "plantao": "carteira",
    "ativo de rua": "carteira",
    "indicacao": "indicacao",
    "networking": "networking",
    "reativacao": "reativacao",
    "lista": "reativacao",
    # v88.34: valores do campo personalizado "Origem do cliente" do RD (o que a equipe preenche desde ago/26)
    "trafego pago psm": "trafego_pago_psm",
    "trafego pago corretor": "trafego_pago_corretor",
    "instagram psm": "organico_site",
    "whatsapp psm": "organico_site",
    "marketplace": "organico_site",
    "pap digital": "organico_site",
    "carteira": "carteira",
}
# sem origem / desconhecido → assume tráfego pago da PSM (decisão do Paulo), com aviso
ORIGENS_ASSUMIDAS = {"", "desconhecido"}
CATEGORIAS = ("trafego_pago_psm", "trafego_pago_corretor", "organico_site", "carteira",
              "indicacao", "networking", "reativacao", "nao_classificada")
CAT_LABEL = {"trafego_pago_psm": "Tráfego pago PSM", "trafego_pago_corretor": "Tráfego pago do corretor",
             "organico_site": "Orgânico e site", "carteira": "Carteira", "indicacao": "Indicação",
             "networking": "Networking", "reativacao": "Reativação", "nao_classificada": "Não classificada"}
LEAD_CATS = ("trafego_pago_psm", "trafego_pago_corretor")
CAT_TEAM = {"conquista": "Conquista", "map": "MAP", "terceiros": "Terceiros", "locacao": "Locação"}

# ─── §5 Marcos MAP/Terceiros/Locação: chave da coluna (rd_stages.psm_stage_key) → métrica ──
COLUNA_METRICA = {
    "novo_atend": "atendimentos", "contato_qual": "qualificados",
    "precisa_ag": "agendamentos", "vis_agend": "agendamentos",
    "vis_real": "visitas_coluna", "proposta": "propostas", "contrato": "contratos",
}
MARCOS_RD = ("atendimentos", "qualificados", "agendamentos", "visitas_coluna", "propostas", "contratos")
MARCOS_HUB = ("prospeccao", "qualificacao", "agendamento", "atendimento", "pasta")
METAS_CAMPOS = ("meta_vgv", "meta_vendas", "meta_visitas", "meta_pastas", "meta_propostas", "meta_agendamentos")


# ─── utilidades ──────────────────────────────────────────────────────────────
def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip().lower()


def agora_brt():
    return datetime.now(timezone.utc).astimezone(BRT)


def hoje_brt():
    return agora_brt().date()


def parse_dt(v):
    if not v:
        return None
    try:
        s = str(v).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def to_brt(v):
    dt = parse_dt(v)
    return dt.astimezone(BRT) if dt else None


def janela_de(params, hoje=None):
    """§0 Período: padrão = mês corrente, dia 1 até hoje (Brasília). Presets nomeados:
    this_month | last_month | last_30d | last_90d | this_year; ou since/until (YYYY-MM-DD)."""
    hoje = hoje or hoje_brt()
    p = params or {}
    if p.get("since") and p.get("until"):
        try:
            s, u = date.fromisoformat(p["since"][:10]), date.fromisoformat(p["until"][:10])
            if s <= u:
                # v88.11: período todo no futuro (ex.: 4º tri em setembro) não pode virar janela
                # invertida (01/10→23/09 zerava meta e realizado) — mantém o período pedido
                return s, (min(u, hoje) if s <= hoje else u)
        except Exception:
            pass
    preset = (p.get("preset") or p.get("date_preset") or "this_month").lower()
    if preset == "last_month":
        fim = hoje.replace(day=1) - timedelta(days=1)
        return fim.replace(day=1), fim
    if preset == "last_30d":
        return hoje - timedelta(days=29), hoje
    if preset == "last_90d":
        return hoje - timedelta(days=89), hoje
    if preset == "this_year":
        return hoje.replace(month=1, day=1), hoje
    return hoje.replace(day=1), hoje


def limites_utc(since_d, until_d):
    ini = datetime(since_d.year, since_d.month, since_d.day, tzinfo=BRT).astimezone(timezone.utc)
    fim = (datetime(until_d.year, until_d.month, until_d.day, tzinfo=BRT) + timedelta(days=1)).astimezone(timezone.utc)
    return ini, fim


def meses_da_janela(since_d, until_d):
    out, y, m = [], since_d.year, since_d.month
    while (y, m) <= (until_d.year, until_d.month):
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def vgv_de(d):
    """§1 Valor: amount → rd_raw.amount_total → rd_raw.amount_unique."""
    for v in (d.get("amount"), d.get("amt_total"), d.get("amt_unique")):
        try:
            if v not in (None, "") and float(v) > 0:
                return float(v)
        except (TypeError, ValueError):
            pass
    return 0.0


def is_gestor(role):
    r = (role or "").strip().lower()
    return r.startswith("gerente") or r.startswith("lider") or r == "líder"


def team_key(team):
    t = _norm(team)
    if "conquista" in t:
        return "conquista"
    if "map" in t:
        return "map"
    if "tercei" in t:
        return "terceiros"
    if "loca" in t:
        return "locacao"
    return t or "sem_equipe"


def _kv_read(sb, key):
    try:
        rows = sb.table("shared_kv").select("value,updated_at").eq("key", key).limit(1).execute().data or []
        if not rows:
            return None
        v = rows[0]["value"]
        return json.loads(v) if isinstance(v, str) else v
    except Exception:
        return None


def _kv_write(sb, key, value):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": value,
                                      "updated_at": datetime.now(timezone.utc).isoformat()},
                                     on_conflict="key").execute()
    except Exception:
        pass


def _paginado(build, cap=60, keyset=None):
    """Lê em páginas de 1000. v88.31:
    • keyset="id" → página por CHAVE (id > último lido) em vez de OFFSET. Com OFFSET cada página
      re-varre tudo o que já foi lido: nos ~12,5 mil abertos a 12ª página custava 1,16 s e a leitura
      inteira encostava nos 8 s do statement_timeout do Supabase — sob o sync do RD estourava (57014)
      e o motor zerava pipeline/funil em todas as telas. Por chave: ~40 ms por página, do início ao fim.
      Exige build() ordenado pela mesma chave e com ela no select.
    • toda página tenta de novo (até 2x) quando o banco cancela por tempo, em vez de desistir."""
    out, pg, ultimo = [], 0, None
    while True:
        for tentativa in range(3):
            try:
                if keyset:
                    q = build()
                    if ultimo is not None:
                        q = q.gt(keyset, ultimo)
                    rows = q.limit(1000).execute().data or []
                else:
                    rows = build().range(pg * 1000, pg * 1000 + 999).execute().data or []
                break
            except Exception as e:
                if tentativa == 2 or not ("57014" in str(e) or "timeout" in str(e).lower()):
                    raise
                time.sleep(0.8 * (tentativa + 1))
        out.extend(rows)
        if len(rows) < 1000 or pg >= cap:
            break
        if keyset:
            ultimo = rows[-1].get(keyset)
            if ultimo is None:
                break
        pg += 1
    return out


def versao_deals(sb):
    """Versão do dado = último synced_at da tabela deals (muda a cada sync/webhook)."""
    try:
        r = sb.table("deals").select("synced_at").order("synced_at", desc=True).limit(1).execute().data or []
        return str((r[0] or {}).get("synced_at") or "") if r else ""
    except Exception:
        return ""


def ultimo_sync_rd(sb):
    """v88.40: hora do último sync bem-sucedido do RD (frescor pra exibir "dados de HH:MM" e
    pros alarmes). O sync agora só grava negócio que mudou, então max(synced_at) = último dado
    NOVO (é a versão do cache), e este = última vez que o RD foi conferido."""
    cands = [versao_deals(sb)]
    try:
        v = _kv_read(sb, "rd_sync_ultimo")
        if isinstance(v, dict) and v.get("ts"):
            cands.append(v["ts"])
    except Exception:
        pass
    dts = [d for d in (parse_dt(c) for c in cands if c) if d]
    return max(dts).isoformat() if dts else ""


def versao_dados(sb):
    """Chave de cache = versão dos deals + última meta salva (v88.11: meta nova na aba Metas
    invalida o cache de TODAS as telas na hora). Só pra comparar — pra exibir data use versao_deals."""
    v = versao_deals(sb)
    try:
        m = sb.table("metas").select("updated_at").order("updated_at", desc=True).limit(1).execute().data or []
        if m and (m[0] or {}).get("updated_at"):
            v += "|m" + str(m[0]["updated_at"])
    except Exception:
        pass
    return v


# ─── origem ──────────────────────────────────────────────────────────────────
def mapa_origens(sb):
    mapa = dict(ORIGENS_PADRAO)
    ovr = _kv_read(sb, KV_ORIGENS)
    if isinstance(ovr, dict):
        for k, v in ovr.items():
            if v in CATEGORIAS:
                mapa[_norm(k)] = v
    return mapa


def origem_nome(d):
    """v88.34: origem do negócio = campo personalizado "Origem do cliente" do RD (coluna deals.origem_cliente,
    preenchida por gatilho) e, vazio, o "Fonte" padrão (deal_source). Desde ago/26 a equipe preenche o
    personalizado em ~98% dos negócios; o deal_source ficava vazio em ~30% e nunca tinha indicação/carteira."""
    return (d.get("oc") or "").strip() or d.get("src")


def origem_categoria(nome, mapa):
    """→ (categoria, assumida). Sem origem/desconhecido = trafego_pago_psm assumido (§2)."""
    n = _norm(nome)
    if n in ORIGENS_ASSUMIDAS:
        return "trafego_pago_psm", True
    cat = mapa.get(n)
    if cat:
        return cat, False
    return "nao_classificada", False


# ─── PSM HUB (esteira da Conquista, mensal) ──────────────────────────────────
def hub_esteira(sb, y, m):
    """{'rows':[...], 'ok':bool, 'erro':str|None, 'fetched_at':iso} com cache de 5 min."""
    key = f"metricas_hub:{y:04d}-{m:02d}"
    c = _kv_read(sb, key)
    if isinstance(c, dict) and c.get("fetched_at"):
        ts = parse_dt(c["fetched_at"])
        if ts and (datetime.now(timezone.utc) - ts).total_seconds() < HUB_TTL:
            return c
    out = {"rows": [], "ok": False, "erro": None, "fetched_at": datetime.now(timezone.utc).isoformat()}
    try:
        import os, sys
        _v3 = os.path.dirname(os.path.abspath(__file__))
        _oo = os.path.join(_v3, "oo")
        if _oo not in sys.path:
            sys.path.append(_oo)
        import _psmhub_lib as hub  # type: ignore
        if not hub.configured():
            out["erro"] = "PSM HUB não configurado (PSMHUB_EMAIL/PASSWORD)"
        else:
            est = hub.get(f"/api/dashboard/esteira?period=mensal&month={m}&year={y}")
            rows = est if isinstance(est, list) else ((est or {}).get("rows") or [])
            out["rows"] = [r for r in rows if isinstance(r, dict)]
            out["ok"] = True
    except Exception as e:
        out["erro"] = str(e)[:160]
    if out["ok"]:
        _kv_write(sb, key, out)
    return out


# ─── carga ───────────────────────────────────────────────────────────────────
def carregar(sb, since_d, until_d):
    ini, fim = limites_utc(since_d, until_d)
    ini_iso, fim_iso = ini.isoformat(), fim.isoformat()
    avisos = []

    users = sb.table("users").select("id,name,email,role,team,status,is_service").execute().data or []
    users = [u for u in users if u.get("id")]
    pessoas = [u for u in users if not u.get("is_service")]
    email2uid = {(u.get("email") or "").lower(): u["id"] for u in pessoas if u.get("email")}
    servico_emails = {(u.get("email") or "").lower() for u in users if u.get("is_service") and u.get("email")}

    cols = ("id,amount,win,closed_at,created_at_rd,updated_at_rd,stage_id,stage_name,pipeline_id,pipeline_name,"
            "user_id,user_email,synced_at,"
            "src:rd_raw->deal_source->>name,oc:origem_cliente,amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique,"
            "la:rd_raw->>last_activity_at,nint:rd_raw->interactions")
    # negócios que TOCAM a janela: criados nela, fechados nela, ou ainda abertos (em atendimento)
    deals = {}
    for build in (
        lambda: sb.table("deals").select(cols).gte("created_at_rd", ini_iso).lt("created_at_rd", fim_iso).order("id"),
        lambda: sb.table("deals").select(cols).gte("closed_at", ini_iso).lt("closed_at", fim_iso).order("id"),
        lambda: sb.table("deals").select(cols).is_("win", "null").order("id"),
    ):
        try:
            for d in _paginado(build, keyset="id"):   # v88.31: por chave (os 3 builds ordenam por id)
                deals[str(d["id"])] = d
        except Exception as e:
            avisos.append({"tipo": "erro_dados", "txt": f"⚠️ Leitura de negócios do RD falhou ({str(e)[:80]}). Números podem estar incompletos.", "n": 1})

    # etapas do RD → chave de marco
    stage_key = {}
    try:
        for s in (sb.table("rd_stages").select("id,psm_stage_key").execute().data or []):
            if s.get("id") and s.get("psm_stage_key"):
                stage_key[str(s["id"])] = s["psm_stage_key"]
    except Exception:
        pass
    if not stage_key:
        avisos.append({"tipo": "erro_dados", "txt": "⚠️ Etapas do RD indisponíveis: agendamentos, visitas, propostas e contratos podem aparecer zerados.", "n": 1})

    # entradas em coluna dentro da janela (MAP/Terceiros/Locação)
    eventos = []
    try:
        eventos = _paginado(lambda: sb.table("deal_stage_events")
                            .select("deal_id,stage_id,occurred_at,user_email")
                            .gte("occurred_at", ini_iso).lt("occurred_at", fim_iso)
                            .neq("source", "backfill").order("id"))
    except Exception:
        avisos.append({"tipo": "erro_dados", "txt": "⚠️ Histórico de etapas do RD indisponível: marcos por coluna podem estar subcontados.", "n": 1})

    # tarefas de VISITA concluídas (§5) — tabela rd_tasks (sync em crm/tasks_sync)
    tarefas, tarefas_ok = [], True
    try:
        tarefas = _paginado(lambda: sb.table("rd_tasks").select("id,deal_id,user_email,done_date")
                            .eq("type", "visit").eq("done", True)
                            .gte("done_date", ini_iso).lt("done_date", fim_iso).order("id"), cap=10)
    except Exception:
        tarefas_ok = False

    # metas dos meses da janela
    metas = []
    try:
        anos = sorted({y for y, _ in meses_da_janela(since_d, until_d)})
        for a in anos:
            metas += sb.table("metas").select("*").eq("ano", a).execute().data or []
    except Exception:
        avisos.append({"tipo": "erro_dados", "txt": "⚠️ Metas indisponíveis agora.", "n": 1})

    # fechados dos últimos 120 dias (taxa real por canal → pipeline ponderado, §8)
    closed120 = []
    try:
        c_ini = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
        closed120 = [d for d in _paginado(lambda: sb.table("deals")
                                          .select("win,user_id,user_email,amount,src:rd_raw->deal_source->>name,"
                                                  "amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique")
                                          .gte("closed_at", c_ini).order("id"), cap=10)
                     if d.get("win") is not None]
    except Exception:
        pass

    # Norte do Mês declarado (§8) — 1 leitura por mês da janela
    norte_cfg = {}
    try:
        for (y, m) in meses_da_janela(since_d, until_d):
            rows = sb.table("shared_kv").select("key,value").like("key", f"oo_norte:%:{y:04d}-{m:02d}").execute().data or []
            for r in rows:
                k = str(r.get("key") or "")
                uid = k.split(":")[1] if k.count(":") >= 2 else None
                v = r.get("value")
                if isinstance(v, str):
                    try:
                        v = json.loads(v)
                    except Exception:
                        v = None
                if uid and isinstance(v, dict):
                    norte_cfg.setdefault(uid, []).append(v)
    except Exception:
        pass

    return {"users": users, "pessoas": pessoas, "email2uid": email2uid, "servico_emails": servico_emails,
            "deals": list(deals.values()), "stage_key": stage_key, "eventos": eventos,
            "tarefas": tarefas, "tarefas_ok": tarefas_ok, "metas": metas, "avisos": avisos,
            "closed120": closed120, "norte_cfg": norte_cfg,
            "ini": ini, "fim": fim}


def norte_calc(cfg):
    """§8 Norte do Mês = plano declarado: Σ canais (atend × mix%) × (taxa_base × energia/100)/100,
    VGV = vendas × ticket. Mesma fórmula de oo/norte.py:computed (fonte única a partir da v87.87)."""
    try:
        at = float(cfg.get("atendimentos_mes") or 0)
        ticket = float(cfg.get("ticket_medio") or 0)
        v = 0.0
        for c in (cfg.get("canais") or []):
            v += (at * float(c.get("mix") or 0) / 100.0) * (float(c.get("taxa_base") or 0) * float(c.get("energia") or 0) / 100.0) / 100.0
        if at <= 0:
            return None
        return {"vendas": round(v, 2), "vgv": round(v * ticket, 2), "atendimentos_mes": at}
    except Exception:
        return None


def _brain():
    """Motor de probabilidade do Cérebro de Vendas (intel/_brain_lib) — o MESMO que o Cérebro,
    a Agenda e agora todas as telas usam pro pipeline ponderado."""
    import os, sys
    _v3 = os.path.dirname(os.path.abspath(__file__))
    for d in ("intel", "oo"):
        p = os.path.join(_v3, d)
        if p not in sys.path:
            sys.path.append(p)
    import _brain_lib as B  # type: ignore
    return B


# ─── cálculo ─────────────────────────────────────────────────────────────────
PIPE_CAMPOS = ("abertos", "ponderado_vendas", "ponderado_vgv", "quentes", "quente_vgv",
               "comprometido_vendas", "comprometido_vgv", "sem_valor", "vgv_presumido")


def _vazio():
    z = {"vendas": 0, "vgv": 0.0, "ticket": None, "perdidos": 0,
         "interessados": 0, "leads": 0, "leads_pago_psm": 0, "leads_pago_corretor": 0, "leads_origem_assumida": 0,
         "em_atendimento": 0, "por_origem": {c: 0 for c in CATEGORIAS},
         # v88.16 (Paulo 23/09): leads EM ANDAMENTO criados na janela × origem — mínimo de todo painel
         "abertos_periodo": 0, "abertos_por_origem": {c: 0 for c in CATEGORIAS}, "abertos_sem_origem": 0,
         # v88.34 (Paulo 23/09): prospecção = TODA negociação criada na janela (aberta, ganha ou perdida)
         "entradas_sem_origem": 0,
         "visitas": None, "pipeline": {k: 0 for k in PIPE_CAMPOS}, "norte": None}
    for k in MARCOS_RD:
        z[k] = 0
    return z


def _dono(d, email2uid, uids, servico_emails):
    uid = str(d.get("user_id") or "")
    if uid and uid in uids:
        return uid
    em = (d.get("user_email") or "").lower()
    if em in servico_emails:
        return None
    return email2uid.get(em)


def _casar_hub(rows, membros):
    """agentName do HUB → uid do House (nome normalizado; senão primeiro nome único)."""
    by_full = {_norm(m.get("name")): m["id"] for m in membros}
    by_first = {}
    for m in membros:
        f = _norm(m.get("name")).split(" ")[0] if m.get("name") else ""
        by_first.setdefault(f, []).append(m["id"])
    out, sem_par = {}, []
    for r in rows:
        nm = _norm(r.get("agentName"))
        uid = by_full.get(nm)
        if not uid:
            cands = by_first.get(nm.split(" ")[0] if nm else "", [])
            uid = cands[0] if len(cands) == 1 else None
        if uid:
            out[uid] = r
        else:
            sem_par.append(r.get("agentName") or "?")
    return out, sem_par


def calcular(sb, base, since_d, until_d, hoje=None):
    hoje = hoje or hoje_brt()
    ini, fim = base["ini"], base["fim"]
    pessoas = base["pessoas"]
    uids = {u["id"] for u in pessoas}
    email2uid, servico_emails = base["email2uid"], base["servico_emails"]
    mapa = mapa_origens(sb)
    avisos = list(base["avisos"])

    P = {u["id"]: _vazio() for u in pessoas}
    sem_corretor = _vazio()
    vendas_sem_data, vendas_sem_valor, n_sem_corretor = 0, 0, 0

    def bucket(uid):
        return P.get(uid) if uid else sem_corretor

    for d in base["deals"]:
        uid = _dono(d, email2uid, uids, servico_emails)
        b = bucket(uid)
        win = d.get("win")
        created = parse_dt(d.get("created_at_rd"))
        closed = parse_dt(d.get("closed_at"))
        in_create = created is not None and ini <= created < fim
        in_close = closed is not None and ini <= closed < fim

        if win is True:
            if closed is None:
                vendas_sem_data += 1
            elif in_close:
                if uid is None:
                    n_sem_corretor += 1
                v = vgv_de(d)
                if v <= 0:
                    vendas_sem_valor += 1
                b["vendas"] += 1
                b["vgv"] += v
        elif win is False:
            if in_close:
                b["perdidos"] += 1
        else:
            b["em_atendimento"] += 1

        if in_create:
            cat, assumida = origem_categoria(origem_nome(d), mapa)
            if win is None:
                b["abertos_periodo"] += 1
                b["abertos_por_origem"][cat] += 1
                if assumida:
                    b["abertos_sem_origem"] += 1
            b["interessados"] += 1
            b["por_origem"][cat] = b["por_origem"].get(cat, 0) + 1
            if assumida:
                b["entradas_sem_origem"] += 1
            if cat in LEAD_CATS:
                b["leads"] += 1
                if cat == "trafego_pago_psm":
                    b["leads_pago_psm"] += 1
                else:
                    b["leads_pago_corretor"] += 1
                if assumida:
                    b["leads_origem_assumida"] += 1

    # marcos por coluna (todas as equipes; a Conquista recebe também os do HUB)
    deal_owner = {str(d["id"]): _dono(d, email2uid, uids, servico_emails) for d in base["deals"]}

    # §8 PIPELINE PONDERADO — motor do Cérebro (prior por etapa × taxa real do canal × recência ×
    # engajamento) sobre TODOS os abertos; comprometido = abertos em proposta/pasta (marco ≥ 4)
    # 🎟 TICKET DE REFERÊNCIA por equipe (decisão do Paulo 16/09): negócio aberto SEM VALOR no RD
    # entra no pipeline com o ticket médio das vendas ganhas da equipe nos últimos 120 dias
    # (fallback: meta_vgv ÷ meta_vendas da equipe; depois ticket da empresa). Sempre marcado como
    # presumido; o valor real substitui assim que alguém preencher o RD.
    team_of_uid = {u["id"]: team_key(u.get("team")) for u in pessoas}
    _tk_vals, _emp_vals = {}, []
    for w in base.get("closed120") or []:
        if w.get("win") is not True:
            continue
        v = vgv_de(w)
        if v <= 0:
            continue
        uid_w = _dono(w, email2uid, uids, servico_emails)
        _emp_vals.append(v)
        if uid_w:
            _tk_vals.setdefault(team_of_uid.get(uid_w, "sem_equipe"), []).append(v)
    ticket_ref = {tk: round(sum(v) / len(v), 2) for tk, v in _tk_vals.items() if v}
    ticket_ref["_empresa"] = round(sum(_emp_vals) / len(_emp_vals), 2) if _emp_vals else None
    ticket_fonte = {tk: "vendas 120d" for tk in ticket_ref if tk != "_empresa"}
    # fallback pela meta (meta_vgv ÷ meta_vendas) — só pra equipe sem venda com valor nos 120 d
    _meta_tk = {}
    for m in base["metas"]:
        uid_m = m.get("corretor_id")
        if uid_m in team_of_uid and (int(m.get("ano") or 0), int(m.get("mes") or 0)) in set(meses_da_janela(since_d, until_d)):
            t = _meta_tk.setdefault(team_of_uid[uid_m], [0.0, 0.0])
            t[0] += float(m.get("meta_vgv") or 0)
            t[1] += float(m.get("meta_vendas") or 0)
    for tk, (mv, mn) in _meta_tk.items():
        if tk not in ticket_ref and mn > 0 and mv > 0:
            ticket_ref[tk] = round(mv / mn, 2)
            ticket_fonte[tk] = "meta"

    def ticket_para(uid):
        tk = team_of_uid.get(uid) if uid else None
        return ticket_ref.get(tk) or ticket_ref.get("_empresa") or 0.0

    try:
        B = _brain()
        now = datetime.now(timezone.utc)
        closed = [{"win": d.get("win"), "rd_raw": {"deal_source": {"name": d.get("src")}}} for d in base.get("closed120") or []]
        owr, cwr, cn = B.channel_winrates(closed)
        for d in base["deals"]:
            if d.get("win") is not None:
                continue
            uid_d = deal_owner.get(str(d.get("id")))
            sem_valor = vgv_de(d) <= 0
            valor = ticket_para(uid_d) if sem_valor else None
            pseudo = {"id": d.get("id"), "win": None, "stage_name": d.get("stage_name"),
                      "updated_at_rd": d.get("updated_at_rd"), "created_at_rd": d.get("created_at_rd"),
                      "amount": (valor if sem_valor else d.get("amount")),
                      "rd_raw": {"deal_source": {"name": d.get("src")}, "last_activity_at": d.get("la"),
                                 "interactions": d.get("nint"),
                                 "amount_total": (None if sem_valor else d.get("amt_total")),
                                 "amount_unique": (None if sem_valor else d.get("amt_unique"))}}
            s = B.score_open(pseudo, owr, cwr, cn, now)
            if not s:
                continue
            pp = bucket(uid_d)["pipeline"]
            pp["abertos"] += 1
            pp["ponderado_vendas"] += s["prob"]
            pp["ponderado_vgv"] += s["expected_vgv"]
            if sem_valor:
                pp["sem_valor"] += 1
                pp["vgv_presumido"] += s["expected_vgv"]
            if s["temp"] == "quente":
                pp["quentes"] += 1
                pp["quente_vgv"] += s["expected_vgv"]
            if s["ms"] >= 4:
                pp["comprometido_vendas"] += s["prob"]
                pp["comprometido_vgv"] += s["expected_vgv"]
    except Exception as e:
        avisos.append({"tipo": "erro_dados", "txt": f"⚠️ Pipeline ponderado indisponível ({str(e)[:60]}).", "n": 1})

    # §8 NORTE declarado (soma dos meses da janela; só quem tem Norte definido)
    for uid, cfgs in (base.get("norte_cfg") or {}).items():
        if uid not in P:
            continue
        tot = None
        for cfg in cfgs:
            n = norte_calc(cfg)
            if n:
                tot = tot or {"vendas": 0.0, "vgv": 0.0}
                tot["vendas"] += n["vendas"]
                tot["vgv"] += n["vgv"]
        if tot:
            P[uid]["norte"] = {"vendas": round(tot["vendas"], 2), "vgv": round(tot["vgv"], 2)}
    sk = base["stage_key"]
    for e in base["eventos"]:
        met = COLUNA_METRICA.get(sk.get(str(e.get("stage_id") or "")))
        if not met:
            continue
        did = str(e.get("deal_id") or "")
        uid = deal_owner.get(did) if did in deal_owner else email2uid.get((e.get("user_email") or "").lower())
        bucket(uid)[met] += 1

    # visitas auditadas (tarefas do RD)
    if base["tarefas_ok"]:
        for b in list(P.values()) + [sem_corretor]:
            b["visitas"] = 0
        for t in base["tarefas"]:
            # v88.37: a visita é do DONO do negócio (quem atende o cliente); a tarefa no RD muitas
            # vezes fica no nome de quem a criou (Paulo/Isa co-conduzindo o MAP). Sem negócio
            # conhecido, vale o responsável da tarefa, como antes.
            did = str(t.get("deal_id") or "")
            uid = deal_owner.get(did) if did in deal_owner else email2uid.get((t.get("user_email") or "").lower())
            bucket(uid)["visitas"] += 1
    else:
        avisos.append({"tipo": "visitas", "txt": "ℹ️ Visitas auditadas (tarefas do RD) ainda não sincronizadas: usando a coluna 'visita realizada'.", "n": 1})

    # HUB esteira → Conquista (mensal; soma os meses da janela)
    conq = [u for u in pessoas if team_key(u.get("team")) == "conquista"]
    hub_status = {"ok": True, "erro": None, "meses": [], "sem_par": [], "vendas_hub": {}}
    hub_tot = {uid: {k: 0 for k in MARCOS_HUB} for uid in P}
    for (y, m) in meses_da_janela(since_d, until_d):
        h = hub_esteira(sb, y, m)
        hub_status["meses"].append(f"{y:04d}-{m:02d}")
        if not h.get("ok"):
            hub_status["ok"] = False
            hub_status["erro"] = h.get("erro")
            continue
        casados, sem_par = _casar_hub(h["rows"], conq)
        hub_status["sem_par"] += [s for s in sem_par if s not in hub_status["sem_par"]]
        for uid, r in casados.items():
            for k in MARCOS_HUB:
                hub_tot[uid][k] += int(r.get(k) or 0)
            vh = hub_status["vendas_hub"].setdefault(uid, {"n": 0, "vgv": 0.0})
            vh["n"] += int(r.get("vendaCount") or 0)
            vh["vgv"] += float(r.get("vendaTotal") or 0)
    for u in conq:
        P[u["id"]]["hub"] = hub_tot[u["id"]]
    if not hub_status["ok"]:
        avisos.append({"tipo": "hub", "txt": f"⚠️ Esteira do PSM HUB fora do ar ({hub_status['erro'] or 'sem resposta'}): prospecção, qualificação, agendamento, atendimento e pasta da Conquista indisponíveis.", "n": 1})
    if hub_status["sem_par"]:
        avisos.append({"tipo": "hub", "txt": "ℹ️ Corretor do HUB sem par no House: " + ", ".join(hub_status["sem_par"][:6]), "n": len(hub_status["sem_par"])})
    if (since_d.day != 1) or (until_d != hoje and until_d != _fim_mes(until_d)):
        if conq and hub_status["ok"]:
            avisos.append({"tipo": "hub", "txt": "ℹ️ A esteira do HUB é mensal: os marcos da Conquista referem-se ao(s) mês(es) inteiro(s) da janela.", "n": 1})
    # §1 conferência RD × HUB (RD manda)
    nomes = {u["id"]: u.get("name") for u in pessoas}
    ativos_ids = {u["id"] for u in pessoas if (u.get("status") or "ativo") == "ativo"}
    for uid, vh in hub_status["vendas_hub"].items():
        if uid not in ativos_ids:
            continue   # v88.37: quem saiu da PSM não gera cobrança (Bruno, 24/09) — o HUB segue casando pra não virar "sem par"
        rd_n = P[uid]["vendas"]
        if vh["n"] != rd_n:
            avisos.append({"tipo": "rd_hub", "uid": uid,
                           "txt": f"⚠️ {nomes.get(uid)}: {vh['n']} venda(s) no HUB × {rd_n} ganha(s) no RD. Vale o RD — corrija o ganho no RD.",
                           "n": abs(vh["n"] - rd_n)})

    # metas (§6: soma mês a mês)
    meses = set(meses_da_janela(since_d, until_d))
    meta_by = {uid: {k: 0.0 for k in METAS_CAMPOS} for uid in P}
    for m in base["metas"]:
        uid = m.get("corretor_id")
        if uid in meta_by and (int(m.get("ano") or 0), int(m.get("mes") or 0)) in meses:
            for k in METAS_CAMPOS:
                meta_by[uid][k] += float(m.get(k) or 0)

    # ritmo (§8): só quando a janela é o mês corrente até hoje; dias úteis seg–sáb
    ritmo_on = since_d == hoje.replace(day=1) and until_d == hoje
    import calendar
    dim = calendar.monthrange(hoje.year, hoje.month)[1]
    uteis_tot = sum(1 for d in range(1, dim + 1) if date(hoje.year, hoje.month, d).weekday() < 6)
    uteis_dec = sum(1 for d in range(1, hoje.day + 1) if date(hoje.year, hoje.month, d).weekday() < 6)

    def fechar(b, meta):
        b["ticket"] = round(b["vgv"] / b["vendas"], 2) if b["vendas"] else None
        b["vgv"] = round(b["vgv"], 2)
        b["meta"] = {k: round(v, 2) for k, v in (meta or {}).items()}
        mv = (meta or {}).get("meta_vgv") or 0
        b["atingimento_vgv_pct"] = round(b["vgv"] / mv * 100, 1) if mv > 0 else None
        pp = b["pipeline"]
        for k in PIPE_CAMPOS:
            pp[k] = round(pp[k], 2)
        # §8 — as QUATRO projeções, sempre com estes nomes, em toda tela:
        #   ritmo      = realizado ÷ dias úteis decorridos × dias úteis do mês (seg–sáb)
        #   pipeline   = Σ prob × valor dos abertos (motor do Cérebro)
        #   previsto   = realizado + comprometido (abertos em proposta/pasta)
        #   norte      = plano declarado (mix × conversão) — só quem tem Norte
        if ritmo_on and uteis_dec:
            b["projecao"] = {"vendas": round(b["vendas"] / uteis_dec * uteis_tot, 1),
                             "vgv": round(b["vgv"] / uteis_dec * uteis_tot, 2),
                             "dias_uteis_decorridos": uteis_dec, "dias_uteis_mes": uteis_tot,
                             "atingira_vgv_pct": (round(b["vgv"] / uteis_dec * uteis_tot / mv * 100, 1) if mv > 0 else None)}
        else:
            b["projecao"] = None
        b["previsto"] = {"vendas": round(b["vendas"] + pp["comprometido_vendas"], 1),
                         "vgv": round(b["vgv"] + pp["comprometido_vgv"], 2),
                         "cobertura_meta_pct": (round((b["vgv"] + pp["comprometido_vgv"]) / mv * 100, 1) if mv > 0 else None)}
        return b

    pessoas_out = {}
    for u in pessoas:
        b = fechar(P[u["id"]], meta_by[u["id"]])
        b["ticket_referencia"] = ticket_para(u["id"]) or None
        b.update({"id": u["id"], "name": u.get("name"), "email": (u.get("email") or "").lower(),
                  "role": u.get("role"), "team": team_key(u.get("team")),
                  "ativo": (u.get("status") or "ativo") == "ativo", "gestor": is_gestor(u.get("role")),
                  "corretor": (u.get("role") or "").lower().startswith("corretor")})
        pessoas_out[u["id"]] = b

    def somar(lista):
        t = _vazio()
        t["visitas"] = 0 if base["tarefas_ok"] else None
        t["hub"] = {k: 0 for k in MARCOS_HUB}
        meta = {k: 0.0 for k in METAS_CAMPOS}
        norte = None
        for b in lista:
            for k in ("vendas", "vgv", "perdidos", "interessados", "leads", "leads_pago_psm",
                      "leads_pago_corretor", "leads_origem_assumida", "em_atendimento",
                      "abertos_periodo", "abertos_sem_origem", "entradas_sem_origem") + MARCOS_RD:
                t[k] += b[k]
            for k in PIPE_CAMPOS:
                t["pipeline"][k] += (b.get("pipeline") or {}).get(k, 0)
            if b.get("norte"):
                norte = norte or {"vendas": 0.0, "vgv": 0.0}
                norte["vendas"] += b["norte"]["vendas"]
                norte["vgv"] += b["norte"]["vgv"]
            if base["tarefas_ok"]:
                t["visitas"] += (b.get("visitas") or 0)
            for c in CATEGORIAS:
                t["por_origem"][c] += b["por_origem"].get(c, 0)
                t["abertos_por_origem"][c] += (b.get("abertos_por_origem") or {}).get(c, 0)
            for k in MARCOS_HUB:
                t["hub"][k] += (b.get("hub") or {}).get(k, 0)
            for k in METAS_CAMPOS:
                meta[k] += (b.get("meta") or {}).get(k, 0)
        t["norte"] = ({"vendas": round(norte["vendas"], 2), "vgv": round(norte["vgv"], 2)} if norte else None)
        return fechar(t, meta)

    # equipes (§4): membros ATIVOS não-serviço com team igual (corretor + gestor)
    equipes_out = {}
    for tk in sorted({b["team"] for b in pessoas_out.values()}):
        membros = [b for b in pessoas_out.values() if b["team"] == tk and b["ativo"]]
        t = somar(membros)
        t.update({"team": tk, "membros": [b["id"] for b in membros],
                  "n_corretores": sum(1 for b in membros if b["corretor"]),
                  "n_gestores": sum(1 for b in membros if b["gestor"]),
                  "ticket_referencia": ticket_ref.get(tk) or ticket_ref.get("_empresa"),
                  "ticket_fonte": ticket_fonte.get(tk, "empresa" if ticket_ref.get("_empresa") else None)})
        equipes_out[tk] = t

    empresa = somar([b for b in pessoas_out.values() if b["ativo"]])
    sc = fechar(sem_corretor, None)
    # v88.0 §1 (venda = ganho no RD, toda venda conta): quem SAIU da empresa sai da equipe, da meta e das
    # projeções (§4), mas a venda que fez continua sendo venda da PSM. Antes o total da empresa só somava
    # pessoas ativas — em 2026, 19 vendas (~R$ 6,1 mi, jan–jul) de corretores desligados sumiam dos totais
    # de ano e de meses passados. Mesmo tratamento do "sem corretor": soma só na empresa, com aviso.
    CAMPOS_EMP = ("vendas", "vgv", "perdidos", "interessados", "leads", "leads_pago_psm", "leads_pago_corretor", "em_atendimento",
                  "abertos_periodo", "abertos_sem_origem", "leads_origem_assumida", "entradas_sem_origem")
    inat_lista = [b for b in pessoas_out.values() if not b["ativo"]]
    inat = {k: 0 for k in CAMPOS_EMP}
    for b in inat_lista:
        for k in CAMPOS_EMP:
            inat[k] += b.get(k) or 0
    inat["vgv"] = round(inat["vgv"], 2)
    inat["abertos_por_origem"] = {c: sum((b.get("abertos_por_origem") or {}).get(c, 0) for b in inat_lista) for c in CATEGORIAS}
    inat["por_origem"] = {c: sum((b.get("por_origem") or {}).get(c, 0) for b in inat_lista) for c in CATEGORIAS}
    inat["quem"] = sorted(b.get("name") or b["id"] for b in inat_lista if b.get("vendas") or b.get("leads") or b.get("em_atendimento"))
    for c in CATEGORIAS:
        empresa["abertos_por_origem"][c] += (sc.get("abertos_por_origem") or {}).get(c, 0) + inat["abertos_por_origem"][c]
        # v88.34: antes só as pessoas ativas entravam aqui — a soma por origem não batia com "interessados"
        empresa["por_origem"][c] += (sc.get("por_origem") or {}).get(c, 0) + inat["por_origem"][c]
    for k in CAMPOS_EMP:
        empresa[k] = round(empresa[k] + sc.get(k, 0) + inat[k], 2) if k == "vgv" else empresa[k] + sc.get(k, 0) + inat[k]
    empresa["ticket"] = round(empresa["vgv"] / empresa["vendas"], 2) if empresa["vendas"] else None
    mv_emp = (empresa.get("meta") or {}).get("meta_vgv") or 0
    empresa["atingimento_vgv_pct"] = round(empresa["vgv"] / mv_emp * 100, 1) if mv_emp > 0 else None
    empresa["sem_corretor"] = sc
    empresa["inativos"] = inat
    if inat["vendas"]:
        avisos.append({"tipo": "vendas_inativos",
                       "txt": f"ℹ️ {inat['vendas']} venda(s) de quem já saiu da PSM ({', '.join(inat['quem'][:5])}) somam no total da empresa, fora das equipes e das metas.",
                       "n": inat["vendas"]})
    empresa["n_pessoas_ativas"] = sum(1 for b in pessoas_out.values() if b["ativo"])
    empresa["ticket_referencia"] = ticket_ref.get("_empresa")
    empresa["ticket_por_equipe"] = {k: v for k, v in ticket_ref.items() if k != "_empresa"}
    sv = empresa["pipeline"].get("sem_valor", 0)
    if sv:
        tks = ", ".join(f"{CAT_TEAM.get(k, k)} R$ " + f"{v:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".") for k, v in ticket_ref.items() if k != "_empresa" and v)
        avisos.append({"tipo": "sem_valor_pipeline",
                       "txt": f"ℹ️ {sv} negócio(s) aberto(s) sem valor no RD — VGV do pipeline presumido pelo ticket médio da equipe ({tks}). Preencha o valor no RD para trocar o presumido pelo real.",
                       "n": sv})

    if vendas_sem_data:
        avisos.append({"tipo": "venda_sem_data", "txt": f"⚠️ {vendas_sem_data} venda(s) ganha(s) sem data de fechamento no RD — não entram em mês nenhum.", "n": vendas_sem_data})
    if vendas_sem_valor:
        avisos.append({"tipo": "venda_sem_valor", "txt": f"⚠️ {vendas_sem_valor} venda(s) do período com valor zero no RD.", "n": vendas_sem_valor})
    if sc["vendas"] or sc["leads"]:
        avisos.append({"tipo": "sem_corretor", "txt": f"⚠️ Sem corretor no período: {sc['vendas']} venda(s) e {sc['leads']} lead(s) sem dono cadastrado no House (somam só na empresa).", "n": sc["vendas"] + sc["leads"]})
    if empresa["leads_origem_assumida"]:
        avisos.append({"tipo": "origem_assumida", "txt": f"ℹ️ {empresa['leads_origem_assumida']} lead(s) sem origem no RD contados como tráfego pago PSM — peça ao gestor para preencher a origem.", "n": empresa["leads_origem_assumida"]})
    nc = empresa["por_origem"].get("nao_classificada", 0)
    if nc:
        avisos.append({"tipo": "origem_nova", "txt": f"⚠️ {nc} negócio(s) com origem que ainda não está no Dicionário (classificar em Configurações).", "n": nc})

    return {"pessoas": pessoas_out, "equipes": equipes_out, "empresa": empresa, "avisos": avisos,
            "hub": {"ok": hub_status["ok"], "meses": hub_status["meses"]},
            "dicionario": {"versao": "v1", "categorias": CAT_LABEL, "marcos_rd": MARCOS_RD, "marcos_hub": MARCOS_HUB}}


def _fim_mes(d):
    import calendar
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


# ─── leitores de marco (§5): Conquista lê o HUB; as outras equipes leem o RD ────
def _hub_ou(b, k_hub, k_rd):
    if not b:
        return 0
    if b.get("team") == "conquista" and isinstance(b.get("hub"), dict):
        return int(b["hub"].get(k_hub) or 0)
    return int(b.get(k_rd) or 0)


def visitas_de(b):
    """Conquista: 'atendimento' da esteira do HUB. Demais: o MAIOR entre as tarefas de visita
    concluídas e as entradas na coluna 'visita realizada' (v88.37). Antes valia só a tarefa: quem
    move o card pra "visita realizada" sem fechar a tarefa "Visita" (o MAP) aparecia com 0 visita
    — Rafaela, 24/09: 17 pela coluna × 7 por tarefa no ano, e 0 no mês."""
    if not b:
        return 0
    if b.get("team") == "conquista" and isinstance(b.get("hub"), dict):
        return int(b["hub"].get("atendimento") or 0)
    tarefas = int(b["visitas"]) if b.get("visitas") is not None else 0
    return max(tarefas, int(b.get("visitas_coluna") or 0))


def agendamentos_de(b):
    return _hub_ou(b, "agendamento", "agendamentos")


def propostas_de(b):
    return _hub_ou(b, "pasta", "propostas")


def qualificados_de(b):
    return _hub_ou(b, "qualificacao", "qualificados")


def prospeccoes_de(b):
    """Topo do funil: Conquista = prospecção da esteira do HUB; demais = entrada na coluna de novo atendimento."""
    return _hub_ou(b, "prospeccao", "atendimentos")


def pastas_de(b):
    """Conquista = pasta do HUB (no MCMV a pasta É a proposta); demais = contrato (coluna do RD)."""
    return _hub_ou(b, "pasta", "contratos")


def fonte_marcos(b):
    return "hub" if (b and b.get("team") == "conquista" and isinstance(b.get("hub"), dict)) else "rd"


# §5 em 7 degraus, com as MESMAS chaves do funil do 1:1 (matriz de conversão, mapa de habilidades e
# metas por etapa do Norte dependem delas). v87.97
FUNIL_CHAVES = ("lead", "contato", "agendamento", "visita", "proposta", "pasta", "venda")


def funil_de(b):
    """Funil do período pela régua do Dicionário §5 → [{key, label, n, conv_from_prev, espelho?}].

    Conquista: esteira do PSM HUB (prospecção → qualificação → agendamento → atendimento → pasta) + venda
    do RD. No MCMV proposta e pasta são a mesma etapa (as metas do Norte já vêm iguais), então o degrau
    'pasta' repete o 'proposta' e vem marcado espelho=True (a tela não desenha duas vezes; a taxa passa 100%).
    MAP/Terceiros/Locação: entrada na coluna do RD no período (novo atendimento → contato/qualificação →
    agendamento → visita → proposta → contrato); visita = tarefa de visita concluída (coluna se não houver).
    Taxas são de FLUXO do período (entradas ÷ entradas do degrau anterior): passam de 100% quando o negócio
    entrou no degrau anterior num período passado."""
    if not b:
        return []
    if fonte_marcos(b) == "hub":
        labels = ("Prospecção", "Qualificação", "Agendamento", "Atendimento (visita)", "Pasta / proposta", "Pasta", "Venda")
        nums = (prospeccoes_de(b), qualificados_de(b), agendamentos_de(b), visitas_de(b), pastas_de(b), pastas_de(b), b.get("vendas"))
    else:
        labels = ("Atendimento", "Contato / qualificação", "Agendamento", "Visita realizada", "Proposta", "Contrato", "Venda")
        nums = (prospeccoes_de(b), qualificados_de(b), agendamentos_de(b), visitas_de(b), propostas_de(b), pastas_de(b), b.get("vendas"))
    out, prev = [], None
    for i, (k, lbl, n) in enumerate(zip(FUNIL_CHAVES, labels, nums)):
        n = int(n or 0)
        linha = {"key": k, "label": lbl, "n": n, "conv_from_prev": (round(n / prev * 100, 2) if prev else None)}
        if fonte_marcos(b) == "hub" and k == "pasta":
            linha["espelho"] = True
        out.append(linha)
        prev = n
    return out


def por_nome(data):
    """{nome normalizado: bloco da pessoa} — pra casar payloads antigos que só têm o nome."""
    return {_norm(b.get("name")): b for b in (data.get("pessoas") or {}).values()}


def por_email_local(data):
    out = {}
    for b in (data.get("pessoas") or {}).values():
        em = b.get("email") or ""
        if "@" in em:
            out[em.split("@")[0]] = b
    return out


# ─── entrada única (com cache versionado) ────────────────────────────────────
def resumo(sb, params=None, fresh=False, hoje=None):
    """Retrato único do período. Cache em shared_kv versionado pelo último sync do RD:
    mudou o dado → todas as telas recalculam juntas (tempo real, mesma foto pra todos)."""
    hoje = hoje or hoje_brt()
    since_d, until_d = janela_de(params, hoje)
    versao = versao_dados(sb)
    key = f"{CACHE_KEY}:{since_d.isoformat()}:{until_d.isoformat()}"
    if not fresh:
        c = _kv_read(sb, key)
        if isinstance(c, dict) and c.get("data"):
            ts = parse_dt(c.get("_cached_at"))
            age = (datetime.now(timezone.utc) - ts).total_seconds() if ts else 1e9
            if c.get("versao") == versao and age < CACHE_TTL:
                out = dict(c["data"])
                out["cached"] = True
                out["cache_age_s"] = int(age)
                _carimbar_frescor(sb, out)
                return out
            # v88.40: cálculo único — se outra requisição já está recalculando esta janela
            # (trava < LOCK_TTL), devolve a foto anterior em vez de recalcular junto. Em 24/09,
            # várias telas recalculando ao mesmo tempo esgotaram a CPU do banco.
            lk = _kv_read(sb, key + ":calc")
            lts = parse_dt((lk or {}).get("ts")) if isinstance(lk, dict) else None
            if lts and (datetime.now(timezone.utc) - lts).total_seconds() < LOCK_TTL and age < STALE_MAX:
                out = dict(c["data"])
                out["cached"] = True
                out["recalculando"] = True
                out["cache_age_s"] = int(age)
                _carimbar_frescor(sb, out)
                return out
    _kv_write(sb, key + ":calc", {"ts": datetime.now(timezone.utc).isoformat()})
    base = carregar(sb, since_d, until_d)
    data = calcular(sb, base, since_d, until_d, hoje)
    dados_de = to_brt(versao.split("|m")[0])
    data.update({
        "ok": True,
        "janela": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                   "preset": (params or {}).get("preset") or (params or {}).get("date_preset") or ("custom" if (params or {}).get("since") else "this_month"),
                   "hoje": hoje.isoformat()},
        "versao": versao,
        "dados_de": dados_de.isoformat() if dados_de else None,
        "dados_de_hhmm": dados_de.strftime("%d/%m %H:%M") if dados_de else None,
        "calculado_em": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    })
    _kv_write(sb, key, {"_cached_at": datetime.now(timezone.utc).isoformat(), "versao": versao, "data": data})
    _carimbar_frescor(sb, data)
    return data


def _carimbar_frescor(sb, out):
    """v88.40: "dados de HH:MM" = último sync conferido (não o último dado novo)."""
    d = to_brt(ultimo_sync_rd(sb))
    if d:
        out["dados_de"] = d.isoformat()
        out["dados_de_hhmm"] = d.strftime("%d/%m %H:%M")


def filtrar_por_viewer(data, user):
    """Escopo de permissão (§4): sócio/diretor lvl>=10 vê tudo; gestor (prefixo) ou lvl>=5 vê a
    própria equipe; corretor vê só a si. Devolve cópia com pessoas/equipes recortadas."""
    lvl = (user or {}).get("lvl") or 0
    if lvl >= 10:
        return data
    out = dict(data)
    tk = team_key((user or {}).get("team"))
    if lvl >= 5 or is_gestor((user or {}).get("role")):
        out["pessoas"] = {k: v for k, v in data["pessoas"].items() if v["team"] == tk}
        out["equipes"] = {k: v for k, v in data["equipes"].items() if k == tk}
        out["empresa"] = None
        out["escopo"] = {"tipo": "equipe", "team": tk}
    else:
        uid = (user or {}).get("id")
        out["pessoas"] = {k: v for k, v in data["pessoas"].items() if k == uid}
        out["equipes"] = {}
        out["empresa"] = None
        out["escopo"] = {"tipo": "pessoa", "id": uid}
    out["avisos"] = [a for a in data.get("avisos") or [] if a.get("tipo") in ("erro_dados", "hub", "visitas") or (a.get("uid") and a["uid"] in out["pessoas"])]
    return out
