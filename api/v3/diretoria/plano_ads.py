"""
GET /api/v3/diretoria/plano_ads — SEMÁFORO DE ADS do Plano de Resgate. v84.21

Regra-mãe do plano (seção 9): ads segue capacidade + ROAS, nunca a esperança.
Piso: contribuição ≥ 2× o spend. Este endpoint entrega, pro mês corrente:
  - GLOBAL: spend total (todas as contas Meta) × contribuição estimada do mês
    (Conquista×1,85% + próprio×3,6%, mesma conta do Real vs Plano) → ROAS + ▲⏸▼
  - POR CONTA: spend de cada conta de anúncio + frente inferida pelo NOME da
    conta (conquista/map/terceiros/loca no nome) + ROAS da FRENTE quando dá
    pra amarrar (contribuição da frente ÷ spend das contas daquela frente).
Honestidade: atribuição por conta é aproximada (nome→frente); o número exato
continua sendo o global. Sem par frente↔conta → mostra só o spend.

Auth: lvl>=7. Spend vem do /api/meta-ads interno (mesma fonte do Marketing).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from plano_resgate import _kv_get, _real, SEED  # type: ignore

BRT = timezone(timedelta(hours=-3))


def _fetch_meta(host, since, until):
    import urllib.request
    url = f"https://{host}/api/meta-ads?since={since}&until={until}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=30) as r:
            return json.loads(r.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)[:150]


def _frente_da_conta(nome):
    n = (nome or "").lower()
    if "conquista" in n:
        return "conquista"
    if "map" in n or "psm im" in n:
        return "map"
    if "terceiro" in n:
        return "terceiros"
    if "loca" in n:
        return "locacoes"
    return None


def _farol(roas):
    if roas is None:
        return "—"
    if roas >= 2:
        return "▲"
    if roas >= 1:
        return "⏸"
    return "▼"


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=8)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        plano = _kv_get(sb) or SEED
        real = _real(sb, plano)
        cts = plano.get("constantes") or {}
        now = datetime.now(BRT)
        since = now.replace(day=1).strftime("%Y-%m-%d")
        until = now.strftime("%Y-%m-%d")
        host = self.headers.get("Host") or "www.housepsm.com.br"
        payload, err = _fetch_meta(host, since, until)
        if payload is None:
            return self._send(200, {"ok": True, "erro_meta": err, "contas": [], "global": None})

        contas = []
        spend_total = 0.0
        spend_por_frente = {}
        for a in (payload.get("accounts") or []):
            sp = float(a.get("spend") or 0)
            spend_total += sp
            fr = _frente_da_conta(a.get("name") or a.get("account_name"))
            if fr:
                spend_por_frente[fr] = spend_por_frente.get(fr, 0) + sp
            contas.append({"nome": a.get("name") or a.get("account_name") or a.get("id"),
                           "spend": round(sp, 2), "frente": fr})

        # contribuição por frente (mesma régua do Real vs Plano)
        vgv = real.get("vgv") or {}
        contrib_frente = {
            "conquista": vgv.get("conquista", 0) * float(cts.get("margem_conquista_pct", 1.85)) / 100,
            "map": vgv.get("map", 0) * float(cts.get("margem_proprio_pct", 3.6)) / 100,
            "terceiros": vgv.get("terceiros", 0) * float(cts.get("margem_proprio_pct", 3.6)) / 100,
            "locacoes": 0.0,
        }
        frentes = []
        for fr, sp in sorted(spend_por_frente.items(), key=lambda x: -x[1]):
            roas = (contrib_frente.get(fr, 0) / sp) if sp > 0 else None
            frentes.append({"frente": fr, "spend": round(sp, 2),
                            "contribuicao": round(contrib_frente.get(fr, 0), 2),
                            "roas": round(roas, 2) if roas is not None else None,
                            "farol": _farol(roas)})
        contrib_total = float(real.get("contribuicao") or 0)
        roas_global = (contrib_total / spend_total) if spend_total > 0 else None
        return self._send(200, {"ok": True, "mes": real.get("mes_id"),
                                "global": {"spend": round(spend_total, 2),
                                           "contribuicao": round(contrib_total, 2),
                                           "roas": round(roas_global, 2) if roas_global is not None else None,
                                           "farol": _farol(roas_global), "piso": 2.0},
                                "frentes": frentes, "contas": contas})
