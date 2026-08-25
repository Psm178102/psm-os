"""
POST /api/v3/crm/rd_webhook?key=<CRON_SECRET>
Webhook do RD CRM — dispara NA HORA que um deal muda de etapa.
Se a etapa for CAPTAR IMÓVEL, cria a captação imediatamente (tempo real).

Configurar no RD: Webhook (ou automação) que faz POST nesta URL ao mover/atualizar
um deal. O payload do RD traz o deal; se vier sem a etapa, buscamos o deal ao vivo.

GET = healthcheck (sem ação).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
from _captar_lib import create_captacao_from_deal, is_captar_stage, _rd_get_deal  # type: ignore


def _authorized(headers, path):
    # Aceita RD_WEBHOOK_KEY (dedicada, fácil de colar na URL do RD) ou CRON_SECRET.
    secrets = [s for s in (os.environ.get("RD_WEBHOOK_KEY"), os.environ.get("CRON_SECRET")) if s]
    if not secrets:
        return True  # sem segredo configurado, não bloqueia (melhor que perder evento)
    try:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))
        if q.get("key") in secrets:
            return True
    except Exception:
        pass
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    tok = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    return tok in secrets


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
        return self._send(200, {"ok": True, "service": "rd_webhook", "hint": "POST aqui com o deal do RD"})

    def do_POST(self):
        if not _authorized(self.headers, self.path):
            return self._send(401, {"ok": False, "error": "não autorizado"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
        except Exception:
            body = {}

        # RD pode mandar o deal direto, ou aninhado. Cobre os formatos comuns.
        deal = body.get("deal") or body.get("lead") or body.get("data") or body
        if isinstance(deal, list):
            deal = deal[0] if deal else {}
        if not isinstance(deal, dict):
            deal = {}
        did = deal.get("id") or body.get("deal_id") or body.get("id")

        token = os.environ.get("RD_API_TOKEN")
        # Se o payload não trouxe a etapa, busca o deal ao vivo p/ ter o estado autoritativo
        if did and not (deal.get("deal_stage") or {}).get("name"):
            live = _rd_get_deal(did, token)
            if live:
                deal = live

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # ── Event sourcing: registra a etapa atual do deal (idempotente). ──
        # Acontece em TODA mudança de etapa (não só CAPTAR) → alimenta as
        # métricas REAIS de SLA / 1º contato / visita (deal_stage_events).
        evented = False
        try:
            from _events_lib import record_stage_event  # type: ignore
            evented = record_stage_event(sb, deal, source="webhook")
        except Exception as _e:
            evented = False

        # ── v86.78 (Produtividade Real, peças 3 e 4): os CAMPOS PERSONALIZADOS que o
        # Paulo criou no RD (status de visita/no-show; status de PASTA no funil Conquista)
        # e o MOTIVO DE PERDA viram eventos quando o valor muda — diff contra o rd_raw
        # guardado em `deals`. Depois atualizamos o deal guardado pra o próximo diff ser
        # incremental (o sync 3×/dia continua como rede de segurança do resto).
        campos = []
        try:
            prod_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "producao")
            if prod_dir not in sys.path:
                sys.path.insert(0, prod_dir)
            from _prod_lib import record_field_events, record_loss_reason  # type: ignore
            prev_raw = None
            if did:
                try:
                    rows = sb.table("deals").select("rd_raw").eq("id", str(did)).limit(1).execute().data or []
                    prev_raw = rows[0].get("rd_raw") if rows else None
                    if isinstance(prev_raw, str):
                        prev_raw = json.loads(prev_raw)
                except Exception:
                    prev_raw = None
            campos = record_field_events(sb, deal, prev_raw)
            if record_loss_reason(sb, deal, prev_raw):
                campos.append("perda_motivo")
            # refresh do espelho (só colunas seguras; user_id fica como está)
            if did and (deal.get("deal_stage") or deal.get("deal_custom_fields") or deal.get("custom_fields")):
                stage = deal.get("deal_stage") or {}
                upd = {"id": str(did), "rd_raw": deal, "win": deal.get("win")}
                if isinstance(stage, dict) and stage.get("id") is not None:
                    upd["stage_id"] = stage.get("id")
                    upd["stage_name"] = stage.get("name")
                if deal.get("updated_at"):
                    upd["updated_at_rd"] = deal.get("updated_at")
                try:
                    sb.table("deals").upsert(upd, on_conflict="id").execute()
                except Exception as _e2:
                    print(f"[webhook] refresh deal falhou: {_e2}")
        except Exception as _e:
            print(f"[webhook] campos personalizados falhou: {_e}")

        # ── Etapa CAPTAR IMÓVEL → cria captação na hora (comportamento original) ──
        if not is_captar_stage(deal):
            return self._send(200, {"ok": True, "evented": evented,
                                    "campos": campos, "skipped": "deal fora da etapa CAPTAR IMÓVEL"})

        cid = create_captacao_from_deal(sb, deal)
        return self._send(200, {"ok": True, "captacao_id": cid, "evented": evented, "campos": campos, "instant": True})
