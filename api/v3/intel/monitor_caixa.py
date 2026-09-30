"""
GET /api/v3/intel/monitor_caixa?cron=1 — 🏦 Monitor do credenciamento Caixa NA NUVEM (v89.3)

Substitui a tarefa do Windows 'monitor-credenciamento-caixa' (pedido do Paulo, 30/09: rotina de agente
na nuvem sempre que possível). Uma vez por dia, sem navegador e sem login:
  1. Baixa a lista oficial de corretores credenciados (venda-imoveis.caixa.gov.br/listaweb/lista_corretores.zip)
     e procura "PSM" / "MORIMATSU" → se aparecer, o credenciamento saiu (avisa uma vez).
  2. Lê as notícias recentes (Google Notícias RSS) sobre edital/credenciamento de corretores e imobiliárias
     da Caixa → notícia NOVA dos últimos 15 dias vira aviso aos sócios (sino + push), uma vez por link.
Estado em shared_kv 'monitor_caixa'; carimbo cron_state 'nuvem:monitor_caixa' (Central de Operações).
"""
from http.server import BaseHTTPRequestHandler
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit, notify, send_web_push, lvl_of  # type: ignore

KV = "monitor_caixa"
ZIP = "https://venda-imoveis.caixa.gov.br/listaweb/lista_corretores.zip"
RSS = ("https://news.google.com/rss/search?q=" + urllib.parse.quote('Caixa edital credenciamento corretores imobiliárias')
       + "&hl=pt-BR&gl=BR&ceid=BR:pt-419")
RE_RELEVANTE = re.compile(r"credencia", re.I)
RE_ALVO = re.compile(r"corretor|imobili", re.I)
JANELA_DIAS = 15


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (PSM-OS monitor)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _socios(sb):
    us = sb.table("users").select("id,role,status").execute().data or []
    return [u["id"] for u in us if (u.get("status") or "ativo") == "ativo" and lvl_of((u.get("role") or "").lower()) >= 10]


def rodar(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV).limit(1).execute().data or []
    st = (rows[0].get("value") if rows else None) or {}
    vistos = set(st.get("links_vistos") or [])
    avisos, nota = [], []

    # 1) lista oficial de credenciados
    try:
        z = zipfile.ZipFile(io.BytesIO(_get(ZIP, 40)))
        html = z.read(z.namelist()[0]).decode("latin-1").upper()
        achou = ("MORIMATSU" in html) or re.search(r"\bPSM\b", html) is not None
        nota.append("lista: PSM " + ("CONSTA" if achou else "não consta"))
        if achou and not st.get("credenciada_avisado"):
            avisos.append(("✅ Caixa: a PSM aparece na lista de credenciados",
                           "O credenciamento saiu — venda de imóveis retomados com comissão paga pela Caixa está liberada."))
            st["credenciada_avisado"] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        nota.append(f"falha lista: {str(e)[:60]}")

    # 2) notícias de edital
    novas = []
    try:
        x = _get(RSS, 20).decode("utf-8", "ignore")
        limite = datetime.now(timezone.utc) - timedelta(days=JANELA_DIAS)
        for it in re.findall(r"<item>(.*?)</item>", x, re.S):
            titulo = re.sub(r"<!\[CDATA\[|\]\]>", "", (re.search(r"<title>(.*?)</title>", it, re.S) or [None, ""])[1]).strip()
            link = (re.search(r"<link>(.*?)</link>", it, re.S) or [None, ""])[1].strip()
            try:
                quando = parsedate_to_datetime((re.search(r"<pubDate>(.*?)</pubDate>", it, re.S) or [None, ""])[1])
            except Exception:
                continue
            if quando < limite or link in vistos:
                continue
            if RE_RELEVANTE.search(titulo) and RE_ALVO.search(titulo):
                novas.append((titulo, link, quando))
                vistos.add(link)
        nota.append(f"notícias novas: {len(novas)}")
    except Exception as e:
        nota.append(f"falha notícias: {str(e)[:60]}")
    for titulo, link, quando in novas[:3]:
        avisos.append(("🏦 Caixa: notícia de credenciamento", f"{titulo[:160]} ({quando.strftime('%d/%m')}) — confira se a janela está aberta: {link}"))

    if avisos:
        try:
            socios = _socios(sb)
            for t, b in avisos:
                notify(socios, "monitor_caixa", t, body=b[:300], link="#/morimatsu", target_type="monitor_caixa")
                send_web_push(socios, t, body=b[:180], link="#/morimatsu", tag="monitor_caixa")
        except Exception as e:
            nota.append(f"falha aviso: {str(e)[:60]}")

    st.update({"links_vistos": sorted(vistos)[-200:], "ultima": datetime.now(timezone.utc).isoformat(), "nota": " · ".join(nota)})
    sb.table("shared_kv").upsert({"key": KV, "value": st, "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()
    sb.table("cron_state").upsert({"key": "nuvem:monitor_caixa", "ran_at": datetime.now(timezone.utc).isoformat(),
                                   "note": (" · ".join(nota) + (f" · {len(avisos)} aviso(s)" if avisos else ""))[:300]},
                                  on_conflict="key").execute()
    return {"ok": True, "avisos": len(avisos), "nota": " · ".join(nota)}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        if not (secret and tok == secret):
            try:
                require_user(self, min_lvl=10)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        out = rodar(sb)
        audit(self, None, "intel.monitor_caixa", target_type="monitor_caixa", target_id="diario", notes=out["nota"][:200])
        return self._send(200, out)
