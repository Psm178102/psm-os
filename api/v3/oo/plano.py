"""
🧭 1:1 novo (v89.4) — Resultado no trimestre · Atividade por canal · Gargalo da fase.

Metodologia aprovada pelo Paulo em 30/09/2026:
  1. RESULTADO julgado no TRIMESTRE, meta só da aba Metas (faixa Poisson: venda do mês é ruído).
  2. ATIVIDADE julgada na SEMANA, por CANAL: o gestor combina no 1:1 quantas vendas espera de cada
     canal (mín. 3 canais — regra da PSM) e a conversão de cada um; entrada necessária =
     vendas ÷ conversão. Conversão MEDIDA quando o canal tem 50+ negócios maduros na fase; senão é a
     ESTIMADA que o gestor digitou (sempre marcada).
  3. GARGALO da FASE atual do corretor (troca de equipe zera o histórico: Conquista ≠ M.A.P).
     Funil da semana = o necessário pras vendas do plano com a conversão de REFERÊNCIA (pisos do motor).

GET  /api/v3/oo/plano?corretor_id=<id>[&ym=YYYY-MM]      gestor (lvl>=5) ou o próprio corretor
POST /api/v3/oo/plano  {corretor_id, ym, plano:{canais:[{canal,vendas,conv_pct}], vendas_min, ticket}}
POST /api/v3/oo/plano  {corretor_id, fase:{desde:'YYYY-MM-DD', equipe}}                       gestor

Armazenamento: shared_kv 'oo_plano:<cid>:<YYYY-MM>' e 'oo_fase:<cid>'. Leitura falhou ≠ não existe;
gravação é PATCH com changelog + audit_log.
"""
from http.server import BaseHTTPRequestHandler
import calendar
import json
import math
import os
import re
import sys
import unicodedata
import urllib.parse
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit, hoje_brt  # type: ignore
from _oo_lib import parse_dt  # type: ignore
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)
from _metricas_lib import (resumo as mx_resumo, mapa_origens, origem_categoria,  # type: ignore
                           agendamentos_de, visitas_de, propostas_de, CAT_LABEL, vgv_de)

# canais que entram no plano (categorias do Dicionário §2)
CANAIS = ("trafego_pago_psm", "trafego_pago_corretor", "organico_site", "carteira",
          "indicacao", "networking", "reativacao")
CANAL_LABEL = {**CAT_LABEL, "trafego_pago_psm": "Tráfego pago", "organico_site": "Tráfego orgânico",
               "carteira": "Carteira própria"}
CANAL_DESC = {
    "trafego_pago_psm": "lead distribuído pela PSM",
    "trafego_pago_corretor": "anúncio pago pelo corretor",
    "organico_site": "Instagram, site e WhatsApp",
    "carteira": "cliente da carteira do corretor",
    "indicacao": "indicação recebida e atendida",
    "networking": "contato novo de evento, parceiro ou grupo",
    "reativacao": "cliente antigo que voltou a conversar",
}
MIN_CANAIS = 3          # regra da PSM (Paulo, 30/09): nunca depender de menos de 3 canais
N_MEDIDA = 50           # negócios maduros no canal pra conversão virar "medida"
JORNADA_DIAS = {"map": 90, "conquista": 30}   # negócio só conta pra conversão depois de maduro
# referência de mercado por passagem (mesmos pisos do motor: simulador.CFG_MOTOR_DEFAULT)
REF = {"qualif": 0.60, "agend": 0.45, "visita": 0.60, "proposta": 0.35, "venda": 0.425}
PASS_LABEL = {"qualif": "Lead → qualificado", "agend": "Qualificado → agendamento",
              "visita": "Agendamento → visita realizada", "proposta": "Visita → proposta",
              "venda": "Proposta → venda"}
SEMANAS_MES = 4.3


def _num(x, d=0.0):
    try:
        v = float(x)
        return v if v == v else d
    except Exception:
        return d


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def pois_faixa(lam):
    """Faixa central ~85% (quantis 7,5%–92,5%) — a régua do Paulo: 3/tri → 1–6, 9/tri → 5–13."""
    def cdf(k):
        t = s = math.exp(-lam)
        for i in range(1, k + 1):
            t *= lam / i
            s += t
        return s
    if lam <= 0:
        return {"lo": 0, "hi": 0}
    lo = 0
    while cdf(lo) < 0.075:
        lo += 1
    hi = lo
    while cdf(hi) < 0.925 and hi < 500:
        hi += 1
    return {"lo": lo, "hi": hi}


def _kv(sb, key):
    """(value|None, read_ok)."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
    except Exception:
        return None, False
    if not rows:
        return None, True
    v = rows[0].get("value")
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = None
    return v, True


def _kv_put(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value}, on_conflict="key").execute()


def _ym(d):
    return f"{d.year:04d}-{d.month:02d}"


def _ym_add(ym, n):
    y, m = int(ym[:4]), int(ym[5:7]) + n
    while m > 12:
        y, m = y + 1, m - 12
    while m < 1:
        y, m = y - 1, m + 12
    return f"{y:04d}-{m:02d}"


def _mes_janela(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def _tri_de(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    q0 = (m - 1) // 3 * 3 + 1
    return [f"{y:04d}-{q0 + i:02d}" for i in range(3)], f"{q0 // 3 + 1}º tri {y}"


# ─── plano do mês ────────────────────────────────────────────────────────────
def ler_plano(sb, cid, ym):
    """Plano do mês; sem plano, herda o do mês anterior mais recente (até 3 meses). → (plano, origem_ym, ok)"""
    ok_all = True
    for k in range(0, 4):
        y = _ym_add(ym, -k)
        v, ok = _kv(sb, f"oo_plano:{cid}:{y}")
        ok_all = ok_all and ok
        if isinstance(v, dict) and v.get("canais"):
            return v, y, ok_all
    return None, None, ok_all


def validar_plano(p):
    """→ (plano_limpo, erros)."""
    erros, canais, vistos = [], [], set()
    for c in (p.get("canais") or []):
        k = str(c.get("canal") or "")
        if k not in CANAIS:
            erros.append(f"canal desconhecido: {k}")
            continue
        if k in vistos:
            erros.append(f"canal repetido: {CANAL_LABEL.get(k, k)}")
            continue
        vistos.add(k)
        v, cv = _num(c.get("vendas")), _num(c.get("conv_pct"))
        if v < 0 or cv < 0 or cv > 100:
            erros.append(f"{CANAL_LABEL.get(k, k)}: vendas e conversão têm que ser positivas (conversão até 100%)")
            continue
        if v > 0 and cv <= 0:
            erros.append(f"{CANAL_LABEL.get(k, k)}: informe a conversão estimada do canal")
            continue
        if v > 0:
            canais.append({"canal": k, "vendas": round(v, 2), "conv_pct": round(cv, 3)})
    if len(canais) < MIN_CANAIS:
        erros.append(f"O plano precisa de pelo menos {MIN_CANAIS} canais com venda esperada "
                     f"(regra da PSM: ninguém depende de menos de {MIN_CANAIS} canais). Tem {len(canais)}.")
    total = round(sum(c["vendas"] for c in canais), 2)
    vmin = _num(p.get("vendas_min"), total) or total
    if vmin > total:
        erros.append("O mínimo de vendas não pode passar da soma do plano.")
    return {"canais": canais, "vendas_meta": total, "vendas_min": round(min(vmin, total), 2),
            "ticket": round(_num(p.get("ticket")), 2)}, erros


# ─── dados do RD por corretor ────────────────────────────────────────────────
def _deals_corretor(sb, cid, email, since_iso):
    cols = "id,win,closed_at,created_at_rd,amount,stage_name,pipeline_name,user_id,user_email,oc:origem_cliente,src:rd_raw->deal_source->>name"
    out, seen = [], set()
    for fld, val in (("user_id", cid), ("user_email", email)):
        if not val:
            continue
        pg = 0
        while pg < 10:
            try:
                ch = (sb.table("deals").select(cols).eq(fld, val).gte("created_at_rd", since_iso)
                      .order("id").range(pg * 1000, pg * 1000 + 999).execute().data or [])
            except Exception:
                ch = []
            for r in ch:
                if r.get("id") not in seen:
                    seen.add(r.get("id"))
                    out.append(r)
            if len(ch) < 1000:
                break
            pg += 1
    return out


def _vendas_corretor(sb, cid, email, ini, fim):
    """Vendas (win) fechadas em [ini, fim] — por user_id ou e-mail."""
    out, seen = [], set()
    for fld, val in (("user_id", cid), ("user_email", email)):
        if not val:
            continue
        try:
            rows = (sb.table("deals").select("id,amount,closed_at,pipeline_name,user_email,amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique")
                    .eq(fld, val).eq("win", True).gte("closed_at", ini.isoformat())
                    .lt("closed_at", (fim + timedelta(days=1)).isoformat()).execute().data or [])
        except Exception:
            rows = []
        for r in rows:
            if r.get("id") not in seen:
                seen.add(r.get("id"))
                out.append(r)
    return out


_RX = [(4, re.compile(r"pasta|lan[çc]ament|proposta|negocia|aprova|contrato", re.I)),
       (3, re.compile(r"visita.*realizad|realizad.*visita|atendimento \(visita\)", re.I)),
       (2, re.compile(r"agendad|agendar|agendamento", re.I)),
       (1, re.compile(r"qualific", re.I))]


def _marco(nm):
    for k, rx in _RX:
        if rx.search(nm or ""):
            return k
    return 0


def coorte_fase(sb, deals):
    """Funil de coorte dos negócios da fase: cada negócio na etapa mais avançada que atingiu
    (atual + histórico). 'qualificado' exige etapa de qualificação — tentativa de contato não conta."""
    ids = [str(d["id"]) for d in deals if d.get("id")]
    mx = {i: 0 for i in ids}
    for d in deals:
        mx[str(d["id"])] = max(mx.get(str(d["id"]), 0), _marco(d.get("stage_name")))
    for i in range(0, len(ids), 150):
        try:
            rows = (sb.table("deal_stage_events").select("deal_id,stage_name")
                    .in_("deal_id", ids[i:i + 150]).neq("source", "backfill").execute().data or [])
        except Exception:
            rows = []
        for r in rows:
            k = str(r.get("deal_id"))
            mx[k] = max(mx.get(k, 0), _marco(r.get("stage_name")))
    win = {str(d["id"]) for d in deals if d.get("win") is True}
    n = [len(ids), 0, 0, 0, 0, len(win)]
    for i in ids:
        m = 5 if i in win else mx.get(i, 0)
        for k in range(1, 5):
            if m >= k:
                n[k] += 1
    return {"entrada": n[0], "qualif": n[1], "agend": n[2], "visita": n[3], "proposta": n[4], "venda": n[5]}


def gargalo_de(coorte):
    """Passagem mais abaixo da referência (só com 10+ negócios no degrau anterior)."""
    seq = [("qualif", "entrada"), ("agend", "qualif"), ("visita", "agend"), ("proposta", "visita"), ("venda", "proposta")]
    passos, pior = [], None
    for k, ant in seq:
        den, num = coorte[ant], coorte[k]
        taxa = num / den if den else None
        p = {"key": k, "label": PASS_LABEL[k], "de": den, "para": num,
             "taxa_pct": round(taxa * 100, 1) if taxa is not None else None,
             "ref_pct": round(REF[k] * 100, 1), "amostra_ok": den >= 10}
        passos.append(p)
        if taxa is not None and den >= 10:
            r = taxa / REF[k]
            if r < 1 and (pior is None or r < pior[0]):
                pior = (r, p)
    return passos, (pior[1] if pior else None)


def funil_necessario(vendas_mes):
    """Volume mensal por etapa pra fechar `vendas_mes` com a conversão de REFERÊNCIA."""
    prop = vendas_mes / REF["venda"]
    vis = prop / REF["proposta"]
    ag = vis / REF["visita"]
    return {"agendamentos": ag, "visitas": vis, "propostas": prop}


# ─── handler ─────────────────────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        cid = params.get("corretor_id") or user.get("id")
        if str(cid) != str(user.get("id")) and (user.get("lvl") or 0) < 5:
            return self._send(403, {"ok": False, "error": "sem permissão"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            return self._send(200, self._calc(sb, cid, params))
        except Exception as e:
            print(f"[oo/plano] erro: {e}")
            return self._send(500, {"ok": False, "error": f"cálculo falhou: {str(e)[:120]}"})

    def _calc(self, sb, cid, params):
        hoje = hoje_brt()
        ym = params.get("ym") or _ym(hoje)
        if not re.fullmatch(r"\d{4}-\d{2}", ym):
            ym = _ym(hoje)
        avisos, read_fail = [], False
        urows = sb.table("users").select("id,name,email,team,role,status").eq("id", cid).limit(1).execute().data or []
        if not urows:
            return {"ok": False, "error": "corretor não encontrado"}
        u = urows[0]
        email = (u.get("email") or "").lower()
        team = (u.get("team") or "").lower()
        tkey = "map" if "map" in team else ("conquista" if "conquista" in team else team)

        # ── fase ──
        fase, ok = _kv(sb, f"oo_fase:{cid}")
        read_fail |= not ok
        if not (isinstance(fase, dict) and fase.get("desde")):
            fase = {"desde": (hoje - timedelta(days=180)).isoformat(), "equipe": tkey, "definida": False}
            avisos.append({"tipo": "fase", "txt": "Data de início da fase não definida: usando os últimos 180 dias. Defina em 'Ajustar plano'."})
        else:
            fase = {**fase, "definida": True}
        fase_d = date.fromisoformat(str(fase["desde"])[:10])

        # ── plano ──
        plano, plano_ym, ok = ler_plano(sb, cid, ym)
        read_fail |= not ok
        mes_ini, mes_fim = _mes_janela(ym)
        dias_mes = (mes_fim - mes_ini).days + 1
        corrido = 1.0 if hoje > mes_fim else (0.0 if hoje < mes_ini else ((hoje - mes_ini).days + 1) / dias_mes)

        # entradas por canal: mês do plano e mês anterior (motor oficial — mesma foto das outras telas)
        def por_origem(ini, fim):
            try:
                r = mx_resumo(sb, {"since": ini.isoformat(), "until": fim.isoformat()})
                return ((r.get("pessoas") or {}).get(cid) or {}), True
            except Exception as e:
                print(f"[oo/plano] resumo {ini}..{fim}: {e}")
                return {}, False
        b_mes, ok1 = por_origem(mes_ini, min(mes_fim, hoje)) if hoje >= mes_ini else ({}, True)
        pm_ini, pm_fim = _mes_janela(_ym_add(ym, -1))
        b_ant, ok2 = por_origem(pm_ini, pm_fim)
        read_fail |= not (ok1 and ok2)

        # conversão MEDIDA por canal: negócios da fase já maduros (jornada da equipe)
        jornada = JORNADA_DIAS.get(tkey, 60)
        corte = hoje - timedelta(days=jornada)
        deals_fase = _deals_corretor(sb, cid, email, fase_d.isoformat())
        mapa = mapa_origens(sb)
        med = {}
        for d in deals_fase:
            cd = parse_dt(d.get("created_at_rd"))
            if not cd or cd.date() > corte:
                continue
            cat, _ass = origem_categoria((d.get("oc") or "").strip() or d.get("src"), mapa)
            m = med.setdefault(cat, [0, 0])
            m[0] += 1
            if d.get("win") is True:
                m[1] += 1

        canais_out, ativos = [], 0
        vmeta = vmin = 0.0
        if plano:
            vmeta = _num(plano.get("vendas_meta")) or sum(_num(c.get("vendas")) for c in plano["canais"])
            vmin = _num(plano.get("vendas_min")) or vmeta
            fmin = (vmin / vmeta) if vmeta else 1.0
            for c in plano["canais"]:
                k = c["canal"]
                n_med, v_med = med.get(k, [0, 0])
                if n_med >= N_MEDIDA:
                    conv, fonte = v_med / n_med * 100, "medida"
                else:
                    conv, fonte = _num(c.get("conv_pct")), "estimada"
                vend = _num(c.get("vendas"))
                meta_mes = vend / (conv / 100) if conv > 0 else 0
                min_mes = meta_mes * fmin
                real = int(((b_mes.get("por_origem") or {}).get(k)) or 0)
                ant = int(((b_ant.get("por_origem") or {}).get(k)) or 0)
                esp_meta, esp_min = meta_mes * corrido, min_mes * corrido
                st = "ok" if real >= math.floor(esp_meta) and esp_meta > 0 else ("warn" if real >= math.floor(esp_min) and esp_min > 0 else "err")
                if corrido == 0:
                    st = "futuro"
                if st in ("ok", "warn"):
                    ativos += 1
                canais_out.append({
                    "canal": k, "label": CANAL_LABEL.get(k, k), "desc": CANAL_DESC.get(k, ""),
                    "vendas": vend, "conv_pct": round(conv, 3), "conv_fonte": fonte,
                    "conv_estimada_pct": _num(c.get("conv_pct")), "amostra": n_med, "amostra_vendas": v_med,
                    "min_mes": math.ceil(min_mes), "meta_mes": math.ceil(meta_mes),
                    "meta_sem": math.ceil(meta_mes / SEMANAS_MES), "real_mes": real, "mes_anterior": ant,
                    "esperado_ate_hoje_min": round(esp_min, 1), "esperado_ate_hoje_meta": round(esp_meta, 1),
                    "status": st,
                })
        # canal com entrada mas fora do plano (transparência)
        fora_plano = []
        for k, n in (b_mes.get("por_origem") or {}).items():
            if n and k not in {c["canal"] for c in canais_out} and k != "nao_classificada":
                fora_plano.append({"canal": k, "label": CANAL_LABEL.get(k, k), "real_mes": n})

        tot = {"vendas": vmeta, "vendas_min": vmin,
               "min_mes": sum(c["min_mes"] for c in canais_out), "meta_mes": sum(c["meta_mes"] for c in canais_out),
               "meta_sem": sum(c["meta_sem"] for c in canais_out), "real_mes": sum(c["real_mes"] for c in canais_out),
               "mes_anterior": sum(c["mes_anterior"] for c in canais_out)}

        # ── resultado do trimestre (aba Metas) ──
        yms, tri_label = _tri_de(ym)
        t_ini, _x = _mes_janela(yms[0])
        _x, t_fim = _mes_janela(yms[-1])
        metas = {}
        try:
            for r in (sb.table("metas").select("mes,ano,meta_vgv,meta_vendas").eq("corretor_id", cid)
                      .eq("ano", int(yms[0][:4])).execute().data or []):
                metas[f"{int(r['ano']):04d}-{int(r['mes']):02d}"] = r
        except Exception:
            read_fail = True
        meta_vgv = sum(_num((metas.get(y) or {}).get("meta_vgv")) for y in yms)
        mv_aba = sum(_num((metas.get(y) or {}).get("meta_vendas")) for y in yms)
        if mv_aba > 0:
            meta_vendas, fonte_vendas = mv_aba, "aba Metas"
        elif vmeta > 0:
            meta_vendas, fonte_vendas = vmeta * 3, "plano de canais"
        else:
            meta_vendas, fonte_vendas = 0, None
        vendas_tri = _vendas_corretor(sb, cid, email, t_ini, min(t_fim, hoje))
        _vgv = vgv_de   # §1 Valor (mesma régua do motor)
        resultado = {
            "tri": tri_label, "meses": yms, "since": t_ini.isoformat(), "until": t_fim.isoformat(),
            "meta_vgv": meta_vgv, "real_vgv": round(sum(_vgv(r) for r in vendas_tri), 2),
            "meta_vendas": meta_vendas, "fonte_meta_vendas": fonte_vendas, "real_vendas": len(vendas_tri),
            "vendas": [{"data": (r.get("closed_at") or "")[:10], "vgv": _vgv(r), "funil": r.get("pipeline_name")} for r in vendas_tri],
            "faixa": pois_faixa(meta_vendas) if meta_vendas > 0 else None,
            "dias_passados": max(0, (min(hoje, t_fim) - t_ini).days + 1), "dias_tri": (t_fim - t_ini).days + 1,
        }
        # conflito VGV × vendas × ticket
        ticket = _num((plano or {}).get("ticket"))
        mv_mes = _num((metas.get(ym) or {}).get("meta_vgv"))
        if plano and ticket > 0 and mv_mes > 0 and vmeta > 0:
            lo, hi = vmin * ticket, vmeta * ticket
            if mv_mes < lo * 0.85 or mv_mes > hi * 1.15:
                avisos.append({"tipo": "vgv", "txt": (
                    f"A meta de VGV do mês na aba Metas (R$ {mv_mes:,.0f}) não acompanha o plano: "
                    f"{vmin:g} a {vmeta:g} vendas × ticket de R$ {ticket:,.0f} = R$ {lo:,.0f} a R$ {hi:,.0f}. "
                    "Ajuste a aba Metas ou o plano.").replace(",", ".")})

        # ── funil da semana (todos os canais) ──
        seg = hoje - timedelta(days=hoje.weekday())
        dom = seg + timedelta(days=6)
        b_sem, ok3 = por_origem(seg, hoje)
        read_fail |= not ok3
        nec = funil_necessario(vmeta) if vmeta else None
        funil_sem = []
        if nec:
            reais = {"agendamentos": agendamentos_de(b_sem) if b_sem else 0,
                     "visitas": visitas_de(b_sem) if b_sem else 0,
                     "propostas": propostas_de(b_sem) if b_sem else 0}
            dia_sem = (hoje - seg).days + 1
            for k, lbl in (("agendamentos", "Agendamentos"), ("visitas", "Visitas realizadas"), ("propostas", "Propostas")):
                meta_s = math.ceil(nec[k] / SEMANAS_MES)
                r = int(reais[k] or 0)
                esp = meta_s * dia_sem / 7
                funil_sem.append({"key": k, "label": lbl, "meta_sem": meta_s, "meta_mes": math.ceil(nec[k]),
                                  "real_sem": r, "status": "ok" if r >= math.floor(esp) else ("warn" if r >= math.floor(esp * 0.7) else "err")})

        # ── gargalo da fase (coorte) ──
        coorte = coorte_fase(sb, deals_fase) if deals_fase else None
        passos, gargalo = gargalo_de(coorte) if coorte else ([], None)

        return {
            "ok": True, "read_fail": read_fail, "hoje": hoje.isoformat(), "ym": ym,
            "corretor": {"id": cid, "name": u.get("name"), "team": tkey},
            "fase": fase, "avisos": avisos,
            "resultado": resultado,
            "plano": ({"ym_origem": plano_ym, "herdado": plano_ym != ym, "ticket": ticket,
                       "vendas_meta": vmeta, "vendas_min": vmin, "canais": canais_out, "total": tot,
                       "canais_ativos": ativos, "min_canais": MIN_CANAIS, "corrido_pct": round(corrido * 100, 1),
                       "fora_plano": fora_plano, "changelog": ((plano or {}).get("changelog") or [])[-10:][::-1]}
                      if plano else None),
            "canais_disponiveis": [{"canal": k, "label": CANAL_LABEL.get(k, k), "desc": CANAL_DESC.get(k, "")} for k in CANAIS],
            "funil_semana": {"since": seg.isoformat(), "until": dom.isoformat(), "linhas": funil_sem,
                             "ref": {k: round(v * 100, 1) for k, v in REF.items()}},
            "coorte": coorte, "passos": passos, "gargalo": gargalo, "jornada_dias": jornada,
        }

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cid = str(body.get("corretor_id") or "")
        if not cid:
            return self._send(400, {"ok": False, "error": "corretor_id obrigatório"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        quem = user.get("name") or user.get("id")
        agora = datetime.now(timezone.utc).isoformat()

        if isinstance(body.get("fase"), dict):
            f = body["fase"]
            try:
                desde = date.fromisoformat(str(f.get("desde"))[:10]).isoformat()
            except Exception:
                return self._send(400, {"ok": False, "error": "data de início da fase inválida"})
            antes, ok = _kv(sb, f"oo_fase:{cid}")
            if not ok:
                return self._send(503, {"ok": False, "error": "leitura falhou — nada gravado"})
            novo = {"desde": desde, "equipe": str(f.get("equipe") or (antes or {}).get("equipe") or ""),
                    "por": quem, "em": agora}
            _kv_put(sb, f"oo_fase:{cid}", novo)
            audit(self, user, "oo_fase_update", "oo_fase", cid, before=antes, after=novo)
            return self._send(200, {"ok": True, "fase": novo})

        ym = str(body.get("ym") or "")
        if not re.fullmatch(r"\d{4}-\d{2}", ym):
            return self._send(400, {"ok": False, "error": "ym (YYYY-MM) obrigatório"})
        limpo, erros = validar_plano(body.get("plano") or {})
        if erros:
            return self._send(422, {"ok": False, "error": erros[0], "erros": erros})
        antes, ok = _kv(sb, f"oo_plano:{cid}:{ym}")
        if not ok:
            return self._send(503, {"ok": False, "error": "leitura falhou — nada gravado"})
        log = list((antes or {}).get("changelog") or [])
        mud = []
        a_can = {c["canal"]: c for c in ((antes or {}).get("canais") or [])}
        for c in limpo["canais"]:
            a = a_can.pop(c["canal"], None)
            if not a:
                mud.append({"campo": CANAL_LABEL.get(c["canal"]), "de": None, "para": f"{c['vendas']:g} venda(s) a {c['conv_pct']:g}%"})
            elif (a.get("vendas"), a.get("conv_pct")) != (c["vendas"], c["conv_pct"]):
                mud.append({"campo": CANAL_LABEL.get(c["canal"]), "de": f"{a.get('vendas'):g} a {a.get('conv_pct'):g}%",
                            "para": f"{c['vendas']:g} a {c['conv_pct']:g}%"})
        for k in a_can:
            mud.append({"campo": CANAL_LABEL.get(k), "de": "no plano", "para": "removido"})
        for campo in ("vendas_min", "ticket"):
            if (antes or {}).get(campo) != limpo[campo]:
                mud.append({"campo": campo, "de": (antes or {}).get(campo), "para": limpo[campo]})
        log.append({"quem": quem, "quando": agora, "mudancas": mud})
        novo = {**limpo, "changelog": log[-50:], "atualizado_em": agora, "por": quem}
        _kv_put(sb, f"oo_plano:{cid}:{ym}", novo)
        audit(self, user, "oo_plano_update", "oo_plano", f"{cid}:{ym}", before=antes, after=limpo)
        return self._send(200, {"ok": True, "plano": novo})
