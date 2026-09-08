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
# (nunca bloqueado): o número entra na API oficial E continua no app do celular da recepção.
# v86.81 — decisão do Paulo 28/ago/2026: SEM BSP. Cloud API direto da Meta.
# v87.50 — o provider meta_cloud finalmente chega ao main (estava só local desde 28/ago).
CHECKLIST = [
    "1. No Gerenciador do WhatsApp (business.facebook.com/wa/manage), na conta do número que vai operar: aceitar os Termos da Plataforma do WhatsApp Business (banner) e anexar forma de pagamento (Configurações de pagamento).",
    "2. No app da Meta (developers.facebook.com → app PSM OS Dashboard): produto WhatsApp adicionado, e em Configurações → Básico copiar o Chave Secreta do App → Vercel META_APP_SECRET (valida a assinatura do webhook).",
    "3. Business Settings → Usuários do sistema: usuário de sistema Admin com acesso ao app e à conta do WhatsApp; gerar token PERMANENTE com whatsapp_business_messaging + whatsapp_business_management → Vercel WA_CLOUD_TOKEN.",
    "4. Vercel: WA_PHONE_ID = id do número no Gerenciador (o da recepção é 292628543939705) + WA_CLOUD_VERIFY_TOKEN = uma frase secreta qualquer.",
    "5. No app → WhatsApp → Configuração → Webhook: URL https://www.housepsm.com.br/api/v3/wa/cloud_webhook, token de verificação = WA_CLOUD_VERIFY_TOKEN, assinar o campo 'messages'.",
    "6. Gerenciador do WhatsApp → Modelos de mensagem: criar o template de reativação (abaixo, categoria Marketing, idioma pt_BR, {{1}} = nome) → após aprovação, Vercel WA_TEMPLATE = nome do template. A campanha DESTRAVA sozinha.",
    "7. RITMO: começar com 50/dia e subir (250 → 1.000) conforme a classificação de qualidade no Gerenciador — número novo na API tem teto de aquecimento da própria Meta.",
]

TEMPLATE_REATIVACAO = (
    "Olá {{1}}, tudo bem? Aqui é a Rafaela, da PSM Imóveis 😊 "
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
            "oficial": prov in ("meta_cloud", "360dialog"),
            "template_env": (os.environ.get("WA_TEMPLATE", "") or os.environ.get("D360_TEMPLATE", "") or None),
            # o que falta pra destravar — a página mostra sem expor valores
            "envs": {k: bool((os.environ.get(k) or "").strip()) for k in
                     ("WA_CLOUD_TOKEN", "META_WA_TOKEN", "WA_PHONE_ID", "WA_TEMPLATE", "WA_CLOUD_VERIFY_TOKEN", "META_APP_SECRET")},
            "template_texto": TEMPLATE_TEXTO,
            "template_reativacao": TEMPLATE_REATIVACAO,
            "checklist": CHECKLIST,
        })
