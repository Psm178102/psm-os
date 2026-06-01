"""
GET /api/v3/oo/overview[?date_preset=this_month|...][&since=&until=][&team=]
Header: Authorization: Bearer <token>   (Líder lvl>=5)

Lista de corretores pro One-on-One: resumo leve por pessoa (vendas, VGV, visitas,
agendamentos, propostas, atingimento de meta, health score / semáforo, nº de
alertas, data da última 1:1 e próxima). Ordena por health asc (quem precisa de
atenção primeiro). Dado real (deals + metas).
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
from _oo_lib import window, months_in_range, broker_metrics, read_meta_spend  # type: ignore


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

    def _fetch_deals(self, sb, since_iso):
        cols = "id,amount,win,closed_at,created_at_rd,updated_at_rd,stage_name,user_id,user_email,rd_raw"
        out, page, size = [], 0, 1000
        while page < 30:
            try:
                rows = (sb.table("deals").select(cols)
                        .or_(f"created_at_rd.gte.{since_iso},closed_at.gte.{since_iso}")
                        .range(page * size, page * size + size - 1).execute().data or [])
            except Exception:
                break
            out.extend(rows)
            if len(rows) < size:
                break
            page += 1
        return out

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        today = datetime.now(timezone.utc).date()
        since_d, until_d = window(params, today)

        # Usuários que carregam funil (corretor/líder), ativos
        try:
            users = (sb.table("users").select("id,name,email,role,team,ini,color,status")
                     .execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})
        team_f = (params.get("team") or "").strip().lower()
        people = [u for u in users
                  if (u.get("role") or "").lower() in ("corretor", "lider")
                  and (u.get("status") or "ativo") == "ativo"
                  and (not team_f or (u.get("team") or "").lower() == team_f)]

        # Deals da janela, agrupados por dono (id ou email)
        deals = self._fetch_deals(sb, since_d.isoformat())
        by_owner = defaultdict(list)
        email_to_id = {(u.get("email") or "").lower(): u.get("id") for u in users if u.get("email")}
        for d in deals:
            oid = d.get("user_id") or email_to_id.get((d.get("user_email") or "").lower())
            if oid:
                by_owner[oid].append(d)

        # Metas dos meses da janela, por corretor
        wanted = set(months_in_range(since_d, until_d))
        meta_by_id = defaultdict(lambda: {"meta_vgv": 0, "meta_vendas": 0, "meta_visitas": 0,
                                          "meta_pastas": 0, "meta_propostas": 0, "meta_agendamentos": 0})
        try:
            for m in (sb.table("metas").select("*").execute().data or []):
                if (m.get("ano"), m.get("mes")) in wanted:
                    acc = meta_by_id[m.get("corretor_id")]
                    for k in acc:
                        try:
                            acc[k] += float(m.get(k) or 0)
                        except Exception:
                            pass
        except Exception:
            pass

        # Última 1:1 + próxima por corretor
        last_oo, prox_oo = {}, {}
        try:
            for r in (sb.table("one_on_ones").select("corretor_id,data,proxima_data")
                      .order("data", desc=True).limit(1000).execute().data or []):
                c = r.get("corretor_id")
                if c and c not in last_oo:
                    last_oo[c] = r.get("data")
                    prox_oo[c] = r.get("proxima_data")
        except Exception:
            pass

        # Membros por equipe (pra agregado do líder)
        members_by_team = defaultdict(list)
        for u in people:
            members_by_team[(u.get("team") or "").lower()].append(u)
        is_socio = (user.get("lvl") or 0) >= 10

        out = []
        for u in people:
            cid = u.get("id")
            is_lider = (u.get("role") or "").lower() == "lider"
            # Líder vê o agregado da SUA equipe (e sócios veem de todos). Os demais
            # enxergam o líder como individual (privacidade da visão de equipe).
            show_team = is_lider and (is_socio or user.get("id") == cid)
            if show_team:
                team_key = (u.get("team") or "").lower()
                tmembers = members_by_team.get(team_key, [])
                tdeals = []
                tmeta = {"meta_vgv": 0, "meta_vendas": 0, "meta_visitas": 0, "meta_pastas": 0, "meta_propostas": 0, "meta_agendamentos": 0}
                for mb in tmembers:
                    tdeals += by_owner.get(mb.get("id"), [])
                    ms = meta_by_id.get(mb.get("id"), {})
                    for k in tmeta:
                        tmeta[k] += (ms.get(k, 0) if ms else 0)
                m = broker_metrics(tdeals, {}, tmeta, since_d, until_d, today, detail=False)
            else:
                m = broker_metrics(by_owner.get(cid, []), {}, meta_by_id.get(cid), since_d, until_d, today, detail=False)
            out.append({
                "id": cid, "name": u.get("name"), "role": u.get("role"), "team": u.get("team"),
                "ini": u.get("ini"), "color": u.get("color"),
                "is_team": bool(show_team),
                "vendas": m["kpis"]["vendas"], "vgv": m["kpis"]["vgv"],
                "visitas": m["kpis"]["visitas"], "agendamentos": m["kpis"]["agendamentos"],
                "propostas": m["kpis"]["propostas"], "leads": m["kpis"]["leads"],
                "win_rate": m["win_rate"], "descarte_rate": m["descarte_rate"],
                "health": m["health"], "health_color": m["health_color"],
                "meta_attainment_pct": m["meta_attainment_pct"],
                "alertas_count": len(m["alertas"]),
                "alertas_top": [a["txt"] for a in m["alertas"][:2]],
                "pendencias": m["pendencias"],
                "last_oo": last_oo.get(cid), "proxima_oo": prox_oo.get(cid),
            })
        # ── Investimento em ads / lead por corretor (CPL × leads) ──
        preset = params.get("date_preset") or "this_month"
        spend = read_meta_spend(sb, preset)
        total_leads = sum(len(by_owner.get(p.get("id"), [])) for p in people)
        cpl = round(spend / total_leads, 2) if (spend and total_leads) else None
        for c in out:
            # líderes (is_team) usam leads da equipe; corretores os próprios
            c["lead_invest"] = round((cpl or 0) * (c["leads"] or 0), 2) if cpl else None
        # ordena: mais alertas primeiro, depois menor health (quem precisa de atenção)
        out.sort(key=lambda x: (-(x["alertas_count"]), x["health"]))

        return self._send(200, {
            "ok": True,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                       "preset": preset},
            "count": len(out),
            "corretores": out,
            "meta_spend": spend, "cpl_global": cpl, "total_leads": total_leads,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
