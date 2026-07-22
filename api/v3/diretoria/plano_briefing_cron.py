"""
GET /api/v3/diretoria/plano_briefing_cron — BRIEFING SEMANAL DO PLANO. v84.21

Toda segunda 10h UTC (7h BRT): coleta o real da semana/mês (mesma régua do
Real vs Plano), o checklist/gates pendentes e a produção da equipe de apoio,
gera um briefing curto com IA (cadeia AI_PREFER, mesma do estoque) e:
  1. salva em shared_kv 'plano_briefing' {texto, ts} → aparece no topo da aba
     🧭 Plano de Resgate;
  2. push (sino + web push) pra diretoria (lvl>=7).
O plano manda: "revisar contra o real toda semana" — isso aqui é a semana
chegando revisada, antes do café.

Auth: CRON_SECRET ou lvl>=7 (rodar na mão pra testar).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify_all, lvl_of  # type: ignore
from plano_resgate import _kv_get, _real, SEED  # type: ignore

KV_OUT = "plano_briefing"
BRT = timezone(timedelta(hours=-3))


def _ia(prompt):
    keys = {"gemini": os.environ.get("GEMINI_API_KEY"),
            "claude": os.environ.get("ANTHROPIC_API_KEY"),
            "openai": os.environ.get("OPENAI_API_KEY")}
    primary = os.environ.get("AI_PREFER") or "gemini"
    for prov in [primary] + [p for p in ("gemini", "claude", "openai") if p != primary]:
        k = keys.get(prov)
        if not k:
            continue
        try:
            if prov == "gemini":
                model = os.environ.get("GEMINI_SMART_MODEL") or "gemini-2.5-flash"
                req = urllib.request.Request(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    data=json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                                     "generationConfig": {"maxOutputTokens": 4096, "temperature": 0.4,
                                                          "thinkingConfig": {"thinkingBudget": 0}}}).encode(),
                    headers={"Content-Type": "application/json", "x-goog-api-key": k})
                with urllib.request.urlopen(req, timeout=55) as r:
                    data = json.loads(r.read().decode())
                parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                txt = "".join(p.get("text", "") for p in parts)
            elif prov == "claude":
                req = urllib.request.Request("https://api.anthropic.com/v1/messages",
                    data=json.dumps({"model": os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5",
                                     "max_tokens": 2048, "messages": [{"role": "user", "content": prompt}]}).encode(),
                    headers={"x-api-key": k, "anthropic-version": "2023-06-01", "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=55) as r:
                    data = json.loads(r.read().decode())
                txt = "".join(c.get("text", "") for c in (data.get("content") or []) if c.get("type") == "text")
            else:
                req = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                    data=json.dumps({"model": "gpt-4o-mini", "max_tokens": 2048,
                                     "messages": [{"role": "user", "content": prompt}]}).encode(),
                    headers={"Authorization": "Bearer " + k, "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=55) as r:
                    data = json.loads(r.read().decode())
                txt = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if txt:
                return txt, prov
        except Exception:
            continue
    return None, None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
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

        plano = _kv_get(sb) or SEED
        real = _real(sb, plano)
        mes = next((m for m in plano.get("meses", []) if m["id"] == real.get("mes_id")),
                   (plano.get("meses") or [{}])[0])
        ck = plano.get("checklist") or {}
        acoes_pend = [a for i, a in enumerate(mes.get("acoes") or []) if f"{mes.get('id')}:acao:{i}" not in ck]
        gate_ok = f"{mes.get('id')}:gate" in ck
        vgv = real.get("vgv") or {}
        fisc = real.get("fiscalizacao") or {}
        dados = {
            "mes": mes.get("nome"), "meta_conquista": mes.get("conquista"), "meta_proprio": mes.get("proprio"),
            "real_conquista": vgv.get("conquista", 0),
            "real_proprio": vgv.get("map", 0) + vgv.get("terceiros", 0),
            "contribuicao": real.get("contribuicao"),
            "breakeven_operacional": (plano.get("constantes") or {}).get("breakeven_operacional", 70000),
            "gate": mes.get("gate"), "gate_marcado": gate_ok, "acoes_pendentes": acoes_pend,
            "locacao": real.get("locacao"), "fiscalizacao_eventos_mes": fisc,
            "dia_do_mes": datetime.now(BRT).day,
        }
        # 💰 Radar de Recebíveis (v84.83): caixa da semana + top travados
        try:
            from datetime import timedelta as _td, date as _date
            hoje = datetime.now(BRT).date()
            recs = sb.table("recebiveis").select("descricao,valor_liquido_estimado,data_prevista,status,bloqueio") \
                .limit(500).execute().data or []
            def _v(r): return float(r.get("valor_liquido_estimado") or 0)
            def _d(r):
                try: return _date.fromisoformat(str(r.get("data_prevista"))[:10])
                except Exception: return None
            semana = [r for r in recs if _d(r) and 0 <= (_d(r) - hoje).days <= 7 and r.get("status") not in ("recebido", "perdido")]
            travados = sorted([r for r in recs if r.get("status") == "travado"], key=_v, reverse=True)[:3]
            dados["recebiveis_semana"] = {
                "confirmado": sum(_v(r) for r in semana if r.get("status") == "confirmado"),
                "previsto_total": sum(_v(r) for r in semana),
                "top_travados": [{"desc": r.get("descricao"), "valor": _v(r), "bloqueio": r.get("bloqueio")} for r in travados],
            }
        except Exception:
            pass
        # 📥 Leads LP Conquista (v84.86): semana em teste de CRM paralelo ao RD
        try:
            from datetime import timedelta as _td7
            desde7 = (datetime.now(timezone.utc) - _td7(days=7)).isoformat()
            lps = sb.table("leads_lp").select("faixa_renda,nutricao,ts_recebido,ts_primeira_resposta,status_atendimento,rd_deal_ref") \
                .gte("ts_recebido", desde7).limit(1000).execute().data or []
            quentes = [l for l in lps if not l.get("nutricao")]
            resp = []
            for l in quentes:
                if l.get("ts_primeira_resposta"):
                    try:
                        resp.append((datetime.fromisoformat(str(l["ts_primeira_resposta"]).replace("Z", "+00:00"))
                                     - datetime.fromisoformat(str(l["ts_recebido"]).replace("Z", "+00:00"))).total_seconds() / 60)
                    except Exception:
                        pass
            por_faixa = {}
            for l in lps:
                por_faixa[l.get("faixa_renda") or "?"] = por_faixa.get(l.get("faixa_renda") or "?", 0) + 1
            if lps:
                dados["leads_lp_semana"] = {
                    "total": len(lps), "nutricao": len(lps) - len(quentes), "por_faixa": por_faixa,
                    "tempo_medio_resposta_min": round(sum(resp) / len(resp), 1) if resp else None,
                    "pct_respondidos_5min": round(100.0 * sum(1 for m in resp if m <= 5) / len(resp), 1) if resp else None,
                    "agendados": sum(1 for l in quentes if l.get("status_atendimento") == "agendado"),
                    "casados_rd": sum(1 for l in lps if l.get("rd_deal_ref")),
                }
        except Exception:
            pass
        prompt = (
            "Você é o braço direito estratégico do dono de uma holding imobiliária (PSM, São José do Rio Preto). "
            "Escreva o BRIEFING DE SEGUNDA-FEIRA do Plano de Resgate (jul→dez/2026) em pt-BR, máx ~180 palavras, "
            "markdown com bullets, direto e sem enrolação. Estrutura: 1) placar do mês vs meta (VGV Conquista e "
            "próprio, em R$ completos); 2) contribuição vs break-even; 3) gate do mês — está comprado ou em risco? "
            "3) as 2–3 ações pendentes MAIS urgentes do checklist; 4) um alerta ou oportunidade que os números "
            "mostram (ex.: equipe de apoio sem eventos = ninguém registrando); 5) CAIXA da semana: recebíveis confirmados vs previstos e os top travados em R$ (campo recebiveis_semana) — cobre quem destrava; "
            "6) se houver leads_lp_semana: leads da LP por faixa, tempo médio de 1ª resposta e % em 5min, agendados e casados com o RD — cobre velocidade. Tom: sócio cobrando sócio, "
            "sem motivacional vazio. Dados reais:\n" + json.dumps(dados, ensure_ascii=False, default=str))
        txt, prov = _ia(prompt)
        if not txt:
            # sem IA disponível: briefing determinístico mínimo (nunca fica mudo)
            txt = (f"**Briefing {dados['mes']}** — Conquista R$ {dados['real_conquista']:,.2f} / meta R$ {dados['meta_conquista']:,.2f}; "
                   f"próprio R$ {dados['real_proprio']:,.2f} / meta R$ {dados['meta_proprio']:,.2f}; contribuição R$ {dados['contribuicao']:,.2f}. "
                   f"Gate: {dados['gate']} ({'✔ marcado' if gate_ok else 'pendente'}). Ações pendentes: " + ("; ".join(acoes_pend) or "nenhuma"))
            prov = "fallback"
        registro = {"texto": txt[:6000], "provider": prov,
                    "ts": datetime.now(timezone.utc).isoformat()}
        try:
            sb.table("shared_kv").upsert({"key": KV_OUT, "value": registro,
                                          "updated_at": registro["ts"]}, on_conflict="key").execute()
        except Exception:
            pass
        notified = 0
        try:
            users = sb.table("users").select("id,role,status").execute().data or []
            alvo = [u["id"] for u in users if u.get("id") and (u.get("status") or "ativo") == "ativo"
                    and lvl_of(u.get("role")) >= 7]
            if alvo:
                notified = notify_all(alvo, "briefing", "🧭 Briefing de segunda — Plano de Resgate",
                                      body=txt[:180] + "…", link="#/estrategia")
        except Exception:
            pass
        return self._send(200, {"ok": True, "provider": prov, "notified": notified, "texto": txt[:400]})
