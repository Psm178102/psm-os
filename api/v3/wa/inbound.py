"""POST /api/v3/wa/inbound  { phone, text }
Chamado pelo webhook do WhatsApp (Evolution) a cada mensagem RECEBIDA. Casa o telefone
com um envio recente da campanha (wa_sends) e registra a resposta:
  • 'sim'/'quero'/... → marca is_sim=true (vira QUENTE pro Paulo atender)
  • 'sair'/'parar'/... → adiciona em wa_optout (não recebe mais)
Sem JWT (server-to-server); só ATUALIZA linhas existentes por telefone — baixo risco.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, re
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
from _wa_lib import normalize_phone, is_sim  # type: ignore

_OPTOUT_RE = re.compile(r"^(sair|parar|pare|remover|descadastr|n[aã]o quero|stop|cancelar)\b", re.I)


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_POST(self):
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            body = {}
        phone = normalize_phone(body.get("phone"))
        text = (body.get("text") or "").strip()
        if not phone:
            return self._send(400, {"ok": False, "error": "phone obrigatório"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        now = datetime.now(timezone.utc)
        sim = is_sim(text)
        optout = bool(_OPTOUT_RE.match(text or ""))

        # acha o envio mais recente (últimos 21 dias) pra esse telefone
        try:
            since = (now - timedelta(days=21)).isoformat()
            rows = sb.table("wa_sends").select("id").eq("phone", phone).gte("sent_at", since) \
                .order("sent_at", desc=True).limit(1).execute().data or []
        except Exception as e:
            return self._send(200, {"ok": True, "matched": False, "error": str(e)[:160]})

        matched = False
        if rows:
            matched = True
            try:
                sb.table("wa_sends").update({
                    "reply_text": text[:500], "is_sim": sim, "status": "replied",
                    "replied_at": now.isoformat(),
                }).eq("id", rows[0]["id"]).execute()
            except Exception:
                pass

        if optout:
            try:
                sb.table("wa_optout").upsert({"phone": phone, "motivo": text[:200]}, on_conflict="phone").execute()
            except Exception:
                pass

        return self._send(200, {"ok": True, "matched": matched, "is_sim": sim, "optout": optout})
