"""
GET/POST /api/v3/crm/sdr — Prospecção SDR (funil CARTEIRA MAP do RD CRM)

Fluxo da Leire: carteira total fica em ATIVO → ela chama 1 a 1 no WhatsApp →
move pra SDR → se tem imóvel vai pra CAPTAR IMÓVEL (cria captação automática) →
se não tem vai pra 90 DIAS (parado 3 meses). No SDR, quem não responde precisa
de follow-up.

GET (lvl>=2):
  ?pipeline_id=  (opcional; default = auto-detecta pipeline "CARTEIRA MAP")
  ?owner_email=  (opcional; filtra dono dos deals — ex. a Leire)
  ?mine=1        (filtra meus deals)
  ?dias=2        (limite p/ marcar follow-up no SDR; default 2)
  ?ativo_limit=60 (quantos puxar da fila ATIVO, ordenados do mais antigo)
  ?deal_id=X     (modo detalhe: retorna telefone/contato de 1 deal)

POST (lvl>=2):
  { action:"move", deal_id, to:"ativo|sdr|captar|noventa" }  -> move no RD
       to=captar -> cria captação automática + notifica responsável
  { action:"followup", deal_id, deal_name?, kind?, note? } -> registra toque
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time, re, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, notify_all  # type: ignore

RD_BASE = "https://crm.rdstation.com/api/v1"
_cache = {}            # key -> (ts, payload)
CACHE_TTL = 45


# ───────────────────────── RD helpers ─────────────────────────
def _rd_deals_by_stage(stage_id, token, limit=300, order=None, direction=None):
    """Lista deals de uma etapa específica (paginado, com teto)."""
    out = []
    page = 1
    while True:
        p = {"token": token, "deal_stage_id": stage_id, "limit": 200, "page": page}
        if order: p["order"] = order
        if direction: p["direction"] = direction
        url = f"{RD_BASE}/deals?{urllib.parse.urlencode(p)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/SDR"})
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


def _rd_get_deal(deal_id, token):
    url = f"{RD_BASE}/deals/{urllib.parse.quote(str(deal_id))}?token={urllib.parse.quote(token)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/SDR"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}


def _rd_move(deal_id, stage_id, token):
    """PUT no RD movendo o deal pra outra etapa."""
    url = f"{RD_BASE}/deals/{urllib.parse.quote(str(deal_id))}?token={urllib.parse.quote(token)}"
    body = json.dumps({"deal": {"deal_stage_id": stage_id}}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT",
                                 headers={"Accept": "application/json", "Content-Type": "application/json",
                                          "User-Agent": "PSM-OS-v3/SDR"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return {"ok": True, "deal": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        try: detail = e.read().decode("utf-8")[:300]
        except Exception: detail = ""
        return {"ok": False, "error": f"RD HTTP {e.code} {detail}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _rd_pipelines_live(token):
    """Pipelines do RD AO VIVO, cada um com suas deal_stages embutidas.
    Usado quando a tabela rd_stages local está vazia pro funil (ex.: CARTEIRA MAP
    PAULO nunca teve as etapas sincronizadas) → resolve as etapas direto da fonte."""
    url = f"{RD_BASE}/deal_pipelines?token={urllib.parse.quote(token)}&limit=200"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS-v3/SDR"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []
    return data.get("deal_pipelines") or data.get("items") or (data if isinstance(data, list) else [])


# ───────────────────────── parsing ─────────────────────────
def _stage_key(name):
    n = (name or "").lower()
    if "captar" in n or "captaç" in n or "captac" in n: return "captar"
    if "90" in n or "noventa" in n: return "noventa"
    if re.search(r"\bsdr\b", n) or "sdr" in n: return "sdr"
    if "ativo" in n or "carteira" in n: return "ativo"
    return "outros"


def _contact_phone(d):
    """Extrai 1º telefone do contato do deal (E.164 só dígitos)."""
    for c in (d.get("contacts") or []):
        for ph in (c.get("phones") or []):
            raw = ph.get("phone") or ph.get("number") or ""
            dig = re.sub(r"\D", "", str(raw))
            if dig:
                if len(dig) <= 11 and not dig.startswith("55"):
                    dig = "55" + dig
                return dig
    return None


def _contact_name(d):
    for c in (d.get("contacts") or []):
        if c.get("name"): return c["name"]
    return None


def _contact_email(d):
    for c in (d.get("contacts") or []):
        for em in (c.get("emails") or []):
            if em.get("email"): return em["email"]
    return None


def _iso(s):
    if not s: return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _days_since(dt):
    if not dt: return None
    try:
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return None


def _slim(d, touch_map, dias_fup):
    """Reduz um deal RD ao essencial pra UI."""
    did = str(d.get("id"))
    last_rd = _iso(d.get("last_activity_at")) or _iso(d.get("updated_at"))
    last_touch = touch_map.get(did)  # datetime do nosso último toque
    eff = last_rd
    if last_touch and (eff is None or last_touch > eff):
        eff = last_touch
    idle = _days_since(eff)
    user = d.get("user") or {}
    return {
        "id": did,
        "name": d.get("name"),
        "contato": _contact_name(d),
        "phone": _contact_phone(d),
        "email": _contact_email(d),
        "amount": float(d.get("amount_total") or d.get("amount_unique") or 0),
        "owner": user.get("name") if isinstance(user, dict) else None,
        "owner_email": (user.get("email") if isinstance(user, dict) else None),
        "created_at": d.get("created_at"),
        "last_activity_at": d.get("last_activity_at") or d.get("updated_at"),
        "last_touch_at": last_touch.isoformat() if last_touch else None,
        "dias_parado": idle,
        "needs_followup": bool(idle is not None and idle >= dias_fup),
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

    # ── pipeline/stage resolution ──
    def _resolve_pipeline(self, sb, want_id, token=None):
        """Retorna (pipeline_dict, stages_por_key, lista_carteiras)."""
        try:
            pipes = sb.table("rd_pipelines").select("*").execute().data or []
            stages = sb.table("rd_stages").select("*").execute().data or []
        except Exception:
            return None, {}, []
        carteiras = [p for p in pipes if "carteira" in (p.get("name") or "").lower()]
        chosen = None
        if want_id:
            chosen = next((p for p in pipes if str(p.get("id")) == str(want_id) or str(p.get("external_id")) == str(want_id)), None)
        if not chosen:
            # prefere nome == "CARTEIRA MAP", senão 1ª carteira
            chosen = next((p for p in carteiras if (p.get("name") or "").strip().lower() == "carteira map"), None) \
                     or (carteiras[0] if carteiras else None)
        if not chosen:
            return None, {}, carteiras
        pid = chosen.get("id") or chosen.get("external_id")
        st = [s for s in stages if str(s.get("pipeline_id") or s.get("rd_pipeline_id") or "") in (str(pid), str(chosen.get("external_id")))]
        try: st.sort(key=lambda s: int(s.get("position") or s.get("order") or 0))
        except Exception: pass
        by_key = {}
        for s in st:
            k = _stage_key(s.get("name"))
            if k not in by_key:  # 1ª ocorrência por key
                by_key[k] = {"id": s.get("id") or s.get("external_id"), "name": s.get("name")}
        # Fallback AO VIVO: se a tabela local não resolveu as etapas-chave desse funil
        # (ex.: CARTEIRA MAP PAULO sem stages sincronizadas → tudo vazio), busca no RD.
        faltam = [k for k in ("ativo", "sdr", "captar", "noventa") if not by_key.get(k, {}).get("id")]
        if token and faltam:
          try:
            for p in _rd_pipelines_live(token):
                if str(p.get("id")) != str(pid):
                    continue
                live = p.get("deal_stages") or p.get("stages") or []
                def _ord(s):
                    try: return int(s.get("order") or s.get("position") or 0)
                    except Exception: return 0
                live.sort(key=_ord)
                for s in live:
                    k = _stage_key(s.get("name"))
                    if k not in by_key:
                        by_key[k] = {"id": s.get("id"), "name": s.get("name")}
                break
          except Exception:
            pass
        return chosen, by_key, carteiras

    def _touch_map(self, sb, dias_window=120):
        """deal_id -> datetime do último toque (follow-up nosso)."""
        out = {}
        try:
            rows = sb.table("sdr_touchpoints").select("deal_id,created_at").order("created_at", desc=True).limit(3000).execute().data or []
            for r in rows:
                did = str(r.get("deal_id"))
                if did in out: continue
                dt = _iso(r.get("created_at"))
                if dt: out[did] = dt
        except Exception:
            pass
        return out

    def do_GET(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        token = os.environ.get("RD_API_TOKEN")
        if not token: return self._send(503, {"ok": False, "error": "RD_API_TOKEN não configurado"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))

        # Modo detalhe (telefone on-demand)
        if params.get("deal_id"):
            d = _rd_get_deal(params["deal_id"], token)
            if d.get("error"): return self._send(502, {"ok": False, "error": "RD: " + d["error"]})
            return self._send(200, {"ok": True, "deal": {
                "id": str(d.get("id")), "name": d.get("name"),
                "contato": _contact_name(d), "phone": _contact_phone(d), "email": _contact_email(d),
            }})

        try: dias_fup = max(1, int(params.get("dias") or 2))
        except Exception: dias_fup = 2
        try: ativo_limit = max(0, min(200, int(params.get("ativo_limit") or 60)))
        except Exception: ativo_limit = 60
        owner = (params.get("owner_email") or "").lower().strip()
        if params.get("mine") == "1":
            owner = (actor.get("email") or "").lower().strip()

        pipe, stages_by_key, carteiras = self._resolve_pipeline(sb, params.get("pipeline_id"), token)
        if not pipe:
            return self._send(404, {"ok": False, "error": "Pipeline CARTEIRA MAP não encontrado. Rode o sync de funis do RD primeiro.",
                                    "carteiras": [{"id": c.get("id"), "name": c.get("name")} for c in carteiras]})
        pid = pipe.get("id") or pipe.get("external_id")

        cache_key = f"{pid}|{owner}|{dias_fup}|{ativo_limit}"
        now = time.time()
        if cache_key in _cache and (now - _cache[cache_key][0]) < CACHE_TTL:
            out = dict(_cache[cache_key][1]); out["cached"] = True
            return self._send(200, out)

        try:
            touch_map = self._touch_map(sb)

            cols = {}
            errors = []
            plan = [("sdr", 300, None, None), ("captar", 100, None, None),
                    ("noventa", 300, None, None), ("ativo", ativo_limit, "created_at", "asc")]
            for key, lim, order, direction in plan:
                st = stages_by_key.get(key)
                if not st or not st.get("id") or lim == 0:
                    cols[key] = {"name": st.get("name") if st else key, "stage_id": st.get("id") if st else None, "deals": []}
                    continue
                r = _rd_deals_by_stage(st["id"], token, limit=lim, order=order, direction=direction)
                if r.get("error"): errors.append(f"{key}: {r['error']}")
                deals = r.get("deals") or []
                if owner:
                    deals = [d for d in deals if ((d.get("user") or {}).get("email") or "").lower() == owner]
                slim = [_slim(d, touch_map, dias_fup) for d in deals]
                cols[key] = {"name": st["name"], "stage_id": st["id"], "deals": slim}

            # ordena SDR: follow-ups primeiro (mais parados no topo)
            cols.get("sdr", {}).get("deals", []).sort(key=lambda x: (not x.get("needs_followup"), -(x.get("dias_parado") or 0)))
            followup_count = sum(1 for d in cols.get("sdr", {}).get("deals", []) if d.get("needs_followup"))
        except Exception as e:
            import traceback
            return self._send(200, {"ok": False, "error": "SDR falhou ao montar colunas: " + str(e)[:160],
                                    "trace": traceback.format_exc()[-500:],
                                    "pipeline": {"id": pid, "name": pipe.get("name")},
                                    "columns": {}, "carteiras": [{"id": c.get("id"), "name": c.get("name")} for c in carteiras]})

        payload = {
            "ok": True, "cached": False,
            "pipeline": {"id": pid, "name": pipe.get("name")},
            "carteiras": [{"id": c.get("id"), "name": c.get("name")} for c in carteiras],
            "dias_followup": dias_fup,
            "columns": cols,
            "followup_count": followup_count,
            "errors": errors or None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        _cache[cache_key] = (now, payload)
        return self._send(200, payload)

    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        token = os.environ.get("RD_API_TOKEN")
        if not token: return self._send(503, {"ok": False, "error": "RD_API_TOKEN não configurado"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = body.get("action") or "move"
        deal_id = body.get("deal_id")
        if not deal_id: return self._send(400, {"ok": False, "error": "deal_id obrigatório"})

        # ── registrar follow-up / toque ──
        if action == "followup":
            kind = body.get("kind") or "followup"
            try:
                sb.table("sdr_touchpoints").insert({
                    "deal_id": str(deal_id), "pipeline_id": body.get("pipeline_id"),
                    "deal_name": body.get("deal_name"), "action": kind,
                    "note": (body.get("note") or "").strip() or None, "by_user": actor.get("id"),
                }).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "sdr.followup", target_type="rd_deal", target_id=str(deal_id),
                  notes=f"{kind} · {body.get('deal_name') or ''}")
            _cache.clear()
            return self._send(200, {"ok": True})

        # ── mover etapa no RD ──
        if action == "move":
            to = body.get("to")
            stage_id = body.get("stage_id")
            pipe, stages_by_key, _ = self._resolve_pipeline(sb, body.get("pipeline_id"), token)
            if not stage_id and to:
                st = stages_by_key.get(to)
                stage_id = st.get("id") if st else None
            if not stage_id:
                return self._send(400, {"ok": False, "error": "etapa destino não resolvida (to/stage_id)"})

            mv = _rd_move(deal_id, stage_id, token)
            if not mv.get("ok"):
                return self._send(502, {"ok": False, "error": mv.get("error")})

            deal = mv.get("deal") or {}
            audit(self, actor, "sdr.move", target_type="rd_deal", target_id=str(deal_id),
                  notes=f"→ {to or stage_id} · {deal.get('name') or body.get('deal_name') or ''}")

            # registra toque correspondente
            try:
                kind = {"captar": "tem_imovel", "noventa": "nao_tem", "sdr": "chamei"}.get(to, "move")
                sb.table("sdr_touchpoints").insert({
                    "deal_id": str(deal_id), "pipeline_id": pipe.get("id") if pipe else None,
                    "deal_name": deal.get("name") or body.get("deal_name"), "action": kind,
                    "by_user": actor.get("id"),
                }).execute()
            except Exception as e:
                print(f"[sdr] touchpoint insert falhou (deal {deal_id}): {e}")

            captacao_id = None
            # ── tem imóvel → cria captação automática ──
            if to == "captar":
                captacao_id = self._criar_captacao(sb, actor, deal, body, str(deal_id))

            _cache.clear()
            return self._send(200, {"ok": True, "captacao_id": captacao_id})

        return self._send(400, {"ok": False, "error": "ação inválida"})

    def _criar_captacao(self, sb, actor, deal, body, deal_id):
        """Cria 1 captação a partir do lead (dedup por rd_deal_id). Notifica."""
        try:
            # dedup
            ex = sb.table("captacoes").select("id").eq("rd_deal_id", deal_id).limit(1).execute().data or []
            if ex:
                return ex[0]["id"]
        except Exception:
            pass
        nome = _contact_name(deal) or body.get("contato") or deal.get("name") or "Proprietário"
        phone = _contact_phone(deal) or body.get("phone")
        email = _contact_email(deal) or body.get("email")
        cid = f"cap_{int(datetime.now().timestamp()*1000)}"
        row = {
            "id": cid,
            "objetivo": "venda",
            "status": "a_fazer",
            "proprietario": nome,
            "contato": phone,
            "email": email,
            "rd_deal_id": deal_id,
            "observacao": f"Origem: prospecção SDR (CARTEIRA MAP) · deal RD {deal_id}",
            "precisa_avaliacao": True,
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            sb.table("captacoes").upsert(row).execute()
        except Exception as e:
            print(f"[sdr] falha criar captação: {e}")
            return None
        audit(self, actor, "captacao.upsert", target_type="captacoes", target_id=cid,
              notes=f"auto via SDR · {nome}")
        # notifica gestão + marketing (precisa avaliação/colher dados)
        try:
            rows = sb.table("users").select("id,name,role").execute().data or []
            ids = [r["id"] for r in rows if (r.get("role") in ("socio", "diretor", "gerente", "backoffice"))
                   or "leire" in (r.get("name") or "").lower()]
            ids = [i for i in ids if i and i != actor.get("id")]
            if ids:
                notify_all(ids, "captacao", "🎯 Nova captação da prospecção SDR",
                           f"{nome} — falou que tem imóvel pra vender/alugar",
                           link="#/captacoes", target_type="captacoes", target_id=cid)
        except Exception:
            pass
        return cid
