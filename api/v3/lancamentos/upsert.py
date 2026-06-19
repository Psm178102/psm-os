"""POST /api/v3/lancamentos/upsert — body com {id?, nome, ..., _delete?}. Sócio/Gerente."""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["nome", "construtora", "data_lancamento", "etapa", "comissao_pct",
           "vgv_total", "unidades_total", "unidades_vendidas", "status",
           "responsavel_id", "descricao", "link_pasta", "marca"]


def _missing_marca(err):
    """A coluna 'marca' pode ainda não existir no banco (antes do SQL de migração).
    Detecta o erro p/ degradar com elegância: salva sem marca em vez de quebrar."""
    s = str(err).lower()
    return "marca" in s and ("column" in s or "schema cache" in s or "pgrst204" in s or "does not exist" in s)


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
                cur = sb.table("lancamentos").select("*").eq("id", lid).limit(1).execute().data or []
                if cur:
                    sb.table("lancamentos").delete().eq("id", lid).execute()
                    audit(self, actor, "lancamento.delete", target_type="lancamento", target_id=lid, before=cur[0])
                return self._send(200, {"ok": True, "deleted": lid})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        if lid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                cur = sb.table("lancamentos").select("*").eq("id", lid).limit(1).execute().data or []
                if not cur: return self._send(404, {"ok": False, "error": "não encontrado"})
                try:
                    sb.table("lancamentos").update(patch).eq("id", lid).execute()
                except Exception as e1:
                    if "marca" in patch and _missing_marca(e1):
                        patch.pop("marca", None)
                        sb.table("lancamentos").update(patch).eq("id", lid).execute()
                    else:
                        raise
                audit(self, actor, "lancamento.update", target_type="lancamento", target_id=lid,
                      before={k: cur[0].get(k) for k in patch}, after=patch)
                return self._send(200, {"ok": True, "id": lid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        nome = (body.get("nome") or "").strip()
        if not nome: return self._send(400, {"ok": False, "error": "nome obrigatório"})
        new_id = "lc_" + uuid.uuid4().hex[:12]
        row = {"id": new_id, "criado_por": actor["id"]}
        for k in ALLOWED:
            if k in body and body[k] is not None: row[k] = body[k]
        try:
            try:
                res = sb.table("lancamentos").insert(row).execute()
            except Exception as e1:
                if "marca" in row and _missing_marca(e1):
                    row.pop("marca", None)
                    res = sb.table("lancamentos").insert(row).execute()
                else:
                    raise
            audit(self, actor, "lancamento.create", target_type="lancamento", target_id=new_id, after=row)
            return self._send(200, {"ok": True, "lancamento": (res.data or [row])[0], "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
