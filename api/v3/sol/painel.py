"""
GET /api/v3/sol/painel — Central da Sol (atendente IA WhatsApp da Conquista)
Header: Authorization: Bearer <token> — SÓ SÓCIO (lvl >= 10).

Devolve tudo que a página precisa em 1 request:
  - hoje:      métricas do dia corrente (America/Sao_Paulo) da view sol_metricas_diarias
  - dias:      últimos 14 dias da mesma view (ordem cronológica, buracos preenchidos com zero)
  - conversas: conversas ATIVAS de sol_conversas (telefone MASCARADO — (17) 9****-2193),
               ordenadas por prioridade desc
  - eventos:   últimas 50 linhas de sol_eventos (tipo + criado_em)
  - config:    chaves de sol_config (autonomia_padrao / numero_whatsapp / persona_versao
               / reguas / templates) — o número sai mascarado; token NUNCA passa por aqui
  - integracoes: status por cabo (env presente? último evento com payload.origem_cabo?)
               — só BOOLEANOS de presença de env; o valor do token nunca viaja
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

# status de sol_conversas que NÃO contam como "ativa" (encerradas/entregues)
STATUS_FECHADOS = ("encerrada", "finalizada", "perdida", "descartada", "handoff_concluido")

DIAS_JANELA = 14

# ── Cabos de integração da Sol ────────────────────────────────────────────
# Cada cabo: lista de grupos de env; cada grupo é "A|B" = QUALQUER um serve.
# Nomes REAIS já usados no repo (não inventar env novo onde já existe um):
#   RD CRM  → RD_CRM_TOKEN (api/rd.js) / RD_API_TOKEN (api/v3/crm/*)
#   RD MKT  → RD_MKT_TOKEN ou OAuth RD_MKT_CLIENT_ID (api/rd.js / rd-auth.js)
#   Leadgen → META_ACCESS_TOKEN + META_APP_SECRET (api/v3/marketing/leads_webhook.py)
#   IG      → IG_PAGE_TOKEN_CONQUISTA / IG_PAGE_TOKEN (api/webhook-instagram.js)
#   WA Cloud→ META_WA_TOKEN + META_WABA_ID (novos — a WABA da Sol ainda não existe)
CABOS = {
    "whatsapp_cloud": {"lbl": "WhatsApp Cloud API", "envs": ["META_WA_TOKEN", "META_WABA_ID"]},
    "rd_crm":         {"lbl": "RD CRM",             "envs": ["RD_CRM_TOKEN|RD_API_TOKEN"]},
    "rd_mkt":         {"lbl": "RD Marketing",       "envs": ["RD_MKT_TOKEN|RD_MKT_CLIENT_ID"]},
    "meta_leadgen":   {"lbl": "Meta Leadgen (FB)",  "envs": ["META_ACCESS_TOKEN", "META_APP_SECRET"]},
    "instagram":      {"lbl": "Instagram Direct",   "envs": ["IG_PAGE_TOKEN_CONQUISTA|IG_PAGE_TOKEN"]},
}


def _env_ok(grupos):
    """True se TODOS os grupos têm pelo menos um env presente (grupo = 'A|B')."""
    for g in grupos:
        if not any(os.environ.get(n, "").strip() for n in g.split("|")):
            return False
    return True


def _hoje_sp():
    """Data de hoje em America/Sao_Paulo (Vercel roda em UTC)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    except Exception:
        return (datetime.utcnow() - timedelta(hours=3)).date()


def _mascara_fone(raw):
    """5517996612193 → (17) 9****-2193. Nunca devolve o número inteiro."""
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("55") and len(d) >= 12:
        d = d[2:]
    if len(d) < 8:
        return "***" if d else ""
    ddd, resto = (d[:2], d[2:]) if len(d) >= 10 else ("", d)
    ini, fim = resto[0], resto[-4:]
    pre = f"({ddd}) " if ddd else ""
    return f"{pre}{ini}****-{fim}"


def _zero_dia(dia_iso):
    return {
        "dia": dia_iso, "msgs_recebidas": 0, "msgs_enviadas": 0, "toques_regua": 0,
        "conversas_ativas": 0, "qualificados": 0, "simulacoes": 0,
        "agendamentos": 0, "handoffs": 0, "escalacoes": 0, "erros": 0,
    }


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        hoje = _hoje_sp()
        ini = hoje - timedelta(days=DIAS_JANELA - 1)

        # ── métricas (view sol_metricas_diarias) ──────────────────────────
        try:
            rows = (
                sb.table("sol_metricas_diarias").select("*")
                .gte("dia", ini.isoformat()).lte("dia", hoje.isoformat())
                .order("dia").execute().data or []
            )
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"métricas: {e}"})
        por_dia = {str(r.get("dia")): r for r in rows}
        dias = []
        for i in range(DIAS_JANELA):
            d = (ini + timedelta(days=i)).isoformat()
            dias.append(por_dia.get(d) or _zero_dia(d))
        metricas_hoje = por_dia.get(hoje.isoformat()) or _zero_dia(hoje.isoformat())

        # ── conversas ativas (fone mascarado, prioridade desc) ────────────
        try:
            convs = (
                sb.table("sol_conversas")
                .select("id,nome,telefone,marca,origem,etapa_funil,regua,passo,"
                        "prioridade,proximo_toque_em,status,autonomia,atualizado_em")
                .order("prioridade", desc=True).order("atualizado_em", desc=True)
                .limit(400).execute().data or []
            )
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"conversas: {e}"})
        # filtro de "ativa" em Python (lista de fechados pode crescer sem mexer na query)
        convs = [c for c in convs
                 if str(c.get("status") or "").strip().lower() not in STATUS_FECHADOS][:200]
        for c in convs:
            c["telefone"] = _mascara_fone(c.get("telefone"))

        # ── últimos eventos ───────────────────────────────────────────────
        try:
            evs = (
                sb.table("sol_eventos").select("id,conversa_id,tipo,criado_em")
                .order("criado_em", desc=True).limit(50).execute().data or []
            )
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"eventos: {e}"})

        # ── config (número mascarado; token nunca sai do env) ─────────────
        try:
            cfg_rows = sb.table("sol_config").select("chave,valor,atualizado_em").execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"config: {e}"})
        config = {}
        for r in cfg_rows:
            config[r.get("chave")] = {"valor": r.get("valor"), "atualizado_em": r.get("atualizado_em")}
        wa = (config.get("numero_whatsapp") or {}).get("valor") or {}
        if isinstance(wa, dict) and wa.get("numero"):
            wa["numero_mascarado"] = _mascara_fone(wa.get("numero"))
            wa.pop("numero", None)
        # token da Cloud API presente no env? (só o BOOLEANO viaja — nunca o valor)
        config["token_env_ok"] = bool(os.environ.get("META_WA_TOKEN"))

        # ── integrações: env presente + último evento visto por cabo ──────
        # (o evento carrega payload.origem_cabo; a query filtra no PostgREST)
        integracoes = {}
        for cabo, meta in CABOS.items():
            ultimo = None
            try:
                r = (
                    sb.table("sol_eventos").select("tipo,criado_em")
                    .eq("payload->>origem_cabo", cabo)
                    .order("criado_em", desc=True).limit(1).execute().data or []
                )
                ultimo = r[0] if r else None
            except Exception:
                ultimo = None  # best-effort: card fica sem "último evento"
            integracoes[cabo] = {
                "lbl": meta["lbl"],
                "envs": meta["envs"],          # só os NOMES — valor nunca viaja
                "env_ok": _env_ok(meta["envs"]),
                "ultimo_evento": ultimo,
            }

        return self._send(200, {
            "ok": True,
            "hoje": metricas_hoje,
            "dias": dias,
            "conversas": convs,
            "eventos": evs,
            "config": config,
            "integracoes": integracoes,
        })
