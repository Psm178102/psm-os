"""
GET/POST /api/v3/diretoria/custos_corretor — Custo fixo individual por CORRETOR. v80.0

Quanto cada corretor custa de fixo por mês (e-mail, logins de sistema, licenças,
softwares, etc). O sócio cadastra itens por corretor; o total alimenta:
  • Métricas Viab (Diretoria) → custo fixo por corretor, agrupado por equipe;
  • One-on-One → soma com o investimento em ads = QUANTO CUSTA CADA CORRETOR.

Guarda em shared_kv key 'custos_fixos_corretor' (sem SQL). Valores são MENSAIS.

Estrutura: { "byuser": { "<uid>": { "itens": [{nome, valor}], "obs": str } } }

GET  (lvl >= 5): { ok, byuser, can_edit }            — gestão lê (pro 1:1 e Viab)
POST (lvl >= 7): action set_user {uid, itens, obs} | delete_user {uid}  — diretoria edita
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "custos_fixos_corretor"
MAX_ITENS = 40


def read_custos(sb):
    """Mapa {uid: {itens:[{nome,valor}], obs, total}}. Reutilizável por outros endpoints."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    byuser = (val or {}).get("byuser") if isinstance(val, dict) else None
    out = {}
    if isinstance(byuser, dict):
        for uid, e in byuser.items():
            itens = [i for i in (e.get("itens") or []) if isinstance(i, dict)] if isinstance(e, dict) else []
            total = 0.0
            clean = []
            for i in itens:
                try:
                    v = float(i.get("valor") or 0)
                except Exception:
                    v = 0.0
                clean.append({"nome": str(i.get("nome") or "").strip()[:80], "valor": round(v, 2)})
                total += v
            out[str(uid)] = {"itens": clean, "obs": str((e.get("obs") if isinstance(e, dict) else "") or "")[:300],
                             "total": round(total, 2)}
    return out


def custo_fixo_de(sb_custos, uid):
    """Total mensal de custo fixo de um corretor (0 se não cadastrado)."""
    e = (sb_custos or {}).get(str(uid))
    return (e or {}).get("total", 0.0) if e else 0.0


def _write(sb, byuser):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"byuser": byuser},
                                 "updated_at": datetime.now(timezone.utc).isoformat()},
                                on_conflict="key").execute()


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            return self._send(200, {"ok": True, "byuser": read_custos(sb),
                                    "can_edit": (user.get("lvl") or 0) >= 7})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = (body.get("action") or "set_user").strip()
        uid = str(body.get("uid") or "").strip()
        if not uid:
            return self._send(400, {"ok": False, "error": "uid obrigatório"})
        try:
            sb = supabase_client()
            cur = read_custos(sb)
            byuser = {k: {"itens": v["itens"], "obs": v["obs"]} for k, v in cur.items()}

            if action == "delete_user":
                byuser.pop(uid, None)
            else:  # set_user
                raw = body.get("itens") or []
                itens = []
                for i in raw[:MAX_ITENS]:
                    if not isinstance(i, dict):
                        continue
                    nome = str(i.get("nome") or "").strip()[:80]
                    try:
                        valor = round(float(i.get("valor") or 0), 2)
                    except Exception:
                        valor = 0.0
                    if nome or valor:
                        itens.append({"nome": nome, "valor": valor})
                byuser[uid] = {"itens": itens, "obs": str(body.get("obs") or "").strip()[:300]}

            _write(sb, byuser)
            try:
                audit(self, actor, "custos_corretor_" + action, "user", uid, notes=None)
            except Exception:
                pass
            return self._send(200, {"ok": True, "byuser": read_custos(sb)})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
