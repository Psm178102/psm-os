"""
_ia_lib.py — cadeia de IA compartilhada dos módulos de produção (v84.35).
Mesma cadeia AI_PREFER do briefing/estoque: gemini → claude → openai.
Devolve (texto, provedor) ou (None, None) se nenhum provedor respondeu.
"""
import json, os, urllib.request


def ia(prompt, max_tokens=1024, temperature=0.7):
    keys = {"gemini": os.environ.get("GEMINI_API_KEY"),
            "claude": os.environ.get("ANTHROPIC_API_KEY"),
            "openai": os.environ.get("OPENAI_API_KEY")}
    primary = os.environ.get("AI_PREFER") or "gemini"
    for prov in [primary] + [p for p in ("gemini", "claude", "openai") if p != primary]:
        k = keys.get(prov)
        if not k:
            continue
        try:
            if prov == "gemini":
                model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
                req = urllib.request.Request(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    data=json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                                     "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature,
                                                          "thinkingConfig": {"thinkingBudget": 0}}}).encode(),
                    headers={"Content-Type": "application/json", "x-goog-api-key": k})
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = json.loads(r.read().decode())
                parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                txt = "".join(p.get("text", "") for p in parts)
            elif prov == "claude":
                req = urllib.request.Request("https://api.anthropic.com/v1/messages",
                    data=json.dumps({"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
                                     "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}).encode(),
                    headers={"x-api-key": k, "anthropic-version": "2023-06-01", "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = json.loads(r.read().decode())
                txt = "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text")
            else:
                req = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                    data=json.dumps({"model": "gpt-4o-mini", "max_tokens": max_tokens,
                                     "messages": [{"role": "user", "content": prompt}]}).encode(),
                    headers={"Authorization": "Bearer " + k, "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = json.loads(r.read().decode())
                txt = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if txt:
                return txt.strip(), prov
        except Exception:
            continue
    return None, None


REGRAS_WHATSAPP = """REGRAS OBRIGATÓRIAS da mensagem:
- Português do Brasil, tom humano e caloroso, como uma pessoa de verdade escreve no WhatsApp
- CURTA: no máximo 3 linhas. Textão mata a conversa.
- UMA mensagem só (não numere passos, não escreva alternativas)
- No máximo 2 emojis, usados com naturalidade
- Nunca soe como robô, template ou telemarketing; nada de "Prezado" ou formalidade
- Termine com UMA pergunta simples que puxe resposta
- Responda SÓ com o texto da mensagem, sem aspas, sem explicação."""
