"""POST /api/v3/imoveis/upsert — body {id?, ..., _delete?}"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["codigo","tipo","endereco","bairro","cidade","valor","area_m2","dormitorios","vagas",
           "descricao","link_fotos","captador_id","origem","status"]


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
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        iid = body.get("id")
        is_socio = (actor.get("lvl") or 0) >= 7
        if body.get("_delete") and iid:
            try:
                cur = sb.table("imoveis").select("*").eq("id", iid).limit(1).execute().data or []
                if cur and (is_socio or cur[0].get("captador_id") == actor["id"] or cur[0].get("criado_por") == actor["id"]):
                    sb.table("imoveis").delete().eq("id", iid).execute()
                    audit(self, actor, "imovel.delete", target_type="imovel", target_id=iid, before=cur[0])
                    return self._send(200, {"ok": True, "deleted": iid})
                return self._send(403, {"ok": False, "error": "sem permissão"})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        if iid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                cur = sb.table("imoveis").select("*").eq("id", iid).limit(1).execute().data or []
                if not cur: return self._send(404, {"ok": False, "error": "não encontrado"})
                if not is_socio and cur[0].get("captador_id") != actor["id"] and cur[0].get("criado_por") != actor["id"]:
                    return self._send(403, {"ok": False, "error": "apenas captador/criador/Sócio"})
                sb.table("imoveis").update(patch).eq("id", iid).execute()
                audit(self, actor, "imovel.update", target_type="imovel", target_id=iid, before={k: cur[0].get(k) for k in patch}, after=patch)
                return self._send(200, {"ok": True, "id": iid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        endereco = (body.get("endereco") or "").strip()
        if not endereco: return self._send(400, {"ok": False, "error": "endereco obrigatório"})
        new_id = "im_" + uuid.uuid4().hex[:12]
        row = {"id": new_id, "criado_por": actor["id"], "captador_id": body.get("captador_id") or actor["id"]}
        for k in ALLOWED:
            if k in body and body[k] is not None: row[k] = body[k]
        try:
            res = sb.table("imoveis").insert(row).execute()
            audit(self, actor, "imovel.create", target_type="imovel", target_id=new_id, after=row)
            return self._send(200, {"ok": True, "imovel": (res.data or [row])[0], "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
