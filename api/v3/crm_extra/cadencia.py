"""GET/POST/DELETE /api/v3/crm_extra/cadencia — Cadências de Follow-up"""
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
            rows = sb.table("cadencia_psm").select("*").order("criado_em", desc=True).limit(100).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "cadencias": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        nome = (body.get("nome") or "").strip()
        if not nome: return self._send(400, {"ok": False, "error": "nome obrigatório"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        row = {
            "id": body.get("id") or f"cad_{int(datetime.now().timestamp()*1000)}",
            "nome": nome,
            "publico": (body.get("publico") or "").strip() or None,
            "passos": body.get("passos") or [],
            "ativa": bool(body.get("ativa", True)),
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            r = sb.table("cadencia_psm").upsert(row).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "cadencia.upsert", target_type="cadencia_psm", target_id=row["id"], notes=nome[:80])
        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        cid = params.get("id")
        if not cid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("cadencia_psm").delete().eq("id", cid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "cadencia.delete", target_type="cadencia_psm", target_id=cid)
        return self._send(200, {"ok": True})
