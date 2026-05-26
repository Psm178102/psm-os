"""POST /api/v3/oo/upsert — Sócio/Gerente/Líder cria/edita reunião 1:1"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["data", "observacoes", "acoes", "proxima_data", "corretor_id", "lider_id"]


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
        iid = body.get("id")
        if body.get("_delete") and iid:
            try:
                sb.table("one_on_ones").delete().eq("id", iid).execute()
                audit(self, actor, "oo.delete", target_type="oo", target_id=str(iid))
                return self._send(200, {"ok": True, "deleted": iid})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        if iid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                sb.table("one_on_ones").update(patch).eq("id", iid).execute()
                audit(self, actor, "oo.update", target_type="oo", target_id=str(iid), after=patch)
                return self._send(200, {"ok": True, "id": iid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        # Create
        corr = (body.get("corretor_id") or "").strip()
        data = (body.get("data") or "").strip()
        if not corr or not data: return self._send(400, {"ok": False, "error": "corretor_id e data obrigatórios"})
        row = {"corretor_id": corr, "data": data, "lider_id": body.get("lider_id") or actor["id"], "criado_por": actor["id"]}
        for k in ALLOWED:
            if k in body and body[k] is not None and k not in row: row[k] = body[k]
        try:
            res = sb.table("one_on_ones").insert(row).execute()
            inserted = (res.data or [row])[0]
            audit(self, actor, "oo.create", target_type="oo", target_id=str(inserted.get("id")), after=row)
            return self._send(200, {"ok": True, "item": inserted, "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
