"""
GET/POST /api/v3/ia/chats — histórico de chat dos agentes IA POR USUÁRIO. v84.1

Auditoria A2: os chats (Sol/Vera/custom, Sr. Gerência, Sr. Performance) viviam em
localStorage — perdiam ao trocar de aparelho/navegador. Agora persistem no backend,
escopados ao usuário logado (cada um só lê/escreve o PRÓPRIO histórico).

shared_kv key 'agent_chat::<agent>::<user_id>' = { messages: [...], updated_at }.
Cap de 40 mensagens (histórico de conversa, não arquivo morto).

GET  ?agent=<id>            → { ok, messages }
POST { agent, messages:[] } → { ok } (substitui; [] limpa)
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

MAX_MSGS = 40
AGENT_RX = re.compile(r"^[a-z0-9_\-]{2,40}$")


def _key(agent, uid):
    return f"agent_chat::{agent}::{uid}"


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        agent = (qs.get("agent") or "").strip().lower()
        if not AGENT_RX.match(agent):
            return self._send(400, {"ok": False, "error": "agent inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("shared_kv").select("value").eq("key", _key(agent, actor.get("id"))).limit(1).execute().data or []
            val = rows[0]["value"] if rows else {}
            if isinstance(val, str):
                val = json.loads(val)
            msgs = val.get("messages") if isinstance(val, dict) else []
        except Exception:
            msgs = []
        return self._send(200, {"ok": True, "messages": msgs if isinstance(msgs, list) else []})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        agent = (body.get("agent") or "").strip().lower()
        if not AGENT_RX.match(agent):
            return self._send(400, {"ok": False, "error": "agent inválido"})
        msgs = body.get("messages")
        if not isinstance(msgs, list):
            return self._send(400, {"ok": False, "error": "messages inválido"})
        clean = []
        for m in msgs[-MAX_MSGS:]:
            if isinstance(m, dict):
                clean.append({"role": str(m.get("role") or "user")[:12],
                              "content": str(m.get("content") or "")[:8000],
                              "ts": m.get("ts")})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("shared_kv").upsert({"key": _key(agent, actor.get("id")),
                                          "value": {"messages": clean},
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "count": len(clean)})
