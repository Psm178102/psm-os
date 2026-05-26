"""POST /api/v3/kenlo/sync — placeholder framework pra Kenlo Imob

Sem token Kenlo configurado, retorna 503 com instruções.
Quando KENLO_API_TOKEN for adicionado nas env vars, este endpoint
fará a importação dos imóveis terceiros do Kenlo pra tabela imoveis.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


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
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})

        token = os.environ.get("KENLO_API_TOKEN")
        if not token:
            return self._send(503, {
                "ok": False,
                "error": "KENLO_API_TOKEN não configurado",
                "instructions": [
                    "1. Acesse o painel Kenlo Imob → API",
                    "2. Gere/copie o token de integração",
                    "3. Adicione KENLO_API_TOKEN nas env vars do Vercel (Sensitive, Production+Preview)",
                    "4. Redeploy",
                    "5. Chame este endpoint de novo",
                ],
                "framework_ready": True,
                "what_will_happen": "Importará imóveis terceiros do Kenlo → tabela imoveis com origem='terceiros'",
            })

        # TODO: implementar quando KENLO_API_TOKEN estiver disponível
        # 1. GET https://api.kenlo.com.br/v1/imoveis?token=...
        # 2. Para cada imóvel: upsert em imoveis com origem='terceiros'
        # 3. Atualizar updated_at
        # 4. Audit log

        audit(self, actor, "kenlo.sync_pending", target_type="kenlo",
              notes="endpoint chamado mas implementação real pendente do token")

        return self._send(501, {
            "ok": False,
            "error": "Implementação Kenlo pendente",
            "next_step": "Confirme a API do Kenlo (endpoint, formato) e me avise pra finalizar",
        })
