"""
GET/POST /api/v3/profile/painel_extra — Dados ricos do Meu Painel (por usuário). v78.6

Guarda em shared_kv key 'painel_extra:<uid>' as partes que não cabem no user_profile:
  • comportamental → resultado do teste de perfil (Águia/Gato/Tubarão/Lobo) + respostas
  • rotina        → planner semanal (dias × períodos)
  • metas         → metas pessoais estruturadas (resultado: vgv/ganhos + evolução: lista)
  • pdf           → link da análise comportamental + texto + interpretação da IA

GET  ?uid=<id>  (default: você; gestor lvl≥5 pode ver de qualquer um)
     → {ok, data:{comportamental, rotina, metas, pdf}, can_edit}
POST {uid?, patch:{secao: valor, ...}}  (você mesmo, ou gestor lvl≥5) → merge + salva.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

SECOES = ("comportamental", "rotina", "metas", "pdf")


def _key(uid):
    return f"painel_extra:{uid}"


def _read(sb, uid):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", _key(uid)).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _write(sb, uid, data):
    sb.table("shared_kv").upsert({"key": _key(uid), "value": data,
                                 "updated_at": datetime.now(timezone.utc).isoformat()},
                                on_conflict="key").execute()


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _target(self, actor, asked):
        uid = (actor.get("id") or "")
        lvl = actor.get("lvl") or 0
        if asked and asked != uid and lvl >= 5:
            return asked, True
        if asked and asked != uid:
            return asked, False           # gestor não é, só lê
        return uid, True                  # próprio painel

    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        from urllib.parse import urlparse, parse_qs
        asked = (parse_qs(urlparse(self.path).query).get("uid", [""])[0] or "").strip()
        target, can_edit = self._target(actor, asked)
        data = _read(sb, target)
        return self._send(200, {"ok": True, "data": data, "can_edit": can_edit, "uid": target})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
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
        target, can_edit = self._target(actor, (body.get("uid") or "").strip())
        if not can_edit:
            return self._send(403, {"ok": False, "error": "sem permissão pra editar este painel"})
        patch = body.get("patch") or {}
        if not isinstance(patch, dict):
            return self._send(400, {"ok": False, "error": "patch inválido"})
        data = _read(sb, target)
        for k, v in patch.items():
            if k in SECOES:
                data[k] = v
        try:
            _write(sb, target, data)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "painel_extra.save", target_type="painel_extra", target_id=target,
              notes=",".join([k for k in patch if k in SECOES]))
        return self._send(200, {"ok": True, "data": data})
