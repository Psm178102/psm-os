# -*- coding: utf-8 -*-
"""
POST /api/v3/leads/lp_webhook — receptor de leads da landing psmconquista.com.br. v84.86

TESTE DE CRM: a LP manda cada lead em DUPLO DESTINO (RD Station + aqui). Este
receptor é a metade House; a paridade dos dois lados decide a migração futura.

Auth:  header  Authorization: Bearer <HOUSE_WEBHOOK_SECRET>   (env no Vercel)
       — secret NUNCA na URL (URL vaza em log). Sem env configurada → 503.
Contrato (payload canônico, a LP envia exatamente isto):
  { lead_id (uuid, idempotência), nome, whatsapp, email?, faixa_renda ("F2_3500_4000"…),
    origem, utm_source/medium/campaign/content/term, pagina_ancora, ts_submit ISO,
    consent_lgpd: true }
Respostas: 200 {ok:true} · 200 {ok:true,duplicate:true} (retry) · 401 · 422 {motivo}
           · 429 rate-limit (120/h por IP) · 503 sem secret no ambiente
GET = healthcheck (a LP valida a integração por aqui).
Toda tentativa (ok/falha) fica em lp_webhook_log — é o recibo de entrega da LP.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, notify, send_web_push, lvl_of  # type: ignore
from _lp_lib import (norm_phone, faixa_label, get_cfg, atendentes_ids,  # type: ignore
                     broadcast_change, FAIXA_NUTRICAO)

UTM_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term")
RE_LEAD_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
RE_FAIXA = re.compile(r"^[A-Z0-9_]{2,40}$")


def _ip(handler):
    return ((handler.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            or handler.headers.get("X-Real-IP") or "?")


def _log(sb, ok, status, motivo, lead_id, ip):
    try:
        sb.table("lp_webhook_log").insert({
            "ok": ok, "status": status, "motivo": (motivo or "")[:200] or None,
            "lead_id": (lead_id or "")[:64] or None, "ip": ip[:60]}).execute()
    except Exception:
        pass


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        return self._send(200, {"ok": True, "service": "lp_webhook",
                                "configured": bool(os.environ.get("HOUSE_WEBHOOK_SECRET"))})

    def do_POST(self):
        secret = (os.environ.get("HOUSE_WEBHOOK_SECRET") or "").strip()
        if not secret:
            return self._send(503, {"ok": False, "error": "HOUSE_WEBHOOK_SECRET não configurado no servidor"})
        auth = self.headers.get("Authorization") or ""
        tok = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        ip = _ip(self)
        if tok != secret:
            _log(sb, False, 401, "secret inválido", None, ip)
            return self._send(401, {"ok": False, "error": "não autorizado"})

        # rate-limit 120/h por IP (contado no log — serverless-safe)
        try:
            uma_h = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
            n = len(sb.table("lp_webhook_log").select("id").eq("ip", ip[:60])
                    .gte("ts", uma_h).limit(121).execute().data or [])
            if n >= 120:
                _log(sb, False, 429, "rate-limit", None, ip)
                return self._send(429, {"ok": False, "error": "rate-limit: máx 120/h por IP"})
        except Exception:
            pass

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
            assert isinstance(body, dict)
        except Exception:
            _log(sb, False, 422, "JSON inválido", None, ip)
            return self._send(422, {"ok": False, "motivo": "JSON inválido"})

        # ── validação do contrato (422 com motivo legível) ──
        lead_id = str(body.get("lead_id") or "").strip()
        nome = str(body.get("nome") or "").strip()[:160]
        faixa = str(body.get("faixa_renda") or "").strip().upper()
        whatsapp = norm_phone(body.get("whatsapp"))
        motivo = None
        if not RE_LEAD_ID.match(lead_id):
            motivo = "lead_id ausente ou fora do padrão (8-64 chars [A-Za-z0-9_-])"
        elif not nome:
            motivo = "nome ausente"
        elif not whatsapp:
            motivo = "whatsapp ausente ou inválido (mínimo DDD+número)"
        elif not RE_FAIXA.match(faixa):
            motivo = "faixa_renda ausente ou fora do padrão (ex: F2_3500_4000)"
        elif body.get("consent_lgpd") is not True:
            motivo = "consent_lgpd precisa ser true (LGPD)"
        if motivo:
            _log(sb, False, 422, motivo, lead_id or None, ip)
            return self._send(422, {"ok": False, "motivo": motivo})

        # ── idempotência: retry com o mesmo lead_id NUNCA duplica ──
        try:
            ja = sb.table("leads_lp").select("id").eq("lead_id", lead_id).limit(1).execute().data or []
        except Exception:
            ja = []
        if ja:
            _log(sb, True, 200, "duplicate", lead_id, ip)
            return self._send(200, {"ok": True, "duplicate": True})

        nutricao = (faixa == FAIXA_NUTRICAO)
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "lead_id": lead_id,
            "nome": nome,
            "whatsapp": whatsapp,
            "email": (str(body.get("email") or "").strip()[:160] or None),
            "faixa_renda": faixa,
            "nutricao": nutricao,
            "origem": (str(body.get("origem") or "lp_psmconquista").strip()[:60]),
            "utms": {k: str(body.get(k) or "")[:180] for k in UTM_KEYS if body.get(k)},
            "pagina_ancora": (str(body.get("pagina_ancora") or "").strip()[:250] or None),
            "ts_submit": body.get("ts_submit") or None,
            "status_atendimento": "nutricao" if nutricao else "novo",
            "historico": [{"ts": now, "ev": "recebido_lp"}],
        }
        try:
            sb.table("leads_lp").insert(row).execute()
        except Exception as e:
            msg = str(e)
            if "23505" in msg or "duplicate" in msg.lower():   # corrida de retry
                _log(sb, True, 200, "duplicate(race)", lead_id, ip)
                return self._send(200, {"ok": True, "duplicate": True})
            _log(sb, False, 500, f"insert: {msg[:120]}", lead_id, ip)
            return self._send(500, {"ok": False, "error": "falha ao gravar"})

        _log(sb, True, 200, "nutricao" if nutricao else "ok", lead_id, ip)

        # ── nutrição NÃO dispara atendimento; lead quente notifica na hora ──
        if not nutricao:
            try:
                cfg = get_cfg(sb)
                ids = atendentes_ids(sb, cfg, lvl_of)
                camp = row["utms"].get("utm_campaign") or row["origem"]
                titulo = f"📥 Lead LP: {nome} — {faixa_label(faixa)}"
                corpo = f"WhatsApp wa.me/{whatsapp} · {camp} · responda em até {cfg.get('sla_min', 5)}min"
                notify(ids, "lead_lp", titulo, corpo, link="#/leads-lp",
                       target_type="lead_lp", target_id=lead_id)
                send_web_push(ids, titulo, corpo, link="#/leads-lp", tag="lead_lp")
            except Exception:
                pass
        broadcast_change()   # acorda as telas abertas (<1s); fallback = pulso
        return self._send(200, {"ok": True})
