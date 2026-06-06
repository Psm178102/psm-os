"""
POST /api/v3/ia/chat
Body: { agent: 'vera|sol|sr_performance|sr_gerencia', messages: [{role, content}] }
Header: Authorization: Bearer <token>

Roteador unificado pras 4 IAs PSM. Cada agent tem prompt system específico
e provider preferido (Claude/Gemini/OpenAI). Fallback automático se um falha.

Não armazena histórico (frontend gerencia). Audit log conta uso.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore


# ─── Agents config ─────────────────────────────────────────────────────
AGENTS = {
    "vera": {
        "name": "Vera",
        "ico": "💜",
        "tagline": "Especialista em vendas e estratégia comercial",
        "system": (
            "Você é Vera, assistente IA da PSM Imobiliária especializada em "
            "vendas e estratégia comercial. Responda em português, direto ao ponto, "
            "tom profissional mas próximo. Use bullets quando apropriado. "
            "Foque em soluções acionáveis pra corretores e gestão comercial."
        ),
        "primary": "claude",
    },
    "sol": {
        "name": "Sol",
        "ico": "☀️",
        "tagline": "Auxiliar de Marketing e copywriting",
        "system": (
            "Você é Sol, assistente IA de marketing imobiliário da PSM. "
            "Especialidade: copywriting persuasivo, posts pra Instagram, "
            "campanhas Meta Ads, descrições de imóveis. Tom claro, otimista, "
            "estratégico. Sempre em português."
        ),
        "primary": "claude",
    },
    "sr_performance": {
        "name": "Sr. Performance",
        "ico": "🤖",
        "tagline": "Analytics e performance de mídia",
        "system": (
            "Você é Sr. Performance, assistente IA analítico da PSM. "
            "Especialidade: análise de KPIs, performance Meta Ads, ROAS, CPL, "
            "diagnósticos de campanha. Responda com dados, sugira hipóteses, "
            "proponha ações específicas. Português, tom técnico mas claro."
        ),
        "primary": "gemini",
    },
    "sr_gerencia": {
        "name": "Sr. Gerência",
        "ico": "👔",
        "tagline": "Liderança e gestão de equipe",
        "system": (
            "Você é Sr. Gerência, assistente IA da PSM focado em liderança "
            "e gestão de equipe comercial. Ajuda gerentes/líderes em decisões "
            "de pessoal, alocação, metas, conversas difíceis. Português, "
            "tom maduro e prático."
        ),
        "primary": "claude",
    },
}


def _get_setting(sb, key):
    """Pega chave do shared_kv psm_os_settings."""
    if not sb: return None
    try:
        row = sb.table("shared_kv").select("value").eq("key", "psm_os_settings").limit(1).execute().data or []
        if not row: return None
        v = row[0].get("value") or {}
        return v.get(key) if isinstance(v, dict) else None
    except Exception:
        return None


def _call_claude(api_key, system, messages):
    """Chama Anthropic Messages API."""
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")],
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    content = data.get("content") or []
    text = "".join(c.get("text", "") for c in content if c.get("type") == "text")
    return {"text": text, "provider": "claude", "model": data.get("model"), "usage": data.get("usage")}


def _call_gemini(api_key, system, messages):
    """Chama Google Gemini generateContent. Modelo via env (GEMINI_SMART_MODEL,
    default gemini-2.5-flash) e auth via header x-goog-api-key — funciona com
    chaves AIza… E AQ.… (o método antigo ?key= rejeitava a chave nova)."""
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    # Gemini: sem system separado, prefixa na primeira user message
    contents = []
    if messages and system:
        first = messages[0]
        if first.get("role") == "user":
            messages = [{"role": "user", "content": f"[Sistema]: {system}\n\n[Usuário]: {first['content']}"}] + messages[1:]
    for m in messages:
        if m.get("role") not in ("user", "assistant"): continue
        contents.append({
            "role": "model" if m["role"] == "assistant" else "user",
            "parts": [{"text": m["content"]}],
        })
    payload = {"contents": contents, "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.7}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    cands = data.get("candidates") or []
    if not cands: return {"text": "", "provider": "gemini", "error": "no candidates"}
    parts = cands[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
    return {"text": text, "provider": "gemini", "model": model}


def _call_openai(api_key, system, messages):
    """Fallback OpenAI."""
    url = "https://api.openai.com/v1/chat/completions"
    msgs = [{"role": "system", "content": system}]
    for m in messages:
        if m.get("role") in ("user", "assistant"):
            msgs.append({"role": m["role"], "content": m["content"]})
    payload = {"model": "gpt-4o-mini", "messages": msgs, "max_tokens": 1024}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
        "Authorization": "Bearer " + api_key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    choices = data.get("choices") or []
    text = choices[0]["message"]["content"] if choices else ""
    return {"text": text, "provider": "openai", "model": payload["model"], "usage": data.get("usage")}


def _try_chain(providers, system, messages, keys):
    """Tenta providers em ordem; retorna primeiro sucesso ou último erro."""
    last_err = None
    for prov in providers:
        try:
            if prov == "claude" and keys.get("anthropic_api_key"):
                return _call_claude(keys["anthropic_api_key"], system, messages)
            if prov == "gemini" and keys.get("gemini_api_key"):
                return _call_gemini(keys["gemini_api_key"], system, messages)
            if prov == "openai" and keys.get("openai_api_key"):
                return _call_openai(keys["openai_api_key"], system, messages)
        except Exception as e:
            last_err = f"{prov}: {e}"
            continue
    return {"text": "", "provider": None, "error": last_err or "nenhum provider disponível"}


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
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        agent_id = (body.get("agent") or "").strip().lower()
        messages = body.get("messages") or []

        if agent_id not in AGENTS:
            return self._send(400, {"ok": False, "error": f"agent inválido. Use: {sorted(AGENTS.keys())}"})
        if not messages or not isinstance(messages, list):
            return self._send(400, {"ok": False, "error": "messages[] obrigatório"})
        if len(messages) > 50:
            return self._send(400, {"ok": False, "error": "max 50 messages"})

        agent = AGENTS[agent_id]

        # Carrega keys
        sb = supabase_client()
        # ENV primeiro (fonte de verdade que o /api/ai-analysis já usa e funciona);
        # settings só como fallback. Antes era settings-first → uma chave velha na
        # tabela sobrescrevia a chave boa do env e derrubava o chat dos agentes.
        keys = {
            "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY") or _get_setting(sb, "anthropic_api_key"),
            "gemini_api_key":    os.environ.get("GEMINI_API_KEY")    or _get_setting(sb, "gemini_api_key"),
            "openai_api_key":    os.environ.get("OPENAI_API_KEY")    or _get_setting(sb, "openai_api_key"),
        }

        # Chain de fallback: AI_PREFER (env) tem prioridade sobre o primary do agent.
        # Como a conta Anthropic está sem saldo, o padrão favorece gemini (2.5-flash).
        primary = os.environ.get("AI_PREFER") or agent.get("primary", "gemini")
        chain = [primary] + [p for p in ["gemini", "claude", "openai"] if p != primary]

        t0 = time.time()
        result = _try_chain(chain, agent["system"], messages, keys)
        dur = round(time.time() - t0, 2)

        if not result.get("text"):
            return self._send(502, {"ok": False, "error": result.get("error") or "sem resposta", "agent": agent_id})

        # Audit (sem o texto inteiro; só metadata)
        last_user_msg = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        audit(self, user, "ia.chat", target_type="ia", target_id=agent_id,
              notes=f"provider={result.get('provider')} chars_in={len(last_user_msg)} chars_out={len(result['text'])} {dur}s")

        return self._send(200, {
            "ok": True,
            "agent": agent_id,
            "agent_meta": {"name": agent["name"], "ico": agent["ico"], "tagline": agent["tagline"]},
            "reply": result["text"],
            "provider": result.get("provider"),
            "model": result.get("model"),
            "duration_s": dur,
        })


# Endpoint utilitário pra UI listar agents
class _ignore_handler:
    """Dummy pra evitar warnings; Vercel só usa 'handler'."""
    pass


def get_agents_list():
    """Helper exportável."""
    return [{"id": k, **v} for k, v in AGENTS.items()]
