"""
GET /api/v3/crm/funnels
Header: Authorization: Bearer <token>

Lista os pipelines RD CRM configurados no Postgres (rd_pipelines + rd_stages).
Sócio/Gerente vê todos; Líder vê só os do time; Corretor vê os ativos não excluídos.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            pipes = sb.table("rd_pipelines").select("*").execute().data or []
            stages = sb.table("rd_stages").select("*").execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Agrupa stages por pipeline
        by_pipe = {}
        for s in stages:
            pid = s.get("pipeline_id") or s.get("rd_pipeline_id") or s.get("pipeline")
            if not pid: continue
            by_pipe.setdefault(pid, []).append(s)

        # Filtra por role (Corretor/Líder não vê pipelines excluídos)
        is_socio = (user.get("lvl") or 0) >= 7
        if not is_socio:
            pipes = [p for p in pipes if not p.get("excluded_from_metrics")]

        out = []
        for p in pipes:
            pid = p.get("id") or p.get("external_id")
            st = by_pipe.get(pid) or by_pipe.get(p.get("external_id")) or []
            # Ordena stages
            try:
                st.sort(key=lambda s: int(s.get("position") or s.get("order") or 0))
            except Exception:
                pass
            out.append({
                "id": pid,
                "name": p.get("name"),
                "external_id": p.get("external_id"),
                "active": p.get("active") is not False,
                "excluded": bool(p.get("excluded_from_metrics")),
                "stages": [{
                    "id":   s.get("id") or s.get("external_id"),
                    "name": s.get("name"),
                    "position": s.get("position") or s.get("order"),
                    "is_won":  bool(s.get("is_won") or (s.get("nickname") == "won")),
                    "is_lost": bool(s.get("is_lost") or (s.get("nickname") == "lost")),
                } for s in st],
            })

        return self._send(200, {
            "ok": True,
            "count": len(out),
            "funnels": out,
            "user_scope": "socio" if is_socio else "filtered",
        })
