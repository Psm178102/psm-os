"""
🕸 REDE DE AGENTES (v87.31) — feed do quadro compartilhado da diretoria.

Os agentes IA da rede (CEO, CFO, CMO, Sr. Tráfego, Sr. Performance, Sr.
Gerência) publicam recados uns pros outros via blocos [[REDE]] no chat
(api/v3/ia/chat.py grava no shared_kv 'agentes_rede'). Este endpoint é a
janela humana do quadro: o sócio lê o feed, publica recado manual (que
todos os agentes veem) e apaga ruído.

GET  → { ok, notas: [ {id, ts, autor, para[], tipo, titulo, corpo, por?} ] }
POST → action=add {para[], tipo, titulo, corpo}   (autor='socio')
       action=del {id}
Auth: SÓ sócio (lvl>=10) — o quadro carrega caixa/dívida/plano.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore

KV_REDE = "agentes_rede"
AGENTES = {"ceo", "cfo", "cmo", "gestor_trafego", "sr_performance", "sr_gerencia", "socio"}
TIPOS = {"achado", "alerta", "incongruencia", "plano", "decisao", "pergunta", "resposta"}
MAX_NOTAS = 120


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_REDE).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _write(sb, value):
    sb.table("shared_kv").upsert({
        "key": KV_REDE, "value": value,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key").execute()


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
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        notas = [n for n in (_read(sb).get("notas") or []) if isinstance(n, dict)]
        return self._send(200, {"ok": True, "notas": notas[::-1]})   # mais recente primeiro

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
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
        action = (body.get("action") or "").strip()
        v = _read(sb)
        notas = [n for n in (v.get("notas") or []) if isinstance(n, dict)]

        if action == "add":
            para = [p for p in (body.get("para") or []) if p in AGENTES or p == "todos"] or ["todos"]
            tipo = body.get("tipo") if body.get("tipo") in TIPOS else "achado"
            titulo = str(body.get("titulo") or "").strip()[:160]
            corpo = str(body.get("corpo") or "").strip()[:1200]
            if not titulo:
                return self._send(400, {"ok": False, "error": "titulo obrigatório"})
            nota = {
                "id": f"socio-{int(time.time() * 1000)}",
                "ts": datetime.now(timezone.utc).isoformat(),
                "autor": "socio", "para": para, "tipo": tipo,
                "titulo": titulo, "corpo": corpo, "por": user.get("name"),
            }
            notas = (notas + [nota])[-MAX_NOTAS:]
            _write(sb, {"notas": notas})
            audit(self, user, "ia.rede.add", target_type="shared_kv", target_id=KV_REDE,
                  notes=f"para={','.join(para)} tipo={tipo} {titulo[:60]}")
            return self._send(200, {"ok": True, "nota": nota})

        if action == "del":
            nid = str(body.get("id") or "")
            antes = len(notas)
            notas = [n for n in notas if n.get("id") != nid]
            if len(notas) == antes:
                return self._send(404, {"ok": False, "error": "recado não encontrado"})
            _write(sb, {"notas": notas})
            audit(self, user, "ia.rede.del", target_type="shared_kv", target_id=KV_REDE, notes=nid)
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": "action inválida (add|del)"})
