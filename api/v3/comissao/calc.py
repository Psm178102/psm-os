"""
GET/POST /api/v3/comissao/calc — Comissionamento Conquista + Mariane. v84.45

Modelo (config-driven, tudo em shared_kv 'comissao_cfg', editável lvl>=7):
  Corretor Conquista: comissão = VGV × taxa, onde a taxa vem da ORIGEM da venda:
    N1 1,4% estagiário · N1 1,5% tráfego pago PSM
    N2 1,6% reativação / orgânico do corretor / carteira
    N3 1,8% indicação / networking / tráfego pago do corretor
    N4 1,9% ACELERADOR: se o VGV mensal de origens N2/N3 ≥ R$ 850k, TODAS as
       vendas N2/N3 do mês sobem retroativamente pra 1,9%.
  Origem = HÍBRIDO: automática pelo deal_source do RD (mapa editável) + override
    manual por venda (shared_kv 'comissao_origem').
  Desconto na fonte: venda ligada a uma indicação da OPERAÇÃO (Mariane) tem o
    prêmio da tabela descontado da comissão do corretor.
  Mariane: valor FIXO por indicação da operação dela fechada no mês.

GET  ?mes=YYYY-MM  → { corretores[], mariane, fontes_rd[], cfg }
POST set_cfg | set_origem {deal_id, origem} | set_estagiario {user_id, on}
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of  # type: ignore
from _fisc_lib import _kv, _kv_set, get_cfg as fisc_cfg, premio_faixa  # type: ignore

CFG_KEY = "comissao_cfg"
OVR_KEY = "comissao_origem"  # {deal_id: origem_id}  (override manual)

DEFAULT_CFG = {
    "taxa_estagiario": 1.4,
    "origens": [
        {"id": "trafego_pago_psm", "rotulo": "Tráfego pago PSM", "nivel": 1, "taxa": 1.5},
        {"id": "reativacao", "rotulo": "Reativação", "nivel": 2, "taxa": 1.6},
        {"id": "trafego_organico_corretor", "rotulo": "Tráfego orgânico do corretor", "nivel": 2, "taxa": 1.6},
        {"id": "carteira", "rotulo": "Carteira de clientes/leads", "nivel": 2, "taxa": 1.6},
        {"id": "indicacao", "rotulo": "Indicação", "nivel": 3, "taxa": 1.8},
        {"id": "networking", "rotulo": "Networking", "nivel": 3, "taxa": 1.8},
        {"id": "trafego_pago_corretor", "rotulo": "Tráfego pago do corretor", "nivel": 3, "taxa": 1.8},
    ],
    "acelerador": {"taxa": 1.9, "vgv_min": 850000, "niveis": [2, 3]},
    "mapa_rd": {},                       # deal_source (minúsculo) -> origem id
    # Mariane: tabela PROGRESSIVA por nº de indicações da operação que fecham no
    # mês — [até N fechamentos, R$ por indicação] (retroativa: a faixa vale pra
    # TODAS as do mês). Valores ancorados em % de R$ 200k de VGV (0,10%–0,14%),
    # progressão suave a partir de 3. Teto mensal trava o total.
    "mariane_faixas": [[2, 200], [4, 220], [6, 240], [9, 260], [999999, 280]],
    "mariane_teto": 3000.0,
    "mariane_user_match": "mariane",
    "operacao_origens_indicacao": ["abordagem", "nps_promotor"],
    "estagiarios": [],                   # user ids
}


def _cfg(sb):
    v = _kv(sb, CFG_KEY)
    if isinstance(v, dict) and v.get("origens"):
        return {**DEFAULT_CFG, **v}
    _kv_set(sb, CFG_KEY, DEFAULT_CFG)
    return json.loads(json.dumps(DEFAULT_CFG))


def _mariane_rate(faixas, count):
    """R$ por indicação para 'count' fechamentos no mês (1ª faixa cujo teto >= count)."""
    for teto, rate in sorted(faixas or [], key=lambda x: x[0]):
        if count <= teto:
            return float(rate)
    return float(faixas[-1][1]) if faixas else 0.0


def _mes_range(mes):
    """'YYYY-MM' → (ini_iso, fim_iso, rótulo). Default = mês corrente."""
    if not mes:
        hoje = datetime.now(timezone.utc)
        y, m = hoje.year, hoje.month
    else:
        y, m = int(mes[:4]), int(mes[5:7])
    ini = datetime(y, m, 1, tzinfo=timezone.utc)
    fim = datetime(y + (1 if m == 12 else 0), (1 if m == 12 else m + 1), 1, tzinfo=timezone.utc)
    return ini.isoformat(), fim.isoformat(), f"{y:04d}-{m:02d}"


def _source_name(raw):
    s = (raw or {}).get("deal_source")
    if isinstance(s, dict):
        return (s.get("name") or "").strip()
    if isinstance(s, str):
        return s.strip()
    return ""


def _page(make_q, cap=8000):
    out, page = [], 1000
    for i in range(0, cap, page):
        rows = make_q().range(i, i + page - 1).execute().data or []
        out.extend(rows)
        if len(rows) < page:
            break
    return out


def calcular(sb, mes=None):
    cfg = _cfg(sb)
    ini, fim, mes_lbl = _mes_range(mes)
    origem_por_id = {o["id"]: o for o in cfg.get("origens") or []}
    nivel_de = {o["id"]: o.get("nivel") for o in cfg.get("origens") or []}
    mapa = {str(k).lower(): v for k, v in (cfg.get("mapa_rd") or {}).items()}
    overrides = _kv(sb, OVR_KEY) or {}
    estagiarios = set(str(x) for x in (cfg.get("estagiarios") or []))
    acel = cfg.get("acelerador") or {}
    op_origens = set(cfg.get("operacao_origens_indicacao") or [])

    # vendas Conquista ganhas no mês
    deals = _page(lambda: sb.table("deals").select(
        "id,name,amount,win,closed_at,pipeline_name,user_id,user_email,rd_raw")
        .eq("win", True).gte("closed_at", ini).lt("closed_at", fim).order("id"), cap=6000)
    deals = [d for d in deals if frente_of(d.get("pipeline_name")) == "conquista"]

    # indicações da OPERAÇÃO ligadas a esses deals (pro desconto na fonte)
    ind_por_deal = {}
    try:
        did_list = [str(d["id"]) for d in deals if d.get("id")]
        for i in range(0, len(did_list), 200):
            rows = sb.table("indicacoes").select("deal_id,origem,tipo,valor_negocio") \
                .in_("deal_id", did_list[i:i + 200]).execute().data or []
            for r in rows:
                if (r.get("origem") in op_origens):
                    ind_por_deal[str(r.get("deal_id"))] = r
    except Exception:
        pass

    faixas_v = fisc_cfg(sb).get("premio_indicacao_venda") or []
    fontes = {}   # source name -> contagem (pra montar o mapa)
    por_corretor = {}

    for d in deals:
        cid = str(d.get("user_id") or d.get("user_email") or "?")
        vgv = float(d.get("amount") or 0)
        src = _source_name(d.get("rd_raw"))
        if src:
            fontes[src] = fontes.get(src, 0) + 1
        did = str(d.get("id"))
        origem = overrides.get(did) or mapa.get(src.lower()) or None
        estag = cid in estagiarios
        if estag:
            nivel, taxa, origem_lbl = 1, float(cfg.get("taxa_estagiario") or 1.4), "Estagiário"
        elif origem and origem in origem_por_id:
            o = origem_por_id[origem]
            nivel, taxa, origem_lbl = o.get("nivel"), float(o.get("taxa") or 0), o.get("rotulo")
        else:
            nivel, taxa, origem_lbl = None, 0.0, "⚠️ origem indefinida"
        desconto = 0.0
        ind = ind_por_deal.get(did)
        if ind:
            p = premio_faixa(faixas_v, vgv)
            desconto = float(p or 0)
        c = por_corretor.setdefault(cid, {"corretor_id": cid, "corretor_nome": d.get("user_email") or cid,
                                          "vendas": [], "vgv_total": 0.0, "vgv_n2n3": 0.0})
        c["vendas"].append({"deal_id": did, "cliente": d.get("name"), "vgv": vgv,
                            "origem": origem, "origem_lbl": origem_lbl, "nivel": nivel,
                            "taxa": taxa, "desconto_indicacao": desconto,
                            "fonte_rd": src, "definida": bool(nivel)})
        c["vgv_total"] += vgv
        if nivel in (acel.get("niveis") or [2, 3]):
            c["vgv_n2n3"] += vgv

    # nomes reais
    nomes = {}
    try:
        us = sb.table("users").select("id,name,email").limit(500).execute().data or []
        nomes = {str(u["id"]): u.get("name") for u in us}
        nomes.update({(u.get("email") or "").lower(): u.get("name") for u in us if u.get("email")})
    except Exception:
        pass

    corretores = []
    for cid, c in por_corretor.items():
        acel_on = c["vgv_n2n3"] >= float(acel.get("vgv_min") or 850000)
        total = 0.0
        for v in c["vendas"]:
            taxa = v["taxa"]
            if acel_on and v["nivel"] in (acel.get("niveis") or [2, 3]):
                taxa = float(acel.get("taxa") or 1.9)
                v["taxa_aplicada"] = taxa
                v["acelerada"] = True
            else:
                v["taxa_aplicada"] = taxa
                v["acelerada"] = False
            v["comissao_bruta"] = round(v["vgv"] * taxa / 100, 2)
            v["comissao_liquida"] = round(v["comissao_bruta"] - v["desconto_indicacao"], 2)
            total += v["comissao_liquida"]
        corretores.append({
            "corretor_id": cid, "corretor_nome": nomes.get(cid, c["corretor_nome"]),
            "vgv_total": round(c["vgv_total"], 2), "vgv_n2n3": round(c["vgv_n2n3"], 2),
            "acelerador": acel_on, "comissao_total": round(total, 2),
            "n_vendas": len(c["vendas"]), "vendas": sorted(c["vendas"], key=lambda x: -x["vgv"])})
    corretores.sort(key=lambda x: -x["comissao_total"])

    # ── Mariane (tabela progressiva + teto) ──
    faixas = cfg.get("mariane_faixas") or []
    teto = float(cfg.get("mariane_teto") or 0)
    mar = {"faixas": faixas, "teto": teto, "fechadas": [], "total": 0.0, "qtd": 0,
           "rate": 0.0, "no_teto": False}
    try:
        inds = sb.table("indicacoes").select("id,indicador_nome,indicado_nome,deal_id,valor_negocio,status,atualizado_em,origem") \
            .in_("origem", list(op_origens)).in_("status", ["vendida", "premio_aprovado", "premio_pago"]) \
            .gte("atualizado_em", ini).lt("atualizado_em", fim).limit(500).execute().data or []
        for r in inds:
            mar["fechadas"].append({"indicador": r.get("indicador_nome"), "indicado": r.get("indicado_nome"),
                                    "vgv": r.get("valor_negocio")})
        n = len(inds)
        rate = _mariane_rate(faixas, n) if n else 0.0
        bruto = n * rate
        total = min(bruto, teto) if teto else bruto
        mar.update({"qtd": n, "rate": rate, "total": round(total, 2),
                    "bruto": round(bruto, 2), "no_teto": bool(teto and bruto > teto)})
    except Exception:
        pass

    fontes_ord = sorted(fontes.items(), key=lambda x: -x[1])
    return {"mes": mes_lbl, "corretores": corretores, "mariane": mar,
            "fontes_rd": [{"fonte": f, "n": n, "mapeada": f.lower() in mapa} for f, n in fontes_ord],
            "cfg": cfg}


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
            require_user(self, min_lvl=5)   # gestão/gerência vê comissão
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        mes = (qs.get("mes") or [None])[0]
        try:
            return self._send(200, {"ok": True, **calcular(sb, mes)})
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=7)   # editar comissão é da direção
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length else "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        action = (body.get("action") or "").strip()
        try:
            if action == "set_cfg":
                cur = _cfg(sb)
                nc = body.get("cfg") or {}
                for k in ("taxa_estagiario", "mariane_faixas", "mariane_teto", "mapa_rd",
                          "origens", "acelerador", "operacao_origens_indicacao"):
                    if k in nc:
                        cur[k] = nc[k]
                _kv_set(sb, CFG_KEY, cur)
                audit(self, user, "comissao.set_cfg", "shared_kv", CFG_KEY)
                return self._send(200, {"ok": True, "cfg": cur})

            if action == "set_origem":
                did = str(body.get("deal_id") or "")
                origem = str(body.get("origem") or "").strip()
                if not did:
                    return self._send(400, {"ok": False, "error": "deal_id obrigatório"})
                ovr = _kv(sb, OVR_KEY) or {}
                if origem:
                    ovr[did] = origem
                else:
                    ovr.pop(did, None)
                _kv_set(sb, OVR_KEY, ovr)
                audit(self, user, "comissao.set_origem", "deals", did, notes=origem)
                return self._send(200, {"ok": True})

            if action == "set_estagiario":
                cur = _cfg(sb)
                uid = str(body.get("user_id") or "")
                est = set(str(x) for x in (cur.get("estagiarios") or []))
                if body.get("on"):
                    est.add(uid)
                else:
                    est.discard(uid)
                cur["estagiarios"] = sorted(est)
                _kv_set(sb, CFG_KEY, cur)
                audit(self, user, "comissao.set_estagiario", "users", uid, notes=str(bool(body.get("on"))))
                return self._send(200, {"ok": True, "estagiarios": cur["estagiarios"]})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
