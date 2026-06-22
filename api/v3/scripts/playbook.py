"""
GET/POST /api/v3/scripts/playbook — Scripts & Cadências (playbook de vendas). v81.19

Organizado por LINHA (M.A.P, Conquista, MCMV, Locação…) → ETAPA do funil, cada etapa
com conteúdo livre (regras, scripts, cadência, gatilhos). Cada linha tem sua própria
linguagem/estratégia. Guardado em shared_kv 'scripts_playbook'. Se vazio, pré-carrega
o M.A.P a partir do manual v5 + scripts (módulo _seed).

GET  (lvl >= 2 — todos, inclusive corretores, precisam dos scripts): { ok, linhas, can_edit }
POST (lvl >= 5 — gestão edita): { linhas:[...] } → substitui o playbook (valida/limita).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
try:
    from _seed import DEFAULT as SEED  # type: ignore
except Exception:
    SEED = {"linhas": []}

KV_KEY = "scripts_playbook"
MAX_LINHAS = 30
MAX_ETAPAS = 80
MAX_CONT = 200000  # ~200KB por etapa


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
    except Exception:
        v = None
    if not isinstance(v, dict) or not v.get("linhas"):
        return SEED            # primeira vez: serve a baseline inteira
    # merge não-destrutivo: anexa linhas da SEED cujo id ainda não existe no salvo
    # (não sobrescreve nada já editado; só traz linhas novas pré-carregadas).
    try:
        have = {l.get("id") for l in v.get("linhas", []) if isinstance(l, dict)}
        for sl in (SEED.get("linhas") or []):
            if sl.get("id") not in have:
                v["linhas"].append(sl)
    except Exception:
        pass
    return v


def _write(sb, data):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": data,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _int(v, fb):
    try:
        return int(v)
    except Exception:
        return fb


def _clean(data):
    linhas = []
    for i, l in enumerate((data.get("linhas") or [])[:MAX_LINHAS]):
        if not isinstance(l, dict):
            continue
        ets = []
        for j, e in enumerate((l.get("etapas") or [])[:MAX_ETAPAS]):
            if not isinstance(e, dict):
                continue
            ets.append({
                "id": str(e.get("id") or f"et_{j}")[:40],
                "nome": str(e.get("nome") or "Etapa")[:120],
                "ordem": _int(e.get("ordem"), j),
                "conteudo": str(e.get("conteudo") or "")[:MAX_CONT],
            })
        linhas.append({
            "id": str(l.get("id") or f"l_{i}")[:40],
            "nome": str(l.get("nome") or "Linha")[:80],
            "cor": (str(l.get("cor") or "")[:9] or None),
            "ordem": _int(l.get("ordem"), i),
            "etapas": ets,
        })
    return {"linhas": linhas}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            data = _read(sb)
            return self._send(200, {"ok": True, "linhas": data.get("linhas", []),
                                    "can_edit": (user.get("lvl") or 0) >= 5})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        data = _clean(body)
        try:
            sb = supabase_client()
            _write(sb, data)
            audit(self, actor, "scripts_playbook.save", "kv", KV_KEY, notes=f"{len(data['linhas'])} linha(s)")
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "linhas": data["linhas"]})
