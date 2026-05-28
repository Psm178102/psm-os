"""GET/POST/DELETE /api/v3/premiacoes/list — Premiações PSM

GET:    list (todos lvl>=2)
POST:   upsert (Sócio lvl>=7)
DELETE: ?id=X (Sócio lvl>=7)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("premiacoes").select("*").order("inicio", desc=True).limit(500).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "premiacoes": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        titulo = (body.get("titulo") or "").strip()
        inicio = body.get("inicio"); fim = body.get("fim")
        if not titulo: return self._send(400, {"ok": False, "error": "titulo obrigatório"})
        if not inicio or not fim: return self._send(400, {"ok": False, "error": "inicio e fim obrigatórios"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        is_new = not body.get("id")
        row = {
            "id": body.get("id") or f"prem_{int(datetime.now().timestamp()*1000)}",
            "titulo": titulo,
            "incorporadora": (body.get("incorporadora") or "").strip() or None,
            "produto": (body.get("produto") or "").strip() or None,
            "inicio": inicio,
            "fim": fim,
            "descricao": (body.get("descricao") or body.get("desc") or "").strip() or None,
            "premio": (body.get("premio") or "").strip() or None,
            "icon": (body.get("icon") or "🏆").strip()[:8],
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            r = sb.table("premiacoes").upsert(row).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "premiacao.upsert", target_type="premiacoes",
              target_id=row["id"], after=row, notes=titulo[:80])

        # Notifica TODOS corretores quando NOVA premiação for criada
        if is_new:
            try:
                users = sb.table("users").select("id").gte("lvl", 2).execute().data or []
                ids = [u["id"] for u in users if u.get("id")]
                if ids:
                    notify(ids, "premiacao",
                           f"{row['icon']} Nova premiação: {titulo[:60]}",
                           (row.get("premio") or row.get("descricao") or "")[:120],
                           link="#/premiacoes",
                           target_type="premiacoes",
                           target_id=row["id"])
            except Exception:
                pass

        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        pid = params.get("id")
        if not pid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("premiacoes").delete().eq("id", pid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "premiacao.delete", target_type="premiacoes", target_id=pid)
        return self._send(200, {"ok": True})
