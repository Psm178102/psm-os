"""
GET /api/v3/metas/atingimento?ano=2026
Header: Authorization: Bearer <token>

Cruza metas mensais (tabela `metas`) com deals GANHOS do RD CRM.
Match deal → corretor via email (user.email do RD ↔ users.email do Postgres).
Mês de atingimento usa `closed_at` ou `updated_at` do deal.

Retorna grid 12 meses × N corretores com:
  - meta_vgv
  - atingido_vgv (soma dos amounts dos deals ganhos no mês)
  - vendas_count
  - pct (atingido / meta * 100)
  - status: 'vazio' | 'critico' | 'atencao' | 'bom' | 'estourou'

Cache 5min (acúmulo de deals do RD é pesado).

Requer auth, role-based igual /metas/list.
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
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


RD_BASE = "https://crm.rdstation.com/api/v1"
_cache = {}  # ano -> (ts, data)
CACHE_TTL = 300  # 5min


def _rd_deals_won(token: str, since_iso: str | None = None):
    """Busca TODOS os deals ganhos com paginação."""
    all_deals = []
    page = 1
    while True:
        p = {"token": token, "win": "true", "limit": 200, "page": page}
        if since_iso:
            p["closed_at_period_to"] = since_iso  # NOTE: RD usa _period_from/to
        url = RD_BASE + "/deals?" + urllib.parse.urlencode(p)
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "PSM-OS-v3/atingimento",
        })
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return {"error": f"RD HTTP {e.code}", "deals": all_deals}
        except Exception as e:
            return {"error": str(e), "deals": all_deals}
        deals = data.get("deals") or []
        if not deals:
            break
        all_deals.extend(deals)
        if len(deals) < 200 or page >= 30:
            break
        page += 1
    return {"deals": all_deals}


def _deal_email(d):
    user = d.get("user") or {}
    if isinstance(user, dict):
        return (user.get("email") or "").lower()
    return ""


def _deal_amount(d):
    try:
        return float(d.get("amount_total") or d.get("amount_unique") or 0)
    except Exception:
        return 0.0


def _deal_closed_month(d):
    """Retorna (ano, mes) do fechamento do deal."""
    for key in ("closed_at", "updated_at", "created_at"):
        v = d.get(key)
        if not v: continue
        try:
            dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
            return dt.year, dt.month
        except Exception:
            continue
    return None, None


def _status(pct):
    if pct is None: return "vazio"
    if pct <= 0:    return "vazio"
    if pct < 50:    return "critico"
    if pct < 90:    return "atencao"
    if pct < 110:   return "bom"
    return "estourou"


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
        now = datetime.now(timezone.utc)
        try:
            ano = int(params.get("ano") or now.year)
        except Exception:
            ano = now.year

        rd_token = os.environ.get("RD_API_TOKEN")
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        # Cache check
        cache_hit = False
        cache_key = f"{ano}|{user['id']}"
        if cache_key in _cache:
            ts, cached = _cache[cache_key]
            if (time.time() - ts) < CACHE_TTL:
                cached = dict(cached)
                cached["cached"] = True
                cached["cache_age_s"] = int(time.time() - ts)
                return self._send(200, cached)

        # 1. Lista users + filtro por role
        try:
            users = sb.table("users").select("id,name,email,team,role,color,ini,status").execute().data or []
            users = [u for u in users if (u.get("status") or "ativo") == "ativo"]
            lvl = user.get("lvl") or 0
            scope = "all"
            if lvl < 7:
                role = (user.get("role") or "").lower()
                if role == "lider":
                    team = (user.get("team") or "").lower()
                    users = [u for u in users if (u.get("team") or "").lower() == team]
                    scope = "team"
                else:
                    users = [u for u in users if u.get("id") == user["id"]]
                    scope = "self"
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"users: {e}"})

        # Index por email
        users_by_email = {(u.get("email") or "").lower(): u for u in users if u.get("email")}

        # 2. Lista metas do ano
        try:
            metas_rows = sb.table("metas").select("*").eq("ano", ano).execute().data or []
            metas_idx = {(m["corretor_id"], m["mes"]): m for m in metas_rows}
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"metas: {e}"})

        # 3. RD deals ganhos do ano (se token configurado)
        rd_error = None
        atingido_idx = defaultdict(lambda: {"vgv": 0.0, "count": 0})
        if rd_token:
            r = _rd_deals_won(rd_token)
            if r.get("error"):
                rd_error = r["error"]
            else:
                for d in r["deals"]:
                    y, m = _deal_closed_month(d)
                    if y != ano or not m:
                        continue
                    email = _deal_email(d)
                    u = users_by_email.get(email)
                    if not u:
                        continue
                    amt = _deal_amount(d)
                    atingido_idx[(u["id"], m)]["vgv"] += amt
                    atingido_idx[(u["id"], m)]["count"] += 1
        else:
            rd_error = "RD_API_TOKEN ausente — atingimento ficará zerado"

        # 4. Compose grid
        grid = []
        tot_meta = 0.0
        tot_atingido = 0.0
        tot_count = 0
        for u in users:
            row_meta = 0.0; row_atingido = 0.0; row_count = 0
            cells = []
            for mes in range(1, 13):
                meta = metas_idx.get((u["id"], mes))
                meta_vgv = float(meta.get("meta_vgv") or 0) if meta else 0.0
                at = atingido_idx.get((u["id"], mes), {"vgv": 0.0, "count": 0})
                atingido_vgv = at["vgv"]
                vendas = at["count"]
                pct = (atingido_vgv / meta_vgv * 100) if meta_vgv > 0 else (None if atingido_vgv == 0 else 9999)
                cells.append({
                    "ano": ano, "mes": mes,
                    "meta_vgv": meta_vgv,
                    "atingido_vgv": atingido_vgv,
                    "vendas_count": vendas,
                    "pct": pct,
                    "status": _status(pct),
                })
                row_meta     += meta_vgv
                row_atingido += atingido_vgv
                row_count    += vendas
            row_pct = (row_atingido / row_meta * 100) if row_meta > 0 else None
            grid.append({
                "user": u,
                "cells": cells,
                "totals": {
                    "meta_vgv": row_meta,
                    "atingido_vgv": row_atingido,
                    "vendas_count": row_count,
                    "pct": row_pct,
                    "status": _status(row_pct),
                },
            })
            tot_meta += row_meta
            tot_atingido += row_atingido
            tot_count += row_count

        result = {
            "ok": True,
            "cached": False,
            "ano": ano,
            "scope": scope,
            "totals": {
                "meta_vgv": tot_meta,
                "atingido_vgv": tot_atingido,
                "vendas_count": tot_count,
                "pct": (tot_atingido / tot_meta * 100) if tot_meta > 0 else None,
            },
            "grid": grid,
            "rd_error": rd_error,
            "fetched_at": now.isoformat(),
        }
        _cache[cache_key] = (time.time(), result)

        return self._send(200, result)
