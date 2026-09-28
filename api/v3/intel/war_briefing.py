"""
GET  /api/v3/intel/war_briefing   → últimos briefings salvos + fatos atuais
POST /api/v3/intel/war_briefing   → gera um briefing AGORA (compila + IA + salva)
POST {action:'toggle_ordem', i}                     → marca/desmarca ordem feita (fecha a tarefa ligada)
POST {action:'delegar', i, tipo, alvo?, prazo?}     → tipo socio|usuario|agente (v88.82)
Header: Authorization: Bearer <token>   (SÓ sócio, lvl 10 — v88.82)

Briefing de Guerra — o boletim do comandante. Compila concorrência + mídia +
vendas e a IA escreve a leitura estratégica da semana. Tudo dado real.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit, hoje_brt  # type: ignore
from _briefing_lib import compile_facts, generate_and_store  # type: ignore
import _ordens_lib as OL  # type: ignore


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
            require_user(self, min_lvl=10)   # v88.82: seção Inteligência = só sócio
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
        today = hoje_brt()  # v86.68: hoje BRT
        try:
            facts = compile_facts(sb, today)
        except Exception as e:
            facts = {"erro": str(e)}
        ordens = {}
        try:
            ordens = OL.sincronizar_status(sb, OL.ler(sb))
        except Exception:
            ordens = {}
        try:
            usuarios = OL.usuarios_ativos(sb)
        except Exception:
            usuarios = []
        return self._send(200, {"ok": True, "briefings": briefings, "pending": pending,
                                "facts_atual": facts, "ordens": ordens,
                                "delegaveis": {"usuarios": usuarios,
                                               "agentes": [{"id": a, "nome": n} for a, n in OL.AGENTES]},
                                "hint": ("Rode supabase/sprint9_20_war_briefings.sql pra salvar o histórico."
                                         if pending else None)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # v88.82: só sócio (ordens e geração)
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
        acao = body.get("action") or ""
        if acao == "toggle_ordem":   # checklist das ordens (v84.6); v88.82 fecha/reabre a tarefa ligada
            try:
                ordens = OL.marcar_feita(sb, int(body.get("i")))
                audit(self, actor, "intel.ordem_toggle", target_type="shared_kv", target_id=str(body.get("i")))
                return self._send(200, {"ok": True, "ordens": ordens})
            except Exception as e:
                return self._send(400, {"ok": False, "error": str(e)})
        if acao == "delegar":   # v88.82: dono padrão = sócio; delega a usuário ou agente de IA
            try:
                ordens = OL.delegar(sb, actor, int(body.get("i")), str(body.get("tipo") or ""),
                                    str(body.get("alvo") or ""), (str(body.get("prazo")) if body.get("prazo") else None))
            except (ValueError, IndexError) as e:
                return self._send(400, {"ok": False, "error": str(e)})
            except Exception as e:
                return self._send(502, {"ok": False, "error": str(e)[:300]})
            audit(self, actor, "intel.ordem_delegar", target_type="shared_kv", target_id=str(body.get("i")),
                  notes=f"{body.get('tipo')}:{body.get('alvo') or 'eu'}")
            return self._send(200, {"ok": True, "ordens": ordens})
        try:
            out = generate_and_store(sb, actor_id=actor.get("id"))
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)})
        audit(self, actor, "intel.war_briefing", target_type="war_briefings",
              target_id="manual", notes=f"saved={out.get('saved')} model={out.get('model')}")
        return self._send(200, {"ok": True, **out})
