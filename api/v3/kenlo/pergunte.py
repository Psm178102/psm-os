"""
POST /api/v3/kenlo/pergunte — BUSCA IA no estoque Kenlo. v84.13
Body: { q: "pergunta do corretor em linguagem natural" }

O corretor escreve como fala: "preciso de um terreno no Quinta do Golfe",
"apartamento 3 dorms zona sul até 700 mil", "o que é boa oportunidade?",
"o que está abandonado?". A IA recebe o estoque INTEIRO digerido (1 linha por
imóvel) + médias de R$/m² por tipo e bairro, e devolve resposta + códigos.

Providers na mesma ordem do ia/chat.py (AI_PREFER, hoje gemini-2.5-flash).
Resposta: { ok, resposta (markdown), codigos[], itens[] (cards prontos) }
Auth: JWT lvl>=2.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

COLS = ("id,property_code,titulo,endereco,bairro,cidade,uf,preco_venda,preco_locacao,"
        "tipo,finalidade,dorms,banheiros,suites,vagas,area_util,area_total,condominio,"
        "foto_capa,n_fotos,criado_kenlo,atualizado_kenlo")

SYSTEM = (
    "Você é o assistente de estoque da PSM Imóveis (São José do Rio Preto/SP, foco zona sul). "
    "Você recebe o estoque completo de anúncios (1 linha por imóvel) e uma pergunta de corretor. "
    "Responda APENAS com base no estoque fornecido — nunca invente imóvel ou código.\n"
    "Formato de cada linha: CODIGO|tipo|bairro|dorms|vagas|area_m2|R$venda|R$aluguel/mes|"
    "dias_sem_atualizar|dias_no_ar|n_fotos|titulo\n"
    "Conceitos:\n"
    "- OPORTUNIDADE: R$/m² claramente abaixo da média do mesmo tipo+bairro (tabela de médias "
    "fornecida), imóvel com boa ficha (fotos, área) — explique o porquê com números.\n"
    "- ABANDONADO: muitos dias sem atualizar e/ou no ar (180+), sem foto ou com poucas fotos — "
    "é pauta de reativação, não de descarte.\n"
    "- Use seu conhecimento de São José do Rio Preto pra regiões (ex.: zona sul ≈ Iguatemi, "
    "Jardim Tarraf, Quinta do Golfe, Georgina, Bosque da Felicidade, Jardim do Golfe, "
    "Villa Lobos, Gaivota, Damha, Quintessa etc.).\n"
    "- Valores SEMPRE completos no formato R$ 390.000,00.\n"
    "Responda SOMENTE um JSON válido, sem markdown em volta: "
    '{"resposta": "análise curta em markdown (máx ~120 palavras), direta e útil pro corretor", '
    '"codigos": ["ATÉ 12 códigos, do melhor pro pior"]}'
)


def _dias(ts, agora):
    try:
        return (agora - datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).days
    except Exception:
        return None


def _digest(itens):
    agora = datetime.now(timezone.utc)
    linhas, medias = [], {}
    for i in itens:
        i["dias_sem_atualizar"] = _dias(i.get("atualizado_kenlo"), agora)
        i["dias_no_ar"] = _dias(i.get("criado_kenlo"), agora)
        area = i.get("area_util") or i.get("area_total")
        pv = i.get("preco_venda")
        if pv and area:
            k = (i.get("tipo") or "?", i.get("bairro") or "?")
            medias.setdefault(k, []).append(float(pv) / float(area))
        linhas.append("|".join(str(x if x is not None else "") for x in [
            i.get("property_code"), i.get("tipo") or "", i.get("bairro") or "",
            i.get("dorms") or "", i.get("vagas") or "",
            int(area) if area else "",
            int(float(pv)) if pv else "", int(float(i.get("preco_locacao"))) if i.get("preco_locacao") else "",
            i.get("dias_sem_atualizar"), i.get("dias_no_ar"), i.get("n_fotos") or 0,
            (i.get("titulo") or "")[:60].replace("|", " "),
        ]))
    med_txt = "\n".join(f"{t}/{b}: R$ {int(sum(v) / len(v)):,}/m² ({len(v)} anúncios)".replace(",", ".")
                        for (t, b), v in sorted(medias.items(), key=lambda x: -len(x[1])) if len(v) >= 2)
    return "\n".join(linhas), med_txt


def _extrai_json(text):
    text = re.sub(r"```(json)?", "", text or "").strip()
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    # resposta truncada/malformada: pesca o campo resposta e códigos soltos
    r = re.search(r'"resposta"\s*:\s*"((?:[^"\\]|\\.)*)', text, re.S)
    cods = re.findall(r'"([A-Z]{2}\d{4})"', text)
    if r or cods:
        resp = None
        if r:
            try:
                resp = json.loads('"' + r.group(1).rstrip("\\") + '"')
            except Exception:
                resp = r.group(1)
        return {"resposta": resp, "codigos": cods}
    return None


def _call_gemini(api_key, prompt):
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
               "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.3,
                                    "responseMimeType": "application/json"}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=55) as r:
        data = json.loads(r.read().decode())
    parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


def _call_claude(api_key, prompt):
    payload = {"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
               "max_tokens": 2048, "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages",
                                 data=json.dumps(payload).encode(),
                                 headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=55) as r:
        data = json.loads(r.read().decode())
    return "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text")


def _call_openai(api_key, prompt):
    payload = {"model": "gpt-4o-mini", "max_tokens": 2048,
               "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                                 data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + api_key,
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=55) as r:
        data = json.loads(r.read().decode())
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "")


def _pergunta_ia(prompt):
    keys = {"gemini": os.environ.get("GEMINI_API_KEY"),
            "claude": os.environ.get("ANTHROPIC_API_KEY"),
            "openai": os.environ.get("OPENAI_API_KEY")}
    primary = os.environ.get("AI_PREFER") or "gemini"
    chain = [primary] + [p for p in ("gemini", "claude", "openai") if p != primary]
    fns = {"gemini": _call_gemini, "claude": _call_claude, "openai": _call_openai}
    last = None
    for prov in chain:
        if not keys.get(prov):
            continue
        try:
            txt = fns[prov](keys[prov], prompt)
            if txt:
                return txt, prov
        except Exception as e:
            last = f"{prov}: {e}"
    raise RuntimeError(last or "nenhum provider de IA configurado")


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
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
            body = json.loads(raw or "{}")
            if isinstance(body, str):  # body double-stringificado (api.js re-stringifica)
                body = json.loads(body or "{}")
            q = (body.get("q") or "").strip() if isinstance(body, dict) else ""
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if not q or len(q) > 500:
            return self._send(400, {"ok": False, "error": "q obrigatório (máx 500 chars)"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            itens = sb.table("kenlo_imoveis").select(COLS).eq("ativo", True).limit(3000).execute().data or []
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        if not itens:
            return self._send(200, {"ok": True, "resposta": "Estoque vazio — rode uma sincronização.", "codigos": [], "itens": []})

        digest, medias = _digest(itens)
        prompt = (f"{SYSTEM}\n\n== MÉDIAS R$/m² (tipo/bairro) ==\n{medias}\n\n"
                  f"== ESTOQUE ({len(itens)} anúncios) ==\n{digest}\n\n== PERGUNTA DO CORRETOR ==\n{q}")
        try:
            txt, prov = _pergunta_ia(prompt)
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"IA indisponível: {str(e)[:150]}"})
        j = _extrai_json(txt) or {}
        resposta = (j.get("resposta") or txt or "").strip()[:3000]
        codigos = [str(c).strip().upper() for c in (j.get("codigos") or []) if c][:12]
        por_codigo = {(i.get("property_code") or "").upper(): i for i in itens}
        cards = [por_codigo[c] for c in codigos if c in por_codigo]
        audit(self, user, "kenlo.pergunte", target_type="kenlo", target_id="estoque",
              notes=f"provider={prov} q={q[:80]} hits={len(cards)}")
        return self._send(200, {"ok": True, "resposta": resposta, "codigos": codigos,
                                "itens": cards, "provider": prov, "avaliados": len(itens)})
