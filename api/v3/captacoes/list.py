"""GET /api/v3/captacoes/list[?captador_id=&since=YYYY-MM-DD]
Relatório de captações = agregação dos imoveis por captador_id.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from collections import defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()
    def do_GET(self):
        try: user = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        since = params.get("since") or (date.today() - timedelta(days=90)).isoformat()
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            q = sb.table("imoveis").select("id,codigo,endereco,valor,status,captador_id,created_at").gte("created_at", since).limit(2000)
            if params.get("captador_id"): q = q.eq("captador_id", params["captador_id"])
            rows = q.execute().data or []
            # Users for enrichment
            uids = list({r.get("captador_id") for r in rows if r.get("captador_id")})
            users_by_id = {}
            if uids:
                u = sb.table("users").select("id,name,ini,color,team").in_("id", uids).execute().data or []
                users_by_id = {x["id"]: x for x in u}
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Agregação por captador
        by_cap = defaultdict(lambda: {"total": 0, "valor": 0.0, "disponiveis": 0, "vendidos": 0})
        for r in rows:
            cid = r.get("captador_id")
            if not cid: continue
            b = by_cap[cid]
            b["total"] += 1
            b["valor"] += float(r.get("valor") or 0)
            s = r.get("status") or ""
            if s == "disponivel": b["disponiveis"] += 1
            elif s == "vendido": b["vendidos"] += 1

        ranking = sorted(
            [{"captador_id": k, "user": users_by_id.get(k), **v} for k, v in by_cap.items()],
            key=lambda x: -x["total"]
        )
        return self._send(200, {
            "ok": True, "since": since, "count": len(rows),
            "ranking": ranking, "imoveis": rows[:200],
        })
