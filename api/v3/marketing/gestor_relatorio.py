# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/marketing/gestor_relatorio — relatórios do Sr. Gestor de Tráfego (v87.6)

Cadência definida pelo sócio (03/set/2026):
  - DIÁRIO      todo dia às 19h00 BRT
  - SEMANAL     toda segunda às 18h00 BRT
  - QUINZENAL   todo dia 15 às 19h00 BRT
  - MENSAL      fechamento — dia 1º às 8h00 BRT (cobre o mês anterior)

GET  (lvl>=5)                → { ok, relatorios: [...] } (mais recentes primeiro)
GET  ?cron=1&tipo=auto       → gera o que estiver VENCIDO e ainda não gerado
                               (Bearer CRON_SECRET ou lvl>=7). Idempotente por
                               chave de período — pode rodar de 30 em 30min via
                               heartbeat + crons do vercel.json sem duplicar.
GET  ?cron=1&tipo=diario|semanal|quinzenal|mensal → idem, só aquele tipo.
POST {action:"gerar", tipo}  → força geração AGORA (sócio lvl>=10; regenera o
                               período mesmo que já exista).

Relatórios em shared_kv gt_relatorios {itens:[{id,tipo,periodo,ts,texto,provider}]}
(cap 60). Cada geração notifica os SÓCIOS (in-app + web push).
IA: mesma cadeia do sr_agente (Gemini primário, header x-goog-api-key).
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
# helpers do módulo irmão (mesmo padrão de comercial_analise.py → simulador.py)
from gestor import (kv_get, kv_set, avaliar_alertas, _metricas_do_payload,  # type: ignore
                    KV_CONFIG, KV_ALERTAS, KV_LOG)
from _meta_cache_lib import build_cache_key, read_cache  # type: ignore

KV_RELATORIOS = "gt_relatorios"

TIPOS = ("diario", "semanal", "quinzenal", "mensal")

INSTRUCOES = {
    "diario": (
        "RELATÓRIO DIÁRIO (pulso do dia, máx ~220 palavras). Estrutura: "
        "1) 📊 Números do dia (gasto, leads, CPL de hoje/ontem da série diária; compare com a média 7d); "
        "2) 🚨 Alertas (só os disparados; se nenhum, uma linha dizendo que está tudo dentro); "
        "3) 🎯 3 destaques (campanha melhor, pior, movimento relevante); "
        "4) ⚡ Ação de amanhã (1 a 2 ações concretas e priorizadas)."
    ),
    "semanal": (
        "RELATÓRIO SEMANAL (segunda-feira — leitura da semana fechada vs anterior, máx ~350 palavras). Estrutura: "
        "1) 📊 Semana em números (7d: gasto, leads, CPL, CTR — com variação vs período anterior quando houver); "
        "2) 🏆 Campanhas: top e piores por CPL com números; "
        "3) 👥 Públicos & criativos: sinais de fadiga (frequência), o que rotacionar; "
        "4) 🚨 Alertas da semana; "
        "5) 🗺 Plano da semana: 3 a 5 ações priorizadas com impacto esperado."
    ),
    "quinzenal": (
        "RELATÓRIO QUINZENAL (dia 15 — leitura estratégica da 1ª quinzena, máx ~350 palavras). Estrutura: "
        "1) 📊 Quinzena vs meta da estratégia vigente (ritmo de verba e de leads: fecha o mês como?); "
        "2) 🧭 Diagnóstico estrutural (mix de campanhas, marcas, funil — o que os números dizem); "
        "3) 👥 Públicos: o que saturou, o que testar na 2ª quinzena; "
        "4) ⚡ Correções de rota pra 2ª quinzena (priorizadas)."
    ),
    "mensal": (
        "FECHAMENTO DE MÊS (mês anterior completo, máx ~450 palavras). Estrutura: "
        "1) 📊 Mês em números (30d: gasto, leads, CPL, CTR) e leitura vs estratégia/verba definida; "
        "2) 🏆 O que funcionou (campanhas/abordagens com números); "
        "3) 📉 O que não funcionou e por quê; "
        "4) 🎓 Aprendizados do mês (padrões pra guardar); "
        "5) 🗺 Plano do próximo mês: estrutura de campanhas, públicos e verba recomendada."
    ),
}


# ─── IA (mesma cadeia do sr_agente) ────────────────────────────────────
def _ia(prompt, max_tokens=1500):
    prefer = (os.environ.get("AI_PREFER") or "gemini").strip().lower()
    gem_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    ant_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()

    def gemini():
        model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                   "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.5,
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


# ─── Contexto de dados ─────────────────────────────────────────────────
def _contexto(sb):
    parts = []
    cfg = kv_get(sb, KV_CONFIG, {})
    est = cfg.get("estrategia") or {}
    if est.get("conquista") or est.get("imoveis"):
        parts.append("ESTRATÉGIA VIGENTE:\n[Conquista] " + str(est.get("conquista") or "—")[:3000] +
                     "\n[Imóveis] " + str(est.get("imoveis") or "—")[:3000])
    mc = cfg.get("metricas_custom") or []
    if mc:
        parts.append("MÉTRICAS PERSONALIZADAS:\n" + "\n".join(
            f"- {m.get('nome')}: {m.get('descricao')}" for m in mc[:20] if isinstance(m, dict)))

    for preset in ("last_7d", "last_30d"):
        payload, _age, _src = read_cache(sb, build_cache_key(preset, "", ""), 10 ** 9)
        m = _metricas_do_payload(payload)
        if not m:
            continue
        linhas = [f"{preset}: gasto R$ {m['spend']:,.0f} · {m['leads']} leads · CPL R$ {m['cpl']:,.2f} · CTR {m['ctr']}% · freq máx {m['frequency']}"]
        prev = ((payload.get("totals") or {}).get("prev")) or {}
        if prev.get("spend"):
            ps, pr = float(prev.get("spend") or 0), int(prev.get("results") or 0)
            linhas.append(f"  período anterior: gasto R$ {ps:,.0f} · {pr} leads · CPL {'R$ %.2f' % (ps / pr) if pr else '—'}")
        camps = sorted([c for c in (payload.get("campaigns") or []) if float(c.get("spend") or 0) > 0],
                       key=lambda c: -float(c.get("spend") or 0))[:10]
        for c in camps:
            cs, cr = float(c.get("spend") or 0), int(c.get("results") or 0)
            linhas.append(f"  - [{c.get('account') or ''}] {str(c.get('name') or '')[:60]} ({c.get('status')}): "
                          f"R$ {cs:,.0f} · {cr} leads · CPL {'R$ %.2f' % (cs / cr) if cr else '—'} · CTR {c.get('ctr') or 0}")
        if preset == "last_7d":
            daily = (payload.get("dailySeries") or [])[-3:]
            for d in daily:
                ds, dr = float(d.get("spend") or 0), int(d.get("results") or 0)
                linhas.append(f"  dia {d.get('date') or ''}: R$ {ds:,.0f} · {dr} leads")
        parts.append("META ADS (" + preset + "):\n" + "\n".join(linhas))

    regras = (kv_get(sb, KV_ALERTAS, {}) or {}).get("regras") or []
    if regras:
        aval, _caches = avaliar_alertas(sb, regras)
        disparados = [a for a in aval if a.get("estado") == "disparado"]
        parts.append("ALERTAS: " + (
            "; ".join(f"{a.get('nome') or a.get('metrica')} ({a.get('metrica')} {a.get('op')} {a.get('valor')}, atual {a.get('valor_atual')}, {a.get('severidade')})"
                      for a in disparados) if disparados else "nenhum disparado"))

    log = (kv_get(sb, KV_LOG, {}) or {}).get("itens") or []
    if log:
        parts.append("ÚLTIMAS AÇÕES EXECUTADAS NO META:\n" + "\n".join(
            f"- {str(l.get('ts') or '')[:16]} {l.get('user')}: {l.get('op')} em {(l.get('alvo') or {}).get('nome')} {'✓' if l.get('ok') else '✗'}"
            for l in log[:8]))
    return "\n\n".join(parts)[:18000]


# ─── Períodos / vencimento ─────────────────────────────────────────────
def _periodo_devido(tipo, agora):
    """Chave do período que está vencido AGORA (ou None se ainda não venceu).
    agora = datetime BRT."""
    d = agora.date()
    if tipo == "diario":
        return f"diario:{d.isoformat()}" if agora.hour >= 19 else None
    if tipo == "semanal":
        seg = d - timedelta(days=d.weekday())
        if d == seg and agora.hour < 18:
            return None
        return f"semanal:{seg.isoformat()}"
    if tipo == "quinzenal":
        if d.day < 15 or (d.day == 15 and agora.hour < 19):
            return None
        return f"quinzenal:{d.strftime('%Y-%m')}"
    if tipo == "mensal":
        if agora.hour < 8 and d.day == 1:
            return None
        prev = (d.replace(day=1) - timedelta(days=1))
        return f"mensal:{prev.strftime('%Y-%m')}"
    return None


def _ja_gerado(itens, periodo):
    return any(i.get("periodo") == periodo for i in itens)


def _gerar(sb, tipo, periodo, actor_name="cron"):
    ctx = _contexto(sb)
    hoje = agora_brt().strftime("%d/%m/%Y %H:%M")
    prompt = (
        "Você é o Sr. Gestor de Tráfego, gestor de tráfego pago sênior da PSM Assessoria Imobiliária "
        "(São José do Rio Preto/SP — marcas PSM Conquista/MCMV e PSM Imóveis/alto padrão). "
        "Escreva um relatório EXECUTIVO para os sócios, em português BR, baseado EXCLUSIVAMENTE "
        "nos dados abaixo — cite números reais; se um dado não existir, diga 'sem dado' em vez de inventar. "
        "Tom: direto, de dono de orçamento. Use os emojis da estrutura pedida como títulos das seções.\n\n"
        f"HOJE: {hoje}\n\n{INSTRUCOES[tipo]}\n\n═══ DADOS REAIS ═══\n\n" + (ctx or "(sem dados no cache ainda)")
    )
    texto, provider, err = _ia(prompt)
    if not texto:
        return None, err
    box = kv_get(sb, KV_RELATORIOS, {"itens": []})
    itens = box.get("itens") or []
    item = {"id": "gtr_" + uuid.uuid4().hex[:10], "tipo": tipo, "periodo": periodo,
            "ts": datetime.now(timezone.utc).isoformat(), "texto": texto,
            "provider": provider, "gerado_por": actor_name}
    itens.insert(0, item)
    kv_set(sb, KV_RELATORIOS, {"itens": itens[:60]})

    # notifica os sócios (in-app + push)
    try:
        us = sb.table("users").select("id,role,status").execute().data or []
        socios = [u["id"] for u in us
                  if (u.get("status") or "ativo") == "ativo" and lvl_of((u.get("role") or "").lower()) >= 10]
        titulo = {"diario": "🚦 Relatório diário do tráfego",
                  "semanal": "🚦 Relatório semanal do tráfego",
                  "quinzenal": "🚦 Relatório quinzenal do tráfego",
                  "mensal": "🚦 Fechamento do mês — tráfego"}[tipo]
        preview = texto.replace("\n", " ")[:180]
        notify(socios, "gt_relatorio", titulo, body=preview, link="#/gestor-trafego?tab=relatorios",
               target_type="gt_relatorio", target_id=item["id"])
        send_web_push(socios, titulo, body=preview, link="#/gestor-trafego?tab=relatorios", tag="gt_relatorio")
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

        # ── modo cron: gera o que venceu ───────────────────────────────
        if params.get("cron"):
            if not self._cron_ok():
                try:
                    require_user(self, min_lvl=7)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            tipo = params.get("tipo") or "auto"
            tipos = TIPOS if tipo == "auto" else ([tipo] if tipo in TIPOS else [])
            if not tipos:
                return self._send(400, {"ok": False, "error": "tipo inválido"})
            agora = agora_brt()
            box = kv_get(sb, KV_RELATORIOS, {"itens": []})
            itens = box.get("itens") or []
            gerados, pulados = [], []
            for t in tipos:
                periodo = _periodo_devido(t, agora)
                if not periodo or _ja_gerado(itens, periodo):
                    pulados.append({"tipo": t, "periodo": periodo, "motivo": "não vencido" if not periodo else "já gerado"})
                    continue
                item, err = _gerar(sb, t, periodo)
                if item:
                    gerados.append({"tipo": t, "periodo": periodo})
                    itens = (kv_get(sb, KV_RELATORIOS, {"itens": []}) or {}).get("itens") or []
                else:
                    pulados.append({"tipo": t, "periodo": periodo, "motivo": f"erro IA: {err}"})
                break  # no máx 1 relatório por chamada (lotes leves; heartbeat volta em 30min)
            return self._send(200, {"ok": True, "gerados": gerados, "pulados": pulados})

        # ── listagem ───────────────────────────────────────────────────
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        box = kv_get(sb, KV_RELATORIOS, {"itens": []})
        return self._send(200, {"ok": True, "relatorios": (box.get("itens") or [])[:60]})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        tipo = str(body.get("tipo") or "diario")
        if tipo not in TIPOS:
            return self._send(400, {"ok": False, "error": f"tipo inválido (aceitos: {', '.join(TIPOS)})"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        agora = agora_brt()
        periodo = _periodo_devido(tipo, agora) or f"{tipo}:manual:{agora.strftime('%Y-%m-%d %H:%M')}"
        item, err = _gerar(sb, tipo, periodo, actor_name=actor.get("name") or actor.get("email"))
        if not item:
            return self._send(502, {"ok": False, "error": err or "falha na geração"})
        audit(self, actor, "gestor_trafego.relatorio_manual", target_type="gt_relatorio",
              target_id=item["id"], notes=tipo)
        return self._send(200, {"ok": True, "relatorio": item})
