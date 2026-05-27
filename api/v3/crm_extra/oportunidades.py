"""GET/POST/DELETE /api/v3/crm_extra/oportunidades — Oportunidades PSM (quadro)

GET:    list (lvl>=2)
POST:   upsert (lvl>=5 escrever, qualquer user pode "pegar")
DELETE: ?id=X (lvl>=5)

POST tem ação especial `action=pegar` — qualquer user assume oportunidade.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify  # type: ignore


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
            rows = sb.table("oportunidades_psm").select("*").order("criado_em", desc=True).limit(500).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "oportunidades": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = body.get("action") or "upsert"
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        if action == "pegar":
            # Qualquer user pega oportunidade aberta
            oid = body.get("id")
            if not oid: return self._send(400, {"ok": False, "error": "id obrigatório"})
            try:
                row = sb.table("oportunidades_psm").select("*").eq("id", oid).limit(1).execute().data
                if not row: return self._send(404, {"ok": False, "error": "oportunidade não encontrada"})
                row = row[0]
                if row.get("status") != "aberta":
                    return self._send(400, {"ok": False, "error": "oportunidade não está mais aberta"})
                upd = {
                    "status": "pegou",
                    "pegou_por": actor.get("id"),
                    "pegou_em": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                sb.table("oportunidades_psm").update(upd).eq("id", oid).execute()
                audit(self, actor, "oportunidade.pegar", target_type="oportunidades_psm",
                      target_id=oid, notes=f"pegou: {row.get('titulo','')[:80]}")
                return self._send(200, {"ok": True})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        # Upsert exige lvl>=5
        if (actor.get("lvl") or 0) < 5:
            return self._send(403, {"ok": False, "error": "Requer Líder (lvl>=5)"})

        titulo = (body.get("titulo") or "").strip()
        if not titulo: return self._send(400, {"ok": False, "error": "titulo obrigatório"})

        is_new = not body.get("id")
        row = {
            "id": body.get("id") or f"op_{int(datetime.now().timestamp()*1000)}",
            "titulo": titulo,
            "descricao": (body.get("descricao") or "").strip() or None,
            "tipo": body.get("tipo") or "lead",
            "origem": (body.get("origem") or "").strip() or None,
            "contato": (body.get("contato") or "").strip() or None,
            "valor_est": body.get("valor_est"),
            "prazo": body.get("prazo") or None,
            "status": body.get("status") or "aberta",
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            r = sb.table("oportunidades_psm").upsert(row).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "oportunidade.upsert", target_type="oportunidades_psm",
              target_id=row["id"], notes=titulo[:80])

        # Notifica corretores ativos quando NOVA oportunidade aberta
        if is_new and row["status"] == "aberta":
            try:
                users = sb.table("users").select("id").gte("lvl", 2).eq("status", "ativo").execute().data or []
                ids = [u["id"] for u in users if u.get("id")]
                if ids:
                    notify(ids, "oportunidade",
                           f"💡 Nova oportunidade: {titulo[:60]}",
                           (row.get("descricao") or "")[:120],
                           link="/v2/oportunidades",
                           target_type="oportunidades_psm",
                           target_id=row["id"])
            except Exception:
                pass

        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        oid = params.get("id")
        if not oid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("oportunidades_psm").delete().eq("id", oid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "oportunidade.delete", target_type="oportunidades_psm", target_id=oid)
        return self._send(200, {"ok": True})
