"""
GET /api/v3/system_health
Header: Authorization: Bearer <token>   (qualquer usuário logado)

Saúde operacional do sistema pro indicador no menu principal. Cada falha,
desatualização ou erro vira um item acionável em `issues[]` com severidade.
Checa: banco (Supabase), sincronização RD, cache Meta, captura de eventos,
tokens de integração. Nunca levanta — transforma exceção em aviso.

Resp: { ok, status: 'ok'|'warn'|'error', issues:[{area,severity,message}], checks, ts }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


def _age_h(iso):
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - d).total_seconds() / 3600.0
    except Exception:
        return None


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        issues = []
        checks = {}

        def add(area, severity, message):
            issues.append({"area": area, "severity": severity, "message": message})

        sb = supabase_client()
        if not sb:
            add("banco", "error", "Banco de dados indisponível (Supabase não configurado).")
            return self._send(200, {"ok": False, "status": "error", "issues": issues,
                                    "checks": checks, "ts": datetime.now(timezone.utc).isoformat()})

        # 1) Banco acessível
        try:
            sb.table("users").select("id").limit(1).execute()
            checks["db"] = True
        except Exception as e:
            checks["db"] = False
            add("banco", "error", f"Falha ao consultar o banco: {e}")

        # 2) Sincronização RD (cron 3×/dia → atraso > 18h é problema)
        if not os.environ.get("RD_API_TOKEN"):
            add("crm", "warn", "RD_API_TOKEN ausente — CRM não sincroniza.")
        try:
            rows = (sb.table("deals").select("updated_at_rd")
                    .order("updated_at_rd", desc=True).limit(1).execute().data or [])
            if not rows:
                add("crm", "warn", "Nenhum deal sincronizado do RD ainda.")
            else:
                age = _age_h(rows[0].get("updated_at_rd"))
                checks["rd_sync_age_h"] = round(age, 1) if age is not None else None
                if age is not None and age > 24:
                    add("crm", "error", f"Sincronização RD parada há {age:.0f}h (cron deveria rodar 3×/dia).")
                elif age is not None and age > 18:
                    add("crm", "warn", f"Sincronização RD atrasada (~{age:.0f}h).")
        except Exception as e:
            add("crm", "warn", f"Tabela deals inacessível: {e}")

        # 3) Cache Meta (cron a cada 10min → > 40min é desatualização)
        try:
            rows = (sb.table("meta_ads_cache").select("refreshed_at")
                    .order("refreshed_at", desc=True).limit(1).execute().data or [])
            if not rows:
                add("meta", "warn", "Cache Meta vazio — rode o SQL sprint9_12 e aguarde o cron.")
            else:
                age = _age_h(rows[0].get("refreshed_at"))
                checks["meta_cache_age_min"] = round(age * 60, 0) if age is not None else None
                if age is not None and age > 0.67:  # 40min
                    add("meta", "warn", f"Cache Meta desatualizado (~{age*60:.0f}min) — cron de 10min pode estar falhando.")
        except Exception as e:
            add("meta", "warn", f"Tabela meta_ads_cache ausente — rode supabase/sprint9_12_meta_ads_cache.sql ({e}).")

        # 4) Captura de eventos (SLA real depende disso)
        try:
            rows = (sb.table("deal_stage_events").select("id")
                    .neq("source", "backfill").limit(1).execute().data or [])
            checks["event_capture"] = bool(rows)
            if not rows:
                add("captura", "warn", "Captura de eventos ainda não iniciou — métricas de SLA/contato seguem como estimativa.")
        except Exception as e:
            add("captura", "warn", f"Tabela deal_stage_events ausente — rode supabase/sprint9_10_deal_stage_events.sql ({e}).")

        # 5) NIBO (financeiro)
        if not os.environ.get("NIBO_API_TOKEN"):
            add("financeiro", "warn", "NIBO_API_TOKEN ausente — Financeiro ao vivo indisponível.")

        sev = {i["severity"] for i in issues}
        status = "error" if "error" in sev else ("warn" if "warn" in sev else "ok")
        return self._send(200, {
            "ok": status != "error",
            "status": status,
            "issues": issues,
            "checks": checks,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
