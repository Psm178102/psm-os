"""
GET /api/v3/crm/deals[?pipeline_id=&stage_id=&limit=200&win=&owner_email=]
Header: Authorization: Bearer <token>

Proxy autenticado pro RD CRM API. Lista deals reais por pipeline/stage.
Cache 60s in-memory por (pipeline_id, stage_id, win, owner_email, limit).

Env var necessária no Vercel: RD_API_TOKEN

Sócio/Gerente (lvl>=7): vê todos
Líder (lvl 5): vê só do time
Corretor: vê só os próprios deals (via email_match)
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore


RD_BASE = "https://crm.rdstation.com/api/v1"
CACHE_TTL = 60
_cache = {}  # key -> (ts, data)


def _rd_get(endpoint: str, params: dict, token: str):
    """Chama RD CRM API com paginação. Retorna lista completa de deals."""
    all_deals = []
    page = 1
    while True:
        p = dict(params)
        p["token"] = token
        p["page"] = page
        qs = urllib.parse.urlencode(p)
        url = f"{RD_BASE}/{endpoint}?{qs}"
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "PSM-OS-v3/RD",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return {"error": f"RD HTTP {e.code}", "deals": all_deals}
        except Exception as e:
            return {"error": str(e), "deals": all_deals}

        deals = data.get("deals") or data.get("items") or []
        all_deals.extend(deals)
        # Stop conditions
        if len(deals) < (p.get("limit") or 200):
            break
        if page >= 50:  # safety
            break
        if len(all_deals) >= (params.get("max_total") or 1000):
            break
        page += 1
    return {"deals": all_deals}


def _scope_filter(deals, user, sb):
    """Filtra deals por scope do user."""
    lvl = user.get("lvl") or 0
    if lvl >= 7:
        return deals, "global"

    role = (user.get("role") or "").lower()
    if role == "lider":
        # Líder: filtra deals dos users do time
        team = (user.get("team") or "").lower()
        if not team or not sb:
            return [], "team_empty"
        try:
            team_users = sb.table("users").select("email").eq("team", team).execute().data or []
            emails = {(u.get("email") or "").lower() for u in team_users if u.get("email")}
        except Exception:
            emails = set()
        filtered = [d for d in deals if _deal_email(d) in emails]
        return filtered, "team"

    # Corretor: só os próprios (match por email)
    my_email = (user.get("email") or "").lower()
    filtered = [d for d in deals if _deal_email(d) == my_email]
    return filtered, "self"


def _deal_email(d):
    user = d.get("user") or {}
    if isinstance(user, dict):
        return (user.get("email") or "").lower()
    return ""


def _summary(deals):
    by_stage = defaultdict(lambda: {"count": 0, "valor": 0.0, "deals_amostra": []})
    total_valor = 0.0
    won = 0
    lost = 0
    open_count = 0
    for d in deals:
        stage = d.get("deal_stage") or {}
        s_name = stage.get("name") if isinstance(stage, dict) else "?"
        v = float(d.get("amount_total") or d.get("amount_unique") or 0)
        by_stage[s_name]["count"] += 1
        by_stage[s_name]["valor"] += v
        if len(by_stage[s_name]["deals_amostra"]) < 5:
            by_stage[s_name]["deals_amostra"].append({
                "id": d.get("id"),
                "name": d.get("name"),
                "amount": v,
                "user": _deal_email(d),
                "created_at": d.get("created_at"),
            })
        total_valor += v
        win = d.get("win")
        if win is True: won += 1
        elif win is False: lost += 1
        else: open_count += 1
    return {
        "by_stage": [{"stage": k, **v} for k, v in by_stage.items()],
        "total_count": len(deals),
        "total_valor": total_valor,
        "won": won,
        "lost": lost,
        "open": open_count,
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

        rd_token = os.environ.get("RD_API_TOKEN")
        if not rd_token:
            return self._send(503, {
                "ok": False,
                "error": "RD_API_TOKEN não configurado no Vercel",
                "hint": "Adicione RD_API_TOKEN nas env vars (Settings > Environment Variables)",
            })

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}

        # Build cache key
        cache_key = "|".join([
            params.get("pipeline_id", ""),
            params.get("stage_id", ""),
            params.get("win", ""),
            params.get("owner_email", ""),
            params.get("limit", "200"),
        ])

        # Cache check
        now = time.time()
        if cache_key in _cache:
            ts, cached = _cache[cache_key]
            if (now - ts) < CACHE_TTL:
                cached["cached"] = True
                cached["cache_age_s"] = int(now - ts)
                # Re-apply scope filter (user pode ser diferente)
                sb = supabase_client()
                scoped, scope = _scope_filter(cached["raw_deals"], user, sb)
                return self._send(200, {
                    **cached,
                    "deals": scoped[:50],  # limit response size
                    "summary": _summary(scoped),
                    "scope": scope,
                    "user_scope_count": len(scoped),
                })

        # Fetch from RD
        rd_params = {"limit": min(200, int(params.get("limit", "200")))}
        if params.get("pipeline_id"):  rd_params["deal_pipeline_id"] = params["pipeline_id"]
        if params.get("stage_id"):     rd_params["deal_stage_id"]    = params["stage_id"]
        if params.get("win") == "true":  rd_params["win"] = "true"
        if params.get("win") == "false": rd_params["win"] = "false"
        if params.get("owner_email"):  rd_params["user_email"] = params["owner_email"]
        rd_params["max_total"] = 600

        result = _rd_get("deals", rd_params, rd_token)
        if result.get("error"):
            return self._send(502, {"ok": False, "error": "RD: " + result["error"]})

        raw_deals = result.get("deals") or []
        sb = supabase_client()
        scoped, scope = _scope_filter(raw_deals, user, sb)

        payload = {
            "ok": True,
            "raw_count": len(raw_deals),
            "raw_deals": raw_deals,   # cached internamente, não enviado direto
            "deals": scoped[:50],
            "summary": _summary(scoped),
            "scope": scope,
            "user_scope_count": len(scoped),
            "filters": rd_params,
            "fetched_at": time.time(),
            "cached": False,
        }
        _cache[cache_key] = (now, payload)

        # Strip raw_deals da resposta (só cache interno)
        out = {k: v for k, v in payload.items() if k != "raw_deals"}
        return self._send(200, out)
