"""
GET /api/v3/comissao/minha?mes=YYYY-MM — a comissão do PRÓPRIO usuário. v84.51

Mesma engine do /comissao/calc, com o escopo TRAVADO no usuário logado: cada um
vê só o que ELE ganha, nunca o dinheiro de outra pessoa. O recorte é feito no
BACKEND (não é filtro de tela) — o payload já sai sem os outros.

  • Corretor Conquista → suas vendas, taxa por origem, acelerador N4
  • Corretor MAP       → suas vendas, taxa origem × senioridade + régua do Sênior
                         (a régua só existe pro MAP — Conquista não tem sênior)
  • Mariane            → indicações da operação que fecharam + faixa progressiva
  • Leire              → reativações que fecharam + bônus de volume + teto

Nível 2: qualquer colaborador ativo vê a própria.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from calc import calcular, _cfg  # type: ignore


def _match(user, termo):
    """O login bate com o 'apelido' configurado (ex.: 'leire', 'mariane')?"""
    t = (termo or "").strip().lower()
    if not t:
        return False
    return t in (user.get("email") or "").lower() or t in (user.get("name") or "").lower()


def _meu(lista, uid, email):
    for c in lista or []:
        if str(c.get("corretor_id") or "") in (uid, email):
            return c
    return None


class handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            user = require_user(self, 2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": str(e)})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        mes = (q.get("mes") or [None])[0]
        try:
            d = calcular(sb, mes)
            cfg = _cfg(sb)
            uid = str(user.get("id") or "")
            email = (user.get("email") or "").lower()
            mp = d.get("map") or {}
            meu_map = _meu(mp.get("corretores"), uid, email)
            out = {
                "ok": True, "mes": d.get("mes"),
                "quem": user.get("name"), "papel": user.get("role"),
                "conquista": _meu(d.get("corretores"), uid, email),
                "map": meu_map,
                # régua do Sênior: SÓ vale pro time MAP
                "map_regua": ({"senior_vgv_min": mp.get("senior_vgv_min"),
                               "origens": mp.get("origens")} if meu_map else None),
                "mariane": d.get("mariane") if _match(user, cfg.get("mariane_user_match")) else None,
                "leire": d.get("leire") if _match(user, cfg.get("leire_user_match")) else None,
            }
            out["tem_algo"] = any(out.get(k) for k in ("conquista", "map", "mariane", "leire"))
            return self._send(200, out)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
