"""
GET /api/v3/marketing/crm_metrics[?date_preset=last_30d | ?since=YYYY-MM-DD&until=YYYY-MM-DD]
Header: Authorization: Bearer <token>

Métricas de vendas derivadas do RD CRM (tabela `deals` já sincronizada no
Postgres pelo cron). Recorta pelo mesmo período do Meta Ads e devolve agregados
por MARCA (pipeline → conquista / imoveis / locacao) + global, prontos pra
cruzar com o gasto de mídia no cockpit:

  • VGV (won), vendas, ticket médio, perdas, taxa de conversão
  • ciclo médio de venda (created → closed) em dias
  • tempo até 1ª atividade (aprox.) — proxy de SLA/Time-to-Action
  • Contact Rate (saiu da etapa de entrada) — coorte de leads criados no período
  • Show-up / Visita Rate (chegou à etapa de visita)
  • Motivos de perda (concentração) + Trash Rate (descarte/sem perfil)
  • Origem (deal_source) — quanto veio de mídia paga
  • Ranking de corretores (vendas / VGV / ciclo) — Motor de Vendas / War Arena

CAC, CPO, ROAS Imobiliário e CPL-R são calculados no FRONTEND cruzando estes
números com o gasto Meta por marca (1 conta Meta = 1 marca).

Requer Líder (lvl>=5). Sem mutação → sem audit.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import re
import urllib.parse
from datetime import datetime, timezone, timedelta, date
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore


# ─── Período (alinhado aos presets do Meta) ────────────────────────────────
def _window(params):
    """Retorna (since_date, until_date) como date, a partir de date_preset ou since/until."""
    today = date.today()
    if params.get("since") and params.get("until"):
        try:
            s = datetime.fromisoformat(params["since"]).date()
            u = datetime.fromisoformat(params["until"]).date()
            return s, u
        except Exception:
            pass
    preset = (params.get("date_preset") or "last_30d").strip()
    if preset == "today":
        return today, today
    if preset == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if preset == "last_7d":
        return today - timedelta(days=7), today
    if preset == "last_14d":
        return today - timedelta(days=14), today
    if preset == "last_30d":
        return today - timedelta(days=30), today
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    return today - timedelta(days=30), today


# ─── Classificação de marca por pipeline ───────────────────────────────────
def _brand(pipeline_name):
    s = (pipeline_name or "").lower()
    if re.search(r"conquista|mcmv|minha casa|1[ºo]\s*im[óo]vel|primeiro im", s):
        return "conquista"
    if re.search(r"loca|aluguel|locaç", s):
        return "locacao"
    # carteira/prospecção/SDR de captação não é funil de venda de cliente
    if re.search(r"carteira|prospec|capta|sdr", s):
        return "captacao"
    return "imoveis"


BRAND_LABEL = {
    "conquista": "PSM Conquista (MCMV)",
    "imoveis":   "PSM Imóveis (Alto Padrão)",
    "locacao":   "Locação",
    "captacao":  "Captação / Prospecção",
}


# ─── Helpers RD raw ─────────────────────────────────────────────────────────
def _parse_dt(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


def _lost_reason(raw):
    r = (raw or {}).get("deal_lost_reason")
    if isinstance(r, dict):
        return (r.get("name") or "").strip() or None
    if isinstance(r, str):
        return r.strip() or None
    return None


def _source(raw):
    s = (raw or {}).get("deal_source")
    if isinstance(s, dict):
        return (s.get("name") or "").strip() or None
    if isinstance(s, str):
        return s.strip() or None
    return None


def _last_activity(raw):
    return _parse_dt((raw or {}).get("last_activity_at") or (raw or {}).get("updated_at"))


TRASH_RE = re.compile(
    r"sem perfil|fora do perfil|n[ãa]o.*perfil|descart|duplicad|inv[áa]lid|"
    r"engano|trote|curios|n[ãa]o.*qualific|spam|teste|errad|sem renda|n[ãa]o.*renda|"
    r"sem interesse|desqualific",
    re.I,
)
VISITA_RE = re.compile(r"visita|reuni[ãa]o|atendiment|apresenta|tour|agendad|agenda", re.I)


def _is_paid_source(src):
    if not src:
        return False
    return bool(re.search(r"meta|facebook|instagram|fb|ig|ads|tr[áa]fego|paga|google|mídia|midia|campanha", src, re.I))


# ─── Paginação Supabase ─────────────────────────────────────────────────────
def _fetch_period_deals(sb, since_d, until_d):
    """Deals que tocam o período (criados OU fechados dentro da janela), com rd_raw."""
    since_iso = since_d.isoformat()
    until_iso = (until_d + timedelta(days=1)).isoformat()  # inclusivo no dia final
    cols = "id,name,amount,win,closed_at,created_at_rd,updated_at_rd,pipeline_name,stage_name,user_email,user_id,rd_raw"
    out = []
    page = 0
    size = 1000
    while page < 12:  # teto 12k linhas
        try:
            q = (sb.table("deals").select(cols)
                 .or_(f"created_at_rd.gte.{since_iso},closed_at.gte.{since_iso}")
                 .range(page * size, page * size + size - 1))
            rows = q.execute().data or []
        except Exception as e:
            return out, str(e)
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out, None


# ─── Etapas (posição de entrada e de visita por pipeline) ───────────────────
def _stage_positions(sb):
    """{pipeline_key: {'entry': pos, 'visita': pos, 'names': {name_lower: pos}}}"""
    try:
        stages = sb.table("rd_stages").select("*").execute().data or []
        pipes = sb.table("rd_pipelines").select("*").execute().data or []
    except Exception:
        return {}, {}
    # mapa pipeline_id -> nome
    pname = {}
    for p in pipes:
        pid = str(p.get("id") or p.get("external_id") or "")
        if pid:
            pname[pid] = p.get("name")
        if p.get("external_id"):
            pname[str(p["external_id"])] = p.get("name")
    by_pipe = defaultdict(list)
    for s in stages:
        pid = str(s.get("pipeline_id") or s.get("rd_pipeline_id") or s.get("pipeline") or "")
        by_pipe[pid].append(s)
    info = {}
    for pid, st in by_pipe.items():
        try:
            st.sort(key=lambda x: int(x.get("position") or x.get("order") or 0))
        except Exception:
            pass
        names = {}
        visita_pos = None
        for s in st:
            nm = (s.get("name") or "").strip().lower()
            pos = int(s.get("position") or s.get("order") or 0)
            names[nm] = pos
            if visita_pos is None and VISITA_RE.search(nm):
                visita_pos = pos
        entry_pos = min(names.values()) if names else 0
        info[pid] = {"entry": entry_pos, "visita": visita_pos, "names": names}
    return info, pname


def _median(vals):
    v = sorted(x for x in vals if x is not None)
    if not v:
        return None
    n = len(v)
    mid = n // 2
    return v[mid] if n % 2 else (v[mid - 1] + v[mid]) / 2.0


# ─── Agregação por marca ────────────────────────────────────────────────────
def _blank_brand():
    return {
        "vendas": 0, "vgv": 0.0, "perdas": 0,
        "leads_criados": 0, "leads_contatados": 0, "leads_visita": 0,
        "ciclo_dias": [], "sla_horas": [], "ticket_vals": [],
        "vgv_pago": 0.0, "vendas_pago": 0,
        "trash": 0,
        "motivos": defaultdict(int),
        "origens": defaultdict(int),
        "owners": defaultdict(lambda: {"vendas": 0, "vgv": 0.0, "perdas": 0, "ciclo": [], "nome": None}),
    }


def _amount(d):
    try:
        return float(d.get("amount") or 0)
    except Exception:
        return 0.0


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

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

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}

        since_d, until_d = _window(params)
        since_dt = datetime(since_d.year, since_d.month, since_d.day, tzinfo=timezone.utc)
        until_dt = datetime(until_d.year, until_d.month, until_d.day, 23, 59, 59, tzinfo=timezone.utc)

        deals, err = _fetch_period_deals(sb, since_d, until_d)
        if err:
            return self._send(502, {"ok": False, "error": "deals: " + err})

        stage_info, _pname = _stage_positions(sb)

        # nomes de corretores
        try:
            urows = sb.table("users").select("email,name").execute().data or []
            name_by_email = {(u.get("email") or "").lower(): u.get("name") for u in urows if u.get("email")}
        except Exception:
            name_by_email = {}

        brands = defaultdict(_blank_brand)
        # localizar posição da etapa do deal p/ contact/visita
        def _deal_stage_pos(raw, brand_key):
            stg = (raw or {}).get("deal_stage") or {}
            pid = str((((raw or {}).get("deal_pipeline") or {}).get("id")) or "")
            info = stage_info.get(pid)
            if not info:
                return None, None, None
            nm = (stg.get("name") or "").strip().lower()
            pos = info["names"].get(nm)
            return pos, info["entry"], info["visita"]

        for d in deals:
            raw = d.get("rd_raw") or {}
            brand = _brand(d.get("pipeline_name"))
            B = brands[brand]
            win = d.get("win")
            amt = _amount(d)
            created = _parse_dt(d.get("created_at_rd")) or _parse_dt(raw.get("created_at"))
            closed = _parse_dt(d.get("closed_at")) or _parse_dt(raw.get("closed_at"))
            src = _source(raw)
            owner_email = (d.get("user_email") or "").lower()
            owner_name = name_by_email.get(owner_email) or (raw.get("user") or {}).get("name") or owner_email or "—"

            in_close_win = closed is not None and since_dt <= closed <= until_dt
            in_create_win = created is not None and since_dt <= created <= until_dt

            # ── Vendas / VGV / perdas (fechados na janela) ──
            if in_close_win and win is True:
                B["vendas"] += 1
                B["vgv"] += amt
                B["ticket_vals"].append(amt)
                if created and closed:
                    B["ciclo_dias"].append((closed - created).total_seconds() / 86400.0)
                if src:
                    B["origens"][src] += 1
                if _is_paid_source(src):
                    B["vendas_pago"] += 1
                    B["vgv_pago"] += amt
                ow = B["owners"][owner_email]
                ow["vendas"] += 1
                ow["vgv"] += amt
                ow["nome"] = owner_name
                if created and closed:
                    ow["ciclo"].append((closed - created).total_seconds() / 86400.0)
            elif in_close_win and win is False:
                B["perdas"] += 1
                mr = _lost_reason(raw) or "Não informado"
                B["motivos"][mr] += 1
                if TRASH_RE.search(mr):
                    B["trash"] += 1
                B["owners"][owner_email]["perdas"] += 1
                B["owners"][owner_email]["nome"] = owner_name

            # ── Coorte de leads criados na janela (contact/visita/SLA/origem) ──
            if in_create_win:
                B["leads_criados"] += 1
                if src:
                    B["origens"].setdefault(src, B["origens"].get(src, 0))
                # SLA aprox: created → 1ª atividade (proxy = last_activity se plausível)
                la = _last_activity(raw)
                if la and created and la > created:
                    dh = (la - created).total_seconds() / 3600.0
                    if 0 < dh <= 168:  # até 7 dias, corta ruído
                        B["sla_horas"].append(dh)
                # Contact / Visita pelo estágio atual
                pos, entry, visita = _deal_stage_pos(raw, brand)
                if pos is not None and entry is not None:
                    if pos > entry or win is not None:
                        B["leads_contatados"] += 1
                    if visita is not None and pos >= visita:
                        B["leads_visita"] += 1
                elif win is not None:
                    B["leads_contatados"] += 1

        # ── Monta saída por marca ──
        def _serialize(key, B):
            vendas = B["vendas"]
            perdas = B["perdas"]
            criados = B["leads_criados"]
            conv = (vendas / (vendas + perdas) * 100) if (vendas + perdas) > 0 else None
            ticket = (B["vgv"] / vendas) if vendas else 0.0
            motivos = sorted(
                [{"motivo": k, "n": v, "pct": (v / perdas * 100) if perdas else 0} for k, v in B["motivos"].items()],
                key=lambda x: -x["n"]
            )
            origens = sorted(
                [{"origem": k, "n": v} for k, v in B["origens"].items() if v > 0],
                key=lambda x: -x["n"]
            )[:10]
            owners = sorted(
                [{"email": k, "nome": v["nome"], "vendas": v["vendas"], "vgv": v["vgv"],
                  "perdas": v["perdas"], "ciclo_dias": _median(v["ciclo"])}
                 for k, v in B["owners"].items() if (v["vendas"] or v["perdas"])],
                key=lambda x: (-x["vgv"], -x["vendas"])
            )
            return {
                "brand": key,
                "label": BRAND_LABEL.get(key, key),
                "vendas": vendas,
                "vgv": round(B["vgv"], 2),
                "perdas": perdas,
                "ticket_medio": round(ticket, 2),
                "taxa_conversao": round(conv, 1) if conv is not None else None,
                "ciclo_medio_dias": round(_median(B["ciclo_dias"]), 1) if B["ciclo_dias"] else None,
                "sla_horas_aprox": round(_median(B["sla_horas"]), 1) if B["sla_horas"] else None,
                "leads_criados": criados,
                "contact_rate": round(B["leads_contatados"] / criados * 100, 1) if criados else None,
                "visita_rate": round(B["leads_visita"] / B["leads_contatados"] * 100, 1) if B["leads_contatados"] else None,
                "trash_rate": round(B["trash"] / perdas * 100, 1) if perdas else None,
                "vgv_pago": round(B["vgv_pago"], 2),
                "vendas_pago": B["vendas_pago"],
                "motivos_perda": motivos[:8],
                "origens": origens,
                "ranking": owners[:15],
            }

        per_brand = {k: _serialize(k, v) for k, v in brands.items()}

        # ── Global (consolida marcas de venda; ignora 'captacao') ──
        venda_keys = [k for k in per_brand if k != "captacao"]
        g = {
            "vendas": sum(per_brand[k]["vendas"] for k in venda_keys),
            "vgv": round(sum(per_brand[k]["vgv"] for k in venda_keys), 2),
            "perdas": sum(per_brand[k]["perdas"] for k in venda_keys),
            "leads_criados": sum(per_brand[k]["leads_criados"] for k in venda_keys),
            "vgv_pago": round(sum(per_brand[k]["vgv_pago"] for k in venda_keys), 2),
            "vendas_pago": sum(per_brand[k]["vendas_pago"] for k in venda_keys),
        }
        g["ticket_medio"] = round(g["vgv"] / g["vendas"], 2) if g["vendas"] else 0.0
        g["taxa_conversao"] = round(g["vendas"] / (g["vendas"] + g["perdas"]) * 100, 1) if (g["vendas"] + g["perdas"]) else None

        # motivos de perda consolidados
        mg = defaultdict(int)
        for k in venda_keys:
            for m in per_brand[k]["motivos_perda"]:
                mg[m["motivo"]] += m["n"]
        g["motivos_perda"] = sorted(
            [{"motivo": k, "n": v, "pct": (v / g["perdas"] * 100) if g["perdas"] else 0} for k, v in mg.items()],
            key=lambda x: -x["n"]
        )[:8]

        # ranking global (todas as marcas de venda)
        rg = defaultdict(lambda: {"nome": None, "vendas": 0, "vgv": 0.0, "perdas": 0})
        for k in venda_keys:
            for o in per_brand[k]["ranking"]:
                r = rg[o["email"]]
                r["nome"] = o["nome"]
                r["vendas"] += o["vendas"]
                r["vgv"] += o["vgv"]
                r["perdas"] += o["perdas"]
        g["ranking"] = sorted(
            [{"email": k, **v, "vgv": round(v["vgv"], 2)} for k, v in rg.items()],
            key=lambda x: (-x["vgv"], -x["vendas"])
        )[:15]

        return self._send(200, {
            "ok": True,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                       "date_preset": params.get("date_preset")},
            "deals_scanned": len(deals),
            "global": g,
            "brands": per_brand,
            "v3_user_lvl": user.get("lvl"),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
