"""POST /api/v3/oo/upsert — Sócio/Gerente/Líder cria/edita reunião 1:1"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, lvl_of  # type: ignore

def _pode_gerir(sb, actor, target_id):
    """v88.52: quem pode ver/editar dados de gestão (perfil, 1:1) de outra pessoa.
    Sócio (lvl 10) → todos. Própria pessoa → sim. Gestor (lvl ≥ 5) → só alguém da PRÓPRIA equipe
    com nível MENOR que o dele. Antes qualquer lvl 5 lia/editava perfil e 1:1 de qualquer um,
    inclusive de sócios e de outras equipes."""
    lvl = actor.get("lvl") or 0
    if not target_id or target_id == actor.get("id") or lvl >= 10:
        return True
    if lvl < 5:
        return False
    try:
        r = sb.table("users").select("team,role").eq("id", target_id).limit(1).execute().data or []
    except Exception:
        return False
    if not r:
        return False
    alvo = r[0]
    mesma_equipe = (alvo.get("team") or "").strip().lower() == (actor.get("team") or "").strip().lower()
    return mesma_equipe and lvl_of(alvo.get("role")) < lvl



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
        # v88.52: 1:1 existente → confere o corretor REAL do registro (antes qualquer lvl 5 editava/apagava qualquer 1:1)
        if iid:
            try:
                ex = sb.table("one_on_ones").select("corretor_id").eq("id", iid).limit(1).execute().data or []
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            if not ex:
                return self._send(404, {"ok": False, "error": "1:1 não encontrado"})
            if not _pode_gerir(sb, actor, ex[0].get("corretor_id")):
                return self._send(403, {"ok": False, "error": "1:1 de outra equipe"})
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
        if not _pode_gerir(sb, actor, corr):
            return self._send(403, {"ok": False, "error": "1:1 só da própria equipe"})
        row = {"corretor_id": corr, "data": data, "lider_id": body.get("lider_id") or actor["id"], "criado_por": actor["id"]}
        for k in ALLOWED:
            if k in body and body[k] is not None and k not in row: row[k] = body[k]
        try:
            res = sb.table("one_on_ones").insert(row).execute()
            inserted = (res.data or [row])[0]
            audit(self, actor, "oo.create", target_type="oo", target_id=str(inserted.get("id")), after=row)
            return self._send(200, {"ok": True, "item": inserted, "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
