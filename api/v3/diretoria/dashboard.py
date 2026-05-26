"""
GET /api/v3/diretoria/dashboard[?ano=2026]
Header: Authorization: Bearer <token>

KPIs consolidados pra Diretoria: VGV ano, atingimento global,
comissões pendentes, # users ativos, # deals ganhos, dias até fechar mês.
Requer Sócio/Gerente (lvl>=7).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


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
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}
        now = datetime.now(timezone.utc)
        try: ano = int(params.get("ano") or now.year)
        except: ano = now.year
        mes_atual = now.month

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        kpis = {}
        errors = []

        # 1. Users ativos
        try:
            uq = sb.table("users").select("id,status,team,hide_from_ranking").execute().data or []
            ativos = [u for u in uq if (u.get("status") or "ativo") == "ativo"]
            kpis["users_ativos"] = len(ativos)
            kpis["users_total"] = len(uq)
            # Por team
            by_team = {}
            for u in ativos:
                t = u.get("team") or "geral"
                by_team[t] = by_team.get(t, 0) + 1
            kpis["users_by_team"] = by_team
        except Exception as e:
            errors.append(f"users: {e}")
            kpis["users_ativos"] = 0; kpis["users_total"] = 0

        # 2. Metas ano
        try:
            mq = sb.table("metas").select("meta_vgv,meta_vendas").eq("ano", ano).execute().data or []
            kpis["meta_vgv_ano"]    = sum(float(m.get("meta_vgv") or 0) for m in mq)
            kpis["meta_vendas_ano"] = sum(int(m.get("meta_vendas") or 0) for m in mq)
            kpis["metas_count"]     = len(mq)
        except Exception as e:
            errors.append(f"metas: {e}")
            kpis["meta_vgv_ano"] = 0; kpis["meta_vendas_ano"] = 0

        # 3. Deals ganhos do ano (Postgres)
        try:
            start = f"{ano}-01-01T00:00:00+00:00"
            end   = f"{ano+1}-01-01T00:00:00+00:00"
            dq = sb.table("deals").select("amount,closed_at") \
                .eq("win", True).gte("closed_at", start).lt("closed_at", end).execute().data or []
            kpis["atingido_vgv_ano"] = sum(float(d.get("amount") or 0) for d in dq)
            kpis["atingido_vendas_ano"] = len(dq)
            # Mês atual
            kpis["atingido_vgv_mes"] = 0; kpis["atingido_vendas_mes"] = 0
            for d in dq:
                ca = d.get("closed_at")
                if not ca: continue
                try:
                    dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
                    if dt.month == mes_atual:
                        kpis["atingido_vgv_mes"] += float(d.get("amount") or 0)
                        kpis["atingido_vendas_mes"] += 1
                except: pass
            kpis["atingimento_pct"] = (kpis["atingido_vgv_ano"] / kpis["meta_vgv_ano"] * 100) if kpis["meta_vgv_ano"] > 0 else None
        except Exception as e:
            errors.append(f"deals: {e}")
            kpis["atingido_vgv_ano"] = 0; kpis["atingido_vendas_ano"] = 0
            kpis["atingido_vgv_mes"] = 0; kpis["atingido_vendas_mes"] = 0

        # 4. Tarefas (count)
        try:
            tq = sb.table("dir_tasks").select("status").execute().data or []
            counts = {}
            for t in tq:
                s = t.get("status") or "aberta"
                counts[s] = counts.get(s, 0) + 1
            kpis["tarefas"] = counts
            kpis["tarefas_abertas"] = counts.get("aberta", 0) + counts.get("em_andamento", 0)
        except Exception as e:
            errors.append(f"tarefas: {e}")
            kpis["tarefas"] = {}; kpis["tarefas_abertas"] = 0

        # 5. Eventos hoje + próximos 7 dias
        try:
            today_iso = date.today().isoformat()
            from datetime import timedelta
            in7 = (date.today() + timedelta(days=7)).isoformat()
            eq = sb.table("eventos").select("id,tipo,status").gte("data", today_iso).lte("data", in7).execute().data or []
            kpis["eventos_proxima_semana"] = len(eq)
            kpis["eventos_hoje"] = len([e for e in eq if eq])  # simplificado
        except Exception as e:
            errors.append(f"eventos: {e}")
            kpis["eventos_proxima_semana"] = 0

        # 6. Audit últimas 24h
        try:
            from datetime import timedelta
            since_24h = (now - timedelta(hours=24)).isoformat()
            aq = sb.table("audit_log").select("action").gte("ts", since_24h).limit(5000).execute().data or []
            kpis["audit_24h"] = len(aq)
            # Top actions
            counts = {}
            for a in aq:
                k = a.get("action") or "?"
                counts[k] = counts.get(k, 0) + 1
            kpis["top_actions_24h"] = sorted(counts.items(), key=lambda x: -x[1])[:5]
            kpis["top_actions_24h"] = [{"action": k, "count": v} for k, v in kpis["top_actions_24h"]]
        except Exception as e:
            errors.append(f"audit: {e}")
            kpis["audit_24h"] = 0; kpis["top_actions_24h"] = []

        # 7. Recados ativos
        try:
            rq = sb.table("recados").select("id,prioridade,data_fim") \
                .or_(f"data_fim.is.null,data_fim.gte.{now.isoformat()}") \
                .execute().data or []
            kpis["recados_ativos"] = len(rq)
            kpis["recados_criticos"] = len([r for r in rq if (r.get("prioridade") or "") == "critica"])
        except Exception as e:
            errors.append(f"recados: {e}")
            kpis["recados_ativos"] = 0; kpis["recados_criticos"] = 0

        return self._send(200, {
            "ok": len(errors) == 0,
            "ano": ano,
            "mes": mes_atual,
            "kpis": kpis,
            "errors": errors,
            "fetched_at": now.isoformat(),
        })
