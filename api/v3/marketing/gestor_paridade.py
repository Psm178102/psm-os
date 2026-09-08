"""
GET /api/v3/marketing/gestor_paridade            → { ok, estado } (lvl>=5)
GET /api/v3/marketing/gestor_paridade?cron=1     → avalia e alerta (CRON_SECRET ou lvl>=7)

🔔 ALERTA DE PARIDADE META×RD (v87.53 — pedido do Paulo 08/09/2026, após o
vazamento de set: integração RD Lead Ads caiu, 59 leads no Meta e só ~15 no RD,
4 dias no escuro). Compara os leads que o Meta reporta HOJE (cache last_7d,
dailySeries, 3 contas) com as negociações NOVAS que entraram no RD hoje com
fonte de mídia paga (deal_source contendo Ads/Facebook/Busca Paga). Se o RD
recebeu MENOS que o piso (default 70%), push imediato nos sócios.

Guardas anti-falso-positivo: só avalia após as 12h BRT (de manhã a amostra é
pequena) e com pelo menos 5 leads no Meta no dia. Dedupe: 1 alerta por dia.
Estado em shared_kv gt_paridade. Limiar editável em gt_alertas.limiares
(paridade_min_pct). Roda pelo heartbeat (~30min).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, supabase_client,  # type: ignore
                       lvl_of, notify, send_web_push, agora_brt)
from _meta_cache_lib import build_cache_key, read_cache  # type: ignore
from gestor import kv_get, kv_set  # type: ignore

KV = "gt_paridade"
FONTES_PAGA = ("ads", "facebook", "busca paga")


def _avaliar(sb):
    agora = agora_brt()
    hoje = agora.date().isoformat()
    estado = kv_get(sb, KV, {}) or {}

    # 1) leads do Meta hoje (série diária agregada das contas)
    payload, _age, _src = read_cache(sb, build_cache_key("last_7d", "", ""), 10 ** 9)
    meta_hoje = None
    for d in (payload or {}).get("dailySeries") or []:
        if str(d.get("date") or d.get("date_start") or "")[:10] == hoje:
            meta_hoje = int(d.get("results") or 0)
    if meta_hoje is None:
        estado.update({"ts": agora.isoformat(), "obs": "sem série diária do dia no cache"})
        kv_set(sb, KV, estado)
        return {"ok": True, "avaliado": False, "motivo": "cache sem o dia de hoje"}

    # 2) negociações novas de HOJE no RD com fonte de mídia paga
    rows = (sb.table("deals").select("rd_raw")
            .gte("created_at_rd", hoje).limit(1000).execute().data or [])
    rd_hoje = 0
    for d in rows:
        raw = d.get("rd_raw") or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}
        fonte = str(((raw.get("deal_source") or {}).get("name")) or "").lower()
        if any(f in fonte for f in FONTES_PAGA):
            rd_hoje += 1

    pct = round(rd_hoje / meta_hoje * 100, 1) if meta_hoje else None
    limiares = (kv_get(sb, "gt_alertas", {}) or {}).get("limiares") or {}
    piso = float(limiares.get("paridade_min_pct") or 70)

    estado.update({"ts": agora.isoformat(), "dia": hoje, "meta_leads": meta_hoje,
                   "rd_leads": rd_hoje, "pct": pct, "piso_pct": piso, "obs": None})

    # guardas: amostra mínima + hora do dia + dedupe diário
    alertar = (meta_hoje >= 5 and pct is not None and pct < piso
               and agora.hour >= 12 and estado.get("ultimo_alerta_dia") != hoje)

    if alertar:
        estado["ultimo_alerta_dia"] = hoje
        titulo = f"🚨 Leads do Meta não estão chegando no RD ({pct:.0f}%)"
        body = (f"Hoje o Meta reporta {meta_hoje} leads e só {rd_hoje} entraram no RD "
                f"com fonte de mídia paga (piso {piso:.0f}%). Cheque a integração "
                "Meta Lead Ads do RD e recupere os leads pelo formulário (ficam 90 dias no Meta).")
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us
                      if (u.get("status") or "ativo") == "ativo"
                      and lvl_of((u.get("role") or "").lower()) >= 10]
            if socios:
                notify(socios, "gt_paridade", titulo, body=body,
                       link="#/gestor-trafego")
                send_web_push(socios, titulo, body=body, link="#/gestor-trafego",
                              tag="gt_paridade")
        except Exception:
            pass

    kv_set(sb, KV, estado)
    return {"ok": True, "avaliado": True, "alertou": bool(alertar), **{
        k: estado[k] for k in ("meta_leads", "rd_leads", "pct", "piso_pct")}}


class handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            qs = urllib_parse_qs(self.path)
            cron = qs.get("cron") == "1"
            if cron:
                secret = os.environ.get("CRON_SECRET") or ""
                auth = self.headers.get("Authorization") or ""
                if not (secret and auth == "Bearer " + secret):
                    require_user(self, min_lvl=7)
            else:
                require_user(self, min_lvl=5)
            sb = supabase_client()
            if sb is None:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            if cron:
                return self._send(200, _avaliar(sb))
            return self._send(200, {"ok": True, "estado": kv_get(sb, KV, {}) or {}})
        except AuthError as e:
            return self._send(e.code, {"ok": False, "error": e.msg})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:300]})

    def do_POST(self):
        # sócio força uma avaliação agora (testes)
        try:
            require_user(self, min_lvl=10)
            sb = supabase_client()
            if sb is None:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            return self._send(200, _avaliar(sb))
        except AuthError as e:
            return self._send(e.code, {"ok": False, "error": e.msg})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:300]})


def urllib_parse_qs(path):
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(path).query)
    return {k: v[0] for k, v in q.items()}
