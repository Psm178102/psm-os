"""
_espelho_agenda.py — tarefa da Diretoria COM PRAZO vira evento na Agenda. v84.53

Decisão do Paulo: só tarefa com prazo/data entra no calendário. Tarefa sem data
fica só na lista do House — agenda não é lixeira de item sem hora.

Como o evento espelho tem id DETERMINÍSTICO (evtk_<task_id>), o espelho é
idempotente: salvar a tarefa 10x não cria 10 eventos. E ao cair na tabela
`eventos`, ele herda de graça toda a esteira do Zoho (push na hora + cron).

Tirar o prazo da tarefa APAGA o evento (e, por tabela, o evento no Zoho).
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENDA = os.path.join(os.path.dirname(_HERE), "agenda")
for _p in (_HERE, _AGENDA):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _ev_id(task_id):
    return "evtk_" + str(task_id)[:40]


def _zoho():
    try:
        from _zoho_push import push_evento, delete_evento  # type: ignore
        return push_evento, delete_evento
    except Exception:
        return None, None


def espelhar(sb, task):
    """Cria/atualiza/apaga o evento espelho da tarefa. Best-effort: nunca
    derruba o save da tarefa. Devolve o id do evento, ou None."""
    try:
        tid = task.get("id")
        if not tid:
            return None
        eid = _ev_id(tid)
        prazo = task.get("prazo")
        dono = task.get("responsavel")
        push_evento, delete_evento = _zoho()

        # sem prazo (ou prazo removido) → o espelho não deve existir
        if not prazo:
            try:
                cur = sb.table("eventos").select("*").eq("id", eid).limit(1).execute().data or []
                if cur:
                    if delete_evento:
                        delete_evento(sb, cur[0], cur[0].get("owner_id") or dono)
                    sb.table("eventos").delete().eq("id", eid).execute()
            except Exception:
                pass
            return None

        row = {
            "id": eid,
            "tipo": "tarefa",
            "titulo": "✅ " + str(task.get("titulo") or "Tarefa")[:200],
            "descricao": task.get("observacoes") or None,
            "data": prazo,
            "hora_inicio": task.get("hora_inicio") or None,
            "hora_fim": task.get("hora_fim") or None,
            "all_day": not bool(task.get("hora_inicio")),
            "corretor_id": dono or None,
            "participantes": [dono] if dono else [],
            "status": "cancelado" if (task.get("status") or "") in ("cancelada",) else "confirmado",
            "criado_por": task.get("criado_por") or dono,
            "owner_id": dono or None,
            "origem": "tarefa",
        }
        try:
            existe = sb.table("eventos").select("id,zoho_uid,zoho_etag,zoho_hash").eq("id", eid) \
                .limit(1).execute().data or []
        except Exception:
            existe = []
        if existe:
            row = {**row, **{k: existe[0].get(k) for k in ("zoho_uid", "zoho_etag", "zoho_hash")
                             if existe[0].get(k)}}
            sb.table("eventos").update(row).eq("id", eid).execute()
        else:
            sb.table("eventos").insert(row).execute()

        # espelha no Zoho na hora (o cron reconcilia se falhar)
        if push_evento and dono:
            patch = push_evento(sb, row, dono)
            if patch:
                sb.table("eventos").update(patch).eq("id", eid).execute()
        return eid
    except Exception:
        return None


def apagar_espelho(sb, task_id, dono=None):
    """Tarefa excluída → evento espelho some (do House e do Zoho)."""
    try:
        eid = _ev_id(task_id)
        cur = sb.table("eventos").select("*").eq("id", eid).limit(1).execute().data or []
        if not cur:
            return False
        _push, delete_evento = _zoho()
        if delete_evento:
            delete_evento(sb, cur[0], cur[0].get("owner_id") or dono)
        sb.table("eventos").delete().eq("id", eid).execute()
        return True
    except Exception:
        return False
