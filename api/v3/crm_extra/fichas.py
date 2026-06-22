"""GET/POST/DELETE /api/v3/crm_extra/fichas — Fichas de Proposta"""
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
        # Corretor vê só as próprias; lvl>=5 vê todas
        try:
            q = sb.table("fichas_propostas").select("*").order("criado_em", desc=True).limit(500)
            if (actor.get("lvl") or 0) < 5:
                q = q.eq("corretor_id", actor.get("id"))
            rows = q.execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "fichas": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        cliente = (body.get("cliente") or "").strip()
        if not cliente: return self._send(400, {"ok": False, "error": "cliente obrigatório"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        # Corretor só edita as próprias
        if body.get("id") and (actor.get("lvl") or 0) < 5:
            try:
                ex = sb.table("fichas_propostas").select("corretor_id").eq("id", body["id"]).limit(1).execute().data
                if ex and ex[0].get("corretor_id") != actor.get("id"):
                    return self._send(403, {"ok": False, "error": "Sem permissão pra editar esta ficha"})
            except Exception as e:
                # fail-closed: se a checagem de dono falhar, NEGA (não cai no write)
                return self._send(503, {"ok": False, "error": f"checagem de permissão indisponível: {e}"})

        row = {
            "id": body.get("id") or f"fic_{int(datetime.now().timestamp()*1000)}",
            "cliente": cliente,
            "cliente_doc": (body.get("cliente_doc") or "").strip() or None,
            "cliente_contato": (body.get("cliente_contato") or "").strip() or None,
            "imovel": (body.get("imovel") or "").strip() or None,
            "valor_imovel": body.get("valor_imovel"),
            "valor_proposta": body.get("valor_proposta"),
            "forma_pagto": (body.get("forma_pagto") or "").strip() or None,
            "observacoes": (body.get("observacoes") or "").strip() or None,
            "status": body.get("status") or "em_analise",
            "anexo_url": (body.get("anexo_url") or "").strip() or None,
            "corretor_id": body.get("corretor_id") or actor.get("id"),
            "data_envio": body.get("data_envio"),
            "data_resposta": body.get("data_resposta"),
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            r = sb.table("fichas_propostas").upsert(row).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "ficha.upsert", target_type="fichas_propostas",
              target_id=row["id"], notes=f"{cliente[:40]} · {row['status']}")
        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        fid = params.get("id")
        if not fid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("fichas_propostas").delete().eq("id", fid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "ficha.delete", target_type="fichas_propostas", target_id=fid)
        return self._send(200, {"ok": True})
