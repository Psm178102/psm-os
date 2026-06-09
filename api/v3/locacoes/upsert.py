"""POST /api/v3/locacoes/upsert — Sócio/Gerente."""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["endereco", "bairro", "cidade", "codigo", "proprietario_nome", "proprietario_contato",
           "inquilino_nome", "inquilino_contato", "valor_aluguel", "valor_condominio",
           "valor_iptu", "taxa_adm_pct", "dia_vencimento", "data_inicio_contrato", "data_fim_contrato",
           "status", "responsavel_id", "observacoes"]


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
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        lid = body.get("id")
        if body.get("_delete") and lid:
            try:
                cur = sb.table("locacoes").select("*").eq("id", lid).limit(1).execute().data or []
                if cur:
                    sb.table("locacoes").delete().eq("id", lid).execute()
                    audit(self, actor, "locacao.delete", target_type="locacao", target_id=lid, before=cur[0])
                return self._send(200, {"ok": True, "deleted": lid})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        if lid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                cur = sb.table("locacoes").select("*").eq("id", lid).limit(1).execute().data or []
                if not cur: return self._send(404, {"ok": False, "error": "não encontrado"})
                sb.table("locacoes").update(patch).eq("id", lid).execute()
                audit(self, actor, "locacao.update", target_type="locacao", target_id=lid,
                      before={k: cur[0].get(k) for k in patch}, after=patch)
                return self._send(200, {"ok": True, "id": lid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        endereco = (body.get("endereco") or "").strip()
        if not endereco: return self._send(400, {"ok": False, "error": "endereco obrigatório"})
        new_id = "lo_" + uuid.uuid4().hex[:12]
        row = {"id": new_id, "criado_por": actor["id"]}
        for k in ALLOWED:
            if k in body and body[k] is not None: row[k] = body[k]
        try:
            res = sb.table("locacoes").insert(row).execute()
            audit(self, actor, "locacao.create", target_type="locacao", target_id=new_id, after=row)
            return self._send(200, {"ok": True, "locacao": (res.data or [row])[0], "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
