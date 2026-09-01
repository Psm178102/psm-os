"""
POST /api/v3/sol/config — atualiza uma chave de sol_config
Body: { "chave": "autonomia_padrao", "valor": { "modo": "copiloto" | "autonoma" } }
Header: Authorization: Bearer <token> — SÓ SÓCIO (lvl >= 10).

Chaves permitidas (whitelist — nada além disso entra):
  - autonomia_padrao  → {"modo": "copiloto" | "autonoma"}
  - persona_versao    → {"versao": "<texto curto>"}
(numero_whatsapp NÃO é editável por aqui de propósito: número/phone_id/token
 são setup de infra — mudam no Supabase/Vercel, não num toggle de tela.)
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

CHAVES_OK = ("autonomia_padrao", "persona_versao")
MODOS_OK = ("copiloto", "autonoma")


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        chave = str(body.get("chave") or "").strip()
        valor = body.get("valor")
        if chave not in CHAVES_OK:
            return self._send(400, {"ok": False, "error": f"chave inválida (permitidas: {', '.join(CHAVES_OK)})"})
        if not isinstance(valor, dict):
            return self._send(400, {"ok": False, "error": "valor precisa ser um objeto JSON"})

        # validação por chave
        if chave == "autonomia_padrao":
            modo = str(valor.get("modo") or "").strip().lower()
            if modo not in MODOS_OK:
                return self._send(400, {"ok": False, "error": f"modo inválido (permitidos: {', '.join(MODOS_OK)})"})
            valor = {"modo": modo}
        elif chave == "persona_versao":
            versao = str(valor.get("versao") or "").strip()
            if not versao or len(versao) > 80:
                return self._send(400, {"ok": False, "error": "versao obrigatória (até 80 chars)"})
            valor = {"versao": versao}

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            antes = sb.table("sol_config").select("valor").eq("chave", chave).limit(1).execute().data or []
            row = {
                "chave": chave,
                "valor": valor,
                "atualizado_em": datetime.now(timezone.utc).isoformat(),
            }
            sb.table("sol_config").upsert(row, on_conflict="chave").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "sol.config_update", target_type="sol_config", target_id=chave,
              before=(antes[0].get("valor") if antes else None), after=valor)
        return self._send(200, {"ok": True, "chave": chave, "valor": valor})
