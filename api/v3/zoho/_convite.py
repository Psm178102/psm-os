"""
_convite.py — reenvia o convite de integração do Zoho a quem ainda não conectou. v89.16

Canais: sino do House + push no celular (notify_all) + WhatsApp (quem tem
users.whatsapp e o servidor tem Evolution). Pula inativo, conta de serviço e
os DISPENSADOS_ZOHO. Usado pelo botão em /integracoes (zoho/equipe POST) e
pela fila `shared_kv.zoho_convite_pendente`, que o sync_cron processa no
minuto seguinte — assim dá pra disparar sem estar logado como direção.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WA = os.path.join(os.path.dirname(_HERE), "wa")
for _p in (_HERE, _WA):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import _zoho_lib as z  # type: ignore

FILA = "zoho_convite_pendente"
ULTIMO = "zoho_convite_ultimo"

TITULO = "📅 Conecte seu Zoho ao House"
CORPO = ("Tudo o que você marca no Zoho (1:1, visitas, atendimentos, corujão, treinamentos) "
         "aparece sozinho na sua Agenda do House em cerca de 1 minuto — e o que marcarem pra "
         "você no House cai no seu Zoho na hora. Leva 1 minuto: House → Agenda → "
         "\"Conectar meu Zoho\" e autorize.")


def pendentes(sb):
    us = sb.table("users").select("id,name,status,is_service,whatsapp").limit(500).execute().data or []
    com = {str(c["user_id"]) for c in (sb.table("zoho_conexoes").select("user_id")
                                       .limit(500).execute().data or [])}
    return [u for u in us if (u.get("status") or "").lower() == "ativo"
            and not z.dispensado_zoho(u) and str(u["id"]) not in com]


def convidar(sb, notify_all, por=None):
    """Envia o convite. Devolve {enviados:[{id,nome,canais}], total}."""
    try:
        from _wa_lib import evolution_send, normalize_phone  # type: ignore
    except Exception:
        evolution_send = normalize_phone = None
    wa_ok = bool(os.environ.get("EVOLUTION_API_URL") and os.environ.get("EVOLUTION_API_KEY")
                 and os.environ.get("EVOLUTION_INSTANCE"))
    saida = []
    for u in pendentes(sb):
        canais = []
        primeiro = (u.get("name") or "").split(" ")[0] or "Oi"
        try:
            notify_all([u["id"]], "zoho_convite", TITULO, CORPO, link="#/agenda",
                       target_type="zoho", target_id=str(u["id"]))
            canais.append("sino+push")
        except Exception:
            canais.append("sino_falhou")
        if u.get("whatsapp") and evolution_send and wa_ok:
            try:
                num = normalize_phone(u["whatsapp"])
                r = evolution_send(num, f"{primeiro}, *{TITULO}*\n\n{CORPO}\n\nhttps://www.housepsm.com.br/v2/#/agenda") if num else {"ok": False}
                canais.append("whatsapp" if r.get("ok") else "whatsapp_falhou")
            except Exception:
                canais.append("whatsapp_falhou")
        saida.append({"id": u["id"], "nome": u.get("name"), "canais": canais})
    try:
        sb.table("shared_kv").upsert({"key": ULTIMO, "value": {"em": z.now_iso(), "por": por, "enviados": saida}},
                                     on_conflict="key").execute()
    except Exception:
        pass
    return {"enviados": saida, "total": len(saida)}


def processar_fila(sb, notify_all):
    """Chamado pelo sync_cron: se alguém enfileirou um convite, envia e limpa."""
    rows = sb.table("shared_kv").select("value").eq("key", FILA).limit(1).execute().data or []
    if not rows:
        return None
    sb.table("shared_kv").delete().eq("key", FILA).execute()   # apaga ANTES: nunca envia 2×
    return convidar(sb, notify_all, por=(rows[0].get("value") or {}).get("por"))
