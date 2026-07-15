"""
_zoho_push.py — espelha um evento do House no Zoho NA HORA. v84.53

Chamado direto pelo agenda/upsert e agenda/delete: quem salva não espera cron.
Esta é a metade que É tempo real de verdade (House → Zoho). A volta
(Zoho → House) não pode ser: o Zoho Calendar não tem webhook, então ela vive
do sync-ao-abrir + cron curto.

Best-effort por princípio: se o Zoho estiver fora do ar, o evento JÁ está salvo
no House e o cron reconcilia depois. Nunca derruba o save do usuário.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ZOHO = os.path.join(os.path.dirname(_HERE), "zoho")
for _p in (_HERE, _ZOHO):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _lib():
    try:
        import _zoho_lib as z  # type: ignore
        return z
    except Exception:
        return None


def _conn_de(sb, z, user_id):
    if not (z and z.configured() and user_id):
        return None, None, None
    conn = z.get_conn(sb, user_id)
    if not conn:
        return None, None, None
    try:
        token, _ = z.access_token(conn)
    except Exception:
        return None, None, None
    cal = conn.get("calendar_uid")
    if not cal:
        try:
            cal, _ = z.default_calendar_uid(token)
            if cal:
                sb.table("zoho_conexoes").update({"calendar_uid": cal}).eq("user_id", str(user_id)).execute()
        except Exception:
            return None, None, None
    return conn, token, cal


def push_evento(sb, ev, user_id):
    """Cria/atualiza o evento no Zoho do usuário. Devolve dict pra gravar no
    House (zoho_uid/zoho_etag/zoho_hash) ou {} se não deu (não é erro fatal)."""
    z = _lib()
    if not z or (ev.get("origem") or "house") == "zoho" or not ev.get("data"):
        return {}
    conn, token, cal = _conn_de(sb, z, user_id)
    if not (token and cal):
        return {}
    try:
        ed = z.house_to_zoho_event(ev)
        if ev.get("zoho_uid"):
            etag = z.atualizar_evento(token, cal, ev["zoho_uid"], ed, ev.get("zoho_etag"))
            return {"zoho_etag": etag or ev.get("zoho_etag"), "zoho_hash": z.hash_evento(ev)}
        uid, etag = z.criar_evento(token, cal, ed)
        if not uid:
            return {}
        return {"zoho_uid": uid, "zoho_etag": etag, "zoho_hash": z.hash_evento(ev)}
    except Exception:
        return {}


def delete_evento(sb, ev, user_id):
    """Apaga o evento no Zoho. True se apagou."""
    z = _lib()
    if not z or not ev or not ev.get("zoho_uid"):
        return False
    _conn, token, cal = _conn_de(sb, z, user_id)
    if not (token and cal):
        return False
    try:
        z.excluir_evento(token, cal, ev["zoho_uid"], ev.get("zoho_etag"))
        return True
    except Exception:
        return False
