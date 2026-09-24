# -*- coding: utf-8 -*-
"""Gravação enxuta do espelho do RD (v88.40).

Antes: todo sync (cron de 30 min, auto-sync das telas, sync manual) regravava TODOS os negócios
que leu — ~2.200 a cada 30 min, mesmo sem mudança — com o rd_raw inteiro e synced_at=agora.
Cada regravação mudava a "versão dos dados" e invalidava o cache de todas as telas, que
recalculavam do zero. Em 24/09 isso esgotou CPU e disco do banco (Nano) e derrubou o House.

Agora cada negócio carrega raw_hash = impressão digital do que veio do RD (+ funil e dono
resolvidos). O sync lê só (id, raw_hash) dos negócios da página e grava apenas os que mudaram
ou são novos. A hora do último sync bem-sucedido fica em shared_kv "rd_sync_ultimo" — é ela
que as telas mostram ("dados de HH:MM") e que o auto-sync e os alarmes usam para frescor.
"""
import hashlib
import json
from datetime import datetime, timezone

KV_ULTIMO = "rd_sync_ultimo"


def raw_hash(row):
    base = {"raw": row.get("rd_raw"), "pid": row.get("pipeline_id"), "pname": row.get("pipeline_name"),
            "uid": row.get("user_id")}
    return hashlib.md5(json.dumps(base, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


def gravar(sb, rows):
    """Upsert só dos negócios novos/alterados. Devolve quantos gravou (levanta erro do upsert)."""
    if not rows:
        return 0
    for r in rows:
        r["raw_hash"] = raw_hash(r)
    atuais = {}
    ids = [str(r["id"]) for r in rows if r.get("id")]
    for i in range(0, len(ids), 200):
        try:
            for x in sb.table("deals").select("id,raw_hash").in_("id", ids[i:i + 200]).execute().data or []:
                atuais[str(x["id"])] = x.get("raw_hash")
        except Exception as e:
            # sem a comparação, grava tudo (comportamento antigo) — nunca perde dado
            print(f"[rdsync] leitura de hash falhou, gravando o lote inteiro: {e}")
            atuais = {}
            break
    mudou = [r for r in rows if atuais.get(str(r["id"])) != r["raw_hash"]]
    for i in range(0, len(mudou), 200):
        sb.table("deals").upsert(mudou[i:i + 200], on_conflict="id").execute()
    return len(mudou)


def marcar_sync(sb, fonte, lidos, gravados):
    """Registra o sync bem-sucedido (frescor), mesmo quando nada mudou."""
    agora = datetime.now(timezone.utc).isoformat()
    try:
        sb.table("shared_kv").upsert({"key": KV_ULTIMO, "value": {"ts": agora, "fonte": fonte, "lidos": lidos, "gravados": gravados},
                                      "updated_at": agora}, on_conflict="key").execute()
    except Exception as e:
        print(f"[rdsync] marcar_sync: {e}")
    return agora
