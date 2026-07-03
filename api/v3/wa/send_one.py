"""POST /api/v3/wa/send_one
Body: { phone, nome, mensagem (com {nome}/{primeiro_nome}), deal_id?, oferta?, campaign?, instance? }
Envia UMA mensagem via Evolution API e loga em wa_sends. lvl>=7 (Diretor).
O throttle/ritmo é feito pelo FRONTEND (um envio por vez com intervalo) — quem
aperta 'Disparar' é o diretor. Respeita opt-out. Retorna { ok, sent, error?, id? }.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from _wa_lib import (normalize_phone, render_template, evolution_send, cloud_api_send,  # type: ignore
                     is_opted_out, provider, first_name, fila_update)


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=5)   # v83.9: alinhado à página Campanha WA (lvl 5) — antes 7 dava 403 no botão
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            body = {}
        phone = normalize_phone(body.get("phone"))
        nome = body.get("nome") or ""
        tpl = body.get("mensagem") or ""
        if not phone or not tpl.strip():
            return self._send(400, {"ok": False, "error": "phone e mensagem são obrigatórios"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        prov = provider()
        if prov == "none":
            return self._send(200, {"ok": False, "sent": False, "paused": True,
                                    "error": "Campanha PAUSADA — aguardando a conta 360dialog (D360_API_KEY/D360_TEMPLATE no Vercel)."})

        if is_opted_out(sb, phone):
            return self._send(200, {"ok": True, "sent": False, "skipped": "opt-out"})

        texto = render_template(tpl, nome)
        if prov == "360dialog":
            # OFICIAL: envia o TEMPLATE aprovado com {{1}}=primeiro nome, {{2}}=oferta
            res = cloud_api_send(phone, None, [first_name(nome) or (nome or "tudo bem"), body.get("oferta") or ""])
        else:
            res = evolution_send(phone, texto, body.get("instance"))
        row = {
            "deal_id": body.get("deal_id"), "phone": phone, "nome": nome,
            "mensagem": texto, "oferta": body.get("oferta"),
            "campaign": body.get("campaign") or "ofertas",
            "status": "sent" if res.get("ok") else "failed",
            "erro": None if res.get("ok") else str(res.get("error"))[:300],
            "sent_by": user.get("name") or user.get("email"),
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            ins = sb.table("wa_sends").insert(row).execute().data or []
            row_id = ins[0].get("id") if ins else None
        except Exception as e:
            row_id = None
            if not res.get("ok"):
                pass  # já falhou o envio; o log é secundário
            else:
                return self._send(200, {"ok": True, "sent": True, "log_error": str(e)[:200]})

        if not res.get("ok"):
            return self._send(200, {"ok": False, "sent": False, "error": res.get("error"), "id": row_id})
        # campanha de reativação → marca 'contatado' na Fila da Mariane (v84.3)
        if body.get("deal_id") and str(body.get("campaign") or "").startswith("gw_reativacao"):
            fila_update(sb, body.get("deal_id"), "contatado", "enviado via Campanha WhatsApp",
                        por=(user.get("name") or "campanha")[:60])
        return self._send(200, {"ok": True, "sent": True, "id": row_id})
