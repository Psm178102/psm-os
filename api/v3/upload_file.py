"""
POST /api/v3/upload_file   (Líder lvl>=5)
body: { folder: "tabelas", filename: "conquista_maio.pdf",
        content_b64: "data:application/pdf;base64,JVBERi0..." | "JVBERi0..." }

Sobe um arquivo pro Supabase Storage (bucket = folder, público) usando a service
key que já existe — sem credencial nova. Devolve a URL pública pra salvar como
link (ex.: tabela do mês). Limite ~4MB (teto de corpo do Vercel); acima disso,
use a opção de link do Google Drive na mesma tela.

Resp: { ok, url, path, bucket, size_bytes }
"""
import base64
import json
import os
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

MAX_BYTES = 4_300_000  # ~4MB (Vercel corta o corpo em ~4.5MB)
MIME = {
    "pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel", "csv": "text/csv", "png": "image/png",
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
}


def _safe(name):
    name = (name or "arquivo").strip().replace(" ", "_")
    name = re.sub(r"[^A-Za-z0-9._-]", "", name) or "arquivo"
    return name[:80]


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        folder = re.sub(r"[^a-z0-9_-]", "", (body.get("folder") or "uploads").lower()) or "uploads"
        filename = _safe(body.get("filename"))
        raw = body.get("content_b64") or ""
        if "," in raw and raw.strip().lower().startswith("data:"):
            raw = raw.split(",", 1)[1]
        try:
            data = base64.b64decode(raw)
        except Exception:
            return self._send(400, {"ok": False, "error": "conteúdo base64 inválido"})
        if not data:
            return self._send(400, {"ok": False, "error": "arquivo vazio"})
        if len(data) > MAX_BYTES:
            return self._send(413, {"ok": False,
                                    "error": "Arquivo acima de ~4MB. Use a opção de link do Google Drive nesta tela.",
                                    "size_bytes": len(data)})

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        mime = MIME.get(ext, "application/octet-stream")

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # Garante o bucket (público). Se já existir, ignora o erro.
        try:
            sb.storage.create_bucket(folder, options={"public": True})
        except Exception:
            pass

        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        path = f"{datetime.now(timezone.utc).strftime('%Y-%m')}/{ts}_{filename}"
        try:
            sb.storage.from_(folder).upload(path, data, {"content-type": mime, "upsert": "true"})
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"upload falhou: {e}"})

        try:
            url = sb.storage.from_(folder).get_public_url(path)
            if isinstance(url, str):
                url = url.rstrip("?")
        except Exception:
            url = None

        audit(self, actor, "upload.file", target_type="storage", target_id=f"{folder}/{path}",
              notes=f"{len(data)} bytes {mime}")
        return self._send(200, {"ok": True, "url": url, "path": path, "bucket": folder, "size_bytes": len(data)})
