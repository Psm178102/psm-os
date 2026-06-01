"""
GET /api/v3/oo/corretor?corretor_id=<id>[&date_preset=this_month|last_30d|last_90d|this_year][&since=&until=]
Header: Authorization: Bearer <token>   (Líder lvl>=5, ou o próprio corretor)

Cockpit de gestão individual: funil do corretor, conversão por etapa, taxa de
descarte, tempo de 1º contato, contagens (agendamentos/visitas/propostas/pastas/
vendas), origem das últimas vendas, motivos de perda, tendência 12m, meta ×
realizado, health score e alertas. TUDO dado real (deals + deal_stage_events).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _oo_lib import (  # type: ignore
    window, months_in_range, broker_metrics, parse_dt, build_stage_maps,
)


def _events_for(sb, deal_ids):
    from collections import defaultdict as _dd
    out = _dd(list)
    ids = [str(x) for x in deal_ids if x]
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        try:
            rows = (sb.table("deal_stage_events")
                    .select("deal_id,stage_position,stage_name,occurred_at,source")
                    .in_("deal_id", chunk).neq("source", "backfill").execute().data or [])
        except Exception:
            rows = []
        for r in rows:
            out[str(r.get("deal_id"))].append(
                (r.get("stage_position"), (r.get("stage_name") or "").lower(), parse_dt(r.get("occurred_at"))))
    return out


def _deals_for(sb, ids, emails, cols):
    """Deals de um conjunto de donos (por user_id OU user_email)."""
    out, seen = [], set()
    ids = [x for x in (ids or []) if x]
    emails = [e for e in (emails or []) if e]
    for fld, vals in (("user_id", ids), ("user_email", emails)):
        for i in range(0, len(vals), 100):
            chunk = vals[i:i + 100]
            try:
                rows = sb.table("deals").select(cols).in_(fld, chunk).limit(5000).execute().data or []
            except Exception:
                rows = []
            for r in rows:
                if r.get("id") not in seen:
                    seen.add(r.get("id")); out.append(r)
    return out


def _meta_sum_for(mrows, cid, wanted):
    acc = {"meta_vgv": 0, "meta_vendas": 0, "meta_visitas": 0, "meta_pastas": 0, "meta_propostas": 0, "meta_agendamentos": 0}
    for m in mrows:
        if m.get("corretor_id") == cid and (m.get("ano"), m.get("mes")) in wanted:
            for k in acc:
                try: acc[k] += float(m.get(k) or 0)
                except Exception: pass
    return acc


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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        cid = params.get("corretor_id")
        if not cid:
            return self._send(400, {"ok": False, "error": "corretor_id obrigatório"})
        # Permissão: gestão (lvl>=5) vê qualquer um; corretor só a si mesmo.
        if (user.get("lvl") or 0) < 5 and user.get("id") != cid:
            return self._send(403, {"ok": False, "error": "sem permissão"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        today = datetime.now(timezone.utc).date()
        since_d, until_d = window(params, today)

        # Corretor
        try:
            urows = sb.table("users").select("id,name,email,role,team,ini,color").eq("id", cid).limit(1).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})
        if not urows:
            return self._send(404, {"ok": False, "error": "corretor não encontrado"})
        u = urows[0]
        email = (u.get("email") or "").lower()

        cols = "id,name,amount,win,closed_at,created_at_rd,updated_at_rd,stage_id,stage_name,pipeline_id,pipeline_name,user_id,user_email,rd_raw"
        wanted = set(months_in_range(since_d, until_d))

        # Mapas de etapa REAL do RD (rd_stages) → funil do RD por etapa
        try:
            stages_rows = sb.table("rd_stages").select("*").execute().data or []
            pipes_rows = sb.table("rd_pipelines").select("id,external_id,name").execute().data or []
            stage_maps = build_stage_maps(stages_rows, pipes_rows)
        except Exception:
            stage_maps = None

        # Metas (todos os corretores — pra individual e, se líder, pra equipe)
        try:
            all_metas = sb.table("metas").select("*").execute().data or []
        except Exception:
            all_metas = []

        # Deals do corretor (individual)
        deals = _deals_for(sb, [cid], [email], cols)
        events_by_deal = _events_for(sb, [d.get("id") for d in deals])
        meta_sum = _meta_sum_for(all_metas, cid, wanted)
        metrics = broker_metrics(deals, events_by_deal, meta_sum, since_d, until_d, today, detail=True, stage_maps=stage_maps)

        resp = {
            "ok": True,
            "corretor": {"id": u.get("id"), "name": u.get("name"), "email": u.get("email"),
                         "role": u.get("role"), "team": u.get("team"),
                         "ini": u.get("ini"), "color": u.get("color")},
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                       "preset": params.get("date_preset") or ("custom" if params.get("since") else "this_month")},
            "deals_total": len(deals),
            **metrics,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

        # ── Visão de EQUIPE (só se o alvo é líder) — visível ao próprio líder e sócios ──
        if (u.get("role") or "").lower() == "lider":
            can_team = (user.get("id") == cid) or ((user.get("lvl") or 0) >= 10)
            resp["team_allowed"] = bool(can_team)
            team = u.get("team")
            if can_team and team:
                try:
                    members = [m for m in (sb.table("users").select("id,name,email,role,team,ini,color,status").eq("team", team).execute().data or [])
                               if (m.get("status") or "ativo") == "ativo" and (m.get("role") or "").lower() in ("corretor", "lider")]
                except Exception:
                    members = []
                mids = [m.get("id") for m in members]
                memails = [(m.get("email") or "").lower() for m in members]
                tdeals = _deals_for(sb, mids, memails, cols)
                tevents = _events_for(sb, [d.get("id") for d in tdeals])
                tmeta = {"meta_vgv": 0, "meta_vendas": 0, "meta_visitas": 0, "meta_pastas": 0, "meta_propostas": 0, "meta_agendamentos": 0}
                for mid in mids:
                    ms = _meta_sum_for(all_metas, mid, wanted)
                    for k in tmeta:
                        tmeta[k] += ms[k]
                tmetrics = broker_metrics(tdeals, tevents, tmeta, since_d, until_d, today, detail=True, stage_maps=stage_maps)
                # por membro (resumo leve)
                deals_by_owner = {}
                email2id = {(m.get("email") or "").lower(): m.get("id") for m in members}
                for d in tdeals:
                    oid = d.get("user_id") or email2id.get((d.get("user_email") or "").lower())
                    deals_by_owner.setdefault(oid, []).append(d)
                membros = []
                for m in members:
                    mm = broker_metrics(deals_by_owner.get(m.get("id"), []), {}, _meta_sum_for(all_metas, m.get("id"), wanted), since_d, until_d, today, detail=False)
                    membros.append({"id": m.get("id"), "name": m.get("name"), "role": m.get("role"),
                                    "ini": m.get("ini"), "color": m.get("color"),
                                    "vendas": mm["kpis"]["vendas"], "vgv": mm["kpis"]["vgv"],
                                    "visitas": mm["kpis"]["visitas"], "leads": mm["kpis"]["leads"],
                                    "win_rate": mm["win_rate"], "health": mm["health"], "health_color": mm["health_color"],
                                    "meta_attainment_pct": mm["meta_attainment_pct"], "alertas_count": len(mm["alertas"])})
                membros.sort(key=lambda x: (-(x["alertas_count"]), x["health"]))
                resp["team"] = {"name": team, "members": membros, "metrics": tmetrics, "deals_total": len(tdeals)}

        return self._send(200, resp)
