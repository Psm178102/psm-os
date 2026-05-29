"""
_meta_cache_lib.py — cache compartilhado de Meta Ads no Postgres (Sprint 9.12).

Por que existe: /api/meta-ads.js cacheia em memória POR instância Lambda
(efêmera, não compartilhada). Com vários logins simultâneos cada instância fria
re-bate na Graph API → rate-limit + lentidão. Aqui o cache vive no Postgres
(tabela meta_ads_cache), compartilhado entre TODOS os logins/instâncias, e é
pré-aquecido por cron. summary.py lê daqui primeiro e só cai pro live se velho.

Sem segredos: o token Meta continua só no /api/meta-ads (env do Vercel). Este
módulo nunca toca o token — só busca via HTTP a rota interna /api/meta-ads e
guarda/serve o JSON pronto.

Funções:
  build_cache_key(preset, since, until)
  fetch_live(host, preset, since, until, nocache=False) -> (payload, err)
  read_cache(sb, key, max_age_s) -> (payload, age_s, source) | (None, None, None)
  write_cache(sb, key, preset, since, until, payload, source)
"""
import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Presets que o dashboard (marketing.js PRESETS) realmente usa — o cron aquece
# exatamente estes pra não desperdiçar chamadas Meta.
WARM_PRESETS = ["today", "yesterday", "last_7d", "last_14d", "last_30d",
                "this_month", "last_month"]


def build_cache_key(preset, since, until):
    """Chave estável. summary.py manda preset OU since+until (nunca ambos)."""
    return "|".join([(preset or "").strip(), (since or "").strip(), (until or "").strip()])


def _parse_iso(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


def fetch_live(host, preset, since, until, nocache=False, timeout=30):
    """Bate na rota interna /api/meta-ads (Node) e devolve (payload_dict, err_str)."""
    qs_parts = []
    if since and until:
        qs_parts.append("since=" + urllib.parse.quote(since))
        qs_parts.append("until=" + urllib.parse.quote(until))
    elif preset:
        qs_parts.append("date_preset=" + urllib.parse.quote(preset))
    else:
        qs_parts.append("date_preset=last_30d")
    if nocache:
        qs_parts.append("nocache=1")
    url = "https://" + host + "/api/meta-ads?" + "&".join(qs_parts)
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "PSM-OS-v3/meta-cache",
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, "Meta API HTTP " + str(e.code)
    except Exception as e:
        return None, "meta-ads err: " + str(e)


def read_cache(sb, key, max_age_s):
    """Lê linha do cache. Retorna (payload, age_s, source) se fresca o bastante,
    senão (None, None, None). Nunca levanta."""
    if not sb:
        return None, None, None
    try:
        rows = (sb.table("meta_ads_cache")
                .select("payload,refreshed_at,source")
                .eq("cache_key", key).limit(1).execute().data or [])
    except Exception:
        return None, None, None
    if not rows:
        return None, None, None
    row = rows[0]
    refreshed = _parse_iso(row.get("refreshed_at"))
    if not refreshed:
        return None, None, None
    age = (datetime.now(timezone.utc) - refreshed).total_seconds()
    if age > max_age_s:
        return None, None, None
    return row.get("payload"), int(age), row.get("source")


def write_cache(sb, key, preset, since, until, payload, source):
    """Upsert da resposta pronta. Best-effort (nunca levanta)."""
    if not sb or not isinstance(payload, dict):
        return False
    try:
        sb.table("meta_ads_cache").upsert({
            "cache_key": key,
            "date_preset": preset or None,
            "since_date": since or None,
            "until_date": until or None,
            "payload": payload,
            "source": source,
            "fetched_at": payload.get("fetchedAt"),
            "refreshed_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="cache_key").execute()
        return True
    except Exception:
        return False
