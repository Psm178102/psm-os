"""POST /api/v3/ia/roteiro — IA de produção da PSM Academy (Gemini). v77.59
Body: { modo: 'roteiro'|'temas'|'titulo'|'projeto'|'insights', tema?, linha?, tipo?, contexto? }
Resp: { ok, text }
Gera roteiro de aula, temas, títulos SEO, plano de projeto ('projeto') ou
leitura executiva da carteira de projetos ('insights', usa body.contexto).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore

SYSTEM = ("Você é roteirista-chefe da PSM Academy — a faculdade interna de uma imobiliária "
          "de alto padrão em São José do Rio Preto/SP. Escreve roteiros de aula objetivos, "
          "didáticos e práticos, em português do Brasil, com exemplos reais do mercado "
          "imobiliário brasileiro (corretor, CRECI, captação, lançamentos, locação). "
          "Linguagem direta, sem enrolação, tom de mentor.")

SYSTEM_PROJ = ("Você é um gerente de projetos sênior da PSM Imóveis (imobiliária de alto padrão "
               "em São José do Rio Preto/SP). Estrutura planos de projeto objetivos e acionáveis, "
               "em português do Brasil, com foco em execução, prazos e responsáveis.")

SYSTEM_INSIGHTS = ("Você é o PMO (analista de portfólio de projetos) da diretoria da PSM Imóveis. "
                   "Lê o retrato atual da carteira de projetos e devolve uma leitura executiva curta, "
                   "em português do Brasil, baseada APENAS nos dados fornecidos — nunca invente projetos, "
                   "prazos ou números. Tom direto, de conselheiro de diretoria.")


def _get_setting(sb, key):
    try:
        r = sb.table("settings").select("value").eq("key", key).limit(1).execute().data or []
        return r[0]["value"] if r else None
    except Exception:
        return None


def _gemini(api_key, prompt, system=SYSTEM):
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {"contents": [{"role": "user", "parts": [{"text": f"[Sistema]: {system}\n\n[Tarefa]: {prompt}"}]}],
               "generationConfig": {"maxOutputTokens": 1400, "temperature": 0.75}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    cands = data.get("candidates") or []
    if not cands:
        return ""
    return "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))


def _prompt(modo, tema, linha, tipo, contexto=""):
    if modo == "insights":
        ctx = (contexto or "").strip() or "(sem projetos cadastrados)"
        return ("Aqui está o retrato ATUAL da carteira de projetos da diretoria:\n\n"
                f"{ctx}\n\n"
                "Faça uma LEITURA EXECUTIVA curta e acionável, exatamente nesta ordem:\n"
                "🔴 RISCOS — o que pode dar errado (atrasos, alta prioridade parada, sem dono/prazo)\n"
                "🎯 FOCO DA SEMANA — 2 a 3 projetos que merecem atenção AGORA e por quê\n"
                "⚡ PRÓXIMAS AÇÕES — passos concretos (quem/o quê)\n"
                "💡 OBSERVAÇÕES — padrões de carga, gargalos por etapa/responsável\n"
                "Baseie-se SÓ nos dados acima. Não invente projetos. Seja direto.")
    tema = tema or "(sem tema)"; linha = linha or "geral"; tipo = tipo or "vídeo-aula"
    if modo == "projeto":
        return (f"Esboce um PLANO DE PROJETO para '{tema}' (área: {linha}). Estruture assim:\n"
                f"🎯 OBJETIVO (resultado esperado)\n"
                f"📦 ESCOPO / ENTREGÁVEIS\n"
                f"🧩 ETAPAS (lista em ordem, cada uma com uma sugestão de responsável)\n"
                f"⚠️ RISCOS e como mitigar\n"
                f"📅 CRONOGRAMA MACRO (fases e prazos aproximados)\n"
                f"✅ CRITÉRIOS DE SUCESSO. Prático, direto e acionável.")
    if modo == "temas":
        return (f"Liste 8 temas de aula para a trilha '{linha}' da PSM Academy, do básico ao avançado. "
                f"Para cada um: título da aula + 1 linha do que ensina. Formato em lista.")
    if modo == "titulo":
        return (f"Sugira 5 títulos chamativos e claros (estilo YouTube/SEO) para a aula sobre '{tema}' "
                f"(trilha {linha}). Só os títulos, numerados.")
    # roteiro (default)
    return (f"Escreva um ROTEIRO completo para a aula '{tema}' (trilha: {linha}; formato: {tipo}) da PSM Academy. "
            f"Estruture exatamente assim:\n"
            f"🎬 GANCHO (primeiros 10s, fisga a atenção)\n"
            f"🎯 OBJETIVO DA AULA (o que a pessoa vai saber fazer no fim)\n"
            f"📚 CONTEÚDO (tópicos em ordem, cada um com explicação curta e direta)\n"
            f"💡 EXEMPLO PRÁTICO (caso real do mercado imobiliário)\n"
            f"✅ RESUMO (3 a 5 pontos)\n"
            f"📣 CTA (o que pedir pro aluno fazer agora). Seja prático e aplicável.")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=3)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        modo = (body.get("modo") or "roteiro").strip().lower()
        sb = supabase_client()
        key = os.environ.get("GEMINI_API_KEY") or (_get_setting(sb, "gemini_api_key") if sb else None)
        if not key:
            return self._send(503, {"ok": False, "error": "IA indisponível (sem chave Gemini)"})
        sysmsg = SYSTEM_INSIGHTS if modo == "insights" else (SYSTEM_PROJ if modo == "projeto" else SYSTEM)
        try:
            text = _gemini(key, _prompt(modo, body.get("tema"), body.get("linha"), body.get("tipo"), body.get("contexto")), sysmsg)
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"IA: {str(e)[:160]}"})
        if not text:
            return self._send(502, {"ok": False, "error": "IA sem resposta"})
        try: audit(self, user, "ia.roteiro", target_type="academy", notes=f"modo={modo} chars={len(text)}")
        except Exception: pass
        return self._send(200, {"ok": True, "text": text})
