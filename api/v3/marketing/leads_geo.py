"""
GET /api/v3/marketing/leads_geo?date_preset=last_30d[&since=&until=]
Header: Authorization: Bearer <token>   (Líder lvl>=5)

Leads por CIDADE (não-mapa) + alerta de % fora de São José do Rio Preto-SP
por campanha/público. Fonte: tabela `deals` (RD sincronizado) — a cidade e a
campanha do lead saem do `rd_raw` (varredura recursiva por nome de campo:
cidade/city/município/localidade · utm_campaign/campaign/ad/público). NUNCA
inventa: lead sem cidade vai pra "Não informado" (e o front mostra o % sem
cidade, pra ficar transparente quando o formulário não captura).

Resp: { ok, period, total, com_cidade, sem_cidade,
        rio_preto, outras, pct_outras,
        by_city:[{cidade, leads, pct, is_rio_preto}],
        by_campaign:[{campanha, leads, rio_preto, outras, pct_outras, alerta}],
        threshold_pct }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import re
import unicodedata
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore

THRESHOLD = 30.0      # alerta quando > 30% dos leads NÃO são de Rio Preto
MIN_LEADS_ALERT = 5   # só alerta campanha com pelo menos N leads (evita ruído)

CITY_KEYS = ("cidade", "city", "municipio", "município", "localidade", "town", "cidade_lead")
CAMP_KEYS = ("utm_campaign", "campaign", "campanha", "ad_name", "adset_name", "publico", "público", "audience")


def _strip(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def _is_rio_preto(cidade_norm):
    c = cidade_norm
    if not c:
        return False
    return ("rio preto" in c) or c in ("sjrp", "s j rio preto", "s.j. rio preto", "sjdrp")


def _scan(obj, keyset, depth=0):
    """Varre recursivamente um dict/list procurando o 1º valor string não-vazio
    cuja CHAVE casa (contém) algum termo de keyset. Retorna a string crua ou None."""
    if depth > 8 or obj is None:
        return None
    if isinstance(obj, dict):
        # 1ª passada: chave que casa exatamente/contém
        for k, v in obj.items():
            kl = _strip(k)
            if isinstance(v, str) and v.strip() and any(t in kl for t in keyset):
                return v.strip()
        # 2ª passada: desce na árvore
        for v in obj.values():
            r = _scan(v, keyset, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for it in obj:
            r = _scan(it, keyset, depth + 1)
            if r:
                return r
    return None


def _window(params):
    preset = params.get("date_preset") or ("" if (params.get("since") and params.get("until")) else "last_30d")
    since = params.get("since")
    until = params.get("until")
    today = datetime.now(timezone.utc).date()
    if since and until:
        try:
            return date.fromisoformat(since), date.fromisoformat(until)
        except Exception:
            pass
    days = {"last_7d": 7, "last_14d": 14, "last_30d": 30, "last_90d": 90, "this_month": today.day}.get(preset, 30)
    return today - timedelta(days=days - 1), today


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
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        since_d, until_d = _window(params)
        since_iso = since_d.isoformat() + "T00:00:00+00:00"
        until_iso = (until_d + timedelta(days=1)).isoformat() + "T00:00:00+00:00"

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # Leads = deals criados na janela (lead = entrada no funil)
        try:
            rows = (sb.table("deals").select("id,name,pipeline_name,rd_raw,created_at_rd")
                    .gte("created_at_rd", since_iso).lt("created_at_rd", until_iso)
                    .limit(5000).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"deals: {e}"})

        by_city = defaultdict(int)             # cidade_display -> leads
        city_is_rp = {}                        # cidade_display -> bool
        camp = defaultdict(lambda: {"leads": 0, "rio_preto": 0, "outras": 0})
        total = 0
        sem_cidade = 0
        rio_preto = 0
        outras = 0

        for d in rows:
            total += 1
            raw = d.get("rd_raw") or {}
            if isinstance(raw, str):
                try: raw = json.loads(raw)
                except Exception: raw = {}
            cidade_raw = _scan(raw, CITY_KEYS)
            campanha = _scan(raw, CAMP_KEYS) or (d.get("pipeline_name") or "Sem campanha")
            campanha = str(campanha)[:60]

            if not cidade_raw:
                sem_cidade += 1
                by_city["Não informado"] += 1
                city_is_rp["Não informado"] = False
                camp[campanha]["leads"] += 1
                continue

            cnorm = _strip(cidade_raw)
            disp = cidade_raw.strip().title()
            is_rp = _is_rio_preto(cnorm)
            by_city[disp] += 1
            city_is_rp[disp] = is_rp
            camp[campanha]["leads"] += 1
            if is_rp:
                rio_preto += 1
                camp[campanha]["rio_preto"] += 1
            else:
                outras += 1
                camp[campanha]["outras"] += 1

        com_cidade = total - sem_cidade
        # tabela por cidade (ordenada por volume)
        city_list = sorted(
            [{"cidade": c, "leads": n, "is_rio_preto": city_is_rp.get(c, False),
              "pct": round(n / total * 100, 1) if total else 0} for c, n in by_city.items()],
            key=lambda x: -x["leads"])

        # alerta por campanha: >30% fora de Rio Preto (entre os COM cidade da campanha)
        camp_list = []
        for nome, v in camp.items():
            com = v["rio_preto"] + v["outras"]
            pct_out = round(v["outras"] / com * 100, 1) if com else None
            camp_list.append({
                "campanha": nome, "leads": v["leads"],
                "rio_preto": v["rio_preto"], "outras": v["outras"],
                "pct_outras": pct_out,
                "alerta": bool(pct_out is not None and pct_out > THRESHOLD and com >= MIN_LEADS_ALERT),
            })
        camp_list.sort(key=lambda x: (-(x["pct_outras"] or -1), -x["leads"]))

        pct_outras_global = round(outras / com_cidade * 100, 1) if com_cidade else None

        return self._send(200, {
            "ok": True,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat()},
            "total": total, "com_cidade": com_cidade, "sem_cidade": sem_cidade,
            "rio_preto": rio_preto, "outras": outras, "pct_outras": pct_outras_global,
            "by_city": city_list,
            "by_campaign": camp_list,
            "threshold_pct": THRESHOLD,
            "alerta_global": bool(pct_outras_global is not None and pct_outras_global > THRESHOLD),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
