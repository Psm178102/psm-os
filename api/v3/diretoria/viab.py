"""
GET/POST /api/v3/diretoria/viab — Métricas de Viabilidade (Orçado × Realizado × Simulação). v82.0
Requer Sócio (lvl>=7). Dados sensíveis (financeiro).

Separação clara das 3 naturezas (mata a confusão do painel antigo):
  • ORÇADO   — plano mensal editável à mão (baseline oficial). shared_kv 'viab_orcamento'.
  • REALIZADO — VGV/vendas REAIS do CRM (deals ganhos por funil→linha, por mês) +
                custo realizado LANÇADO À MÃO ('viab_custos_real'; trocável por NIBO
                quando houver API). Comissão = CALCULADA pela premissa (% do VGV real).
  • SNAPSHOTS — fechamento do mês congelado ('viab_snapshots'); auto (cron dia 1º) + manual.

Modelo shared_kv:
  viab_orcamento  = { "<ano>": { "<linha>": { "<mes 1..12>": {vgv,vendas,com_bruta_pct,
                      com_corretor_pct,com_senior_pct,aliquota_pct,custo_fixo,verba_mkt} } } }
  viab_custos_real= { "<ano>-<mes>": { "itens":[{desc,valor,linha}] } }
  viab_snapshots  = { "<ano>-<mes>": { fechado_em, fechado_por, auto, por_linha{...}, consolidado{...} } }

GET  ?ano=2026 → { ok, ano, linhas, defaults, orcamento, custos_real, snapshots, realizado }
     Cron: header Authorization: Bearer <CRON_SECRET> → fecha o MÊS ANTERIOR e retorna.
POST (lvl>=7) action:
  set_orcamento  {ano, linha, mes(1..12 ou 0=todos), campos:{...}}
  set_custo_real {ano, mes, itens:[{desc,valor,linha}]}
  fechar_mes     {ano, mes}     → congela snapshot (manual)
  reabrir_mes    {ano, mes}     → remove snapshot
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

# ── linhas (mesmas ids da tela de viabilidade) + defaults de premissa ──
LINHAS = [
    {"id": "map",       "nome": "PSM M.A.P",     "icon": "🏢", "cor": "#7c3aed"},
    {"id": "conquista", "nome": "PSM Conquista", "icon": "🏠", "cor": "#2563eb"},
    {"id": "terceiros", "nome": "PSM Terceiros", "icon": "🤝", "cor": "#0891b2"},
    {"id": "locacoes",  "nome": "PSM Locações",  "icon": "🔑", "cor": "#d97706"},
]
LINHA_IDS = [l["id"] for l in LINHAS]
DEFAULTS = {
    "map":       {"vgv": 0, "vendas": 0, "com_bruta_pct": 4.0,   "com_corretor_pct": 1.4, "com_senior_pct": 1.6, "aliquota_pct": 8.0, "custo_fixo": 0, "verba_mkt": 0},
    "conquista": {"vgv": 0, "vendas": 0, "com_bruta_pct": 5.0,   "com_corretor_pct": 2.0, "com_senior_pct": 1.0, "aliquota_pct": 8.0, "custo_fixo": 0, "verba_mkt": 0},
    "terceiros": {"vgv": 0, "vendas": 0, "com_bruta_pct": 6.0,   "com_corretor_pct": 3.0, "com_senior_pct": 1.0, "aliquota_pct": 8.0, "custo_fixo": 0, "verba_mkt": 0},
    "locacoes":  {"vgv": 0, "vendas": 0, "com_bruta_pct": 100.0, "com_corretor_pct": 30.0, "com_senior_pct": 0.0, "aliquota_pct": 8.0, "custo_fixo": 0, "verba_mkt": 0},
}
NUM_FIELDS = ["vgv", "vendas", "com_bruta_pct", "com_corretor_pct", "com_senior_pct", "aliquota_pct", "custo_fixo", "verba_mkt"]


def _frente_of(pn):
    p = (pn or "").upper()
    if "CONQUISTA" in p: return "conquista"
    if "LOCA" in p:      return "locacoes"
    if "TERCEIRO" in p:  return "terceiros"
    if "MAP" in p:       return "map"
    return "outros"


def read_kv(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def write_kv(sb, key, val):
    sb.table("shared_kv").upsert({"key": key, "value": val,
                                  "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()


def orc_for(orcamento, ano, linha, mes):
    """Premissa daquela linha/mês, herdando os defaults quando faltar campo."""
    base = dict(DEFAULTS.get(linha, DEFAULTS["map"]))
    try:
        cell = (((orcamento.get(str(ano)) or {}).get(linha) or {}).get(str(mes))) or {}
    except Exception:
        cell = {}
    if isinstance(cell, dict):
        for k in NUM_FIELDS:
            if cell.get(k) not in (None, ""):
                try: base[k] = float(cell[k])
                except Exception: pass
    return base


def custo_real_linha(custos_real, ano, mes):
    """Soma do custo realizado LANÇADO À MÃO por linha, no mês. Itens sem linha
    entram como 'geral' e são rateados igualmente entre as 4 linhas."""
    out = {i: 0.0 for i in LINHA_IDS}
    geral = 0.0
    cell = (custos_real or {}).get(f"{ano}-{mes}") or {}
    for it in (cell.get("itens") or []):
        try: v = float(it.get("valor") or 0)
        except Exception: v = 0.0
        ln = (it.get("linha") or "").strip().lower()
        if ln in out: out[ln] += v
        else: geral += v
    if geral:
        for i in out: out[i] += geral / len(LINHA_IDS)
    return out


def snapshot_linha(vgv, vendas, orc, custo):
    """Motor único de viabilidade (serve orçado E realizado — só muda a fonte)."""
    vgv = float(vgv or 0); vendas = int(vendas or 0)
    receita = vgv * orc["com_bruta_pct"] / 100.0            # comissão bruta PSM
    com_corr = vgv * orc["com_corretor_pct"] / 100.0
    com_sen = vgv * orc["com_senior_pct"] / 100.0
    imposto = receita * orc["aliquota_pct"] / 100.0
    custo = float(custo or 0) + float(orc.get("verba_mkt") or 0)
    lucro = receita - com_corr - com_sen - imposto - custo
    return {"vgv": round(vgv, 2), "vendas": vendas, "receita": round(receita, 2),
            "com_corretor": round(com_corr, 2), "com_senior": round(com_sen, 2),
            "imposto": round(imposto, 2), "custo": round(custo, 2),
            "lucro": round(lucro, 2), "ticket": round(vgv / vendas, 2) if vendas else 0.0,
            "margem": round(lucro / vgv * 100, 1) if vgv else 0.0}


def realizado_ano(sb, ano):
    """VGV/vendas REAIS do CRM por linha × mês (1..12) — deals ganhos do ano."""
    real = {i: {str(m): {"vgv": 0.0, "vendas": 0} for m in range(1, 13)} for i in LINHA_IDS}
    try:
        dd = sb.table("deals").select("amount,closed_at,pipeline_name").eq("win", True) \
            .gte("closed_at", f"{ano}-01-01T00:00:00+00:00") \
            .lt("closed_at", f"{ano+1}-01-01T00:00:00+00:00").execute().data or []
        for d in dd:
            try: dt = datetime.fromisoformat(str(d.get("closed_at")).replace("Z", "+00:00"))
            except Exception: continue
            ln = _frente_of(d.get("pipeline_name"))
            if ln not in real or not (1 <= dt.month <= 12): continue
            real[ln][str(dt.month)]["vgv"] += float(d.get("amount") or 0)
            real[ln][str(dt.month)]["vendas"] += 1
    except Exception:
        pass
    return real


def meta_spend_ano(sb, ano):
    """Investimento REAL de Meta Ads por mês (tabela meta_ads_monthly, já alimentada
    pelo cron do Meta). Fonte automática de custo de marketing do realizado. v82.1"""
    out = {m: 0.0 for m in range(1, 13)}
    try:
        rows = sb.table("meta_ads_monthly").select("mes,spend").eq("ano", ano).execute().data or []
        for r in rows:
            m = int(r.get("mes") or 0)
            if 1 <= m <= 12: out[m] = float(r.get("spend") or 0)
    except Exception:
        pass
    return out


def fontes_auto_ano(sb, ano):
    """Custos que vêm AUTOMÁTICO de integrações, por mês.
    • meta_mkt = Meta Ads (real, ativo).  • nibo_fixo = GANCHO do NIBO: hoje 0
      (API não devolve nada); quando o upgrade da API pública estiver ativo, é só
      preencher aqui que o custo fixo entra automático em todo o realizado/snapshot."""
    meta = meta_spend_ano(sb, ano)
    return {str(m): {"meta_mkt": round(meta.get(m, 0.0), 2), "nibo_fixo": 0.0} for m in range(1, 13)}


def compute_snapshot(sb, ano, mes, fontes=None):
    """Fecha um mês: realizado do CRM + custo (manual + fontes automáticas) +
    comissão calculada → congela. Marketing real vem das fontes (não da premissa)."""
    orcamento = read_kv(sb, "viab_orcamento")
    custos_real = read_kv(sb, "viab_custos_real")
    real = realizado_ano(sb, ano)
    custos = custo_real_linha(custos_real, ano, mes)
    if fontes is None:
        fontes = fontes_auto_ano(sb, ano)
    fa = fontes.get(str(mes)) or {"meta_mkt": 0.0, "nibo_fixo": 0.0}
    auto_each = (float(fa.get("meta_mkt") or 0) + float(fa.get("nibo_fixo") or 0)) / len(LINHA_IDS)
    por_linha = {}
    cons = {"vgv": 0.0, "vendas": 0, "receita": 0.0, "com_corretor": 0.0, "com_senior": 0.0,
            "imposto": 0.0, "custo": 0.0, "lucro": 0.0}
    for i in LINHA_IDS:
        cell = real[i][str(mes)]
        orc = orc_for(orcamento, ano, i, mes)
        orc_real = dict(orc); orc_real["verba_mkt"] = 0.0   # mkt real vem das fontes, não da premissa
        s = snapshot_linha(cell["vgv"], cell["vendas"], orc_real, custos.get(i, 0.0) + auto_each)
        por_linha[i] = s
        for k in ("vgv", "vendas", "receita", "com_corretor", "com_senior", "imposto", "custo", "lucro"):
            cons[k] += s[k]
    cons["ticket"] = round(cons["vgv"] / cons["vendas"], 2) if cons["vendas"] else 0.0
    cons["margem"] = round(cons["lucro"] / cons["vgv"] * 100, 1) if cons["vgv"] else 0.0
    for k in ("vgv", "receita", "com_corretor", "com_senior", "imposto", "custo", "lucro"):
        cons[k] = round(cons[k], 2)
    return {"por_linha": por_linha, "consolidado": cons}


def store_snapshot(sb, ano, mes, auto=False, por="cron"):
    snaps = read_kv(sb, "viab_snapshots")
    body = compute_snapshot(sb, ano, mes)
    snaps[f"{ano}-{mes}"] = {**body, "fechado_em": datetime.now(timezone.utc).isoformat(),
                             "fechado_por": por, "auto": bool(auto)}
    write_kv(sb, "viab_snapshots", snaps)
    return snaps[f"{ano}-{mes}"]


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _cron_ok(self):
        secret = os.environ.get("CRON_SECRET")
        if not secret: return False
        auth = self.headers.get("Authorization") or self.headers.get("authorization") or ""
        return auth.lower().startswith("bearer ") and auth[7:].strip() == secret

    def do_GET(self):
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        # Cron do Vercel (dia 1º): fecha o mês anterior automaticamente.
        if self._cron_ok():
            now = datetime.now(timezone.utc)
            ano = now.year if now.month > 1 else now.year - 1
            mes = now.month - 1 if now.month > 1 else 12
            try:
                snap = store_snapshot(sb, ano, mes, auto=True, por="cron")
                return self._send(200, {"ok": True, "cron": True, "fechado": f"{ano}-{mes}", "consolidado": snap["consolidado"]})
            except Exception as e:
                return self._send(500, {"ok": False, "cron": True, "error": str(e)})
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            qs = {}
        try: ano = int(qs.get("ano") or datetime.now(timezone.utc).year)
        except Exception: ano = datetime.now(timezone.utc).year
        orcamento = read_kv(sb, "viab_orcamento")
        return self._send(200, {
            "ok": True, "ano": ano, "linhas": LINHAS, "defaults": DEFAULTS,
            "orcamento": orcamento.get(str(ano), {}),
            "custos_real": {k: v for k, v in read_kv(sb, "viab_custos_real").items() if k.startswith(f"{ano}-")},
            "snapshots": {k: v for k, v in read_kv(sb, "viab_snapshots").items() if k.startswith(f"{ano}-")},
            "realizado": realizado_ano(sb, ano),
            "fontes_auto": fontes_auto_ano(sb, ano),   # custos automáticos por mês (Meta real + gancho NIBO). v82.1
            "custos_orcado": (read_kv(sb, "viab_custos_orcado").get(str(ano)) or {}),   # custos orçados detalhados. v82.3
        })

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        action = (body.get("action") or "").strip()
        try: ano = int(body.get("ano") or datetime.now(timezone.utc).year)
        except Exception: ano = datetime.now(timezone.utc).year

        if action == "set_orcamento":
            linha = (body.get("linha") or "").strip().lower()
            if linha not in LINHA_IDS: return self._send(400, {"ok": False, "error": "linha inválida"})
            try: mes = int(body.get("mes") or 0)
            except Exception: mes = 0
            campos = body.get("campos") or {}
            clean = {}
            for k in NUM_FIELDS:
                if k in campos and campos[k] not in (None, ""):
                    try: clean[k] = float(campos[k])
                    except Exception: pass
            orcamento = read_kv(sb, "viab_orcamento")
            orcamento.setdefault(str(ano), {}).setdefault(linha, {})
            meses = range(1, 13) if mes == 0 else [mes]
            for m in meses:
                cur = orcamento[str(ano)][linha].get(str(m)) or {}
                cur.update(clean)
                orcamento[str(ano)][linha][str(m)] = cur
            write_kv(sb, "viab_orcamento", orcamento)
            audit(self, actor, "viab.set_orcamento", target_type="shared_kv", target_id=f"{ano}/{linha}/{mes}")
            return self._send(200, {"ok": True, "orcamento": orcamento.get(str(ano), {})})

        if action == "set_custo_real":
            try: mes = int(body.get("mes") or 0)
            except Exception: mes = 0
            if not (1 <= mes <= 12): return self._send(400, {"ok": False, "error": "mês inválido"})
            itens = []
            for it in (body.get("itens") or [])[:200]:
                if not isinstance(it, dict): continue
                try: v = float(it.get("valor") or 0)
                except Exception: v = 0.0
                ln = (it.get("linha") or "").strip().lower()
                itens.append({"desc": (it.get("desc") or "").strip()[:120], "valor": round(v, 2),
                              "linha": ln if ln in LINHA_IDS else ""})
            cr = read_kv(sb, "viab_custos_real")
            cr[f"{ano}-{mes}"] = {"itens": itens}
            write_kv(sb, "viab_custos_real", cr)
            audit(self, actor, "viab.set_custo_real", target_type="shared_kv", target_id=f"{ano}-{mes}")
            return self._send(200, {"ok": True, "custos_real": {k: v for k, v in cr.items() if k.startswith(f"{ano}-")}})

        if action == "fechar_mes":
            try: mes = int(body.get("mes") or 0)
            except Exception: mes = 0
            if not (1 <= mes <= 12): return self._send(400, {"ok": False, "error": "mês inválido"})
            try:
                snap = store_snapshot(sb, ano, mes, auto=False, por=(actor.get("name") or "manual"))
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "viab.fechar_mes", target_type="shared_kv", target_id=f"{ano}-{mes}")
            return self._send(200, {"ok": True, "snapshot": snap})

        if action == "reabrir_mes":
            try: mes = int(body.get("mes") or 0)
            except Exception: mes = 0
            snaps = read_kv(sb, "viab_snapshots")
            snaps.pop(f"{ano}-{mes}", None)
            write_kv(sb, "viab_snapshots", snaps)
            audit(self, actor, "viab.reabrir_mes", target_type="shared_kv", target_id=f"{ano}-{mes}")
            return self._send(200, {"ok": True})

        if action == "set_custos_orcado":   # custos orçados detalhados (fixo/variável/extra por empresa). v82.3
            itens = body.get("itens")
            if not isinstance(itens, list):
                return self._send(400, {"ok": False, "error": "itens inválido"})
            clean = []
            for it in itens[:400]:
                if not isinstance(it, dict): continue
                aloc = (it.get("aloc") or "compartilhado").strip().lower()
                if aloc not in LINHA_IDS and aloc != "compartilhado": aloc = "compartilhado"
                classe = (it.get("classe") or "fixo").strip().lower()
                if classe not in ("fixo", "variavel", "extra"): classe = "fixo"
                rateio = (it.get("rateio") or "igual").strip().lower()
                if rateio not in ("igual", "proporcional", "direto", "especifico", "manual"): rateio = "igual"
                try: valor = float(it.get("valor") or 0)
                except Exception: valor = 0.0
                meses = it.get("meses")
                meses = [int(m) for m in meses if str(m).isdigit() and 1 <= int(m) <= 12] if isinstance(meses, list) else None
                linhas = [l for l in (it.get("linhas") or []) if l in LINHA_IDS]
                pesos = it.get("pesos") if isinstance(it.get("pesos"), dict) else None
                por_mes = it.get("por_mes") if isinstance(it.get("por_mes"), dict) else None
                clean.append({
                    "id": (str(it.get("id") or "")).strip()[:40] or f"co_{len(clean)}",
                    "desc": (it.get("desc") or "").strip()[:120], "cat": (it.get("cat") or "Outros").strip()[:40],
                    "classe": classe, "aloc": aloc, "rateio": rateio, "valor": round(valor, 2),
                    "meses": meses, "linhas": linhas, "pesos": pesos, "por_mes": por_mes,
                })
            allkv = read_kv(sb, "viab_custos_orcado")
            allkv[str(ano)] = {"itens": clean}
            write_kv(sb, "viab_custos_orcado", allkv)
            audit(self, actor, "viab.set_custos_orcado", target_type="shared_kv", target_id=str(ano))
            return self._send(200, {"ok": True, "custos_orcado": allkv[str(ano)]})

        return self._send(400, {"ok": False, "error": "action inválida"})
