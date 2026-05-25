"""
POST /api/v3/users/update
Body: { "id": "...", "fields": { "role": "...", "team": "...", "status": "...", "hide_from_ranking": true, "name": "...", "email": "..." } }
Header: Authorization: Bearer <token>

Atualiza somente os campos enviados (PATCH semantics).
Requer: o próprio user OU lvl >= 10 (Sócio).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, current_user, enrich_user, audit  # type: ignore


# Campos que podem ser atualizados (whitelist)
ALLOWED_FIELDS = {
    "name", "email", "role", "team", "ini", "color", "rd_id", "meta_id",
    "status", "hide_from_ranking",
}


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        # Auth
        actor = current_user(self)
        if not actor:
            return self._send(401, {"ok": False, "error": "autenticação necessária"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        target_id = (body.get("id") or "").strip()
        fields = body.get("fields") or {}

        if not target_id:
            return self._send(400, {"ok": False, "error": "id obrigatório"})
        if not isinstance(fields, dict) or not fields:
            return self._send(400, {"ok": False, "error": "fields obrigatórios (objeto não-vazio)"})

        # Permissão: próprio user OU Sócio
        is_self = actor["id"] == target_id
        is_socio = (actor.get("lvl") or 0) >= 10
        if not is_self and not is_socio:
            return self._send(403, {"ok": False, "error": "apenas o próprio user ou um Sócio pode editar"})

        # Self-update tem restrições (não pode escalar role nem desativar a si mesmo)
        if is_self and not is_socio:
            for forbidden in ("role", "status"):
                if forbidden in fields:
                    return self._send(403, {"ok": False, "error": f"você não pode alterar seu próprio '{forbidden}'"})

        # Filtra whitelist
        patch = {k: v for k, v in fields.items() if k in ALLOWED_FIELDS}
        if not patch:
            return self._send(400, {
                "ok": False,
                "error": "nenhum campo válido (whitelist: " + ", ".join(sorted(ALLOWED_FIELDS)) + ")"
            })

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # Snapshot ANTES (só dos campos que estão sendo mudados)
        try:
            cols_sel = ",".join(["id"] + list(patch.keys()))
            before_res = sb.table("users").select(cols_sel).eq("id", target_id).limit(1).execute()
            before = (before_res.data or [None])[0]
        except Exception:
            before = None

        # Update + return
        try:
            res = sb.table("users").update(patch).eq("id", target_id).execute()
            rows = res.data or []
            if not rows:
                return self._send(404, {"ok": False, "error": "user não encontrado"})
            after = {"id": target_id, **patch}
            # Audit
            audit(self, actor, "user.update", target_type="user", target_id=target_id,
                  before=before, after=after,
                  notes="self-update" if is_self else None)
            return self._send(200, {"ok": True, "user": enrich_user(rows[0])})
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"erro update: {e}"})
