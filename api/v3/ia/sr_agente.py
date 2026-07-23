# -*- coding: utf-8 -*-
"""
/api/v3/ia/sr_agente — 🤖 Sr. Gerência INDIVIDUAL (v84.89).

Um "gerente pessoal" por colaborador: analisa o funil real da pessoa
(deals RD + House, produção da fiscalização, leads da LP) e devolve
cobrança respeitosa + 3 ações da semana + estratégia + risco, por IA
(motor Gemini — decisão do Paulo jul/2026; fallback Claude se AI_PREFER).

ESCOPO: todo usuário ativo EXCETO sócios (lvl>=10) e financeiro (regra do Paulo).
CICLO: semanal por pessoa, processado em lotes de 3 pelo heartbeat (~2h)
       — serverless não aguenta a equipe inteira numa chamada.
GET             → o dossiê do PRÓPRIO usuário logado
GET ?cron=1     → processa até 3 usuários vencidos (Bearer CRON_SECRET ou lvl>=7)
POST {action:"gerar"}         → regenera o próprio (máx 1×/20h)
POST {action:"gerar", uid}    → lvl>=7 regenera de qualquer um
Estado em shared_kv: sr_agente_state (uid→last_run) · sr_agente_dossies (uid→dossiê)
Notificação por alçada: SÓ a própria pessoa recebe (nunca broadcast).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, send_web_push, lvl_of  # type: ignore

KV_STATE = "sr_agente_state"
KV_DOSSIES = "sr_agente_dossies"
CICLO_DIAS = 7
LOTE = 3

PAPEL_CTX = {
    "corretor_conquista": "corretor(a) da equipe Conquista (MCMV/1º imóvel): o jogo é velocidade no lead e volume de atendimento",
    "corretor_map": "corretor(a) M.A.P (loteamentos/prontos): o jogo é constância de follow-up e visita agendada",
    "corretor_locacao": "corretor(a) de Locação: o jogo é giro rápido — imóvel parado é dinheiro perdido",
    "corretor_terceiros": "corretor(a) de Terceiros (usados): o jogo é proposta na mesa e leitura do vendedor",
    "gerente": "gerente geral de vendas: o jogo é o funil do TIME, não o individual",
    "gerente_conquista": "gerente da Conquista: o jogo é SLA de 1ª resposta do time e conversão por faixa",
    "gerente_map": "gerente M.A.P: o jogo é resgatar deals parados e cobrar cadência",
    "gerente_locacao": "gerente de Locação: o jogo é carteira crescendo e vacância caindo",
    "gerente_terceiros": "gerente de Terceiros: o jogo é estoque girando e propostas formalizadas",
    "secretaria_vendas": "secretaria de vendas (SDR/reativação): o jogo é fila do dia zerada e agendamento",
    "backoffice": "backoffice: o jogo é destravar burocracia que segura comissão",
    "marketing": "marketing: o jogo é custo por lead qualificado caindo",
    "consultor_arch_leg": "consultor(a) Arch Leg: o jogo é avaliação em dia por pessoa",
}


def _kv(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        return (v if isinstance(v, dict) else {}), True
    except Exception:
        return {}, False


def _kv_set(sb, key, value):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": value,
                                      "updated_at": datetime.now(timezone.utc).isoformat()},
                                     on_conflict="key").execute()
        return True
    except Exception:
        return False


def _gemini(prompt):
    """Motor primário Gemini; Claude só se AI_PREFER=claude (padrão da casa)."""
    if os.environ.get("AI_PREFER", "").strip().lower() == "claude" and os.environ.get("ANTHROPIC_API_KEY", "").strip():
        try:
            req = urllib.request.Request("https://api.anthropic.com/v1/messages",
                data=json.dumps({"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
                                 "max_tokens": 700, "messages": [{"role": "user", "content": prompt}]}).encode(),
                headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01",
                         "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read().decode())
            txt = "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text")
            if txt.strip():
                return txt.strip(), "claude"
        except Exception:
            pass
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return None, None
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    try:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                             "generationConfig": {"maxOutputTokens": 700, "temperature": 0.6,
                                                  "thinkingConfig": {"thinkingBudget": 0}}}).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": key})
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.loads(r.read().decode())
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        txt = "".join(p.get("text", "") for p in parts)
        return (txt.strip() or None), ("gemini" if txt.strip() else None)
    except Exception:
        return None, None


def _dados_pessoa(sb, u, now):
    """Foto compacta e REAL da semana da pessoa (RD + House). Tolerante a falha."""
    uid = str(u.get("id"))
    colab = (u.get("email") or "").split("@")[0]
    d7 = (now - timedelta(days=7)).isoformat()
    mes_ini = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    out = {"nome": u.get("name"), "funcao": u.get("role")}
    try:
        deals = (sb.table("deals").select("id,name,amount,stage_name,win,updated_at_rd,created_at_rd,closed_at")
                 .eq("user_id", uid).order("updated_at_rd", desc=True).limit(300).execute().data or [])
        abertos = [d for d in deals if d.get("win") is None]
        parados = [d for d in abertos if str(d.get("updated_at_rd") or "") < d7]
        etapas = {}
        for d in abertos:
            etapas[d.get("stage_name") or "?"] = etapas.get(d.get("stage_name") or "?", 0) + 1
        ganhos_mes = [d for d in deals if d.get("win") is True and str(d.get("closed_at") or "") >= mes_ini]
        out["funil"] = {
            "abertos": len(abertos), "por_etapa": etapas,
            "parados_7d_sem_toque": len(parados),
            "parados_exemplos": [str(d.get("name") or "")[:40] for d in parados[:5]],
            "novos_7d": sum(1 for d in deals if str(d.get("created_at_rd") or "") >= d7),
            "ganhos_no_mes": {"qtd": len(ganhos_mes), "vgv": sum(float(d.get("amount") or 0) for d in ganhos_mes)},
        }
    except Exception:
        out["funil"] = None
    try:
        evs = (sb.table("producao_eventos").select("tipo").eq("colaborador", colab)
               .gte("ts", d7).limit(500).execute().data or [])
        tipos = {}
        for e in evs:
            tipos[e.get("tipo") or "?"] = tipos.get(e.get("tipo") or "?", 0) + 1
        out["producao_7d"] = tipos
    except Exception:
        out["producao_7d"] = None
    try:
        lps = (sb.table("leads_lp").select("ts_recebido,ts_primeira_resposta").eq("atendido_por", uid)
               .gte("ts_recebido", (now - timedelta(days=14)).isoformat()).limit(200).execute().data or [])
        resp = []
        for l in lps:
            if l.get("ts_primeira_resposta"):
                try:
                    resp.append((datetime.fromisoformat(str(l["ts_primeira_resposta"]).replace("Z", "+00:00"))
                                 - datetime.fromisoformat(str(l["ts_recebido"]).replace("Z", "+00:00"))).total_seconds() / 60)
                except Exception:
                    pass
        out["leads_lp_14d"] = {"atendidos": len(lps),
                               "tempo_medio_min": round(sum(resp) / len(resp), 1) if resp else None}
    except Exception:
        out["leads_lp_14d"] = None
    return out


def _prompt(dados):
    ctx = PAPEL_CTX.get(dados.get("funcao") or "", "colaborador(a) da operação")
    return (
        "Você é o Sr. Gerência da PSM (imobiliária, São José do Rio Preto): o GERENTE INDIVIDUAL de "
        f"{dados.get('nome')}, {ctx}. Analise os DADOS REAIS da semana abaixo e escreva a mensagem "
        "semanal dele(a), em pt-BR, máx 170 palavras, markdown com bullets, na 2ª pessoa (fale COM a "
        "pessoa). Estrutura OBRIGATÓRIA: 1) Placar da semana — 2 números que resumem (cite os números "
        "reais; valores em R$ completos); 2) 🔴 A cobrança — o ponto mais fraco dos dados, dito com "
        "respeito e sem rodeio (ex: deals parados sem toque, tempo de resposta, produção abaixo); "
        "3) ✅ 3 ações desta semana — concretas, com número-alvo cada (ex: 'toque nos 5 parados: X, Y…'); "
        "4) 🎯 Uma estratégia — 1 movimento inteligente pro perfil da função; 5) ⚠️ Risco — o que "
        "acontece se nada mudar. Tom: gerente que se importa e cobra; ZERO motivacional vazio, ZERO "
        "genérico. Se um bloco de dados vier vazio/null, não invente — cobre o registro ('produção sem "
        "eventos = ninguém registrando ou ninguém produzindo — me diga qual dos dois').\n\nDADOS:\n"
        + json.dumps(dados, ensure_ascii=False, default=str))


def _gerar(sb, u, now, dossies):
    dados = _dados_pessoa(sb, u, now)
    txt, prov = _gemini(_prompt(dados))
    if not txt:
        return None
    uid = str(u.get("id"))
    dossies[uid] = {"texto": txt[:4000], "provider": prov, "ts": now.isoformat(),
                    "nome": u.get("name"), "funcao": u.get("role")}
    trecho = txt.replace("*", "").replace("#", "").strip()[:150]
    notify(uid, "sr_agente", "🤖 Sr. Gerência: sua análise da semana chegou",
           trecho + "…", link="#/sr-gerencia", target_type="sr_agente", target_id=uid)
    try:
        send_web_push(uid, "🤖 Sr. Gerência: sua análise da semana", trecho, link="#/sr-gerencia", tag="sr_agente")
    except Exception:
        pass
    return dossies[uid]


def _elegiveis(sb):
    us = sb.table("users").select("id,name,email,role,status").execute().data or []
    out = []
    for u in us:
        if (u.get("status") or "ativo") != "ativo" or not u.get("id"):
            continue
        role = (u.get("role") or "").lower()
        if lvl_of(role) >= 10 or role == "financeiro":   # regra do Paulo: sócios e financeiro FORA
            continue
        out.append(u)
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        now = datetime.now(timezone.utc)

        if q.get("cron") == "1":
            auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
            cron = os.environ.get("CRON_SECRET", "").strip()
            if not (cron and auth_hdr == cron):
                try:
                    require_user(self, min_lvl=7)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            state, leu_st = _kv(sb, KV_STATE)
            dossies, leu_do = _kv(sb, KV_DOSSIES)
            if not (leu_st and leu_do):   # lição v84.88: leitura falhou → NÃO regravar por cima
                return self._send(200, {"ok": False, "skip": "kv indisponível — sem processar"})
            feitos = []
            for u in _elegiveis(sb):
                if len(feitos) >= LOTE:
                    break
                uid = str(u["id"])
                last = state.get(uid)
                if last and str(last) > (now - timedelta(days=CICLO_DIAS)).isoformat():
                    continue
                if _gerar(sb, u, now, dossies):
                    state[uid] = now.isoformat()
                    feitos.append(u.get("name"))
            if feitos:
                _kv_set(sb, KV_STATE, state)
                _kv_set(sb, KV_DOSSIES, dossies)
            return self._send(200, {"ok": True, "gerados": feitos})

        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        dossies, _ = _kv(sb, KV_DOSSIES)
        uid = str(user.get("id"))
        alvo = q.get("uid") if (user.get("lvl") or 0) >= 7 and q.get("uid") else uid
        d = dossies.get(alvo)
        role = (user.get("role") or "").lower()
        fora = (user.get("lvl") or 0) >= 10 or role == "financeiro"
        return self._send(200, {"ok": True, "dossie": d, "fora_do_escopo": fora and alvo == uid})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if body.get("action") != "gerar":
            return self._send(400, {"ok": False, "error": "action inválida"})
        now = datetime.now(timezone.utc)
        lvl = user.get("lvl") or 0
        alvo_id = str(body.get("uid") or user.get("id"))
        if alvo_id != str(user.get("id")) and lvl < 7:
            return self._send(403, {"ok": False, "error": "gerar de outra pessoa é da gestão (lvl>=7)"})
        us = [u for u in _elegiveis(sb) if str(u["id"]) == alvo_id]
        if not us:
            return self._send(422, {"ok": False, "error": "usuário fora do escopo do Sr. Gerência (sócio/financeiro/inativo)"})
        state, leu_st = _kv(sb, KV_STATE)
        dossies, leu_do = _kv(sb, KV_DOSSIES)
        if not (leu_st and leu_do):
            return self._send(503, {"ok": False, "error": "config indisponível — tente de novo"})
        last = state.get(alvo_id)
        if lvl < 7 and last and str(last) > (now - timedelta(hours=20)).isoformat():
            return self._send(429, {"ok": False, "error": "já gerado hoje — o ciclo automático é semanal"})
        d = _gerar(sb, us[0], now, dossies)
        if not d:
            return self._send(502, {"ok": False, "error": "IA indisponível agora (Gemini) — tente em instantes"})
        state[alvo_id] = now.isoformat()
        _kv_set(sb, KV_STATE, state)
        _kv_set(sb, KV_DOSSIES, dossies)
        audit(self, user, "sr_agente.gerar", target_type="shared_kv", target_id=KV_DOSSIES, notes=alvo_id)
        return self._send(200, {"ok": True, "dossie": d})
