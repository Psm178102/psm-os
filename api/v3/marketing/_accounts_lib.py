# -*- coding: utf-8 -*-
"""
_accounts_lib — contas de anúncio Meta CONFIG-DRIVEN (v84.87).

As envs do Vercel (META_AD_ACCOUNT_IDS/LABELS/TOKENS) são o CHÃO; por cima entra
a camada editável em shared_kv.meta_ad_accounts (gerida na tela pelo sócio):
  { "excluidas": ["act_..."], "extras": [{"id":"act_...","label":"..."}] }
- excluída  → some de TODAS as consultas (ex: Kaue Bordini, sem permissão #200)
- extra     → conta nova adicionada SEM deploy; usa o token principal
              (META_ACCESS_TOKEN) — token NUNCA entra no banco.
Falhou a leitura do kv → devolve as envs intactas (nunca quebra o cockpit).
"""
import os

KV_ACCOUNTS = "meta_ad_accounts"


def _env_list(name):
    return [s.strip() for s in (os.environ.get(name, "") or "").split(",") if s.strip()]


def overrides(sb):
    """Lê a camada editável. {} se não existir/falhar."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_ACCOUNTS).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def resolver_contas(sb):
    """(ids, labels, tokens) já com excluídas removidas e extras anexadas."""
    ids = _env_list("META_AD_ACCOUNT_IDS")
    labels = _env_list("META_AD_ACCOUNT_LABELS")
    tokens = _env_list("META_AD_ACCOUNT_TOKENS")
    ovr = overrides(sb) if sb else {}
    excl = set(ovr.get("excluidas") or [])
    contas = [(i, (labels[n] if n < len(labels) else i), (tokens[n] if n < len(tokens) else ""))
              for n, i in enumerate(ids) if i not in excl]
    vistos = {c[0] for c in contas}
    for e in (ovr.get("extras") or []):
        eid = (e or {}).get("id")
        if eid and eid not in excl and eid not in vistos:
            contas.append((eid, e.get("label") or eid, ""))   # "" = token principal
            vistos.add(eid)
    return ([c[0] for c in contas], [c[1] for c in contas], [c[2] for c in contas])
