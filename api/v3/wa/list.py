"""GET /api/v3/wa/list — status da campanha WhatsApp.
Retorna: enviados hoje (pro teto diário), últimos envios, e os QUENTES (responderam 'sim').
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        out = {"ok": True, "enviados_hoje": 0, "quentes": [], "recentes": [], "pending": False}
        try:
            hoje = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
            try:
                c = sb.table("wa_sends").select("id", count="exact").eq("status", "sent").gte("sent_at", hoje).execute()
                out["enviados_hoje"] = c.count or 0
            except Exception:
                out["enviados_hoje"] = 0
            out["quentes"] = sb.table("wa_sends").select("id,nome,phone,oferta,reply_text,replied_at,sent_at") \
                .eq("is_sim", True).order("replied_at", desc=True).limit(100).execute().data or []
            out["recentes"] = sb.table("wa_sends").select("id,nome,phone,status,is_sim,sent_at") \
                .order("sent_at", desc=True).limit(50).execute().data or []
        except Exception as e:
            # tabela ainda não criada → orienta
            return self._send(200, {"ok": True, "pending": True, "error": str(e)[:200],
                                    "enviados_hoje": 0, "quentes": [], "recentes": []})
        return self._send(200, out)
