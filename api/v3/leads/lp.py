# -*- coding: utf-8 -*-
"""
/api/v3/leads/lp — módulo Leads LP (aba #/leads-lp). v84.86

GET  ?dias=7&status=&faixa=&camp=&nutricao=1   → leads + KPIs do dia
     &paridade=1 (lvl>=7)                      → painel de paridade RD × House
     &config=1  (lvl>=7)                       → config + mini-lista de users p/ roteio
POST {action:"atender", id}                    → 1-clique ✋: ts_primeira_resposta + quem
     {action:"status", id, status}             → muda status (novo|em_atendimento|agendado|descartado|nutricao)
     {action:"config", config:{...}}  (lvl>=10, audit before/after)
     {action:"reconciliar"}           (lvl>=7) → roda a reconciliação agora
Speed-to-lead: tempo de 1ª resposta espelhado em producao_eventos (fiscalização).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, lvl_of  # type: ignore
from _lp_lib import (get_cfg, kv_set, KV_CFG, STATUS_VALIDOS, faixa_label,  # type: ignore
                     reconciliar, paridade_janela, horario_comercial, BRT)


def _kpis_hoje(rows_hoje, cfg):
    """KPIs do dia sobre leads NÃO-nutrição."""
    quentes = [r for r in rows_hoje if not r.get("nutricao")]
    sla_s = (cfg.get("sla_min") or 5) * 60
    resp = []
    dentro = 0
    sem_resp = 0
    now = datetime.now(timezone.utc)
    for r in quentes:
        t0, t1 = r.get("ts_recebido"), r.get("ts_primeira_resposta")
        if t1:
            try:
                dt = (datetime.fromisoformat(str(t1).replace("Z", "+00:00"))
                      - datetime.fromisoformat(str(t0).replace("Z", "+00:00"))).total_seconds()
                resp.append(max(0, dt))
                if dt <= sla_s:
                    dentro += 1
            except Exception:
                pass
        elif r.get("status_atendimento") == "novo":
            sem_resp += 1
    return {
        "hoje": len(quentes),
        "nutricao_hoje": len(rows_hoje) - len(quentes),
        "medio_resp_min": round(sum(resp) / len(resp) / 60, 1) if resp else None,
        "pct_sla": round(100.0 * dentro / len(resp), 1) if resp else None,
        "sem_resposta_agora": sem_resp,
        "sla_min": cfg.get("sla_min") or 5,
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    # ───────────────────────── GET ─────────────────────────
    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        lvl = user.get("lvl") or 0
        cfg = get_cfg(sb)

        dias = max(1, min(60, int(q.get("dias") or 7)))
        desde = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
        try:
            sel = sb.table("leads_lp").select(
                "id,lead_id,nome,whatsapp,email,faixa_renda,nutricao,origem,utms,"
                "pagina_ancora,ts_submit,ts_recebido,rd_deal_ref,status_atendimento,"
                "atendido_por,ts_primeira_resposta").gte("ts_recebido", desde)
            if q.get("status"):
                sel = sel.eq("status_atendimento", q["status"])
            if q.get("faixa"):
                sel = sel.eq("faixa_renda", q["faixa"].upper())
            rows = sel.order("ts_recebido", desc=True).limit(400).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        if q.get("camp"):
            alvo = q["camp"].lower()
            rows = [r for r in rows if alvo in str((r.get("utms") or {}).get("utm_campaign") or "").lower()]
        if q.get("nutricao") != "1":
            rows_lista = [r for r in rows if not r.get("nutricao")]
        else:
            rows_lista = [r for r in rows if r.get("nutricao")]

        hoje_ini = datetime.now(BRT).replace(hour=0, minute=0, second=0, microsecond=0) \
            .astimezone(timezone.utc).isoformat()
        rows_hoje = [r for r in rows if str(r.get("ts_recebido") or "") >= hoje_ini]

        # nomes dos atendentes (id → nome) pra lista
        nomes = {}
        try:
            for u in (sb.table("users").select("id,name").execute().data or []):
                nomes[u["id"]] = u.get("name")
        except Exception:
            pass
        for r in rows_lista:
            r["faixa_label"] = faixa_label(r.get("faixa_renda"))
            r["atendido_por_nome"] = nomes.get(r.get("atendido_por"))

        out = {
            "ok": True,
            "leads": rows_lista,
            "kpis": _kpis_hoje(rows_hoje, cfg),
            "comercial_agora": horario_comercial(cfg),
            "faixas": sorted({r.get("faixa_renda") for r in rows if r.get("faixa_renda")}),
            "campanhas": sorted({str((r.get("utms") or {}).get("utm_campaign") or "")
                                 for r in rows if (r.get("utms") or {}).get("utm_campaign")}),
            "total_janela": len(rows),
            "nutricao_janela": sum(1 for r in rows if r.get("nutricao")),
        }
        if q.get("paridade") == "1" and lvl >= 7:
            # janela madura (leads com +48h, que o sync RD 1×/dia já teve chance de trazer)
            out["paridade"] = {
                "madura_48h": paridade_janela(sb, 24 * dias, 48),
                "recente_48h": paridade_janela(sb, 48, 0),
                "nota": "casamento por telefone via sync RD (1×/dia): lead de hoje normalmente casa amanhã. "
                        "Detecção 'RD sem House' depende da origem marcada no RD — limitação declarada.",
            }
            # leads por campanha (base do custo por lead — cruzamento c/ Meta é fase 2)
            por_camp = {}
            for r in rows:
                c = str((r.get("utms") or {}).get("utm_campaign") or "(sem utm)")
                por_camp.setdefault(c, {"total": 0, "agendados": 0})
                por_camp[c]["total"] += 1
                if r.get("status_atendimento") == "agendado":
                    por_camp[c]["agendados"] += 1
            out["por_campanha"] = por_camp
        if q.get("config") == "1" and lvl >= 7:
            out["config"] = cfg
            try:
                out["users_mini"] = [{"id": u["id"], "name": u.get("name"), "role": u.get("role")}
                                     for u in (sb.table("users").select("id,name,role,status").execute().data or [])
                                     if (u.get("status") or "ativo") == "ativo" and lvl_of(u.get("role")) >= 2]
            except Exception:
                out["users_mini"] = []
        return self._send(200, out)

    # ───────────────────────── POST ─────────────────────────
    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = body.get("action")
        lvl = user.get("lvl") or 0
        now = datetime.now(timezone.utc)

        if action == "atender":
            lid = str(body.get("id") or "")
            try:
                rows = sb.table("leads_lp").select("*").eq("id", lid).limit(1).execute().data or []
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            if not rows:
                return self._send(404, {"ok": False, "error": "lead não encontrado"})
            ld = rows[0]
            antes = dict(ld)
            patch = {}
            hist = ld.get("historico") or []
            if not ld.get("ts_primeira_resposta"):
                patch["ts_primeira_resposta"] = now.isoformat()
                patch["atendido_por"] = str(user.get("id"))
            if ld.get("status_atendimento") == "novo":
                patch["status_atendimento"] = "em_atendimento"
            if not patch:
                return self._send(200, {"ok": True, "ja_atendido": True})
            hist.append({"ts": now.isoformat(), "ev": "atendido", "por": str(user.get("id"))})
            patch["historico"] = hist
            try:
                sb.table("leads_lp").update(patch).eq("id", lid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            # espelha na fiscalização (tempo em minutos até a 1ª resposta) — best-effort
            try:
                t0 = datetime.fromisoformat(str(ld.get("ts_recebido")).replace("Z", "+00:00"))
                mins = round((now - t0).total_seconds() / 60, 1)
                colab = (user.get("email") or "").split("@")[0] or str(user.get("id"))
                sb.table("producao_eventos").insert({
                    "colaborador": colab, "tipo": "lead_lp_atendido",
                    "ref_type": "lead_lp", "ref_id": lid, "valor": mins,
                    "meta": {"faixa": ld.get("faixa_renda"),
                             "campanha": (ld.get("utms") or {}).get("utm_campaign")},
                    "criado_por": str(user.get("id"))}).execute()
            except Exception:
                pass
            audit(self, user, "lead_lp.atender", target_type="leads_lp", target_id=lid,
                  before=antes, after={**antes, **patch})
            return self._send(200, {"ok": True, "primeira_resposta": patch.get("ts_primeira_resposta")})

        if action == "status":
            lid = str(body.get("id") or "")
            novo = str(body.get("status") or "")
            if novo not in STATUS_VALIDOS:
                return self._send(422, {"ok": False, "error": f"status inválido ({'/'.join(STATUS_VALIDOS)})"})
            try:
                rows = sb.table("leads_lp").select("id,status_atendimento,historico").eq("id", lid).limit(1).execute().data or []
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            if not rows:
                return self._send(404, {"ok": False, "error": "lead não encontrado"})
            antes = dict(rows[0])
            hist = rows[0].get("historico") or []
            hist.append({"ts": now.isoformat(), "ev": f"status:{novo}", "por": str(user.get("id"))})
            try:
                sb.table("leads_lp").update({"status_atendimento": novo, "historico": hist}).eq("id", lid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            audit(self, user, "lead_lp.status", target_type="leads_lp", target_id=lid,
                  before=antes, after={"status_atendimento": novo})
            return self._send(200, {"ok": True})

        if action == "config":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "config é do sócio (lvl>=10)"})
            novo = body.get("config")
            if not isinstance(novo, dict):
                return self._send(422, {"ok": False, "error": "config inválida"})
            antes = get_cfg(sb)
            cfg = dict(antes)
            for k in ("atendentes", "gestores", "sla_min", "alerta_min", "horario", "meta_paridade"):
                if k in novo:
                    cfg[k] = novo[k]
            cfg["sla_min"] = max(1, min(60, int(cfg.get("sla_min") or 5)))
            cfg["alerta_min"] = max(cfg["sla_min"], min(120, int(cfg.get("alerta_min") or 15)))
            if not kv_set(sb, KV_CFG, cfg):
                return self._send(500, {"ok": False, "error": "falha ao gravar config"})
            audit(self, user, "lead_lp.config", target_type="shared_kv", target_id=KV_CFG,
                  before=antes, after=cfg)
            return self._send(200, {"ok": True, "config": cfg})

        if action == "reconciliar":
            if lvl < 7:
                return self._send(403, {"ok": False, "error": "reconciliação é da gestão (lvl>=7)"})
            r = reconciliar(sb)
            audit(self, user, "lead_lp.reconciliar", target_type="leads_lp", notes=json.dumps(r)[:200])
            return self._send(200, {"ok": True, "resultado": r})

        return self._send(400, {"ok": False, "error": "action inválida"})
