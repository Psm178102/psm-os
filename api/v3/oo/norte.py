"""
🎯 Norte do Mês do corretor (v85.6) — o modelo da planilha PSM vira sistema.

GET  /api/v3/oo/norte?corretor_id=<id>[&since=&until=|&date_preset=]
     → cfg do mês de referência + canais computados (taxa ajustada = taxa_base ×
       energia/100, igual à planilha do Paulo) + metas do FUNIL escaladas pro
       período (fração de dias de cada mês coberto) + ritmo diário (pace).
     Auth: gestor (lvl>=5) OU o próprio corretor (norte do dia dele).

POST /api/v3/oo/norte   {corretor_id, ym: 'YYYY-MM', patch:{...}}
     → ajusta a meta do mês (PATCH — nunca sobrescreve o que não veio),
       changelog embutido (quem/quando/antes→depois) + audit_log.
     Auth: gestor (lvl>=5).

Armazenamento: shared_kv 'oo_norte:<corretor_id>:<YYYY-MM>'.
Lição aplicada: leitura confirmada antes de gravar (leitura falhou ≠ não existe);
edição é PATCH; snapshot before/after no audit.
"""
from http.server import BaseHTTPRequestHandler
import calendar
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore
from _auth_lib import hoje_brt  # type: ignore
from _oo_lib import window, months_in_range, MILESTONES, broker_metrics, parse_dt  # type: ignore

# Canais padrão (taxas base da planilha PSM IMÓVEIS) — o gestor ajusta tudo.
CANAIS_PADRAO = [
    {"nome": "Tráfego Pago",              "taxa_base": 1.3, "energia": 0, "mix": 0},
    {"nome": "Indicação",                 "taxa_base": 8.0, "energia": 0, "mix": 0},
    {"nome": "Carteira Própria",          "taxa_base": 15.0, "energia": 0, "mix": 0},
    {"nome": "Eventos (rodadas)",         "taxa_base": 3.0, "energia": 0, "mix": 0},
    {"nome": "Networking",                "taxa_base": 6.0, "energia": 0, "mix": 0},
    {"nome": "Plantão",                   "taxa_base": 5.0, "energia": 0, "mix": 0},
    {"nome": "Reativação/Disparo",        "taxa_base": 1.0, "energia": 0, "mix": 0},
    {"nome": "Ativo (prospecção)",        "taxa_base": 0.5, "energia": 0, "mix": 0},
    {"nome": "Tráfego orgânico",          "taxa_base": 1.8, "energia": 0, "mix": 0},
    {"nome": "Captação de imóvel",        "taxa_base": 2.5, "energia": 0, "mix": 0},
]

ETAPAS = [k for k, _ in MILESTONES]  # lead..venda (7)

CFG_DEFAULT = {
    "atendimentos_mes": 0,
    "ticket_medio": 0,
    "canais": CANAIS_PADRAO,
    # metas por etapa do funil (None = não definida; 'venda' cai no previsto do mix)
    "metas_etapas": {k: None for k in ETAPAS},
    "obs": "",
    "changelog": [],
}


def _kv_key(cid, ym):
    return f"oo_norte:{cid}:{ym}"


def _read_cfg(sb, cid, ym):
    """(cfg|None, read_ok). read_ok=False = leitura FALHOU (≠ não existe)."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", _kv_key(cid, ym)).limit(1).execute().data or []
    except Exception:
        return None, False
    if not rows:
        return None, True
    v = rows[0].get("value")
    return (v if isinstance(v, dict) else None), True


def _num(x, default=0.0):
    try:
        v = float(x)
        return v if v == v else default  # NaN guard
    except Exception:
        return default


def computed(cfg):
    """Expande os canais exatamente como a planilha: taxa ajustada = taxa_base ×
    energia/100; atendimentos = mix% × total; vendas = atend × taxa ajustada."""
    atend_total = _num(cfg.get("atendimentos_mes"))
    ticket = _num(cfg.get("ticket_medio"))
    rows, vendas_prev, mix_total, atend_soma = [], 0.0, 0.0, 0.0
    for c in (cfg.get("canais") or []):
        taxa = _num(c.get("taxa_base"))
        energia = _num(c.get("energia"))
        mix = _num(c.get("mix"))
        taxa_aj = taxa * energia / 100.0
        atend = atend_total * mix / 100.0
        vend = atend * taxa_aj / 100.0
        mix_total += mix
        atend_soma += atend
        vendas_prev += vend
        rows.append({"nome": c.get("nome") or "?", "taxa_base": taxa, "energia": energia,
                     "mix": mix, "taxa_ajustada": round(taxa_aj, 3),
                     "atendimentos": round(atend, 1), "vendas_prev": round(vend, 3)})
    return {
        "canais": rows,
        "atendimentos_mes": atend_total,
        "ticket_medio": ticket,
        "mix_total": round(mix_total, 2),
        "mix_ok": abs(mix_total - 100.0) < 0.51 if mix_total else False,
        "atendimentos_alocados": round(atend_soma, 1),
        "vendas_prev": round(vendas_prev, 3),
        "vgv_prev": round(vendas_prev * ticket, 2),
    }


def metas_funil(cfg, comp):
    """Metas por etapa resolvidas (mês cheio): valor manual manda; 'venda' sem
    valor manual usa as vendas previstas do mix (auto)."""
    me = cfg.get("metas_etapas") or {}
    out = {}
    for k in ETAPAS:
        v = me.get(k)
        if v is None and k == "venda":
            out[k] = {"valor": comp["vendas_prev"], "auto": True}
        else:
            out[k] = {"valor": _num(v), "auto": False}
    return out


def _realizado(sb, cid, since_d, until_d, today):
    """Funil realizado do corretor na janela (mesma conta do cockpit 1:1) —
    usado pelo card Norte do Dia no Meu Painel (o corretor não acessa o 1:1)."""
    try:
        urows = sb.table("users").select("email").eq("id", cid).limit(1).execute().data or []
    except Exception:
        urows = []
    email = ((urows[0].get("email") if urows else "") or "").lower()
    cols = "id,name,amount,win,closed_at,created_at_rd,updated_at_rd,stage_id,stage_name,pipeline_id,pipeline_name,user_id,user_email,rd_raw"
    deals, seen = [], set()
    for fld, val in (("user_id", cid), ("user_email", email)):
        if not val:
            continue
        pg = 0
        while True:
            try:
                ch = (sb.table("deals").select(cols).eq(fld, val).order("id")
                      .range(pg * 1000, pg * 1000 + 999).execute().data or [])
            except Exception:
                ch = []
            for r in ch:
                if r.get("id") not in seen:
                    seen.add(r.get("id")); deals.append(r)
            if len(ch) < 1000 or pg >= 20:
                break
            pg += 1
    events = {}
    ids = [str(d.get("id")) for d in deals if d.get("id")]
    for i in range(0, len(ids), 150):
        try:
            rows = (sb.table("deal_stage_events")
                    .select("deal_id,stage_position,stage_name,occurred_at,source")
                    .in_("deal_id", ids[i:i + 150]).neq("source", "backfill").execute().data or [])
        except Exception:
            rows = []
        for r in rows:
            events.setdefault(str(r.get("deal_id")), []).append(
                (r.get("stage_position"), (r.get("stage_name") or "").lower(), parse_dt(r.get("occurred_at"))))
    zero = {"meta_vgv": 0, "meta_vendas": 0, "meta_visitas": 0, "meta_pastas": 0, "meta_propostas": 0, "meta_agendamentos": 0}
    m = broker_metrics(deals, events, zero, since_d, until_d, today)
    return {"funnel": m.get("funnel"), "kpis": m.get("kpis"), "win_rate": m.get("win_rate")}


def month_fracs(since_d, until_d):
    """[(ym, fração do mês coberta pela janela)] — meta proporcional honesta."""
    out = []
    for (y, m) in months_in_range(since_d, until_d):
        ndays = calendar.monthrange(y, m)[1]
        a = max(since_d, date(y, m, 1))
        b = min(until_d, date(y, m, ndays))
        frac = max(0, (b - a).days + 1) / ndays
        out.append((f"{y:04d}-{m:02d}", round(frac, 4)))
    return out


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    # ───────────────────────────── GET ─────────────────────────────
    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        cid = params.get("corretor_id") or user.get("id")
        # gestor vê qualquer um; corretor SÓ o próprio norte
        if str(cid) != str(user.get("id")) and (user.get("lvl") or 0) < 5:
            return self._send(403, {"ok": False, "error": "sem permissão"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        today = hoje_brt()
        since_d, until_d = window(params, today)
        fracs = month_fracs(since_d, until_d)

        # cfg de cada mês tocado pela janela (meta proporcional por fração)
        per_month, read_fail = {}, False
        for ym, _f in fracs:
            cfg_m, ok = _read_cfg(sb, cid, ym)
            if not ok:
                read_fail = True
            per_month[ym] = cfg_m

        # metas do período = Σ (meta do mês × fração coberta)
        funil_periodo = {k: 0.0 for k in ETAPAS}
        meta_periodo = {"atendimentos": 0.0, "vendas": 0.0, "vgv": 0.0}
        meses_com_meta = 0
        for ym, frac in fracs:
            cfg_m = per_month.get(ym)
            if not cfg_m:
                continue
            meses_com_meta += 1
            comp_m = computed(cfg_m)
            mf = metas_funil(cfg_m, comp_m)
            for k in ETAPAS:
                funil_periodo[k] += mf[k]["valor"] * frac
            meta_periodo["atendimentos"] += comp_m["atendimentos_mes"] * frac
            meta_periodo["vendas"] += comp_m["vendas_prev"] * frac
            meta_periodo["vgv"] += comp_m["vgv_prev"] * frac

        # mês de referência (editor + pace): mês do fim da janela; fallback hoje
        ref_ym = f"{until_d.year:04d}-{until_d.month:02d}"
        cfg_ref = per_month.get(ref_ym)
        if cfg_ref is None and f"{today.year:04d}-{today.month:02d}" in per_month:
            ref_ym = f"{today.year:04d}-{today.month:02d}"
            cfg_ref = per_month.get(ref_ym)
        cfg_out = cfg_ref or {**CFG_DEFAULT}
        comp_ref = computed(cfg_out)

        # pace do MÊS CORRENTE (norte do dia)
        pace = None
        cur_ym = f"{today.year:04d}-{today.month:02d}"
        cfg_cur = per_month.get(cur_ym)
        if cfg_cur is None and cur_ym not in per_month:
            cfg_cur, ok_cur = _read_cfg(sb, cid, cur_ym)
            if not ok_cur:
                read_fail = True
        if cfg_cur:
            comp_cur = computed(cfg_cur)
            ndays = calendar.monthrange(today.year, today.month)[1]
            dia = today.day
            rest = ndays - dia + 1
            pace = {
                "ym": cur_ym, "dias_mes": ndays, "dia": dia, "dias_restantes": rest,
                "atend_dia": round(comp_cur["atendimentos_mes"] / ndays, 1) if ndays else 0,
                "atend_esperado_ate_hoje": round(comp_cur["atendimentos_mes"] * dia / ndays, 0) if ndays else 0,
                "vendas_prev": comp_cur["vendas_prev"], "vgv_prev": comp_cur["vgv_prev"],
                "atendimentos_mes": comp_cur["atendimentos_mes"],
            }

        realizado = None
        if params.get("realizado") == "1":
            realizado = _realizado(sb, cid, since_d, until_d, today)

        # ⏳ v86.1 (ADITIVO — não muda cálculo nenhum): defasagem venda↔atividade
        # da equipe do corretor (MAP ~3 meses), lida da config do motor (oo_motor_config).
        defasagem = 1
        try:
            trs = sb.table("users").select("team").eq("id", cid).limit(1).execute().data or []
            tm = ((trs[0].get("team") if trs else "") or "").strip().lower()
            drow = (sb.table("shared_kv").select("value").eq("key", "oo_motor_config")
                    .limit(1).execute().data or [])
            dv = (drow[0].get("value") if drow else None) or {}
            if isinstance(dv, str):
                dv = json.loads(dv)
            dm = (dv.get("defasagem_meses") if isinstance(dv, dict) else None) or {"map": 3, "conquista": 1}
            for k, v in dm.items():
                if k and k in tm:
                    defasagem = max(1, int(v))
                    break
        except Exception:
            defasagem = 1

        return self._send(200, {
            "ok": True,
            "defasagem_meses": defasagem,
            "corretor_id": cid,
            "realizado": realizado,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat()},
            "fracs": [{"ym": ym, "frac": f, "tem_meta": bool(per_month.get(ym))} for ym, f in fracs],
            "meses_com_meta": meses_com_meta,
            "ref_ym": ref_ym,
            "cfg": {k: v for k, v in cfg_out.items() if k != "changelog"},
            "computed": comp_ref,
            "metas_funil_ref": metas_funil(cfg_out, comp_ref),
            "funil_meta_periodo": {k: round(v, 2) for k, v in funil_periodo.items()},
            "meta_periodo": {k: round(v, 2) for k, v in meta_periodo.items()},
            "pace": pace,
            "changelog": (cfg_out.get("changelog") or [])[-15:][::-1],
            "read_fail": read_fail,  # transparência: alguma leitura de kv falhou
            "etapas": [{"key": k, "label": l} for k, l in MILESTONES],
        })

    # ───────────────────────────── POST ─────────────────────────────
    def do_POST(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cid = body.get("corretor_id")
        ym = body.get("ym") or ""
        patch = body.get("patch") or {}
        if not cid or len(ym) != 7 or not isinstance(patch, dict) or not patch:
            return self._send(400, {"ok": False, "error": "corretor_id, ym (YYYY-MM) e patch são obrigatórios"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # 🔒 leitura confirmada ANTES de gravar (leitura falhou ≠ não existe)
        cur, ok = _read_cfg(sb, cid, ym)
        if not ok:
            return self._send(503, {"ok": False, "error": "não consegui LER a meta atual — gravação abortada por segurança, tente de novo"})
        before = json.loads(json.dumps(cur)) if cur else None
        cfg = cur or json.loads(json.dumps({**CFG_DEFAULT}))

        # PATCH: só o que veio muda
        mudancas = []
        for k in ("atendimentos_mes", "ticket_medio", "obs"):
            if k in patch and patch[k] != cfg.get(k):
                mudancas.append({"campo": k, "de": cfg.get(k), "para": patch[k]})
                cfg[k] = patch[k]
        if "canais" in patch and isinstance(patch["canais"], list):
            if patch["canais"] != cfg.get("canais"):
                mudancas.append({"campo": "canais", "de": f"{len(cfg.get('canais') or [])} canais", "para": f"{len(patch['canais'])} canais (mix/energia ajustados)"})
            cfg["canais"] = patch["canais"]
        if "metas_etapas" in patch and isinstance(patch["metas_etapas"], dict):
            me = cfg.get("metas_etapas") or {k: None for k in ETAPAS}
            for k in ETAPAS:
                if k in patch["metas_etapas"] and patch["metas_etapas"][k] != me.get(k):
                    mudancas.append({"campo": f"meta {k}", "de": me.get(k), "para": patch["metas_etapas"][k]})
                    me[k] = patch["metas_etapas"][k]
            cfg["metas_etapas"] = me
        if not mudancas:
            return self._send(200, {"ok": True, "sem_mudancas": True, "computed": computed(cfg)})

        log = cfg.get("changelog") or []
        log.append({"quem": user.get("name") or user.get("email"), "quando": datetime.now(timezone.utc).isoformat(),
                    "mudancas": mudancas[:20]})
        cfg["changelog"] = log[-60:]
        # ✋ humano editou → norte vira MANUAL: o preenchimento automático (norte_auto,
        # Conquista) para de encostar neste mês (regra anti-desfazer, v86.2)
        cfg.pop("auto", None)

        try:
            sb.table("shared_kv").upsert({"key": _kv_key(cid, ym), "value": cfg,
                                          "updated_by": user.get("id")}, on_conflict="key").execute()
        except Exception:
            try:
                sb.table("shared_kv").upsert({"key": _kv_key(cid, ym), "value": cfg}, on_conflict="key").execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"gravação falhou: {e}"})
        audit(self, user, "oo_norte.set", target_type="oo_norte", target_id=f"{cid}:{ym}",
              before=before, after=cfg, notes=f"{len(mudancas)} mudança(s) na meta do mês")
        comp = computed(cfg)
        return self._send(200, {"ok": True, "cfg": {k: v for k, v in cfg.items() if k != "changelog"},
                                "computed": comp, "metas_funil": metas_funil(cfg, comp),
                                "changelog": cfg["changelog"][-15:][::-1]})
