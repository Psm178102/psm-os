"""
GET  /api/v3/intel/war_briefing   → últimos briefings salvos + fatos atuais
POST /api/v3/intel/war_briefing   → gera um briefing AGORA (compila + IA + salva)
Header: Authorization: Bearer <token>   (Gerência lvl>=7)

Briefing de Guerra — o boletim do comandante. Compila concorrência + mídia +
vendas e a IA escreve a leitura estratégica da semana. Tudo dado real.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore
from _briefing_lib import compile_facts, generate_and_store  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        briefings, pending = [], False
        try:
            briefings = (sb.table("war_briefings").select("*")
                         .order("created_at", desc=True).limit(12).execute().data or [])
        except Exception:
            pending = True
        today = datetime.now(timezone.utc).date()
        try:
            facts = compile_facts(sb, today)
        except Exception as e:
            facts = {"erro": str(e)}
        return self._send(200, {"ok": True, "briefings": briefings, "pending": pending,
                                "facts_atual": facts,
                                "hint": ("Rode supabase/sprint9_20_war_briefings.sql pra salvar o histórico."
                                         if pending else None)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            out = generate_and_store(sb, actor_id=actor.get("id"))
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)})
        audit(self, actor, "intel.war_briefing", target_type="war_briefings",
              target_id="manual", notes=f"saved={out.get('saved')} model={out.get('model')}")
        return self._send(200, {"ok": True, **out})
