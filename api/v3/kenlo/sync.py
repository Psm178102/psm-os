"""
GET/POST /api/v3/kenlo/sync — SYNC do estoque Kenlo Imob → Postgres. v84.11

(Substitui o placeholder de maio: a chave real chegou via Kenlo Open em 03/07/2026.)
Pagina GET /v2/listings da Kenlo Open API (pageSize=100) e faz upsert na tabela
kenlo_imoveis (fonte única do estoque dentro do House). Anúncios que sumiram do
Kenlo viram ativo=false (não deleta — histórico). Roda via cron diário (8h UTC
= 5h BRT) ou botão "Sincronizar agora" no painel Estoque Kenlo.

Auth: Bearer CRON_SECRET OU JWT lvl>=5.
Resposta: { ok, total_kenlo, upserted, desativados, paginas }
"""
from http.server import BaseHTTPRequestHandler
import base64, json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

BASE = os.environ.get("KENLO_OPEN_BASE", "https://imob-api.kenlo-open.com").rstrip("/")


def _creds():
    key = os.environ.get("KENLO_OPEN_API_KEY", "").strip()
    uinfo = os.environ.get("KENLO_OPEN_USER_INFO", "").strip()
    return key, uinfo


def _agency_id(uinfo):
    try:
        pad = uinfo + "=" * (-len(uinfo) % 4)
        return str(json.loads(base64.b64decode(pad)).get("id_imob") or "")
    except Exception:
        return ""


def _fetch_page(key, uinfo, agency, page):
    qs = urllib.parse.urlencode({"agencyID": agency, "page": page, "pageSize": 100})
    req = urllib.request.Request(BASE + "/v2/listings?" + qs, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS/kenlo-sync",
        "x-api-key": key, "x-user-info": uinfo})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def _d(x):
    return x if isinstance(x, dict) else {}


def _num(x):
    # preços vêm como {"value": 2500000, "currency": "BRL"}; 0 = não informado
    if isinstance(x, dict):
        x = x.get("value")
    try:
        v = float(x)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _int(x):
    try:
        v = int(float(x))
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _finalidade(purpose):
    p = (purpose or "").upper()
    tem_v, tem_l = "SALE" in p, ("RENT" in p or "LEASE" in p)
    if tem_v and tem_l:
        return "venda_locacao"
    return "venda" if tem_v else ("locacao" if tem_l else None)


def _norm(l):
    # shape REAL do /v2/listings (difere do spec publicado): title/address no topo;
    # descricao/preços/datas dentro de details; media é dict {image,video,imageCondo}
    det = _d(l.get("details"))
    addr = _d(l.get("address"))
    pricing = _d(det.get("pricing"))
    area = _d(det.get("area"))
    garage = _d(det.get("garage"))
    media = _d(l.get("media"))
    fotos = [m for m in (media.get("image") or []) if isinstance(m, dict) and m.get("url")]
    capa = next((m["url"] for m in fotos if m.get("isPrimary")), fotos[0]["url"] if fotos else None)
    purpose = (l.get("purpose") or "").upper()
    pretensao = _num(det.get("pretension"))
    preco_venda = _num(pricing.get("salePrice")) or (pretensao if "SALE" in purpose else None)
    preco_loc = _num(pricing.get("rentPrice")) or (pretensao if "RENT" in purpose else None)
    vagas = next((_int(garage.get(k)) for k in ("spaces", "value", "total", "quantity")
                  if _int(garage.get(k))), None)
    return {
        "id": str(l.get("id")),
        "property_code": l.get("propertyCode"),
        "titulo": (l.get("title") or "")[:400],
        "descricao": (det.get("description") or "")[:2000],
        "endereco": (addr.get("unparsedAddress") or "")[:300],
        "bairro": addr.get("neighborhood"),
        "cidade": addr.get("city"),
        "uf": addr.get("stateOrProvince"),
        "preco_venda": preco_venda,
        "preco_locacao": preco_loc,
        "tipo": ((det.get("propertyType") or "").strip().lower() or None),
        "finalidade": _finalidade(purpose),
        "dorms": _int(det.get("bedrooms")),
        "banheiros": _int(det.get("bathrooms")),
        "suites": _int(det.get("suites")),
        "vagas": vagas,
        "area_util": _num(area.get("valueUsable")),
        "area_total": _num(area.get("valueTotal")),
        "condominio": _num(pricing.get("condoPrice")),
        "foto_capa": capa,
        "n_fotos": len(fotos),
        "criado_kenlo": det.get("createAt"),
        "atualizado_kenlo": det.get("updateAt"),
        "ativo": True,
        "raw": l,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        return self._run()

    def do_POST(self):
        return self._run()

    def _run(self):
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):
            try:
                require_user(self, min_lvl=5)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        key, uinfo = _creds()
        if not key or not uinfo:
            return self._send(503, {"ok": False, "error": "KENLO_OPEN_API_KEY/KENLO_OPEN_USER_INFO ausentes"})
        agency = _agency_id(uinfo)
        if not agency:
            return self._send(503, {"ok": False, "error": "agencyID não decodificável do user-info"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        vistos, upserted, page, total, pages, slim = set(), 0, 1, 0, 1, []
        try:
            while page <= min(pages, 30):
                d = _fetch_page(key, uinfo, agency, page)
                pag = d.get("pagination") or {}
                total = pag.get("total") or pag.get("totalItems") or pag.get("totalCount") or total
                pages = pag.get("totalPages") or 1
                rows = [_norm(l) for l in (d.get("data") or []) if l.get("id")]
                for r in rows:
                    vistos.add(r["id"])
                    slim.append({k: r.get(k) for k in
                                 ("preco_venda", "preco_locacao", "tipo", "n_fotos", "atualizado_kenlo")})
                if rows:
                    sb.table("kenlo_imoveis").upsert(rows, on_conflict="id").execute()
                    upserted += len(rows)
                page += 1
        except urllib.error.HTTPError as e:
            try: msg = e.read().decode("utf-8")[:200]
            except Exception: msg = str(e)[:200]
            return self._send(502, {"ok": False, "error": f"kenlo {e.code}: {msg}", "upserted": upserted})
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200], "upserted": upserted})

        # anúncios que saíram do ar no Kenlo → ativo=false
        desativados = 0
        try:
            atuais = sb.table("kenlo_imoveis").select("id").eq("ativo", True).limit(5000).execute().data or []
            sumidos = [r["id"] for r in atuais if r["id"] not in vistos]
            for i in range(0, len(sumidos), 100):
                sb.table("kenlo_imoveis").update({"ativo": False}).in_("id", sumidos[i:i + 100]).execute()
            desativados = len(sumidos)
        except Exception:
            pass
        # snapshot do dia (série histórica pro painel de Análises — VGV ao longo do tempo)
        try:
            agora = datetime.now(timezone.utc)
            def _dias(ts):
                try:
                    return (agora - datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).days
                except Exception:
                    return None
            por_tipo = {}
            for r in slim:
                t = r.get("tipo") or "outro"
                pt = por_tipo.setdefault(t, {"n": 0, "vgv": 0.0})
                pt["n"] += 1
                pt["vgv"] += float(r.get("preco_venda") or 0)
            dias = [_dias(r.get("atualizado_kenlo")) for r in slim]
            sb.table("kenlo_estoque_snapshots").upsert({
                "dia": agora.date().isoformat(),
                "total": len(slim),
                "vgv_venda": sum(float(r.get("preco_venda") or 0) for r in slim),
                "aluguel_mensal": sum(float(r.get("preco_locacao") or 0) for r in slim),
                "sem_foto": sum(1 for r in slim if not r.get("n_fotos")),
                "d90": sum(1 for d in dias if d is not None and d > 90),
                "d180": sum(1 for d in dias if d is not None and d > 180),
                "por_tipo": por_tipo,
            }, on_conflict="dia").execute()
        except Exception:
            pass  # snapshot é bônus — nunca derruba o sync
        return self._send(200, {"ok": True, "total_kenlo": total, "upserted": upserted,
                                "desativados": desativados, "paginas": pages})
