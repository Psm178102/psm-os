"""
GET  /api/v3/diretoria/estrategia?ano=2026
POST /api/v3/diretoria/estrategia (Sócio/Gerente)
                                    body: { id?, ano, tipo, titulo, descricao?,
                                            status?, ordem?, progresso?, _delete? }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED_TIPO = {"visao", "missao", "objetivo", "okr", "iniciativa"}
ALLOWED_STATUS = {"rascunho", "ativo", "concluido", "cancelado"}


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}
        try: ano = int(params.get("ano") or datetime.now().year)
        except: ano = datetime.now().year

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            rows = sb.table("estrategia").select("*").eq("ano", ano) \
                .order("tipo").order("ordem").limit(200).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Group by tipo
        groups = {}
        for r in rows:
            t = r.get("tipo") or "outro"
            (groups.setdefault(t, [])).append(r)

        return self._send(200, {
            "ok": True,
            "ano": ano,
            "count": len(rows),
            "items": rows,
            "groups": groups,
        })

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

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        item_id = body.get("id")

        # Delete
        if body.get("_delete") and item_id:
            try:
                cur = sb.table("estrategia").select("*").eq("id", item_id).limit(1).execute().data or []
                if cur:
                    sb.table("estrategia").delete().eq("id", item_id).execute()
                    audit(self, actor, "estrategia.delete", target_type="estrategia",
                          target_id=str(item_id), before=cur[0])
                return self._send(200, {"ok": True, "deleted": item_id})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        tipo = (body.get("tipo") or "").lower()
        if tipo and tipo not in ALLOWED_TIPO:
            return self._send(400, {"ok": False, "error": f"tipo inválido. Use: {sorted(ALLOWED_TIPO)}"})
        status = (body.get("status") or "ativo").lower()
        if status not in ALLOWED_STATUS:
            return self._send(400, {"ok": False, "error": "status inválido"})

        # Update
        if item_id:
            patch = {}
            for k in ("titulo", "descricao", "tipo", "status", "ordem", "progresso", "ano"):
                if k in body: patch[k] = body[k]
            try:
                cur = sb.table("estrategia").select("*").eq("id", item_id).limit(1).execute().data or []
                if not cur:
                    return self._send(404, {"ok": False, "error": "não encontrado"})
                sb.table("estrategia").update(patch).eq("id", item_id).execute()
                audit(self, actor, "estrategia.update", target_type="estrategia",
                      target_id=str(item_id), before={k: cur[0].get(k) for k in patch.keys()}, after=patch)
                return self._send(200, {"ok": True, "id": item_id, "updated": True})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        # Create
        titulo = (body.get("titulo") or "").strip()
        if not titulo or not tipo:
            return self._send(400, {"ok": False, "error": "titulo e tipo obrigatórios"})

        try:
            ano = int(body.get("ano") or datetime.now().year)
        except Exception:
            return self._send(400, {"ok": False, "error": "ano inválido"})

        row = {
            "ano": ano,
            "tipo": tipo,
            "titulo": titulo,
            "descricao": body.get("descricao") or None,
            "status": status,
            "ordem": int(body.get("ordem") or 0),
            "progresso": int(body.get("progresso") or 0),
            "criado_por": actor["id"],
        }
        try:
            res = sb.table("estrategia").insert(row).execute()
            inserted = (res.data or [row])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"insert: {e}"})

        audit(self, actor, "estrategia.create", target_type="estrategia",
              target_id=str(inserted.get("id")), after=row)
        return self._send(200, {"ok": True, "item": inserted, "created": True})
