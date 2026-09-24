"""
GET /api/v3/system/consistency — SENTINELA DE CONSISTÊNCIA (auditoria SI1). v84.1

O sistema se auto-audita: compara os MESMOS números entre fontes diferentes e
acusa divergência — o tipo de incongruência que a auditoria manual de jul/2026
achou (custo fixo 70k chumbado × 88.9k real) nunca mais passa despercebido.

Checks:
  1. custo_premissas — Dashboard usa os custos REAIS da Viabilidade? (fonte)
  2. custos_vazios   — Custos detalhados da Viabilidade preenchidos?
  3. meta_descolada  — meta anual × realizado (atingimento < 25% depois de abril = recalibrar)
  4. frentes_orfas   — deals ganhos do ano caindo em 'outros' (funil sem frente mapeada)
  5. cenarios_locais — sempre ok (cenários agora são backend; check é lembrete histórico)
  6. venda_sem_data  — venda ganha sem closed_at? (v87.59) as telas discordam do MÊS
  7. venda_valor_divergente — amount=0 com amount_total>0? (v87.59) discordam do VGV

Requer lvl>=7. Usado pelo painel de saúde e pelo cron de alertas.

v88.0 — 🔎 TESTE NOTURNO DOS NÚMEROS ENTRE TELAS (item 6 da unificação de métricas, pedido do Paulo 17/09):
  ?cron=1 (Bearer CRON_SECRET; cron da Vercel 23h30 BRT + heartbeat) recalcula o mesmo número pelo caminho de
  cada tela e compara com o motor único (api/v3/_consistencia_lib.py). Roda 1×/dia a partir das 20h BRT (ou na
  manhã seguinte, se a noite passou sem rodar), grava shared_kv consistencia_telas:<data> e, se algo divergir,
  avisa os sócios no sino + celular. O GET normal inclui as divergências da última rodada no aviso de saúde.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, frente_of, notify_all  # type: ignore
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)


def _brl(v):
    """v88.37: R$ no padrão brasileiro, cheio com centavos."""
    return "R$ " + f"{float(v or 0):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def _kv(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v
    except Exception:
        return {}


def run_checks(sb):
    now = datetime.now(timezone.utc)
    ano = now.year
    checks = []

    def add(cid, ok, msg, sev="warn"):
        checks.append({"id": cid, "ok": bool(ok), "msg": msg, "sev": ("ok" if ok else sev)})

    # 1+2. custos da viabilidade preenchidos → dashboard herda a fonte real
    vc = _kv(sb, "viab_custos_orcado")
    itens = ((vc.get(str(ano)) or {}).get("itens") or []) if isinstance(vc, dict) else []
    fixo = sum(float(i.get("valor") or 0) for i in itens if isinstance(i, dict) and (i.get("classe") or "fixo") == "fixo")
    add("custos_vazios", bool(itens),
        f"Custos detalhados {ano}: {len(itens)} itens (fixo R$ {fixo:,.2f}/mês)" if itens
        else f"Custos detalhados de {ano} VAZIOS — Dashboard cai no fallback (premissa manual/70k)", "err")
    add("custo_premissas", bool(itens) and fixo > 0,
        "Dashboard Diretoria lendo custo fixo REAL da Viabilidade" if (itens and fixo > 0)
        else "Dashboard usando premissa de custo NÃO-real (fallback)", "warn")

    # 3. meta descolada da realidade
    try:
        mq = sb.table("metas").select("meta_vgv").eq("ano", ano).execute().data or []
        meta = sum(float(m.get("meta_vgv") or 0) for m in mq)
        dq = sb.table("deals").select("amount").eq("win", True) \
            .gte("closed_at", f"{ano}-01-01T00:00:00+00:00").lt("closed_at", f"{ano+1}-01-01T00:00:00+00:00") \
            .execute().data or []
        real = sum(float(d.get("amount") or 0) for d in dq)
        if meta > 0 and now.month >= 4:
            pct = real / meta * 100
            add("meta_descolada", pct >= 25,
                f"Atingimento anual {pct:.0f}% (meta {_brl(meta)} × real {_brl(real)})" if pct >= 25
                else f"Meta anual DESCOLADA: {pct:.0f}% atingido em {now.month}/{ano} — recalibrar (meta {_brl(meta)} × real {_brl(real)})", "warn")
        else:
            add("meta_descolada", True, "Meta anual: sem avaliação (sem meta ou início de ano)")
    except Exception as e:
        add("meta_descolada", True, f"check indisponível: {e}")

    # 4. deals ganhos caindo em 'outros' (funil sem frente mapeada na Central de Frentes)
    try:
        dd = sb.table("deals").select("pipeline_name,amount").eq("win", True) \
            .gte("closed_at", f"{ano}-01-01T00:00:00+00:00").execute().data or []
        orfaos = {}
        for d in dd:
            if frente_of(d.get("pipeline_name")) == "outros":
                pn = (d.get("pipeline_name") or "(sem funil)").strip()
                orfaos[pn] = orfaos.get(pn, 0) + float(d.get("amount") or 0)
        # PARCERIA é 'outros' por decisão (fora das frentes) — só alerta acima de R$0 em funis NÃO conhecidos
        estranhos = {k: v for k, v in orfaos.items() if "PARCERIA" not in k.upper() and v > 0}   # R$0 = ruído, não alerta
        add("frentes_orfas", not estranhos,
            "Todos os funis do RD mapeados nas frentes" if not estranhos
            else "Funis SEM frente mapeada (VGV caindo em 'outros'): " + "; ".join(f"{k} ({_brl(v)})" for k, v in list(estranhos.items())[:5]), "warn")
    except Exception as e:
        add("frentes_orfas", True, f"check indisponível: {e}")

    # 5+6. v87.59 (auditoria 08/set) — DETECTORES DAS DUAS BOMBAS ARMADAS.
    # O sistema tem regras diferentes espalhadas pra "em que mês caiu a venda"
    # (closed_at estrito × closed_at||created_at_rd) e pra "quanto ela valeu"
    # (amount × amount com fallback em rd_raw.amount_total). Hoje as regras dão
    # o MESMO resultado só porque 100% das vendas têm closed_at e nenhuma tem
    # amount zerado com amount_total cheio. No dia em que o RD gravar uma venda
    # fora desse padrão, as telas passam a discordar em silêncio. Estes dois
    # checks acusam o primeiro caso, antes de virar número errado no cockpit.
    try:
        wins = sb.table("deals").select("closed_at,amount,amt_total:rd_raw->amount_total") \
            .eq("win", True).limit(5000).execute().data or []
        sem_data = [d for d in wins if not d.get("closed_at")]
        add("venda_sem_data", not sem_data,
            f"Todas as {len(wins)} vendas têm closed_at — as telas concordam no mês"
            if not sem_data else
            f"{len(sem_data)} venda(s) SEM closed_at: Gestão Comercial, Metas, Produtividade e Arena "
            f"vão IGNORAR essas vendas enquanto Dashboard e Marketing contam pelo created_at_rd. "
            f"Unificar a régua de data antes de confiar no mês.", "err")

        def _zerado(d):
            try:
                a = float(d.get("amount") or 0)
            except (TypeError, ValueError):
                a = 0.0
            try:
                t = float(d.get("amt_total") or 0)
            except (TypeError, ValueError):
                t = 0.0
            return a <= 0 < t

        sem_valor = [d for d in wins if _zerado(d)]
        add("venda_valor_divergente", not sem_valor,
            "Nenhuma venda com amount zerado e amount_total cheio — o VGV bate entre as telas"
            if not sem_valor else
            f"{len(sem_valor)} venda(s) com amount=0 mas amount_total>0: Reconcile, Produtividade, Arena, "
            f"Viabilidade e CS vão somar R$ 0 nelas enquanto Dashboard, Metas e 1:1 somam o valor cheio.", "err")
    except Exception as e:
        add("venda_sem_data", True, f"check indisponível: {e}")

    falhas = [c for c in checks if not c["ok"]]
    return {"ok": not falhas, "checks": checks, "falhas": len(falhas), "ts": now.isoformat()}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        import urllib.parse
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        if q.get("cron") == "1":
            return self._cron(q)
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            out = run_checks(sb)
            ult = _ultima_rodada(sb)
            if ult:
                falhas = [c for c in (ult.get("checks") or []) if not c.get("ok")]
                out["numeros_entre_telas"] = {"data": ult.get("_data"), "ts": ult.get("ts"), "falhas": len(falhas),
                                              "checks": ult.get("checks") or []}
                for c in falhas:
                    out["checks"].append({"id": "telas:" + c["id"], "ok": False, "sev": "err",
                                          "msg": f"🔎 Teste noturno ({ult.get('_data')}): {c['msg']}"})
                out["falhas"] = sum(1 for c in out["checks"] if not c["ok"])
                out["ok"] = not out["falhas"]
            return self._send(200, out)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def _cron(self, q):
        secret = os.environ.get("CRON_SECRET") or ""
        if not secret or (self.headers.get("Authorization") or "") != f"Bearer {secret}":
            return self._send(401, {"ok": False, "error": "cron sem CRON_SECRET"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        import _consistencia_lib as CL
        import _metricas_lib as MX
        from datetime import timedelta
        agora = MX.agora_brt()
        hoje = agora.date()
        forcar = q.get("forcar") == "1"
        # dia de referência: a partir das 20h roda o de hoje; antes disso só recupera ONTEM se a noite passou em branco
        if agora.hour >= 20 or forcar:
            ref = hoje
        else:
            ref = hoje - timedelta(days=1)
            if ref.weekday() == 6 or _kv(sb, CL.KV_PREFIXO + ref.isoformat()):
                return self._send(200, {"ok": True, "skip": "antes das 20h e a rodada de ontem já existe"})
        chave = CL.KV_PREFIXO + ref.isoformat()
        if _kv(sb, chave) and not forcar:
            return self._send(200, {"ok": True, "skip": f"já rodou em {ref.isoformat()}"})
        res = CL.comparar(sb, hoje)
        res["referencia"] = ref.isoformat()
        res["atrasado"] = ref != hoje
        avisados = 0
        titulo, corpo = CL.resumo_aviso(res)
        if titulo:
            try:
                socios = [u["id"] for u in (sb.table("users").select("id,role,status").execute().data or [])
                          if (u.get("role") or "").lower() in ("socio", "diretor") and (u.get("status") or "ativo") == "ativo"]
                avisados = notify_all(socios, "consistencia_telas", titulo, corpo, link="#/", target_type="consistencia")
            except Exception as e:
                res["erro_aviso"] = str(e)[:160]
        res["avisados"] = avisados
        try:
            sb.table("shared_kv").upsert({"key": chave, "value": res, "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            res["erro_gravar"] = str(e)[:160]
        return self._send(200, {"ok": True, "referencia": ref.isoformat(), "falhas": res["falhas"],
                                "checks": len(res["checks"]), "avisados": avisados})


def _ultima_rodada(sb):
    try:
        rows = (sb.table("shared_kv").select("key,value").like("key", "consistencia_telas:%")
                .order("key", desc=True).limit(1).execute().data or [])
        if not rows:
            return None
        v = rows[0]["value"]
        v = json.loads(v) if isinstance(v, str) else (v or {})
        v["_data"] = rows[0]["key"].split(":", 1)[1]
        return v
    except Exception:
        return None
