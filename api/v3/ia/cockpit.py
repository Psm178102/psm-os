"""POST /api/v3/ia/cockpit — Copiloto de Decisão: lê o snapshot do Cockpit
(fronts com semáforo/KPIs + alertas cruzados) e escreve a RECOMENDAÇÃO DA SEMANA.

Body: { snapshot: { fronts:[{nome,status,kpis:[[l,v]],alerta}], alertas:[{sev,txt}],
        veredito, dia, dias_mes } }. lvl>=7. Gemini → fallback Claude/OpenAI.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore

SYSTEM = (
    "Você é o copiloto de decisão da DIRETORIA da PSM (imobiliária de alto crescimento em São José do Rio Preto). "
    "Recebe o estado atual da empresa: fronts com semáforo (ok/warn/bad) e KPIs, mais alertas cruzados. "
    "Escreva a RECOMENDAÇÃO DA SEMANA — direta, priorizada por IMPACTO no caixa e no VGV, usando os números dados. "
    "Não invente dados nem cite o que não foi fornecido. Tom de sócio sênior: objetivo, sem enrolação."
)


def _prompt(snap):
    L = ["ESTADO DOS FRONTS (semáforo + KPIs):"]
    for f in (snap.get("fronts") or []):
        kp = "; ".join(f"{p[0]}: {p[1]}" for p in (f.get("kpis") or []) if isinstance(p, (list, tuple)) and len(p) >= 2)
        line = f"- {f.get('nome')} [{f.get('status')}]" + (f" — {kp}" if kp else "")
        if f.get("alerta"):
            line += f" | obs: {f['alerta']}"
        L.append(line)
    al = snap.get("alertas") or []
    if al:
        L.append("\nALERTAS CRUZADOS (sev = bad é mais grave):")
        for a in al:
            L.append(f"- ({a.get('sev')}) {a.get('txt')}")
    L.append(f"\nVeredito atual do painel: {snap.get('veredito', '—')}.")
    L.append(f"Estamos no dia {snap.get('dia', '?')}/{snap.get('dias_mes', '?')} do mês (considere o ritmo).")
    L.append(
        "\nResponda em PT-BR, EXATAMENTE neste formato (sem markdown de título, use os emojis):\n"
        "🎯 FOCO Nº1: <a coisa mais importante agora — 1 parágrafo curto, com o número que justifica>\n"
        "⚠️ CORTAR/ATACAR: <1-2 riscos a tratar já>\n"
        "✅ AÇÕES DA SEMANA:\n• <ação curta e acionável>\n• <ação>\n• <ação>\n"
        "🧭 LEITURA: <1 frase do estado geral da PSM>"
    )
    return "\n".join(L)


def _gemini(key, system, user):
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {"contents": [{"role": "user", "parts": [{"text": f"[Sistema]: {system}\n\n{user}"}]}],
               "generationConfig": {"temperature": 0.3}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=50) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d["candidates"][0]["content"]["parts"][0]["text"], "gemini:" + model


def _claude(key, system, user):
    url = "https://api.anthropic.com/v1/messages"
    payload = {"model": "claude-3-5-sonnet-20241022", "max_tokens": 900, "system": system,
               "messages": [{"role": "user", "content": user}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={
        "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=50) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d["content"][0]["text"], "claude"


def _openai(key, system, user):
    url = "https://api.openai.com/v1/chat/completions"
    payload = {"model": "gpt-4o-mini", "max_tokens": 900,
               "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=50) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d["choices"][0]["message"]["content"], "openai"


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
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        snap = body.get("snapshot") or {}
        if not snap.get("fronts"):
            return self._send(400, {"ok": False, "error": "snapshot.fronts obrigatório"})
        user = _prompt(snap)

        keys = {"gemini": os.environ.get("GEMINI_API_KEY"),
                "anthropic": os.environ.get("ANTHROPIC_API_KEY"),
                "openai": os.environ.get("OPENAI_API_KEY")}
        order = [("gemini", _gemini), ("anthropic", _claude), ("openai", _openai)]
        errs = []
        for name, fn in order:
            if not keys.get(name):
                continue
            try:
                txt, provider = fn(keys[name], SYSTEM, user)
                if txt:
                    return self._send(200, {"ok": True, "text": txt, "provider": provider})
            except Exception as e:
                errs.append(f"{name}: {e}")
                continue
        return self._send(502, {"ok": False, "error": "; ".join(errs) or "nenhum provider de IA disponível"})
