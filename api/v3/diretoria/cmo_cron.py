# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/diretoria/cmo_cron — rotina do agente CMO na NUVEM (v87.42)

Decisão do Paulo (05/set/2026): "não conseguimos ligar o passo 1 por aqui?"
— as 3 tarefas do CMO saem do PC Windows e viram cron do Vercel (mesmo motor
do gestor_relatorio): rodam com TUDO desligado. As tarefas de navegador
(radares/vigia/faxina RD) continuam no Windows.

Cadência (BRT):
  - DIÁRIO   19h15 (após o relatório 19h do Tráfego) — leitura de exceção
  - SEMANAL  segunda 8h — Placar Semanal
  - MENSAL   dia 1º 9h — CAC/ROAS + gargalo + reporte executivo
             (em jan/abr/jul/out inclui o rito TRIMESTRAL no mesmo texto)

GET  ?cron=1&tipo=auto|diario|semanal|mensal → gera o que venceu e ainda não
     existe (Bearer CRON_SECRET ou lvl>=10). Idempotente por período.
POST {action:"gerar", tipo} → força AGORA (sócio lvl>=10; regenera).

Escreve em shared_kv cmo_relatorios {itens:[{id,tipo,periodo,ts,texto,alerta,
gerado_por}]} — o cockpit Diretoria → 🎯 CMO · Marketing lê daí. Notifica os
sócios (in-app + push) a cada geração.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import json
import os
import sys
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, audit, supabase_client,  # type: ignore
                       lvl_of, notify, send_web_push, agora_brt)

KV_RELATORIOS = "cmo_relatorios"
TIPOS = ("diario", "semanal", "mensal")

PERSONA = (
    "Você é o CMO da holding PSM (São José do Rio Preto/SP) — C-level de marketing acima dos "
    "executores (Curador, Copywriter, Design, Vídeo, Social, Community, Agendador, SEO, Orgânico, "
    "Gestor de Tráfego, MKT MRR, Auditor). Você NÃO executa: lê números, decide alocação, cobra "
    "resultado e reporta ao sócio. Regras: (1) baseie-se EXCLUSIVAMENTE nos dados abaixo — cite "
    "números reais; dado ausente = escreva 'sem dado' e diga quem instrumenta, NUNCA invente; "
    "(2) você recomenda, o Paulo decide — nenhuma ação é executada por você; (3) português BR, "
    "formato executivo, zero vícios de IA (proibido 'Não é X. É Y.' e variações); (4) contexto de "
    "caixa: Plano de Resgate (break-even R$70k/mês) — verba segue capacidade de atendimento + ROAS, "
    "nunca vaidade; meta Conquista: 5.000 seguidores locais antes da chave de conversão."
)

INSTRUCOES = {
    "diario": (
        "RITO DIÁRIO — LEITURA DE EXCEÇÃO (máx ~120 palavras). A PRIMEIRA LINHA é obrigatoriamente "
        "'✅ CMO diário: nada a reportar' OU '🚨 ALERTA CMO' OU '🔧 CMO: DADO QUEBRADO' — decida assim: "
        "FONTE: os números da seção 'META ADS VERIFICADO' são a verdade; o relatório do Gestor de Tráfego é "
        "leitura secundária. Se a seção 'DIVERGÊNCIA DETECTADA' existir, a primeira linha é '🔧 CMO: DADO QUEBRADO' "
        "(diga o que o relatório afirmou × o que o Meta mostra e que o dono é o técnico do House) — e em seguida "
        "faça a leitura normal com os números verificados. NUNCA declare campanha parada/gasto zero se o "
        "VERIFICADO mostra gasto. Alarmes de 🚨 (só com número verificado): "
        "(a) CPL de ONTEM acima de ~150% da média 7d; (b) gasto verificado zerado ontem; "
        "(c) leads de ONTEM muito abaixo da média diária 7d. "
        "Se ✅: complete com 1 linha de números de ONTEM (gasto, leads, CPL, por marca) e PARE — o diário existe "
        "pra pegar incêndio, não pra produzir relatório. "
        "Se 🚨: número que estourou + causa provável + ação recomendada + qual executor age."
    ),
    "semanal": (
        "PLACAR SEMANAL (segunda 8h — semana fechada vs anterior, máx ~380 palavras). Estrutura: "
        "1) 📊 Funil da semana (gasto, leads, CPL, e vendas/atividade do CRM se houver dado — variação vs semana anterior); "
        "2) 🎯 GARGALO DO MÊS (declarado no último fechamento — status: melhorou/piorou/parado, com número; se nunca declarado, diga); "
        "3) ⚖️ Placar de Notas do Auditor (média por agente, % abaixo do corte 8; sem notas = 'Auditor ainda sem rodadas'); "
        "4) 🧪 Testes e backlog (teste ativo vs kill criteria; top-3 do backlog ICE; vazio = dizer); "
        "5) 🗃 Decisões em revisão (as com revisao_em vencida: confirmou ou não); "
        "6) 🚨 Anomalias (executor sem rotina, alerta repetido no diário); "
        "7) ✅ 3 DECISÕES DA SEMANA (escalar/cortar/testar — número e dono) + pauta da mesa (máx 5 itens)."
    ),
    "mensal": (
        "FECHAMENTO DE MÊS DO CMO (mês anterior completo, máx ~500 palavras). Estrutura: "
        "1) 📊 Placar do mês (gasto, leads, CPL, vendas por origem quando houver dado; CAC aproximado = gasto ÷ vendas — declare as limitações do dado); "
        "2) 🎯 GARGALO ÚNICO DO MÊS SEGUINTE — declare UM (etapa do funil que mais perde), com número atual, meta e executor dono. Duas prioridades = nenhuma; "
        "3) 🏆 3 acertos e 📉 3 erros com causa; "
        "4) 🎓 Aprendizado (alertas repetidos = problema estrutural; veredito dos testes encerrados); "
        "5) 💰 Proposta de budget do mês seguinte por nicho (dizendo DE ONDE sai) — marcar 'AGUARDANDO APROVAÇÃO DO PAULO'; "
        "6) Se o mês fechado terminar um trimestre (mar/jun/set/dez), acrescente seção ♟️ TRIMESTRE: mix de nichos (onde o CAC compensa), mata/mantém iniciativas, metas do próximo trimestre."
    ),
}

TITULOS = {"diario": "🎯 CMO · leitura do dia", "semanal": "🎯 CMO · Placar Semanal",
           "mensal": "🎯 CMO · Fechamento do mês"}


# ─── IA (mesma cadeia do gestor_relatorio) ─────────────────────────────
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


# ─── KV helpers (autossuficientes — sem import cruzado de /marketing) ──
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
                                  "updated_at": datetime.now(timezone.utc).isoformat()}).execute()


# ─── Meta verificado (v87.83) ──────────────────────────────────────────
# De 10 a 14/09 o diário do CMO disparou "🚨 gasto zerado, 0 leads" com R$ 400+/dia
# no ar: ele repetia o relatório do Tráfego, que lia um campo inexistente. Agora o
# CMO lê o cache do Meta DIRETO (mesma tabela que o cron aquece) e trata o relatório
# do Tráfego como opinião — nunca como fonte do número.
def _meta_verificado(sb, preset):
    """{spend, leads, cpl, por_conta:[...], label} ou None (sem dado ≠ zero)."""
    try:
        rows = (sb.table("meta_ads_cache").select("payload")
                .eq("cache_key", preset + "||").limit(1).execute().data or [])
        p = rows[0].get("payload") if rows else None
        if not isinstance(p, dict):
            return None
        tot = ((p.get("totals") or {}).get("cur")) or {}
        contas = [a for a in (p.get("accounts") or []) if isinstance(a, dict) and not a.get("_error")]
        base = [tot] if tot else (contas or [c for c in (p.get("campaigns") or []) if isinstance(c, dict)])
        if not base:
            return None
        sp = sum(float(x.get("spend") or 0) for x in base)
        ld = int(sum(float(x.get("results") or 0) for x in base))
        por = [{"conta": a.get("label") or a.get("id"), "spend": float(a.get("spend") or 0),
                "leads": int(a.get("results") or 0)} for a in contas
               if float(a.get("spend") or 0) > 0 or int(a.get("results") or 0) > 0]
        return {"spend": round(sp, 2), "leads": ld, "cpl": round(sp / ld, 2) if ld else None,
                "por_conta": por, "label": ((p.get("period") or {}).get("label") or preset)}
    except Exception:
        return None


def _fmt_meta(nome, m):
    if not m:
        return f"{nome}: SEM DADO no cache (não afirmar gasto zero)"
    linha = (f"{nome} [{m['label']}]: gasto R$ {m['spend']:,.2f} · {m['leads']} leads · "
             f"CPL {'R$ %.2f' % m['cpl'] if m['cpl'] else '—'}")
    for c in m["por_conta"]:
        cpl = f"R$ {c['spend'] / c['leads']:,.2f}" if c["leads"] else "—"
        linha += f"\n  · {c['conta']}: R$ {c['spend']:,.2f} · {c['leads']} leads · CPL {cpl}"
    return linha


_ZERO_RX = None


def _divergencia(gt_item, ontem):
    """Checagem em CÓDIGO (não na IA): relatório diário do Tráfego das últimas 30h
    afirmando gasto zero / sem dado enquanto o Meta verificado de ontem tem gasto."""
    global _ZERO_RX
    import re
    if not gt_item or not ontem or ontem["spend"] < 50:
        return None
    try:
        ts = datetime.fromisoformat(str(gt_item.get("ts")).replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - ts > timedelta(hours=30):
            return None
    except Exception:
        return None
    # só a seção de NÚMEROS (antes de alertas/destaques): uma campanha com 0 leads
    # ou um "sem dado" do CRM mais abaixo não podem virar falsa divergência
    t = str(gt_item.get("texto") or "")
    ini = max(t.find("📊"), 0)
    corte = re.search(r"(🚨|🎯|⚡|🏆|alertas|destaques)", t[ini + 1:], re.I)
    t = t[: (ini + 1 + corte.start()) if corte else 900][:900]
    # o valor da métrica é zero ou "sem dado": "Gasto: R$ 0", "Leads: 0 (sem dado)", "CPL R$ 0,00 (sem dado)"
    _ZERO_RX = _ZERO_RX or re.compile(
        r"(gasto|leads|cpl)[:*\s]{0,8}(R\$\s*)?(0(?:[.,]0+)?(?![\d.,])\s*)?(\(?\s*sem dado|(?<=0)(?!\s*[\d.,]))", re.I)
    m = _ZERO_RX.search(t)
    if not m:
        return None
    return (f"relatório do Tráfego ({str(gt_item.get('ts'))[:16]}) diz \"{m.group(0)}\"; "
            f"o Meta verificado de {ontem['label']} mostra R$ {ontem['spend']:,.2f} e {ontem['leads']} leads")


# ─── Contexto (fontes diretas do banco) ────────────────────────────────
def _contexto(sb, tipo):
    parts = []

    # 0) Meta VERIFICADO — fonte primária do número
    ontem = _meta_verificado(sb, "yesterday")
    parts.append("META ADS VERIFICADO (cache do Meta aquecido pelo cron — FONTE DO NÚMERO):\n" + "\n".join([
        _fmt_meta("ONTEM (dia fechado)", ontem),
        _fmt_meta("HOJE (parcial)", _meta_verificado(sb, "today")),
        _fmt_meta("ÚLTIMOS 7 DIAS", _meta_verificado(sb, "last_7d")),
    ] + ([_fmt_meta("ÚLTIMOS 30 DIAS", _meta_verificado(sb, "last_30d"))] if tipo != "diario" else [])))

    # 1) Relatórios do Sr. Gestor de Tráfego (carregam os números do Meta)
    gt = sorted([i for i in (_kv_get(sb, "gt_relatorios", {}).get("itens") or []) if isinstance(i, dict)],
                key=lambda i: str(i.get("ts") or ""), reverse=True)   # o mais recente de cada tipo
    div = _divergencia(next((i for i in gt if i.get("tipo") == "diario"), None), ontem)
    if div:
        parts.insert(1, "🔧 DIVERGÊNCIA DETECTADA PELO SISTEMA (checagem em código): " + div)
    quer = {"diario": ["diario"], "semanal": ["semanal", "diario"], "mensal": ["mensal", "semanal"]}[tipo]
    usados = 0
    for q in quer:
        for it in gt:
            if it.get("tipo") == q and usados < 3:
                parts.append(f"LEITURA {q.upper()} DO GESTOR DE TRÁFEGO — secundária, os números valem do "
                             f"VERIFICADO ({str(it.get('ts'))[:16]}):\n" + str(it.get("texto") or "")[:4000])
                usados += 1
                break
    if not usados:
        parts.append("RELATÓRIOS DO TRÁFEGO: nenhum disponível (sem dado de mídia — declarar no texto).")

    # 2) Vigia de concorrência (último insight)
    try:
        vg = _kv_get(sb, "gt_vigia", {})
        ins = [i for i in ((vg or {}).get("insights") or []) if isinstance(i, dict)][:1]
        if ins:
            i = ins[0]
            parts.append(f"🕵️ VIGIA DE CONCORRÊNCIA ({str(i.get('ts'))[:16]}): {i.get('titulo')}: "
                         + str(i.get("insight"))[:400])
    except Exception:
        pass

    # 3) Funil (RD espelhado no House): leads por janela + ganhos do mês
    try:
        agora = datetime.now(timezone.utc)
        d1 = (agora - timedelta(days=1)).isoformat()
        d7 = (agora - timedelta(days=7)).isoformat()
        d14 = (agora - timedelta(days=14)).isoformat()
        c24 = sb.table("deals").select("id", count="exact").gte("created_at_rd", d1).execute().count or 0
        c7 = sb.table("deals").select("id", count="exact").gte("created_at_rd", d7).execute().count or 0
        c14 = sb.table("deals").select("id", count="exact").gte("created_at_rd", d14).lt("created_at_rd", d7).execute().count or 0
        parts.append(f"LEADS NO CRM (deals/RD): últimas 24h = {c24} · últimos 7d = {c7} · 7d anteriores = {c14}")
    except Exception as e:
        parts.append(f"LEADS NO CRM: sem dado ({str(e)[:80]})")

    # 4) Estado interno do CMO
    if tipo in ("semanal", "mensal"):
        ns = (_kv_get(sb, "cmo_notas", {}).get("itens") or [])[:60]
        if ns:
            por = {}
            for n in ns:
                por.setdefault(str(n.get("agente") or "?"), []).append(float(n.get("nota") or 0))
            linhas = [f"- {a}: média {sum(v)/len(v):.1f} em {len(v)} notas" for a, v in por.items()]
            abaixo = sum(1 for n in ns for _ in [0] if float(n.get("nota") or 0) < 8)
            parts.append("PLACAR DE NOTAS DO AUDITOR:\n" + "\n".join(linhas)
                         + f"\n- reprovadas no corte 8: {abaixo}/{len(ns)}")
        else:
            parts.append("PLACAR DE NOTAS DO AUDITOR: sem notas ainda (Auditor sem rodadas).")
        bl = (_kv_get(sb, "cmo_backlog", {}).get("itens") or [])[:15]
        if bl:
            parts.append("BACKLOG ICE (top itens):\n" + "\n".join(
                f"- [{b.get('status')}] {str(b.get('ideia'))[:80]} (nicho {b.get('nicho')})" for b in bl))
        else:
            parts.append("BACKLOG ICE: vazio.")
        dc = (_kv_get(sb, "cmo_decisoes", {}).get("itens") or [])[:15]
        if dc:
            hoje = datetime.now(timezone.utc).date().isoformat()
            parts.append("DECISION LOG:\n" + "\n".join(
                f"- {str(d.get('ts'))[:10]} {str(d.get('decisao'))[:90]} (revisão {d.get('revisao_em') or '—'}"
                + (", VENCIDA" if (d.get('revisao_em') and str(d.get('revisao_em'))[:10] <= hoje and not d.get('resultado')) else "")
                + f", resultado: {d.get('resultado') or 'aguardando'})" for d in dc))

    # 5) Histórico do próprio CMO (gargalo declarado + alertas repetidos)
    meus = (_kv_get(sb, KV_RELATORIOS, {}).get("itens") or [])
    ult_mensal = next((i for i in meus if i.get("tipo") == "mensal"), None)
    if ult_mensal:
        parts.append("SEU ÚLTIMO FECHAMENTO MENSAL (contém o gargalo declarado):\n"
                     + str(ult_mensal.get("texto"))[:1500])
    alertas7 = [i for i in meus if i.get("tipo") == "diario" and i.get("alerta")][:7]
    if alertas7:
        parts.append("SEUS ALERTAS DIÁRIOS RECENTES (repetição = problema estrutural):\n" + "\n".join(
            f"- {str(i.get('ts'))[:10]}: {str(i.get('texto'))[:120]}" for i in alertas7))

    return "\n\n".join(parts)[:18000]


# ─── Períodos / vencimento (BRT) ───────────────────────────────────────
def _periodo_devido(tipo, agora):
    d = agora.date()
    if tipo == "diario":
        return f"diario:{d.isoformat()}" if (agora.hour, agora.minute) >= (19, 10) else None
    if tipo == "semanal":
        seg = d - timedelta(days=d.weekday())
        if d == seg and agora.hour < 8:
            return None
        return f"semanal:{seg.isoformat()}"
    if tipo == "mensal":
        if d.day == 1 and agora.hour < 9:
            return None
        prev = (d.replace(day=1) - timedelta(days=1))
        return f"mensal:{prev.strftime('%Y-%m')}"
    return None


def _gerar(sb, tipo, periodo, actor_name="cmo-cron"):
    ctx = _contexto(sb, tipo)
    hoje = agora_brt().strftime("%d/%m/%Y %H:%M")
    prompt = (PERSONA + f"\n\nHOJE: {hoje}\nPERÍODO: {periodo}\n\n{INSTRUCOES[tipo]}\n\n"
              "═══ DADOS REAIS ═══\n\n" + (ctx or "(sem dados)"))
    texto, provider, err = _ia(prompt)
    if not texto:
        return None, err
    alerta = tipo == "diario" and "🚨" in texto[:120]
    dado_quebrado = "🔧" in texto[:120]
    box = _kv_get(sb, KV_RELATORIOS, {"itens": []})
    itens = [i for i in (box.get("itens") or []) if isinstance(i, dict)]
    item = {"id": "cmo_" + uuid.uuid4().hex[:10], "tipo": tipo, "periodo": periodo,
            "ts": datetime.now(timezone.utc).isoformat(), "texto": texto,
            "alerta": alerta, "dado_quebrado": dado_quebrado, "provider": provider, "gerado_por": actor_name}
    itens.insert(0, item)
    itens.sort(key=lambda i: str(i.get("ts") or ""), reverse=True)
    _kv_set(sb, KV_RELATORIOS, {"itens": itens[:120]})

    # notifica sócios — diário SÓ quando é alerta (regra do rito: dia normal = 1 linha, sem barulho)
    if tipo != "diario" or alerta or dado_quebrado:
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us
                      if (u.get("status") or "ativo") == "ativo" and lvl_of((u.get("role") or "").lower()) >= 10]
            titulo = ("🚨 ALERTA do CMO" if alerta else
                      "🔧 CMO: dado quebrado no relatório do Tráfego" if dado_quebrado else TITULOS[tipo])
            preview = texto.replace("\n", " ")[:180]
            notify(socios, "cmo_relatorio", titulo, body=preview, link="#/cmo?tab=relatorios",
                   target_type="cmo_relatorio", target_id=item["id"])
            send_web_push(socios, titulo, body=preview, link="#/cmo?tab=relatorios", tag="cmo_relatorio")
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
        if not params.get("cron"):
            return self._send(400, {"ok": False, "error": "use ?cron=1&tipo=auto|diario|semanal|mensal"})
        if not self._cron_ok():
            try:
                require_user(self, min_lvl=10)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        tipo = params.get("tipo") or "auto"
        alvos = TIPOS if tipo == "auto" else ([tipo] if tipo in TIPOS else [])
        if not alvos:
            return self._send(400, {"ok": False, "error": f"tipo inválido. Use: auto|{'|'.join(TIPOS)}"})
        agora = agora_brt()
        itens = _kv_get(sb, KV_RELATORIOS, {}).get("itens") or []
        gerados, pulados, erros = [], [], []
        for t in alvos:
            periodo = _periodo_devido(t, agora)
            if not periodo:
                pulados.append({"tipo": t, "motivo": "ainda não venceu"})
                continue
            if any(i.get("periodo") == periodo for i in itens):
                pulados.append({"tipo": t, "motivo": f"{periodo} já gerado"})
                continue
            item, err = _gerar(sb, t, periodo)
            if item:
                gerados.append({"tipo": t, "periodo": periodo, "id": item["id"], "alerta": item["alerta"]})
                itens.insert(0, item)
            else:
                erros.append({"tipo": t, "erro": err})
        return self._send(200, {"ok": not erros, "gerados": gerados, "pulados": pulados, "erros": erros})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0)
            body = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        tipo = (body.get("tipo") or "").strip()
        if tipo not in TIPOS:
            return self._send(400, {"ok": False, "error": f"tipo deve ser um de {TIPOS}"})
        sb = supabase_client()
        agora = agora_brt()
        periodo = _periodo_devido(tipo, agora) or f"{tipo}:manual-{agora.strftime('%Y-%m-%d-%H%M')}"
        item, err = _gerar(sb, tipo, periodo, actor_name=user.get("login") or user.get("name") or "manual")
        if not item:
            return self._send(502, {"ok": False, "error": err})
        audit(self, user, "cmo.relatorio_cron_manual", target_type="cmo_relatorio", target_id=item["id"])
        return self._send(200, {"ok": True, "item": {k: item[k] for k in ("id", "tipo", "periodo", "alerta")}})
