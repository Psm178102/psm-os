"""POST /api/v3/plantoes/upsert"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["data", "periodo", "corretor_id", "status", "observacoes"]


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()
    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        pid = body.get("id")
        if body.get("_delete") and pid:
            try: sb.table("plantoes").delete().eq("id", pid).execute()
            except: pass
            audit(self, actor, "plantao.delete", target_type="plantao", target_id=str(pid))
            return self._send(200, {"ok": True, "deleted": pid})
        if pid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                sb.table("plantoes").update(patch).eq("id", pid).execute()
                audit(self, actor, "plantao.update", target_type="plantao", target_id=str(pid), after=patch)
                return self._send(200, {"ok": True, "id": pid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        data = (body.get("data") or "").strip()
        if not data: return self._send(400, {"ok": False, "error": "data obrigatória"})
        row = {"criado_por": actor["id"]}
        for k in ALLOWED:
            if k in body and body[k] is not None: row[k] = body[k]
        try:
            res = sb.table("plantoes").insert(row).execute()
            inserted = (res.data or [row])[0]
            audit(self, actor, "plantao.create", target_type="plantao", target_id=str(inserted.get("id")), after=row)
            return self._send(200, {"ok": True, "item": inserted, "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
