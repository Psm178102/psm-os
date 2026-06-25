"""
GET /api/v3/maps/empreendimentos — pins do Google My Maps "MAPA Empreendimentos PSM". v81.67

Lê o link do My Maps salvo em shared_kv 'psm_links' (mapa_mymaps / mapa_earth),
extrai o `mid`, baixa o KML público do My Maps SERVER-SIDE (evita CORS no browser)
e devolve os Placemarks parseados (pins + formas) pra plotar no satélite Esri.
Cacheado em shared_kv 'maps_empreendimentos_cache' (~6h) pra não bater no Google a cada load.

Resposta: { ok, pins:[{nome,lat,lng}], shapes:[{nome,tipo,coords:[[lat,lng]...]}], count, mid, cached_em }
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

LINKS_KEY = "psm_links"
CACHE_KEY = "maps_empreendimentos_cache"
CACHE_TTL = 6 * 3600  # 6h


def _now():
    return datetime.now(timezone.utc)


def _kv_get(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        return json.loads(v) if isinstance(v, str) else v
    except Exception:
        return None


def _kv_set(sb, key, val):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": val, "updated_at": _now().isoformat()}, on_conflict="key").execute()
    except Exception:
        pass


def _extract_mid(*urls):
    for u in urls:
        m = re.search(r"[?&]mid=([^&\s]+)", u or "")
        if m:
            return m.group(1)
    return ""


def _ln(tag):  # local name (ignora namespace)
    return tag.split("}")[-1]


def _parse_coords(text):
    """'lng,lat,alt lng,lat,alt ...' → [[lat,lng], ...]"""
    out = []
    for tok in (text or "").replace("\n", " ").split():
        p = tok.split(",")
        if len(p) >= 2:
            try:
                out.append([float(p[1]), float(p[0])])  # [lat, lng]
            except Exception:
                pass
    return out


def _parse_kml(kml_text):
    pins, shapes = [], []
    try:
        root = ET.fromstring(kml_text)
    except Exception:
        return pins, shapes
    for pm in root.iter():
        if _ln(pm.tag) != "Placemark":
            continue
        nome = ""
        pt, line, poly = None, None, None
        for ch in pm.iter():
            t = _ln(ch.tag)
            if t == "name" and not nome:
                nome = (ch.text or "").strip()
            elif t == "Point":
                for c in ch.iter():
                    if _ln(c.tag) == "coordinates":
                        pt = c.text
            elif t == "LineString":
                for c in ch.iter():
                    if _ln(c.tag) == "coordinates":
                        line = c.text
            elif t == "Polygon":
                for c in ch.iter():
                    if _ln(c.tag) == "coordinates":
                        poly = poly or c.text  # 1ª = borda externa
        if pt:
            co = _parse_coords(pt)
            if co:
                pins.append({"nome": nome[:160], "lat": co[0][0], "lng": co[0][1]})
        elif poly:
            co = _parse_coords(poly)
            if len(co) >= 3:
                shapes.append({"nome": nome[:160], "tipo": "poly", "coords": co})
        elif line:
            co = _parse_coords(line)
            if len(co) >= 2:
                shapes.append({"nome": nome[:160], "tipo": "line", "coords": co})
    return pins, shapes


def _fetch_kml(mid):
    url = "https://www.google.com/maps/d/kml?forcekml=1&mid=" + mid
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (PSM-OS Mapa)"})
    with urllib.request.urlopen(req, timeout=18) as resp:
        return resp.read().decode("utf-8", "replace")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        force = "force=1" in (self.path or "")
        links = _kv_get(sb, LINKS_KEY) or {}
        mid = _extract_mid(links.get("mapa_mymaps"), links.get("mapa_earth"))
        if not mid:
            return self._send(200, {"ok": True, "pins": [], "shapes": [], "count": 0, "mid": "",
                                    "aviso": "Nenhum link do Google My Maps salvo (⚙️ My Maps no Mapa)."})

        # cache
        cache = _kv_get(sb, CACHE_KEY) or {}
        if not force and cache.get("mid") == mid and cache.get("fetched_at"):
            try:
                age = (_now() - datetime.fromisoformat(cache["fetched_at"])).total_seconds()
                if age < CACHE_TTL:
                    return self._send(200, {"ok": True, "pins": cache.get("pins", []), "shapes": cache.get("shapes", []),
                                            "count": len(cache.get("pins", [])), "mid": mid, "cached_em": cache["fetched_at"]})
            except Exception:
                pass

        try:
            kml = _fetch_kml(mid)
        except Exception as e:
            # cai pro cache antigo se houver
            if cache.get("pins"):
                return self._send(200, {"ok": True, "pins": cache["pins"], "shapes": cache.get("shapes", []),
                                        "count": len(cache["pins"]), "mid": mid, "cached_em": cache.get("fetched_at"),
                                        "aviso": "Usando cache (falha ao atualizar do Google: %s)" % str(e)[:80]})
            return self._send(502, {"ok": False, "error": "falha ao baixar o KML do Google My Maps: " + str(e)[:120]})

        pins, shapes = _parse_kml(kml)
        out = {"mid": mid, "pins": pins, "shapes": shapes, "fetched_at": _now().isoformat()}
        _kv_set(sb, CACHE_KEY, out)
        return self._send(200, {"ok": True, "pins": pins, "shapes": shapes, "count": len(pins),
                                "mid": mid, "cached_em": out["fetched_at"]})
