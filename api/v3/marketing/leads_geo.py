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

# Cidade do lead não é capturada no RD → usamos o DDD do TELEFONE como proxy
# de região. DDD 17 = São José do Rio Preto e região (noroeste paulista).
PHONE_KEYS = ("phone", "telefone", "celular", "whatsapp", "fone", "mobile", "tel", "contato")
CAMP_KEYS = ("utm_campaign", "campaign", "campanha", "ad_name", "adset_name", "publico", "público", "audience")
RIO_PRETO_DDD = "17"
DDD_MAP = {
    "11": "São Paulo · Capital/RMSP", "12": "SP · Vale do Paraíba", "13": "SP · Baixada Santista",
    "14": "SP · Bauru/Marília", "15": "SP · Sorocaba", "16": "SP · Ribeirão Preto",
    "17": "São José do Rio Preto · Noroeste SP", "18": "SP · Pres. Prudente", "19": "SP · Campinas",
    "21": "RJ · Capital", "22": "RJ · Norte/Serra", "24": "RJ · Sul Fluminense",
    "27": "ES · Vitória", "28": "ES · Sul", "31": "MG · BH", "32": "MG · Juiz de Fora",
    "33": "MG · Vale do Aço", "34": "MG · Triângulo (Uberlândia)", "35": "MG · Sul de Minas",
    "37": "MG · Divinópolis", "38": "MG · Norte (Montes Claros)", "41": "PR · Curitiba",
    "42": "PR · Ponta Grossa", "43": "PR · Londrina", "44": "PR · Maringá", "45": "PR · Cascavel",
    "46": "PR · Sudoeste", "47": "SC · Joinville/Itajaí", "48": "SC · Florianópolis", "49": "SC · Oeste",
    "51": "RS · Porto Alegre", "53": "RS · Pelotas", "54": "RS · Caxias", "55": "RS · Santa Maria",
    "61": "DF · Brasília", "62": "GO · Goiânia", "63": "TO", "64": "GO · Sul", "65": "MT · Cuiabá",
    "66": "MT · Rondonópolis", "67": "MS · Campo Grande", "68": "AC", "69": "RO",
    "71": "BA · Salvador", "73": "BA · Itabuna", "74": "BA · Juazeiro", "75": "BA · Feira",
    "77": "BA · Oeste", "79": "SE · Aracaju", "81": "PE · Recife", "82": "AL · Maceió",
    "83": "PB · João Pessoa", "84": "RN · Natal", "85": "CE · Fortaleza", "86": "PI · Teresina",
    "87": "PE · Petrolina", "88": "CE · Interior", "89": "PI · Interior", "91": "PA · Belém",
    "92": "AM · Manaus", "93": "PA · Santarém", "94": "PA · Marabá", "95": "RR · Boa Vista",
    "96": "AP · Macapá", "97": "AM · Interior", "98": "MA · São Luís", "99": "MA · Interior",
}


def _strip(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def _ddd(phone):
    """Extrai o DDD (2 dígitos) de um telefone BR em qualquer formato."""
    d = re.sub(r"\D", "", phone or "")
    while d.startswith("0"):
        d = d[1:]
    if d.startswith("55") and len(d) >= 12:   # +55 + DDD + número
        d = d[2:]
    if len(d) >= 10:
        return d[:2]
    return None


def _ddd_label(ddd):
    if not ddd:
        return None
    return "DDD %s · %s" % (ddd, DDD_MAP.get(ddd, "Outra região"))


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

        # Regras de marca (config-driven, igual ao resto do sistema): pipeline → marca
        try:
            brules = [b for b in (sb.table("brand_rules").select("pattern,label,priority,is_default,active").execute().data or [])
                      if b.get("active", True)]
            brules.sort(key=lambda b: -(b.get("priority") or 0))
        except Exception:
            brules = []
        default_brand = next((b.get("label") for b in brules if b.get("is_default")), "Outros")

        def _brand(pipeline):
            p = _strip(pipeline)
            if not p:
                return default_brand
            for b in brules:
                pat = _strip(b.get("pattern"))
                if pat and pat in p:
                    return b.get("label") or default_brand
            return default_brand

        by_city = defaultdict(int)             # cidade_display -> leads
        city_is_rp = {}                        # cidade_display -> bool
        camp = defaultdict(lambda: {"leads": 0, "rio_preto": 0, "outras": 0})
        brand_agg = defaultdict(lambda: {"leads": 0, "rio_preto": 0, "outras": 0})
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
            phone = _scan(raw, PHONE_KEYS)
            ddd = _ddd(phone)
            campanha = _scan(raw, CAMP_KEYS) or (d.get("pipeline_name") or "Sem campanha")
            campanha = str(campanha)[:60]
            marca = _brand(d.get("pipeline_name"))

            if not ddd:
                sem_cidade += 1
                by_city["Sem telefone / DDD inválido"] += 1
                city_is_rp["Sem telefone / DDD inválido"] = False
                camp[campanha]["leads"] += 1
                brand_agg[marca]["leads"] += 1
                continue

            disp = _ddd_label(ddd)
            is_rp = (ddd == RIO_PRETO_DDD)
            by_city[disp] += 1
            city_is_rp[disp] = is_rp
            camp[campanha]["leads"] += 1
            brand_agg[marca]["leads"] += 1
            if is_rp:
                rio_preto += 1
                camp[campanha]["rio_preto"] += 1
                brand_agg[marca]["rio_preto"] += 1
            else:
                outras += 1
                camp[campanha]["outras"] += 1
                brand_agg[marca]["outras"] += 1

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

        # Por MARCA: distribuição Rio Preto × fora + alerta por marca
        brand_list = []
        for nome, v in brand_agg.items():
            com = v["rio_preto"] + v["outras"]
            pct_out = round(v["outras"] / com * 100, 1) if com else None
            brand_list.append({
                "marca": nome, "leads": v["leads"],
                "rio_preto": v["rio_preto"], "outras": v["outras"],
                "pct_outras": pct_out,
                "alerta": bool(pct_out is not None and pct_out > THRESHOLD and com >= MIN_LEADS_ALERT),
            })
        brand_list.sort(key=lambda x: -x["leads"])

        pct_outras_global = round(outras / com_cidade * 100, 1) if com_cidade else None

        return self._send(200, {
            "ok": True,
            "period": {"since": since_d.isoformat(), "until": until_d.isoformat()},
            "total": total, "com_cidade": com_cidade, "sem_cidade": sem_cidade,
            "rio_preto": rio_preto, "outras": outras, "pct_outras": pct_outras_global,
            "by_city": city_list,
            "by_campaign": camp_list,
            "by_brand": brand_list,
            "threshold_pct": THRESHOLD,
            "alerta_global": bool(pct_outras_global is not None and pct_outras_global > THRESHOLD),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
