"""
GET/POST /api/v3/producao/sla_cron — Peça 2 da Produtividade Real (v86.78).

Roda a cada 10 min em horário comercial (vercel.json). Lead NOVO (deal criado nas
últimas 24h, em aberto) sem PRIMEIRO CONTATO há mais de 15 min em horário comercial
→ entra na fila do RESUMO; 1x por hora os gestores recebem 1 aviso só com os que
seguem sem contato (v88.56 — antes era 1 aviso por lead: ~1.5k/mês, 459 não lidos).

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
RESUMO_MIN = 55      # intervalo mínimo entre resumos (cron roda a cada 10 min)
KV_SLA_RESUMO = "sla_lead_resumo"


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

    def _le_kv(chave):
        rows = sb.table("shared_kv").select("value").eq("key", chave).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else {}

    # dedupe por lead + fila do resumo. Leitura que falha ABORTA (não reenvia tudo).
    try:
        ja = _le_kv(KV_SLA_ALERTAS)
        resumo = _le_kv(KV_SLA_RESUMO)
    except Exception as e:
        return {"ok": False, "error": f"shared_kv: {e}"}
    fila = resumo.get("fila") if isinstance(resumo.get("fila"), list) else []

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

    for d in atrasados:
        did = str(d["id"])
        ja[did] = now.isoformat()
        fila.append({"id": did, "nome": (d.get("name") or "Lead")[:60],
                     "funil": d.get("pipeline_name") or "", "dono": d.get("user_email") or "",
                     "criado": d.get("created_at_rd")})

    n = 0
    ultimo = resumo.get("ultimo")
    try:
        desde_ultimo = (now - datetime.fromisoformat(str(ultimo).replace("Z", "+00:00"))).total_seconds() / 60 if ultimo else 1e9
    except Exception:
        desde_ultimo = 1e9
    if fila and desde_ultimo >= RESUMO_MIN:
        # só entra no aviso quem AINDA está sem contato na hora do resumo
        ainda = first_touch_map(sb, [x["id"] for x in fila])
        pend = [x for x in fila if x["id"] not in ainda]
        if pend:
            def _mins(x):
                try:
                    return int((now - datetime.fromisoformat(str(x["criado"]).replace("Z", "+00:00"))).total_seconds() // 60)
                except Exception:
                    return 0
            pend.sort(key=_mins, reverse=True)
            linhas = [f"{x['nome'].split(' ')[0]} ({_mins(x)}min, {(x['dono'] or 'sem dono').split('@')[0]})" for x in pend[:6]]
            if len(pend) > 6:
                linhas.append(f"+ {len(pend) - 6} outro(s)")
            try:
                notify_all(gestores_ids(sb), "sla_lead",
                           f"⏱ {len(pend)} lead(s) sem 1º contato há 15+ min",
                           body=" · ".join(linhas),
                           link="#/produtividade-real")
                n = 1
            except Exception as e:
                print(f"[sla] notify falhou: {e}")
                pend = None  # mantém a fila pra tentar no próximo ciclo
        if pend is not None:
            fila = []
            ultimo = now.isoformat()

    # poda o dedupe (mantém só 48h) e grava dedupe + fila
    corte = (now - timedelta(hours=48)).isoformat()
    ja = {k: v for k, v in ja.items() if str(v) >= corte}
    try:
        sb.table("shared_kv").upsert([
            {"key": KV_SLA_ALERTAS, "value": ja, "updated_at": now.isoformat()},
            {"key": KV_SLA_RESUMO, "value": {"fila": fila[-200:], "ultimo": ultimo}, "updated_at": now.isoformat()},
        ], on_conflict="key").execute()
    except Exception:
        pass
    return {"ok": True, "leads_novos": len(deals), "sem_contato": len(atrasados), "na_fila": len(fila), "resumos": n}


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
