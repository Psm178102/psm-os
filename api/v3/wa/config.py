"""GET /api/v3/wa/config — estado da Campanha WhatsApp (provider/pausa + template + checklist).
Diz ao frontend se pode disparar (provider != none) ou está PAUSADA aguardando setup.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError  # type: ignore
from _wa_lib import provider  # type: ignore

TEMPLATE_TEXTO = (
    "Oi {{1}}! Aqui é da PSM Imóveis 🏠\n"
    "Apareceu uma oportunidade que combina com o que você buscava: {{2}}.\n"
    "Quer que eu te mande os detalhes e as fotos?\n"
    "[ Quero ver 👀 ]   [ Agora não ]"
)
CHECKLIST = [
    "1. Conseguir um NÚMERO dedicado (chip novo) — vira API-only, sai do app comum.",
    "2. Criar/verificar a conta Meta Business (business.facebook.com) com o CNPJ da PSM.",
    "3. Criar conta na 360dialog (hub.360dialog.com), conectar o número → pegar a API KEY.",
    "4. Submeter o template (texto acima) na 360dialog → aguardar aprovação da Meta (~1-2 dias).",
    "5. No Vercel, setar: D360_API_KEY, D360_TEMPLATE (nome do template aprovado), D360_BASE_URL (opcional).",
    "6. Apontar o webhook da 360dialog para /api/v3/wa/cloud_webhook (verify token = WA_CLOUD_VERIFY_TOKEN).",
]


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        prov = provider()
        return self._send(200, {
            "ok": True,
            "provider": prov,
            "ready": prov != "none",
            "pausada": prov == "none",
            "oficial": prov == "360dialog",
            "template_env": (os.environ.get("D360_TEMPLATE", "") or None),
            "template_texto": TEMPLATE_TEXTO,
            "checklist": CHECKLIST,
        })
