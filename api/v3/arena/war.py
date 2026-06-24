"""
GET /api/v3/arena/war — Placar de GUERRA público (War Arena na TV). v81.16

TUDO que aqui sai é seguro pra qualquer um ver na TV (inclusive corretores): só
competição — VGV, vendas e % da meta, por CASA, por EQUIPE e por GUERREIRO. NÃO
expõe CPL, investimento, saúde, alertas nem financeiro (isso é do War Room).

Lê os deals reais (RD) do mês + metas + users. Exclui sócio/diretor/gerente e quem
tem hide_from_ranking do ranking de guerreiros.

GET (lvl >= 2 — todos): { ok, casa, equipes[], guerreiros[], gerado_em }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, calendar
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

BRT = timedelta(hours=-3)
COMPET = ("corretor", "corretor_conquista", "corretor_map", "corretor_locacao", "lider", "líder")


def _all_deals(sb):
    rows, page = [], 0
    while True:
        q = sb.table("deals").select("amount,closed_at,created_at_rd,user_id,win").order("id").range(page * 1000, page * 1000 + 999)
        chunk = q.execute().data or []
        rows.extend(chunk)
        if len(chunk) < 1000 or page >= 50:
            break
        page += 1
    return rows


def _build(sb):
    now = datetime.now(timezone.utc)
    brt = now + BRT
    y, m, dia = brt.year, brt.month, brt.day
    inicio_mes = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    users = {}
    for u in (sb.table("users").select("id,name,ini,color,team,role,status,hide_from_ranking").execute().data or []):
        users[u.get("id")] = u

    try:
        metas = sb.table("metas").select("corretor_id,meta_vgv").eq("ano", y).eq("mes", m).execute().data or []
    except Exception:
        metas = []
    meta_by_user = {}
    for mt in metas:
        meta_by_user[mt.get("corretor_id")] = meta_by_user.get(mt.get("corretor_id"), 0) + float(mt.get("meta_vgv") or 0)

    deals = _all_deals(sb)
    def in_mes(r):
        d = r.get("closed_at") or r.get("created_at_rd") or ""
        return bool(d) and d >= inicio_mes
    wins = [r for r in deals if r.get("win") is True and in_mes(r)]

    by_user = {}
    casa_vgv = 0.0
    casa_vendas = 0
    for r in wins:
        amt = float(r.get("amount") or 0)
        casa_vgv += amt; casa_vendas += 1
        uid = r.get("user_id")
        if uid not in by_user:
            by_user[uid] = {"vgv": 0.0, "vendas": 0}
        by_user[uid]["vgv"] += amt; by_user[uid]["vendas"] += 1

    def is_competidor(u):
        _r = (u.get("role") or "").lower()
        return u and (_r.startswith("corretor") or _r in ("lider", "líder")) and not u.get("hide_from_ranking") and (u.get("status") or "ativo") == "ativo"

    # guerreiros (competidores ativos) — inclui quem tem meta mesmo sem venda
    guerreiros = []
    seen = set()
    for uid, u in users.items():
        if not is_competidor(u):
            continue
        seen.add(uid)
        v = by_user.get(uid, {"vgv": 0.0, "vendas": 0})
        meta = meta_by_user.get(uid, 0)
        guerreiros.append({
            "name": u.get("name") or "—", "ini": (u.get("ini") or (u.get("name") or "?")[:2]).upper(),
            "color": u.get("color") or "#64748b", "team": u.get("team") or "geral",
            "vgv": round(v["vgv"], 2), "vendas": v["vendas"],
            "meta_vgv": round(meta, 2), "meta_pct": round(v["vgv"] / meta * 100, 1) if meta > 0 else None,
        })
    guerreiros.sort(key=lambda g: (-g["vgv"], -g["vendas"]))

    # equipes (agrega competidores)
    teams = {}
    for g in guerreiros:
        t = (g["team"] or "geral").lower()
        if t not in teams:
            teams[t] = {"team": g["team"] or "geral", "vgv": 0.0, "vendas": 0, "meta_vgv": 0.0, "n": 0}
        teams[t]["vgv"] += g["vgv"]; teams[t]["vendas"] += g["vendas"]
        teams[t]["meta_vgv"] += g["meta_vgv"] or 0; teams[t]["n"] += 1
    equipes = []
    for t in teams.values():
        equipes.append({"team": t["team"], "vgv": round(t["vgv"], 2), "vendas": t["vendas"],
                        "meta_vgv": round(t["meta_vgv"], 2),
                        "pct": round(t["vgv"] / t["meta_vgv"] * 100, 1) if t["meta_vgv"] > 0 else None,
                        "corretores": t["n"]})
    equipes.sort(key=lambda e: -e["vgv"])

    casa_meta = sum(meta_by_user.values())
    # dias úteis (seg–sex) p/ projeção
    dim = calendar.monthrange(y, m)[1]
    uteis_total = sum(1 for d in range(1, dim + 1) if datetime(y, m, d).weekday() < 5)
    uteis_dec = sum(1 for d in range(1, dia + 1) if datetime(y, m, d).weekday() < 5)
    run_rate = casa_vgv / uteis_dec if uteis_dec else 0
    projecao = run_rate * uteis_total

    casa = {
        "vgv_mes": round(casa_vgv, 2), "vendas_mes": casa_vendas,
        "meta_vgv": round(casa_meta, 2),
        "pct": round(casa_vgv / casa_meta * 100, 1) if casa_meta > 0 else None,
        "falta": round(max(0.0, casa_meta - casa_vgv), 2),
        "projecao_fim": round(projecao, 2), "bate_meta": (projecao >= casa_meta) if casa_meta > 0 else None,
        "uteis_restantes": max(0, uteis_total - uteis_dec), "mes": brt.strftime("%m/%Y"),
    }
    return {"casa": casa, "equipes": equipes, "guerreiros": guerreiros, "gerado_em": now.isoformat()}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            return self._send(200, {"ok": True, **_build(sb)})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
