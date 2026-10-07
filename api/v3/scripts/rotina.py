# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/scripts/rotina — 🗓 A rotina do time, passo ④ do Playbook da Venda. v89.40

A rotina de cada nicho (linha do playbook), de hora em hora: o padrão que o time persegue,
os inegociáveis do dia, as regras, os gatilhos e o que fazer em cada faixa de 1 hora de
segunda a sábado. Fica separada do playbook (shared_kv 'rotina_time:<linha>') pra salvar
sem regravar os scripts inteiros.

GET  ?linha=map  (lvl >= 2 — o corretor consulta)   → { ok, linha, rotina|null, updated_at, can_edit }
POST {linha, rotina}  (lvl >= 5 — a gestão edita)   → grava a rotina inteira (validada e limitada).
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

MAX_BYTES = 150_000
MODOS = ("i", "g", "s", "u")          # individual · equipe com gestor · equipe sem gestor · individual com gestor
TIPOS = ("", "ouro", "gold", "pausa")
HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _key(linha):
    return "rotina_time:" + re.sub(r"[^a-z0-9_]", "", str(linha or "").lower())[:40]


def _t(v, n):
    return str(v or "").strip()[:n]


def _clean(r):
    """Devolve a rotina saneada (ou levanta ValueError com a mensagem pro usuário)."""
    if not isinstance(r, dict):
        raise ValueError("rotina inválida")
    out = {"titulo": _t(r.get("titulo"), 120), "vigencia": _t(r.get("vigencia"), 80), "intro": _t(r.get("intro"), 600)}
    out["padrao"] = [{"rotulo": _t(x.get("rotulo"), 80), "dia": _t(x.get("dia"), 20), "semana": _t(x.get("semana"), 20), "mes": _t(x.get("mes"), 20)}
                     for x in (r.get("padrao") or [])[:20] if isinstance(x, dict) and _t(x.get("rotulo"), 80)]
    out["inegociaveis"] = [{"titulo": _t(x.get("titulo"), 120), "texto": _t(x.get("texto"), 400)}
                           for x in (r.get("inegociaveis") or [])[:8] if isinstance(x, dict) and _t(x.get("titulo"), 120)]
    out["regras"] = [_t(x, 300) for x in (r.get("regras") or [])[:30] if _t(x, 300)]
    out["gatilhos"] = [{"sinal": _t(x.get("sinal"), 200), "acao": _t(x.get("acao"), 400)}
                       for x in (r.get("gatilhos") or [])[:20] if isinstance(x, dict) and _t(x.get("sinal"), 200)]
    dias = {}
    for d in ("1", "2", "3", "4", "5", "6"):
        faixas = []
        for s in ((r.get("dias") or {}).get(d) or [])[:16]:
            if not isinstance(s, dict):
                continue
            ini, fim = _t(s.get("ini"), 5), _t(s.get("fim"), 5)
            if not (HORA.match(ini) and HORA.match(fim)) or fim <= ini:
                raise ValueError(f"horário inválido em uma faixa ({ini or '?'}–{fim or '?'})")
            faixas.append({"ini": ini, "fim": fim, "bloco": _t(s.get("bloco"), 120) or "Bloco",
                           "modo": s.get("modo") if s.get("modo") in MODOS else "i",
                           "tipo": s.get("tipo") if s.get("tipo") in TIPOS else "",
                           "oque": _t(s.get("oque"), 400),
                           "tarefas": [_t(t, 300) for t in (s.get("tarefas") or [])[:12] if _t(t, 300)]})
        faixas.sort(key=lambda x: x["ini"])
        dias[d] = faixas
    if not any(dias.values()):
        raise ValueError("a rotina ficaria sem nenhuma faixa de horário")
    out["dias"] = dias
    return out


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
        linha = q.get("linha") or "map"
        try:
            sb = supabase_client()
            rows = sb.table("shared_kv").select("value,updated_at").eq("key", _key(linha)).limit(1).execute().data or []
        except Exception as e:
            return self._send(503, {"ok": False, "error": "não consegui ler a rotina agora: " + str(e)[:120]})
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            try: v = json.loads(v)
            except Exception: v = None
        return self._send(200, {"ok": True, "linha": linha, "rotina": v if isinstance(v, dict) else None,
                                "updated_at": rows[0].get("updated_at") if rows else None,
                                "can_edit": (user.get("lvl") or 0) >= 5})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "rotina grande demais"})
            body = json.loads(self.rfile.read(n).decode("utf-8") if n > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        linha = _t(body.get("linha"), 40)
        if not linha:
            return self._send(400, {"ok": False, "error": "linha é obrigatória"})
        try:
            rotina = _clean(body.get("rotina"))
        except ValueError as e:
            return self._send(400, {"ok": False, "error": str(e)})
        try:
            sb = supabase_client()
            sb.table("shared_kv").upsert({"key": _key(linha), "value": rotina,
                                          "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="key").execute()
            audit(self, actor, "rotina_time.save", "kv", _key(linha),
                  notes=f"{sum(len(v) for v in rotina['dias'].values())} faixa(s)")
        except Exception as e:
            return self._send(500, {"ok": False, "error": "falha ao gravar: " + str(e)[:200]})
        return self._send(200, {"ok": True, "rotina": rotina})
