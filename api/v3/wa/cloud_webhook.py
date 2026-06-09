"""GET/POST /api/v3/wa/cloud_webhook — webhook da 360dialog (WhatsApp Cloud API).
Aponte o webhook da 360dialog/Meta pra cá.
  GET  = verificação (hub.mode/hub.verify_token == WA_CLOUD_VERIFY_TOKEN → hub.challenge)
  POST = mensagens recebidas (texto OU clique no botão 'Quero ver') → record_reply (quente/opt-out)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
from _wa_lib import record_reply  # type: ignore


def _extract(body):
    """Cloud API: entry[].changes[].value.messages[] → [(phone, text)]."""
    out = []
    try:
        for entry in (body.get("entry") or []):
            for ch in (entry.get("changes") or []):
                val = ch.get("value") or {}
                for m in (val.get("messages") or []):
                    frm = m.get("from")
                    t = m.get("type")
                    txt = ""
                    if t == "text":
                        txt = (m.get("text") or {}).get("body") or ""
                    elif t == "button":
                        txt = (m.get("button") or {}).get("text") or (m.get("button") or {}).get("payload") or ""
                    elif t == "interactive":
                        it = m.get("interactive") or {}
                        br = it.get("button_reply") or it.get("list_reply") or {}
                        txt = br.get("title") or br.get("id") or ""
                    if frm:
                        out.append((frm, txt))
    except Exception:
        pass
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b, raw=False):
        self.send_response(s)
        self.send_header("Content-Type", "text/plain" if raw else "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(b.encode("utf-8") if raw else json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        verify = os.environ.get("WA_CLOUD_VERIFY_TOKEN", "").strip()
        if q.get("hub.mode") == "subscribe" and verify and q.get("hub.verify_token") == verify:
            return self._send(200, q.get("hub.challenge", ""), raw=True)
        return self._send(403, {"ok": False, "error": "verify falhou"})

    def do_POST(self):
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            body = {}
        sb = supabase_client()
        if not sb:
            return self._send(200, {"ok": True, "skipped": "no-backend"})
        n = 0
        for phone, text in _extract(body):
            try:
                record_reply(sb, phone, text); n += 1
            except Exception:
                pass
        return self._send(200, {"ok": True, "processed": n})
