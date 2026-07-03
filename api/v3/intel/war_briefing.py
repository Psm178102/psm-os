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
        ordens = {}
        try:
            rows = sb.table("shared_kv").select("value").eq("key", "war_ordens").limit(1).execute().data or []
            ordens = rows[0]["value"] if rows else {}
            if isinstance(ordens, str):
                ordens = json.loads(ordens)
        except Exception:
            ordens = {}
        return self._send(200, {"ok": True, "briefings": briefings, "pending": pending,
                                "facts_atual": facts, "ordens": ordens,
                                "hint": ("Rode supabase/sprint9_20_war_briefings.sql pra salvar o histórico."
                                         if pending else None)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            body = {}
        if (body.get("action") or "") == "toggle_ordem":   # checklist das ordens (v84.6)
            try:
                i = int(body.get("i"))
                rows = sb.table("shared_kv").select("value").eq("key", "war_ordens").limit(1).execute().data or []
                ordens = rows[0]["value"] if rows else {}
                if isinstance(ordens, str):
                    ordens = json.loads(ordens)
                ordens["itens"][i]["feito"] = not ordens["itens"][i].get("feito")
                sb.table("shared_kv").upsert({"key": "war_ordens", "value": ordens,
                                              "updated_at": datetime.now(timezone.utc).isoformat()},
                                             on_conflict="key").execute()
                audit(self, actor, "intel.ordem_toggle", target_type="shared_kv", target_id=str(i))
                return self._send(200, {"ok": True, "ordens": ordens})
            except Exception as e:
                return self._send(400, {"ok": False, "error": str(e)})
        if (actor.get("lvl") or 0) < 7:
            return self._send(403, {"ok": False, "error": "gerar briefing requer lvl 7+"})
        try:
            out = generate_and_store(sb, actor_id=actor.get("id"))
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)})
        audit(self, actor, "intel.war_briefing", target_type="war_briefings",
              target_id="manual", notes=f"saved={out.get('saved')} model={out.get('model')}")
        return self._send(200, {"ok": True, **out})
