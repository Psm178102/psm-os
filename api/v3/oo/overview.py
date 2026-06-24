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
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _oo_lib import (window, months_in_range, broker_metrics, read_meta_spend, meta_for_period,  # type: ignore
                     read_meta_accounts, match_team_account, read_team_account_override,
                     read_meta_campaigns, compute_ads_invest)


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
                  if ((u.get("role") or "").lower().startswith("corretor") or (u.get("role") or "").lower() in ("lider", "gerente"))
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

        # Metas: meta MENSAL × nº de meses (via meta_for_period) — evita somar
        # metas mensais esparsas (que dava meta incoerente vs realizado).
        try:
            all_metas = sb.table("metas").select("*").execute().data or []
        except Exception:
            all_metas = []
        meta_by_id = {}
        for u in people:
            meta_by_id[u.get("id")] = meta_for_period(all_metas, u.get("id"), since_d, until_d)

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

        # 💸 Investimento em ads por LEAD (CPL exato da campanha do lead; fallback conta da equipe)
        _ma = read_meta_accounts(sb)
        _ovr = read_team_account_override(sb)
        _mc = read_meta_campaigns(sb)

        def _row_invest(team, dsub):
            acc = match_team_account(_ma["accounts"], team, _ovr)
            tcpl = acc["cpl"] if (acc and acc.get("cpl") is not None) else None
            r = compute_ads_invest(dsub, since_d, until_d, _mc, tcpl, _ma["global_cpl"], acc["label"] if acc else None)
            return r["invest"], ("equipe" if tcpl is not None else ("global" if _ma["global_cpl"] else None)), (acc["label"] if acc else None)

        out = []
        for u in people:
            cid = u.get("id")
            is_manager = (u.get("role") or "").lower() in ("lider", "gerente")
            # Líder/Gerente vê o agregado da SUA equipe (e sócios veem de todos). Os demais
            # enxergam o gestor como individual (privacidade da visão de equipe).
            show_team = is_manager and (is_socio or user.get("id") == cid)
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
                row_deals = tdeals
            else:
                row_deals = by_owner.get(cid, [])
                m = broker_metrics(row_deals, {}, meta_by_id.get(cid), since_d, until_d, today, detail=False)
            _inv, _invbase, _invlbl = _row_invest(u.get("team"), row_deals)
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
                "lead_invest": _inv, "cpl_base": _invbase, "conta_label": _invlbl,
            })
        # ordena: mais alertas primeiro, depois menor health (quem precisa de atenção)
        out.sort(key=lambda x: (-(x["alertas_count"]), x["health"]))

        return self._send(200, {
            "ok": True,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat(),
                       "preset": params.get("date_preset") or ("custom" if params.get("since") else "this_month")},
            "count": len(out),
            "corretores": out,
            "meta_spend": _ma["global_spend"], "cpl_global": _ma["global_cpl"], "total_leads": _ma["global_leads"],
            "meta_accounts": _ma["accounts"], "cpl_periodo": _ma["preset_used"],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
