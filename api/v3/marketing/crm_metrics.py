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
import time
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


# ─── Regras de marca config-driven (tabela brand_rules, Sprint 9.13) ─────────
# Carrega as regras do Postgres (cache 5min) em vez do regex chumbado. Se a
# tabela estiver vazia/indisponível, _classify cai no _brand() hardcoded acima —
# nunca quebra. Gerenciável sem deploy: adicionar marca = inserir linha.
_BRAND_CACHE = {"t": 0.0, "rules": None, "labels": None, "default": None}
_BRAND_TTL = 300.0


def _load_brand_rules(sb, force=False):
    """Retorna (rules, labels, default_key). rules=None sinaliza fallback hardcoded.
    rules = [(compiled_regex, brand_key), ...] por prioridade asc."""
    now = time.time()
    if (not force and _BRAND_CACHE["t"] and (now - _BRAND_CACHE["t"]) < _BRAND_TTL):
        return _BRAND_CACHE["rules"], _BRAND_CACHE["labels"], _BRAND_CACHE["default"]
    try:
        rows = (sb.table("brand_rules")
                .select("pattern,brand_key,label,priority,is_default,active")
                .eq("active", True).order("priority", desc=False).execute().data or [])
    except Exception:
        rows = []
    if not rows:
        _BRAND_CACHE.update({"t": now, "rules": None, "labels": None, "default": None})
        return None, None, None
    rules, labels, default_key = [], {}, None
    for r in rows:
        bk = r.get("brand_key")
        if not bk:
            continue
        labels.setdefault(bk, r.get("label") or bk)
        if r.get("is_default") and not default_key:
            default_key = bk
        pat = r.get("pattern")
        if pat:
            try:
                rules.append((re.compile(pat, re.I), bk))
            except Exception:
                continue  # regex inválido na config não derruba o resto
    default_key = default_key or "imoveis"
    _BRAND_CACHE.update({"t": now, "rules": rules, "labels": labels, "default": default_key})
    return rules, labels, default_key


def _classify(pipeline_name, rules, default_key):
    if rules is None:
        return _brand(pipeline_name)  # tabela vazia → regex hardcoded
    s = pipeline_name or ""
    for rx, bk in rules:
        if rx.search(s):
            return bk
    return default_key or "imoveis"


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


# ─── Atribuição honesta por canal (Sprint 9.14) ─────────────────────────────
# Classifica deal_source do RD num canal. Princípio: NUNCA inventar. Deal sem
# origem marcada → 'nao_atribuido' (jamais contado como pago). Origem marcada
# mas fora dos padrões → 'outro' (mostrada, não paga). Só meta+google são pagos.
CHANNEL_LABEL = {
    "meta":          "Meta (Facebook/Instagram)",
    "google":        "Google Ads",
    "portal":        "Portais (ZAP/VivaReal/OLX)",
    "indicacao":     "Indicação",
    "organico":      "Orgânico / Site",
    "direto":        "Direto / Telefone",
    "outro":         "Outro (origem marcada)",
    "nao_atribuido": "Não atribuído (sem origem no RD)",
}
PAID_CHANNELS = ("meta", "google")
_CH_PATTERNS = [
    ("meta",      re.compile(r"facebook|instagram|\bfb\b|\big\b|\bmeta\b|lead ?ads|fanpage", re.I)),
    ("google",    re.compile(r"google|adwords|youtube|\bgads\b|rede de pesquisa|\bsearch\b|display", re.I)),
    ("portal",    re.compile(r"zap|viva ?real|\bolx\b|imovelweb|im[óo]vel ?web|chaves ?na ?m[ãa]o|quintoandar|\bloft\b|portal", re.I)),
    ("indicacao", re.compile(r"indica|referr|amig|parceir|cliente antig", re.I)),
    ("organico",  re.compile(r"org[âa]nic|\bsite\b|google meu neg|\bgmn\b|\bmaps\b|whats", re.I)),
    ("direto",    re.compile(r"direto|telefone|balc[ãa]o|passante|walk|placa|fachada", re.I)),
]


def _channel(src):
    if not src:
        return "nao_atribuido"
    for key, rx in _CH_PATTERNS:
        if rx.search(src):
            return key
    return "outro"


# ─── Paginação Supabase ─────────────────────────────────────────────────────
def _fetch_period_deals(sb, since_d, until_d):
    """Deals que tocam o período (criados OU fechados dentro da janela), com rd_raw.
    Retorna (rows, erro, truncated). truncated=True se bateu o teto (sinaliza ao
    usuário — sem corte silencioso)."""
    since_iso = since_d.isoformat()
    cols = "id,name,amount,win,closed_at,created_at_rd,updated_at_rd,pipeline_name,stage_name,user_email,user_id,rd_raw"
    out = []
    page = 0
    size = 1000
    max_pages = 30  # teto 30k linhas
    truncated = False
    while True:
        try:
            q = (sb.table("deals").select(cols)
                 .or_(f"created_at_rd.gte.{since_iso},closed_at.gte.{since_iso}")
                 .range(page * size, page * size + size - 1))
            rows = q.execute().data or []
        except Exception as e:
            return out, str(e), truncated
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
        if page >= max_pages:
            truncated = True  # ainda havia mais — avisa em vez de cortar calado
            break
    return out, None, truncated


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


# ─── Métricas REAIS a partir de deal_stage_events ───────────────────────────
def _events_for_deals(sb, deal_ids):
    """{deal_id: [(stage_position, stage_name_lower, occurred_dt), ...]} — só eventos
    capturados de verdade (exclui source='backfill')."""
    out = defaultdict(list)
    ids = [str(x) for x in deal_ids if x]
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        try:
            rows = (sb.table("deal_stage_events")
                    .select("deal_id,stage_position,stage_name,occurred_at,source")
                    .in_("deal_id", chunk)
                    .neq("source", "backfill")
                    .execute().data or [])
        except Exception:
            rows = []
        for r in rows:
            out[str(r.get("deal_id"))].append(
                (r.get("stage_position"), (r.get("stage_name") or "").lower(), _parse_dt(r.get("occurred_at")))
            )
    return out


def _real_brand_metrics(cohort_brand, events_by_deal, stage_info):
    """Calcula contact_rate / visita_rate / SLA REAIS de uma coorte de leads (criados
    na janela), só com eventos capturados. cohort_brand: {deal_id: {created, pid}}."""
    sla = []
    contacted = 0
    visita = 0
    n = len(cohort_brand)
    for did, info in cohort_brand.items():
        evs = events_by_deal.get(did) or []
        pinfo = stage_info.get(info.get("pid")) or {}
        entry = pinfo.get("entry")
        visp = pinfo.get("visita")
        created = info.get("created")
        first_contact = None
        did_visita = False
        for pos, nm, dt in evs:
            if pos is not None and entry is not None and pos > entry and dt is not None:
                if first_contact is None or dt < first_contact:
                    first_contact = dt
            if (visp is not None and pos is not None and pos >= visp) or (nm and VISITA_RE.search(nm)):
                did_visita = True
        if first_contact is not None:
            contacted += 1
            if created and first_contact > created:
                dh = (first_contact - created).total_seconds() / 3600.0
                if 0 < dh <= 168:
                    sla.append(dh)
        if did_visita:
            visita += 1
    return {
        "n": n,
        "contact_rate": round(contacted / n * 100, 1) if n else None,
        "visita_rate": round(visita / contacted * 100, 1) if contacted else None,
        "sla_horas": round(_median(sla), 1) if sla else None,
    }


# ─── Agregação por marca ────────────────────────────────────────────────────
def _blank_brand():
    return {
        "vendas": 0, "vgv": 0.0, "perdas": 0,
        "leads_criados": 0, "leads_contatados": 0, "leads_visita": 0,
        "ciclo_dias": [], "sla_horas": [], "ticket_vals": [],
        "vgv_pago": 0.0, "vendas_pago": 0,
        "trash": 0,
        "channels": defaultdict(lambda: {"leads": 0, "vendas": 0, "vgv": 0.0, "perdas": 0}),
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

        # Regras de marca config-driven (Sprint 9.13). brand_rules=None → fallback.
        brand_rules, brand_labels, brand_default = _load_brand_rules(sb)
        brand_mapping = "config" if brand_rules is not None else "default"
        if brand_labels is None:
            brand_labels = BRAND_LABEL

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}

        since_d, until_d = _window(params)
        since_dt = datetime(since_d.year, since_d.month, since_d.day, tzinfo=timezone.utc)
        until_dt = datetime(until_d.year, until_d.month, until_d.day, 23, 59, 59, tzinfo=timezone.utc)
        # Filtro de marca (brand_keys, ex.: imoveis,conquista) — espelha a seleção
        # de conta(s) Meta na toolbar. Vazio = todas. O lead do RD não carrega a
        # conta de anúncio, então a conta resolve até a marca/funil.
        brands_filter = set(
            b.strip().lower() for b in (params.get("brands") or "").split(",") if b.strip()
        )

        deals, err, truncated = _fetch_period_deals(sb, since_d, until_d)
        if err:
            return self._send(502, {"ok": False, "error": "deals: " + err})

        stage_info, _pname = _stage_positions(sb)

        # ── Régua de captura de eventos reais (deal_stage_events) ──
        # Métrica é REAL quando a janela inteira cai depois do 1º evento capturado
        # (não-backfill). Antes/cruzando esse marco → estimativa rotulada.
        cap_since = None
        try:
            _ev = (sb.table("deal_stage_events").select("occurred_at")
                   .neq("source", "backfill").order("occurred_at", desc=False)
                   .limit(1).execute().data or [])
            cap_since = _parse_dt(_ev[0]["occurred_at"]) if _ev else None
        except Exception:
            cap_since = None
        metrics_basis = "real" if (cap_since and since_dt >= cap_since) else "estimativa"
        cohort = defaultdict(dict)  # brand -> {deal_id: {"created": dt, "pid": pid}}

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
            brand = _classify(d.get("pipeline_name"), brand_rules, brand_default)
            if brands_filter and brand not in brands_filter:
                continue  # fora da(s) marca(s) selecionada(s) no filtro de contas
            B = brands[brand]
            win = d.get("win")
            amt = _amount(d)
            created = _parse_dt(d.get("created_at_rd")) or _parse_dt(raw.get("created_at"))
            closed = _parse_dt(d.get("closed_at")) or _parse_dt(raw.get("closed_at"))
            src = _source(raw)
            ch = _channel(src)
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
                B["channels"][ch]["vendas"] += 1
                B["channels"][ch]["vgv"] += amt
                if ch in PAID_CHANNELS:  # honesto: só meta+google contam como pago
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
                B["channels"][ch]["perdas"] += 1
                mr = _lost_reason(raw) or "Não informado"
                B["motivos"][mr] += 1
                if TRASH_RE.search(mr):
                    B["trash"] += 1
                B["owners"][owner_email]["perdas"] += 1
                B["owners"][owner_email]["nome"] = owner_name

            # ── Coorte de leads criados na janela (contact/visita/SLA/origem) ──
            if in_create_win:
                B["leads_criados"] += 1
                B["channels"][ch]["leads"] += 1
                _did = str(d.get("id") or "")
                _pid = str((((raw or {}).get("deal_pipeline") or {}).get("id")) or "")
                if _did:
                    cohort[brand][_did] = {"created": created, "pid": _pid}
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
            # SLA / contato / visita: usa REAL (eventos) quando a janela está na era
            # de captura; senão proxy rotulado como estimativa.
            real = real_by_brand.get(key)
            use_real = bool(real and real.get("basis") == "real")
            sla_proxy = round(_median(B["sla_horas"]), 1) if B["sla_horas"] else None
            contact_proxy = round(B["leads_contatados"] / criados * 100, 1) if criados else None
            visita_proxy = round(B["leads_visita"] / B["leads_contatados"] * 100, 1) if B["leads_contatados"] else None
            basis = "real" if use_real else "estimativa"
            sla_val = real["sla_horas"] if use_real else sla_proxy
            contact_val = real["contact_rate"] if use_real else contact_proxy
            visita_val = real["visita_rate"] if use_real else visita_proxy
            # ── Atribuição honesta por canal (Sprint 9.14) ──
            ch_rows = sorted(
                [{"channel": ck, "label": CHANNEL_LABEL.get(ck, ck),
                  "leads": cv["leads"], "vendas": cv["vendas"],
                  "vgv": round(cv["vgv"], 2), "perdas": cv["perdas"]}
                 for ck, cv in B["channels"].items()
                 if (cv["leads"] or cv["vendas"] or cv["perdas"])],
                key=lambda x: -x["vgv"]
            )
            vgv_total = B["vgv"]
            vgv_unassigned = B["channels"].get("nao_atribuido", {}).get("vgv", 0.0)
            vgv_attributed = vgv_total - vgv_unassigned
            attribution = {
                "by_channel": ch_rows,
                "vgv_total": round(vgv_total, 2),
                "vgv_attributed": round(vgv_attributed, 2),
                "vgv_unassigned": round(vgv_unassigned, 2),
                # cobertura = % do VGV ganho que tem origem marcada no RD
                "coverage_pct": round(vgv_attributed / vgv_total * 100, 1) if vgv_total else None,
                "vgv_paid": round(B["vgv_pago"], 2),      # só meta+google
                "vendas_paid": B["vendas_pago"],
            }
            return {
                "brand": key,
                "label": brand_labels.get(key, BRAND_LABEL.get(key, key)),
                "vendas": vendas,
                "vgv": round(B["vgv"], 2),
                "perdas": perdas,
                "ticket_medio": round(ticket, 2),
                "taxa_conversao": round(conv, 1) if conv is not None else None,
                "ciclo_medio_dias": round(_median(B["ciclo_dias"]), 1) if B["ciclo_dias"] else None,
                "sla_horas_aprox": sla_val,
                "sla_basis": basis,
                "leads_criados": criados,
                "leads_contatados": B["leads_contatados"],
                "leads_visita": B["leads_visita"],
                "contact_rate": contact_val,
                "contact_basis": basis,
                "visita_rate": visita_val,
                "visita_basis": basis,
                "trash_rate": round(B["trash"] / perdas * 100, 1) if perdas else None,
                "vgv_pago": round(B["vgv_pago"], 2),
                "vendas_pago": B["vendas_pago"],
                "motivos_perda": motivos[:8],
                "origens": origens,
                "attribution": attribution,
                "ranking": owners[:15],
            }

        # Métricas reais por marca (só quando a janela cai na era de captura)
        real_by_brand = {}
        if metrics_basis == "real":
            all_ids = [did for bk in cohort for did in cohort[bk].keys()]
            events_by_deal = _events_for_deals(sb, all_ids) if all_ids else {}
            for bk, cdeals in cohort.items():
                rm = _real_brand_metrics(cdeals, events_by_deal, stage_info)
                rm["basis"] = "real"
                real_by_brand[bk] = rm

        per_brand = {k: _serialize(k, v) for k, v in brands.items()}

        # ── Global (consolida marcas de venda; ignora 'captacao') ──
        venda_keys = [k for k in per_brand if k != "captacao"]
        g = {
            "vendas": sum(per_brand[k]["vendas"] for k in venda_keys),
            "vgv": round(sum(per_brand[k]["vgv"] for k in venda_keys), 2),
            "perdas": sum(per_brand[k]["perdas"] for k in venda_keys),
            "leads_criados": sum(per_brand[k]["leads_criados"] for k in venda_keys),
            "leads_contatados": sum(per_brand[k]["leads_contatados"] for k in venda_keys),
            "leads_visita": sum(per_brand[k]["leads_visita"] for k in venda_keys),
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

        # ── Atribuição global por canal (consolida marcas de venda) ──
        gch = defaultdict(lambda: {"leads": 0, "vendas": 0, "vgv": 0.0, "perdas": 0})
        for k in venda_keys:
            for row in per_brand[k]["attribution"]["by_channel"]:
                c = gch[row["channel"]]
                c["leads"] += row["leads"]
                c["vendas"] += row["vendas"]
                c["vgv"] += row["vgv"]
                c["perdas"] += row["perdas"]
        g_ch_rows = sorted(
            [{"channel": ck, "label": CHANNEL_LABEL.get(ck, ck), "leads": cv["leads"],
              "vendas": cv["vendas"], "vgv": round(cv["vgv"], 2), "perdas": cv["perdas"]}
             for ck, cv in gch.items() if (cv["leads"] or cv["vendas"] or cv["perdas"])],
            key=lambda x: -x["vgv"]
        )
        g_vgv_unassigned = gch.get("nao_atribuido", {}).get("vgv", 0.0)
        g_vgv_attr = g["vgv"] - g_vgv_unassigned
        g["attribution"] = {
            "by_channel": g_ch_rows,
            "vgv_total": g["vgv"],
            "vgv_attributed": round(g_vgv_attr, 2),
            "vgv_unassigned": round(g_vgv_unassigned, 2),
            "coverage_pct": round(g_vgv_attr / g["vgv"] * 100, 1) if g["vgv"] else None,
            "vgv_paid": g["vgv_pago"],
            "vendas_paid": g["vendas_pago"],
        }

        return self._send(200, {
            "ok": True,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                       "date_preset": params.get("date_preset")},
            "deals_scanned": len(deals),
            "truncated": truncated,
            "global": g,
            "brands": per_brand,
            "brands_filter": sorted(brands_filter) if brands_filter else [],
            "brand_mapping": brand_mapping,
            "metrics_basis": metrics_basis,
            "capture_since": cap_since.isoformat() if cap_since else None,
            "v3_user_lvl": user.get("lvl"),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
