"""
GET /api/v3/zoho/equipe — quem da equipe conectou o Zoho (visão de gestão). v84.54

Com a empresa inteira na agenda, alguém precisa enxergar QUEM ficou de fora —
senão a integração "funciona" e ninguém percebe que metade do time nunca clicou
em Conectar. Alimenta o card do Zoho em /integracoes.

Nunca devolve refresh_token nem access_token — só status, e-mail e saúde da
última sync. Nível 7 (direção).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
import _zoho_lib as z  # type: ignore


def _min_desde(iso):
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return int((datetime.now(timezone.utc) - dt).total_seconds() // 60)
    except Exception:
        return None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            us = sb.table("users").select("id,name,email,role,status").limit(500).execute().data or []
            us = [u for u in us if (u.get("status") or "").lower() == "ativo"]
            conns = sb.table("zoho_conexoes").select(
                "user_id,zoho_email,conectado_em,last_sync_at,last_sync_res").limit(500).execute().data or []
            porid = {str(c["user_id"]): c for c in conns}
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        linhas = []
        for u in sorted(us, key=lambda x: (x.get("name") or "")):
            c = porid.get(str(u["id"]))
            res = (c or {}).get("last_sync_res") or {}
            erros = int(res.get("erros") or 0) if isinstance(res, dict) else 0
            linhas.append({
                "user_id": u["id"], "nome": u.get("name"), "email": u.get("email"),
                "papel": u.get("role"),
                "conectado": bool(c),
                "zoho_email": (c or {}).get("zoho_email"),
                "conectado_em": (c or {}).get("conectado_em"),
                "min_desde_sync": _min_desde((c or {}).get("last_sync_at")),
                "erros": erros,
                # quem conectou mas nunca sincronizou, ou está com erro, precisa de olho
                "saudavel": bool(c) and erros == 0 and (c or {}).get("last_sync_at") is not None,
            })
        return self._send(200, {
            "ok": True,
            "configurado": z.configured(),
            "dc": z.dc(),
            "redirect_uri": z.redirect_uri(),
            "total": len(linhas),
            "conectados": sum(1 for l in linhas if l["conectado"]),
            "com_erro": sum(1 for l in linhas if l["conectado"] and not l["saudavel"]),
            "equipe": linhas,
        })
