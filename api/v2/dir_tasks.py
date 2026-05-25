"""
PSM-OS v2 — Diretoria Tasks endpoint
GET  /api/v2/dir_tasks          → lista todas (abertas+em_andamento por prazo, depois concluídas)
GET  /api/v2/dir_tasks?id=UUID  → busca uma
POST /api/v2/dir_tasks          → cria ou atualiza
DELETE /api/v2/dir_tasks?id=UUID → remove

Tabela: public.dir_tasks
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.parse


def _sb():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
        return create_client(url, key)
    except Exception as e:
        print(f"[v2/dir_tasks] {e}")
        return None


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def _qparams(self):
        try:
            u = urllib.parse.urlparse(self.path)
            return dict(urllib.parse.parse_qsl(u.query))
        except Exception:
            return {}

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        sb = _sb()
        if not sb:
            return self._send_json(503, {"ok": False, "error": "Supabase nao configurado"})
        q = self._qparams()
        try:
            if q.get("id"):
                r = sb.table("dir_tasks").select("*").eq("id", q["id"]).limit(1).execute()
                rows = r.data or []
                if not rows:
                    return self._send_json(404, {"ok": False, "error": "not found"})
                return self._send_json(200, {"ok": True, "task": rows[0]})
            else:
                # Abertas/em_andamento primeiro por prazo, depois concluídas por updated_at
                r = sb.table("dir_tasks").select("*").order("status").order("prazo", desc=False, nullsfirst=False).order("created_at", desc=True).limit(500).execute()
                items = r.data or []
                return self._send_json(200, {"ok": True, "count": len(items), "tasks": items})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        sb = _sb()
        if not sb:
            return self._send_json(503, {"ok": False, "error": "Supabase nao configurado"})
        p = self._body()
        if not p.get("titulo"):
            return self._send_json(400, {"ok": False, "error": "titulo obrigatorio"})
        try:
            # Se status mudou pra concluida e não tem concluida_em, seta agora
            if p.get("status") == "concluida" and not p.get("concluida_em"):
                from datetime import datetime
                p["concluida_em"] = datetime.utcnow().isoformat() + "Z"
            if p.get("id"):
                upd = {k: v for k, v in p.items() if k != "id"}
                r = sb.table("dir_tasks").update(upd).eq("id", p["id"]).execute()
            else:
                r = sb.table("dir_tasks").insert(p).execute()
            row = (r.data or [None])[0]
            return self._send_json(200, {"ok": True, "task": row})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})

    def do_DELETE(self):
        sb = _sb()
        if not sb:
            return self._send_json(503, {"ok": False, "error": "Supabase nao configurado"})
        q = self._qparams()
        if not q.get("id"):
            return self._send_json(400, {"ok": False, "error": "id obrigatorio"})
        try:
            sb.table("dir_tasks").delete().eq("id", q["id"]).execute()
            return self._send_json(200, {"ok": True, "deleted": q["id"]})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})
