"""
GET  /api/v3/marketing/ad_library            → último snapshot por concorrente + KPIs
GET  /api/v3/marketing/ad_library?concorrente=X → histórico do concorrente
POST /api/v3/marketing/ad_library            → cria snapshot (lvl>=5)
Header: Authorization: Bearer <token>

Inteligência de Biblioteca de Anúncios dos concorrentes (Meta Ad Library).
Snapshots colados/capturados + análise da IA. Sem dado de gasto real (Meta não
publica p/ anúncio comercial) — investimento é estimativa qualitativa.
Degrada gracioso se a tabela ainda não existir (pending=True).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore

ALLOWED = ["concorrente", "page_name", "url", "ads_count", "formats",
           "conteudo", "ai_analysis", "nivel_invest", "segmento", "notes"]


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=3)  # Marketing (lvl3) ou acima
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = (sb.table("ad_library_snapshots").select("*")
                    .order("captured_at", desc=True).limit(500).execute().data or [])
        except Exception:
            return self._send(200, {"ok": True, "pending": True, "snapshots": [], "latest": [],
                                    "hint": "Tabela ad_library_snapshots ainda não criada. Rode supabase/sprint9_19_ad_library.sql."})

        conc = (params.get("concorrente") or "").strip()
        if conc:
            hist = [r for r in rows if (r.get("concorrente") or "") == conc]
            return self._send(200, {"ok": True, "concorrente": conc, "history": hist})

        # Último snapshot por concorrente + Δ vs anterior
        latest, seen = [], {}
        for r in rows:  # já ordenado desc
            c = r.get("concorrente") or "?"
            if c not in seen:
                seen[c] = r
                latest.append(r)
            elif "_prev" not in seen[c]:
                seen[c]["_prev_count"] = r.get("ads_count")
        for r in latest:
            prev = r.get("_prev_count")
            r["delta"] = (r.get("ads_count") or 0) - prev if prev is not None else None
        latest.sort(key=lambda x: -(x.get("ads_count") or 0))
        return self._send(200, {
            "ok": True, "count": len(latest), "latest": latest,
            "total_concorrentes": len(seen),
            "total_ads": sum((r.get("ads_count") or 0) for r in latest),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        if body.get("_delete") and body.get("id"):
            try:
                sb.table("ad_library_snapshots").delete().eq("id", body["id"]).execute()
                return self._send(200, {"ok": True, "deleted": body["id"]})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        conc = (body.get("concorrente") or "").strip()
        if not conc:
            return self._send(400, {"ok": False, "error": "concorrente obrigatório"})
        row = {"criado_por": actor.get("id")}
        for k in ALLOWED:
            if k in body and body[k] is not None:
                row[k] = body[k]
        row["concorrente"] = conc
        try:
            row["ads_count"] = int(row.get("ads_count") or 0)
        except Exception:
            row["ads_count"] = 0
        try:
            res = sb.table("ad_library_snapshots").insert(row).execute()
            audit(self, actor, "ad_library.snapshot", target_type="ad_library_snapshots",
                  target_id=conc, notes=f"ads={row['ads_count']}")
            return self._send(200, {"ok": True, "item": (res.data or [row])[0]})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
