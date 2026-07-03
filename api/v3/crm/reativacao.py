"""
GET/POST /api/v3/crm/reativacao — FILA DE REATIVAÇÃO MAP. v84.2

A base parada do CRM MAP (leads já pagos, sem ninguém trabalhando) vira uma fila
diária paced pra Mariane: contatar 1-a-1 (WhatsApp/ligação), qualificar e agendar
visita — o sócio fecha. Método fila (sem blast) = não toma bloqueio; quando a
360dialog entrar, o disparo pluga por cima.

Fonte dos leads: tabela deals (sync do RD) — frente 'map' (fonte única frente_of),
   em aberto (win null) e parado há N+ dias (updated_at_rd). rd_raw traz contato/fones.
Estado de trabalho: shared_kv 'reativacao_map' = { deal_id: {st, nota, ts, por} }
   st: novo(implícito) | contatado | respondeu | agendou | sem_interesse | futuro | nao_atendeu
Config: shared_kv 'reativacao_cfg' = { lote, dias_min, template }

GET  ?dias=90&lote=40&view=fila|todos  → { ok, fila, stats, cfg, total_base }
POST action:
  set_status { deal_id, st, nota? }        (Mariane pra cima: lvl>=2, gate pela matriz)
  set_cfg    { lote?, dias_min?, template? } (lvl>=7)
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of  # type: ignore

KV_STATE = "reativacao_map"
KV_CFG = "reativacao_cfg"
STATUS = ["contatado", "respondeu", "agendou", "sem_interesse", "futuro", "nao_atendeu"]
DEFAULT_CFG = {
    "lote": 40, "dias_min": 30,
    "template": ("Olá {nome}, tudo bem? Aqui é a Mariane, da PSM Imóveis 😊 "
                 "Você chegou a falar com a gente sobre imóveis um tempo atrás. "
                 "Estou revisando os atendimentos e queria saber: você ainda tem interesse "
                 "em comprar, ou posso atualizar seu cadastro?"),
}


def _kv(sb, key, default):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else default
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, type(default)) else default
    except Exception:
        return default


def _write_kv(sb, key, val):
    sb.table("shared_kv").upsert({"key": key, "value": val,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _phone(raw):
    """Primeiro telefone do rd_raw, normalizado pra wa.me (55DDDNÚMERO)."""
    try:
        for c in (raw.get("contacts") or []):
            for p in (c.get("phones") or []):
                dig = re.sub(r"\D", "", str(p.get("phone") or ""))
                if len(dig) >= 10:
                    if not dig.startswith("55"):
                        dig = "55" + dig
                    return dig
    except Exception:
        pass
    return None


def _contato_nome(raw, fallback):
    try:
        for c in (raw.get("contacts") or []):
            if c.get("name"):
                return str(c["name"])[:80]
    except Exception:
        pass
    return fallback


def _base_map(sb, dias_min):
    """Deals da frente MAP em aberto, parados há dias_min+. Pagina o Postgres."""
    now = datetime.now(timezone.utc)
    out = []
    pg = 0
    while pg < 30:
        rows = sb.table("deals") \
            .select("id,name,amount,win,pipeline_name,stage_name,updated_at_rd,created_at_rd,user_email,rd_raw") \
            .is_("win", "null") \
            .order("updated_at_rd", desc=False) \
            .range(pg * 500, pg * 500 + 499).execute().data or []
        for d in rows:
            if frente_of(d.get("pipeline_name")) != "map":
                continue
            try:
                up = datetime.fromisoformat(str(d.get("updated_at_rd") or d.get("created_at_rd")).replace("Z", "+00:00"))
                dias = (now - up).days
            except Exception:
                dias = None
            if dias is not None and dias < dias_min:
                continue
            raw = d.get("rd_raw") or {}
            if isinstance(raw, str):
                try: raw = json.loads(raw)
                except Exception: raw = {}
            out.append({
                "deal_id": d.get("id"), "nome": _contato_nome(raw, d.get("name") or "—"),
                "deal_nome": d.get("name"), "fone": _phone(raw),
                "etapa": d.get("stage_name"), "funil": d.get("pipeline_name"),
                "dias_parado": dias, "amount": d.get("amount"),
                "corretor": d.get("user_email"),
            })
        if len(rows) < 500:
            break
        pg += 1
    return out


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
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        cfg = {**DEFAULT_CFG, **_kv(sb, KV_CFG, {})}
        try: dias = int(qs.get("dias") or cfg.get("dias_min") or 30)
        except Exception: dias = 30
        try: lote = max(1, min(200, int(qs.get("lote") or cfg.get("lote") or 40)))
        except Exception: lote = 40
        view = (qs.get("view") or "fila").lower()

        base = _base_map(sb, dias)
        estado = _kv(sb, KV_STATE, {})
        stats = {"base": len(base), "novo": 0, "contatado": 0, "respondeu": 0, "agendou": 0,
                 "sem_interesse": 0, "futuro": 0, "nao_atendeu": 0}
        fila, trabalhados = [], []
        for it in base:
            st = (estado.get(str(it["deal_id"])) or {})
            s = st.get("st") or "novo"
            it["st"] = s; it["nota"] = st.get("nota"); it["st_ts"] = st.get("ts")
            stats[s] = stats.get(s, 0) + 1
            # fila do dia = ainda não trabalhados (novo) + não atendidos (retry), mais parados primeiro
            if s in ("novo", "nao_atendeu"):
                fila.append(it)
            else:
                trabalhados.append(it)
        fila.sort(key=lambda x: -(x.get("dias_parado") or 0))
        resp = {"ok": True, "cfg": {**cfg, "dias_min": dias, "lote": lote},
                "stats": stats, "total_base": len(base)}
        if view == "todos":
            resp["fila"] = fila
            resp["trabalhados"] = trabalhados[:400]
        else:
            resp["fila"] = fila[:lote]
            resp["trabalhados"] = [t for t in trabalhados if t["st"] in ("respondeu", "agendou")][:100]
        return self._send(200, resp)

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        action = (body.get("action") or "").strip()

        if action == "set_status":
            deal_id = str(body.get("deal_id") or "").strip()
            st = (body.get("st") or "").strip().lower()
            if not deal_id or st not in STATUS:
                return self._send(400, {"ok": False, "error": f"st inválido ({'/'.join(STATUS)})"})
            estado = _kv(sb, KV_STATE, {})
            estado[deal_id] = {"st": st, "nota": str(body.get("nota") or "")[:300],
                               "ts": datetime.now(timezone.utc).isoformat(),
                               "por": (actor.get("name") or actor.get("email") or "?")[:60]}
            # teto de segurança: mantém os 6000 mais recentes
            if len(estado) > 6000:
                keys = sorted(estado, key=lambda k: estado[k].get("ts") or "")[:len(estado) - 6000]
                for k in keys:
                    estado.pop(k, None)
            try:
                _write_kv(sb, KV_STATE, estado)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "reativacao.set_status", target_type="deal", target_id=deal_id, notes=st)
            return self._send(200, {"ok": True, "deal_id": deal_id, "st": st})

        if action == "set_cfg":
            try:
                require_user(self, min_lvl=7)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
            cfg = {**DEFAULT_CFG, **_kv(sb, KV_CFG, {})}
            if body.get("lote") not in (None, ""):
                try: cfg["lote"] = max(1, min(200, int(body["lote"])))
                except Exception: pass
            if body.get("dias_min") not in (None, ""):
                try: cfg["dias_min"] = max(0, min(3650, int(body["dias_min"])))
                except Exception: pass
            if isinstance(body.get("template"), str) and body["template"].strip():
                cfg["template"] = body["template"].strip()[:1000]
            try:
                _write_kv(sb, KV_CFG, cfg)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "reativacao.set_cfg", target_type="shared_kv", target_id=KV_CFG)
            return self._send(200, {"ok": True, "cfg": cfg})

        return self._send(400, {"ok": False, "error": "action desconhecida"})
