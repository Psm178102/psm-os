# -*- coding: utf-8 -*-
"""
GET /api/v3/leads/lp_recon — cron do módulo Leads LP. v84.86
Roda via heartbeat (~30min) + cron Vercel (belt & suspenders). Idempotente.

  ?job=recon  → casa leads_lp × deals RD (telefone, janela 72h)
  ?job=sla    → 🔴 lead quente sem 1ª resposta > alerta_min (horário comercial) → gestores
  ?job=all    → (default) recon + sla + saúde do webhook + paridade do dia

Alertas por alçada (nunca broadcast):
  🔴 SLA estourado           → gestores  (dedupe: notifications tipo=sla_lp)
  🟡 >3 falhas webhook / 1h  → diretoria (dedupe: 1×/hora via shared_kv)
  🟡 paridade madura <95%    → diretoria (dedupe: 1×/dia; só leads +48h,
                                que o sync RD 1×/dia já teve chance de casar)
Auth: Bearer CRON_SECRET ou lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify, send_web_push, lvl_of  # type: ignore
from _lp_lib import (get_cfg, kv_get, kv_set, KV_STATE, reconciliar, paridade_janela,  # type: ignore
                     gestores_ids, horario_comercial, faixa_label, BRT)


def _sla(sb, cfg, now):
    if not horario_comercial(cfg):
        return {"skip": "fora do horário comercial"}
    lim = cfg.get("alerta_min") or 15
    try:
        rows = (sb.table("leads_lp").select("id,nome,whatsapp,faixa_renda,ts_recebido")
                .eq("status_atendimento", "novo").eq("nutricao", False)
                .is_("ts_primeira_resposta", "null")
                .gte("ts_recebido", (now - timedelta(hours=24)).isoformat())
                .lte("ts_recebido", (now - timedelta(minutes=lim)).isoformat())
                .limit(50).execute().data or [])
    except Exception as e:
        return {"error": str(e)[:120]}
    if not rows:
        return {"alarmados": 0}
    ids = [r["id"] for r in rows]
    ja = set()
    try:
        for n in (sb.table("notifications").select("target_id").eq("tipo", "sla_lp")
                  .in_("target_id", ids).execute().data or []):
            ja.add(n.get("target_id"))
    except Exception:
        pass
    gids = gestores_ids(sb, cfg, lvl_of)
    alarmados = 0
    for r in rows:
        if r["id"] in ja or not gids:
            continue
        try:
            mins = int((now - datetime.fromisoformat(str(r["ts_recebido"]).replace("Z", "+00:00"))).total_seconds() / 60)
        except Exception:
            mins = lim
        titulo = f"🔴 Lead LP sem resposta há {mins}min: {(r.get('nome') or '?')[:50]}"
        corpo = f"{faixa_label(r.get('faixa_renda'))} · wa.me/{r.get('whatsapp')} — cobre o atendimento AGORA"
        notify(gids, "sla_lp", titulo, corpo, link="#/leads-lp", target_type="lead_lp", target_id=r["id"])
        send_web_push(gids, titulo, corpo, link="#/leads-lp", tag="sla_lp")
        alarmados += 1
    return {"pendentes": len(rows), "alarmados": alarmados}


def _diretoria_ids(sb):
    try:
        return [u["id"] for u in (sb.table("users").select("id,role,status").execute().data or [])
                if (u.get("status") or "ativo") == "ativo" and lvl_of(u.get("role")) >= 10]
    except Exception:
        return []


def _saude_webhook(sb, state, now):
    try:
        falhas = (sb.table("lp_webhook_log").select("id,motivo").eq("ok", False)
                  .gte("ts", (now - timedelta(hours=1)).isoformat()).limit(30).execute().data or [])
    except Exception as e:
        return {"error": str(e)[:120]}
    if len(falhas) <= 3:
        return {"falhas_1h": len(falhas)}
    marca = now.strftime("%Y-%m-%d-%H")
    if state.get("webhook_alerta_h") == marca:
        return {"falhas_1h": len(falhas), "ja_avisado": True}
    ids = _diretoria_ids(sb)
    motivos = ", ".join(sorted({str(f.get("motivo") or "?")[:40] for f in falhas})[:4])
    notify(ids, "lp_saude", f"🟡 Webhook da LP: {len(falhas)} falhas na última hora",
           f"Motivos: {motivos}. A landing pode estar quebrada — confira lp_webhook_log.",
           link="#/leads-lp")
    state["webhook_alerta_h"] = marca
    return {"falhas_1h": len(falhas), "avisado": True}


def _paridade_dia(sb, cfg, state, now):
    marca = now.astimezone(BRT).strftime("%Y-%m-%d")
    if state.get("paridade_alerta_d") == marca:
        return {"ja_checado_hoje": True}
    # só a janela MADURA (48h→72h): o sync RD 1×/dia já passou por ela
    p = paridade_janela(sb, 72, 48)
    if (p.get("total") or 0) < 5 or p.get("pct") is None:
        return {"amostra_insuficiente": p.get("total", 0)}
    meta = min(99, cfg.get("meta_paridade") or 99)
    if p["pct"] >= 95:
        state["paridade_alerta_d"] = marca
        return {"pct": p["pct"], "ok": True}
    ids = _diretoria_ids(sb)
    notify(ids, "lp_paridade", f"🟡 Paridade LP×RD em {p['pct']}% (meta {meta}%)",
           f"{p['casados']}/{p['total']} leads da janela madura casaram com o RD. "
           "Lead no House sem RD = envio da LP pro RD falhando.",
           link="#/leads-lp")
    state["paridade_alerta_d"] = marca
    return {"pct": p["pct"], "avisado": True}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):
            try:
                require_user(self, min_lvl=7)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        job = q.get("job") or "all"
        cfg = get_cfg(sb)
        now = datetime.now(timezone.utc)
        out = {"ok": True, "job": job}

        if job in ("recon", "all"):
            out["recon"] = reconciliar(sb)
        if job in ("sla", "all"):
            out["sla"] = _sla(sb, cfg, now)
        if job == "all":
            state = kv_get(sb, KV_STATE, {}) or {}
            out["webhook"] = _saude_webhook(sb, state, now)
            out["paridade"] = _paridade_dia(sb, cfg, state, now)
            kv_set(sb, KV_STATE, state)
        return self._send(200, out)
