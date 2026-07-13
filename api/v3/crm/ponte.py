"""
GET/POST /api/v3/crm/ponte — FILA DA PONTE (fechamento próprio Paulo/Isa). v84.21

O gate de julho do Plano de Resgate (R$0,4–0,5M de VGV próprio em 30d) vira
esteira diária: os negócios ABERTOS das frentes MAP + Terceiros (a carteira
própria/1.200 quentes) ranqueados por VALOR × RECÊNCIA, servidos em lote.
Mesma mecânica da Fila de Reativação (1-a-1, estado no ato), outro objetivo:
lá a Leire QUALIFICA, aqui o sócio FECHA.

Fonte: deals win=null, frente map|terceiros (Central de Frentes), COM telefone.
Rank: amount desc (sem valor vai pro fim — e aparece marcado pra corrigir no RD),
      empate = atividade mais recente primeiro.
Estado: shared_kv 'ponte_estado' = { deal_id: {st, nota, ts, por} }
  st: contatado | proposta | negociando | fechou_rd | perdeu | futuro
GET  ?lote=10&view=fila|todos → { ok, fila, stats, total_base }
POST action=set_status {deal_id, st, nota?}
Auth: lvl>=7 (ferramenta da diretoria).
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of  # type: ignore

KV_STATE = "ponte_estado"
STATUS = ["contatado", "proposta", "negociando", "fechou_rd", "perdeu", "futuro"]
FRENTES_PONTE = ("map", "terceiros")


def _kv(sb, key, default):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else default
        return json.loads(v) if isinstance(v, str) else (v if isinstance(v, dict) else default)
    except Exception:
        return default


def _write_kv(sb, key, val):
    sb.table("shared_kv").upsert({"key": key, "value": val,
                                 "updated_at": datetime.now(timezone.utc).isoformat()},
                                on_conflict="key").execute()


def _phone(raw):
    """Primeiro telefone do rd_raw normalizado pra wa.me (55DDDNÚMERO)."""
    try:
        for c in (raw.get("contacts") or []):
            for p in (c.get("phones") or []):
                d = re.sub(r"\D", "", str(p.get("phone") or ""))
                if len(d) >= 10:
                    return d if d.startswith("55") else "55" + d
    except Exception:
        pass
    return None


def _contato(raw, fallback):
    try:
        for c in (raw.get("contacts") or []):
            if c.get("name"):
                return str(c["name"])[:60]
    except Exception:
        pass
    return (fallback or "?")[:60]


def _base(sb):
    """Deals abertos MAP+Terceiros paginados, já ranqueados pro fechamento."""
    rows, page = [], 0
    while True:
        chunk = sb.table("deals").select(
            "id,name,amount,win,pipeline_name,stage_name,updated_at_rd,created_at_rd,rd_raw") \
            .is_("win", "null").order("id").range(page * 1000, page * 1000 + 999).execute().data or []
        rows.extend(chunk)
        if len(chunk) < 1000 or page >= 15:
            break
        page += 1
    out = []
    for d in rows:
        if frente_of(d.get("pipeline_name")) not in FRENTES_PONTE:
            continue
        raw = d.get("rd_raw") or {}
        if isinstance(raw, str):
            try: raw = json.loads(raw)
            except Exception: raw = {}
        fone = _phone(raw)
        if not fone:
            continue  # sem telefone não entra na esteira 1-a-1
        try:
            amount = float(d.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        out.append({
            "deal_id": str(d.get("id")), "deal_nome": d.get("name"),
            "contato": _contato(raw, d.get("name")), "fone": fone,
            "valor": amount, "sem_valor": amount <= 0,
            "frente": frente_of(d.get("pipeline_name")),
            "estagio": d.get("stage_name"),
            "atividade": d.get("updated_at_rd") or d.get("created_at_rd"),
        })
    # valor desc (sem valor no fim), empate = atividade recente primeiro
    out.sort(key=lambda x: (-x["valor"], x["atividade"] or ""), reverse=False)
    out.sort(key=lambda x: -x["valor"])
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
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        try:
            lote = max(1, min(50, int(qs.get("lote") or 10)))
        except Exception:
            lote = 10
        view = (qs.get("view") or "fila").lower()
        base = _base(sb)
        estado = _kv(sb, KV_STATE, {})
        hoje = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        fila, stats = [], {"hoje": 0, "fechou_rd": 0, "negociando": 0, "proposta": 0}
        for it in base:
            st = estado.get(it["deal_id"]) or {}
            it["st"] = st.get("st")
            it["nota"] = st.get("nota")
            if st.get("ts", "").startswith(hoje):
                stats["hoje"] += 1
            if st.get("st") in stats:
                stats[st["st"]] = stats.get(st["st"], 0) + 1
            # fila do dia: não tratado hoje e não morto (perdeu/fechou saem; futuro volta depois)
            tratado_hoje = st.get("ts", "").startswith(hoje)
            if view == "todos":
                fila.append(it)
            elif st.get("st") not in ("perdeu", "fechou_rd", "futuro") and not tratado_hoje:
                fila.append(it)
        return self._send(200, {"ok": True, "fila": fila[:lote] if view == "fila" else fila,
                                "stats": stats, "total_base": len(base), "lote": lote})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        deal_id = str(body.get("deal_id") or "").strip()
        st = (body.get("st") or "").strip().lower()
        if not deal_id or st not in STATUS:
            return self._send(400, {"ok": False, "error": f"st inválido ({'/'.join(STATUS)})"})
        estado = _kv(sb, KV_STATE, {})
        estado[deal_id] = {"st": st, "nota": str(body.get("nota") or "")[:300],
                           "ts": datetime.now(timezone.utc).isoformat(),
                           "por": (actor.get("name") or actor.get("email") or "?")[:60]}
        if len(estado) > 4000:
            for k in sorted(estado, key=lambda k: estado[k].get("ts") or "")[:len(estado) - 4000]:
                estado.pop(k, None)
        try:
            _write_kv(sb, KV_STATE, estado)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "ponte.set_status", target_type="deal", target_id=deal_id, notes=st)
        return self._send(200, {"ok": True, "deal_id": deal_id, "st": st})
