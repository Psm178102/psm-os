"""
GET/POST /api/v3/crm/events_backfill
  Auth: JWT Sócio/Gerente (lvl>=7)  OU  ?key=<CRON_SECRET|RD_WEBHOOK_KEY>

Seed inicial da tabela deal_stage_events: grava 1 evento de ESTADO ATUAL por
deal já existente em `deals` (source='backfill', occurred_at = updated_at_rd).
Idempotente — pode rodar quantas vezes quiser (dedup por
deal_id+stage_id+occurred_at).

Por que existe: dá ao log um ponto de partida (onde cada deal está hoje) e
permite que a régua "desde quando temos captura" funcione. As métricas REAIS de
verdade só contam eventos NÃO-backfill (capturados pelo webhook/sync daqui pra
frente); este seed entra como estimativa, nunca como verdade.

NÃO importa sdr_touchpoints (são toques, não transições de etapa) — pra manter o
modelo de eventos limpo (1 evento = deal entrou numa etapa).

Resp: { ok, deals_scanned, events_written, capture_real_since, duration_s }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from _events_lib import record_many, capture_enabled_since  # type: ignore


def _key_ok(path):
    secrets = [s for s in (os.environ.get("CRON_SECRET"), os.environ.get("RD_WEBHOOK_KEY")) if s]
    if not secrets:
        return False
    try:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))
        return q.get("key") in secrets
    except Exception:
        return False


def _synthetic_deal(row):
    """Reconstrói um deal mínimo a partir das colunas de `deals` p/ o build_event."""
    return {
        "id": row.get("id"),
        "updated_at": row.get("updated_at_rd") or row.get("created_at_rd"),
        "created_at": row.get("created_at_rd"),
        "win": row.get("win"),
        "amount": row.get("amount"),
        "deal_stage": {"id": row.get("stage_id"), "name": row.get("stage_name")},
        "deal_pipeline": {"id": row.get("pipeline_id"), "name": row.get("pipeline_name")},
        "user": {"email": row.get("user_email")},
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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _run(self):
        actor = None
        if not _key_ok(self.path):
            try:
                actor = require_user(self, min_lvl=7)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        t0 = time.time()
        cols = "id,stage_id,stage_name,pipeline_id,pipeline_name,win,amount,user_email,updated_at_rd,created_at_rd"
        scanned = 0
        written = 0
        page = 0
        size = 1000
        max_pages = 100  # teto generoso (100k deals) — sem corte silencioso real
        while page < max_pages:
            try:
                rows = (sb.table("deals").select(cols)
                        .range(page * size, page * size + size - 1)
                        .execute().data or [])
            except Exception as e:
                return self._send(502, {"ok": False, "error": f"deals: {e}", "events_written": written})
            if not rows:
                break
            scanned += len(rows)
            synth = [_synthetic_deal(r) for r in rows if r.get("id") is not None and r.get("stage_id") is not None]
            written += record_many(sb, synth, source="backfill")
            if len(rows) < size:
                break
            page += 1

        dur = round(time.time() - t0, 2)
        if actor:
            audit(self, actor, "crm.events_backfill", target_type="deal_stage_events", target_id="*",
                  notes=f"scanned={scanned} written={written} {dur}s")
        return self._send(200, {
            "ok": True,
            "deals_scanned": scanned,
            "events_written": written,
            "capture_real_since": capture_enabled_since(sb),
            "duration_s": dur,
            "ran_at": datetime.now(timezone.utc).isoformat(),
        })

    def do_GET(self):
        return self._run()

    def do_POST(self):
        return self._run()
