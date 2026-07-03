"""
POST /api/v3/ia/analyze — O CÉREBRO oficial da Inteligência PSM. v84.9

MOTOR: GEMINI (decisão do Paulo, jul/2026 — conta Anthropic sem créditos).
  • análises: GEMINI_SMART_MODEL (default gemini-2.5-flash)
  • 'opus'/'pro' (Briefing de Guerra): GEMINI_PRO_MODEL (default gemini-2.5-pro)
  • Claude fica DORMENTE: só entra se AI_PREFER=claude + ANTHROPIC_API_KEY com saldo.
Substitui o /api/ai-analysis legado nas análises de texto: dossiê completo do
negócio + auth + auditoria + respostas longas.

Body:
  { pergunta | prompt,          → pergunta livre OU prompt completo do chamador
    dossie: true|false,         → injeta o DOSSIÊ real do negócio no contexto (default true p/ pergunta)
    model: 'sonnet'|'opus'|id,  → default sonnet (análises); opus pro Briefing de Guerra
    max_tokens: n (cap 8000),
    system: str? }              → override do system prompt

Auth: JWT lvl>=5 OU Bearer CRON_SECRET (server-to-server: briefing/cron).
Resposta: { ok, text, model_used, dossie_incluido }  (mesma forma do legado → troca drop-in)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of  # type: ignore
from _dossie_lib import compile_dossie  # type: ignore

GEM_FLASH = os.environ.get("GEMINI_SMART_MODEL", "gemini-2.5-flash")
GEM_PRO = os.environ.get("GEMINI_PRO_MODEL", "gemini-2.5-pro")
# aliases: chamadas antigas pedindo 'sonnet'/'opus' caem no tier Gemini equivalente
MODELS = {"sonnet": GEM_FLASH, "flash": GEM_FLASH, "default": GEM_FLASH,
          "opus": GEM_PRO, "pro": GEM_PRO, "haiku": GEM_FLASH}
CLAUDE_MODELS = {"sonnet": "claude-sonnet-5", "opus": "claude-opus-4-8"}
SYSTEM_DEFAULT = (
    "Você é o chefe de inteligência da PSM Imóveis (São José do Rio Preto/SP). Fala com o sócio Paulo: "
    "direto, estratégico, em pt-BR, sem encher linguiça e SEM INVENTAR números — use só os fatos fornecidos. "
    "Valores sempre completos (R$ 12.345,67, nunca '12k'). Quando recomendar, priorize por impacto no "
    "break-even e diga O QUE fazer, QUEM faz e COMO medir. Se um dado necessário não estiver no contexto, "
    "diga que falta em vez de estimar."
)


def _gemini(model, system, prompt, max_tokens):
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return {"ok": False, "error": "GEMINI_API_KEY ausente"}
    # thinkingBudget:0 — sem isso o Gemini 2.5 gasta o teto em "pensamento" e CORTA
    # a resposta no meio (mesmo tratamento do legado ia/roteiro). Modelos sem suporte
    # ao campo devolvem 400 → refaz sem ele.
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.6,
                             "thinkingConfig": {"thinkingBudget": 0}},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    def _call(pl):
        req = urllib.request.Request(url, data=json.dumps(pl).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    try:
        try:
            d = _call(payload)
        except urllib.error.HTTPError as e0:
            if e0.code == 400:
                payload["generationConfig"].pop("thinkingConfig", None)
                d = _call(payload)
            else:
                raise
        cands = d.get("candidates") or []
        text = "".join(pt.get("text", "") for c in cands for pt in ((c.get("content") or {}).get("parts") or []))
        if not text:
            return {"ok": False, "error": "resposta vazia do gemini"}
        return {"ok": True, "text": text, "model_used": model}
    except urllib.error.HTTPError as e:
        try:
            msg = (json.loads(e.read().decode("utf-8")).get("error") or {}).get("message", str(e))[:300]
        except Exception:
            msg = str(e)[:300]
        return {"ok": False, "error": f"gemini {e.code}: {msg}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _anthropic(model, system, prompt, max_tokens):
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return {"ok": False, "error": "ANTHROPIC_API_KEY ausente"}
    payload = {"model": model, "max_tokens": max_tokens, "system": system,
               "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=json.dumps(payload).encode("utf-8"),
        method="POST", headers={"Content-Type": "application/json", "x-api-key": key,
                                "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read().decode("utf-8"))
        text = "".join(b.get("text", "") for b in (d.get("content") or []) if b.get("type") == "text")
        if not text:
            return {"ok": False, "error": "resposta vazia"}
        return {"ok": True, "text": text, "model_used": d.get("model") or model}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8"))
            msg = ((err.get("error") or {}).get("message") or str(e))[:300]
        except Exception:
            msg = str(e)[:300]
        return {"ok": False, "error": f"anthropic {e.code}: {msg}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _legacy_fallback(prompt, model, max_tokens):
    """Se a chamada direta falhar, tenta o /api/ai-analysis legado (tem fallback Gemini)."""
    base = (os.environ.get("PUBLIC_BASE_URL") or "https://www.housepsm.com.br").rstrip("/")
    body = json.dumps({"prompt": prompt, "model": model, "max_tokens": min(max_tokens, 4000)}).encode("utf-8")
    req = urllib.request.Request(base + "/api/ai-analysis", data=body,
                                 headers={"Content-Type": "application/json", "User-Agent": "PSM-OS/analyze"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):
        # JWT lvl>=5 OU CRON_SECRET (briefing/cron chama server-to-server)
        actor = None
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):
            try:
                actor = require_user(self, min_lvl=5)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        pergunta = (body.get("pergunta") or "").strip()
        prompt = (body.get("prompt") or "").strip()
        if not pergunta and not prompt:
            return self._send(400, {"ok": False, "error": "pergunta ou prompt obrigatório"})
        if len(prompt) + len(pergunta) > 60000:
            return self._send(400, {"ok": False, "error": "prompt longo demais"})

        mkey = (body.get("model") or "default").strip().lower()
        model = MODELS.get(mkey, mkey if mkey.startswith("gemini-") else MODELS["default"])
        try:
            max_tokens = max(300, min(8000, int(body.get("max_tokens") or 3000)))
        except Exception:
            max_tokens = 3000
        system = (body.get("system") or SYSTEM_DEFAULT).strip()[:4000]

        # dossiê: default ligado quando é pergunta livre; opcional pra prompt pronto
        quer_dossie = body.get("dossie")
        if quer_dossie is None:
            quer_dossie = bool(pergunta)
        dossie_txt = ""
        if quer_dossie:
            sb = supabase_client()
            if sb:
                try:
                    dossie_txt = compile_dossie(sb, frente_of)
                except Exception as e:
                    dossie_txt = f"(dossiê indisponível: {e})"

        final = prompt or pergunta
        if dossie_txt:
            final = f"{dossie_txt}\n\n---\n\n{'PERGUNTA DO SÓCIO: ' + pergunta if pergunta else prompt}"

        # GEMINI primário (decisão jul/2026). Claude só se AI_PREFER=claude (dormente).
        if os.environ.get("AI_PREFER", "").strip().lower() == "claude" and os.environ.get("ANTHROPIC_API_KEY", "").strip():
            res = _anthropic(CLAUDE_MODELS.get(mkey, "claude-sonnet-5"), system, final, max_tokens)
            if not res.get("ok"):
                res = _gemini(model, system, final, max_tokens)
        else:
            res = _gemini(model, system, final, max_tokens)
        if not res.get("ok"):
            try:
                leg = _legacy_fallback(final, model, max_tokens)
                if leg.get("ok") and leg.get("text"):
                    res = {"ok": True, "text": leg["text"],
                           "model_used": (leg.get("model_used") or "legado") + " (fallback)"}
            except Exception:
                pass
        if not res.get("ok"):
            return self._send(502, {"ok": False, "error": res.get("error") or "IA indisponível"})

        try:
            sb = supabase_client()
            if sb and actor:
                audit(self, actor, "ia.analyze", target_type="ia",
                      target_id=model, notes=(pergunta or prompt)[:120])
        except Exception:
            pass
        return self._send(200, {"ok": True, "text": res["text"], "model_used": res.get("model_used"),
                                "dossie_incluido": bool(dossie_txt)})
