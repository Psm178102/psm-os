"""GET/POST /api/v3/teams/manage — Gerenciar Equipes

GET (lvl>=2): retorna { teams: [...], membros agrupados }
POST (lvl>=5):
  action=save_teams: salva definição das equipes (label, color, ico, lider_id, gerente_id)
  action=move_user:  move corretor pra outra equipe (atualiza users.team)

Equipes ficam em shared_kv key 'psm_teams'. Membros vêm de users.team.
Default: MAP, Conquista, Terceiros, Locação.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, lvl_of  # type: ignore

KV_KEY = "psm_teams"

DEFAULT_TEAMS = [
    {"id": "map",       "label": "MAP",       "color": "#6366f1", "ico": "📊", "lider_id": None, "gerente_id": None},
    {"id": "conquista", "label": "Conquista", "color": "#f59e0b", "ico": "🏆", "lider_id": None, "gerente_id": None},
    {"id": "terceiros", "label": "Terceiros", "color": "#a855f7", "ico": "🤝", "lider_id": None, "gerente_id": None},
    {"id": "locacao",   "label": "Locação",   "color": "#10b981", "ico": "🔑", "lider_id": None, "gerente_id": None},
]


def _read_teams(sb):
    try:
        row = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        if row and isinstance(row[0].get("value"), dict):
            t = row[0]["value"].get("teams")
            if isinstance(t, list) and t:
                return t
    except Exception:
        pass
    return DEFAULT_TEAMS


def _write_teams(sb, teams):
    payload = {"key": KV_KEY, "value": {"teams": teams, "updated_at": datetime.now(timezone.utc).isoformat()}}
    sb.table("shared_kv").upsert(payload, on_conflict="key").execute()


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
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        teams = _read_teams(sb)
        try:
            # lvl NÃO é coluna do banco — é derivado do role. Selecionar lvl direto
            # quebrava (42703 column users.lvl does not exist). Computa aqui.
            users = sb.table("users").select("id,name,email,role,team,ini,color,status,hide_from_ranking").order("name").execute().data or []
            for u in users:
                u["lvl"] = lvl_of(u.get("role"))
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "teams": teams, "users": users})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        action = body.get("action")

        if action == "save_teams":
            teams = body.get("teams")
            if not isinstance(teams, list):
                return self._send(400, {"ok": False, "error": "teams[] obrigatório"})
            # sanitize
            clean = []
            for t in teams:
                if not isinstance(t, dict) or not (t.get("label") or "").strip():
                    continue
                clean.append({
                    "id": (t.get("id") or t["label"].lower().replace(" ", "_"))[:40],
                    "label": t["label"].strip()[:60],
                    "color": (t.get("color") or "#64748b")[:9],
                    "ico": (t.get("ico") or "📁")[:8],
                    "lider_id": t.get("lider_id") or None,
                    "gerente_id": t.get("gerente_id") or None,
                })
            try:
                _write_teams(sb, clean)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "teams.save", target_type="teams", notes=f"{len(clean)} equipes")
            return self._send(200, {"ok": True, "teams": clean})

        if action == "move_user":
            uid = body.get("user_id"); team = body.get("team")
            if not uid: return self._send(400, {"ok": False, "error": "user_id obrigatório"})
            try:
                sb.table("users").update({"team": team}).eq("id", uid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "teams.move_user", target_type="users", target_id=uid, notes=f"→ {team}")
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": "action inválida (save_teams|move_user)"})
