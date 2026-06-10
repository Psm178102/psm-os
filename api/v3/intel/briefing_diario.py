"""GET /api/v3/intel/briefing_diario[?preview=1|auto=1]
BRIEFING MATINAL no WhatsApp do diretor — todo dia, o resumo de ontem:
leads novos, vendas + VGV, perdas, 🔥 quentes da campanha, alerta de CPL
e alerta de venda sem valor. Dado 100% real (deals + wa_sends + meta_ads_monthly).

Disparo SEM depender de cron (o do Vercel é não-confiável): o boot do main.js
chama ?auto=1 quando um diretor abre o sistema — o server só envia se já passou
das 7h (BRT) e ainda não foi enviado hoje (dedup em wa_sends). O cron do Vercel,
se voltar, pode chamar também (CRON_SECRET) — idempotente.

Auth: Bearer CRON_SECRET ou JWT lvl>=7.
Envio: Evolution API (EVOLUTION_API_URL/KEY/INSTANCE) → BRIEFING_PHONE.
Sem essas envs → responde com o texto pronto + pending (nada quebra).
?preview=1 → só devolve o texto, nunca envia.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore

BRT = timezone(timedelta(hours=-3))


def _evolution_send(phone, text):
    url = (os.environ.get("EVOLUTION_API_URL") or "").rstrip("/")
    key = os.environ.get("EVOLUTION_API_KEY") or ""
    inst = os.environ.get("EVOLUTION_INSTANCE") or ""
    if not (url and key and inst):
        return {"ok": False, "pending": True, "error": "configure EVOLUTION_API_URL/KEY/INSTANCE"}
    req = urllib.request.Request(
        f"{url}/message/sendText/{inst}",
        data=json.dumps({"number": phone, "text": text}).encode("utf-8"),
        method="POST", headers={"Content-Type": "application/json", "apikey": key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return {"ok": True, "status": r.status}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _count(sb, table, build):
    try:
        res = build(sb.table(table).select("id", count="exact")).execute()
        return res.count or 0
    except Exception:
        return None


def _fmt_money(v):
    return "R$ " + f"{round(v):,}".replace(",", ".")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def _auth(self):
        secret = os.environ.get("CRON_SECRET")
        auth = self.headers.get("Authorization") or ""
        if secret and auth == f"Bearer {secret}":
            return {"id": "cron", "lvl": 10}
        return require_user(self, min_lvl=7)

    def do_GET(self):
        try:
            self._auth()
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        preview = q.get("preview") == "1"
        auto = q.get("auto") == "1"

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        now_brt = datetime.now(BRT)
        hoje_brt = now_brt.date()
        ontem = hoje_brt - timedelta(days=1)
        # janela de "ontem" em UTC (ontem 00:00→24:00 BRT)
        y0 = datetime(ontem.year, ontem.month, ontem.day, tzinfo=BRT).astimezone(timezone.utc).isoformat()
        y1 = datetime(hoje_brt.year, hoje_brt.month, hoje_brt.day, tzinfo=BRT).astimezone(timezone.utc).isoformat()
        m0 = datetime(hoje_brt.year, hoje_brt.month, 1, tzinfo=BRT).astimezone(timezone.utc).isoformat()

        # modo auto: só envia depois das 7h BRT e 1× por dia (dedup em wa_sends)
        if auto:
            if now_brt.hour < 7:
                return self._send(200, {"ok": True, "skipped": "antes das 7h BRT"})
            ja = _count(sb, "wa_sends", lambda qq: qq.eq("campaign", "briefing_diario").gte("sent_at", y1))
            if ja:
                return self._send(200, {"ok": True, "skipped": "já enviado hoje"})

        # ── coleta (tudo real) ──
        leads_ontem = _count(sb, "deals", lambda qq: qq.gte("created_at_rd", y0).lt("created_at_rd", y1))
        perdas_ontem = _count(sb, "deals", lambda qq: qq.eq("win", False).gte("closed_at", y0).lt("closed_at", y1))
        try:
            vrows = (sb.table("deals").select("amount,name").eq("win", True)
                     .gte("closed_at", y0).lt("closed_at", y1).limit(50).execute().data or [])
        except Exception:
            vrows = []
        vendas_ontem = len(vrows)
        vgv_ontem = sum(float(r.get("amount") or 0) for r in vrows)
        quentes_ontem = _count(sb, "wa_sends", lambda qq: qq.eq("is_sim", True).gte("replied_at", y0).lt("replied_at", y1))
        sem_vgv_mes = _count(sb, "deals", lambda qq: qq.eq("win", True).gte("closed_at", m0).eq("amount", 0))

        # CPL do mês vs média dos 3 anteriores (meta_ads_monthly)
        cpl_alerta, cpl_txt = None, None
        try:
            rows = (sb.table("meta_ads_monthly").select("ano,mes,spend,leads")
                    .order("ano", desc=True).order("mes", desc=True).limit(5).execute().data or [])
            cur = next((r for r in rows if r["ano"] == hoje_brt.year and r["mes"] == hoje_brt.month), None)
            hist = [r for r in rows if not (r["ano"] == hoje_brt.year and r["mes"] == hoje_brt.month)][:3]
            if cur and (cur.get("leads") or 0) > 0:
                cpl = float(cur["spend"] or 0) / float(cur["leads"])
                cpl_txt = f"R$ {cpl:.2f}"
                base = [float(r["spend"] or 0) / float(r["leads"]) for r in hist if (r.get("leads") or 0) > 0]
                if base:
                    media = sum(base) / len(base)
                    if cpl > media * 1.3:
                        cpl_alerta = f"⚠️ CPL do mês {cpl_txt} está {cpl/media*100-100:.0f}% acima da média ({media:.2f})"
        except Exception:
            pass

        # ── texto ──
        L = [f"☀️ *Bom dia, Paulo! Briefing PSM — {ontem.strftime('%d/%m')}*", ""]
        L.append(f"📥 Leads novos: *{leads_ontem if leads_ontem is not None else '—'}*")
        L.append(f"🏆 Vendas: *{vendas_ontem}*" + (f" ({_fmt_money(vgv_ontem)})" if vendas_ontem else ""))
        L.append(f"🗑 Perdas: *{perdas_ontem if perdas_ontem is not None else '—'}*")
        if quentes_ontem:
            L.append(f"🔥 Quentes da campanha (responderam SIM): *{quentes_ontem}*")
        alertas = []
        if cpl_alerta:
            alertas.append(cpl_alerta)
        elif cpl_txt:
            L.append(f"📣 CPL do mês: {cpl_txt} (dentro do normal)")
        if sem_vgv_mes:
            alertas.append(f"⚠️ {sem_vgv_mes} venda(s) do mês SEM VALOR no RD — corrigir pra não sujar o VGV")
        if alertas:
            L.append("")
            L.extend(alertas)
        L.append("")
        L.append("📊 housepsm.com.br")
        texto = "\n".join(L)

        dados = {"leads_ontem": leads_ontem, "vendas_ontem": vendas_ontem, "vgv_ontem": vgv_ontem,
                 "perdas_ontem": perdas_ontem, "quentes_ontem": quentes_ontem, "sem_vgv_mes": sem_vgv_mes}
        if preview:
            return self._send(200, {"ok": True, "preview": True, "texto": texto, "dados": dados})

        phone = re.sub(r"\D", "", os.environ.get("BRIEFING_PHONE") or "")
        if not phone:
            return self._send(200, {"ok": False, "pending": True, "texto": texto, "dados": dados,
                                    "error": "configure BRIEFING_PHONE no Vercel (seu WhatsApp, com DDI)"})
        res = _evolution_send(phone, texto)
        try:
            sb.table("wa_sends").insert({"phone": phone, "mensagem": texto, "campaign": "briefing_diario",
                                         "status": "sent" if res.get("ok") else "error",
                                         "erro": (res.get("error") or "")[:300] or None,
                                         "sent_by": "briefing_diario"}).execute()
        except Exception:
            pass
        return self._send(200, {"ok": bool(res.get("ok")), "enviado": bool(res.get("ok")),
                                "pending": bool(res.get("pending")), "erro": res.get("error"),
                                "texto": texto, "dados": dados})
