"""
GET/POST /api/v3/diretoria/custos_corretor — Custo fixo por CORRETOR. v80.4

Quanto cada corretor custa de fixo por mês (e-mail, logins, licenças…). Pra não
ser trabalhoso, o sócio lança o PADRÃO DA EQUIPE uma vez (vale pra CADA corretor
do time) e, se precisar, ajustes individuais por corretor (extras). Valores mensais.

custo do corretor = itens do padrão da EQUIPE dele + itens individuais (extras).
total da equipe = (nº de corretores × padrão da equipe) + soma dos extras.

Guarda em shared_kv 'custos_fixos_corretor' = {
  "byteam": { "<equipe_lower>": { "itens": [{nome,valor}] } },   # vale por corretor
  "byuser": { "<uid>":          { "itens": [{nome,valor}], "obs" } }  # extras individuais
}

GET  (lvl >= 5): { ok, byteam, byuser, can_edit }
POST (lvl >= 7): action set_team {team,itens} | delete_team {team}
                       | set_user {uid,itens,obs} | delete_user {uid}
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "custos_fixos_corretor"
MAX_ITENS = 40


def _clean_itens(raw):
    out, total = [], 0.0
    for i in (raw or [])[:MAX_ITENS]:
        if not isinstance(i, dict):
            continue
        nome = str(i.get("nome") or "").strip()[:80]
        try:
            valor = round(float(i.get("valor") or 0), 2)
        except Exception:
            valor = 0.0
        if nome or valor:
            out.append({"nome": nome, "valor": valor})
            total += valor
    return out, round(total, 2)


def read_custos(sb):
    """{'byteam': {team:{itens,total}}, 'byuser': {uid:{itens,obs,total}}}."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    val = val if isinstance(val, dict) else {}
    byteam_raw = val.get("byteam") if isinstance(val.get("byteam"), dict) else {}
    byuser_raw = val.get("byuser") if isinstance(val.get("byuser"), dict) else {}
    byteam = {}
    for t, e in byteam_raw.items():
        itens, total = _clean_itens(e.get("itens") if isinstance(e, dict) else None)
        byteam[str(t).strip().lower()] = {"itens": itens, "total": total}
    byuser = {}
    for uid, e in byuser_raw.items():
        itens, total = _clean_itens(e.get("itens") if isinstance(e, dict) else None)
        byuser[str(uid)] = {"itens": itens, "total": total,
                            "obs": str((e.get("obs") if isinstance(e, dict) else "") or "")[:300]}
    return {"byteam": byteam, "byuser": byuser}


def _write(sb, byteam, byuser):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"byteam": byteam, "byuser": byuser},
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
            cur = read_custos(sb)
            cur["ok"] = True
            cur["can_edit"] = (user.get("lvl") or 0) >= 7
            return self._send(200, cur)
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

        action = (body.get("action") or "").strip()
        try:
            sb = supabase_client()
            cur = read_custos(sb)
            byteam = {t: {"itens": v["itens"]} for t, v in cur["byteam"].items()}
            byuser = {k: {"itens": v["itens"], "obs": v["obs"]} for k, v in cur["byuser"].items()}

            if action in ("set_team", "delete_team"):
                team = str(body.get("team") or "").strip().lower()
                if not team:
                    return self._send(400, {"ok": False, "error": "team obrigatório"})
                if action == "delete_team":
                    byteam.pop(team, None)
                else:
                    itens, _ = _clean_itens(body.get("itens"))
                    byteam[team] = {"itens": itens}
                tgt = ("team", team)
            elif action in ("set_user", "delete_user"):
                uid = str(body.get("uid") or "").strip()
                if not uid:
                    return self._send(400, {"ok": False, "error": "uid obrigatório"})
                if action == "delete_user":
                    byuser.pop(uid, None)
                else:
                    itens, _ = _clean_itens(body.get("itens"))
                    byuser[uid] = {"itens": itens, "obs": str(body.get("obs") or "").strip()[:300]}
                tgt = ("user", uid)
            else:
                return self._send(400, {"ok": False, "error": "action inválida"})

            _write(sb, byteam, byuser)
            try:
                audit(self, actor, "custos_corretor_" + action, tgt[0], tgt[1], notes=None)
            except Exception:
                pass
            out = read_custos(sb)
            out["ok"] = True
            return self._send(200, out)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
