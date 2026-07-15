"""
GET  /api/v3/comissao/regras — as REGRAS de comissão (só as tabelas). v84.63
POST /api/v3/comissao/regras — edita as regras. Só sócio (lvl>=7).

Por que separado do /comissao/calc: aquele exige lvl>=5 porque devolve o
dinheiro de todo mundo. Aqui só saem as TABELAS — quanto vale cada faixa, o
bônus por volume, o teto. Isso não é segredo: quem é pago pela régua tem que
poder ler a régua. Por isso GET é lvl>=2 e a Leire (secretaria_vendas, lvl 3)
finalmente enxerga a própria regra dentro da tela onde ela trabalha.

Escreve no MESMO shared_kv 'comissao_cfg' do /comissao/calc — fonte única, sem
duas verdades. Editar aqui reflete na tela de Comissionamento e vice-versa.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from _fisc_lib import _kv, _kv_set  # type: ignore
from calc import _cfg, CFG_KEY  # type: ignore

# só estas chaves saem/entram por aqui — nada de dinheiro individual
CHAVES = ("leire_estoque", "leire_lancamento", "leire_volume", "leire_teto")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cfg = _cfg(sb)
        return self._send(200, {"ok": True,
                                "pode_editar": (user.get("lvl") or 0) >= 7,
                                **{k: cfg.get(k) for k in CHAVES}})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=7)   # só o sócio mexe na régua
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n else "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cur = _cfg(sb)
        antes = {k: cur.get(k) for k in CHAVES}
        for k in CHAVES:
            if k in body:
                cur[k] = body[k]
        # trava básica: sem faixa não há régua, e régua vazia pagaria R$ 0,00 calado
        if not (cur.get("leire_estoque") and cur.get("leire_volume")):
            return self._send(400, {"ok": False, "error": "faixas de VGV e de volume não podem ficar vazias"})
        _kv_set(sb, CFG_KEY, cur)
        audit(self, user, "comissao.regras.leire", "shared_kv", CFG_KEY,
              before=antes, after={k: cur.get(k) for k in CHAVES})
        return self._send(200, {"ok": True, **{k: cur.get(k) for k in CHAVES}})
