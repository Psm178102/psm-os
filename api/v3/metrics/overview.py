"""
GET /api/v3/metrics/overview
Header: Authorization: Bearer <token>

Retorna KPIs agregados para o Dashboard /v2. Role-based:
- Sócio/Gerente:    todos os dados (todo o time)
- Líder de equipe:  só o time dele
- Corretor:         só os próprios dados

Resp: {
  ok, scope: 'global'|'team'|'self',
  users:        { total, ativos, inativos, ocultos, by_team: {...} },
  commissions:  { count, pendentes, pagas, valor_total, valor_pendente },
  audit:        { last_24h, last_7d, top_actions: [...], recent: [...] },
  pipelines:    { count_active, by_pipeline: [...] }
}
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


def _scope_of(user):
    lvl = user.get("lvl") or 0
    role = (user.get("role") or "").lower()
    if lvl >= 7 or role in ("socio", "diretor", "gerente"):
        return "global"
    if role == "lider":
        return "team"
    return "self"


def _users_summary(sb, scope, user):
    res = sb.table("users").select("id,name,team,status,hide_from_ranking").execute()
    rows = res.data or []
    if scope == "team":
        rows = [r for r in rows if (r.get("team") or "").lower() == (user.get("team") or "").lower()]
    if scope == "self":
        rows = [r for r in rows if r.get("id") == user.get("id")]

    total = len(rows)
    ativos = sum(1 for r in rows if (r.get("status") or "ativo") == "ativo")
    inativos = total - ativos
    ocultos = sum(1 for r in rows if r.get("hide_from_ranking"))

    by_team = {}
    for r in rows:
        t = r.get("team") or "geral"
        by_team[t] = by_team.get(t, 0) + 1

    return {
        "total": total, "ativos": ativos, "inativos": inativos, "ocultos": ocultos,
        "by_team": by_team,
    }


def _commissions_summary(sb, scope, user):
    res = sb.table("commissions").select("id,corretor_id,valor,status,data,data_pagamento").execute()
    rows = res.data or []
    if scope == "team":
        # Filtra os do time — precisamos saber os user_ids do time
        team = (user.get("team") or "").lower()
        team_ids = {u["id"] for u in (sb.table("users").select("id").eq("team", team).execute().data or [])}
        rows = [r for r in rows if r.get("corretor_id") in team_ids]
    if scope == "self":
        rows = [r for r in rows if r.get("corretor_id") == user["id"]]

    count = len(rows)
    pendentes = sum(1 for r in rows if (r.get("status") or "").lower() in ("pendente", "aberto", "previsto"))
    pagas = count - pendentes
    valor_total = sum(float(r.get("valor") or 0) for r in rows)
    valor_pendente = sum(float(r.get("valor") or 0) for r in rows if (r.get("status") or "").lower() in ("pendente", "aberto", "previsto"))

    return {
        "count": count, "pendentes": pendentes, "pagas": pagas,
        "valor_total": valor_total, "valor_pendente": valor_pendente,
    }


def _audit_summary(sb, scope, user):
    now = datetime.now(timezone.utc)
    iso_24h = (now - timedelta(hours=24)).isoformat()
    iso_7d  = (now - timedelta(days=7)).isoformat()

    q24 = sb.table("audit_log").select("id", count="exact").gte("ts", iso_24h)
    q7  = sb.table("audit_log").select("id", count="exact").gte("ts", iso_7d)
    if scope == "self":
        q24 = q24.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
        q7  = q7.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
    last_24h = q24.execute().count or 0
    last_7d  = q7.execute().count or 0

    # Top 5 actions (últimos 30d)
    iso_30d = (now - timedelta(days=30)).isoformat()
    qaction = sb.table("audit_log").select("action").gte("ts", iso_30d)
    if scope == "self":
        qaction = qaction.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
    rows = qaction.execute().data or []
    counts = {}
    for r in rows:
        a = r.get("action") or "?"
        counts[a] = counts.get(a, 0) + 1
    top_actions = sorted(counts.items(), key=lambda x: -x[1])[:5]
    top_actions = [{"action": k, "count": v} for k, v in top_actions]

    # 5 mais recentes
    qrecent = sb.table("audit_log").select("ts,actor_id,actor_name,action,target_id,notes").order("ts", desc=True).limit(5)
    if scope == "self":
        qrecent = qrecent.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
    recent = qrecent.execute().data or []

    return {"last_24h": last_24h, "last_7d": last_7d, "top_actions": top_actions, "recent": recent}


def _pipelines_summary(sb):
    res = sb.table("rd_pipelines").select("id,name,external_id,active,excluded_from_metrics").execute()
    rows = res.data or []
    active = [r for r in rows if r.get("active") is not False and not r.get("excluded_from_metrics")]
    return {
        "count_total":  len(rows),
        "count_active": len(active),
        "by_pipeline":  [{"name": r.get("name"), "active": bool(r.get("active")), "excluded": bool(r.get("excluded_from_metrics"))} for r in rows],
    }


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

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        scope = _scope_of(user)

        result = {"ok": True, "scope": scope, "user": {"id": user["id"], "name": user.get("name"), "role": user.get("role"), "team": user.get("team"), "lvl": user.get("lvl")}}
        try:
            result["users"]       = _users_summary(sb, scope, user)
        except Exception as e:
            result["users"] = {"error": str(e)}
        try:
            result["commissions"] = _commissions_summary(sb, scope, user)
        except Exception as e:
            result["commissions"] = {"error": str(e)}
        try:
            result["audit"]       = _audit_summary(sb, scope, user)
        except Exception as e:
            result["audit"] = {"error": str(e)}
        try:
            result["pipelines"]   = _pipelines_summary(sb)
        except Exception as e:
            result["pipelines"] = {"error": str(e)}

        return self._send(200, result)
