"""
GET /api/v3/arena/tv — Agregador do MODO TV / Arena (v81.9).

Calcula, numa passada só sobre os deals reais (RD sincronizado), tudo que os painéis
"inteligentes" da TV precisam — pra nunca divergir do Dashboard e nunca inventar número:

  placar    → VGV mês, vendas, ticket médio, pipeline, VGV/vendas do ano
  meta      → meta do mês (tabela metas, ano/mês atual)
  projecao  → dias úteis (decorridos/restantes), run-rate/dia, projeção de fechamento,
              quanto precisa por dia pra bater, e comparação com o MÊS ANTERIOR (mesmo ponto)
  destaques → maior ticket do mês, venda do dia, vendas/leads de hoje (tudo com corretor)
  hoje      → plantão de hoje + visitas agendadas hoje (tabelas plantoes/eventos)

Funil de conversão NÃO entra aqui — a TV chama /api/v3/marketing/crm_metrics (contagem
real com flag basis real|estimativa). Ranking vem de /api/v3/oo/overview. Eventos de
/api/v3/arena/live. Config de /api/v3/arena/tv_config.

GET (lvl >= 5): números GLOBAIS da casa (é um painel de parede gerenciado por gestor).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, calendar
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

BRT = timedelta(hours=-3)


def _all_deals(sb):
    rows, page = [], 0
    while True:
        q = sb.table("deals").select("id,amount,closed_at,created_at_rd,user_id,win,pipeline_name") \
            .order("id").range(page * 1000, page * 1000 + 999)
        chunk = q.execute().data or []
        rows.extend(chunk)
        if len(chunk) < 1000 or page >= 50:
            break
        page += 1
    return rows


def _users_map(sb):
    out = {}
    for u in (sb.table("users").select("id,name,team,ini,color,role").execute().data or []):
        out[u.get("id")] = u
    return out


def _meta_mes(sb, ano, mes):
    try:
        ms = sb.table("metas").select("meta_vgv,meta_vendas").eq("ano", ano).eq("mes", mes).execute().data or []
    except Exception:
        ms = []
    return (sum(float(m.get("meta_vgv") or 0) for m in ms),
            sum(int(m.get("meta_vendas") or 0) for m in ms))


def _dt(r):
    return r.get("closed_at") or r.get("created_at_rd") or ""


def _nome(umap, uid):
    u = umap.get(uid) or {}
    return u.get("name") or "—"


def _build(sb):
    now = datetime.now(timezone.utc)
    brt = now + BRT                       # "hoje" no fuso de Brasília
    y, m, dia_hoje = brt.year, brt.month, brt.day

    inicio_mes = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    inicio_ano = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    # início do dia de HOJE (BRT) convertido pra instante UTC
    hoje_ini = (brt.replace(hour=0, minute=0, second=0, microsecond=0) - BRT).isoformat()

    # mês anterior — mesmo ponto (até o mesmo dia do mês) p/ comparação justa
    prev_last = now.replace(day=1) - timedelta(days=1)
    py, pm = prev_last.year, prev_last.month
    prev_ini = datetime(py, pm, 1, tzinfo=timezone.utc).isoformat()
    cut_day = min(dia_hoje, calendar.monthrange(py, pm)[1])
    nxt = datetime(py, pm, cut_day, tzinfo=timezone.utc) + timedelta(days=1)
    prev_cut = nxt.isoformat()

    deals = _all_deals(sb)
    umap = _users_map(sb)
    wins = [r for r in deals if r.get("win") is True]
    abertos = [r for r in deals if r.get("win") is None]

    def inper(r, ini, end=None):
        d = _dt(r)
        return bool(d) and d >= ini and (end is None or d < end)

    def vgv(arr):
        return sum(float(r.get("amount") or 0) for r in arr)

    wins_mes = [r for r in wins if inper(r, inicio_mes)]
    wins_ano = [r for r in wins if inper(r, inicio_ano)]
    wins_hoje = [r for r in wins if inper(r, hoje_ini)]
    wins_prev_ponto = [r for r in wins if inper(r, prev_ini, prev_cut)]
    leads_hoje = [r for r in deals if (r.get("created_at_rd") or "") >= hoje_ini]

    vgv_mes = vgv(wins_mes)
    meta_vgv, meta_vendas = _meta_mes(sb, y, m)

    # ── dias úteis (seg–sex, sem feriados) ──
    dim = calendar.monthrange(y, m)[1]
    uteis_total = sum(1 for d in range(1, dim + 1) if datetime(y, m, d).weekday() < 5)
    uteis_dec = sum(1 for d in range(1, dia_hoje + 1) if datetime(y, m, d).weekday() < 5)
    uteis_rest = max(0, uteis_total - uteis_dec)
    run_rate = vgv_mes / uteis_dec if uteis_dec else 0
    projecao_fim = run_rate * uteis_total
    falta = max(0.0, meta_vgv - vgv_mes)
    precisa_dia = (falta / uteis_rest) if uteis_rest > 0 else falta

    prev_ponto_vgv = vgv(wins_prev_ponto)
    mom_pct = ((vgv_mes - prev_ponto_vgv) / prev_ponto_vgv * 100) if prev_ponto_vgv > 0 else None

    # ── destaques ──
    def deal_card(r):
        return {"amount": float(r.get("amount") or 0), "corretor": _nome(umap, r.get("user_id")),
                "marca": r.get("pipeline_name") or ""}
    maior_mes = max(wins_mes, key=lambda r: float(r.get("amount") or 0), default=None)
    venda_dia = max(wins_hoje, key=lambda r: float(r.get("amount") or 0), default=None)

    # ── hoje: plantão + visitas ──
    hoje_data = brt.date().isoformat()
    plantao, visitas = [], []
    try:
        for p in (sb.table("plantoes").select("corretor_id,periodo,status").eq("data", hoje_data).execute().data or []):
            if (p.get("status") or "").lower() in ("cancelado", "cancelada"):
                continue
            plantao.append({"corretor": _nome(umap, p.get("corretor_id")), "periodo": p.get("periodo") or ""})
    except Exception:
        pass
    try:
        evs = sb.table("eventos").select("titulo,hora_inicio,corretor_id,local,status,tipo") \
            .eq("data", hoje_data).eq("tipo", "visita").order("hora_inicio").execute().data or []
        for e in evs:
            if (e.get("status") or "").lower() == "cancelado":
                continue
            visitas.append({"hora": e.get("hora_inicio") or "", "titulo": e.get("titulo") or "Visita",
                            "corretor": _nome(umap, e.get("corretor_id")), "local": e.get("local") or ""})
    except Exception:
        pass

    return {
        "placar": {
            "vgv_mes": vgv_mes, "vendas_mes": len(wins_mes),
            "ticket_medio_mes": (vgv_mes / len(wins_mes)) if wins_mes else 0,
            "pipeline_vgv": vgv(abertos), "pipeline_count": len(abertos),
            "vgv_ano": vgv(wins_ano), "vendas_ano": len(wins_ano),
        },
        "meta": {"meta_vgv": meta_vgv, "meta_vendas": meta_vendas,
                 "pct": (vgv_mes / meta_vgv * 100) if meta_vgv > 0 else None, "falta": falta},
        "projecao": {
            "uteis_total": uteis_total, "uteis_decorridos": uteis_dec, "uteis_restantes": uteis_rest,
            "run_rate_dia": run_rate, "projecao_fim": projecao_fim, "precisa_por_dia": precisa_dia,
            "bate_meta": (projecao_fim >= meta_vgv) if meta_vgv > 0 else None,
            "mes_anterior_ponto_vgv": prev_ponto_vgv, "mom_pct": mom_pct,
        },
        "destaques": {
            "maior_ticket_mes": deal_card(maior_mes) if maior_mes else None,
            "venda_do_dia": deal_card(venda_dia) if venda_dia else None,
            "vendas_hoje": len(wins_hoje), "vgv_hoje": vgv(wins_hoje), "leads_hoje": len(leads_hoje),
        },
        "hoje": {"data": hoje_data, "plantao": plantao, "visitas": visitas[:12],
                 "visitas_total": len(visitas)},
        "gerado_em": now.isoformat(),
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            return self._send(200, {"ok": True, **_build(sb)})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
