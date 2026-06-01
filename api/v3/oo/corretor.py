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
    window, months_in_range, broker_metrics, parse_dt,
)


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

        # Deals do corretor (todos — pra trend 12m + funil da janela)
        cols = "id,name,amount,win,closed_at,created_at_rd,updated_at_rd,stage_name,pipeline_name,user_id,user_email,rd_raw"
        deals = []
        try:
            if email:
                deals = (sb.table("deals").select(cols)
                         .or_(f"user_id.eq.{cid},user_email.eq.{email}")
                         .limit(3000).execute().data or [])
            else:
                deals = (sb.table("deals").select(cols).eq("user_id", cid)
                         .limit(3000).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"deals: {e}"})

        # Eventos reais (1º contato/visita) dos deals do corretor
        events_by_deal = defaultdict(list)
        ids = [str(d.get("id")) for d in deals if d.get("id")]
        for i in range(0, len(ids), 150):
            chunk = ids[i:i + 150]
            try:
                rows = (sb.table("deal_stage_events")
                        .select("deal_id,stage_position,stage_name,occurred_at,source")
                        .in_("deal_id", chunk).neq("source", "backfill")
                        .execute().data or [])
            except Exception:
                rows = []
            for r in rows:
                events_by_deal[str(r.get("deal_id"))].append(
                    (r.get("stage_position"), (r.get("stage_name") or "").lower(), parse_dt(r.get("occurred_at"))))

        # Metas somadas nos meses da janela
        meta_sum = {"meta_vgv": 0, "meta_vendas": 0, "meta_visitas": 0,
                    "meta_pastas": 0, "meta_propostas": 0, "meta_agendamentos": 0}
        try:
            mrows = (sb.table("metas").select("*").eq("corretor_id", cid).execute().data or [])
        except Exception:
            mrows = []
        wanted = set(months_in_range(since_d, until_d))
        for m in mrows:
            if (m.get("ano"), m.get("mes")) in wanted:
                for k in meta_sum:
                    try:
                        meta_sum[k] += float(m.get(k) or 0)
                    except Exception:
                        pass

        metrics = broker_metrics(deals, events_by_deal, meta_sum, since_d, until_d, today, detail=True)

        return self._send(200, {
            "ok": True,
            "corretor": {"id": u.get("id"), "name": u.get("name"), "email": u.get("email"),
                         "role": u.get("role"), "team": u.get("team"),
                         "ini": u.get("ini"), "color": u.get("color")},
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                       "preset": params.get("date_preset") or ("custom" if params.get("since") else "this_month")},
            "deals_total": len(deals),
            **metrics,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
