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
# v84.3 — plano REAL decidido com o Paulo: COEXISTÊNCIA no número da RECEPÇÃO
# (nunca bloqueado): o número entra na API oficial E continua no app do iPhone da Mariane.
CHECKLIST = [
    "1. Conta Meta Business já existe (a dos anúncios) — conferir se está verificada com o CNPJ da PSM.",
    "2. Criar conta na 360dialog (hub.360dialog.com) e escolher COEXISTÊNCIA: conectar o NÚMERO DA RECEPÇÃO escaneando o QR no WhatsApp Business do iPhone (o app continua funcionando normal).",
    "3. Submeter o template de reativação (abaixo) → aprovação da Meta (horas a ~1 dia).",
    "4. No Vercel, setar: D360_API_KEY + D360_TEMPLATE (nome do template aprovado) — e a campanha DESTRAVA sozinha.",
    "5. Apontar o webhook da 360dialog pra /api/v3/wa/cloud_webhook (verify token = WA_CLOUD_VERIFY_TOKEN) — respostas viram 🔥 Quentes e marcam a Fila.",
    "6. RITMO: começar com 50/dia e subir (250 → 1.000) conforme a nota de qualidade no WhatsApp Manager — número novo na API tem teto de aquecimento da própria Meta.",
]

TEMPLATE_REATIVACAO = (
    "Olá {{1}}, tudo bem? Aqui é a Mariane, da PSM Imóveis 😊 "
    "Você falou com a gente sobre imóveis um tempo atrás e estou revisando os atendimentos. "
    "Ainda tem interesse em comprar? Se preferir não receber mais mensagens, responda SAIR."
)


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
            "template_reativacao": TEMPLATE_REATIVACAO,
            "checklist": CHECKLIST,
        })
