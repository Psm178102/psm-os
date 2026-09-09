"""
GET /api/v3/marketing/gestor_paridade            → { ok, estado } (lvl>=5)
GET /api/v3/marketing/gestor_paridade?cron=1     → avalia e alerta (CRON_SECRET ou lvl>=7)
POST                                             → força avaliação (sócio)

🔔 PARIDADE META×RD **POR MARCA** (v87.72 — reescrito 09/09 após o vazamento do
LUX JK). Compara, na janela de 7 dias, os leads que o Meta reporta POR CONTA com
as negociações que entraram no RD com fonte de mídia paga POR MARCA. Se qualquer
marca cair abaixo do piso (70%), push nos sócios NOMEANDO a marca.

Por que por marca: em 09/09 o agregado dava 60% (limítrofe) enquanto a PSM Imóveis
estava em 16% — 26 leads do LUX JK presos por formulário não combinado no RD. Um
número só, somando as duas marcas, esconde exatamente o tipo de falha que a gente
quer pegar.

Fonte Meta: meta_ads_cache last_7d, campo accounts[].results (o cache NÃO traz
dailySeries nessa chave — a v87.53 dependia dele e nunca avaliava).
Guardas: amostra mínima de 5 leads no Meta por marca; 1 alerta por marca por dia.
Estado em shared_kv gt_paridade. Piso editável em gt_alertas.limiares.paridade_min_pct.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
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

# conta Meta → marca. Conquista tem conta própria; Imóveis e Paulo alimentam MAP.
CONTA_MARCA = {
    "act_1851397782164698": "conquista",
    "act_1413862082678408": "imoveis",
    "act_2321924467923057": "imoveis",
}
MARCA_LBL = {"conquista": "PSM Conquista", "imoveis": "PSM Imóveis / MAP"}


def _marca_do_pipeline(nome):
    return "conquista" if "CONQUISTA" in (nome or "").upper() else "imoveis"


def _avaliar(sb):
    agora = agora_brt()
    hoje = agora.date().isoformat()
    estado = kv_get(sb, KV, {}) or {}

    # 1) Meta: leads por marca (janela 7d do cache compartilhado)
    payload, _age, _src = read_cache(sb, build_cache_key("last_7d", "", ""), 10 ** 9)
    meta = {"conquista": 0, "imoveis": 0}
    contas_vistas = 0
    for a in ((payload or {}).get("accounts") or []):
        if a.get("_error"):
            continue
        marca = CONTA_MARCA.get(str(a.get("id") or ""))
        if not marca:
            continue
        contas_vistas += 1
        try:
            meta[marca] += int(float(a.get("results") or 0))
        except Exception:
            pass
    if not contas_vistas:
        estado.update({"ts": agora.isoformat(), "obs": "cache Meta sem contas legíveis"})
        kv_set(sb, KV, estado)
        return {"ok": True, "avaliado": False, "motivo": "cache Meta indisponível"}

    # 2) RD: negociações dos últimos 7 dias com fonte de mídia paga, por marca
    from datetime import timedelta
    desde = (agora - timedelta(days=7)).date().isoformat()
    rows = (sb.table("deals").select("pipeline_name,rd_raw")
            .gte("created_at_rd", desde).limit(3000).execute().data or [])
    rd = {"conquista": 0, "imoveis": 0}
    for d in rows:
        raw = d.get("rd_raw") or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}
        fonte = str(((raw.get("deal_source") or {}).get("name")) or "").lower()
        if any(f in fonte for f in FONTES_PAGA):
            rd[_marca_do_pipeline(d.get("pipeline_name"))] += 1

    limiares = (kv_get(sb, "gt_alertas", {}) or {}).get("limiares") or {}
    piso = float(limiares.get("paridade_min_pct") or 70)

    # 3) diagnóstico por marca + quem está furando o piso
    por_marca, furando = {}, []
    for m in ("conquista", "imoveis"):
        pct = round(rd[m] / meta[m] * 100, 1) if meta[m] else None
        por_marca[m] = {"meta": meta[m], "rd": rd[m], "pct": pct}
        if meta[m] >= 5 and pct is not None and pct < piso:
            furando.append(m)

    estado.update({"ts": agora.isoformat(), "janela": "7d", "piso_pct": piso,
                   "por_marca": por_marca, "obs": None})

    # dedupe: 1 alerta por marca por dia
    ja = estado.get("ultimo_alerta") or {}
    novas = [m for m in furando if ja.get(m) != hoje]

    if novas:
        for m in novas:
            ja[m] = hoje
        estado["ultimo_alerta"] = ja
        det = " · ".join(
            f"{MARCA_LBL[m]}: {por_marca[m]['rd']}/{por_marca[m]['meta']} ({por_marca[m]['pct']:.0f}%)"
            for m in novas)
        titulo = "🚨 Leads do Meta não estão chegando no RD — " + ", ".join(MARCA_LBL[m] for m in novas)
        body = (f"Últimos 7 dias — {det}. Piso {piso:.0f}%. Causa mais comum: formulário "
                "novo criado no Meta e NÃO combinado na integração do RD (Meta Lead Ads → "
                "Combinar campos). Os leads ficam 90 dias no Meta e dá pra recuperar.")
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us
                      if (u.get("status") or "ativo") == "ativo"
                      and lvl_of((u.get("role") or "").lower()) >= 10]
            if socios:
                notify(socios, "gt_paridade", titulo, body=body, link="#/gestor-trafego")
                send_web_push(socios, titulo, body=body, link="#/gestor-trafego", tag="gt_paridade")
        except Exception:
            pass

    kv_set(sb, KV, estado)
    return {"ok": True, "avaliado": True, "alertou": [MARCA_LBL[m] for m in novas],
            "furando": [MARCA_LBL[m] for m in furando], "por_marca": por_marca, "piso_pct": piso}


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
            q = parse_qs(urlparse(self.path).query)
            cron = (q.get("cron") or [""])[0] == "1"
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
