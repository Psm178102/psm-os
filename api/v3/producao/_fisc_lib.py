"""
_fisc_lib — miolo compartilhado do Painel de Fiscalização (v84.18).
Usado por eventos.py, painel.py e alertas_cron.py (cada endpoint importa daqui
pra não divergir regra de semáforo/meta/alerta entre pulso e cron).

Config vive em shared_kv 'fiscalizacao_cfg' (NADA hardcoded nas telas) — seed
automático abaixo com as metas aprovadas em 06/07/2026. Eventos são IMUTÁVEIS
em producao_eventos (undo só nos primeiros 90s pelo próprio autor).
"""
import json
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))
KV_CFG = "fiscalizacao_cfg"
KV_ALERTAS = "fiscalizacao_alertas"  # dedupe: { chave: iso_ts }

TIPOS_POR_COLAB = {
    "leire": ["reativacao_tocada", "avaliacao_agendada", "captacao_fechada",
              "doc_aberto", "doc_resolvido", "ticket_locacao_aberto", "ticket_locacao_respondido"],
    "mariane": ["abordagem_indicacao", "indicacao_qualificada", "nps_coletado",
                "venda_atribuida_indicacao"],
    "guilherme": ["captacao_fechada", "contrato_locacao", "conteudo_entregue"],
}

DEFAULT_CFG = {
    "colaboradores": {
        "leire": {
            "nome": "Leire", "user_match": "leire", "motor": "reativacao_tocada",
            "metas": {
                "reativacao_tocada":  {"manha": 25, "tarde": 15, "dia": 40, "semana": 200, "mes": 880},
                "captacao_sinais":    {"tarde": 15, "dia": 15, "semana": 75, "mes": 330},
                "captacao_fechada":   {"semana": 4, "mes": 16},
                "avaliacao_agendada": {"semana": 5, "mes": 20},
            },
            "sla_horas": {"doc": 48, "ticket_locacao": 24},
        },
        "mariane": {
            "nome": "Mariane", "user_match": "mariane", "motor": "abordagem_indicacao",
            "metas": {
                "abordagem_indicacao":       {"manha": 25, "tarde": 20, "dia": 45, "semana": 225, "mes": 990},
                "indicacao_qualificada":     {"mes": 48},
                "venda_atribuida_indicacao": {"mes": 3},
            },
            "nps": {"cobertura_pct": 100, "score_min": 70, "visita_sem_nps_horas": 48,
                    "detrator_max": 6, "promotor_min": 9},
        },
        "guilherme": {
            "nome": "Guilherme", "user_match": "guilherme", "motor": "mes_composto",
            "rampa_inicio": "2026-07",
            "metas_rampa": {
                "captacao_fechada": {"m1": 2, "m2": 3, "m3": 4, "final": 5},
                "contrato_locacao": {"m1": 1, "m2": 1, "m3": 2, "final": 4},
                "video_conquista":  {"m1": 8, "m2": 8, "m3": 6, "final": 4},
                "video_map":        {"m1": 4, "m2": 4, "m3": 3, "final": 2},
                "art_conquista":    {"m1": 12, "m2": 12, "m3": 9, "final": 6},
                "art_map":          {"m1": 6, "m2": 6, "m3": 5, "final": 4},
            },
        },
    },
    "horarios": {"manha_ini": 8, "manha_fim": 12, "dia_fim": 18},
    "semaforo": {"verde_pct": 80, "amarelo_pct": 50},
    "alerta_meta_dia_hora": 14,  # BRT — cron cobra <50% da meta às 14h
    "premio_indicacao_venda": [
        [300000, 500], [450000, 800], [600000, 1000], [900000, 1800], [1000000, 2500]],
    "premio_indicacao_locacao": [[2000, 150], [3000, 250], [999999999, 400]],
    "comissao_locacao": {
        "corretor_pct": 40, "captador_pct": 10, "imob_pct": 50, "recorrencia_pct": 10,
        "excecao_georgina": {"indicador_pct": 50, "corretor_pct": 50, "imob_pct": 0,
                             "nota": "na Georgina a imob fica só com a recorrência"}},
    "lembrete_reativacao": [
        "1️⃣ Abertura PESSOAL: nome + o imóvel/bairro que ele buscava (está no card do lead).",
        "2️⃣ UMA pergunta aberta e espere a resposta — mensagem curta, sem catálogo.",
        "3️⃣ NUNCA cole o texto pronto inteiro: cada etapa é uma mensagem. Textão mata a conversa.",
    ],
}


def _merge(base, extra):
    if not isinstance(base, dict) or not isinstance(extra, dict):
        return extra if extra is not None else base
    out = dict(base)
    for k, v in extra.items():
        out[k] = _merge(base.get(k), v) if isinstance(base.get(k), dict) else v
    return out


def get_cfg(sb, seed=True):
    """Config mesclada (defaults ← shared_kv). Seed grava os defaults na 1ª vez."""
    saved = None
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_CFG).limit(1).execute().data or []
        saved = rows[0]["value"] if rows else None
        if isinstance(saved, str):
            saved = json.loads(saved)
    except Exception:
        saved = None
    if saved is None and seed:
        try:
            sb.table("shared_kv").upsert({"key": KV_CFG, "value": DEFAULT_CFG,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception:
            pass
        return json.loads(json.dumps(DEFAULT_CFG))
    return _merge(DEFAULT_CFG, saved or {})


def colaborador_do_user(cfg, user):
    """Chave ('leire'…) do user logado, batendo user_match em name/login/email."""
    alvo = " ".join(str(user.get(k) or "") for k in ("name", "login", "email")).lower()
    for key, c in (cfg.get("colaboradores") or {}).items():
        if (c.get("user_match") or key) in alvo:
            return key
    return None


def user_ids_por_match(sb, match):
    """ids de users ativos cujo name/login/email contém o match (pra notify)."""
    try:
        rows = sb.table("users").select("id,name,login,email,status").execute().data or []
    except Exception:
        return []
    m = (match or "").lower()
    return [r["id"] for r in rows
            if m and m in " ".join(str(r.get(k) or "") for k in ("name", "login", "email")).lower()
            and (r.get("status") or "ativo") not in ("inativo", "desligado")]


def gestores_ids(sb):
    try:
        rows = sb.table("users").select("id,role,status").execute().data or []
    except Exception:
        return []
    return [r["id"] for r in rows
            if (r.get("role") or "") in ("socio", "diretor", "gerente", "gerente_locacao")
            and (r.get("status") or "ativo") not in ("inativo", "desligado")]


# ── janelas de tempo (tudo em BRT — dia útil da equipe) ─────────────────────
def agora_brt():
    return datetime.now(BRT)


def janelas(now=None):
    now = now or agora_brt()
    dia_ini = now.replace(hour=0, minute=0, second=0, microsecond=0)
    semana_ini = dia_ini - timedelta(days=dia_ini.weekday())
    mes_ini = dia_ini.replace(day=1)
    return dia_ini, semana_ini, mes_ini


def eventos_periodo(sb, desde_utc_iso):
    try:
        return sb.table("producao_eventos").select(
            "id,colaborador,tipo,ts,ref_type,ref_id,valor,meta,criado_por"
        ).gte("ts", desde_utc_iso).order("ts", desc=True).limit(20000).execute().data or []
    except Exception:
        return []


def _ts(e):
    try:
        return datetime.fromisoformat(str(e.get("ts")).replace("Z", "+00:00")).astimezone(BRT)
    except Exception:
        return None


def contadores(eventos, cfg, now=None):
    """{colab: {tipo: {manha, tarde, dia, semana, mes}}} — split manhã/tarde em BRT."""
    now = now or agora_brt()
    dia_ini, semana_ini, mes_ini = janelas(now)
    fim_manha = int((cfg.get("horarios") or {}).get("manha_fim", 12))
    out = {}
    for e in eventos:
        t = _ts(e)
        if not t:
            continue
        c = out.setdefault(e["colaborador"], {}).setdefault(e["tipo"], {
            "manha": 0, "tarde": 0, "dia": 0, "semana": 0, "mes": 0})
        if t >= mes_ini:
            c["mes"] += 1
        if t >= semana_ini:
            c["semana"] += 1
        if t >= dia_ini:
            c["dia"] += 1
            c["manha" if t.hour < fim_manha else "tarde"] += 1
    return out


def esperado_agora(metas_motor, cfg, now=None):
    """Meta proporcional ao horário: manhã até manha_fim, dia inteiro até dia_fim."""
    now = now or agora_brt()
    h = (cfg.get("horarios") or {})
    ini, meio, fim = int(h.get("manha_ini", 8)), int(h.get("manha_fim", 12)), int(h.get("dia_fim", 18))
    m_manha = float(metas_motor.get("manha") or 0)
    m_dia = float(metas_motor.get("dia") or m_manha)
    hora = now.hour + now.minute / 60
    if hora <= ini:
        return 0.0
    if hora <= meio:
        return m_manha * (hora - ini) / max(1, meio - ini)
    if hora <= fim:
        return m_manha + (m_dia - m_manha) * (hora - meio) / max(1, fim - meio)
    return m_dia


def semaforo_pct(feito, esperado, cfg, alerta=False):
    s = cfg.get("semaforo") or {}
    if alerta:
        return "vermelho", 0 if not esperado else round(100 * feito / esperado)
    if esperado <= 0:
        return "verde", 100
    pct = 100 * feito / esperado
    if pct >= float(s.get("verde_pct", 80)):
        return "verde", round(pct)
    if pct >= float(s.get("amarelo_pct", 50)):
        return "amarelo", round(pct)
    return "vermelho", round(pct)


def mes_rampa(colab_cfg, now=None):
    """'m1'|'m2'|'m3'|'final' conforme meses desde rampa_inicio."""
    now = now or agora_brt()
    try:
        ano, mes = (colab_cfg.get("rampa_inicio") or "2026-07").split("-")
        n = (now.year - int(ano)) * 12 + (now.month - int(mes))
    except Exception:
        n = 0
    return ["m1", "m2", "m3"][n] if 0 <= n <= 2 else "final"


def premio_faixa(faixas, valor):
    try:
        v = float(valor or 0)
        for teto, premio in faixas:
            if v <= float(teto):
                return float(premio)
    except Exception:
        pass
    return None  # acima da última faixa = personalizável


# ── pendências e alertas (usado pelo painel a cada pulso E pelo cron) ───────
def _kv(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        return v if isinstance(v, dict) else (json.loads(v) if isinstance(v, str) else {})
    except Exception:
        return {}


def _kv_set(sb, key, value):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": value,
                                      "updated_at": datetime.now(timezone.utc).isoformat()},
                                     on_conflict="key").execute()
    except Exception:
        pass


def pendencias_abertas(eventos, tipo_abre, tipo_fecha, sla_horas, now=None):
    """Pares abre/fecha por ref_id: devolve [{ref_id, horas, estourado}] dos abertos."""
    now = now or agora_brt()
    fechados = {e.get("ref_id") for e in eventos if e["tipo"] == tipo_fecha and e.get("ref_id")}
    out = []
    for e in eventos:
        if e["tipo"] != tipo_abre:
            continue
        ref = e.get("ref_id") or e["id"]
        if ref in fechados:
            continue
        t = _ts(e)
        horas = (now - t).total_seconds() / 3600 if t else 0
        out.append({"ref_id": ref, "rotulo": (e.get("meta") or {}).get("rotulo") or ref,
                    "horas": round(horas, 1), "estourado": horas > sla_horas})
    return out


def checar_alertas(sb, cfg, eventos, notify_all, enviar=True):
    """Roda TODAS as checagens de alerta com dedupe (1 aviso por pendência/dia).
    Chamada no GET do painel (pulso → dispara no ato de cruzar o limite) e no cron."""
    now = agora_brt()
    enviados = _kv(sb, KV_ALERTAS)
    hoje = now.strftime("%Y-%m-%d")
    disparos, mudou = [], False

    def fire(chave, user_ids, titulo, corpo):
        nonlocal mudou
        k = f"{hoje}:{chave}"
        if k in enviados:
            return
        disparos.append({"chave": chave, "titulo": titulo})
        if enviar and user_ids:
            try:
                notify_all(user_ids, "fiscalizacao", titulo, body=corpo, link="#/fiscalizacao")
            except Exception:
                pass
        enviados[k] = now.isoformat()
        mudou = True

    colabs = cfg.get("colaboradores") or {}
    gids = gestores_ids(sb)

    # Leire: doc >48h e ticket locação >24h (dispara NO ATO de cruzar, via pulso)
    lc = colabs.get("leire") or {}
    sla = lc.get("sla_horas") or {}
    lids = user_ids_por_match(sb, lc.get("user_match") or "leire")
    for p in pendencias_abertas(eventos, "doc_aberto", "doc_resolvido", float(sla.get("doc", 48)), now):
        if p["estourado"]:
            fire(f"doc:{p['ref_id']}", lids + gids, "🔴 Doc travado há mais de 48h",
                 f"{p['rotulo']} está pendente há {p['horas']:.0f}h — destravar agora.")
    for p in pendencias_abertas(eventos, "ticket_locacao_aberto", "ticket_locacao_respondido",
                                float(sla.get("ticket_locacao", 24)), now):
        if p["estourado"]:
            fire(f"ticket:{p['ref_id']}", lids, "🔴 SLA de locação estourado (>24h)",
                 f"Ticket {p['rotulo']} sem resposta há {p['horas']:.0f}h.")

    if mudou:
        # poda entradas de dias anteriores pra não crescer infinito
        enviados = {k: v for k, v in enviados.items() if k.startswith(hoje)}
        _kv_set(sb, KV_ALERTAS, enviados)
    return disparos
