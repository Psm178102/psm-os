"""
POST /api/v3/metas/upsert
Body: { corretor_id, ano, mes, meta_vgv?, meta_vendas?, meta_pontos?, observacoes? }
Header: Authorization: Bearer <token>

Cria ou atualiza meta (UNIQUE corretor+ano+mes).
Requer Sócio/Gerente (lvl >= 7).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        corretor_id = (body.get("corretor_id") or "").strip()
        try:
            ano = int(body.get("ano"))
            mes = int(body.get("mes"))
        except Exception:
            return self._send(400, {"ok": False, "error": "ano e mes obrigatórios (inteiros)"})

        if not corretor_id or not (1 <= mes <= 12) or not (2020 <= ano <= 2100):
            return self._send(400, {"ok": False, "error": "corretor_id, ano (2020-2100), mes (1-12) obrigatórios"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # Confere se user existe
        try:
            u = sb.table("users").select("id,name").eq("id", corretor_id).limit(1).execute().data or []
            if not u:
                return self._send(404, {"ok": False, "error": "corretor não encontrado"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        payload = {
            "corretor_id": corretor_id,
            "ano": ano,
            "mes": mes,
        }
        if "meta_vgv"   in body: payload["meta_vgv"]    = float(body.get("meta_vgv") or 0)
        if "meta_vendas" in body: payload["meta_vendas"] = int(body.get("meta_vendas") or 0)
        if "meta_pontos" in body: payload["meta_pontos"] = float(body.get("meta_pontos") or 0)
        if "meta_visitas" in body: payload["meta_visitas"] = int(body.get("meta_visitas") or 0)
        if "meta_pastas" in body: payload["meta_pastas"] = int(body.get("meta_pastas") or 0)
        if "meta_propostas" in body: payload["meta_propostas"] = int(body.get("meta_propostas") or 0)
        if "meta_agendamentos" in body: payload["meta_agendamentos"] = int(body.get("meta_agendamentos") or 0)
        if "observacoes" in body: payload["observacoes"] = body.get("observacoes") or None
        payload["criado_por"] = actor["id"]

        # Pega valor atual pra audit
        try:
            current = sb.table("metas").select("*").eq("corretor_id", corretor_id).eq("ano", ano).eq("mes", mes).limit(1).execute().data or []
            before = current[0] if current else None
        except Exception:
            before = None

        try:
            # Upsert via ON CONFLICT
            res = sb.table("metas").upsert(payload, on_conflict="corretor_id,ano,mes").execute()
            row = (res.data or [None])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro upsert: {e}"})

        audit(self, actor, "meta.upsert", target_type="meta",
              target_id=f"{corretor_id}:{ano}-{mes:02d}",
              before=before, after=payload)

        return self._send(200, {"ok": True, "meta": row, "created": before is None})
