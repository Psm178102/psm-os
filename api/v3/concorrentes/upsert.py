"""POST /api/v3/concorrentes/upsert"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["nome", "segmento", "anuncios_count", "link", "observacoes", "ultima_atualizacao"]


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
        cid = body.get("id")
        if body.get("_delete") and cid:
            try:
                sb.table("concorrentes").delete().eq("id", cid).execute()
                audit(self, actor, "concorrente.delete", target_type="concorrente", target_id=str(cid))
                return self._send(200, {"ok": True, "deleted": cid})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        if cid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                sb.table("concorrentes").update(patch).eq("id", cid).execute()
                audit(self, actor, "concorrente.update", target_type="concorrente", target_id=str(cid), after=patch)
                return self._send(200, {"ok": True, "id": cid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        nome = (body.get("nome") or "").strip()
        if not nome: return self._send(400, {"ok": False, "error": "nome obrigatório"})
        row = {"criado_por": actor["id"], "ultima_atualizacao": datetime.now(timezone.utc).isoformat()}
        for k in ALLOWED:
            if k in body and body[k] is not None: row[k] = body[k]
        try:
            res = sb.table("concorrentes").insert(row).execute()
            inserted = (res.data or [row])[0]
            audit(self, actor, "concorrente.create", target_type="concorrente", target_id=str(inserted.get("id")), after=row)
            return self._send(200, {"ok": True, "concorrente": inserted, "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
