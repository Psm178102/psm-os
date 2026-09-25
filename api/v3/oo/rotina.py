"""
🧭 Rotina & Plano do corretor no One-on-One (v88.44).

A rotina de alta performance e o plano de canais/funil de cada corretor, pra ele
consultar no próprio 1:1 em vez de "perder a folha". O conteúdo é montado pela
gestão (a partir do RD, da cadência da equipe e das metas) e guardado por pessoa.

GET  /api/v3/oo/rotina?corretor_id=<id>
     → { ok, plano|null, updated_at }
     Auth: gestor (lvl>=5) OU o próprio corretor (só a dele).

POST /api/v3/oo/rotina   {corretor_id, plano:{...}}
     → grava o plano inteiro (substitui) + audit_log com before/after.
     Auth: sócio (lvl>=10).

Armazenamento: shared_kv 'oo_rotina:<corretor_id>'.
Fica atrás de login de propósito: o plano traz taxas de conversão e pontos fracos
do corretor, que não podem ir pra arquivo estático público.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore

MAX_BYTES = 120_000


def _kv_key(cid):
    return f"oo_rotina:{cid}"


def _read(sb, cid):
    """(plano|None, updated_at, read_ok). read_ok=False = leitura FALHOU (≠ não existe)."""
    try:
        rows = sb.table("shared_kv").select("value,updated_at").eq("key", _kv_key(cid)).limit(1).execute().data or []
    except Exception:
        return None, None, False
    if not rows:
        return None, None, True
    v = rows[0].get("value")
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = None
    return (v if isinstance(v, dict) else None), rows[0].get("updated_at"), True


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

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
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        cid = params.get("corretor_id") or user.get("id")
        # gestor vê qualquer um; corretor SÓ a própria rotina
        if str(cid) != str(user.get("id")) and (user.get("lvl") or 0) < 5:
            return self._send(403, {"ok": False, "error": "sem permissão"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        plano, up, ok = _read(sb, cid)
        if not ok:
            return self._send(503, {"ok": False, "error": "não consegui ler a rotina agora — tente de novo"})
        return self._send(200, {"ok": True, "corretor_id": cid, "plano": plano, "updated_at": up})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "plano grande demais"})
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cid = str(body.get("corretor_id") or "").strip()
        plano = body.get("plano")
        if not cid or not isinstance(plano, dict):
            return self._send(400, {"ok": False, "error": "corretor_id e plano são obrigatórios"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        antes, _, ok = _read(sb, cid)
        if not ok:
            return self._send(503, {"ok": False, "error": "leitura falhou — não gravei nada"})
        try:
            sb.table("shared_kv").upsert({"key": _kv_key(cid), "value": plano,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": "falha ao gravar: " + str(e)[:200]})
        audit(self, user, "oo.rotina.save", target_type="oo_rotina", target_id=cid, before=antes, after=plano)
        return self._send(200, {"ok": True})
