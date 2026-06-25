"""
GET/POST /api/v3/gp/rh_processos — Onboarding & Offboarding (admissão/desligamento). v81.44

Processos de RH guardados em shared_kv key 'rh_processos':
  { "onboarding": [ <proc>, ... ], "offboarding": [ <proc>, ... ] }

<proc> = { id, nome, cargo, equipe, data, responsavel, motivo, carteira_destino,
           status, checklist:{<item_key>:true}, obs, created_at, updated_at }

Os TEMPLATES de etapas/itens vivem no frontend (gestao-pessoas.js) — aqui só
guardamos quais itens estão marcados (checklist é um mapa item_key→bool). Assim
o sócio edita a trilha no código sem migração e o backend fica burro/estável.

Acesso: SÓCIO (lvl>=10) — tanto GET quanto escrita. Quando o Paulo quiser abrir
pra gerência/RH é só baixar o min_lvl aqui.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, re, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "rh_processos"
TIPOS = ("onboarding", "offboarding")
# campos aceitos num processo (whitelist — ignora o resto)
FIELDS = ("nome", "cargo", "equipe", "data", "responsavel", "motivo",
          "carteira_destino", "status", "obs")
MAX_PROC = 500          # teto por tipo
MAX_STR = 240


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    if not isinstance(val, dict):
        val = {}
    for t in TIPOS:
        if not isinstance(val.get(t), list):
            val[t] = []
    return val


def _write(sb, val):
    sb.table("shared_kv").upsert({
        "key": KV_KEY, "value": val, "updated_at": _now(),
    }, on_conflict="key").execute()


def _clean_proc(raw):
    """Sanitiza um processo vindo do front."""
    out = {}
    for k in FIELDS:
        v = raw.get(k)
        if v is None:
            continue
        out[k] = str(v).strip()[:MAX_STR]
    # checklist = mapa de item_key → bool
    cl = raw.get("checklist")
    clean_cl = {}
    if isinstance(cl, dict):
        for ik, iv in list(cl.items())[:200]:
            if isinstance(ik, str) and ik.strip():
                clean_cl[ik.strip()[:80]] = bool(iv)
    out["checklist"] = clean_cl
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
            require_user(self, min_lvl=2)   # v81.58: acesso decidido na matriz por papel
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        val = _read(sb)
        return self._send(200, {"ok": True, "onboarding": val["onboarding"], "offboarding": val["offboarding"]})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=2)   # v81.58: acesso decidido na matriz por papel
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

        action = body.get("action") or "upsert"
        tipo = body.get("tipo")
        if tipo not in TIPOS:
            return self._send(400, {"ok": False, "error": "tipo inválido (onboarding|offboarding)"})

        val = _read(sb)
        lst = val[tipo]

        if action == "delete":
            pid = body.get("id")
            val[tipo] = [p for p in lst if p.get("id") != pid]
            try: _write(sb, val)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "rh.proc_delete", target_type="shared_kv", target_id=tipo, notes=str(pid))
            return self._send(200, {"ok": True, "deleted": pid})

        # upsert
        raw = body.get("proc") if isinstance(body.get("proc"), dict) else {}
        proc = _clean_proc(raw)
        if not proc.get("nome"):
            return self._send(400, {"ok": False, "error": "nome obrigatório"})
        pid = raw.get("id")
        if pid:
            found = False
            for i, p in enumerate(lst):
                if p.get("id") == pid:
                    proc.update({"id": pid, "created_at": p.get("created_at") or _now(), "updated_at": _now()})
                    lst[i] = proc; found = True; break
            if not found:
                pid = None
        if not pid:
            if len(lst) >= MAX_PROC:
                return self._send(400, {"ok": False, "error": "limite de processos atingido"})
            pid = "rh_" + uuid.uuid4().hex[:12]
            proc.update({"id": pid, "created_at": _now(), "updated_at": _now()})
            lst.append(proc)
        val[tipo] = lst
        try: _write(sb, val)
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "rh.proc_upsert", target_type="shared_kv", target_id=tipo, notes=proc.get("nome"))
        return self._send(200, {"ok": True, "id": pid, "proc": proc})
