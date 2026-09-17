"""
POST /api/v3/tasks/conclude — CONCLUIR um item do Home (qualquer aba), gravando os
campos obrigatórios definidos em conclusao_forms. v77.90

Body: { kind, id, fields:{...} }
  kind ∈ tarefa | plantao | criativo | conteudo | captacao
Roteia pra tabela de origem, valida os campos obrigatórios (config shared_kv
'conclusao_forms') e marca como concluído. Só o dono do item (ou lvl>=7) conclui.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

# fallback caso o sócio ainda não tenha customizado (espelha settings/conclusao_forms.py)
_DEFAULTS = {
    "criativo": [{"key": "link", "label": "Link do material publicado", "required": True},
                 {"key": "numero", "label": "Número que constou na arte", "required": True}],
    "conteudo": [{"key": "link", "label": "Link do post publicado", "required": True}],
    "captacao": [{"key": "desfecho", "label": "Desfecho", "required": True}],
}


def _forms(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", "conclusao_forms").limit(1).execute().data or []
        val = rows[0]["value"] if rows else None
        if isinstance(val, str):
            val = json.loads(val)
        if isinstance(val, dict) and val:
            return val
    except Exception:
        pass
    return _DEFAULTS


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
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        kind = (body.get("kind") or "").strip()
        cid = body.get("id")
        fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}
        if not kind or not cid:
            return self._send(400, {"ok": False, "error": "kind e id obrigatórios"})

        lvl = user.get("lvl") or 0
        uid = user.get("id")
        uname = (user.get("name") or "").strip().lower()
        uemail = (user.get("email") or "").strip().lower()
        now = datetime.now(timezone.utc).isoformat()

        # valida campos obrigatórios da config
        defs = _forms(sb).get(kind) or []
        faltando = [f.get("label") or f.get("key") for f in defs
                    if f.get("required") and not str(fields.get(f.get("key"), "")).strip()]
        if faltando:
            return self._send(400, {"ok": False, "error": "Preencha: " + ", ".join(faltando)})

        def _deny():
            return self._send(403, {"ok": False, "error": "Sem permissão pra concluir este item."})

        try:
            if kind == "tarefa":
                cur = (sb.table("dir_tasks").select("*").eq("id", cid).limit(1).execute().data or [])
                if not cur:
                    return self._send(404, {"ok": False, "error": "não encontrado"})
                c = cur[0]
                if not (lvl >= 7 or c.get("responsavel") == uid or c.get("criado_por") == uid):
                    return _deny()
                patch = {"status": "concluida"}
                if fields.get("nota"):
                    patch["observacoes"] = fields["nota"]
                sb.table("dir_tasks").update(patch).eq("id", cid).execute()

            elif kind == "plantao":
                cur = (sb.table("plantoes").select("*").eq("id", cid).limit(1).execute().data or [])
                if not cur:
                    return self._send(404, {"ok": False, "error": "não encontrado"})
                if not (lvl >= 7 or cur[0].get("corretor_id") == uid):
                    return _deny()
                sb.table("plantoes").update({"status": "concluido"}).eq("id", cid).execute()

            elif kind in ("criativo", "conteudo"):
                cur = (sb.table("paulo_cards").select("*").eq("id", cid).limit(1).execute().data or [])
                if not cur:
                    return self._send(404, {"ok": False, "error": "não encontrado"})
                c = cur[0]
                resp = (c.get("responsavel") or "").strip().lower()
                if not (lvl >= 7 or (resp and (resp == uemail or resp == uname))):
                    return _deny()
                chk = c.get("checklist") if isinstance(c.get("checklist"), dict) else {}
                chk = dict(chk); chk["conclusao"] = fields
                patch = {"status": "publicado", "checklist": chk, "updated_at": now}
                if fields.get("link"):
                    patch["link"] = fields["link"]
                sb.table("paulo_cards").update(patch).eq("id", cid).execute()

            elif kind == "captacao":
                cur = (sb.table("captacoes").select("*").eq("id", cid).limit(1).execute().data or [])
                if not cur:
                    return self._send(404, {"ok": False, "error": "não encontrado"})
                c = cur[0]
                if not (lvl >= 7 or c.get("responsavel_id") == uid or (c.get("responsavel") or "").strip().lower() == uname):
                    return _deny()
                desf = (fields.get("desfecho") or "").strip().lower()
                st = "perdido" if desf.startswith("perd") else "publicada"
                patch = {"status": st, "updated_at": now}
                if fields.get("obs"):
                    patch["observacao"] = fields["obs"]
                sb.table("captacoes").update(patch).eq("id", cid).execute()

            else:
                return self._send(400, {"ok": False, "error": "tipo não conclui pelo Home"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, user, f"conclude.{kind}", target_type=kind, target_id=str(cid), after={"fields": fields})
        return self._send(200, {"ok": True, "kind": kind, "id": cid})
