"""
GET /api/v3/metrics/overview
Header: Authorization: Bearer <token>

Retorna KPIs agregados para o Dashboard /v2. Role-based:
- Sócio/Gerente:    todos os dados (todo o time)
- Líder de equipe:  só o time dele
- Corretor:         só os próprios dados

Resp: {
  ok, scope: 'global'|'team'|'self',
  users:        { total, ativos, inativos, ocultos, by_team: {...} },
  commissions:  { count, pendentes, pagas, valor_total, valor_pendente },
  audit:        { last_24h, last_7d, top_actions: [...], recent: [...] },
  pipelines:    { count_active, by_pipeline: [...] }
}
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, frente_of  # type: ignore

# ── Cache do overview (v81.74) ───────────────────────────────────────────────
# O dashboard recalculava 7 agregações pesadas (todos os deals, audit 30d, comissões,
# metas, dir_tasks…) a CADA abertura → ~3-4s morno, pior frio. Agora o resultado é
# cacheado por ESCOPO em shared_kv por uma janela curta; o campo 'user' é sempre
# sobreposto fresco na leitura, então o cache de um time não vaza identidade.
# v87.86 — motor único de métricas (Dicionário de Métricas v1)
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)
from _metricas_lib import resumo as mx_resumo, versao_deals, team_key as mx_team  # type: ignore

CACHE_BASE = "metrics_overview_cache"
CACHE_TTL = 180  # segundos (3 min; métrica de painel tolera folga, RD já sincroniza por cron)


def _cache_key(scope, user):
    if scope == "global":
        return CACHE_BASE + ":global"
    if scope == "team":
        return CACHE_BASE + ":team:" + str((user.get("team") or "_")).lower()
    return CACHE_BASE + ":self:" + str(user.get("id"))


def _cache_read(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        if not rows:
            return None
        v = rows[0]["value"]
        if isinstance(v, str):
            v = json.loads(v)
        ts = v.get("_cached_at") if isinstance(v, dict) else None
        if not ts:
            return None
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds()
        if age > CACHE_TTL:
            return None
        data = v.get("data")
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _cache_write(sb, key, data):
    try:
        sb.table("shared_kv").upsert(
            {"key": key, "value": {"_cached_at": datetime.now(timezone.utc).isoformat(), "data": data},
             "updated_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="key").execute()
    except Exception:
        pass


def _scope_of(user):
    lvl = user.get("lvl") or 0
    role = (user.get("role") or "").lower()
    # v87.85: papel por PREFIXO (gerente_conquista, lider_map…), nunca igualdade exata
    if lvl >= 7 or role in ("socio", "diretor") or role.startswith("gerente"):
        return "global"
    if role.startswith("lider") or role == "líder":
        return "team"
    return "self"


def _users_summary(sb, scope, user):
    res = sb.table("users").select("id,name,team,status,hide_from_ranking,is_service").execute()
    # v87.85 (Dicionário de Métricas v1 §0): contas de serviço (tv, comercial) não contam como pessoas
    rows = [r for r in (res.data or []) if not r.get("is_service")]
    if scope == "team":
        rows = [r for r in rows if (r.get("team") or "").lower() == (user.get("team") or "").lower()]
    if scope == "self":
        rows = [r for r in rows if r.get("id") == user.get("id")]

    total = len(rows)
    ativos = sum(1 for r in rows if (r.get("status") or "ativo") == "ativo")
    inativos = total - ativos
    ocultos = sum(1 for r in rows if r.get("hide_from_ranking"))

    by_team = {}
    for r in rows:
        t = r.get("team") or "geral"
        by_team[t] = by_team.get(t, 0) + 1

    return {
        "total": total, "ativos": ativos, "inativos": inativos, "ocultos": ocultos,
        "by_team": by_team,
    }


def _commissions_summary(sb, scope, user):
    # PAGINA (PostgREST trava em ~1000/resposta) — valores de comissão somados aqui
    # aparecem no Dashboard de Início; sem paginar, somariam errado se houver +1000 comissões.
    # v86.65: escopo filtrado NO BANCO (.eq/.in_) em vez de paginar tudo e filtrar em Python
    team_ids = None
    if scope == "team":
        team = (user.get("team") or "").strip().lower()
        team_ids = sorted({u["id"] for u in (sb.table("users").select("id").ilike("team", team).execute().data or [])})
        if not team_ids:
            return {"count": 0, "pendentes": 0, "pagas": 0, "valor_total": 0.0, "valor_pendente": 0.0}
    rows = []
    _pg = 0
    while True:
        q = sb.table("commissions").select("id,corretor_id,valor,status,data,data_pagamento")
        if scope == "self":
            q = q.eq("corretor_id", user["id"])
        elif scope == "team":
            q = q.in_("corretor_id", team_ids)
        _ch = q.order("id").range(_pg * 1000, _pg * 1000 + 999).execute().data or []
        rows.extend(_ch)
        if len(_ch) < 1000 or _pg >= 50:
            break
        _pg += 1

    count = len(rows)
    pendentes = sum(1 for r in rows if (r.get("status") or "").lower() in ("pendente", "aberto", "previsto"))
    pagas = count - pendentes
    valor_total = sum(float(r.get("valor") or 0) for r in rows)
    valor_pendente = sum(float(r.get("valor") or 0) for r in rows if (r.get("status") or "").lower() in ("pendente", "aberto", "previsto"))

    return {
        "count": count, "pendentes": pendentes, "pagas": pagas,
        "valor_total": valor_total, "valor_pendente": valor_pendente,
    }


def _audit_summary(sb, scope, user):
    now = datetime.now(timezone.utc)
    iso_24h = (now - timedelta(hours=24)).isoformat()
    iso_7d  = (now - timedelta(days=7)).isoformat()

    q24 = sb.table("audit_log").select("id", count="exact").gte("ts", iso_24h)
    q7  = sb.table("audit_log").select("id", count="exact").gte("ts", iso_7d)
    if scope == "self":
        q24 = q24.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
        q7  = q7.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
    last_24h = q24.execute().count or 0
    last_7d  = q7.execute().count or 0

    # Top 5 actions (últimos 30d)
    iso_30d = (now - timedelta(days=30)).isoformat()
    rows = []
    _pg = 0
    while True:
        _q = sb.table("audit_log").select("action").gte("ts", iso_30d).order("ts").range(_pg * 1000, _pg * 1000 + 999)
        if scope == "self":
            _q = _q.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
        _ch = _q.execute().data or []
        rows.extend(_ch)
        if len(_ch) < 1000 or _pg >= 30:
            break
        _pg += 1
    counts = {}
    for r in rows:
        a = r.get("action") or "?"
        counts[a] = counts.get(a, 0) + 1
    top_actions = sorted(counts.items(), key=lambda x: -x[1])[:5]
    top_actions = [{"action": k, "count": v} for k, v in top_actions]

    # 5 mais recentes
    qrecent = sb.table("audit_log").select("ts,actor_id,actor_name,action,target_id,notes").order("ts", desc=True).limit(5)
    if scope == "self":
        qrecent = qrecent.or_(f"actor_id.eq.{user['id']},target_id.eq.{user['id']}")
    recent = qrecent.execute().data or []

    return {"last_24h": last_24h, "last_7d": last_7d, "top_actions": top_actions, "recent": recent}


def _pipelines_summary(sb):
    res = sb.table("rd_pipelines").select("id,name,external_id,active,excluded_from_metrics").execute()
    rows = res.data or []
    active = [r for r in rows if r.get("active") is not False and not r.get("excluded_from_metrics")]
    return {
        "count_total":  len(rows),
        "count_active": len(active),
        "by_pipeline":  [{"name": r.get("name"), "active": bool(r.get("active")), "excluded": bool(r.get("excluded_from_metrics"))} for r in rows],
    }


def _sales_summary(sb, scope, user):
    """Vendas reais do RD (deals win=true) — VGV + pipeline + perdidos + ticket médio.
    Schema deals (Postgres): id, name, amount, win (true/false/null), closed_at,
    created_at_rd, pipeline_id, stage_id, user_id, user_email, rd_raw.
    NÃO TEM coluna 'lost' — perdido = win is False.
    """
    now = datetime.now(timezone.utc)
    iso_30d = (now - timedelta(days=30)).isoformat()
    # v86.65: fronteira de mês/ano em BRT (UTC-3) — 1º dia 00:00 BRT = 03:00 UTC
    agora_b = now - timedelta(hours=3)
    inicio_mes = (agora_b.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + timedelta(hours=3)).isoformat()
    inicio_ano = (agora_b.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0) + timedelta(hours=3)).isoformat()

    # Lê TODOS os deals PAGINANDO. Antes usava .limit(5000), mas o PostgREST do Supabase
    # trava em ~1000 linhas/resposta — pegava só os 1000 primeiros deals (quase todos abertos)
    # e perdia quase todas as vendas (VGV ano caía de R$7,5M pra R$222k). Agora pagina tudo,
    # ficando consistente com /metas/atingimento (mesma tabela deals, win=true).
    rows = []
    page = 0
    team_ids = None

    def _amt(r):
        """amount com fallback em rd_raw.amount_total (v86.65)."""
        for v in (r.get("amount"), r.get("amt_total")):
            try:
                if v not in (None, "") and float(v) > 0:
                    return float(v)
            except (TypeError, ValueError):
                pass
        return 0.0
    while True:
        q = sb.table("deals").select("id,amount,closed_at,created_at_rd,updated_at_rd,user_id,user_email,win,pipeline_name,amt_total:rd_raw->amount_total") \
            .order("id").range(page * 1000, page * 1000 + 999)
        if scope == "self":
            q = q.eq("user_id", user["id"])
        elif scope == "team":
            # v86.65: filtra a equipe NO BANCO
            if team_ids is None:
                team = (user.get("team") or "").strip().lower()
                team_ids = sorted({u["id"] for u in (sb.table("users").select("id").ilike("team", team).execute().data or [])})
            if not team_ids:
                break
            q = q.in_("user_id", team_ids)
        chunk = q.execute().data or []
        rows.extend(chunk)
        if len(chunk) < 1000 or page >= 50:
            break
        page += 1

    wins = [r for r in rows if r.get("win") is True]
    perdidos = [r for r in rows if r.get("win") is False]
    abertos = [r for r in rows if r.get("win") is None]
    # Pipeline EM ANDAMENTO (v84.20): aberto ≠ atendido. A base tem milhares de
    # leads parados/sem valor que inflavam o KPI (R$565M "de pipeline"). Vale
    # como pipeline só quem teve atividade no RD nos últimos 30d (updated_at_rd).
    ANDAMENTO_DIAS = 30
    iso_andamento = (now - timedelta(days=ANDAMENTO_DIAS)).isoformat()
    andamento = [r for r in abertos if (r.get("updated_at_rd") or r.get("created_at_rd") or "") >= iso_andamento]
    frentes_pipe = {}
    for r in andamento:
        fr = frente_of(r.get("pipeline_name"))
        b = frentes_pipe.setdefault(fr, {"n": 0, "vgv": 0.0, "sem_valor": 0})
        b["n"] += 1
        v = _amt(r)
        b["vgv"] += v
        if v <= 0:
            b["sem_valor"] += 1

    def in_period(r, iso_start):
        # 📅 v87.59 (auditoria 08/set) — RÉGUA ÚNICA DE DATA: o mês do negócio é o
        # closed_at, SEM cair pro created_at_rd. O fallback nasceu de quando o RD
        # deixava closed_at vazio; hoje 100%% dos deals fechados (ganhos E perdidos)
        # têm closed_at, e o fallback só servia pra jogar negócio antigo no mês em que
        # o LEAD nasceu — divergindo da Gestão Comercial, do Painel Metas, da
        # Produtividade Real e da Arena, que sempre exigiram closed_at.
        # Vigiado por /api/v3/system/consistency (check venda_sem_data).
        d = r.get("closed_at") or ""
        return bool(d) and d >= iso_start

    def sum_vgv(arr):
        return sum(_amt(r) for r in arr)

    wins_30d = [r for r in wins if in_period(r, iso_30d)]
    wins_mes = [r for r in wins if in_period(r, inicio_mes)]
    wins_ano = [r for r in wins if in_period(r, inicio_ano)]
    perdidos_mes = [r for r in perdidos if in_period(r, inicio_mes)]

    ticket_medio_mes = (sum_vgv(wins_mes) / len(wins_mes)) if wins_mes else 0

    return {
        "vendas_30d":      len(wins_30d),
        "vgv_30d":         sum_vgv(wins_30d),
        "vendas_mes":      len(wins_mes),
        "vgv_mes":         sum_vgv(wins_mes),
        "vendas_ano":      len(wins_ano),
        "vgv_ano":         sum_vgv(wins_ano),
        "pipeline_count":  len(andamento),
        "pipeline_vgv":    sum_vgv(andamento),
        "pipeline_frentes": sorted(([f, b["n"], round(b["vgv"], 2), b["sem_valor"]]
                                    for f, b in frentes_pipe.items()), key=lambda x: -x[2]),
        "pipeline_dias":   ANDAMENTO_DIAS,
        "pipeline_sem_valor": sum(b["sem_valor"] for b in frentes_pipe.values()),
        "pipeline_base_count": len(abertos),
        "pipeline_base_vgv": sum_vgv(abertos),
        "perdidos_mes":    len(perdidos_mes),
        "vgv_perdido_mes": sum_vgv(perdidos_mes),
        "ticket_medio_mes": ticket_medio_mes,
        "deals_total":     len(rows),
    }


def _metas_summary(sb, scope, user):
    """Atingimento de meta do mês."""
    # v87.85: mês em Brasília (antes UTC — entre 21h e 0h do último dia a meta era do mês seguinte
    # enquanto o VGV, calculado em BRT, ainda era deste mês)
    now = datetime.now(timezone.utc) - timedelta(hours=3)
    ano = now.year
    mes = now.month
    try:
        q = sb.table("metas").select("corretor_id,ano,mes,meta_vgv,meta_vendas").eq("ano", ano).eq("mes", mes)
        if scope == "self":
            q = q.eq("corretor_id", user["id"])
        metas = q.execute().data or []
        if scope == "team":
            team = (user.get("team") or "").lower()
            # v87.85: mesma comparação (ilike) usada nas vendas — antes eq() perdia "Conquista" com maiúscula
            team_ids = {u["id"] for u in (sb.table("users").select("id").ilike("team", team).execute().data or [])}
            metas = [m for m in metas if m.get("corretor_id") in team_ids]
    except Exception:
        metas = []

    meta_total_vgv = sum(float(m.get("meta_vgv") or 0) for m in metas)
    meta_total_vendas = sum(int(m.get("meta_vendas") or 0) for m in metas)

    return {
        "meta_vgv":            meta_total_vgv,
        "meta_vendas":         meta_total_vendas,
        "corretores_com_meta": len(metas),
        "ano": ano, "mes": mes,
    }


def _tasks_summary(sb, scope, user):
    """Tarefas diretoria — total, feitas, pendentes."""
    # PAGINA (PostgREST trava em ~1000/resposta; .limit(2000) não bastava).
    rows = []
    _pg = 0
    while True:
        try:
            _ch = sb.table("dir_tasks").select("id,status,responsavel") \
                .order("id").range(_pg * 1000, _pg * 1000 + 999).execute().data or []
        except Exception:
            _ch = []
        rows.extend(_ch)
        if len(_ch) < 1000 or _pg >= 50:
            break
        _pg += 1

    if scope == "self":
        rows = [r for r in rows if r.get("responsavel") == user.get("id") or r.get("responsavel") == user.get("name")]

    total = len(rows)
    done = sum(1 for r in rows if (r.get("status") or "").lower() in ("concluida", "concluído", "feita", "ok", "done"))
    pending = total - done

    return {"total": total, "done": done, "pending": pending}


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        scope = _scope_of(user)
        user_field = {"id": user["id"], "name": user.get("name"), "role": user.get("role"), "team": user.get("team"), "lvl": user.get("lvl")}
        fresh = "fresh=1" in (self.path or "")
        # v87.86: chave com a VERSÃO do dado (último sync do RD) — mesma foto em todas as telas
        ckey = _cache_key(scope, user) + "|" + versao_deals(sb)

        # Cache hit → responde na hora (sobrepondo o 'user' do request atual). v81.74
        if not fresh:
            cached = _cache_read(sb, ckey)
            if cached is not None:
                cached["user"] = user_field
                cached["cached"] = True
                return self._send(200, cached)

        result = {"ok": True, "scope": scope, "user": user_field}
        try:
            result["users"]       = _users_summary(sb, scope, user)
        except Exception as e:
            result["users"] = {"error": str(e)}
        try:
            result["commissions"] = _commissions_summary(sb, scope, user)
        except Exception as e:
            result["commissions"] = {"error": str(e)}
        try:
            result["audit"]       = _audit_summary(sb, scope, user)
        except Exception as e:
            result["audit"] = {"error": str(e)}
        try:
            result["pipelines"]   = _pipelines_summary(sb)
        except Exception as e:
            result["pipelines"] = {"error": str(e)}
        try:
            result["sales"]       = _sales_summary(sb, scope, user)
        except Exception as e:
            result["sales"] = {"error": str(e)}
        try:
            result["metas"]       = _metas_summary(sb, scope, user)
        except Exception as e:
            result["metas"] = {"error": str(e)}
        try:
            result["tasks"]       = _tasks_summary(sb, scope, user)
        except Exception as e:
            result["tasks"] = {"error": str(e)}

        # ── v87.86 DICIONÁRIO DE MÉTRICAS: vendas/VGV/ticket/perdidos do mês, meta do mês e
        # pessoas ativas vêm do motor único (mesmo número do 1:1, GC, Sala de Comando e KPIs).
        try:
            mx = mx_resumo(sb, {}, fresh=fresh)
            if scope == "global":
                b = mx.get("empresa")
            elif scope == "team":
                b = (mx.get("equipes") or {}).get(mx_team(user.get("team")))
            else:
                b = (mx.get("pessoas") or {}).get(user["id"])
            if b and isinstance(result.get("sales"), dict) and "error" not in result["sales"]:
                result["sales"].update({"vendas_mes": b["vendas"], "vgv_mes": b["vgv"],
                                        "ticket_medio_mes": b.get("ticket") or 0, "perdidos_mes": b["perdidos"],
                                        "leads_mes": b["leads"], "interessados_mes": b["interessados"],
                                        "em_atendimento": b["em_atendimento"]})
            if b and isinstance(result.get("metas"), dict) and "error" not in result["metas"]:
                result["metas"].update({"meta_vgv": (b.get("meta") or {}).get("meta_vgv") or 0,
                                        "meta_vendas": int((b.get("meta") or {}).get("meta_vendas") or 0)})
            if scope == "global" and isinstance(result.get("users"), dict) and mx.get("empresa"):
                result["users"]["ativos"] = mx["empresa"].get("n_pessoas_ativas", result["users"].get("ativos"))
            result["dados_de"] = mx.get("dados_de")
            result["dados_de_hhmm"] = mx.get("dados_de_hhmm")
            result["avisos_dicionario"] = [a.get("txt") for a in (mx.get("avisos") or []) if str(a.get("txt", "")).startswith("⚠️")]
        except Exception as e:
            print(f"[metrics/overview] motor de métricas indisponível: {e}")

        _cache_write(sb, ckey, result)   # alimenta o cache p/ as próximas aberturas (90s)
        return self._send(200, result)
