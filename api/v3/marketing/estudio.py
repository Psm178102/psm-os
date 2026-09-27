"""
📸 Estúdio Instagram — as 13 skills /ig-* da PSM Conquista rodando dentro do House (v88.61)

Pedido do Paulo (27/set): "implemente todas as skills e agentes novos dentro do
marketing do House, onde controlamos a esteira". Até aqui a Esteira existia como
14 chats soltos + a fila de validação do /cmo alimentada de fora. O Estúdio fecha
o circuito DENTRO do app:

    pedido → skill (cânone voice.md + protocolo da skill) → anti-robô (bloqueante)
          → Auditor (nota 0-10, corte 8) → [≥8] fila do Paulo em cmo_pecas
          → Paulo aprova/ajusta/reprova no /cmo → [ajustar] volta pro Estúdio refazer

Nada aqui publica, agenda, responde ou dispara. Publicação continua do Agendador,
depois da validação do sócio (lei 5).

GET  /api/v3/marketing/estudio                → catálogo de skills + histórico (lvl 5+)
POST /api/v3/marketing/estudio {acao:"gerar", skill, pedido, base_id?, ajuste?}
POST /api/v3/marketing/estudio {acao:"enviar", id}   → cmo_pecas (só nota ≥ 8)
POST /api/v3/marketing/estudio {acao:"checar", texto} → só o anti-robô (sem IA)

Conteúdo das skills: módulo GERADO _ig_skills_data.py (scripts/sync_ig_skills.py).
Histórico: shared_kv 'mkt_estudio' {itens:[...]} (últimos 40).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import urllib.request
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, audit, supabase_client,  # type: ignore
                       lvl_of, notify, send_web_push)
import _ig_skills_data as IG  # type: ignore
from _ig_checks import checar  # type: ignore

KV_HIST = "mkt_estudio"
KV_PECAS = "cmo_pecas"
KV_NOTAS = "cmo_notas"
MAX_HIST = 40
CORTE = 8.0
MIN_LVL = 5   # espelha ROUTE_MIN_LVL['/estudio-ig'] e o MKT_SQUAD do chat

# Catálogo da tela: ícone, nome curto, estação da Esteira e dica do campo de pedido.
UI = {
    "ig-reel":      ("🎬", "Roteiro de Reels", "copywriter", "Ideia bruta do vídeo. Ex.: FGTS como entrada, pra casal que paga R$ 1.200 de aluguel na Zona Norte"),
    "ig-caption":   ("📝", "Legenda", "copywriter", "Do que é o post/reel + o gancho ou roteiro, se já tiver"),
    "ig-carousel":  ("🗂️", "Carrossel", "copywriter → design", "Tema em formato de lista ou passo a passo. Ex.: os 6 documentos do MCMV"),
    "ig-story":     ("📱", "Stories do dia", "social media", "O que está acontecendo hoje (bastidor, obra, dúvida da semana, lançamento)"),
    "ig-plan":      ("🗓️", "Plano da semana", "social media", "Semana (datas) + pauta aprovada do curador, se já tiver + eventos"),
    "ig-repurpose": ("♻️", "Reaproveitar conteúdo", "copywriter → editor", "Cole a transcrição/roteiro do vídeo longo (ex.: MCMV NA PRÁTICA)"),
    "ig-viral":     ("🔥", "Radar de virais", "curador", "Cole os reels/perfis que achou (link, views, mediana do perfil, gancho) ou o nicho a investigar"),
    "ig-audit":     ("📊", "Post-mortem", "tráfego orgânico", "Cole os insights da semana (post, alcance, views, salvamentos, compart., horário)"),
    "ig-profile":   ("🪪", "Nota do perfil", "social media / SEO", "Cole nome, bio, link, destaques, fixados e as 9 primeiras capas do @psmconquista"),
    "ig-comment":   ("💬", "Comentar em perfis locais", "community", "Cole o post de outro perfil de Rio Preto (texto/legenda + de quem é)"),
    "ig-reply":     ("↩️", "Responder comentários", "community", "Cole os comentários do nosso post/reel (um por linha, com @)"),
    "ig-dm":        ("✉️", "Direct (DM)", "community", "Quem é, como chegou (keyword/comentário/anúncio) e o que já foi dito"),
    "ig-human":     ("🧽", "Tirar cara de IA", "todas", "Cole o texto pra limpar vícios de IA e checar as regras da marca"),
}
# skills que geram PEÇA de conteúdo (vão pra fila do Paulo); as outras são insumo/rascunho
PECA = {"ig-reel", "ig-caption", "ig-carousel", "ig-story", "ig-repurpose", "ig-profile"}

MODO_HOUSE = (
    "MODO HOUSE PSM: você está rodando DENTRO do House (app web da PSM), não no Claude Code. "
    "Não existe terminal nem sistema de arquivos: NÃO rode scripts (hookscore.py, beats.py, caption.py, "
    "swipe.py, humanize.py, detect.py), NÃO leia nem escreva voice.md/swipe.md/log.md e NÃO peça "
    "\"responda yes pra logar\". O CÂNONE abaixo JÁ É o voice.md — siga à risca. Onde a skill mandar "
    "pontuar ganchos com script, pontue você mesmo (0-100) com o critério da skill. O House roda o "
    "anti-robô e o Auditor DEPOIS de você, então entregue a peça FINAL e COMPLETA no formato de "
    "entrega da skill, em português do Brasil, sem preâmbulo e sem 'posso ajudar em algo mais'. "
    "Nunca publique, nunca diga que enviou/postou. Dado que falta: marque [CONFIRMAR] — nunca invente. "
    "Nunca cite na entrega as frases proibidas nem liste os vícios que evitou: se a skill pedir um bloco "
    "AUDITORIA, escreva só 'AUDITORIA: OK' ou os itens que reescreveu, sem repetir a frase proibida."
)

AUDITOR = (
    "Você é o AUDITOR DE MARKETING da PSM (estação 4 da Esteira Conquista). Postura ADVERSARIAL: procure "
    "motivos pra reprovar; elogio gratuito é falha sua; você nunca reescreve a peça. Dê nota pela rubrica "
    "oficial, item a item:\n"
    "- gancho (0-3): segura os 2 primeiros segundos/linhas? funciona sem som?\n"
    "- clareza_cta (0-2): a avó entende? o CTA diz exatamente o que fazer (1 só, com keyword/simulação)?\n"
    "- marca (0-2): tom Sol, REGRA-MÃE (a Sol explica, nunca viveu), anti-público, proibidos do cânone.\n"
    "- evidencia (0-2): nasceu de viral/dado/dúvida real informado no pedido, ou de achismo?\n"
    "- originalidade (0-1): zero vício de IA; 'Não é X. É Y.' em qualquer variação = reprova direto.\n"
    "Considere o RELATÓRIO DO ANTI-ROBÔ anexado: qualquer item BLOQUEIA presente = nota total máxima 6.\n"
    "Para entregas que não são peça (plano, post-mortem, radar, triagem, DM), adapte: 'gancho' vira "
    "'utilidade imediata', 'evidencia' continua exigindo dado de verdade.\n"
    "Responda SOMENTE um JSON, sem texto fora dele:\n"
    '{"nota": <0-10 com 1 casa>, "itens": {"gancho": n, "clareza_cta": n, "marca": n, "evidencia": n, '
    '"originalidade": n}, "motivos": ["motivo curto e acionável", ...], "titulo": "título curto da peça", '
    '"gancho_texto": "o gancho/1ª linha da peça", "cta": "o CTA da peça", "serie": "série oficial ou vazio", '
    '"canal": "IG Reels|IG Feed|IG Carrossel|IG Stories|DM|...", "pendencias": "[CONFIRMAR] em aberto ou vazio"}'
)


def _now():
    return datetime.now(timezone.utc).isoformat()


# ─── IA (Claude primeiro — escrita; Gemini de reserva) ──────────────────
def _ia(system, user, max_tokens=3000, temperature=0.6):
    ant = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    gem = (os.environ.get("GEMINI_API_KEY") or "").strip()

    def claude():
        payload = {"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
                   "max_tokens": max_tokens, "temperature": temperature, "system": system,
                   "messages": [{"role": "user", "content": user}]}
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(payload).encode(),
                                     headers={"x-api-key": ant, "anthropic-version": "2023-06-01",
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=100) as resp:
            data = json.loads(resp.read().decode())
        return "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text"), "claude"

    def gemini():
        model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {"systemInstruction": {"parts": [{"text": system}]},
                   "contents": [{"role": "user", "parts": [{"text": user}]}],
                   "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature}}
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json", "x-goog-api-key": gem})
        with urllib.request.urlopen(req, timeout=100) as resp:
            data = json.loads(resp.read().decode())
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts), "gemini/" + model

    chain = ([claude] if ant else []) + ([gemini] if gem else [])
    last = "nenhum provider de IA configurado"
    for fn in chain:
        try:
            txt, prov = fn()
            if txt and txt.strip():
                return txt.strip(), prov, None
        except Exception as e:
            last = str(e)[:300]
    return None, None, last


def _system_skill(sid):
    sk = IG.SKILLS[sid]
    extra = ""
    if sid == "ig-reel":
        extra = "\n\n=== FÓRMULAS DE GANCHO (hooks.json) ===\n" + json.dumps(IG.HOOKS, ensure_ascii=False)[:40000]
    elif sid == "ig-profile":
        extra = "\n\n=== RUBRICA (rubric.json) ===\n" + json.dumps(IG.RUBRIC, ensure_ascii=False)[:20000]
    return (MODO_HOUSE + "\n\n=== CÂNONE PSM CONQUISTA (voice.md) ===\n" + IG.CANON +
            f"\n\n=== SKILL {sid} ===\n" + sk["body"] + extra)


def _auditar(sid, pedido, saida, rel):
    user = (f"SKILL: {sid}\n\nPEDIDO ORIGINAL:\n{pedido}\n\nENTREGA A AVALIAR:\n{saida}\n\n"
            f"RELATÓRIO DO ANTI-ROBÔ:\n{json.dumps(rel, ensure_ascii=False)[:6000]}")
    sysmsg = AUDITOR + "\n\n=== CÂNONE (referência) ===\n" + IG.CANON
    txt, prov, err = _ia(sysmsg, user, max_tokens=900, temperature=0.2)
    if not txt:
        return {"nota": None, "erro": err}
    m = re.search(r"\{.*\}", txt, re.S)
    try:
        a = json.loads(m.group(0)) if m else {}
    except Exception:
        a = {}
    try:
        nota = float(a.get("nota"))
    except Exception:
        nota = None
    if nota is not None and rel.get("bloqueios"):
        nota = min(nota, 6.0)   # anti-robô bloqueante manda: não passa do corte com vício de marca
    a["nota"] = nota
    a["provider"] = prov
    return a


# ─── shared_kv helpers ──────────────────────────────────────────────────
def _kv_get(sb, key):
    rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
    v = rows[0]["value"] if rows else {}
    if isinstance(v, str):
        try:
            v = json.loads(v or "{}")
        except Exception:
            v = {}
    return v if isinstance(v, dict) else {}


def _kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value, "updated_at": _now()}).execute()


def _itens(sb, key):
    return [i for i in (_kv_get(sb, key).get("itens") or []) if isinstance(i, dict)]


def _quem(actor):
    return actor.get("nome") or actor.get("login") or "time"


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

    def do_GET(self):
        try:
            require_user(self, min_lvl=MIN_LVL)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            hist = _itens(sb, KV_HIST)
            # espelha o veredito do Paulo (cmo_pecas) no histórico do Estúdio
            pecas = {p.get("id"): p for p in _itens(sb, KV_PECAS)}
            for h in hist:
                p = pecas.get(h.get("peca_id"))
                if p:
                    h["veredito"] = p.get("status") or "pendente"
                    h["veredito_motivo"] = p.get("motivo") or ""
            skills = [{"id": sid, "ico": UI[sid][0], "nome": UI[sid][1], "estacao": UI[sid][2],
                       "dica": UI[sid][3], "peca": sid in PECA,
                       "descricao": IG.SKILLS[sid]["description"]} for sid in UI]
            return self._send(200, {"ok": True, "skills": skills, "historico": hist, "corte": CORTE})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=MIN_LVL)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0)
            body = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        acao = str(body.get("acao") or "").strip()
        try:
            if acao == "checar":
                texto = str(body.get("texto") or "")[:20000]
                return self._send(200, {"ok": True, "checagem": checar(texto)})
            if acao == "gerar":
                return self._gerar(actor, body)
            if acao == "enviar":
                return self._enviar(actor, body)
            return self._send(400, {"ok": False, "error": "acao deve ser gerar|enviar|checar"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:400]})

    # ── gerar: skill → anti-robô → auditor ────────────────────────────
    def _gerar(self, actor, body):
        sid = str(body.get("skill") or "").strip()
        if sid not in UI:
            return self._send(400, {"ok": False, "error": "skill desconhecida"})
        pedido = str(body.get("pedido") or "").strip()
        if not pedido or len(pedido) > 15000:
            return self._send(400, {"ok": False, "error": "pedido obrigatório (máx. 15 mil caracteres)"})
        sb = supabase_client()
        hist = _itens(sb, KV_HIST)
        base = next((h for h in hist if h.get("id") == body.get("base_id")), None) if body.get("base_id") else None
        ajuste = str(body.get("ajuste") or "").strip()[:2000]

        user = pedido
        if base:
            motivos = "; ".join((base.get("auditoria") or {}).get("motivos") or [])
            user = (f"PEDIDO ORIGINAL:\n{base.get('pedido')}\n\nVERSÃO ANTERIOR (refazer):\n{base.get('saida')}\n\n"
                    f"MOTIVOS DO AUDITOR: {motivos or '(nenhum)'}\n"
                    f"VEREDITO/AJUSTE DO PAULO: {base.get('veredito_motivo') or '(nenhum)'}\n"
                    f"AJUSTE PEDIDO AGORA: {ajuste or '(nenhum)'}\n\n"
                    "Refaça a entrega inteira corrigindo TODOS os motivos acima.")
        saida, prov, err = _ia(_system_skill(sid), user)
        if not saida:
            return self._send(502, {"ok": False, "error": f"IA indisponível: {err}"})
        rel = checar(saida)
        aud = _auditar(sid, pedido if not base else base.get("pedido", pedido), saida, rel)

        item = {"id": "est_" + uuid.uuid4().hex[:10], "ts": _now(), "skill": sid,
                "pedido": (base.get("pedido") if base else pedido)[:15000], "saida": saida[:14000],
                "checagem": rel, "auditoria": aud, "provider": prov, "autor": _quem(actor),
                "versao": int(base.get("versao") or 1) + 1 if base else 1,
                "base_id": base.get("id") if base else None, "status": "rascunho"}
        hist.insert(0, item)
        _kv_set(sb, KV_HIST, {"itens": hist[:MAX_HIST]})
        # toda nota do auditor entra no Placar (cmo_notas) — antes só vinha de fora do app
        if aud.get("nota") is not None:
            try:
                notas = _itens(sb, KV_NOTAS)
                notas.insert(0, {"ts": item["ts"], "agente": f"estudio:{sid}", "entregavel": aud.get("titulo") or sid,
                                 "nota": aud["nota"], "motivo": "; ".join(aud.get("motivos") or [])[:500]})
                _kv_set(sb, KV_NOTAS, {"itens": notas[:300]})
            except Exception:
                pass
        audit(self, actor, "estudio.gerar", target_type="mkt_estudio", target_id=item["id"],
              notes=f"{sid} nota={aud.get('nota')}")
        return self._send(200, {"ok": True, "item": item})

    # ── enviar: rascunho ≥ corte → fila do Paulo (cmo_pecas) ────────────
    def _enviar(self, actor, body):
        sb = supabase_client()
        hist = _itens(sb, KV_HIST)
        it = next((h for h in hist if h.get("id") == body.get("id")), None)
        if not it:
            return self._send(404, {"ok": False, "error": "rascunho não encontrado"})
        if it.get("peca_id"):
            return self._send(409, {"ok": False, "error": "já está na fila do Paulo"})
        aud = it.get("auditoria") or {}
        nota = aud.get("nota")
        if nota is None or float(nota) < CORTE:
            return self._send(422, {"ok": False, "error": f"nota {nota} abaixo do corte {CORTE:g}: refaça antes (lei do Paulo)"})
        if (it.get("checagem") or {}).get("bloqueios"):
            return self._send(422, {"ok": False, "error": "o anti-robô ainda aponta bloqueio de marca: refaça"})
        pecas = _itens(sb, KV_PECAS)
        peca = {"id": "pc_" + uuid.uuid4().hex[:10], "ts": _now(), "status": "pendente",
                "titulo": (aud.get("titulo") or UI[it["skill"]][1])[:140], "nota": nota,
                "serie": aud.get("serie") or "", "canal": aud.get("canal") or "",
                "gancho": (aud.get("gancho_texto") or "")[:300], "cta": (aud.get("cta") or "")[:200],
                "resumo": f"Estúdio · {UI[it['skill']][1]} · v{it.get('versao', 1)} · por {it.get('autor')}",
                "pendencia": (aud.get("pendencias") or "")[:300], "texto": it.get("saida"),
                "origem": "estudio", "estudio_id": it["id"]}
        pecas.insert(0, peca)
        _kv_set(sb, KV_PECAS, {"itens": pecas[:200]})
        it["peca_id"] = peca["id"]
        it["status"] = "enviada"
        _kv_set(sb, KV_HIST, {"itens": hist[:MAX_HIST]})
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us if (u.get("status") or "ativo") == "ativo"
                      and lvl_of((u.get("role") or "").lower()) >= 10]
            titulo = f"✅ Peça pra validar · nota {nota:g}"
            notify(socios, "cmo_peca", titulo, body=peca["titulo"], link="#/cmo?tab=validar",
                   target_type="cmo_peca", target_id=peca["id"])
            send_web_push(socios, titulo, body=peca["titulo"], link="#/cmo?tab=validar", tag="cmo_peca")
        except Exception:
            pass
        audit(self, actor, "estudio.enviar", target_type="cmo_peca", target_id=peca["id"], notes=f"nota={nota}")
        return self._send(200, {"ok": True, "peca": peca})
