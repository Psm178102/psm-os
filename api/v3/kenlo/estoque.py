"""
GET /api/v3/kenlo/estoque — ESTOQUE KENLO dentro do House (lê kenlo_imoveis). v84.11

Modos (query `modo`):
  lista (default)  → ?q=&transacao=venda|locacao&ordem=atualizado|preco|codigo&page=&pageSize=
                     devolve { ok, kpis, itens, total, ultima_sync }
                     kpis: total ativo, desatualizados 90d/180d, valor total de venda
  match            → ?deal_id=UUID  OU  ?q=texto livre
                     casa lead do CRM com o estoque: extrai tipo/dorms/bairro/verba do deal
                     e pontua os imóveis. Devolve { ok, criterios, itens[{...score, motivos}] }

Auth: JWT lvl>=2 (corretor pra cima). Dados vêm do Postgres (sync diário via
/api/v3/kenlo/sync) — sem bater na Kenlo a cada tela.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, unicodedata, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

COLS = ("id,property_code,titulo,endereco,bairro,cidade,uf,preco_venda,preco_locacao,"
        "tipo,finalidade,dorms,banheiros,suites,vagas,area_util,area_total,condominio,"
        "foto_capa,n_fotos,criado_kenlo,atualizado_kenlo,ativo,synced_at")

FAIXAS_VENDA = [(0, 300_000, "até 300 mil"), (300_000, 500_000, "300–500 mil"),
                (500_000, 1_000_000, "500 mil–1 mi"), (1_000_000, 2_000_000, "1–2 mi"),
                (2_000_000, float("inf"), "2 mi+")]

TIPOS = {
    "apartamento": ["apartamento", "apto", "apt", "ap "], "casa": ["casa", "sobrado"],
    "terreno": ["terreno", "lote"], "studio": ["studio", "stúdio", "kitnet", "loft"],
    "comercial": ["comercial", "sala", "loja", "galpao", "galpão", "barracao", "barracão"],
    "chacara": ["chacara", "chácara", "sitio", "sítio", "rancho", "fazenda"],
    "cobertura": ["cobertura", "duplex"], "condominio": ["condominio", "condomínio"],
}
STOP = {"de", "da", "do", "em", "no", "na", "com", "para", "pra", "por", "o", "a", "e",
        "um", "uma", "venda", "compra", "imovel", "imóvel", "lead", "cliente", "quer",
        "procura", "interesse", "ate", "até", "r$", "reais", "mil"}


def _flat(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _dias(ts):
    try:
        up = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - up).days
    except Exception:
        return None


def _texto_do_deal(sb, deal_id):
    """Texto de busca + verba a partir do deal do RD (name + campos do rd_raw)."""
    rows = sb.table("deals").select("id,name,amount,pipeline_name,stage_name,rd_raw") \
        .eq("id", deal_id).limit(1).execute().data or []
    if not rows:
        return None, None, None
    d = rows[0]
    raw = d.get("rd_raw") or {}
    if isinstance(raw, str):
        try: raw = json.loads(raw)
        except Exception: raw = {}
    partes = [d.get("name") or ""]
    for cf in (raw.get("deal_custom_fields") or []):
        v = cf.get("value")
        if isinstance(v, str) and len(v) < 200:
            partes.append(v)
        elif isinstance(v, list):
            partes.extend(str(x) for x in v if isinstance(x, str))
    for c in (raw.get("contacts") or []):
        if c.get("notes"):
            partes.append(str(c["notes"])[:200])
    verba = None
    try:
        a = float(d.get("amount") or 0)
        if a > 20000:
            verba = a
    except Exception:
        pass
    return " ".join(partes), verba, d.get("name")


def _criterios(texto, verba):
    t = _flat(texto)
    tipos = [k for k, kws in TIPOS.items() if any(kw in t for kw in kws)]
    m = re.search(r"(\d)\s*(dorm|quarto|dorms|quartos|suite|suíte)", t)
    dorms = int(m.group(1)) if m else None
    tokens = [w for w in re.findall(r"[a-z0-9]{3,}", t) if w not in STOP and not w.isdigit()]
    return {"tipos": tipos, "dorms": dorms, "verba": verba, "tokens": tokens[:25]}


def _score(im, cr):
    alvo = _flat((im.get("titulo") or "") + " " + (im.get("bairro") or "") + " " +
                 (im.get("cidade") or "") + " " + (im.get("endereco") or ""))
    pts, motivos = 0, []
    for tp in cr["tipos"]:
        if any(kw in alvo for kw in TIPOS[tp]):
            pts += 30; motivos.append(f"tipo {tp}")
            break
    if cr["dorms"]:
        if re.search(rf"{cr['dorms']}\s*(dorm|quarto)", alvo):
            pts += 20; motivos.append(f"{cr['dorms']} dorms")
    hits = [w for w in cr["tokens"] if len(w) >= 4 and w in alvo]
    if hits:
        pts += min(30, 6 * len(hits)); motivos.append("bate: " + ", ".join(hits[:4]))
    pv = im.get("preco_venda")
    if cr["verba"] and pv:
        try:
            pv = float(pv)
            if 0.5 * cr["verba"] <= pv <= 1.25 * cr["verba"]:
                pts += 25; motivos.append("na verba")
            elif pv <= 1.6 * cr["verba"]:
                pts += 10; motivos.append("perto da verba")
        except Exception:
            pass
    d = _dias(im.get("atualizado_kenlo"))
    if d is not None and d <= 90:
        pts += 5
    return pts, motivos


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        modo = (q.get("modo") or "lista").lower()

        # base: todos os ativos (319 hoje — cabe em memória tranquilo)
        try:
            itens = sb.table("kenlo_imoveis").select(COLS).eq("ativo", True) \
                .limit(3000).execute().data or []
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        for im in itens:
            im["dias_sem_atualizar"] = _dias(im.get("atualizado_kenlo"))
            im["dias_no_ar"] = _dias(im.get("criado_kenlo"))

        if modo == "match":
            deal_id = (q.get("deal_id") or "").strip()
            texto, verba, deal_nome = (q.get("q") or "").strip(), None, None
            if deal_id:
                texto, verba, deal_nome = _texto_do_deal(sb, deal_id)
                if texto is None:
                    return self._send(404, {"ok": False, "error": "deal não encontrado"})
            if not texto:
                return self._send(400, {"ok": False, "error": "deal_id ou q obrigatório"})
            cr = _criterios(texto, verba)
            ranq = []
            for im in itens:
                pts, motivos = _score(im, cr)
                if pts > 0:
                    ranq.append({**im, "score": pts, "motivos": motivos})
            ranq.sort(key=lambda x: -x["score"])
            return self._send(200, {"ok": True, "criterios": cr, "deal_nome": deal_nome,
                                    "itens": ranq[:15], "avaliados": len(itens)})

        if modo == "analise":
            venda = [i for i in itens if i.get("preco_venda")]
            loc = [i for i in itens if i.get("preco_locacao")]
            vgv = sum(float(i["preco_venda"]) for i in venda)

            def _agg(chave):
                out = {}
                for i in itens:
                    k = (i.get(chave) or "—")
                    a = out.setdefault(k, {"n": 0, "vgv": 0.0})
                    a["n"] += 1
                    a["vgv"] += float(i.get("preco_venda") or 0)
                return sorted(([k, v["n"], v["vgv"]] for k, v in out.items()), key=lambda x: -x[1])

            def _buckets(campo):
                b = {"0-30": 0, "31-90": 0, "91-180": 0, "180+": 0, "?": 0}
                for i in itens:
                    d = i.get(campo)
                    if d is None: b["?"] += 1
                    elif d <= 30: b["0-30"] += 1
                    elif d <= 90: b["31-90"] += 1
                    elif d <= 180: b["91-180"] += 1
                    else: b["180+"] += 1
                return b

            faixas = []
            for lo, hi, lbl in FAIXAS_VENDA:
                faixas.append([lbl, sum(1 for i in venda if lo <= float(i["preco_venda"]) < hi)])
            try:
                snaps = sb.table("kenlo_estoque_snapshots").select("dia,total,vgv_venda,aluguel_mensal") \
                    .order("dia", desc=False).limit(120).execute().data or []
            except Exception:
                snaps = []
            return self._send(200, {"ok": True, "analise": {
                "total": len(itens), "n_venda": len(venda), "n_locacao": len(loc),
                "vgv_venda": vgv, "ticket_medio": (vgv / len(venda)) if venda else 0,
                "aluguel_mensal": sum(float(i["preco_locacao"]) for i in loc),
                "sem_foto": sum(1 for i in itens if not i.get("n_fotos")),
                "media_fotos": (sum(i.get("n_fotos") or 0 for i in itens) / len(itens)) if itens else 0,
                "por_tipo": _agg("tipo")[:10], "por_bairro": _agg("bairro")[:12],
                "aging_atualizacao": _buckets("dias_sem_atualizar"),
                "aging_no_ar": _buckets("dias_no_ar"),
                "faixas_venda": faixas, "snapshots": snaps,
            }})

        # modo lista — facetas calculadas ANTES dos filtros (pra popular os selects)
        def _conta(chave):
            out = {}
            for i in itens:
                k = i.get(chave)
                if k: out[k] = out.get(k, 0) + 1
            return sorted(out.items(), key=lambda x: -x[1])
        facetas = {"tipos": _conta("tipo")[:15], "bairros": _conta("bairro")[:40]}

        busca = _flat(q.get("q") or "")
        transacao = (q.get("transacao") or "").lower()
        if busca:
            itens = [im for im in itens if busca in _flat(
                (im.get("titulo") or "") + " " + (im.get("property_code") or "") + " " +
                (im.get("bairro") or "") + " " + (im.get("cidade") or "") + " " + (im.get("endereco") or ""))]
        if transacao == "venda":
            itens = [im for im in itens if im.get("preco_venda")]
        elif transacao == "locacao":
            itens = [im for im in itens if im.get("preco_locacao")]
        tipo = _flat(q.get("tipo") or "")
        if tipo:
            itens = [im for im in itens if _flat(im.get("tipo")) == tipo]
        bairro = _flat(q.get("bairro") or "")
        if bairro:
            itens = [im for im in itens if _flat(im.get("bairro")) == bairro]
        try:
            dmin = int(q.get("dorms_min") or 0)
        except Exception:
            dmin = 0
        if dmin:
            itens = [im for im in itens if (im.get("dorms") or 0) >= dmin]

        def _preco(im):
            return float((im.get("preco_venda") if transacao != "locacao" else None)
                         or im.get("preco_locacao") or im.get("preco_venda") or 0)
        try:
            pmin = float(q.get("preco_min") or 0)
            pmax = float(q.get("preco_max") or 0)
        except Exception:
            pmin, pmax = 0, 0
        if pmin:
            itens = [im for im in itens if _preco(im) >= pmin]
        if pmax:
            itens = [im for im in itens if 0 < _preco(im) <= pmax]
        ordem = (q.get("ordem") or "atualizado").lower()
        if ordem == "preco":
            itens.sort(key=lambda x: -(float(x.get("preco_venda") or x.get("preco_locacao") or 0)))
        elif ordem == "codigo":
            itens.sort(key=lambda x: x.get("property_code") or "")
        else:  # mais parados primeiro (pauta de atualização)
            itens.sort(key=lambda x: -(x.get("dias_sem_atualizar") or 0))

        total = len(itens)
        kpis = {
            "total": total,
            "desat_90": sum(1 for i in itens if (i.get("dias_sem_atualizar") or 0) > 90),
            "desat_180": sum(1 for i in itens if (i.get("dias_sem_atualizar") or 0) > 180),
            "sem_foto": sum(1 for i in itens if not i.get("n_fotos")),
            "valor_venda": sum(float(i.get("preco_venda") or 0) for i in itens),
        }
        ultima = max((i.get("synced_at") or "" for i in itens), default=None)
        try:
            page = max(1, int(q.get("page") or 1)); ps = max(1, min(200, int(q.get("pageSize") or 60)))
        except Exception:
            page, ps = 1, 60
        return self._send(200, {"ok": True, "kpis": kpis, "total": total, "ultima_sync": ultima,
                                "facetas": facetas, "page": page,
                                "itens": itens[(page - 1) * ps: page * ps]})
