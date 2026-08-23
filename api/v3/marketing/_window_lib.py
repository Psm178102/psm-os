"""
_window_lib — janela de datas ÚNICA do módulo Marketing (v86.68).

Semântica IGUAL à da Meta Marketing API, calculada em BRT (UTC-3):
  today        = hoje
  yesterday    = ontem
  last_7d      = 7 dias fechados SEM hoje  (ontem-6 .. ontem)
  last_14d     = 14 dias SEM hoje
  last_30d     = 30 dias SEM hoje
  last_90d     = 90 dias SEM hoje
  this_month   = dia 1 .. hoje
  last_month   = mês anterior inteiro
  this_year    = 1/jan .. hoje
  last_year    = ano anterior inteiro
  year_YYYY    = ano YYYY (até hoje se for o corrente)
since/until explícitos (YYYY-MM-DD) têm prioridade sobre o preset.
Preset desconhecido levanta WindowError (o endpoint responde 400).
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import hoje_brt  # type: ignore

PRESETS = ("today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d",
           "this_month", "last_month", "this_year", "last_year")

_LAST_N = {"last_7d": 7, "last_14d": 14, "last_30d": 30, "last_90d": 90}


class WindowError(ValueError):
    pass


def window(params, default="last_30d"):
    """params: dict (query string já parseada, valores str). Retorna (since_date, until_date)."""
    since = (params.get("since") or "").strip()
    until = (params.get("until") or "").strip()
    if since and until:
        try:
            s, u = date.fromisoformat(since[:10]), date.fromisoformat(until[:10])
        except Exception:
            raise WindowError("since/until inválidos (use YYYY-MM-DD)")
        if s > u:
            raise WindowError("since > until")
        return s, u
    preset = (params.get("date_preset") or default or "last_30d").strip()
    return preset_window(preset)


def preset_window(preset, today=None):
    today = today or hoje_brt()
    if preset == "today":
        return today, today
    if preset == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if preset in _LAST_N:
        until = today - timedelta(days=1)          # SEM hoje (igual à Meta)
        return until - timedelta(days=_LAST_N[preset] - 1), until
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "last_month":
        last_prev = today.replace(day=1) - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if preset == "this_year":
        return today.replace(month=1, day=1), today
    if preset == "last_year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    if preset.startswith("year_"):
        try:
            yy = int(preset.split("_", 1)[1])
        except Exception:
            raise WindowError("preset inválido: %s" % preset)
        return date(yy, 1, 1), (today if yy == today.year else date(yy, 12, 31))
    raise WindowError("date_preset desconhecido: %s" % preset)
