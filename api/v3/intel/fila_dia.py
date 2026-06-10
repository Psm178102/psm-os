"""GET /api/v3/intel/fila_dia[?n=10&email=]
FILA DE AÇÃO DIÁRIA do corretor — o Cérebro de Vendas vira tarefa.

Pega os negócios ABERTOS do corretor logado, pontua com o MESMO motor do
Cérebro (score_open: prior por etapa × winrate real do canal × recência ×
engajamento) e devolve os N mais quentes com a próxima ação sugerida e o
TELEFONE do cliente (de deals.rd_raw) pra abrir o WhatsApp em 1 clique.

Permissão: lvl>=0 vê a PRÓPRIA fila; lvl>=5 pode passar ?email= de outro.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client  # type: ignore
from _brain_lib import channel_winrates, score_open  # type: ignore

_COLS = ("id,amount,win,closed_at,created_at_rd,updated_at_rd,"
         "stage_name,user_id,user_email,rd_raw,pipeline_id,stage_id")


def _normalize_phone(raw):
    dig = re.sub(r"\D", "", str(raw or ""))
    if not dig:
        return None
    if len(dig) <= 11 and not dig.startswith("55"):
        dig = "55" + dig
    return dig


def _phone_from_rd(rd_raw):
    if not isinstance(rd_raw, dict):
        return None
    for c in (rd_raw.get("contacts") or []):
        for ph in (c.get("phones") or []):
            p = _normalize_phone(ph.get("phone") or ph.get("number"))
            if p:
                return p
    return None


def _fetch(sb, q_builder):
    out, page, size = [], 0, 1000
    while page < 30:
        try:
            rows = q_builder().range(page * size, page * size + size - 1).execute().data or []
        except Exception:
            break
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        n = max(1, min(30, int(q.get("n") or 10)))
        email = (actor.get("email") or "").lower()
        if (actor.get("lvl") or 0) >= 5 and q.get("email"):
            email = q["email"].strip().lower()
        if not email:
            return self._send(200, {"ok": True, "fila": [], "total_abertos": 0,
                                    "aviso": "usuário sem e-mail cadastrado — sem vínculo com o RD"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # abertos do corretor (filtro server-side → leve)
        opens = _fetch(sb, lambda: sb.table("deals").select(_COLS)
                       .is_("win", "null").eq("user_email", email))
        # fechados 120d (global) p/ calibrar winrate por canal — mesma base do Cérebro
        since = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
        closed = _fetch(sb, lambda: sb.table("deals").select(_COLS).gte("closed_at", since))

        now = datetime.now(timezone.utc)
        overall_wr, ch_wr, ch_n = channel_winrates(closed)
        scored = []
        for d in opens:
            try:
                s = score_open(d, overall_wr, ch_wr, ch_n, now)
            except Exception:
                continue
            s["phone"] = _phone_from_rd(d.get("rd_raw"))
            scored.append(s)
        scored.sort(key=lambda x: -x.get("score", 0))
        fila = scored[:n]
        com_fone = sum(1 for s in fila if s.get("phone"))
        return self._send(200, {"ok": True, "email": email, "total_abertos": len(scored),
                                "com_telefone": com_fone, "fila": fila,
                                "basis": "cérebro de vendas (score real por etapa/canal/recência)"})
