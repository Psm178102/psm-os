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
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, frente_of  # type: ignore


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
                f"Atingimento anual {pct:.0f}% (meta R$ {meta:,.0f} × real R$ {real:,.0f})" if pct >= 25
                else f"Meta anual DESCOLADA: {pct:.0f}% atingido em {now.month}/{ano} — recalibrar (meta R$ {meta:,.0f} × real R$ {real:,.0f})", "warn")
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
            else "Funis SEM frente mapeada (VGV caindo em 'outros'): " + "; ".join(f"{k} (R$ {v:,.0f})" for k, v in list(estranhos.items())[:5]), "warn")
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
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            return self._send(200, run_checks(sb))
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
