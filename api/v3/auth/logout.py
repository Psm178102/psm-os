"""
POST /api/v3/auth/logout
Header: Authorization: Bearer <token>
Resp: { ok: true }

Fecha a sessão do lado do SERVIDOR: grava `ended_at` + `end_reason='logout'` em
user_sessions. É o "quando fechou o login" preciso — sem isto sobra apenas o
último sinal de vida (que também serve, mas significa "fechou a aba", não
"clicou Sair"). Alimenta o Mapa de Uso (api/v3/checkin/uso.py). v88.5

Detalhes de propósito:
  · antes de encerrar, chama psm_session_beat pra somar o último trecho de uso
    (senão o tempo ficaria arredondado pra baixo em até 1 minuto);
  · NÃO revoga o token (revoked_at fica reservado pra revogação de verdade) —
    o cliente já joga o token fora, e um logout não deve poder derrubar sessão
    de outro aparelho da mesma pessoa;
  · responde ok mesmo sem token válido: não é um canal pra descobrir se um
    token existe, e o logout do cliente nunca depende desta resposta.
"""
from http.server import BaseHTTPRequestHandler
import datetime as _dtm
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, bearer_from_headers, verify_jwt  # type: ignore


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
        claims = verify_jwt(bearer_from_headers(self.headers)) or {}
        jti = claims.get("jti")
        uid = claims.get("sub")
        if not jti:
            return self._send(200, {"ok": True})

        sb = supabase_client()
        if not sb:
            return self._send(200, {"ok": True})

        # 1) soma o último trecho de uso (best-effort)
        try:
            def _iso(unix):
                if not unix:
                    return None
                return _dtm.datetime.fromtimestamp(int(unix), _dtm.timezone.utc).isoformat()
            sb.rpc("psm_session_beat", {
                "p_jti": jti, "p_user": uid,
                "p_iat": _iso(claims.get("iat")), "p_exp": _iso(claims.get("exp")),
                "p_ua": (self.headers.get("User-Agent") or "")[:255], "p_ip": None,
            }).execute()
        except Exception as e:
            print(f"[auth_logout] sinal final falhou: {e}")

        # 2) marca o fim explícito (só a primeira vez — não sobrescreve)
        try:
            (sb.table("user_sessions")
             .update({"ended_at": "now()", "end_reason": "logout"})
             .eq("jti", jti).is_("ended_at", "null").execute())
        except Exception as e:
            print(f"[auth_logout] falha encerrar sessão: {e}")

        return self._send(200, {"ok": True})
