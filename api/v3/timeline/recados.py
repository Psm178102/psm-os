"""
GET/POST /api/v3/timeline/recados — Timeline de recados no topo do sistema. v78.7

Os SÓCIOS (lvl 10) escrevem recados que aparecem numa faixa no topo de toda tela,
escolhem por quanto tempo ficam visíveis e se notificam no sistema (sino) e/ou no
celular (push). Guarda em shared_kv key 'timeline_recados'.

Item = {id, texto, cor, autor, autor_id, criado_em, expira_em|null, notif_sistema, notif_push}

GET  (qualquer autenticado): {ok, items:[ativos, recentes primeiro], can_manage}
POST (lvl >= 10):
   action add  {texto, dur_horas (0=permanente), cor, notif_sistema, notif_push}
               → cria + dispara notificações (sino/push) pra todos os usuários ativos.
   action delete {id}
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, send_web_push  # type: ignore

KV_KEY = "timeline_recados"
MAXN = 100


def _now():
    return datetime.now(timezone.utc)


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    items = (val or {}).get("items") if isinstance(val, dict) else None
    return items if isinstance(items, list) else []


def _write(sb, items):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"items": items},
                                 "updated_at": _now().isoformat()}, on_conflict="key").execute()


def _ativos(items):
    now = _now().isoformat()
    out = [it for it in items if not it.get("expira_em") or str(it.get("expira_em")) > now]
    out.sort(key=lambda x: str(x.get("criado_em") or ""), reverse=True)
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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        items = _read(sb)
        ativos = _ativos(items)
        # poda preguiçosa: se há expirados, reescreve só com não-expirados (mantém histórico curto)
        if len(ativos) != len(items):
            try: _write(sb, ativos[:MAXN])
            except Exception: pass
        manage = (user.get("lvl") or 0) >= 10
        return self._send(200, {"ok": True, "items": ativos, "can_manage": manage})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)   # só o sócio publica
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

        items = _read(sb)
        action = (body.get("action") or "").strip()

        if action == "delete":
            iid = body.get("id")
            items = [it for it in items if it.get("id") != iid]
            _write(sb, items)
            audit(self, actor, "timeline.delete", target_type="timeline_recados", target_id=str(iid or ""))
            return self._send(200, {"ok": True, "items": _ativos(items)})

        if action != "add":
            return self._send(400, {"ok": False, "error": "ação inválida"})

        texto = str(body.get("texto") or "").strip()[:500]
        if not texto:
            return self._send(400, {"ok": False, "error": "Escreva o recado"})
        try:
            dur = float(body.get("dur_horas") or 0)
        except Exception:
            dur = 0
        expira = None if dur <= 0 else (_now() + timedelta(hours=dur)).isoformat()
        rec = {
            "id": uuid.uuid4().hex[:12],
            "texto": texto,
            "cor": str(body.get("cor") or "#0f172a")[:20],
            "autor": actor.get("name"),
            "autor_id": actor.get("id"),
            "criado_em": _now().isoformat(),
            "expira_em": expira,
            "notif_sistema": bool(body.get("notif_sistema")),
            "notif_push": bool(body.get("notif_push")),
        }
        items.append(rec)
        try:
            _write(sb, items[-MAXN:])
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # ── notificações (best-effort) ──
        sent = {"sistema": 0, "push": 0}
        if rec["notif_sistema"] or rec["notif_push"]:
            try:
                uids = [u.get("id") for u in (sb.table("users").select("id,status").execute().data or [])
                        if u.get("id") and (u.get("status") or "ativo") == "ativo"]
            except Exception:
                uids = []
            title = "📣 Recado da Diretoria"
            if rec["notif_sistema"]:
                try: sent["sistema"] = notify(uids, "recado", title, body=texto, link="#/", target_type="timeline", target_id=rec["id"]) or 0
                except Exception: pass
            if rec["notif_push"]:
                try: sent["push"] = send_web_push(uids, title, texto, link="#/", tag="recado") or 0
                except Exception: pass

        audit(self, actor, "timeline.add", target_type="timeline_recados", target_id=rec["id"],
              notes=f"dur={dur}h sis={rec['notif_sistema']} push={rec['notif_push']}")
        return self._send(200, {"ok": True, "items": _ativos(items), "sent": sent})
