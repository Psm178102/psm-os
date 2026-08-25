"""
GET/POST /api/v3/producao/sla_cron — Peça 2 da Produtividade Real (v86.78).

Roda a cada 10 min em horário comercial (vercel.json). Lead NOVO (deal criado nas
últimas 24h, em aberto) sem PRIMEIRO CONTATO há mais de 15 min em horário comercial
→ notifica os gestores (sino + push), 1 alerta por lead (dedupe em shared_kv).

Primeiro contato = toque humano registrado (producao_eventos toque_*) OU segunda
observação de etapa no espelho (deal_stage_events) — ver _prod_lib.first_touch_map.
Auth: Bearer CRON_SECRET (padrão dos crons) ou usuário lvl>=7 (teste manual).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify_all  # type: ignore
from _fisc_lib import gestores_ids  # type: ignore
from _prod_lib import first_touch_map, em_horario_comercial, KV_SLA_ALERTAS, BRT  # type: ignore

SLA_ALERTA_MIN = 15   # minutos até alertar o gestor (o alvo do time é 5)


def _authorized(handler):
    sec = os.environ.get("CRON_SECRET")
    auth = handler.headers.get("Authorization") or ""
    if sec and auth.lower().startswith("bearer ") and auth[7:].strip() == sec:
        return True
    try:
        require_user(handler, min_lvl=7)
        return True
    except AuthError:
        return False


def _run(sb):
    now = datetime.now(timezone.utc)
    if not em_horario_comercial(now):
        return {"ok": True, "skipped": "fora do horário comercial"}
    desde = (now - timedelta(hours=24)).isoformat()
    try:
        deals = (sb.table("deals")
                 .select("id,name,user_email,created_at_rd,pipeline_name")
                 .gte("created_at_rd", desde).is_("win", "null")
                 .order("created_at_rd", desc=True).limit(400).execute().data or [])
    except Exception as e:
        return {"ok": False, "error": f"deals: {e}"}
    if not deals:
        return {"ok": True, "leads_novos": 0, "alertas": 0}

    touched = first_touch_map(sb, [d["id"] for d in deals])
    # dedupe de alerta por lead
    ja = {}
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_SLA_ALERTAS).limit(1).execute().data or []
        ja = rows[0]["value"] if rows else {}
        if isinstance(ja, str):
            ja = json.loads(ja)
        if not isinstance(ja, dict):
            ja = {}
    except Exception:
        ja = {}

    atrasados = []
    for d in deals:
        did = str(d["id"])
        if did in touched or did in ja:
            continue
        try:
            criado = datetime.fromisoformat(str(d["created_at_rd"]).replace("Z", "+00:00"))
        except Exception:
            continue
        if not em_horario_comercial(criado) and not em_horario_comercial(now):
            continue
        if (now - criado).total_seconds() >= SLA_ALERTA_MIN * 60:
            atrasados.append(d)

    n = 0
    if atrasados:
        gids = gestores_ids(sb)
        for d in atrasados[:10]:  # no máx 10 alertas por rodada (anti-tempestade)
            did = str(d["id"])
            mins = int((now - datetime.fromisoformat(str(d["created_at_rd"]).replace("Z", "+00:00"))).total_seconds() // 60)
            try:
                notify_all(gids, "sla_lead",
                           f"⏱ Lead sem 1º contato há {mins} min",
                           body=f"{(d.get('name') or 'Lead')[:60]} · {d.get('pipeline_name') or ''} · dono: {d.get('user_email') or 'sem dono'}",
                           link=f"https://crm.rdstation.com/deals/{did}")
                ja[did] = now.isoformat()
                n += 1
            except Exception as e:
                print(f"[sla] notify falhou: {e}")
        # poda o dedupe (mantém só 48h)
        corte = (now - timedelta(hours=48)).isoformat()
        ja = {k: v for k, v in ja.items() if str(v) >= corte}
        try:
            sb.table("shared_kv").upsert({"key": KV_SLA_ALERTAS, "value": ja,
                                          "updated_at": now.isoformat()}, on_conflict="key").execute()
        except Exception:
            pass
    return {"ok": True, "leads_novos": len(deals), "sem_contato": len(atrasados), "alertas": n}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        if not _authorized(self):
            return self._send(401, {"ok": False, "error": "não autorizado"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, _run(sb))

    do_POST = do_GET
