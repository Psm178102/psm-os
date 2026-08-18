# -*- coding: utf-8 -*-
"""
CRM House PSM — piloto F2 (kanban nativo). v86.52
=================================================

O coração do CRM próprio: o corretor opera AQUI e o RD vira espelho.

GET  /api/v3/crm/house?pipeline_id=<id>
  Board completo: funis (rd_pipelines) + colunas (etapas) + deals ABERTOS do
  ESPELHO local (`deals`), agrupados por etapa e escopados por papel:
    lvl>=7 tudo · líder (5/6) o time · corretor só os próprios (email).

POST /api/v3/crm/house  {action:"move", deal_id, to_stage_id}
  Mover card = evento NATIVO em deal_stage_events (source='house') + update do
  espelho local + push da mudança pro RD (paridade durante a transição). Se o
  push falhar, o local fica movido e o próximo sync/webhook reverte (paridade
  manda enquanto o RD for o primário) — a UI avisa. Tudo auditado.

Colunas do kanban: preferimos as etapas AO VIVO do RD (1 GET com cache 5min —
ordem exata, inclui etapa vazia); sem RD_API_TOKEN caímos pro espelho
(rd_stages + etapas observadas nos deals). O fork p/ house_stages acontece no
corte (F3/F4) — no piloto usamos a MESMA base dos eventos pra não divergir.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import time
import traceback
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore
from _events_lib import stage_position_map, _upsert_ignore  # type: ignore

RD_BASE = "https://crm.rdstation.com/api/v1"
PIPE_TTL = 300  # cache das etapas ao vivo (5 min)
_pipes_cache = {"ts": 0.0, "data": None}

DEAL_COLS = ("id,name,amount,win,stage_id,stage_name,pipeline_id,pipeline_name,"
             "user_email,updated_at_rd,created_at_rd,contacts:rd_raw->contacts")
MAX_DEALS = 800   # teto de deals abertos carregados por funil


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ─── Etapas: RD ao vivo (preferido) ou espelho ──────────────────────────────
def _pipelines_live(token):
    """Funis + etapas AO VIVO do RD, com cache. None se indisponível."""
    now = time.time()
    if _pipes_cache["data"] is not None and (now - _pipes_cache["ts"]) < PIPE_TTL:
        return _pipes_cache["data"]
    if not token:
        return None
    url = f"{RD_BASE}/deal_pipelines?token={urllib.parse.quote(token)}&limit=200"
    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                              "User-Agent": "PSM-OS-v3/CRM-House"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[crm-house] pipelines_live falhou: {e}")
        return _pipes_cache["data"]  # melhor stale que nada
    pls = data.get("deal_pipelines") or (data if isinstance(data, list) else [])
    out = []
    for p in pls:
        if not isinstance(p, dict):
            continue
        stages = []
        for s in (p.get("deal_stages") or p.get("stages") or []):
            if isinstance(s, dict) and s.get("id") is not None:
                stages.append({"id": str(s.get("id")), "name": s.get("name") or "?",
                               "position": s.get("order") if s.get("order") is not None else s.get("position")})
        out.append({"id": str(p.get("id")), "name": p.get("name") or "?", "stages": stages})
    _pipes_cache["data"] = out
    _pipes_cache["ts"] = now
    return out


def _stages_from_mirror(sb, pipeline_id, deals):
    """Fallback sem RD: etapas do espelho (rd_stages defensivo + observadas nos deals)."""
    seen = {}
    try:
        for s in (sb.table("rd_stages").select("*").execute().data or []):
            sid = s.get("id") or s.get("external_id") or s.get("stage_id")
            pid = s.get("pipeline_id") or s.get("deal_pipeline_id") or s.get("pipeline")
            if sid is None:
                continue
            if pid is not None and str(pid) != str(pipeline_id):
                continue
            pos = s.get("position") if s.get("position") is not None else s.get("order")
            seen[str(sid)] = {"id": str(sid), "name": s.get("name") or "?", "position": pos}
    except Exception as e:
        print(f"[crm-house] rd_stages fallback: {e}")
    pos_map = stage_position_map(sb)
    for d in deals:
        sid = d.get("stage_id")
        if sid is not None and str(sid) not in seen:
            seen[str(sid)] = {"id": str(sid), "name": d.get("stage_name") or "?",
                              "position": pos_map.get(str(sid))}

    def _pos(s):
        try:
            return (False, int(s["position"]), str(s["name"] or ""))
        except (TypeError, ValueError):
            return (True, 0, str(s["name"] or ""))
    return sorted(seen.values(), key=_pos)


# ─── Escopo por papel (mesma régua do crm/deals.py) ────────────────────────
def _scope(sb, user):
    """Retorna (emails_permitidos|None, label). None = vê tudo."""
    lvl = user.get("lvl") or 0
    if lvl >= 7:
        return None, "global"
    role = (user.get("role") or "").lower()
    if lvl >= 5 or role == "lider":
        team = (user.get("team") or "").lower()
        if not team:
            return set(), "team_empty"
        try:
            rows = sb.table("users").select("email").eq("team", team).execute().data or []
            return {(u.get("email") or "").lower() for u in rows if u.get("email")}, "team"
        except Exception:
            return set(), "team_err"
    my = (user.get("email") or "").lower()
    return ({my} if my else set()), "self"


def _phone(contacts):
    """1º telefone dos contacts do rd_raw, só dígitos. None se não há."""
    try:
        for c in (contacts or []):
            for p in (c.get("phones") or []):
                d = re.sub(r"\D", "", str(p.get("phone") or ""))
                if len(d) >= 10:
                    return d
    except Exception:
        pass
    return None


def _rd_move(deal_id, stage_id, token):
    """PUT no RD movendo o deal de etapa (paridade). Retorna (ok, err)."""
    url = f"{RD_BASE}/deals/{urllib.parse.quote(str(deal_id))}?token={urllib.parse.quote(token)}"
    body = json.dumps({"deal": {"deal_stage_id": stage_id}}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT",
                                 headers={"Content-Type": "application/json",
                                          "Accept": "application/json",
                                          "User-Agent": "PSM-OS-v3/CRM-House"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        return True, None
    except urllib.error.HTTPError as e:
        return False, f"RD HTTP {e.code}"
    except Exception as e:
        return False, str(e)


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    # ── BOARD ──────────────────────────────────────────────────────────────
    def do_GET(self):
        # Blindagem: exceção NUNCA vira FUNCTION_INVOCATION_FAILED mudo —
        # devolve JSON com o traceback (superfície interna autenticada).
        try:
            return self._board()
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        except Exception:
            tb = traceback.format_exc()
            print(f"[crm-house] GET crash: {tb}")
            return self._send(500, {"ok": False, "error": "crash no board", "tb": tb})

    def _board(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "supabase indisponível"})

        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        want_pid = (qs.get("pipeline_id") or [None])[0]

        token = os.environ.get("RD_API_TOKEN")
        live = _pipelines_live(token)

        # lista de funis: ao vivo > espelho rd_pipelines
        if live:
            pipelines = [{"id": p["id"], "name": p["name"]} for p in live]
        else:
            try:
                rows = sb.table("rd_pipelines").select("*").execute().data or []
                pipelines = [{"id": str(r.get("id") or r.get("external_id")), "name": r.get("name") or "?"}
                             for r in rows if (r.get("active") is not False)]
            except Exception:
                pipelines = []
        if not pipelines:
            return self._send(200, {"ok": True, "pipelines": [], "stages": [], "cols": {},
                                    "meta": {"scope": None, "aviso": "nenhum funil encontrado"}})

        # funil escolhido: pedido > MAP (piloto) > primeiro
        pid = None
        if want_pid and any(p["id"] == str(want_pid) for p in pipelines):
            pid = str(want_pid)
        if not pid:
            map_p = next((p for p in pipelines if "map" in (p["name"] or "").lower()), None)
            pid = (map_p or pipelines[0])["id"]

        # deals abertos do funil, do ESPELHO
        try:
            deals = (sb.table("deals").select(DEAL_COLS)
                     .eq("pipeline_id", pid).is_("win", "null")
                     .order("updated_at_rd", desc=True)
                     .limit(MAX_DEALS).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"espelho deals: {e}"})

        emails, scope = _scope(sb, user)
        if emails is not None:
            deals = [d for d in deals if (d.get("user_email") or "").lower() in emails]

        # colunas
        live_p = next((p for p in (live or []) if p["id"] == pid), None)
        if live_p and live_p["stages"]:
            stages = live_p["stages"]
        else:
            stages = _stages_from_mirror(sb, pid, deals)

        cols = {s["id"]: [] for s in stages}
        soltos = []  # deals cuja etapa não está nas colunas (etapa apagada etc.)
        for d in deals:
            card = {
                "id": str(d.get("id")),
                "name": d.get("name"),
                "amount": d.get("amount"),
                "stage_id": str(d.get("stage_id")) if d.get("stage_id") is not None else None,
                "user_email": d.get("user_email"),
                "updated_at": d.get("updated_at_rd"),
                "created_at": d.get("created_at_rd"),
                "phone": _phone(d.get("contacts")),
            }
            if card["stage_id"] in cols:
                cols[card["stage_id"]].append(card)
            else:
                soltos.append(card)

        return self._send(200, {
            "ok": True,
            "pipelines": pipelines,
            "pipeline_id": pid,
            "stages": stages,
            "cols": cols,
            "soltos": soltos,
            "meta": {"scope": scope, "total": len(deals),
                     "stages_src": "rd_live" if (live_p and live_p["stages"]) else "espelho",
                     "gerado_em": _now_iso()},
        })

    # ── MOVE ───────────────────────────────────────────────────────────────
    def do_POST(self):
        try:
            return self._move()
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        except Exception:
            tb = traceback.format_exc()
            print(f"[crm-house] POST crash: {tb}")
            return self._send(500, {"ok": False, "error": "crash no move", "tb": tb})

    def _move(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "supabase indisponível"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "body inválido"})

        action = body.get("action") or "move"
        if action != "move":
            return self._send(400, {"ok": False, "error": f"ação desconhecida: {action}"})

        deal_id = body.get("deal_id")
        to_stage = body.get("to_stage_id")
        if not deal_id or not to_stage:
            return self._send(400, {"ok": False, "error": "deal_id e to_stage_id obrigatórios"})
        deal_id, to_stage = str(deal_id), str(to_stage)

        try:
            rows = (sb.table("deals")
                    .select("id,name,amount,win,stage_id,stage_name,pipeline_id,pipeline_name,user_email")
                    .eq("id", deal_id).limit(1).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"espelho deals: {e}"})
        if not rows:
            return self._send(404, {"ok": False, "error": "deal não encontrado no espelho"})
        deal = rows[0]

        # escopo: corretor só move o que é dele; líder só do time
        emails, scope = _scope(sb, user)
        if emails is not None and (deal.get("user_email") or "").lower() not in emails:
            return self._send(403, {"ok": False, "error": "esse deal não está no seu escopo"})

        if str(deal.get("stage_id")) == to_stage:
            return self._send(200, {"ok": True, "moved": False, "aviso": "já está nessa etapa"})

        # resolve etapa destino (nome/posição) e valida o funil
        token = os.environ.get("RD_API_TOKEN")
        live = _pipelines_live(token)
        to_name, to_pos = body.get("to_stage_name"), None
        pid = str(deal.get("pipeline_id")) if deal.get("pipeline_id") is not None else None
        live_p = next((p for p in (live or []) if p["id"] == pid), None)
        if live_p:
            st = next((s for s in live_p["stages"] if s["id"] == to_stage), None)
            if not st:
                return self._send(400, {"ok": False, "error": "etapa destino não pertence ao funil desse deal"})
            to_name, to_pos = st["name"], st.get("position")
        if to_pos is None:
            to_pos = stage_position_map(sb).get(to_stage)

        # 1) evento NATIVO (event sourcing — nunca depende do RD)
        ev = {
            "deal_id": deal_id,
            "pipeline_id": pid,
            "pipeline_name": deal.get("pipeline_name"),
            "stage_id": to_stage,
            "stage_name": to_name,
            "stage_position": to_pos,
            "win": deal.get("win"),
            "amount": float(deal.get("amount") or 0),
            "user_email": (deal.get("user_email") or "").lower() or None,
            "occurred_at": _now_iso(),
            "source": "house",
            "raw": None,
        }
        _upsert_ignore(sb, [ev])

        # 2) espelho local acompanha na hora (a UI já mostra certo)
        before = {"stage_id": deal.get("stage_id"), "stage_name": deal.get("stage_name")}
        try:
            sb.table("deals").update({"stage_id": to_stage, "stage_name": to_name}) \
                .eq("id", deal_id).execute()
        except Exception as e:
            print(f"[crm-house] update espelho falhou: {e}")

        # 3) paridade: empurra pro RD enquanto ele for o primário
        rd_ok, rd_err = (False, "RD_API_TOKEN ausente")
        if token:
            rd_ok, rd_err = _rd_move(deal_id, to_stage, token)

        audit(self, user, "crm_house.move", target_type="deal", target_id=deal_id,
              before=before, after={"stage_id": to_stage, "stage_name": to_name},
              notes=f"rd_sync={'ok' if rd_ok else rd_err} scope={scope}")

        return self._send(200, {"ok": True, "moved": True, "rd_sync": rd_ok,
                                "rd_err": None if rd_ok else rd_err,
                                "stage": {"id": to_stage, "name": to_name}})
