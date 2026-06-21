"""
GET /api/v3/marketing/leads_creative?date_preset=last_90d[&since=&until=]
Header: Authorization: Bearer <token> (Líder lvl>=5)

Ciclo de vendas por FORMATO DE CRIATIVO (#5) — a partir dos Lead Ads capturados
(meta_leads, via webhook) cruzados com os deals do RD (matched_deal_id):
quantos leads por formato (vídeo/carrossel/imagem), quantos viraram venda e o
tempo médio (dias) do lead até o fechamento. Prova o ROI do audiovisual.

Sem dados capturados ainda → retorna ok com pending=True (front mostra aviso).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore

LABELS = {"video": "🎬 Vídeo", "carousel": "🎠 Carrossel", "image": "🖼 Imagem estática", "unknown": "❓ Outros"}


def _parse(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _window(p):
    today = datetime.now(timezone.utc).date()
    if p.get("since") and p.get("until"):
        try:
            return date.fromisoformat(p["since"]), date.fromisoformat(p["until"])
        except Exception:
            pass
    preset = p.get("date_preset") or "last_90d"
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "this_year":
        return today.replace(month=1, day=1), today
    days = {"last_7d": 7, "last_14d": 14, "last_30d": 30, "last_90d": 90}.get(preset, 90)
    return today - timedelta(days=days - 1), today


def _median(v):
    v = sorted(x for x in v if x is not None)
    if not v:
        return None
    n = len(v); m = n // 2
    return v[m] if n % 2 else (v[m - 1] + v[m]) / 2.0


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
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        since_d, until_d = _window(params)
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        since_iso = since_d.isoformat() + "T00:00:00+00:00"
        until_iso = (until_d + timedelta(days=1)).isoformat() + "T00:00:00+00:00"
        try:
            leads = (sb.table("meta_leads").select("leadgen_id,creative_type,created_time,matched_deal_id")
                     .gte("created_time", since_iso).lt("created_time", until_iso)
                     .limit(10000).execute().data or [])
        except Exception as e:
            # Tabela ainda não criada (SQL não rodado) ou indisponível → degrada
            # pra "pending" (não quebra o dashboard com 500).
            return self._send(200, {"ok": True, "pending": True,
                                    "period": {"since": since_d.isoformat(), "until": until_d.isoformat()},
                                    "by_creative": [], "total_leads": 0,
                                    "hint": "Tabela meta_leads ainda não criada. Rode supabase/sprint9_18_meta_leads.sql."})

        if not leads:
            return self._send(200, {"ok": True, "pending": True,
                                    "period": {"since": since_d.isoformat(), "until": until_d.isoformat()},
                                    "by_creative": [], "total_leads": 0,
                                    "hint": "Sem leads capturados ainda. Configure o webhook de Lead Ads no Meta."})

        # deals casados → win/closed pra calcular ciclo e vendas
        deal_ids = [l["matched_deal_id"] for l in leads if l.get("matched_deal_id")]
        deal_by_id = {}
        for i in range(0, len(deal_ids), 100):
            chunk = deal_ids[i:i + 100]
            try:
                for d in (sb.table("deals").select("id,win,amount,closed_at").in_("id", chunk).execute().data or []):
                    deal_by_id[d["id"]] = d
            except Exception:
                pass

        agg = defaultdict(lambda: {"leads": 0, "matched": 0, "vendas": 0, "vgv": 0.0, "ciclo": []})
        for l in leads:
            ct = l.get("creative_type") or "unknown"
            a = agg[ct]
            a["leads"] += 1
            did = l.get("matched_deal_id")
            d = deal_by_id.get(did) if did else None
            if d:
                a["matched"] += 1
                if d.get("win") is True:
                    a["vendas"] += 1
                    a["vgv"] += float(d.get("amount") or 0)
                    lc = _parse(l.get("created_time")); dc = _parse(d.get("closed_at"))
                    if lc and dc and dc >= lc:
                        a["ciclo"].append((dc - lc).total_seconds() / 86400.0)

        out = []
        for ct, a in agg.items():
            out.append({
                "creative_type": ct, "label": LABELS.get(ct, ct),
                "leads": a["leads"], "matched": a["matched"], "vendas": a["vendas"],
                "vgv": round(a["vgv"], 2),
                "ciclo_medio_dias": round(_median(a["ciclo"]), 1) if a["ciclo"] else None,
                "conv_pct": round(a["vendas"] / a["leads"] * 100, 2) if a["leads"] else None,
            })
        out.sort(key=lambda x: -x["leads"])
        return self._send(200, {
            "ok": True, "pending": False,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat()},
            "total_leads": len(leads), "matched_total": len(deal_by_id),
            "by_creative": out,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
