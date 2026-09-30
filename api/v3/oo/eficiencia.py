"""
⚙️ EFICIÊNCIA DA ESTEIRA — FUNIL CONQUISTA (v89.13, pedido do Paulo 30/set)

A planilha que o Kaue montava à mão no Notion ("Eficiência da Esteira",
"Métricas da META", "Produtividade individual") virando aba da Gestão
Comercial, alimentada sozinha e explicando o raciocínio passo a passo.

Duas perguntas, as mesmas do Notion dele:
  1. PELA CONVERSÃO — com o que entrou em cada etapa este mês, quanto DEVERIA
     ter chegado na etapa seguinte se a equipe convertesse no ritmo normal?
     Esperado = entradas da etapa × taxa de referência. Realizado × esperado
     mostra ONDE o funil está vazando (o "FALTAM 5,1 / 2,3 ACIMA" dele).
  2. PELA META — quantas vendas a meta de VGV pede e, de trás pra frente
     (funil reverso), quantas pastas, atendimentos, agendamentos e prospecções
     isso exige. Compara com o esperado ATÉ HOJE (proporcional aos dias úteis
     seg–sáb, Dicionário §8A) — no Notion a "meta até hoje" era a meta cheia.

O que muda em relação ao Notion (e a tela explica):
  • taxa de referência = 3 MESES FECHADOS anteriores da esteira do HUB (não um
    punhado de negócios: 5 pastas → 1 venda não é taxa, é sorte);
  • etapas = esteira do PSM HUB (Dicionário §5, mesmos números do HUB);
    venda = RD (Dicionário §1);
  • meta = tabela `metas` do House; meta de vendas = meta_vendas ou
    meta_vgv ÷ ticket médio real dos 3 meses de referência.

Quem entra: todo corretor com atividade na esteira do HUB no mês. A meta soma
quem é da equipe Conquista OU prospectou ≥ 10 na esteira no mês (ex.: João
Henrique em set/26, regra do Paulo) — quem só aparece com venda solta (MAP) não
infla a meta.

GATE: lvl>=5. Cache compartilhado 10 min por mês (banco frágil — 1 leitura de
users, 1 de metas, 1 de deals ganhos do mês; HUB tem cache próprio de 5 min).
"""
from http.server import BaseHTTPRequestHandler
import calendar
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from simulador import _kv_read, _kv_write  # type: ignore
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)
from _metricas_lib import (hub_esteira, dias_uteis, limites_utc, emails_fora,  # type: ignore
                           _norm, parse_dt)

CACHE_VER = "eficiencia_v1"
BRT = timezone(timedelta(hours=-3))
MESES_REF = 3
MIN_PROSP_META = 10     # quem prospectou isso na esteira do mês entra na meta mesmo sendo de outra equipe

# (chave no HUB, rótulo) — qualificação fica de fora da conta: o HUB só passou a registrar em set/26
ETAPAS = [("prospeccao", "Prospecções"), ("agendamento", "Agendamentos"),
          ("atendimento", "Atendimentos"), ("pasta", "Pastas"), ("venda", "Vendas")]
MESES_PT = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
            "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _mes_ant(y, m, n=1):
    for _ in range(n):
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return y, m


def _row_hub(r):
    return {"prospeccao": int(r.get("prospeccao") or 0), "qualificacao": int(r.get("qualificacao") or 0),
            "agendamento": int(r.get("agendamento") or 0), "atendimento": int(r.get("atendimento") or 0),
            "pasta": int(r.get("pasta") or 0), "venda": int(r.get("vendaCount") or 0),
            "vgv": float(r.get("vendaTotal") or 0)}


def _ativo(e):
    return any(e[k] for k in ("prospeccao", "agendamento", "atendimento", "pasta", "venda"))


def _soma(lst):
    out = {k: 0 for k in ("prospeccao", "qualificacao", "agendamento", "atendimento", "pasta", "venda")}
    out["vgv"] = 0.0
    for e in lst:
        for k in out:
            out[k] += e.get(k) or 0
    return out


def _taxas(tot):
    """taxa de cada etapa para a seguinte + amostra (de → para)."""
    out = []
    for i in range(len(ETAPAS) - 1):
        a, b = ETAPAS[i][0], ETAPAS[i + 1][0]
        out.append({"de": a, "para": b, "n_de": tot[a], "n_para": tot[b],
                    "taxa": (tot[b] / tot[a]) if tot[a] else None})
    return out


def _casar(nome_hub, membros):
    """agentName do HUB → usuário do House. Nome completo primeiro; primeiro nome
    só quando o HUB manda UMA palavra (senão "Fernanda Veneranda" casava com "Fernanda")."""
    nm = _norm(nome_hub)
    for u in membros:
        if _norm(u.get("name")) == nm:
            return u
    if nm and " " not in nm:
        c = [u for u in membros if _norm(u.get("name")).split(" ")[0] == nm]
        if len(c) == 1:
            return c[0]
    return None


def _reverso(vendas, taxas):
    """funil reverso: vendas → pastas → atendimentos → agendamentos → prospecções."""
    meta = {"venda": vendas}
    for t in reversed(taxas):
        prox = meta.get(t["para"])
        meta[t["de"]] = (prox / t["taxa"]) if (prox is not None and t["taxa"]) else None
    return meta


def compute(sb, y, m, hoje):
    avisos = []
    p1, pu = date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    corte = min(hoje, pu)
    du_mes = dias_uteis(p1, pu) or 1
    du_ate = dias_uteis(p1, corte) if corte >= p1 else 0
    fracao = du_ate / du_mes
    encerrado = hoje > pu

    # ── esteira do mês + 3 meses de referência (HUB) ─────────────────────────
    est = hub_esteira(sb, y, m)
    if not est.get("ok"):
        avisos.append("Esteira do PSM HUB indisponível: " + (est.get("erro") or "sem resposta"))
    rows_mes = [r for r in (est.get("rows") or []) if _ativo(_row_hub(r))]
    ref_meses, ref_rows = [], []
    for k in range(1, MESES_REF + 1):
        ry, rm = _mes_ant(y, m, k)
        e = hub_esteira(sb, ry, rm)
        if e.get("ok"):
            ref_meses.append(f"{MESES_PT[rm][:3]}/{str(ry)[2:]}")
            ref_rows += e.get("rows") or []
        else:
            avisos.append(f"Esteira de {MESES_PT[rm]}/{ry} indisponível — referência com menos meses")
    ref_meses.reverse()

    # ── pessoas, metas e vendas do RD ────────────────────────────────────────
    users = sb.table("users").select("id,name,email,team,role,status,is_service").execute().data or []
    membros = [u for u in users if not u.get("is_service") and u.get("name")]
    try:
        metas = sb.table("metas").select("corretor_id,meta_vgv,meta_vendas").eq("ano", y).eq("mes", m).execute().data or []
    except Exception:
        metas, _ = [], avisos.append("Não consegui ler a tabela de metas")
    meta_uid = {r["corretor_id"]: r for r in metas if r.get("corretor_id")}

    ini, fim = limites_utc(p1, pu)
    fora = emails_fora(sb)
    ganhos = sb.table("deals").select(
        "user_id,user_email,amount,closed_at,amt_total:rd_raw->amount_total"
    ).eq("win", True).gte("closed_at", ini.isoformat()).lt("closed_at", fim.isoformat()).execute().data or []
    vend_uid = {}
    for d in ganhos:
        if (d.get("user_email") or "").lower() in fora or not d.get("user_id"):
            continue
        v = float(d.get("amount") or 0) or float(d.get("amt_total") or 0)
        x = vend_uid.setdefault(d["user_id"], {"n": 0, "vgv": 0.0})
        x["n"] += 1
        x["vgv"] += v

    # ── referência da equipe ─────────────────────────────────────────────────
    ref_tot = _soma([_row_hub(r) for r in ref_rows])
    taxas = _taxas(ref_tot)
    ticket = (ref_tot["vgv"] / ref_tot["venda"]) if ref_tot["venda"] else None
    if not ticket:
        avisos.append("Sem venda na referência — meta de vendas só sai de meta_vendas")

    # referência por corretor (nome do HUB)
    ref_por = {}
    for r in ref_rows:
        ref_por.setdefault(_norm(r.get("agentName")), []).append(_row_hub(r))

    # ── corretores do mês ────────────────────────────────────────────────────
    pessoas, sem_par = [], []
    for r in rows_mes:
        e = _row_hub(r)
        u = _casar(r.get("agentName"), membros)
        if not u:
            sem_par.append(r.get("agentName") or "?")
        uid = u["id"] if u else None
        rd = vend_uid.get(uid) or {"n": 0, "vgv": 0.0}
        mt = meta_uid.get(uid) or {}
        na_meta = bool(u) and ((u.get("team") or "") == "conquista" or e["prospeccao"] >= MIN_PROSP_META)
        mvgv = float(mt.get("meta_vgv") or 0) if na_meta else 0.0
        mven = float(mt.get("meta_vendas") or 0) if na_meta else 0.0
        if na_meta and not mven and mvgv and ticket:
            mven = mvgv / ticket
        rt = _soma(ref_por.get(_norm(r.get("agentName")), []))
        pra1 = {}
        if rt["venda"]:
            for k, _ in ETAPAS[:-1]:
                pra1[k] = rt[k] / rt["venda"]
        pessoas.append({
            "nome": (u or {}).get("name") or r.get("agentName"), "hub_nome": r.get("agentName"),
            "equipe": (u or {}).get("team"), "na_meta": na_meta,
            "real": {"prospeccao": e["prospeccao"], "qualificacao": e["qualificacao"], "agendamento": e["agendamento"],
                     "atendimento": e["atendimento"], "pasta": e["pasta"], "venda": rd["n"], "vgv": rd["vgv"]},
            "hub_venda": e["venda"], "hub_vgv": e["vgv"],
            "meta_vgv": mvgv, "meta_vendas": mven,
            "meta": _reverso(mven, taxas) if mven else None,
            "ref": {"vendas": rt["venda"], "pra_1_venda": pra1, "prospeccao": rt["prospeccao"]},
        })
    if sem_par:
        avisos.append("Sem par no House (fora da meta, dentro da esteira): " + ", ".join(sem_par))
    div = [p["nome"] for p in pessoas if p["hub_venda"] != p["real"]["venda"]]
    if div:
        avisos.append("Vendas diferentes entre HUB e RD (vale o RD): " + ", ".join(div))

    # vendas do RD de quem está no mês mas não está na esteira não entram (outra frente)
    real = {k: sum(p["real"][k] for p in pessoas) for k in ("prospeccao", "qualificacao", "agendamento",
                                                          "atendimento", "pasta", "venda", "vgv")}
    meta_vgv = sum(p["meta_vgv"] for p in pessoas)
    meta_vendas = sum(p["meta_vendas"] for p in pessoas)
    meta = _reverso(meta_vendas, taxas) if meta_vendas else None

    # ── 1. pela conversão (o quadro do Kaue) ─────────────────────────────────
    conversao = []
    for t in taxas:
        entrou = real[t["de"]]
        esp = entrou * t["taxa"] if t["taxa"] is not None else None
        chegou = real[t["para"]]
        conversao.append({**t, "entrou": entrou, "esperado": esp, "realizado": chegou,
                          "diferenca": (chegou - esp) if esp is not None else None,
                          "desempenho": (chegou / esp) if esp else None,
                          "taxa_mes": (chegou / entrou) if entrou else None})
    gargalo = None
    cands = [c for c in conversao if c["desempenho"] is not None and c["esperado"] and c["esperado"] >= 1]
    if cands:
        g = min(cands, key=lambda c: c["desempenho"])
        if g["desempenho"] < 0.9:
            gargalo = g["de"] + ">" + g["para"]

    # ── 2. pela meta (funil reverso × ritmo) ─────────────────────────────────
    pela_meta = []
    for k, rot in ETAPAS:
        mm = (meta or {}).get(k)
        ate = mm * fracao if mm is not None else None
        proj = (real[k] / fracao) if fracao else None
        if encerrado:
            proj = real[k]
        pela_meta.append({"etapa": k, "rotulo": rot, "meta": mm, "ate_hoje": ate, "realizado": real[k],
                          "falta_hoje": (ate - real[k]) if ate is not None else None,
                          "projecao": proj,
                          "pct_ritmo": (real[k] / ate) if ate else None,
                          "por_dia": ((mm - real[k]) / max(du_mes - du_ate, 1)) if (mm is not None and not encerrado) else None})

    return {
        "mes": {"ano": y, "mes": m, "nome": f"{MESES_PT[m]}/{y}", "dias_uteis": du_mes, "dias_uteis_passados": du_ate,
                "fracao": fracao, "encerrado": encerrado, "hoje": corte.isoformat()},
        "referencia": {"meses": ref_meses, "total": ref_tot, "ticket": ticket},
        "taxas": taxas, "real": real, "meta_vgv": meta_vgv, "meta_vendas": meta_vendas, "meta": meta,
        "conversao": conversao, "gargalo": gargalo, "pela_meta": pela_meta,
        "pessoas": sorted(pessoas, key=lambda p: (-int(p["na_meta"]), -p["real"]["prospeccao"])),
        "avisos": avisos, "fonte": "etapas: esteira do PSM HUB · vendas: RD · metas: House",
        "calculado_em": datetime.now(timezone.utc).isoformat(),
    }


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        hoje = datetime.now(BRT).date()
        try:
            ref = date.fromisoformat(q["until"]) if q.get("until") else hoje
        except Exception:
            return self._send(400, {"ok": False, "error": "until inválido (YYYY-MM-DD)"})
        y, m = ref.year, ref.month
        ck = f"{CACHE_VER}:{y:04d}-{m:02d}"
        cached, _ok = _kv_read(sb, ck)
        if cached and cached.get("ts") and q.get("fresh") != "1":
            try:
                if (datetime.now(timezone.utc) - parse_dt(cached["ts"])).total_seconds() < 600:
                    return self._send(200, {"ok": True, "cached": True, **cached.get("data", {})})
            except Exception:
                pass
        try:
            data = compute(sb, y, m, hoje)
        except Exception as e:
            import traceback as _tb
            det = _tb.format_exc()
            print("[eficiencia] ERRO %s\n%s" % (e, det))
            corpo = {"ok": False, "error": "falha ao calcular a Eficiência da Esteira: %s" % e}
            if (user.get("lvl") or 0) >= 10:
                corpo["traceback"] = det.strip().splitlines()[-8:]
            return self._send(500, corpo)
        _kv_write(sb, ck, {"ts": datetime.now(timezone.utc).isoformat(), "data": data}, user.get("id"))
        return self._send(200, {"ok": True, "cached": False, **data})
