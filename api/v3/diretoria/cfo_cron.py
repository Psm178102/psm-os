# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/diretoria/cfo_cron — 🧠 ROTINA DIÁRIA DO SR. CFO NA NUVEM (v88.29)

Antes a rotina do CFO era uma tarefa agendada no PC Windows (kit MIGRACAO-WINDOWS,
cfo-rotina-financeira.md) — e nunca rodou: nenhum sr_cfo_* no banco até 23/09. Ela não
precisa de navegador (o HUB financeiro já chega pelo painel de Caixa), então vira cron
do Vercel no mesmo motor do ceo_cron/cmo_cron: IA server-side, CRON_SECRET, idempotente
por dia.

O que produz (decidido pelo dia, em BRT):
  - 1ª SEGUNDA DE JAN/ABR/JUL/OUT → 🔎 Auditoria trimestral   (dossiê tipo 'auditoria')
  - 1ª rodada entre os dias 1–5    → 🧾 Fechamento do mês anterior (tipo 'fechamento')
  - SEGUNDA                        → 💧 Caixa da semana          (tipo 'caixa')
  - DEMAIS DIAS                    → vigília silenciosa: só publica dossiê se achar 🔴 novo

Sempre atualiza o radar (sr_cfo_radar) quando muda, acrescenta pendências
(sr_cfo_pendencias) e decisões (sr_cfo_diario). Nunca marca pendência como resolvida —
isso é botão do sócio. Tudo restrito à Diretoria: push SÓ pra sócios (lvl>=10).

Fontes: /api/v3/diretoria/caixa (realizado + a receber + a pagar/HUB + break-even) lido
com o CRON_SECRET, viab_alerta.diagnostico (ritmo do mês por frente), plano_resgate_2026,
estado atual do radar/diário/pendências e a última leitura do CEO.

Rastro: shared_kv "sr_cfo_rotina" {items:[{data,tipo,publicou,manchete,provider,criado_em}]}
— é a evidência que a Central de Operações lê.

GET  ?cron=1           → gera a rotina do dia se ainda não saiu (Bearer CRON_SECRET ou sócio).
                         Antes das 7h BRT não faz nada (o heartbeat chama de madrugada).
GET  ?log=1            → histórico da rotina (sócio).
POST {action:"gerar"[,tipo:"caixa|fechamento|auditoria|vigilia"]} → sócio força AGORA.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import json
import os
import re
import secrets
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, audit, supabase_client,  # type: ignore
                       lvl_of, notify_all, agora_brt)
from ceo_cron import _ia, _kv_get, _kv_set, _kv_write_locked  # type: ignore
from viab_alerta import diagnostico  # type: ignore

KV_LOG = "sr_cfo_rotina"
KV_DOSSIES = "diretoria_dossies"
KV_RADAR = "sr_cfo_radar"
KV_DIARIO = "sr_cfo_diario"
KV_PEND = "sr_cfo_pendencias"
MAX_LOG = 60
MAX_DOSSIES = 40
TIPOS = ("caixa", "fechamento", "auditoria", "vigilia")
TITULOS = {"caixa": "💧 Caixa da semana", "fechamento": "🧾 Fechamento", "auditoria": "🔎 Auditoria trimestral",
           "vigilia": "🚨 Vigília financeira"}

PERSONA = (
    "Você é o Sr. CFO, o cérebro financeiro da holding PSM do Paulo Morimatsu (São José do Rio Preto/SP). "
    "Você NÃO movimenta dinheiro, NÃO paga, NÃO contrata crédito e NÃO fala com o time: analisa, recomenda "
    "e publica para os sócios (Paulo e Isabella). Regras: (1) só use os DADOS abaixo; todo número leva a "
    "fonte entre parênteses; fonte ausente = escreva 'sem instrumentação' e nunca estime em silêncio; "
    "(2) número ruim ABRE o texto, sem maquiagem; (3) divergência em dado editável pelo Paulo NÃO é bug: "
    "vira pendência com pergunta; (4) português BR, tom executivo direto, zero vícios de IA "
    "(proibido 'Não é X. É Y.'). "
    "CONSTANTES DA CASA: margem Conquista 1,85% do VGV · VGV próprio 3,6% · comissões a 4% (5% é bônus) · "
    "break-even ~R$70k de contribuição/mês (pleno ~R$100k) · regra do positivo (nenhum mês negativo) · "
    "FGI 1,99%/mês = inimigo · Pronampe pós-fixado barato = nunca quitar cedo · reserva de guerra ~R$123k "
    "com gatilho em DEZ/2026 · carência Pronampe acaba fev/2027 (serviço sobe pra ~R$11k/mês) · "
    "compromissos fixos: folha, aluguel dia 10, dívida ~R$9k/mês, mídia."
)

INSTRUCOES = {
    "caixa": (
        "DOSSIÊ 💧 CAIXA DA SEMANA (segunda). Fluxo 13 semanas resumido: entradas confirmadas × prováveis × "
        "compromissos; saldo mínimo projetado da janela; recebíveis travados (>D+3) com quem cobra; ritmo do "
        "mês (VGV por frente × meta, contribuição projetada × conta cheia, próprio necessário)."
    ),
    "fechamento": (
        "DOSSIÊ 🧾 FECHAMENTO DO MÊS ANTERIOR. Resultado (contribuição − conta cheia, positivo/negativo), por "
        "frente vs break-even, margem real vs 1,85%/3,6%, serviço de dívida, desvios orçado×realizado (1 linha "
        "cada) e spot-check de auditoria: outliers de % de comissão, categoria, duplicata — achados 🔴🟡🔵 com "
        "delta em R$."
    ),
    "auditoria": (
        "DOSSIÊ 🔎 AUDITORIA TRIMESTRAL. Pente-fino: entradas/splits, saídas/duplicatas/zumbis, alíquota "
        "efetiva vs premissa 9,5% (o cheque mais importante), taxas, percentuais, conciliação HUB×CRM, "
        "categorização. Achados classificados + top-3 causas-raiz + 'a auditoria achou R$X'."
    ),
    "vigilia": (
        "VIGÍLIA SILENCIOSA. Procure só sinais 🔴: conta a vencer em ≤3 dias sem saldo aparente, recebível "
        "estourando D+15, gasto anômalo (>10% sem explicação), mês abaixo de 50% da meta depois do dia 15. "
        "Achou 🔴 NOVO (que não está no radar atual) → publicar=true com dossiê curto. Senão publicar=false "
        "e corpo_md vazio: dia sem novidade não gera ruído."
    ),
}

FORMATO = (
    "\n\nRESPONDA APENAS COM UM JSON VÁLIDO (sem ``` e sem texto fora dele), neste formato:\n"
    '{"publicar": true|false, "manchete": "1 frase, o número ruim primeiro", '
    '"corpo_md": "markdown do dossiê (máx ~1 página): Números (com fonte) · Riscos/desvios (dono e prazo) · '
    '2-4 Insights · máx 3 Recomendações priorizadas por R$ de impacto ÷ esforço", '
    '"radar": [{"nivel": "vermelho|amarelo|azul", "titulo": "...", "detalhe": "...", "prazo": "YYYY-MM-DD ou vazio"}], '
    '"pendencias": [{"titulo": "o que precisa do Paulo", "detalhe": "..."}], '
    '"decisoes": [{"decisao": "...", "premissa": "...", "resultado_esperado": "...", "revisao_em": "YYYY-MM-DD"}]}\n'
    "- 'radar' é o RADAR COMPLETO atualizado (mantenha o que segue valendo do radar atual, tire o que resolveu, "
    "vermelhos primeiro, máx 12).\n- 'pendencias' só as NOVAS (não repita as abertas listadas). "
    "- 'decisoes' só se você recomendar uma decisão com revisão futura (senão lista vazia)."
)


# ─── util ──────────────────────────────────────────────────────────────
def _compacto(v, prof=0):
    """Encolhe o JSON do painel pra caber no prompt: listas até 15 itens, textos até 200."""
    if prof > 6:
        return "…"
    if isinstance(v, dict):
        return {k: _compacto(x, prof + 1) for k, x in v.items() if not str(k).startswith("_")}
    if isinstance(v, list):
        out = [_compacto(x, prof + 1) for x in v[:15]]
        if len(v) > 15:
            out.append(f"(+{len(v) - 15} itens)")
        return out
    if isinstance(v, str) and len(v) > 200:
        return v[:200] + "…"
    return v


def _dump(v, limite):
    s = json.dumps(_compacto(v), ensure_ascii=False, default=str)
    return s if len(s) <= limite else s[:limite] + "…(cortado)"


def _painel_caixa(host, ym):
    secret = os.environ.get("CRON_SECRET", "").strip()
    if not secret:
        return None, "CRON_SECRET ausente"
    url = f"https://{host}/api/v3/diretoria/caixa?ym={ym}"
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}",
                                                   "User-Agent": "PSM-cfo-cron"})
        with urllib.request.urlopen(req, timeout=50) as r:
            return json.loads(r.read().decode("utf-8") or "{}"), None
    except Exception as e:
        return None, str(e)[:160]


def _ym(d):
    return f"{d.year:04d}-{d.month:02d}"


def _tipo_do_dia(sb, agora):
    d = agora.date()
    seg = agora.weekday() == 0
    ym = _ym(d)
    dossies = (_kv_get(sb, KV_DOSSIES, {}) or {}).get("items") or []

    def ja_saiu(tipo):
        return any(isinstance(x, dict) and (x.get("autor") or "").upper() == "CFO" and x.get("tipo") == tipo
                   and str(x.get("criado_em") or "")[:7] == ym for x in dossies)
    # fechamento primeiro; a auditoria trimestral cai na 1ª segunda livre até o dia 14
    if d.day <= 5 and not ja_saiu("fechamento"):
        return "fechamento"
    if seg and d.month in (1, 4, 7, 10) and d.day <= 14 and not ja_saiu("auditoria"):
        return "auditoria"
    return "caixa" if seg else "vigilia"


def _contexto(sb, tipo, agora, host):
    partes, fontes_fora = [], []
    d = agora.date()
    ym_alvo = _ym(d.replace(day=1) - timedelta(days=1)) if tipo == "fechamento" else _ym(d)
    painel, err = _painel_caixa(host, ym_alvo)
    if painel and painel.get("ok") is not False:
        partes.append(f"PAINEL DE CAIXA {ym_alvo} (fonte: diretoria/caixa — realizado CRM+custos, "
                      f"recebíveis, a pagar do HUB, break-even):\n" + _dump(painel, 14000))
    else:
        fontes_fora.append(f"painel de caixa ({err or (painel or {}).get('error')})")
    try:
        partes.append("RITMO DO MÊS POR FRENTE (fonte: viab_alerta/Métricas de Viabilidade):\n"
                      + _dump(diagnostico(sb), 3000))
    except Exception as e:
        fontes_fora.append(f"ritmo do mês ({str(e)[:80]})")
    plano = _kv_get(sb, "plano_resgate_2026", {})
    if plano:
        partes.append("PLANO DE RESGATE 2026 (fonte: plano_resgate_2026):\n" + _dump(plano, 3000))
    radar = _kv_get(sb, KV_RADAR, {})
    partes.append("RADAR ATUAL (sr_cfo_radar):\n" + _dump(radar.get("itens") or [], 2500))
    pend = [p for p in ((_kv_get(sb, KV_PEND, {}) or {}).get("items") or []) if not p.get("resolvida")]
    partes.append("PENDÊNCIAS ABERTAS COM O PAULO:\n" + _dump([p.get("titulo") for p in pend], 1500))
    hoje_iso = d.isoformat()
    diario = (_kv_get(sb, KV_DIARIO, {}) or {}).get("items") or []
    vencidas = [x for x in diario if not x.get("veredito") and str(x.get("revisao_em") or "9999") <= hoje_iso]
    if vencidas:
        partes.append("DECISÕES COM REVISÃO VENCIDA (classifique no dossiê se deu certo):\n" + _dump(vencidas, 2000))
    ceo = (_kv_get(sb, "ceo_diario", {}) or {}).get("items") or []
    if ceo:
        partes.append("ÚLTIMA LEITURA DO CEO: " + str(ceo[0].get("primeira_linha") or "")[:300])
    if fontes_fora:
        partes.append("FONTES FORA DO AR HOJE (diga isso no dossiê): " + "; ".join(fontes_fora))
    return "\n\n".join(partes), fontes_fora


def _parse_json(texto):
    t = (texto or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        v = json.loads(t[i:j + 1])
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def _hex():
    return secrets.token_hex(5)


def _socios(sb):
    try:
        users = sb.table("users").select("id,role,status").execute().data or []
        return [u["id"] for u in users if u.get("id") and (u.get("status") or "ativo") == "ativo"
                and lvl_of(u.get("role")) >= 10]
    except Exception:
        return []


# ─── geração ───────────────────────────────────────────────────────────
def _gerar(sb, tipo, agora, host, actor_name="cfo-cron"):
    ctx, fontes_fora = _contexto(sb, tipo, agora, host)
    data = agora.date().isoformat()
    dia = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][agora.weekday()]
    prompt = (PERSONA + f"\n\nHOJE: {agora.strftime('%d/%m/%Y %H:%M')} ({dia})\n\n" + INSTRUCOES[tipo]
              + FORMATO + "\n\n═══ DADOS REAIS ═══\n\n" + ctx)
    texto, provider, err = _ia(prompt, max_tokens=900 if tipo == "vigilia" else 2600)
    if not texto:
        return None, err
    out = _parse_json(texto)
    if out is None:  # IA fugiu do formato: publica o texto cru como dossiê (nos dias que exigem)
        out = {"publicar": tipo != "vigilia", "manchete": texto.strip().split("\n")[0][:200],
               "corpo_md": texto, "radar": None, "pendencias": [], "decisoes": []}
    agora_iso = datetime.now(timezone.utc).isoformat()
    publicar = bool(out.get("publicar")) or tipo != "vigilia"
    manchete = str(out.get("manchete") or "").strip()[:240]

    # radar: substitui só quando a IA devolveu uma lista (None = não mexe)
    novos_vermelhos = []
    radar_novo = out.get("radar")
    if isinstance(radar_novo, list):
        antes = {str(x.get("titulo") or "").strip().lower() for x in (_kv_get(sb, KV_RADAR, {}).get("itens") or [])
                 if x.get("nivel") == "vermelho"}
        ordem = {"vermelho": 0, "amarelo": 1, "azul": 2}
        itens = [{"nivel": x.get("nivel") if x.get("nivel") in ordem else "azul",
                  "titulo": str(x.get("titulo") or "")[:160], "detalhe": str(x.get("detalhe") or "")[:500],
                  "prazo": str(x.get("prazo") or "")[:10]}
                 for x in radar_novo if isinstance(x, dict) and x.get("titulo")][:12]
        itens.sort(key=lambda x: ordem[x["nivel"]])
        novos_vermelhos = [x["titulo"] for x in itens
                           if x["nivel"] == "vermelho" and x["titulo"].strip().lower() not in antes]
        _kv_set(sb, KV_RADAR, {"itens": itens, "atualizado_em": agora_iso, "por": "Sr. CFO (rotina)"})

    pend_novas = [p for p in (out.get("pendencias") or []) if isinstance(p, dict) and p.get("titulo")]
    if pend_novas:
        def mut_pend(box):
            items = [i for i in (box.get("items") or []) if isinstance(i, dict)]
            abertas = {str(i.get("titulo") or "").strip().lower() for i in items if not i.get("resolvida")}
            for p in pend_novas[:5]:
                if str(p["titulo"]).strip().lower() in abertas:
                    continue
                items.insert(0, {"id": _hex(), "titulo": str(p["titulo"])[:200],
                                 "detalhe": str(p.get("detalhe") or "")[:600], "criado_em": agora_iso,
                                 "resolvida": False})
            box["items"] = items[:200]
            return box
        _kv_write_locked(sb, KV_PEND, mut_pend)

    decisoes = [x for x in (out.get("decisoes") or []) if isinstance(x, dict) and x.get("decisao")]
    if decisoes:
        def mut_dia(box):
            items = [i for i in (box.get("items") or []) if isinstance(i, dict)]
            for x in decisoes[:3]:
                items.insert(0, {"id": _hex(), "decisao": str(x["decisao"])[:300],
                                 "premissa": str(x.get("premissa") or "")[:300],
                                 "resultado_esperado": str(x.get("resultado_esperado") or "")[:300],
                                 "revisao_em": str(x.get("revisao_em") or "")[:10], "criado_em": agora_iso,
                                 "veredito": None, "delta_reais": None, "licao": None})
            box["items"] = items[:200]
            return box
        _kv_write_locked(sb, KV_DIARIO, mut_dia)

    corpo = str(out.get("corpo_md") or "").strip()
    publicou = bool(publicar and corpo)
    if publicou:
        dtipo = "relatorio" if tipo == "vigilia" else tipo
        did = f"cfo_{data}_{dtipo}"
        titulo = TITULOS[tipo]
        if tipo == "fechamento":
            m = agora.date().replace(day=1) - timedelta(days=1)
            titulo += f" de {m.month:02d}/{m.year}"
        elif tipo == "caixa":
            titulo += f" — {agora.strftime('%d/%m')}"
        dossie = {"id": did, "tipo": dtipo, "titulo": titulo, "manchete": manchete, "corpo_md": corpo,
                  "autor": "CFO", "criado_em": agora_iso,
                  "fontes": ["diretoria/caixa", "viab_alerta", "plano_resgate_2026", "sr_cfo_*"]}

        def mut_dos(box):
            items = [i for i in (box.get("items") or []) if isinstance(i, dict) and i.get("id") != did]
            items.insert(0, dossie)
            box["items"] = items[:MAX_DOSSIES]
            return box
        _kv_write_locked(sb, KV_DOSSIES, mut_dos)

    if publicou or novos_vermelhos:
        alvo = _socios(sb)
        if alvo:
            corpo_push = manchete or "; ".join(novos_vermelhos)
            try:
                notify_all(alvo, "fiscalizacao", f"🧠 Sr. CFO — {TITULOS[tipo]}", body=corpo_push[:400],
                           link="#/sr-cfo")
            except Exception:
                pass

    item = {"data": data, "tipo": tipo, "publicou": publicou, "manchete": manchete,
            "vermelhos_novos": novos_vermelhos, "pendencias_novas": len(pend_novas),
            "fontes_fora": fontes_fora, "provider": provider, "criado_em": agora_iso, "gerado_por": actor_name}

    def mut_log(box):
        items = [i for i in (box.get("items") or []) if isinstance(i, dict) and i.get("data") != data]
        items.insert(0, item)
        box["items"] = items[:MAX_LOG]
        return box
    _kv_write_locked(sb, KV_LOG, mut_log)
    return item, None


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def _cron_ok(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        return bool(secret) and tok == secret

    def _host(self):
        return (self.headers.get("Host") or "www.housepsm.com.br").split(",")[0].strip()

    def do_GET(self):
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        if not self._cron_ok():
            try:
                require_user(self, min_lvl=10)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        if params.get("log"):
            return self._send(200, {"ok": True, "items": (_kv_get(sb, KV_LOG, {}) or {}).get("items") or []})
        if not params.get("cron"):
            return self._send(400, {"ok": False, "error": "use ?cron=1 ou ?log=1"})
        agora = agora_brt()
        if agora.hour < 7:
            return self._send(200, {"ok": True, "pulado": "antes das 7h BRT"})
        data = agora.date().isoformat()
        if any(isinstance(i, dict) and i.get("data") == data for i in (_kv_get(sb, KV_LOG, {}).get("items") or [])):
            return self._send(200, {"ok": True, "pulado": f"{data} já rodou"})
        tipo = _tipo_do_dia(sb, agora)
        item, err = _gerar(sb, tipo, agora, self._host())
        if not item:
            print(f"[cfo_cron] {tipo} {data}: {str(err)[:300]}")
            return self._send(502, {"ok": False, "error": err})
        return self._send(200, {"ok": True, "gerado": {k: item[k] for k in ("data", "tipo", "publicou", "manchete")}})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if (body.get("action") or "gerar") != "gerar":
            return self._send(400, {"ok": False, "error": "action deve ser 'gerar'"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        agora = agora_brt()
        tipo = (body.get("tipo") or "").strip().lower() or _tipo_do_dia(sb, agora)
        if tipo not in TIPOS:
            return self._send(400, {"ok": False, "error": "tipo inválido: caixa|fechamento|auditoria|vigilia"})
        item, err = _gerar(sb, tipo, agora, self._host(), actor_name=user.get("login") or user.get("name") or "manual")
        if not item:
            return self._send(502, {"ok": False, "error": err})
        audit(self, user, "cfo.rotina_manual", target_type="sr_cfo_rotina", target_id=item["data"])
        return self._send(200, {"ok": True, "item": item})
