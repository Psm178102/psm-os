"""
🚨 GET /api/v3/diretoria/viab_alerta[?cron=1]  — alerta de desvio DENTRO do mês (v85.11)

O problema que resolve: hoje o desvio da meta só aparece quando o mês fecha —
quando não dá mais pra reagir. Este job compara, em marcos do mês (dia 10, 20 e
25), o VGV já fechado no RD contra a meta PROPORCIONAL aos dias decorridos, e
avisa a diretoria enquanto ainda há mês pela frente.

Regras:
  • ritmo esperado = meta do mês × (dia / dias do mês)
  • alerta quando o realizado fica abaixo de 70% desse ritmo
  • 1 alerta por marco por mês (dedupe em shared_kv) — nunca vira spam
  • silencioso se não houver meta lançada (não dá pra desviar do que não existe)

Roda pelo heartbeat (nunca depende do agendador do Vercel) e também pode ser
aberto na mão pra ver o diagnóstico do momento.
"""
from http.server import BaseHTTPRequestHandler
import calendar
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify, lvl_of  # type: ignore
from viab import read_kv, write_kv, realizado_ano, orc_for, LINHA_IDS  # type: ignore

MARCOS = (10, 20, 25)      # dias em que o alerta pode disparar
PISO_RITMO = 0.70          # abaixo de 70% do ritmo esperado = alerta
KV_DEDUPE = "viab_alerta_enviados"


def _dest_ids(sb):
    """Diretoria (lvl>=8) ativa — mesma alçada que já recebe os avisos de custo."""
    try:
        rows = sb.table("users").select("id,role,status").execute().data or []
    except Exception:
        return []
    return [r["id"] for r in rows
            if (r.get("status") or "ativo") == "ativo" and (lvl_of(r.get("role")) or 0) >= 8]


def diagnostico(sb, hoje=None):
    hoje = hoje or datetime.now(timezone.utc).date()
    ano, mes = hoje.year, hoje.month
    ndias = calendar.monthrange(ano, mes)[1]
    frac = hoje.day / ndias
    orcamento = read_kv(sb, "viab_orcamento")
    real = realizado_ano(sb, ano)
    linhas, meta_tot, real_tot = [], 0.0, 0.0
    for l in LINHA_IDS:
        o = orc_for(orcamento, ano, l, mes)
        meta = float(o.get("vgv") or 0)
        r = ((real.get(l) or {}).get(str(mes)) or {})
        feito = float(r.get("vgv") or 0)
        meta_tot += meta
        real_tot += feito
        if meta <= 0:
            continue
        esperado = meta * frac
        linhas.append({
            "linha": l, "meta": round(meta, 2), "realizado": round(feito, 2),
            "esperado_ate_hoje": round(esperado, 2),
            "ritmo_pct": round(feito / esperado * 100, 1) if esperado > 0 else None,
            "atingimento_pct": round(feito / meta * 100, 1),
            "vendas": int(r.get("vendas") or 0),
            "gap": round(max(0.0, meta - feito), 2),
        })
    esperado_tot = meta_tot * frac
    return {
        "ano": ano, "mes": mes, "dia": hoje.day, "dias_mes": ndias,
        "dias_restantes": ndias - hoje.day,
        "frac": round(frac, 4),
        "meta_mes": round(meta_tot, 2), "realizado_mes": round(real_tot, 2),
        "esperado_ate_hoje": round(esperado_tot, 2),
        "ritmo_pct": round(real_tot / esperado_tot * 100, 1) if esperado_tot > 0 else None,
        "gap": round(max(0.0, meta_tot - real_tot), 2),
        "linhas": linhas,
        "tem_meta": meta_tot > 0,
    }


def _marco_de(dia):
    """Maior marco já atingido hoje (10/20/25) — ou None antes do dia 10."""
    passados = [d for d in MARCOS if dia >= d]
    return max(passados) if passados else None


def rodar(sb, force=False):
    d = diagnostico(sb)
    if not d["tem_meta"]:
        return {"ok": True, "skip": "sem meta lançada no mês", "diag": d}
    marco = _marco_de(d["dia"])
    if marco is None and not force:
        return {"ok": True, "skip": f"antes do 1º marco (dia {MARCOS[0]})", "diag": d}
    ritmo = d["ritmo_pct"]
    if ritmo is None or ritmo >= PISO_RITMO * 100:
        return {"ok": True, "skip": f"ritmo em {ritmo}% — dentro do esperado", "diag": d}
    chave = f"{d['ano']}-{d['mes']:02d}:{marco}"
    env = read_kv(sb, KV_DEDUPE)
    if not force and chave in (env.get("enviados") or []):
        return {"ok": True, "skip": f"marco {marco} já avisado neste mês", "diag": d}

    piores = sorted([l for l in d["linhas"] if l["ritmo_pct"] is not None],
                    key=lambda x: x["ritmo_pct"])[:3]
    det = " · ".join(f"{p['linha']}: {p['ritmo_pct']:.0f}% do ritmo" for p in piores)
    titulo = f"🚨 Ritmo do mês em {ritmo:.0f}% — faltam {d['dias_restantes']} dia(s)"
    corpo = (f"No dia {d['dia']}/{d['dias_mes']} o esperado era R$ {d['esperado_ate_hoje']:,.2f} "
             f"e fechamos R$ {d['realizado_mes']:,.2f}. Falta R$ {d['gap']:,.2f} pra meta do mês"
             + (f". Mais atrasadas: {det}." if det else "."))
    corpo = corpo.replace(",", "@").replace(".", ",").replace("@", ".")   # pt-BR

    ids = _dest_ids(sb)
    for uid in ids:
        try:
            notify(uid, "viab_ritmo", titulo, corpo, link="#/metricas-viab")
        except Exception:
            pass
    try:
        env.setdefault("enviados", [])
        env["enviados"] = (env["enviados"] + [chave])[-40:]
        write_kv(sb, KV_DEDUPE, env)
    except Exception:
        pass
    return {"ok": True, "alertou": True, "marco": marco, "destinatarios": len(ids), "diag": d}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def _cron_ok(self):
        s = os.environ.get("CRON_SECRET", "").strip()
        return bool(s) and (self.headers.get("Authorization") or "") == f"Bearer {s}"

    def do_GET(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if self._cron_ok():
            return self._send(200, rodar(sb))
        try:
            require_user(self, min_lvl=8)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        # aberto na mão: só DIAGNÓSTICO (não dispara notificação pra ninguém)
        return self._send(200, {"ok": True, "diag": diagnostico(sb)})
