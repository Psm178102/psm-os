"""
GET /api/v3/metas/atingimento?ano=2026[&fallback_rd=1]
Header: Authorization: Bearer <token>

Cruza metas (Postgres) com deals ganhos (Postgres `deals` — sincronizada
por /api/v3/crm/sync). Se a tabela deals estiver vazia OU fallback_rd=1,
busca direto da RD API (mais lento, mas funciona sem sync).

Match deal → corretor via user_id já resolvido na tabela deals.
Mês de atingimento = mês de `closed_at`.

Cache 5min por (ano, user_id).
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
_cache = {}
CACHE_TTL = 300  # 5min


def _rd_deals_won(token):
    all_deals = []
    page = 1
    while True:
        p = {"token": token, "win": "true", "limit": 200, "page": page}
        url = RD_BASE + "/deals?" + urllib.parse.urlencode(p)
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3"})
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"error": str(e), "deals": all_deals}
        deals = data.get("deals") or []
        if not deals: break
        all_deals.extend(deals)
        if len(deals) < 200 or page >= 30: break
        page += 1
    return {"deals": all_deals}


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
        force_rd = params.get("fallback_rd") == "1"
        nocache = params.get("nocache") == "1"

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})

        cache_key = f"{ano}|{user['id']}|{force_rd}"
        if cache_key in _cache and not nocache:
            ts, cached = _cache[cache_key]
            if (time.time() - ts) < CACHE_TTL:
                out = dict(cached); out["cached"] = True; out["cache_age_s"] = int(time.time() - ts)
                return self._send(200, out)

        # 1. Users com filtro de role
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

        # 2. Metas do ano
        try:
            metas_rows = sb.table("metas").select("*").eq("ano", ano).execute().data or []
            metas_idx = {(m["corretor_id"], m["mes"]): m for m in metas_rows}
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"metas: {e}"})

        # 3. Atingimento — primeiro tenta Postgres deals; fallback RD
        atingido_idx = defaultdict(lambda: {"vgv": 0.0, "count": 0})
        source = "postgres"
        rd_error = None
        deals_synced_at = None

        if not force_rd:
            try:
                # Query: deals win=true do ano (closed_at)
                start = f"{ano}-01-01T00:00:00+00:00"
                end   = f"{ano + 1}-01-01T00:00:00+00:00"
                deals_rows = sb.table("deals").select("user_id,closed_at,amount,synced_at") \
                    .eq("win", True).gte("closed_at", start).lt("closed_at", end).execute().data or []
                if deals_rows:
                    for d in deals_rows:
                        uid = d.get("user_id")
                        if not uid: continue
                        ca = d.get("closed_at")
                        if not ca: continue
                        try:
                            dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
                            mes = dt.month
                        except Exception:
                            continue
                        atingido_idx[(uid, mes)]["vgv"] += float(d.get("amount") or 0)
                        atingido_idx[(uid, mes)]["count"] += 1
                        # Track latest synced_at
                        sy = d.get("synced_at")
                        if sy and (deals_synced_at is None or sy > deals_synced_at):
                            deals_synced_at = sy
                else:
                    # Vazio - tenta RD direto
                    source = "rd_fallback"
            except Exception as e:
                source = "rd_fallback"
                rd_error = f"postgres deals err: {e}"

        if source != "postgres" or force_rd:
            token = os.environ.get("RD_API_TOKEN")
            if not token:
                rd_error = (rd_error or "") + " | RD_API_TOKEN ausente"
            else:
                users_by_email = {(u.get("email") or "").lower(): u for u in users if u.get("email")}
                r = _rd_deals_won(token)
                if r.get("error"):
                    rd_error = r["error"]
                else:
                    source = "rd_live"
                    for d in r["deals"]:
                        # Mês do closed
                        ca = d.get("closed_at") or d.get("updated_at")
                        if not ca: continue
                        try:
                            dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
                            if dt.year != ano: continue
                            mes = dt.month
                        except Exception:
                            continue
                        user_d = d.get("user") or {}
                        email = (user_d.get("email") or "").lower() if isinstance(user_d, dict) else ""
                        u = users_by_email.get(email)
                        if not u: continue
                        amt = float(d.get("amount_total") or d.get("amount_unique") or 0)
                        atingido_idx[(u["id"], mes)]["vgv"] += amt
                        atingido_idx[(u["id"], mes)]["count"] += 1

        # 4. Compose grid
        grid = []
        tot_meta = 0.0; tot_atingido = 0.0; tot_count = 0
        for u in users:
            row_meta = 0.0; row_atingido = 0.0; row_count = 0
            cells = []
            for mes in range(1, 13):
                meta = metas_idx.get((u["id"], mes))
                meta_vgv = float(meta.get("meta_vgv") or 0) if meta else 0.0
                at = atingido_idx.get((u["id"], mes), {"vgv": 0.0, "count": 0})
                pct = (at["vgv"] / meta_vgv * 100) if meta_vgv > 0 else (None if at["vgv"] == 0 else 9999)
                cells.append({
                    "ano": ano, "mes": mes,
                    "meta_vgv": meta_vgv,
                    "meta_vendas": int(meta.get("meta_vendas") or 0) if meta else 0,
                    "meta_visitas": int(meta.get("meta_visitas") or 0) if meta else 0,
                    "meta_pastas": int(meta.get("meta_pastas") or 0) if meta else 0,
                    "meta_propostas": int(meta.get("meta_propostas") or 0) if meta else 0,
                    "meta_agendamentos": int(meta.get("meta_agendamentos") or 0) if meta else 0,
                    "atingido_vgv": at["vgv"],
                    "vendas_count": at["count"],
                    "pct": pct,
                    "status": _status(pct),
                })
                row_meta += meta_vgv; row_atingido += at["vgv"]; row_count += at["count"]
            row_pct = (row_atingido / row_meta * 100) if row_meta > 0 else None
            grid.append({
                "user": u,
                "cells": cells,
                "totals": {"meta_vgv": row_meta, "atingido_vgv": row_atingido,
                           "vendas_count": row_count, "pct": row_pct,
                           "status": _status(row_pct)},
            })
            tot_meta += row_meta; tot_atingido += row_atingido; tot_count += row_count

        # Visão achatada por corretor (consumida por relatorios, war-room/arena,
        # sr-gerencia/performance, metricas-viab — todos esperavam `por_corretor`).
        por_corretor = [{
            "id": g["user"].get("id"),
            "name": g["user"].get("name"),
            "team": g["user"].get("team") or g["user"].get("equipe") or g["user"].get("frente"),
            "role": g["user"].get("role"),
            "vgv_atingido": g["totals"]["atingido_vgv"],
            "meta_vgv": g["totals"]["meta_vgv"],
            "vendas": g["totals"]["vendas_count"],
            "pct": g["totals"]["pct"],
        } for g in grid]

        result = {
            "ok": True, "cached": False, "ano": ano, "scope": scope,
            "source": source, "deals_synced_at": deals_synced_at,
            "totals": {
                "meta_vgv": tot_meta, "atingido_vgv": tot_atingido,
                "vendas_count": tot_count,
                "pct": (tot_atingido / tot_meta * 100) if tot_meta > 0 else None,
            },
            # aliases de topo (metricas-viab lê total_vgv/total_vendas)
            "total_vgv": tot_atingido,
            "total_vendas": tot_count,
            "por_corretor": por_corretor,
            "grid": grid,
            "rd_error": rd_error,
            "fetched_at": now.isoformat(),
        }
        _cache[cache_key] = (time.time(), result)
        return self._send(200, result)
