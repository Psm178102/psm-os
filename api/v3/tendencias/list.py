"""GET/POST/DELETE /api/v3/tendencias/list — Tendências de Mercado

GET:    list (lvl>=2)
POST:   upsert (lvl>=5 Líder+)
DELETE: ?id=X (lvl>=5)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("tendencias").select("*").order("data", desc=True).limit(500).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "tendencias": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        titulo = (body.get("titulo") or "").strip()
        if not titulo: return self._send(400, {"ok": False, "error": "titulo obrigatório"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        row = {
            "id": body.get("id") or f"tend_{int(datetime.now().timestamp()*1000)}",
            "titulo": titulo,
            "categoria": body.get("categoria") or "Geral",
            "direcao": body.get("direcao") or "estavel",
            "impacto": body.get("impacto") or "medio",
            "descricao": (body.get("descricao") or "").strip() or None,
            "data": body.get("data") or datetime.now(timezone.utc).date().isoformat(),
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            r = sb.table("tendencias").upsert(row).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "tendencia.upsert", target_type="tendencias",
              target_id=row["id"], notes=titulo[:80])
        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        tid = params.get("id")
        if not tid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("tendencias").delete().eq("id", tid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "tendencia.delete", target_type="tendencias", target_id=tid)
        return self._send(200, {"ok": True})
