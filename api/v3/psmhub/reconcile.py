"""
GET /api/v3/psmhub/reconcile?month=&year= — RECONCILIAÇÃO CORRETOR-A-CORRETOR. v77.77

Cruza, por corretor da Equipe Conquista, o VGV/vendas do psmhub × o VGV/vendas do RD
(deals win=true no mês). O ELO é o E-MAIL do corretor:
    psmhub agent.userEmail  ↔  users.email  ↔  deals.user_email
(é a mesma chave que o sync do RD usa pra casar deal→corretor), com fallback em
rd_id (agent.rdUserId ↔ users.rd_id) e, por último, nome normalizado.
A BASE do match vai explícita em cada linha (honesto: nunca casa no chute).

Resposta: { ok, month, year, rows:[{nome,email,team,psmhub_vgv,psmhub_vendas,
            rd_vgv,rd_vendas,diff_pct,match,ok,rd_zero}], totals, basis_counts, errors }.
lvl>=7 (auditoria de diretoria).
"""
from http.server import BaseHTTPRequestHandler
import os, sys, json, urllib.parse, unicodedata
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from _psmhub_lib import get as hub_get, configured             # type: ignore


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii")
    return " ".join(s.lower().split())


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        if not configured():
            return self._send(200, {"ok": False, "pending_config": True,
                                    "error": "Configure PSMHUB_EMAIL e PSMHUB_PASSWORD no Vercel pra ligar o PSM HUB."})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        now = datetime.now(timezone.utc) - timedelta(hours=3)
        month = int(q.get("month") or now.month)
        year = int(q.get("year") or now.year)
        ym = f"{year:04d}-{month:02d}"
        mq = f"month={month}&year={year}"

        # 1) psmhub: esteira (VGV/vendas por corretor) + agents (email/rd_id por agentId)
        errs = {}
        try:
            est = hub_get(f"/api/dashboard/esteira?period=mensal&{mq}")
            est_rows = (est or {}).get("rows") or []
        except Exception as e:
            est_rows = []; errs["esteira"] = str(e)[:160]
        try:
            agents = hub_get("/api/agents") or []
            if isinstance(agents, dict):
                agents = agents.get("agents") or agents.get("rows") or []
        except Exception as e:
            agents = []; errs["agents"] = str(e)[:160]
        agent_by_id = {a.get("id"): a for a in agents if isinstance(a, dict)}

        # 2) House PSM users → índices de match (email / rd_id / nome)
        users = sb.table("users").select("id,name,email,rd_id,team").execute().data or []
        by_email = {(u.get("email") or "").lower(): u for u in users if u.get("email")}
        by_rdid  = {str(u.get("rd_id")): u for u in users if u.get("rd_id")}
        by_name  = {_norm(u.get("name")): u for u in users if u.get("name")}

        # 3) deals win=true do MÊS → VGV/contagem por user_id e por email
        deals, page = [], 0
        while True:
            chunk = (sb.table("deals").select("amount,closed_at,created_at_rd,user_id,user_email,win")
                     .eq("win", True).order("id").range(page * 1000, page * 1000 + 999).execute().data or [])
            deals.extend(chunk)
            if len(chunk) < 1000 or page >= 50:
                break
            page += 1

        def in_month(r):
            d = (r.get("closed_at") or r.get("created_at_rd") or "")
            return str(d)[:7] == ym

        wins = [r for r in deals if in_month(r)]
        rd_by_uid, rd_by_email = {}, {}
        for r in wins:
            amt = float(r.get("amount") or 0)
            uid = r.get("user_id")
            em = (r.get("user_email") or "").lower()
            if uid:
                b = rd_by_uid.setdefault(uid, {"vgv": 0.0, "count": 0}); b["vgv"] += amt; b["count"] += 1
            if em:
                b = rd_by_email.setdefault(em, {"vgv": 0.0, "count": 0}); b["vgv"] += amt; b["count"] += 1

        # 4) reconcilia por corretor da Conquista (linhas da esteira)
        rows, matched_uids, matched_emails = [], set(), set()
        for er in est_rows:
            ag = agent_by_id.get(er.get("agentId")) or {}
            email = (ag.get("userEmail") or "").lower()
            rdid = str(ag.get("rdUserId") or "")
            nome = ag.get("userName") or er.get("agentName") or "—"

            u, basis = None, "sem match"
            if email and email in by_email:
                u, basis = by_email[email], "email"
            elif rdid and rdid in by_rdid:
                u, basis = by_rdid[rdid], "rd_id"
            elif _norm(nome) in by_name:
                u, basis = by_name[_norm(nome)], "nome"

            rd = {"vgv": 0.0, "count": 0}
            if u:
                rd = rd_by_uid.get(u["id"]) or rd_by_email.get((u.get("email") or "").lower()) or {"vgv": 0.0, "count": 0}
                matched_uids.add(u["id"]); matched_emails.add((u.get("email") or "").lower())
            elif email and email in rd_by_email:
                rd = rd_by_email[email]; matched_emails.add(email)

            ph_vgv = float(er.get("vendaTotal") or 0)
            ph_n = int(er.get("vendaCount") or 0)
            diff = round((ph_vgv - rd["vgv"]) / rd["vgv"] * 100, 2) if rd["vgv"] > 0 else None
            rows.append({
                "nome": nome, "email": email or None,
                "team": ag.get("teamName") or (u or {}).get("team"),
                "psmhub_vgv": ph_vgv, "psmhub_vendas": ph_n,
                "rd_vgv": rd["vgv"], "rd_vendas": rd["count"],
                "diff_pct": diff, "match": basis,
                "rd_zero": (rd["vgv"] == 0 and ph_vgv > 0),
                "ok": (diff is not None and abs(diff) <= 5),
            })
        rows.sort(key=lambda r: (-(r["psmhub_vgv"] or 0), -(r["rd_vgv"] or 0)))

        # 5) totais + "outros times no RD" (empresa − Conquista reconciliada)
        tot_ph = sum(r["psmhub_vgv"] for r in rows)
        tot_ph_n = sum(r["psmhub_vendas"] for r in rows)
        tot_rd_conq = sum(r["rd_vgv"] for r in rows)
        tot_rd_conq_n = sum(r["rd_vendas"] for r in rows)
        rd_empresa = sum(float(r.get("amount") or 0) for r in wins)
        rd_empresa_n = len(wins)
        basis_counts = {}
        for r in rows:
            basis_counts[r["match"]] = basis_counts.get(r["match"], 0) + 1

        return self._send(200, {
            "ok": True, "month": month, "year": year, "rows": rows,
            "totals": {
                "psmhub_vgv": tot_ph, "psmhub_vendas": tot_ph_n,
                "rd_conquista_vgv": tot_rd_conq, "rd_conquista_vendas": tot_rd_conq_n,
                "rd_empresa_vgv": rd_empresa, "rd_empresa_vendas": rd_empresa_n,
                "outros_times_vgv": rd_empresa - tot_rd_conq, "outros_times_vendas": rd_empresa_n - tot_rd_conq_n,
            },
            "basis_counts": basis_counts, "errors": errs or None,
            "source": "psmhub.com.br + RD/deals", "fetched_at": now.isoformat()})
