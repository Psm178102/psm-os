# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/diretoria/ceo_cron — 🏛️ AGENTE CEO vira presença DIÁRIA (Onda 1 · v87.43)

O CEO deixa de ser relatório semanal e passa a ler o negócio TODO DIA às 7h BRT
(mesmo motor do cmo_cron/gestor_relatorio: IA server-side, CRON_SECRET, idempotente):

  - TERÇA A DOMINGO → LEITURA DE EXCEÇÃO: 1ª linha binária
      "✅ Nada fora da faixa" OU "🚨 ALERTA: <o quê>" + máx 10 linhas.
    Gatilhos hard-coded (além do juízo da IA): ≥3 dias sem venda na holding;
    mês projetando <60% da meta após o dia 10; compromisso estourado há ≥2 dias;
    produção do apoio <50% da meta por 2 dias seguidos.
  - SEGUNDA → ESTADO DA UNIÃO (substitui a leitura do dia): consolida a semana
    inteira — números vs meta, síntese do último CFO + CMO (o CEO é a camada
    acima: UMA leitura pro sócio), funil, apoio, compromissos, riscos, máx 3
    recomendações. Na 1ª segunda do mês: fechamento do mês anterior + leitura
    do Plano de Resgate (gate de dezembro: break-even R$70k, pró-labore).

Persistência:
  - TODO resultado → log compacto shared_kv "ceo_diario"
      {items:[{data,tipo:'diaria'|'estado-da-uniao',alerta,primeira_linha,
               corpo_md,criado_em}]} · máx 45 · trava otimista por md5.
  - Estado da União E qualquer dia com alerta=true → dossiê completo em
    shared_kv "diretoria_dossies" (id ceo_<data>_<tipo>, manchete=1ª linha,
    prepend, máx 40, sem duplicar id). Dia ✅ normal NÃO polui os dossiês.
  - O cron também marca 'atrasado' nos compromissos (ceo_compromissos)
    com prazo vencido e status 'aberto'.

Push: alerta=true OU Estado da União → SÓ sócios (lvl>=10). Dia ✅ = silêncio.

GET  ?cron=1        → gera a leitura do dia se ainda não existe (Bearer
                      CRON_SECRET ou sócio lvl>=10). Idempotente por data.
GET  ?log=1         → devolve o log ceo_diario (sócio lvl>=10 — a página lê daqui).
POST {action:"gerar"} → sócio força regeração AGORA (substitui a entrada do dia).
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, audit, supabase_client,  # type: ignore
                       lvl_of, notify, send_web_push, agora_brt)

KV_LOG = "ceo_diario"
KV_COMPROMISSOS = "ceo_compromissos"
KV_DOSSIES = "diretoria_dossies"
MAX_LOG = 45
MAX_DOSSIES = 40
BRT = timezone(timedelta(hours=-3))

PERSONA = (
    "Você é o Agente CEO da holding PSM (São José do Rio Preto/SP) — braço direito executivo do "
    "Paulo (sócio, palavra final SEMPRE dele). Você é a camada ACIMA do CFO e do CMO: quando os "
    "relatórios deles aparecem nos dados, VOCÊ os sintetiza citando-os — o sócio recebe UMA "
    "leitura, não três. Regras: (1) baseie-se EXCLUSIVAMENTE nos dados abaixo — cite números "
    "reais; dado ausente = escreva 'sem dado', NUNCA invente; (2) você recomenda e cobra, o Paulo "
    "decide — nenhuma ação é executada por você; (3) português BR, tom executivo direto, zero "
    "vícios de IA (proibido 'Não é X. É Y.' e variações); (4) contexto permanente: Plano de "
    "Resgate jul→dez/2026 — break-even R$70k/mês, gate de dezembro = equipes pagando o "
    "pró-labore dos sócios; TUDO a 4%."
)

INSTRUCOES = {
    "diaria": (
        "LEITURA DE EXCEÇÃO DIÁRIA (7h). A PRIMEIRA LINHA é obrigatoriamente "
        "'✅ Nada fora da faixa' OU '🚨 ALERTA: <o quê, em poucas palavras>'. "
        "Depois da 1ª linha, NO MÁXIMO 10 linhas: ritmo do mês (vendas vs meta vs ritmo "
        "necessário pelos dias corridos), dias sem venda, leads 24h/7d, produção do apoio de "
        "ontem, compromissos atrasados, e — se CFO/CMO trouxeram algo relevante — 1 linha citando. "
        "Se ✅: seja telegráfico e PARE — a leitura diária existe pra pegar incêndio, não pra "
        "produzir relatório. Se 🚨: o número que estourou + a cobrança objetiva (o quê, quem, até quando)."
    ),
    "estado-da-uniao": (
        "ESTADO DA UNIÃO (segunda 7h — consolida a SEMANA INTEIRA que fechou). A PRIMEIRA LINHA é "
        "uma manchete executiva de 1 frase (com 🚨 se houver alerta grave; senão sem emoji de alarme). "
        "Estrutura (markdown, máx ~450 palavras): "
        "1) 📊 Números da semana e do mês vs meta (vendas, VGV, ritmo necessário); "
        "2) 🧠 Síntese do último relatório do CFO e do CMO — CITE-OS ('o CFO reportou…', 'o CMO "
        "apontou…'); sem relatório = dizer que não publicaram; "
        "3) 🔻 Funil (leads 24h/7d vs semana anterior); "
        "4) 👥 Produção do time de apoio na semana vs meta; "
        "5) 📋 Compromissos (feitos / atrasados / novos — cobrar os atrasados nominalmente); "
        "6) ⚠️ Riscos; "
        "7) ✅ NO MÁXIMO 3 recomendações da semana (verbo + número + dono). "
        "Se os dados incluírem a seção FECHAMENTO DO MÊS ANTERIOR (1ª segunda do mês), abra um "
        "bloco 🗓️ com o fechamento e a leitura do Plano de Resgate rumo ao gate de dezembro "
        "(break-even R$70k, equipes pagando pró-labore)."
    ),
}


# ─── IA (mesma cadeia do cmo_cron/gestor_relatorio) ────────────────────
def _ia(prompt, max_tokens=1600):
    prefer = (os.environ.get("AI_PREFER") or "gemini").strip().lower()
    gem_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    ant_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()

    def gemini():
        model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                   "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4,
                                        "thinkingConfig": {"thinkingBudget": 0}}}
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json", "x-goog-api-key": gem_key})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts), "gemini/" + model

    def claude():
        payload = {"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
                   "max_tokens": max_tokens,
                   "messages": [{"role": "user", "content": prompt}]}
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(payload).encode(),
                                     headers={"x-api-key": ant_key, "anthropic-version": "2023-06-01",
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
        return "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text"), "claude"

    chain = [claude, gemini] if (prefer == "claude" and ant_key) else ([gemini, claude] if gem_key else [claude])
    last = None
    for fn in chain:
        try:
            texto, prov = fn()
            if texto and texto.strip():
                return texto.strip(), prov, None
        except Exception as e:
            last = str(e)
    return None, None, last or "nenhum provider de IA configurado"


# ─── KV helpers (autossuficientes, padrão cmo_cron) ────────────────────
def _kv_get(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else (default if default is not None else {})
    except Exception:
        return default if default is not None else {}


def _kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _md5(v):
    return hashlib.md5(json.dumps(v, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")).hexdigest()


def _kv_write_locked(sb, key, mutate, retries=3):
    """Trava otimista leve por md5: lê → muta → relê e só grava se ninguém mexeu.
    Melhor esforço (shared_kv não tem coluna de versão) — reduz a janela de
    corrida entre sessões/crons concorrentes sem migração de schema."""
    for _ in range(retries):
        antes = _kv_get(sb, key, {})
        h = _md5(antes)
        novo = mutate(json.loads(json.dumps(antes)) if antes else {})
        atual = _kv_get(sb, key, {})
        if _md5(atual) != h:
            continue  # alguém escreveu no meio — recomeça do estado novo
        _kv_set(sb, key, novo)
        return novo
    # última tentativa: grava mesmo assim mutando o estado mais fresco
    novo = mutate(_kv_get(sb, key, {}))
    _kv_set(sb, key, novo)
    return novo


# ─── Coleta de números (direto do banco) ───────────────────────────────
def _deals_win(sb, ini_iso, fim_iso=None):
    try:
        q = sb.table("deals").select("amount,closed_at").eq("win", True).gte("closed_at", ini_iso)
        if fim_iso:
            q = q.lt("closed_at", fim_iso)
        rows = q.order("closed_at", desc=True).limit(2000).execute().data or []
        return rows, None
    except Exception as e:
        return [], str(e)[:100]


def _meta_mes(sb, ano, mes):
    try:
        rows = (sb.table("metas").select("meta_vgv,meta_vendas")
                .eq("ano", ano).eq("mes", mes).execute().data or [])
        return (sum(float(m.get("meta_vgv") or 0) for m in rows),
                sum(int(m.get("meta_vendas") or 0) for m in rows))
    except Exception:
        return 0.0, 0


def _dias_sem_venda(sb, agora):
    try:
        rows = (sb.table("deals").select("closed_at").eq("win", True)
                .order("closed_at", desc=True).limit(1).execute().data or [])
        if not rows or not rows[0].get("closed_at"):
            return None
        ult = datetime.fromisoformat(str(rows[0]["closed_at"]).replace("Z", "+00:00")).astimezone(BRT)
        return max(0, (agora.date() - ult.date()).days)
    except Exception:
        return None


def _fmt_reais(v):
    try:
        return f"R$ {float(v):,.0f}".replace(",", ".")
    except Exception:
        return "R$ 0"


def _apoio_producao(sb, agora):
    """Produção do time de apoio (fiscalizacao_cfg → motor de cada colaborador)
    nos últimos dias, em BRT. Retorna (linhas_texto, gatilho_ou_None)."""
    cfg = _kv_get(sb, "fiscalizacao_cfg", {})
    colabs = cfg.get("colaboradores") or {}
    if not colabs:
        return ["PRODUÇÃO DO APOIO: config de fiscalização ausente (sem dado)."], None
    # janela em UTC REAL (agora_brt vem etiquetado UTC com valor de parede BRT — não dá pra astimezone)
    desde = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    try:
        evs = (sb.table("producao_eventos").select("colaborador,tipo,ts")
               .gte("ts", desde).limit(20000).execute().data or [])
    except Exception as e:
        return [f"PRODUÇÃO DO APOIO: sem dado ({str(e)[:80]})."], None
    # conta por colaborador × tipo × dia BRT
    cont = {}
    for e in evs:
        try:
            d = datetime.fromisoformat(str(e.get("ts")).replace("Z", "+00:00")).astimezone(BRT).date().isoformat()
        except Exception:
            continue
        cont.setdefault((str(e.get("colaborador")), str(e.get("tipo")), d), 0)
        cont[(str(e.get("colaborador")), str(e.get("tipo")), d)] += 1
    # 2 últimos dias avaliáveis (pula domingo — sem meta de produção)
    dias = []
    d = agora.date() - timedelta(days=1)
    while len(dias) < 2:
        if d.weekday() != 6:
            dias.append(d)
        d -= timedelta(days=1)
    linhas, abaixo_2dias = [], []
    for chave, c in colabs.items():
        if not isinstance(c, dict):
            continue
        motor = c.get("motor")
        if not motor:
            continue
        metas = c.get("metas") or {}
        meta_dia = ((metas.get(motor) or {}).get("dia") if isinstance(metas.get(motor), dict) else None)
        nome = c.get("nome") or chave
        vals = [cont.get((chave, motor, dd.isoformat()), 0) for dd in dias]
        if meta_dia:
            linhas.append(f"- {nome} ({motor}): ontem {vals[0]}/{meta_dia} · anteontem útil {vals[1]}/{meta_dia}")
            if all(v < 0.5 * meta_dia for v in vals):
                abaixo_2dias.append(f"{nome} <50% da meta diária ({motor}) por 2 dias seguidos")
        else:
            linhas.append(f"- {nome} ({motor}): ontem {vals[0]} · anteontem útil {vals[1]} (sem meta diária configurada)")
    gat = "; ".join(abaixo_2dias) if abaixo_2dias else None
    return (["PRODUÇÃO DO TIME DE APOIO (motor de cada um, dias úteis, BRT):"] + linhas), gat


def _compromissos_sync(sb, agora):
    """Marca 'atrasado' (prazo < hoje e status aberto) e devolve (items, gatilho)."""
    hoje = agora.date().isoformat()
    estado = {"changed": False}

    def mutate(box):
        items = [i for i in (box.get("items") or []) if isinstance(i, dict)]
        for it in items:
            if it.get("status") == "aberto" and it.get("prazo") and str(it["prazo"])[:10] < hoje:
                it["status"] = "atrasado"
                it["atualizado_em"] = datetime.now(timezone.utc).isoformat()
                estado["changed"] = True
        box["items"] = items
        return box

    box = _kv_get(sb, KV_COMPROMISSOS, {})
    if box:
        box = mutate(json.loads(json.dumps(box)))
        if estado["changed"]:
            estado["changed"] = False
            box = _kv_write_locked(sb, KV_COMPROMISSOS, mutate)
    items = [i for i in (box.get("items") or []) if isinstance(i, dict)]
    estourados = []
    for it in items:
        if it.get("status") == "atrasado" and it.get("prazo"):
            try:
                dias = (agora.date() - datetime.strptime(str(it["prazo"])[:10], "%Y-%m-%d").date()).days
            except Exception:
                continue
            if dias >= 2:
                estourados.append(f"'{str(it.get('o_que'))[:60]}' ({it.get('dono')}) estourado há {dias} dias")
    gat = "; ".join(estourados[:3]) if estourados else None
    return items, gat


# ─── Contexto + gatilhos ───────────────────────────────────────────────
def _contexto(sb, tipo, agora):
    parts, gatilhos = [], []
    d = agora.date()
    ano, mes = d.year, d.month
    mes_ini_brt = datetime(ano, mes, 1, tzinfo=BRT)
    mes_ini = mes_ini_brt.astimezone(timezone.utc).isoformat()

    # 1) Vendas do mês vs meta vs ritmo
    wins, err = _deals_win(sb, mes_ini)
    meta_vgv, meta_vendas = _meta_mes(sb, ano, mes)
    if err:
        parts.append(f"VENDAS DO MÊS: sem dado ({err}).")
    else:
        vgv = sum(float(w.get("amount") or 0) for w in wins)
        n = len(wins)
        dias_mes = ((datetime(ano + (mes == 12), (mes % 12) + 1, 1) - datetime(ano, mes, 1)).days)
        dias_corridos = max(1, d.day)
        proj = vgv / dias_corridos * dias_mes
        linha = (f"VENDAS DO MÊS ({mes:02d}/{ano}): {n} vendas · VGV {_fmt_reais(vgv)} · "
                 f"meta {_fmt_reais(meta_vgv)} ({meta_vendas} vendas) · dia {d.day}/{dias_mes} · "
                 f"projeção pelo ritmo atual: {_fmt_reais(proj)}"
                 + (f" ({proj / meta_vgv * 100:.0f}% da meta)" if meta_vgv else " (sem meta cadastrada)"))
        parts.append(linha)
        if d.day > 10 and meta_vgv > 0 and proj < 0.6 * meta_vgv:
            gatilhos.append(f"mês projetando {proj / meta_vgv * 100:.0f}% da meta após o dia 10")

    # 2) Dias sem venda na holding
    sem = _dias_sem_venda(sb, agora)
    if sem is None:
        parts.append("DIAS SEM VENDA: sem dado.")
    else:
        parts.append(f"DIAS CONSECUTIVOS SEM VENDA NA HOLDING: {sem}")
        if sem >= 3:
            gatilhos.append(f"{sem} dias sem venda na holding")

    # 3) Leads novos (rd_deals) — janelas em UTC real, como no cmo_cron
    try:
        agora_utc = datetime.now(timezone.utc)
        d1 = (agora_utc - timedelta(days=1)).isoformat()
        d7 = (agora_utc - timedelta(days=7)).isoformat()
        d14 = (agora_utc - timedelta(days=14)).isoformat()
        c24 = sb.table("rd_deals").select("id", count="exact").gte("created_at", d1).execute().count or 0
        c7 = sb.table("rd_deals").select("id", count="exact").gte("created_at", d7).execute().count or 0
        c14 = sb.table("rd_deals").select("id", count="exact").gte("created_at", d14).lt("created_at", d7).execute().count or 0
        parts.append(f"LEADS NOVOS (rd_deals): 24h = {c24} · 7d = {c7} · 7d anteriores = {c14}")
    except Exception as e:
        parts.append(f"LEADS NOVOS: sem dado ({str(e)[:80]})")

    # 4) Produção do apoio (ontem/anteontem útil) — gatilho de 2 dias <50%
    ap_linhas, ap_gat = _apoio_producao(sb, agora)
    parts.append("\n".join(ap_linhas))
    if ap_gat:
        gatilhos.append(ap_gat)

    # 5) Compromissos do caderninho (marca atrasados; gatilho ≥2 dias estourado)
    comps, comp_gat = _compromissos_sync(sb, agora)
    if comps:
        vivos = [c for c in comps if c.get("status") in ("aberto", "atrasado")]
        feitos7 = [c for c in comps if c.get("status") == "feito" and
                   str(c.get("atualizado_em") or "")[:10] >= (d - timedelta(days=7)).isoformat()]
        linhas = [f"- [{c.get('status')}] {str(c.get('o_que'))[:90]} — dono {c.get('dono')} — prazo {c.get('prazo') or 'sem prazo'}"
                  for c in vivos[:15]]
        parts.append("CADERNINHO DE COMPROMISSOS (cobrança do CEO):\n" + ("\n".join(linhas) or "- nenhum aberto")
                     + (f"\n- feitos nos últimos 7d: {len(feitos7)}" if feitos7 else ""))
    else:
        parts.append("CADERNINHO DE COMPROMISSOS: vazio.")
    if comp_gat:
        gatilhos.append(comp_gat)

    # 6) Último relatório do CFO (dossiês em diretoria_dossies, autor CFO)
    try:
        dos = (_kv_get(sb, KV_DOSSIES, {}).get("items") or [])
        cfo = next((i for i in dos if isinstance(i, dict) and "cfo" in str(i.get("autor") or "").lower()), None)
        if cfo:
            parts.append(f"ÚLTIMO RELATÓRIO DO CFO ({str(cfo.get('criado_em'))[:10]} · {cfo.get('titulo')}):\n"
                         + str(cfo.get("corpo_md") or "")[:1800])
        else:
            parts.append("RELATÓRIO DO CFO: nenhum publicado ainda.")
        rad = (_kv_get(sb, "sr_cfo_radar", {}).get("itens") or [])[:5]
        if rad:
            parts.append("RADAR DE RISCOS DO CFO:\n" + "\n".join(
                f"- [{r.get('nivel')}] {str(r.get('titulo'))[:80]}" for r in rad if isinstance(r, dict)))
    except Exception:
        pass

    # 7) Último relatório do CMO (shared_kv cmo_relatorios)
    cmo = (_kv_get(sb, "cmo_relatorios", {}).get("itens") or [])
    ult_cmo = next((i for i in cmo if isinstance(i, dict)), None)
    if ult_cmo:
        parts.append(f"ÚLTIMO RELATÓRIO DO CMO ({ult_cmo.get('tipo')} · {str(ult_cmo.get('ts'))[:10]}):\n"
                     + str(ult_cmo.get("texto") or "")[:1800])
    else:
        parts.append("RELATÓRIO DO CMO: nenhum publicado ainda.")

    # 8) Histórico do próprio CEO (alertas repetidos = estrutural)
    meus = (_kv_get(sb, KV_LOG, {}).get("items") or [])
    alertas = [i for i in meus if isinstance(i, dict) and i.get("alerta")][:7]
    if alertas:
        parts.append("SEUS ALERTAS RECENTES (repetição = problema estrutural):\n" + "\n".join(
            f"- {i.get('data')}: {str(i.get('primeira_linha'))[:110]}" for i in alertas))

    # 9) Estado da União: semana fechada + (1ª segunda) fechamento do mês anterior
    if tipo == "estado-da-uniao":
        seg_atual = d - timedelta(days=d.weekday())
        sem_ini = datetime.combine(seg_atual - timedelta(days=7), datetime.min.time(), BRT)
        sem_fim = datetime.combine(seg_atual, datetime.min.time(), BRT)
        ws, werr = _deals_win(sb, sem_ini.astimezone(timezone.utc).isoformat(),
                              sem_fim.astimezone(timezone.utc).isoformat())
        if not werr:
            parts.append(f"SEMANA FECHADA ({sem_ini.date().isoformat()} → {(sem_fim.date() - timedelta(days=1)).isoformat()}): "
                         f"{len(ws)} vendas · VGV {_fmt_reais(sum(float(w.get('amount') or 0) for w in ws))}")
        if d.day <= 7:  # 1ª segunda do mês
            prev_fim = mes_ini_brt
            prev_ini = (prev_fim - timedelta(days=1)).replace(day=1)
            ms, merr = _deals_win(sb, prev_ini.astimezone(timezone.utc).isoformat(),
                                  prev_fim.astimezone(timezone.utc).isoformat())
            mvgv, mvnd = _meta_mes(sb, prev_ini.year, prev_ini.month)
            if not merr:
                tot = sum(float(w.get("amount") or 0) for w in ms)
                parts.append(f"FECHAMENTO DO MÊS ANTERIOR ({prev_ini.month:02d}/{prev_ini.year}): "
                             f"{len(ms)} vendas · VGV {_fmt_reais(tot)} · meta {_fmt_reais(mvgv)} ({mvnd} vendas)"
                             + (f" · atingimento {tot / mvgv * 100:.0f}%" if mvgv else ""))
            plano = _kv_get(sb, "plano_resgate_2026", {})
            if plano:
                trecho = ""
                for s in (plano.get("secoes") or []):
                    if isinstance(s, dict) and s.get("id") in ("diagnostico", "gates", "metas"):
                        trecho += f"\n[{s.get('titulo')}]\n" + str(s.get("corpo") or "")[:700]
                if plano.get("meses"):
                    trecho += "\n[Checklist por mês]\n" + json.dumps(plano.get("meses"), ensure_ascii=False)[:900]
                parts.append("PLANO DE RESGATE (rumo ao gate de dezembro — break-even R$70k, "
                             "equipes pagando pró-labore):" + (trecho or " sem detalhe no kv."))

    return "\n\n".join(parts)[:18000], gatilhos


# ─── Geração + persistência ────────────────────────────────────────────
def _gerar(sb, tipo, agora, actor_name="ceo-cron"):
    ctx, gatilhos = _contexto(sb, tipo, agora)
    data = agora.date().isoformat()
    hoje = agora.strftime("%d/%m/%Y %H:%M")
    aviso = ""
    if gatilhos:
        aviso = ("\n\n⚠️ GATILHOS DE ALERTA DISPARADOS (hard-coded — a 1ª linha DEVE ser "
                 "'🚨 ALERTA: …' citando o principal): " + " | ".join(gatilhos))
    prompt = (PERSONA + f"\n\nHOJE: {hoje} ({['segunda','terça','quarta','quinta','sexta','sábado','domingo'][agora.weekday()]}-feira)"
              + f"\n\n{INSTRUCOES[tipo]}{aviso}\n\n═══ DADOS REAIS ═══\n\n" + (ctx or "(sem dados)"))
    texto, provider, err = _ia(prompt, max_tokens=1200 if tipo == "diaria" else 1800)
    if not texto:
        return None, err

    linhas = [l for l in texto.split("\n")]
    primeira = next((l.strip() for l in linhas if l.strip()), "")
    alerta = bool(gatilhos) or primeira.startswith("🚨") or "🚨" in primeira[:20]
    if gatilhos and not primeira.startswith("🚨"):
        primeira = "🚨 ALERTA: " + "; ".join(gatilhos)[:180]
        corpo = texto
    else:
        idx = next((i for i, l in enumerate(linhas) if l.strip()), 0)
        corpo = "\n".join(linhas[idx + 1:]).strip() or texto
    agora_iso = datetime.now(timezone.utc).isoformat()
    item = {"data": data, "tipo": tipo, "alerta": alerta, "primeira_linha": primeira[:300],
            "corpo_md": corpo, "criado_em": agora_iso, "provider": provider, "gerado_por": actor_name}

    # log compacto (idempotente por data: substitui a entrada do dia)
    def mut_log(box):
        items = [i for i in (box.get("items") or []) if isinstance(i, dict) and i.get("data") != data]
        items.insert(0, item)
        items.sort(key=lambda i: str(i.get("data") or ""), reverse=True)
        box["items"] = items[:MAX_LOG]
        return box
    _kv_write_locked(sb, KV_LOG, mut_log)

    # dossiê completo: Estado da União SEMPRE; diária SÓ quando alerta
    if tipo == "estado-da-uniao" or alerta:
        dtipo = "estado-da-uniao" if tipo == "estado-da-uniao" else "parecer"
        did = f"ceo_{data}_{dtipo}"
        titulo = (f"Estado da União — semana de {agora.strftime('%d/%m')}" if dtipo == "estado-da-uniao"
                  else f"Leitura de exceção — {agora.strftime('%d/%m')}")
        dossie = {"id": did, "tipo": dtipo, "titulo": titulo, "manchete": primeira[:200],
                  "corpo_md": texto, "autor": "CEO", "criado_em": agora_iso,
                  "fontes": ["ceo_cron (deals, metas, rd_deals, producao_eventos, CFO, CMO, compromissos)"]}

        def mut_dos(box):
            items = [i for i in (box.get("items") or []) if isinstance(i, dict) and i.get("id") != did]
            items.insert(0, dossie)
            box["items"] = items[:MAX_DOSSIES]
            return box
        _kv_write_locked(sb, KV_DOSSIES, mut_dos)

    # push SÓ pros sócios: alerta ou Estado da União. Dia ✅ = silêncio absoluto.
    if alerta or tipo == "estado-da-uniao":
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us
                      if (u.get("status") or "ativo") == "ativo" and lvl_of((u.get("role") or "").lower()) >= 10]
            titulo_push = ("🚨 ALERTA do CEO" if alerta else "🏛️ Estado da União")
            preview = primeira.replace("\n", " ")[:180]
            notify(socios, "ceo_leitura", titulo_push, body=preview, link="#/diretoria-ceo",
                   target_type="ceo_leitura", target_id=data)
            send_web_push(socios, titulo_push, body=preview, link="#/diretoria-ceo", tag="ceo_leitura")
        except Exception:
            pass
    return item, None


# ─── Handler ───────────────────────────────────────────────────────────
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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _cron_ok(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        return bool(secret) and tok == secret

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(url.query))

        # leitura do log pela página (sócio)
        if params.get("log"):
            try:
                require_user(self, min_lvl=10)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            items = [i for i in (_kv_get(sb, KV_LOG, {}).get("items") or []) if isinstance(i, dict)]
            return self._send(200, {"ok": True, "items": items})

        if not params.get("cron"):
            return self._send(400, {"ok": False, "error": "use ?cron=1 (gera a leitura do dia) ou ?log=1 (lê o histórico)"})
        if not self._cron_ok():
            try:
                require_user(self, min_lvl=10)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        agora = agora_brt()
        data = agora.date().isoformat()
        tipo = "estado-da-uniao" if agora.weekday() == 0 else "diaria"
        existentes = _kv_get(sb, KV_LOG, {}).get("items") or []
        if any(isinstance(i, dict) and i.get("data") == data for i in existentes):
            return self._send(200, {"ok": True, "pulado": f"{data} já gerado", "tipo": tipo})
        item, err = _gerar(sb, tipo, agora)
        if not item:
            return self._send(502, {"ok": False, "error": err})
        return self._send(200, {"ok": True, "gerado": {"data": data, "tipo": tipo, "alerta": item["alerta"],
                                                       "primeira_linha": item["primeira_linha"]}})

    def do_POST(self):
        # sócio força regeração AGORA (substitui a entrada do dia — não duplica)
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0)
            body = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if (body.get("action") or "gerar") != "gerar":
            return self._send(400, {"ok": False, "error": "action deve ser 'gerar'"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        agora = agora_brt()
        tipo = "estado-da-uniao" if agora.weekday() == 0 else "diaria"
        item, err = _gerar(sb, tipo, agora, actor_name=user.get("login") or user.get("name") or "manual")
        if not item:
            return self._send(502, {"ok": False, "error": err})
        audit(self, user, "ceo.leitura_manual", target_type="ceo_diario", target_id=item["data"])
        return self._send(200, {"ok": True, "item": {k: item[k] for k in ("data", "tipo", "alerta", "primeira_linha")}})
