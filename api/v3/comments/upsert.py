"""
POST /api/v3/comments/upsert
Body: { id?, target_type, target_id, texto, _delete? }

Cria/atualiza comentário. Auto-detecta @mentions e gera notifications.
Notifica também o responsável/criador do target (heurística).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify  # type: ignore


MENTION_RE = re.compile(r"@([a-z0-9_\-]{2,40})", re.IGNORECASE)


def _extract_mentions(sb, texto):
    """Extrai @user_id ou @username e resolve em user_ids reais."""
    if not texto: return []
    names = MENTION_RE.findall(texto)
    if not names: return []
    names = list({n.lower() for n in names})
    try:
        # Match por id direto
        res = sb.table("users").select("id").in_("id", names).execute().data or []
        return [r["id"] for r in res]
    except Exception:
        return []


def _target_recipients(sb, target_type, target_id):
    """Acha pessoas que devem ser notificadas com base no tipo do alvo."""
    if not target_type or not target_id:
        return []
    try:
        if target_type == "task":
            r = sb.table("dir_tasks").select("responsavel,criado_por").eq("id", target_id).limit(1).execute().data or []
            if r: return list({r[0].get("responsavel"), r[0].get("criado_por")} - {None})
        elif target_type == "evento":
            r = sb.table("eventos").select("corretor_id,criado_por,participantes").eq("id", target_id).limit(1).execute().data or []
            if r:
                base = {r[0].get("corretor_id"), r[0].get("criado_por")}
                parts = r[0].get("participantes") or []
                if isinstance(parts, list): base.update(parts)
                return list(base - {None})
        elif target_type == "recado":
            r = sb.table("recados").select("autor_id").eq("id", target_id).limit(1).execute().data or []
            if r: return [r[0]["autor_id"]] if r[0].get("autor_id") else []
    except Exception as e:
        print(f"[comments] target_recipients err: {e}")
    return []


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
            actor = require_user(self, min_lvl=0)
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

        comm_id = body.get("id")

        # Delete
        if body.get("_delete") and comm_id:
            try:
                cur = sb.table("comments").select("*").eq("id", comm_id).limit(1).execute().data or []
                if cur:
                    is_owner = cur[0].get("autor_id") == actor["id"]
                    is_socio = (actor.get("lvl") or 0) >= 7
                    if not is_owner and not is_socio:
                        return self._send(403, {"ok": False, "error": "apenas autor ou Sócio/Gerente"})
                    sb.table("comments").delete().eq("id", comm_id).execute()
                    audit(self, actor, "comment.delete", target_type="comment", target_id=comm_id, before=cur[0])
                return self._send(200, {"ok": True, "deleted": comm_id})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        # Update
        if comm_id:
            texto = (body.get("texto") or "").strip()
            if not texto: return self._send(400, {"ok": False, "error": "texto obrigatório"})
            try:
                cur = sb.table("comments").select("*").eq("id", comm_id).limit(1).execute().data or []
                if not cur: return self._send(404, {"ok": False, "error": "não encontrado"})
                if cur[0].get("autor_id") != actor["id"] and (actor.get("lvl") or 0) < 7:
                    return self._send(403, {"ok": False, "error": "apenas autor ou Sócio/Gerente"})
                mentions = _extract_mentions(sb, texto)
                sb.table("comments").update({"texto": texto, "mentions": mentions}).eq("id", comm_id).execute()
                audit(self, actor, "comment.update", target_type="comment", target_id=comm_id,
                      before={"texto": cur[0].get("texto")}, after={"texto": texto})
                return self._send(200, {"ok": True, "id": comm_id, "updated": True})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        # Create
        target_type = (body.get("target_type") or "").strip()
        target_id = (body.get("target_id") or "").strip()
        texto = (body.get("texto") or "").strip()
        if not target_type or not target_id or not texto:
            return self._send(400, {"ok": False, "error": "target_type, target_id, texto obrigatórios"})

        mentions = _extract_mentions(sb, texto)
        new_id = "cm_" + uuid.uuid4().hex[:12]
        row = {
            "id": new_id,
            "target_type": target_type,
            "target_id": target_id,
            "autor_id": actor["id"],
            "texto": texto,
            "mentions": mentions,
        }
        try:
            res = sb.table("comments").insert(row).execute()
            inserted = (res.data or [row])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"insert: {e}"})

        # Notifications: @mentions + target_recipients (excluindo autor)
        recipients = set(mentions)
        recipients.update(_target_recipients(sb, target_type, target_id))
        recipients.discard(actor["id"])
        if recipients:
            preview = texto[:120] + ("…" if len(texto) > 120 else "")
            link = "#/" + ({"task": "tarefas", "evento": "agenda", "recado": "diretoria"}.get(target_type, ""))
            notify(list(recipients), tipo="comment.new",
                   title=f"{actor.get('name')} comentou",
                   body=preview, link=link,
                   target_type=target_type, target_id=target_id)

        audit(self, actor, "comment.create", target_type=target_type, target_id=target_id,
              notes=f"comentário em {target_type}")

        # Enrich author p/ response
        inserted["autor"] = {"id": actor["id"], "name": actor.get("name"), "ini": actor.get("ini"), "color": actor.get("color"), "role": actor.get("role")}
        return self._send(200, {"ok": True, "comment": inserted, "notified": len(recipients)})
