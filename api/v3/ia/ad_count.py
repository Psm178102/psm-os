"""POST /api/v3/ia/ad_count — conta anúncios de um concorrente a partir de um PRINT
da Biblioteca de Anúncios do Meta, usando Vision (Gemini → fallback Claude/OpenAI).

A Biblioteca mostra no topo um texto tipo "~47 resultados" — a IA lê esse número
(mais confiável que contar cartões). Se a contagem não aparece, conta os cartões visíveis.

Body: { id?: <concorrente_id>, image: "<base64 ou data:...;base64,...>", mime?: "image/png" }
Resposta: { ok, count, basis, note, provider }. Se id, grava em concorrentes.anuncios_count. lvl>=5.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, re, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore

PROMPT = (
    "Esta imagem é uma captura de tela da Biblioteca de Anúncios do Meta (Facebook/Instagram Ad Library) "
    "de UM anunciante (concorrente imobiliário). Extraia:\n"
    "1) count: quantos anúncios ATIVOS — perto do topo costuma aparecer '~47 resultados', 'Cerca de 12 resultados' "
    "ou '47 results'. Se não aparecer, conte os cartões de anúncio visíveis.\n"
    "2) datas_inicio: para cada cartão de anúncio visível, a data em que começou a veicular — o texto "
    "'Veiculação iniciada em DD de mês de AAAA' (ou 'Started running on ...'). Devolva CADA data no formato "
    "AAAA-MM-DD. Se nenhuma data estiver visível, devolva lista vazia [].\n"
    'Responda APENAS com JSON, nada além: {"count": <inteiro>, "basis": "resultados"|"cartoes", '
    '"datas_inicio": ["AAAA-MM-DD", ...], "note": "<observação curta>"}'
)


def _gemini(api_key, b64, mime):
    model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {"contents": [{"role": "user", "parts": [
        {"text": PROMPT}, {"inline_data": {"mime_type": mime, "data": b64}}]}],
        "generationConfig": {"temperature": 0}}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=50) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["candidates"][0]["content"]["parts"][0]["text"], "gemini:" + model


def _claude(api_key, b64, mime):
    url = "https://api.anthropic.com/v1/messages"
    payload = {"model": "claude-3-5-sonnet-20241022", "max_tokens": 300, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}]}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={
        "Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=50) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["content"][0]["text"], "claude"


def _openai(api_key, b64, mime):
    url = "https://api.openai.com/v1/chat/completions"
    payload = {"model": "gpt-4o-mini", "max_tokens": 300, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}]}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key})
    with urllib.request.urlopen(req, timeout=50) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"], "openai"


def _dias_medio(datas):
    """Média de dias ativos a partir das datas de início (AAAA-MM-DD), vs hoje."""
    if not datas:
        return None
    hoje = datetime.now(timezone.utc).date()
    difs = []
    for d in datas:
        try:
            dt = datetime.fromisoformat(str(d)[:10]).date()
            dd = (hoje - dt).days
            if 0 <= dd <= 3650:
                difs.append(dd)
        except Exception:
            continue
    return round(sum(difs) / len(difs)) if difs else None


def _parse(txt):
    if not txt:
        return None, None, None, None
    m = re.search(r"\{.*\}", txt, re.S)
    if m:
        try:
            o = json.loads(m.group(0))
            c = o.get("count")
            if c is not None:
                return int(c), o.get("basis") or "?", (o.get("note") or "")[:120], _dias_medio(o.get("datas_inicio"))
        except Exception:
            pass
    n = re.search(r"\d[\d. \s]*", txt)
    if n:
        digits = re.sub(r"\D", "", n.group(0))
        if digits:
            return int(digits), "?", txt[:120], None
    return None, None, txt[:160], None


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
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        image = (body.get("image") or "").strip()
        mime = (body.get("mime") or "").strip()
        if image.startswith("data:"):
            try:
                head, image = image.split(",", 1)
                mime = mime or head.split(";")[0].split(":")[1]
            except Exception:
                pass
        mime = mime or "image/png"
        if not image:
            return self._send(400, {"ok": False, "error": "image (base64) obrigatório"})
        if len(image) > 12_000_000:
            return self._send(413, {"ok": False, "error": "imagem grande demais — reduza/recorte o print"})

        keys = {
            "gemini": os.environ.get("GEMINI_API_KEY"),
            "anthropic": os.environ.get("ANTHROPIC_API_KEY"),
            "openai": os.environ.get("OPENAI_API_KEY"),
        }
        order = [("gemini", _gemini), ("anthropic", _claude), ("openai", _openai)]
        txt = provider = None
        errs = []
        for name, fn in order:
            if not keys.get(name):
                continue
            try:
                txt, provider = fn(keys[name], image, mime)
                if txt:
                    break
            except Exception as e:
                errs.append(f"{name}: {e}")
                continue
        if txt is None:
            return self._send(502, {"ok": False, "error": "; ".join(errs) or "nenhum provider de visão disponível"})

        count, basis, note, dias_medio = _parse(txt)
        if count is None:
            return self._send(200, {"ok": False, "error": "não consegui ler o número no print", "raw": txt[:200], "provider": provider})

        saved = False
        cid = body.get("id")
        if cid is not None:
            sb = supabase_client()
            if sb:
                upd = {"anuncios_count": count, "ultima_atualizacao": datetime.now(timezone.utc).isoformat()}
                if dias_medio is not None:
                    upd["anuncios_dias_medio"] = dias_medio
                try:
                    sb.table("concorrentes").update(upd).eq("id", cid).execute()
                    saved = True
                except Exception:
                    # fallback: coluna nova pode não existir ainda → grava só o essencial
                    try:
                        sb.table("concorrentes").update({"anuncios_count": count}).eq("id", cid).execute()
                        saved = True
                    except Exception:
                        saved = False
        try:
            audit(self, actor, "intel.ad_count", target_type="concorrentes", target_id=str(cid or ""))
        except Exception:
            pass
        return self._send(200, {"ok": True, "count": count, "basis": basis, "note": note,
                                "dias_medio": dias_medio, "provider": provider, "saved": saved})
