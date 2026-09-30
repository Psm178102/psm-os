"""
GET /api/v3/marketing/vigia_nuvem?cron=1   — 🕵️ Coletor do Vigia NA NUVEM (v89.3)

Pedido do Paulo (30/09/2026): "se possível rodar na nuvem, melhor ainda, assim não dependeremos do PC
ligado e conectado". Substitui a tarefa do Windows (vigia-ad-library, Claude in Chrome): a Biblioteca de
Anúncios do Meta é PÚBLICA (sem login) e é lida pelo Firecrawl (FIRECRAWL_API_KEY no Vercel).

A cada chamada (heartbeat, de hora em hora) coleta até LOTE concorrentes que ainda NÃO têm snapshot hoje
(de qualquer coletor — se o Windows já coletou, pula). Grava igual ao coletor antigo:
  ad_library_snapshots (INSERT, histórico; criado_por='vigia-nuvem', concorrente = concorrentes.nome)
  concorrentes.anuncios_count / anuncios_dias_medio (tempo médio no ar — antes vazio) / ultima_atualizacao
e o carimbo cron_state 'nuvem:vigia_coletor' (Central de Operações). O Vigia IA (gestor_vigia) consome sozinho.

Sem FIRECRAWL_API_KEY → não faz nada e avisa (a tarefa do Windows segue valendo).
GET (sem cron, lvl>=10) → cobertura do dia.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit, hoje_brt  # type: ignore
import _adlib_parse as AP  # type: ignore

LOTE = 8
URL_PAG = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id={}"
FC_URLS = ("https://api.firecrawl.dev/v2/scrape", "https://api.firecrawl.dev/v1/scrape")


def _url(fb):
    fb = str(fb or "").strip()
    return fb if fb.startswith("http") else URL_PAG.format(fb)


def _firecrawl(url, key):
    body = json.dumps({"url": url, "formats": ["markdown"], "onlyMainContent": True, "waitFor": 5000,
                       "maxAge": 0, "location": {"country": "BR", "languages": ["pt-BR"]}}).encode("utf-8")
    ultimo = None
    for api in FC_URLS:
        req = urllib.request.Request(api, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                d = json.loads(r.read().decode("utf-8"))
            md = ((d.get("data") or {}).get("markdown")) or ""
            if md:
                return md
            ultimo = "página vazia"
        except urllib.error.HTTPError as e:
            ultimo = f"firecrawl {e.code}"
            if e.code != 404:   # 404 = versão da API; tenta a outra
                break
        except Exception as e:
            ultimo = str(e)[:120]
            break
    raise RuntimeError(ultimo or "falha no firecrawl")


def _inicio_dia_utc():
    h = hoje_brt()
    return datetime(h.year, h.month, h.day, 3, 0, tzinfo=timezone.utc)   # 00:00 BRT


def _pendentes(sb):
    cc = sb.table("concorrentes").select("id,nome,segmento,tier,fb").neq("fb", "").execute().data or []
    cc = [c for c in cc if str(c.get("fb") or "").strip()]
    hoje = sb.table("ad_library_snapshots").select("concorrente").gte("captured_at", _inicio_dia_utc().isoformat()).execute().data or []
    feitos = {r["concorrente"] for r in hoje}
    ordem = {"MCMV": 0, "MAP": 1}
    pend = [c for c in cc if c["nome"] not in feitos]
    pend.sort(key=lambda c: (ordem.get(c.get("segmento"), 2), c.get("tier") or "Z", c["id"]))
    return cc, feitos, pend


def _analise(p, anterior):
    ads = p["anuncios"]
    n = p["total"] if p["total"] is not None else len(ads)
    if n == 0:
        return "Sem anúncios ativos hoje."
    novos = [a for a in ads if a["dias_no_ar"] is not None and a["dias_no_ar"] <= 7]
    zap = sum(1 for a in ads if a["whatsapp"])
    dias = [a["dias_no_ar"] for a in ads if a["dias_no_ar"] is not None]
    txt = f"{n} anúncio(s) ativo(s)"
    if anterior is not None:
        d = n - anterior
        txt += f" ({'+' if d > 0 else ''}{d} vs coleta anterior)" if d else " (igual à coleta anterior)"
    txt += f"; {len(novos)} entraram nos últimos 7 dias"
    if dias:
        txt += f"; o mais antigo está no ar há {max(dias)} dias"
    if zap:
        txt += f"; {zap} levam para o WhatsApp"
    return txt + "."


def coletar(sb, key, lote=LOTE):
    cc, feitos, pend = _pendentes(sb)
    feitos_agora, falhas = [], []
    t0 = time.time()
    for c in pend[:lote]:
        if time.time() - t0 > 240:   # margem antes do limite da função
            break
        try:
            md = _firecrawl(_url(c["fb"]), key)
            p = AP.parse(md, hoje_brt())
            if p["total"] is None and not p["anuncios"]:
                raise RuntimeError("página sem contagem reconhecível")
        except Exception as e:
            falhas.append(f"{c['nome']}: {str(e)[:80]}")
            continue
        ant = sb.table("ad_library_snapshots").select("ads_count").eq("concorrente", c["nome"]) \
            .order("captured_at", desc=True).limit(1).execute().data or []
        anterior = ant[0].get("ads_count") if ant else None
        n = p["total"] if p["total"] is not None else len(p["anuncios"])
        dias = [a["dias_no_ar"] for a in p["anuncios"] if a["dias_no_ar"] is not None]
        conteudo = "\n\n".join(
            f"[{a['inicio'] or '?'} · {a['dias_no_ar'] if a['dias_no_ar'] is not None else '?'}d no ar"
            f"{' · ' + a['cta'] if a['cta'] else ''}] {a['texto']}" for a in p["anuncios"][:12]) or "Sem anúncios ativos."
        sb.table("ad_library_snapshots").insert({
            "concorrente": c["nome"], "page_name": c["nome"], "url": _url(c["fb"]), "ads_count": n,
            "nivel_invest": AP.nivel(n), "segmento": c.get("segmento"), "conteudo": conteudo[:8000],
            "ai_analysis": _analise(p, anterior), "captured_at": datetime.now(timezone.utc).isoformat(),
            "criado_por": "vigia-nuvem",
        }).execute()
        upd = {"anuncios_count": n, "ultima_atualizacao": datetime.now(timezone.utc).isoformat()}
        if dias:
            upd["anuncios_dias_medio"] = round(sum(dias) / len(dias), 1)
        sb.table("concorrentes").update(upd).eq("id", c["id"]).execute()
        feitos_agora.append(c["nome"])
    cobertos = len(feitos) + len(feitos_agora)
    nota = f"cobertura {cobertos}/{len(cc)} hoje · +{len(feitos_agora)} nesta rodada" + (f" · falhas: {'; '.join(falhas)[:180]}" if falhas else "")
    sb.table("cron_state").upsert({"key": "nuvem:vigia_coletor", "ran_at": datetime.now(timezone.utc).isoformat(),
                                   "note": nota[:300]}, on_conflict="key").execute()
    return {"ok": True, "coletados": feitos_agora, "falhas": falhas, "cobertura": f"{cobertos}/{len(cc)}"}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def _cron_ok(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        return bool(secret) and tok == secret

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        if q.get("cron"):
            if not self._cron_ok():
                try:
                    require_user(self, min_lvl=10)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            key = os.environ.get("FIRECRAWL_API_KEY", "").strip()
            if not key:
                return self._send(200, {"ok": False, "pendente": "FIRECRAWL_API_KEY não configurada no Vercel — coleta segue no Windows"})
            out = coletar(sb, key)
            audit(self, None, "marketing.vigia_nuvem", target_type="ad_library_snapshots",
                  target_id=hoje_brt().isoformat(), notes=out["cobertura"])
            return self._send(200, out)
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        cc, feitos, pend = _pendentes(sb)
        return self._send(200, {"ok": True, "cobertura": f"{len(cc) - len(pend)}/{len(cc)}",
                                "faltam": [c["nome"] for c in pend][:80],
                                "firecrawl": bool(os.environ.get("FIRECRAWL_API_KEY"))})
