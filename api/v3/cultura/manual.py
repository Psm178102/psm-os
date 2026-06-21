"""
GET/POST /api/v3/cultura/manual — Manual de Cultura PSM (editável pelo sócio). v80.5

Antes era 100% chumbado no front (stub genérico do Sprint 8.0). Agora é config-driven:
o sócio edita missão, visão, valores (cards) e SEÇÕES livres (texto ou lista) — pilares,
plano de carreira, rituais, história, regras, o que quiser. Guarda em shared_kv
'manual_cultura' (sem SQL). Se nunca foi editado, devolve o conteúdo-base atual.

Estrutura:
{
  "missao": str, "visao": str,
  "valores": [{ "ico": str, "t": str, "d": str }],
  "secoes":  [{ "id": str, "ico": str, "titulo": str, "tipo": "texto"|"lista",
                "conteudo": str, "itens": [str] }]
}

GET  (qualquer autenticado): { ok, manual, can_edit }
POST (lvl >= 10 — sócio): { manual }  → salva o documento inteiro
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "manual_cultura"

# Conteúdo-base (o que já existia no front) — vira ponto de partida editável.
DEFAULT = {
    "missao": "Transformar sonhos em endereços, conectando pessoas ao imóvel ideal com excelência, ética e resultado. Atuamos como uma assessoria imobiliária completa, oferecendo segurança e transparência em cada negociação.",
    "visao": "Ser a assessoria imobiliária mais admirada e respeitada de São José do Rio Preto, reconhecida pela alta performance, inovação tecnológica e formação de profissionais de excelência no mercado imobiliário.",
    "valores": [
        {"ico": "🎯", "t": "Foco no Resultado", "d": "Metas claras, ação consistente, entrega excepcional"},
        {"ico": "🤝", "t": "Ética & Transparência", "d": "Agir com integridade em cada negociação"},
        {"ico": "🔥", "t": "Alta Performance", "d": "Busca constante por evolução e excelência"},
        {"ico": "💛", "t": "Espírito de Equipe", "d": "Colaboração, respeito e crescimento juntos"},
        {"ico": "📚", "t": "Aprendizado Contínuo", "d": "Formação, capacitação e desenvolvimento"},
        {"ico": "🏆", "t": "Meritocracia", "d": "Reconhecimento baseado em resultados reais"},
    ],
    "secoes": [
        {"id": "sobre", "ico": "🏢", "titulo": "Sobre a PSM", "tipo": "texto",
         "conteudo": "A PSM Assessoria Imobiliária atua no mercado de São José do Rio Preto com foco em lançamentos, imóveis de terceiros, locação e conquista. Nossa equipe é formada por profissionais treinados e comprometidos com os mais altos padrões de atendimento.", "itens": []},
        {"id": "regras", "ico": "📋", "titulo": "Regras de Convivência", "tipo": "lista", "conteudo": "",
         "itens": [
             "Pontualidade e comprometimento com horários",
             "Respeito aos colegas, líderes e clientes",
             "Uso adequado do CRM e ferramentas do sistema",
             "Participação ativa em treinamentos e reuniões",
             "Comunicação clara e profissional",
             "Vestimenta e apresentação alinhadas à marca PSM",
         ]},
    ],
}


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else None
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = None
    return val if isinstance(val, dict) and val.get("_saved") else None


def _clean(m):
    """Sanitiza o documento recebido do front."""
    def s(x, n=8000):
        return str(x or "").strip()[:n]
    valores = []
    for v in (m.get("valores") or [])[:30]:
        if not isinstance(v, dict):
            continue
        t = s(v.get("t"), 80)
        if t or s(v.get("d"), 300):
            valores.append({"ico": s(v.get("ico"), 8), "t": t, "d": s(v.get("d"), 300)})
    secoes = []
    for i, se in enumerate((m.get("secoes") or [])[:40]):
        if not isinstance(se, dict):
            continue
        titulo = s(se.get("titulo"), 120)
        tipo = "lista" if (se.get("tipo") == "lista") else "texto"
        itens = [s(x, 500) for x in (se.get("itens") or [])[:60] if s(x, 500)] if tipo == "lista" else []
        conteudo = s(se.get("conteudo"), 12000) if tipo == "texto" else ""
        if titulo or conteudo or itens:
            secoes.append({"id": s(se.get("id"), 40) or ("sec" + str(i)), "ico": s(se.get("ico"), 8),
                           "titulo": titulo, "tipo": tipo, "conteudo": conteudo, "itens": itens})
    return {"_saved": True, "missao": s(m.get("missao"), 4000), "visao": s(m.get("visao"), 4000),
            "valores": valores, "secoes": secoes}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            saved = _read(sb)
            manual = saved or dict(DEFAULT)
            manual.pop("_saved", None)
            return self._send(200, {"ok": True, "manual": manual,
                                    "is_default": saved is None,
                                    "can_edit": (user.get("lvl") or 0) >= 10})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        manual = body.get("manual")
        if not isinstance(manual, dict):
            return self._send(400, {"ok": False, "error": "manual obrigatório"})
        try:
            sb = supabase_client()
            doc = _clean(manual)
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": doc,
                                         "updated_at": datetime.now(timezone.utc).isoformat()},
                                        on_conflict="key").execute()
            try:
                audit(self, actor, "manual_cultura_save", "kv", KV_KEY, notes=None)
            except Exception:
                pass
            out = dict(doc)
            out.pop("_saved", None)
            return self._send(200, {"ok": True, "manual": out})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
