"""
📣 GET/POST /api/v3/diretoria/trafego_real — gasto REAL de mídia por marca e mês (v85.16)

O que resolve: a verba de tráfego era digitada à mão e virava um número solto,
sem relação com o que a Meta cobrou de fato. Agora o gasto de cada conta de
anúncio é puxado MÊS A MÊS (valor exato do mês, nunca média) e somado na marca
que o sócio mandou — com override manual quando a realidade não couber no mapa.

Mapa padrão (definido pelo Paulo em 07/08/2026):
  • PSM Conquista ← conta "PSM Conquista"
  • PSM M.A.P     ← contas "Paulo Morimatsu" + "PSM Imoveis"  (duas somam na mesma marca)
Editável em shared_kv 'viab_trafego_map' pela própria tela.

GET  ?ano=YYYY            → { real, override, efetivo, mapa, contas, atualizado_em }
GET  ?ano=YYYY&sync=1     → busca na Meta antes de responder (gestor lvl>=8 ou cron)
POST {ano, marca, mes, valor|null}  → grava/limpa o override manual daquele mês
POST {ano, mapa:{marca:[act_id,…]}} → salva o mapa conta→marca

Guardado em shared_kv:
  viab_trafego_real = {"2026": {"1": {"act_x": {"label":…, "spend":…}}, …}, "_sync": …}
  viab_trafego_over = {"2026": {"conquista": {"8": 9000}}}     ← override manual
  viab_trafego_map  = {"conquista": ["act_…"], "map": ["act_…","act_…"]}
"""
from http.server import BaseHTTPRequestHandler
import calendar
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from viab import read_kv, write_kv, can_viab, LINHA_IDS  # type: ignore

KV_REAL = "viab_trafego_real"
KV_OVER = "viab_trafego_over"
KV_MAPA = "viab_trafego_map"

# Mapa inicial — a tela pode mudar depois; isto é só o ponto de partida.
MAPA_PADRAO = {
    "conquista": ["act_1851397782164698"],                          # PSM Conquista
    "map": ["act_2321924467923057", "act_1413862082678408"],        # Paulo Morimatsu + PSM Imoveis
}


def _mapa(sb):
    m = read_kv(sb, KV_MAPA)
    if not isinstance(m, dict) or not m:
        return dict(MAPA_PADRAO)
    return {k: [str(a) for a in v] for k, v in m.items() if k in LINHA_IDS and isinstance(v, list)}


def _fetch_mes(host, ano, mes, hoje):
    """Gasto por conta no mês — a janela para no dia de hoje se o mês for o corrente
    (senão a Meta devolveria o mês inteiro projetado e o número não seria o real)."""
    ult = calendar.monthrange(ano, mes)[1]
    if ano == hoje.year and mes == hoje.month:
        ult = hoje.day
    since, until = f"{ano}-{mes:02d}-01", f"{ano}-{mes:02d}-{ult:02d}"
    url = f"https://{host}/api/meta-ads?action=accounts&since={since}&until={until}"
    secret = os.environ.get("CRON_SECRET", "").strip()
    req = urllib.request.Request(url, headers={"User-Agent": "PSM-OS-trafego",
                                               **({"Authorization": f"Bearer {secret}"} if secret else {})})
    with urllib.request.urlopen(req, timeout=45) as r:
        data = json.loads(r.read().decode("utf-8") or "{}")
    out = {}
    for a in (data.get("accounts") or []):
        aid = str(a.get("id") or "")
        if not aid:
            continue
        try:
            sp = round(float(a.get("spend") or 0), 2)
        except Exception:
            sp = 0.0
        out[aid] = {"label": a.get("label") or aid, "spend": sp}
    return out, (since, until)


def sincronizar(sb, host, ano, meses=None):
    """Busca na Meta e guarda o gasto por conta/mês. Só sobrescreve o mês que
    respondeu — falha de um mês nunca zera o histórico dos outros."""
    hoje = datetime.now(timezone.utc).date()
    ate = hoje.month if ano == hoje.year else 12
    alvo = meses or list(range(1, ate + 1))
    todos = read_kv(sb, KV_REAL)
    ano_k = str(ano)
    cell = todos.get(ano_k) if isinstance(todos.get(ano_k), dict) else {}
    ok, erros = [], []
    for m in alvo:
        try:
            porconta, janela = _fetch_mes(host, ano, m, hoje)
            if porconta:
                cell[str(m)] = porconta
                ok.append({"mes": m, "contas": len(porconta),
                           "total": round(sum(v["spend"] for v in porconta.values()), 2),
                           "janela": f"{janela[0]}→{janela[1]}"})
            else:
                erros.append({"mes": m, "erro": "sem contas na resposta"})
        except Exception as e:
            erros.append({"mes": m, "erro": str(e)[:120]})
    todos[ano_k] = cell
    todos["_sync"] = {"em": datetime.now(timezone.utc).isoformat(), "ano": ano,
                      "meses_ok": [o["mes"] for o in ok], "erros": len(erros)}
    if ok:                      # não grava se NADA veio (leitura falha ≠ gasto zero)
        write_kv(sb, KV_REAL, todos)
    return {"ok": ok, "erros": erros}


def consolidar(sb, ano):
    """Junta real (Meta) + override manual → o valor EFETIVO de cada marca/mês."""
    mapa = _mapa(sb)
    real_kv = (read_kv(sb, KV_REAL).get(str(ano)) or {})
    over_kv = (read_kv(sb, KV_OVER).get(str(ano)) or {})
    real, over, efet, detalhe = {}, {}, {}, {}
    for l in LINHA_IDS:
        real[l], over[l], efet[l], detalhe[l] = {}, {}, {}, {}
        contas = mapa.get(l) or []
        for m in range(1, 13):
            porconta = real_kv.get(str(m)) or {}
            soma, det = 0.0, []
            for aid in contas:
                c = porconta.get(aid)
                if c:
                    soma += float(c.get("spend") or 0)
                    det.append({"id": aid, "label": c.get("label"), "spend": round(float(c.get("spend") or 0), 2)})
            real[l][m] = round(soma, 2)
            detalhe[l][m] = det
            ov = (over_kv.get(l) or {}).get(str(m))
            if ov not in (None, ""):
                try:
                    over[l][m] = round(float(ov), 2)
                except Exception:
                    pass
            efet[l][m] = over[l].get(m, real[l][m])
    return {"real": real, "override": over, "efetivo": efet, "detalhe": detalhe, "mapa": mapa}


def aplicar_nos_custos(sb, ano, efetivo):
    """Escreve o valor EFETIVO de cada marca/mês no item de custo 'traf_<marca>'.
    É isto que faz o tráfego entrar sozinho na conta cheia, no break-even e no
    Plano de Resgate: uma fonte só (Meta → item de custo), sem digitação.
    Só grava se algo mudou de verdade — evita changelog e audit inúteis.

    v85.17 — EXCLUSÃO MANUAL MANDA: em 10/ago o Paulo apagou os itens traf_* de
    propósito e o sync os recriaria no ciclo seguinte, desfazendo a decisão dele.
    Agora, se os itens sumiram DEPOIS de já terem sido aplicados uma vez, o
    espelhamento se pausa sozinho (flag no kv do mapa) e fica pausado até alguém
    religar salvando o mapa de contas pela tela."""
    mapa_kv = read_kv(sb, KV_MAPA)
    if mapa_kv.get("_espelhar") is False:
        return {"aplicado": False, "motivo": "espelhamento pausado (itens de tráfego apagados manualmente)"}
    allkv = read_kv(sb, "viab_custos_orcado")
    cell = allkv.get(str(ano)) if isinstance(allkv.get(str(ano)), dict) else {}
    itens = cell.get("itens") if isinstance(cell.get("itens"), list) else []
    if not itens:
        return {"aplicado": False, "motivo": "custos do ano ainda não cadastrados"}
    tem_traf = any(str(it.get("id") or "").startswith("traf_") for it in itens)
    # já aplicou antes = flag OU um sync já registrado (cobre o estado anterior à flag,
    # quando o Paulo apagou os itens antes de _ja_aplicou existir)
    ja_aplicou = bool(mapa_kv.get("_ja_aplicou")) or bool(read_kv(sb, KV_REAL).get("_sync"))
    if not tem_traf and ja_aplicou:
        mapa_kv["_espelhar"] = False
        write_kv(sb, KV_MAPA, mapa_kv)
        return {"aplicado": False,
                "motivo": "itens traf_* foram APAGADOS pela tela — espelhamento pausado pra respeitar a exclusão (religa salvando o mapa de contas)"}
    nomes = {"conquista": "PSM Conquista", "map": "PSM M.A.P", "terceiros": "PSM Terceiros", "locacoes": "PSM Locações"}
    mudou = []
    for marca in LINHA_IDS:
        meses = efetivo.get(marca) or {}
        novo_pm = {str(m): round(float(v), 2) for m, v in meses.items() if float(v or 0) > 0}
        idx = next((i for i, it in enumerate(itens) if it.get("id") == f"traf_{marca}"), None)
        if idx is None:
            if not novo_pm:
                continue
            itens.append({"id": f"traf_{marca}", "desc": f"Tráfego pago · {nomes.get(marca, marca)} (Meta, automático)",
                          "cat": "Tráfego pago", "classe": "fixo", "aloc": marca, "rateio": "igual",
                          "valor": 0, "meses": None, "linhas": [], "pesos": None,
                          "por_mes": novo_pm, "period": "mensal", "pgto": None})
            mudou.append(marca)
        else:
            atual = itens[idx].get("por_mes") or {}
            if {k: round(float(v or 0), 2) for k, v in atual.items() if float(v or 0) > 0} != novo_pm:
                itens[idx]["por_mes"] = novo_pm
                itens[idx]["valor"] = 0
                itens[idx]["meses"] = None
                itens[idx]["classe"] = "fixo"
                itens[idx]["period"] = "mensal"
                itens[idx]["desc"] = f"Tráfego pago · {nomes.get(marca, marca)} (Meta, automático)"
                mudou.append(marca)
    if not mudou:
        return {"aplicado": False, "motivo": "já estava igual"}
    cell["itens"] = itens
    allkv[str(ano)] = cell
    write_kv(sb, "viab_custos_orcado", allkv)
    if not mapa_kv.get("_ja_aplicou"):
        mapa_kv["_ja_aplicou"] = True
        write_kv(sb, KV_MAPA, mapa_kv)
    return {"aplicado": True, "marcas": mudou}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def _cron_ok(self):
        s = os.environ.get("CRON_SECRET", "").strip()
        return bool(s) and (self.headers.get("Authorization") or "") == f"Bearer {s}"

    def do_GET(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            qs = {}
        try:
            ano = int(qs.get("ano") or datetime.now(timezone.utc).year)
        except Exception:
            ano = datetime.now(timezone.utc).year
        host = (self.headers.get("Host") or "www.housepsm.com.br").split(",")[0].strip()
        cron = self._cron_ok()
        if not cron:
            try:
                actor = require_user(self, min_lvl=8)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
            if not can_viab(sb, actor):
                return self._send(403, {"ok": False, "error": "sem permissão"})
        sync = None
        if cron or qs.get("sync") == "1":
            sync = sincronizar(sb, host, ano)
        base = consolidar(sb, ano)
        if sync:                       # espelha o efetivo nos itens de custo
            sync["custos"] = aplicar_nos_custos(sb, ano, base["efetivo"])
        contas = {}
        for m, porconta in (read_kv(sb, KV_REAL).get(str(ano)) or {}).items():
            for aid, c in (porconta or {}).items():
                contas[aid] = c.get("label") or aid
        return self._send(200, {"ok": True, "ano": ano, **base, "contas": contas,
                                "sync": sync, "atualizado_em": (read_kv(sb, KV_REAL).get("_sync") or {})})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=8)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if not can_viab(sb, actor):
            return self._send(403, {"ok": False, "error": "sem permissão"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        try:
            ano = int(body.get("ano") or datetime.now(timezone.utc).year)
        except Exception:
            ano = datetime.now(timezone.utc).year

        # 1) salvar o mapa conta → marca — religa o espelhamento (intenção explícita)
        if isinstance(body.get("mapa"), dict):
            antes = read_kv(sb, KV_MAPA)
            limpo = {"_ja_aplicou": bool(antes.get("_ja_aplicou")), "_espelhar": True}
            for k, v in body["mapa"].items():
                if k in LINHA_IDS and isinstance(v, list):
                    limpo[k] = [str(a)[:60] for a in v if str(a).startswith("act_")][:10]
            write_kv(sb, KV_MAPA, limpo)
            audit(self, actor, "viab.trafego_mapa", target_type="shared_kv", target_id=KV_MAPA,
                  before=antes, after=limpo)
            return self._send(200, {"ok": True, **consolidar(sb, ano)})

        # 2) override manual de um mês (valor None/'' limpa e volta pro real da Meta)
        marca = (body.get("marca") or "").strip().lower()
        if marca not in LINHA_IDS:
            return self._send(400, {"ok": False, "error": "marca inválida"})
        try:
            mes = int(body.get("mes") or 0)
        except Exception:
            mes = 0
        if not (1 <= mes <= 12):
            return self._send(400, {"ok": False, "error": "mês inválido"})
        allkv = read_kv(sb, KV_OVER)
        cell = allkv.get(str(ano)) if isinstance(allkv.get(str(ano)), dict) else {}
        marca_cell = cell.get(marca) if isinstance(cell.get(marca), dict) else {}
        antes = marca_cell.get(str(mes))
        v = body.get("valor")
        if v in (None, "", "null"):
            marca_cell.pop(str(mes), None)
        else:
            try:
                marca_cell[str(mes)] = round(float(v), 2)
            except Exception:
                return self._send(400, {"ok": False, "error": "valor inválido"})
        cell[marca] = marca_cell
        allkv[str(ano)] = cell
        write_kv(sb, KV_OVER, allkv)
        audit(self, actor, "viab.trafego_override", target_type="shared_kv", target_id=f"{ano}/{marca}/{mes}",
              before={"valor": antes}, after={"valor": marca_cell.get(str(mes))})
        base = consolidar(sb, ano)
        base["custos"] = aplicar_nos_custos(sb, ano, base["efetivo"])   # edição reflete no custo na hora
        return self._send(200, {"ok": True, **base})
