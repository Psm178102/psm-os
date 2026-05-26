"""
GET /api/v3/metrics/activity_ranking[?limit=20&days=30]
Header: Authorization: Bearer <token>

Ranking dos usuários por atividade no sistema:
- # eventos em que foram actor no audit_log (últimos N dias)
- # vezes em que foram target (mudanças nos próprios dados)
- Último login (last_login_at)
- Tempo desde último login

Útil enquanto não temos dados de venda no Postgres. Quando RD migrar,
substituímos por ranking de VGV/vendas.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta
from collections import defaultdict

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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}
        limit = max(1, min(50, int(params.get("limit", "20") or "20")))
        days  = max(1, min(365, int(params.get("days", "30") or "30")))

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        # Lê users ativos
        try:
            res = sb.table("users").select(
                "id,name,email,role,team,ini,color,status,last_login_at,hide_from_ranking"
            ).execute()
            users = [u for u in (res.data or []) if (u.get("status") or "ativo") == "ativo" and not u.get("hide_from_ranking")]
            users_by_id = {u["id"]: u for u in users}
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})

        # Lê audit nos últimos N dias
        try:
            audit = sb.table("audit_log").select("actor_id,target_id,action,ts").gte("ts", since).limit(5000).execute()
            entries = audit.data or []
        except Exception as e:
            entries = []

        # Conta
        actor_count = defaultdict(int)
        target_count = defaultdict(int)
        login_count = defaultdict(int)
        last_action = {}
        for e in entries:
            aid = e.get("actor_id")
            tid = e.get("target_id")
            act = e.get("action") or ""
            ts  = e.get("ts")
            if aid:
                actor_count[aid] += 1
                if act == "auth.login_ok":
                    login_count[aid] += 1
                # Track last action timestamp per user
                cur = last_action.get(aid)
                if not cur or (ts and ts > cur["ts"]):
                    last_action[aid] = {"ts": ts, "action": act}
            if tid:
                target_count[tid] += 1

        # Compõe ranking
        ranking = []
        for u in users:
            uid = u["id"]
            ranking.append({
                "id":   uid,
                "name": u.get("name"),
                "role": u.get("role"),
                "team": u.get("team"),
                "ini":  u.get("ini"),
                "color": u.get("color"),
                "events_as_actor":   actor_count.get(uid, 0),
                "events_as_target":  target_count.get(uid, 0),
                "logins_period":     login_count.get(uid, 0),
                "last_login_at":     u.get("last_login_at"),
                "last_action_ts":    (last_action.get(uid) or {}).get("ts"),
                "last_action":       (last_action.get(uid) or {}).get("action"),
                "score":             actor_count.get(uid, 0) * 2 + target_count.get(uid, 0),
            })

        ranking.sort(key=lambda x: (-x["score"], (x.get("last_login_at") or ""), x.get("name") or ""))

        return self._send(200, {
            "ok": True,
            "days": days,
            "limit": limit,
            "since": since,
            "ranking": ranking[:limit],
            "total_users_active": len(users),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
