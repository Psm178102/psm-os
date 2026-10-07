# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/oo/placar — 📊 Placar do dia do corretor. v89.40

O corretor lança os números do dia (ligações de relacionamento, conversas, agendamentos,
visitas, propostas, abordagens digitais, indicações pedidas, vídeos, captações, encontros)
e o gestor enxerga a semana do time contra o padrão. Um registro por pessoa
(shared_kv 'placar_dia:<user_id>' = {dias: {AAAA-MM-DD: {campo: n, ts}}}) pra dois
corretores salvando ao mesmo tempo não se atropelarem.

GET  ?since=&until=[&corretor_id=]   → o próprio (lvl>=5 vê qualquer um)   { ok, corretor_id, dias }
GET  ?time=map&since=&until=         → gestão (lvl>=5): todo o time ativo  { ok, time:[{id,name,dias}] }
POST {data, valores:{campo:n}[, corretor_id]} → grava o dia (o próprio; lvl>=5 corrige de outro).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

CAMPOS = ("lig_relac", "conversas", "agendamentos", "visitas", "propostas",
          "abord_digital", "indicacoes", "videos", "captacoes", "encontros")
BRT = timezone(timedelta(hours=-3))
JANELA_CORRETOR = 14        # dias pra trás que o próprio corretor ainda corrige
GUARDA_DIAS = 400


def _key(uid):
    return f"placar_dia:{uid}"


def _hoje():
    return datetime.now(BRT).date()


def _d(s, fb):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return fb


def _ler(sb, uid):
    rows = sb.table("shared_kv").select("value").eq("key", _key(uid)).limit(1).execute().data or []
    v = rows[0]["value"] if rows else {}
    if isinstance(v, str):
        try: v = json.loads(v)
        except Exception: v = {}
    return v if isinstance(v, dict) else {}


def _recorte(v, ini, fim):
    return {k: d for k, d in (v.get("dias") or {}).items() if ini.isoformat() <= k <= fim.isoformat()}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        hoje = _hoje()
        seg = hoje - timedelta(days=hoje.weekday())
        ini, fim = _d(q.get("since"), seg), _d(q.get("until"), seg + timedelta(days=5))
        if (fim - ini).days > 62:
            return self._send(400, {"ok": False, "error": "período máximo: 2 meses"})
        gestor = (user.get("lvl") or 0) >= 5
        try:
            sb = supabase_client()
            if q.get("time"):
                if not gestor:
                    return self._send(403, {"ok": False, "error": "só a gestão vê o time"})
                us = sb.table("users").select("id,name,team,status,is_service").eq("team", q["time"]).execute().data or []
                us = [u for u in us if (u.get("status") or "ativo") == "ativo" and not u.get("is_service")]
                return self._send(200, {"ok": True, "campos": list(CAMPOS), "since": ini, "until": fim,
                                        "time": [{"id": u["id"], "name": u.get("name"), "dias": _recorte(_ler(sb, u["id"]), ini, fim)}
                                                 for u in sorted(us, key=lambda x: x.get("name") or "")]})
            cid = q.get("corretor_id") or user.get("id")
            if str(cid) != str(user.get("id")) and not gestor:
                return self._send(403, {"ok": False, "error": "sem permissão"})
            return self._send(200, {"ok": True, "campos": list(CAMPOS), "corretor_id": cid, "since": ini, "until": fim,
                                    "dias": _recorte(_ler(sb, cid), ini, fim), "gestor": gestor})
        except Exception as e:
            return self._send(503, {"ok": False, "error": "não consegui ler o placar agora: " + str(e)[:120]})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if 0 < n < 20000 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        gestor = (user.get("lvl") or 0) >= 5
        cid = str(body.get("corretor_id") or user.get("id"))
        if cid != str(user.get("id")) and not gestor:
            return self._send(403, {"ok": False, "error": "você só lança o seu próprio placar"})
        hoje = _hoje()
        dia = _d(body.get("data"), None)
        if not dia or dia > hoje:
            return self._send(400, {"ok": False, "error": "data inválida (não dá pra lançar dia futuro)"})
        if not gestor and (hoje - dia).days > JANELA_CORRETOR:
            return self._send(400, {"ok": False, "error": f"só dá pra corrigir os últimos {JANELA_CORRETOR} dias"})
        vals = {}
        for c in CAMPOS:
            x = (body.get("valores") or {}).get(c)
            if x in (None, ""):
                continue
            try:
                x = int(x)
            except Exception:
                return self._send(400, {"ok": False, "error": f"valor inválido em {c}"})
            if x < 0 or x > 500:
                return self._send(400, {"ok": False, "error": f"valor fora do limite em {c}"})
            vals[c] = x
        try:
            sb = supabase_client()
            v = _ler(sb, cid)
            dias = v.get("dias") or {}
            dias[dia.isoformat()] = {**vals, "ts": datetime.now(timezone.utc).isoformat(), "por": user.get("id")}
            corte = (hoje - timedelta(days=GUARDA_DIAS)).isoformat()
            v["dias"] = {k: d for k, d in dias.items() if k >= corte}
            sb.table("shared_kv").upsert({"key": _key(cid), "value": v,
                                          "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()
            if cid != str(user.get("id")):
                audit(self, user, "placar_dia.corrigir", "kv", _key(cid), notes=dia.isoformat())
        except Exception as e:
            return self._send(500, {"ok": False, "error": "falha ao gravar: " + str(e)[:200]})
        return self._send(200, {"ok": True, "data": dia, "valores": v["dias"][dia.isoformat()]})
