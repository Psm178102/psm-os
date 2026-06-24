"""
GET/POST /api/v3/settings/teams — Equipes personalizáveis (tabela `teams`). v81.39

A tabela `teams` é a FONTE DA VERDADE: existe FK users.team → teams.id, então uma
equipe precisa ser linha aqui pra poder receber usuários. Colunas: id, name, icon,
color, active. O front usa {id, lbl, ico, color}.

GET  (qualquer autenticado): { ok, teams[]=ativas, can_edit }
POST (lvl>=7): { action:'set', teams:[{id?,lbl,ico,color}, ...] }
     → upsert das enviadas (active=true) + soft-remove (active=false) das que sumiram.
     Não dá hard-delete (preserva FK/histórico de quem já está na equipe).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid, re
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


def _slug(s):
    s = re.sub(r"[^a-z0-9]+", "_", (s or "").strip().lower()).strip("_")
    return s[:40] or uuid.uuid4().hex[:8]


def _to_front(row):
    return {
        "id": row.get("id"),
        "lbl": row.get("name") or row.get("id"),
        "ico": row.get("icon") or "📁",
        "color": row.get("color") or "#64748b",
    }


def _read(sb):
    try:
        rows = sb.table("teams").select("id,name,icon,color,active").order("name").execute().data or []
        return [_to_front(r) for r in rows if r.get("active") is not False]
    except Exception:
        return []


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
        return self._send(200, {"ok": True, "teams": _read(sb), "can_edit": (user.get("lvl") or 0) >= 7})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
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

        clean, seen = [], set()
        for t in (body.get("teams") or []):
            if not isinstance(t, dict):
                continue
            lbl = str(t.get("lbl") or t.get("label") or t.get("name") or "").strip()
            if not lbl:
                continue
            tid = str(t.get("id") or "").strip() or _slug(lbl)
            if tid in seen:
                continue
            seen.add(tid)
            clean.append({
                "id": tid[:40],
                "name": lbl[:60],
                "icon": (str(t.get("ico") or t.get("icon") or "📁").strip()[:8] or "📁"),
                "color": (str(t.get("color") or "#64748b").strip()[:16] or "#64748b"),
                "active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        if not clean:
            return self._send(400, {"ok": False, "error": "informe ao menos 1 equipe"})

        try:
            sb.table("teams").upsert(clean, on_conflict="id").execute()
            # soft-remove (active=false) as equipes ATIVAS que não vieram na lista
            try:
                cur = sb.table("teams").select("id,active").execute().data or []
                for r in cur:
                    if r.get("active") is not False and r.get("id") not in seen:
                        sb.table("teams").update({"active": False}).eq("id", r["id"]).execute()
            except Exception:
                pass
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "teams.set", target_type="teams", notes=f"{len(clean)} equipes")
        return self._send(200, {"ok": True, "teams": _read(sb)})
