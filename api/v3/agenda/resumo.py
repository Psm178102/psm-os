"""
GET /api/v3/agenda/resumo[?pessoa=<uid>] — o que alimenta a faixa "📈 Projeção do mês +
⚠️ Avisos" no topo da Agenda & Tarefas. v87.82 (pedido do Paulo 14/set: "resumo de projeção
do corretor no mês, avisos, mais incisivo").

O DINHEIRO (vendido, meta, pipeline, ticket) continua vindo de /metrics/overview — fonte única,
cacheada, por escopo. Este endpoint devolve só o que é do CORRETOR e não está lá:
  • fila:     os 5 negócios mais quentes dele, pontuados pelo MESMO motor do Cérebro de Vendas
              (score_open) com a próxima ação e o telefone pro WhatsApp — igual à fila do dia;
  • pipeline ponderado (Σ prob × valor) e quantos leads quentes/mornos/parados;
  • forecast declarado do mês (kv forecast:<email>:<YYYY-MM>) e se foi declarado ESTA semana;
  • norte:    ritmo de atendimentos/dia do Norte do Mês (kv oo_norte), se o gestor definiu.
Permissão: lvl>=0 vê o próprio; lvl>=5 pode passar ?pessoa=<uid>.
Cache: shared_kv agenda_resumo::<uid> por 5 min (a fila puxa todos os fechados de 120d pra
calibrar o winrate por canal — mesmo custo da fila do dia do Meu Painel).
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
for _d in ("intel", "oo", "producao"):
    _p = os.path.join(_V3, _d)
    if _p not in sys.path:
        sys.path.append(_p)
from _auth_lib import supabase_client, require_user, AuthError, hoje_brt  # type: ignore
if _V3 not in sys.path:
    sys.path.append(_V3)
from _metricas_lib import resumo as mx_resumo  # type: ignore   # v87.87 — motor único (Dicionário §8)

CACHE_TTL = 300
_COLS = ("id,amount,win,closed_at,created_at_rd,updated_at_rd,"
         "stage_name,user_id,user_email,rd_raw,pipeline_id,stage_id")


def _normalize_phone(raw):
    dig = re.sub(r"\D", "", str(raw or ""))
    if not dig:
        return None
    if len(dig) <= 11 and not dig.startswith("55"):
        dig = "55" + dig
    return dig


def _phone_from_rd(rd_raw):
    if not isinstance(rd_raw, dict):
        return None
    for c in (rd_raw.get("contacts") or []):
        for ph in (c.get("phones") or []):
            p = _normalize_phone(ph.get("phone") or ph.get("number"))
            if p:
                return p
    return None


def _fetch(sb, q_builder):
    out, page, size = [], 0, 1000
    while page < 30:
        try:
            rows = q_builder().range(page * size, page * size + size - 1).execute().data or []
        except Exception:
            break
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out


def _kv(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def _fila(sb, email, hoje):
    """Top 5 do funil da pessoa com o motor do Cérebro. Best-effort: sem RD → vazio."""
    vazio = {"fila": [], "total_abertos": 0, "quentes_n": 0, "mornos_n": 0, "parados_n": 0,
             "pipeline_ponderado_vgv": 0, "pipeline_ponderado_vendas": 0, "pipeline_quente_vgv": 0}
    if not email:
        return {**vazio, "rd": False}
    try:
        from _brain_lib import channel_winrates, score_open  # type: ignore
    except Exception as e:
        print(f"[resumo] brain indisponivel: {e}")
        return {**vazio, "rd": False, "erro": "motor indisponível"}
    opens = _fetch(sb, lambda: sb.table("deals").select(_COLS).is_("win", "null").eq("user_email", email))
    since = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    closed = _fetch(sb, lambda: sb.table("deals").select(_COLS).gte("closed_at", since))
    now = datetime.now(timezone.utc)
    try:
        overall_wr, ch_wr, ch_n = channel_winrates(closed)
    except Exception:
        overall_wr, ch_wr, ch_n = 0.0, {}, {}
    scored = []
    for d in opens:
        try:
            s = score_open(d, overall_wr, ch_wr, ch_n, now)
        except Exception:
            continue
        s["phone"] = _phone_from_rd(d.get("rd_raw"))
        s.pop("fatores", None)
        scored.append(s)
    scored.sort(key=lambda x: -x.get("score", 0))
    quentes = [s for s in scored if s.get("temp") == "quente"]
    mornos = [s for s in scored if s.get("temp") == "morno"]
    parados = [s for s in scored if s.get("temp") in ("quente", "morno") and (s.get("dias_parado") or 0) >= 3]
    return {
        "rd": True,
        "fila": scored[:5],
        "total_abertos": len(scored),
        "quentes_n": len(quentes), "mornos_n": len(mornos), "parados_n": len(parados),
        "pipeline_ponderado_vgv": round(sum(s.get("expected_vgv") or 0 for s in scored), 2),
        "pipeline_ponderado_vendas": round(sum(s.get("prob") or 0 for s in scored), 1),
        "pipeline_quente_vgv": round(sum(s.get("expected_vgv") or 0 for s in quentes), 2),
    }


def _forecast(sb, email, ym, hoje):
    try:
        from _prod_lib import email_local  # type: ignore
        local = email_local(email)
    except Exception:
        local = (email or "").split("@")[0] or None
    if not local:
        return None, False
    v = _kv(sb, f"forecast:{local}:{ym}") or {}
    vs = v.get("versoes") or []
    ult = vs[-1] if vs else None
    semana = False
    if ult and ult.get("ts"):
        try:
            t = datetime.fromisoformat(str(ult["ts"]).replace("Z", "+00:00"))
            t = (t - timedelta(hours=3)).date()
            semana = t >= hoje - timedelta(days=hoje.weekday())   # desde a segunda desta semana
        except Exception:
            semana = False
    return ult, semana


def _norte(sb, uid, ym, hoje):
    """Ritmo do Norte do Mês (só se o gestor definiu no 1:1). Best-effort."""
    try:
        from norte import _read_cfg, computed  # type: ignore
        cfg, ok = _read_cfg(sb, uid, ym)
        if not cfg:
            return None
        comp = computed(cfg)
        import calendar
        ndays = calendar.monthrange(hoje.year, hoje.month)[1]
        return {"atend_dia": round(comp["atendimentos_mes"] / ndays, 1) if ndays else 0,
                "atend_esperado_ate_hoje": round(comp["atendimentos_mes"] * hoje.day / ndays) if ndays else 0,
                "atendimentos_mes": comp["atendimentos_mes"], "vendas_prev": comp["vendas_prev"],
                "vgv_prev": comp["vgv_prev"], "dias_restantes": ndays - hoje.day + 1}
    except Exception as e:
        print(f"[resumo] norte: {e}")
        return None


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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        alvo = user
        pid = (q.get("pessoa") or "").strip()
        if pid and pid != user.get("id"):
            if (user.get("lvl") or 0) < 5:
                return self._send(403, {"ok": False, "error": "só a gestão vê o resumo de outra pessoa"})
            try:
                rows = sb.table("users").select("id,name,email,role,team").eq("id", pid).limit(1).execute().data or []
            except Exception:
                rows = []
            if not rows:
                return self._send(404, {"ok": False, "error": "pessoa não encontrada"})
            alvo = rows[0]
        uid = alvo.get("id")
        hoje = hoje_brt()
        ym = hoje.strftime("%Y-%m")
        ckey = f"agenda_resumo::{uid}"
        if q.get("fresh") != "1":
            c = _kv(sb, ckey)
            try:
                if c and c.get("_cached_at") and (datetime.now(timezone.utc) - datetime.fromisoformat(c["_cached_at"])).total_seconds() < CACHE_TTL \
                        and isinstance(c.get("data"), dict) and c["data"].get("mes") == ym:
                    return self._send(200, {**c["data"], "cache": True})
            except Exception:
                pass
        email = (alvo.get("email") or "").strip().lower()
        fila = _fila(sb, email, hoje)
        fc, fc_semana = _forecast(sb, email, ym, hoje)
        data = {"ok": True, "mes": ym, "dia": hoje.day,
                "pessoa": {"id": uid, "name": alvo.get("name"), "email": email},
                **fila,
                "forecast": fc, "forecast_semana": fc_semana,
                "norte": _norte(sb, uid, ym, hoje),
                "fetched_at": datetime.now(timezone.utc).isoformat()}
        # ── v87.87 DICIONÁRIO §8: pipeline ponderado, previsto, ritmo e Norte vêm do motor único —
        # o mesmo número do 1:1, da Gestão Comercial e do Cérebro (a fila top-5 continua daqui).
        try:
            mx = mx_resumo(sb, {})
            b = (mx.get("pessoas") or {}).get(uid)
            if b:
                pp = b.get("pipeline") or {}
                data.update({"pipeline_ponderado_vgv": pp.get("ponderado_vgv", data.get("pipeline_ponderado_vgv")),
                             "pipeline_ponderado_vendas": pp.get("ponderado_vendas", data.get("pipeline_ponderado_vendas")),
                             "pipeline_quente_vgv": pp.get("quente_vgv", data.get("pipeline_quente_vgv")),
                             "quentes_n": pp.get("quentes", data.get("quentes_n")),
                             "total_abertos": pp.get("abertos", data.get("total_abertos")),
                             "vendido_mes": {"vendas": b["vendas"], "vgv": b["vgv"], "meta_vgv": (b.get("meta") or {}).get("meta_vgv"),
                                             "atingimento_vgv_pct": b.get("atingimento_vgv_pct")},
                             "ritmo": b.get("projecao"), "previsto": b.get("previsto"),
                             "leads_mes": b["leads"], "em_atendimento": b["em_atendimento"]})
                if b.get("norte"):
                    data["norte"] = {**(data.get("norte") or {}), "vendas_prev": b["norte"]["vendas"], "vgv_prev": b["norte"]["vgv"]}
                data["dados_de_hhmm"] = mx.get("dados_de_hhmm")
        except Exception as e:
            print(f"[resumo] motor de métricas indisponível: {e}")
        try:
            sb.table("shared_kv").upsert({"key": ckey, "value": {"_cached_at": datetime.now(timezone.utc).isoformat(), "data": data},
                                          "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()
        except Exception:
            pass
        return self._send(200, data)
