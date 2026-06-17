"""
GET /api/v3/crm/talentos — Base de Talentos AO VIVO do RD CRM. v77.63

Lê os deals que estão no funil "FUNIL DE PARCERIA – PAULO", etapa "BANCO DE
TALENTOS" direto do RD Station CRM (tempo real, cache curto 45s). Resolve
funil/etapa pelo NOME (live em /deal_pipelines, com fallback nas tabelas locais
rd_pipelines/rd_stages), então não depende de sync prévio.

Query:
  ?pipeline=parceria    (substring do nome do funil; default "parceria")
  ?stage=banco de talentos (substring do nome da etapa; default "talento")
  ?refresh=1            (ignora o cache)

lvl>=5.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, re, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

RD_BASE = "https://crm.rdstation.com/api/v1"
_cache = {}
CACHE_TTL = 45


# ───────────── RD helpers ─────────────
def _rd_pipelines_live(token):
    url = f"{RD_BASE}/deal_pipelines?token={urllib.parse.quote(token)}&limit=200"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/Talentos"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("deal_pipelines") or data.get("items") or []
    return []


def _rd_deals_by_stage(stage_id, token, limit=500):
    out, page = [], 1
    while True:
        p = {"token": token, "deal_stage_id": stage_id, "limit": 200, "page": page}
        url = f"{RD_BASE}/deals?{urllib.parse.urlencode(p)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/Talentos"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return {"error": f"RD HTTP {e.code}", "deals": out}
        except Exception as e:
            return {"error": str(e), "deals": out}
        deals = data.get("deals") or data.get("items") or []
        out.extend(deals)
        if len(deals) < 200 or len(out) >= limit or page >= 25:
            break
        page += 1
    return {"deals": out[:limit]}


def _contact_phone(d):
    for c in (d.get("contacts") or []):
        for ph in (c.get("phones") or []):
            dig = re.sub(r"\D", "", str(ph.get("phone") or ph.get("number") or ""))
            if dig:
                if len(dig) <= 11 and not dig.startswith("55"):
                    dig = "55" + dig
                return dig
    return None


def _contact_name(d):
    for c in (d.get("contacts") or []):
        if c.get("name"):
            return c["name"]
    return None


def _contact_email(d):
    for c in (d.get("contacts") or []):
        for em in (c.get("emails") or []):
            if em.get("email"):
                return em["email"]
    return None


def _iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _days_since(dt):
    if not dt:
        return None
    try:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return None


def _custom_fields(d):
    """Extrai campos personalizados do deal (RD: deal_custom_fields)."""
    out = {}
    for cf in (d.get("deal_custom_fields") or []):
        label = (cf.get("custom_field") or {}).get("label") or cf.get("label")
        val = cf.get("value")
        if label and val not in (None, "", []):
            out[label] = val if not isinstance(val, list) else ", ".join(str(v) for v in val)
    return out


def _slim(d):
    did = str(d.get("id"))
    user = d.get("user") or {}
    entrou = _iso(d.get("stage_entered_at")) or _iso(d.get("created_at"))
    return {
        "id": did,
        "name": d.get("name"),
        "contato": _contact_name(d),
        "phone": _contact_phone(d),
        "email": _contact_email(d),
        "owner": user.get("name") if isinstance(user, dict) else None,
        "owner_email": user.get("email") if isinstance(user, dict) else None,
        "created_at": d.get("created_at"),
        "stage_entered_at": d.get("stage_entered_at") or d.get("created_at"),
        "dias_na_etapa": _days_since(entrou),
        "campos": _custom_fields(d),
        "rd_url": f"https://crm.rdstation.com/app/deals/{did}",
    }


def _norm(s):
    return (s or "").strip().lower()


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _resolve(self, sb, token, want_pipe, want_stage):
        """Acha (pipeline, stage) por substring de nome — live primeiro, fallback local."""
        pipes_live = _rd_pipelines_live(token)
        all_pipes_names = []
        # 1) tenta ao vivo (cada pipeline traz suas deal_stages)
        for p in pipes_live:
            nm = _norm(p.get("name"))
            all_pipes_names.append(p.get("name"))
            if want_pipe in nm:
                stages = p.get("deal_stages") or p.get("stages") or []
                st = next((s for s in stages if want_stage in _norm(s.get("name"))), None)
                if st:
                    return ({"id": p.get("id"), "name": p.get("name")},
                            {"id": st.get("id"), "name": st.get("name")},
                            all_pipes_names, [s.get("name") for s in stages])
                # funil achado mas etapa não — devolve etapas pra diagnóstico
                return ({"id": p.get("id"), "name": p.get("name")}, None,
                        all_pipes_names, [s.get("name") for s in stages])
        # 2) fallback: tabelas locais
        try:
            lp = sb.table("rd_pipelines").select("*").execute().data or []
            ls = sb.table("rd_stages").select("*").execute().data or []
        except Exception:
            lp, ls = [], []
        for p in lp:
            if p.get("name") and p.get("name") not in all_pipes_names:
                all_pipes_names.append(p.get("name"))
            if want_pipe in _norm(p.get("name")):
                pid = p.get("id") or p.get("external_id")
                stages = [s for s in ls if str(s.get("pipeline_id") or s.get("rd_pipeline_id") or "") in (str(pid), str(p.get("external_id")))]
                st = next((s for s in stages if want_stage in _norm(s.get("name"))), None)
                if st:
                    return ({"id": pid, "name": p.get("name")},
                            {"id": st.get("id") or st.get("external_id"), "name": st.get("name")},
                            all_pipes_names, [s.get("name") for s in stages])
        return None, None, all_pipes_names, []

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        token = os.environ.get("RD_API_TOKEN")
        if not token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN não configurado"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        want_pipe = _norm(params.get("pipeline")) or "parceria"
        want_stage = _norm(params.get("stage")) or "talento"

        ck = f"{want_pipe}|{want_stage}"
        now = time.time()
        if params.get("refresh") != "1" and ck in _cache and (now - _cache[ck][0]) < CACHE_TTL:
            out = dict(_cache[ck][1]); out["cached"] = True
            return self._send(200, out)

        pipe, stage, pipes_disp, stages_disp = self._resolve(sb, token, want_pipe, want_stage)
        if not pipe:
            return self._send(404, {"ok": False, "error": f"Funil '{want_pipe}' não encontrado no RD.",
                                    "funis_disponiveis": pipes_disp})
        if not stage:
            return self._send(404, {"ok": False, "error": f"Etapa '{want_stage}' não encontrada no funil '{pipe['name']}'.",
                                    "funil": pipe["name"], "etapas_disponiveis": stages_disp})

        r = _rd_deals_by_stage(stage["id"], token)
        if r.get("error") and not r.get("deals"):
            return self._send(502, {"ok": False, "error": "RD: " + r["error"],
                                    "pipeline": pipe, "stage": stage})
        talentos = [_slim(d) for d in (r.get("deals") or [])]
        # mais recentes na etapa primeiro
        talentos.sort(key=lambda t: t.get("stage_entered_at") or "", reverse=True)

        payload = {
            "ok": True, "cached": False,
            "pipeline": pipe, "stage": stage,
            "count": len(talentos),
            "talentos": talentos,
            "error_parcial": r.get("error"),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        _cache[ck] = (now, payload)
        return self._send(200, payload)
