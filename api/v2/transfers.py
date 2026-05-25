"""
PSM-OS v2 — Transfers (Repasses) endpoint
GET  /api/v2/transfers          → lista todos (ordenado por data_agendada DESC)
GET  /api/v2/transfers?id=UUID  → busca um
POST /api/v2/transfers          → cria ou atualiza
DELETE /api/v2/transfers?id=UUID → remove

Tabela: public.transfers
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
        print(f"[v2/transfers] {e}")
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
                r = sb.table("transfers").select("*").eq("id", q["id"]).limit(1).execute()
                rows = r.data or []
                if not rows:
                    return self._send_json(404, {"ok": False, "error": "not found"})
                return self._send_json(200, {"ok": True, "transfer": rows[0]})
            else:
                r = sb.table("transfers").select("*").order("data", desc=True).order("created_at", desc=True).limit(500).execute()
                items = r.data or []
                return self._send_json(200, {"ok": True, "count": len(items), "transfers": items})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        sb = _sb()
        if not sb:
            return self._send_json(503, {"ok": False, "error": "Supabase nao configurado"})
        p = self._body()
        if not p.get("descricao") or p.get("valor") is None:
            return self._send_json(400, {"ok": False, "error": "descricao e valor obrigatorios"})
        try:
            if p.get("id"):
                upd = {k: v for k, v in p.items() if k != "id"}
                r = sb.table("transfers").update(upd).eq("id", p["id"]).execute()
            else:
                r = sb.table("transfers").insert(p).execute()
            row = (r.data or [None])[0]
            return self._send_json(200, {"ok": True, "transfer": row})
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
            sb.table("transfers").delete().eq("id", q["id"]).execute()
            return self._send_json(200, {"ok": True, "deleted": q["id"]})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})
