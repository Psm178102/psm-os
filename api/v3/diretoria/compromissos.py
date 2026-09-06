# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/diretoria/compromissos — 📋 caderninho de cobrança do CEO (Onda 1 · v87.43)

Compromissos assumidos nos planos (Plano Estratégico set/2026 etc.) viram itens
cobráveis: o Agente CEO cita os atrasados na leitura diária e no Estado da União.

Fonte: shared_kv "ceo_compromissos"
  {items:[{id, o_que, dono, prazo (YYYY-MM-DD|null), origem,
           status:'aberto'|'feito'|'atrasado'|'cancelado', criado_em, atualizado_em}]}

GET  (lvl>=10) → { ok, items } — atrasados/abertos primeiro, por prazo
POST (lvl>=10) → {id, status:'feito'|'cancelado'|'aberto'} — sócio marca no ato.
                 'atrasado' quem marca é o CRON do CEO (ceo_cron), não o sócio.
Seed inicial: SEED-ceo-compromissos.sql (idempotente, on conflict do nothing).
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "ceo_compromissos"
STATUS_SOCIO = ("feito", "cancelado", "aberto")
ORDEM = {"atrasado": 0, "aberto": 1, "feito": 2, "cancelado": 3}


def _load(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
    v = rows[0]["value"] if rows else None
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = None
    items = (v or {}).get("items") if isinstance(v, dict) else None
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []


def _save(sb, items):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"items": items},
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


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
        # 🔒 caderninho da Diretoria = SÓ sócio. O gate real é AQUI no server.
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            items = _load(sb)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        items.sort(key=lambda i: (ORDEM.get(str(i.get("status")), 9),
                                  str(i.get("prazo") or "9999-12-31")))
        return self._send(200, {"ok": True, "items": items})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0)
            body = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        cid = str(body.get("id") or "").strip()
        status = str(body.get("status") or "").strip()
        if not cid or status not in STATUS_SOCIO:
            return self._send(400, {"ok": False, "error": f"informe id e status ∈ {STATUS_SOCIO}"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            items = _load(sb)
            alvo = next((i for i in items if str(i.get("id")) == cid), None)
            if not alvo:
                return self._send(404, {"ok": False, "error": f"compromisso '{cid}' não existe"})
            alvo["status"] = status
            alvo["atualizado_em"] = datetime.now(timezone.utc).isoformat()
            _save(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        audit(self, user, "ceo.compromisso_" + status, target_type="ceo_compromissos", target_id=cid)
        return self._send(200, {"ok": True, "item": alvo})
