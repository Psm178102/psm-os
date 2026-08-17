"""
🧠 SR. PERFORMANCE (v86.33) — rodapé de análise IA em TODOS os quadros da
Gestão Comercial (pedido do Paulo, 17/ago).

POST {tab, janela:{since,until}, resumo:{<quadro_id>: dados compactos}}
→ {ok, analises:{<quadro_id>: "análise 1-3 frases"}, provedor, cached}

Mesma cadeia de IA da casa (AI_PREFER: gemini → claude → openai — padrão do
Sr. Gerência). Cache 6h no shared_kv por hash do resumo (o dado muda → hash
muda → análise nova; senão não paga IA de novo). Gate lvl>=5 (mesmo da página).
"""
from http.server import BaseHTTPRequestHandler
import hashlib
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from simulador import _kv_read, _kv_write  # type: ignore

CACHE_H = 6


def _ia(prompt, max_tokens=2048):
    """Cadeia gemini → claude → openai (mesmo contrato do _ia_lib da produção)."""
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
                                     "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4,
                                                          "thinkingConfig": {"thinkingBudget": 0}}}).encode(),
                    headers={"Content-Type": "application/json", "x-goog-api-key": k})
                with urllib.request.urlopen(req, timeout=45) as r:
                    data = json.loads(r.read().decode())
                parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                txt = "".join(p.get("text", "") for p in parts)
            elif prov == "claude":
                req = urllib.request.Request("https://api.anthropic.com/v1/messages",
                    data=json.dumps({"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
                                     "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}).encode(),
                    headers={"x-api-key": k, "anthropic-version": "2023-06-01", "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=45) as r:
                    data = json.loads(r.read().decode())
                txt = "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text")
            else:
                req = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                    data=json.dumps({"model": "gpt-4o-mini", "max_tokens": max_tokens,
                                     "messages": [{"role": "user", "content": prompt}]}).encode(),
                    headers={"Authorization": "Bearer " + k, "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=45) as r:
                    data = json.loads(r.read().decode())
                txt = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if txt:
                return txt.strip(), prov
        except Exception:
            continue
    return None, None


PROMPT = """Você é o SR. PERFORMANCE, analista comercial sênior da PSM (holding imobiliária de São José do Rio Preto: equipes Conquista = residencial/MCMV volume, MAP = médio/alto padrão ponte, Terceiros e Locação).

Abaixo estão os dados REAIS de quadros do painel de Gestão Comercial, no período {since} → {until}. Cada chave do JSON é o id de um quadro.

Para CADA quadro, escreva a análise do Sr. Performance: 1 a 3 frases em português do Brasil, direto ao ponto, tom de analista experiente falando com o gestor. Diagnóstico + UMA ação prática. Cite números do próprio quadro. Sem enrolação, sem repetir o título do quadro, sem markdown.

Regras:
- Se o quadro estiver vazio ou sem amostra, diga isso em 1 frase honesta (nada de inventar).
- Amostras pequenas: alerte que a leitura é frágil.
- Responda SOMENTE um JSON válido: {{"<id do quadro>": "análise", ...}} — todas as chaves recebidas, nenhuma a mais.

DADOS:
{dados}"""


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        resumo = body.get("resumo") or {}
        janela = body.get("janela") or {}
        tab = str(body.get("tab") or "?")[:24]
        if not isinstance(resumo, dict) or not resumo:
            return self._send(400, {"ok": False, "error": "resumo vazio"})
        if len(json.dumps(resumo)) > 60000:
            return self._send(400, {"ok": False, "error": "resumo grande demais"})

        h = hashlib.sha1(json.dumps({"t": tab, "r": resumo}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        ck = f"gc_sr:{h}"
        cached, _ok = _kv_read(sb, ck)
        if cached and cached.get("ts") and cached.get("analises"):
            try:
                idade = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["ts"])).total_seconds()
                if idade < CACHE_H * 3600:
                    return self._send(200, {"ok": True, "analises": cached["analises"],
                                            "provedor": cached.get("provedor"), "cached": True})
            except Exception:
                pass

        prompt = PROMPT.format(since=janela.get("since") or "?", until=janela.get("until") or "?",
                               dados=json.dumps(resumo, ensure_ascii=False))
        txt, prov = _ia(prompt)
        if not txt:
            return self._send(502, {"ok": False, "error": "nenhum provedor de IA respondeu"})
        m = re.search(r"\{.*\}", txt, re.DOTALL)
        try:
            analises = json.loads(m.group(0) if m else txt)
            assert isinstance(analises, dict)
        except Exception:
            return self._send(502, {"ok": False, "error": "IA não devolveu JSON válido"})
        analises = {str(k)[:60]: str(v)[:1200] for k, v in analises.items() if k in resumo}
        _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(),
                           "analises": analises, "provedor": prov, "tab": tab})
        return self._send(200, {"ok": True, "analises": analises, "provedor": prov, "cached": False})
