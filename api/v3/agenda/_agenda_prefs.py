"""
_agenda_prefs.py — preferências de lembrete da Agenda & Tarefas, POR USUÁRIO. v87.81

shared_kv key 'agenda_prefs::<user_id>' = {
    lembrete_evento_min: 30,   # compromisso com horário: avisa X min antes (-1 = nunca)
    lembrete_tarefa_min: 15,   # tarefa com horário: avisa X min antes (-1 = nunca)
    resumo_diario: true,       # push das 8h com o dia (alertas/cron_push)
    ics_token: "..."           # link secreto de assinatura (Google/iPhone/Outlook)
}
O item pode sobrescrever o padrão com a coluna lembrete_min (eventos/dir_tasks).

Mesmo padrão de chave por usuário dos chats (agent_chat::<agent>::<uid>): é config
leve de UI/notificação, não dado de negócio com volume.
"""
import json
from datetime import datetime, timezone

DEFAULTS = {"lembrete_evento_min": 30, "lembrete_tarefa_min": 15, "resumo_diario": True,
            "meu_dia_whatsapp": False}   # v87.93: ☀️ Meu dia também no WhatsApp (a pessoa liga)
OPCOES_MIN = (-1, 0, 5, 10, 15, 30, 60, 120, 1440)
PREFIXO = "agenda_prefs::"


def chave(uid):
    return PREFIXO + str(uid)


def _val(v):
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = {}
    return v if isinstance(v, dict) else {}


def ler(sb, uid):
    """Prefs do usuário já com os defaults aplicados (inclui ics_token se houver)."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", chave(uid)).limit(1).execute().data or []
        v = _val(rows[0].get("value")) if rows else {}
    except Exception:
        v = {}
    return {**DEFAULTS, **v}


def ler_todos(sb):
    """{uid: prefs} de quem já salvou alguma preferência (os demais = DEFAULTS)."""
    out = {}
    try:
        rows = sb.table("shared_kv").select("key,value").like("key", PREFIXO + "%").limit(1000).execute().data or []
        for r in rows:
            uid = str(r.get("key") or "")[len(PREFIXO):]
            if uid:
                out[uid] = {**DEFAULTS, **_val(r.get("value"))}
    except Exception:
        pass
    return out


def gravar(sb, uid, prefs):
    atual = ler(sb, uid)
    novo = {**atual, **prefs}
    sb.table("shared_kv").upsert({"key": chave(uid), "value": novo,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()
    return novo


def minutos(v, padrao):
    """Normaliza um valor de lembrete: None → padrão; inválido → padrão."""
    if v is None or v == "":
        return padrao
    try:
        n = int(v)
    except Exception:
        return padrao
    return n if -1 <= n <= 10080 else padrao
