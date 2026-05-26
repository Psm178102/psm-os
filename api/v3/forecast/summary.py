"""GET /api/v3/forecast/summary[?ano=2026] — projeção de vendas baseada em deals abertos × peso do stage"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


# Pesos heurísticos por palavra-chave no nome do stage
STAGE_WEIGHTS = [
    ("ganho",    1.0), ("won",       1.0), ("fechado",  1.0),
    ("proposta", 0.7), ("negociaca", 0.7), ("contrato", 0.9),
    ("qualific", 0.4),
    ("agendad",  0.3), ("visita",    0.3),
    ("contato",  0.15),
    ("primeiro", 0.1), ("lead",      0.1), ("inicio",   0.1),
    ("perd",     0.0), ("lost",      0.0), ("cancel",   0.0),
]


def _weight_for_stage(name):
    if not name: return 0.2
    n = name.lower()
    for kw, w in STAGE_WEIGHTS:
        if kw in n: return w
    return 0.2  # default conservador


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
        try: user = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        now = datetime.now(timezone.utc)
        try: ano = int(params.get("ano") or now.year)
        except: ano = now.year
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        # Lê deals abertos (win is null) do ano corrente
        try:
            start = f"{ano}-01-01T00:00:00+00:00"
            end   = f"{ano+1}-01-01T00:00:00+00:00"
            rows = sb.table("deals").select("id,name,amount,closed_at,updated_at,stage_name,user_id,win") \
                .is_("win", "null").gte("updated_at", start).lt("updated_at", end).limit(2000).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"deals: {e}"})

        # Bucket por mês (usa closed_at se houver, senão updated_at + 30d como estimativa)
        by_month = defaultdict(lambda: {"deals": 0, "valor_total": 0.0, "valor_ponderado": 0.0, "by_stage": defaultdict(lambda: {"count":0, "valor":0.0, "weight":0})})
        total_valor = 0.0; total_ponderado = 0.0
        # Top stages (counts gerais)
        stage_counts = defaultdict(lambda: {"count":0, "valor":0.0, "weight":0})

        for d in rows:
            amt = float(d.get("amount") or 0)
            stage = d.get("stage_name") or "?"
            w = _weight_for_stage(stage)
            # Mês: usa closed_at se existe, senão estima updated_at (mês corrente)
            ts = d.get("closed_at") or d.get("updated_at")
            try:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00")) if ts else now
            except: dt = now
            mk = f"{dt.year:04d}-{dt.month:02d}"
            b = by_month[mk]
            b["deals"] += 1
            b["valor_total"] += amt
            b["valor_ponderado"] += amt * w
            b["by_stage"][stage]["count"] += 1
            b["by_stage"][stage]["valor"] += amt
            b["by_stage"][stage]["weight"] = w
            total_valor += amt; total_ponderado += amt * w
            stage_counts[stage]["count"] += 1
            stage_counts[stage]["valor"] += amt
            stage_counts[stage]["weight"] = w

        # Order rows por mês
        months_out = []
        for k in sorted(by_month.keys()):
            b = by_month[k]
            stages_arr = sorted([{"stage": s, **v} for s, v in b["by_stage"].items()], key=lambda x: -x["valor"])
            months_out.append({"month": k, **{kk: vv for kk, vv in b.items() if kk != "by_stage"}, "stages": stages_arr})

        stages_total = sorted([{"stage": s, **v} for s, v in stage_counts.items()], key=lambda x: -x["valor"])

        return self._send(200, {
            "ok": True, "ano": ano,
            "totals": {"deals": len(rows), "valor_total": total_valor, "valor_ponderado": total_ponderado},
            "months": months_out,
            "stages": stages_total,
            "weights_used": dict(STAGE_WEIGHTS),
            "fetched_at": now.isoformat(),
        })
