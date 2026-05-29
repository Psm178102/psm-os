"""POST /api/v3/backup/drive — backup completo → Google Drive (Sócio, lvl>=7)

Gera um dump JSON de todas as tabelas críticas e sobe pro Google Drive na pasta
do Paulo (folder padrão abaixo, sobrescrevível por GOOGLE_DRIVE_FOLDER_ID).

Credenciais (env Vercel) — preferencial refresh token (não expira):
  GOOGLE_DRIVE_CLIENT_ID + GOOGLE_DRIVE_CLIENT_SECRET + GOOGLE_DRIVE_REFRESH_TOKEN
Ou, modo simples (access token expira em ~1h):
  GOOGLE_DRIVE_TOKEN  (access token direto)

Sem credenciais → 503 com instruções (honesto, não finge). O código de upload é
real e funciona assim que Paulo configurar o token. Escopo OAuth: drive.file.

Resp: { ok, file_id, name, size_bytes, folder_id, uploaded_at }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

# Pasta do Paulo (link compartilhado). Sobrescrevível por env.
DEFAULT_FOLDER_ID = "1cpJVIUxIyIi9C1XNIE-MeNrwRDOLnJSR"
OAUTH_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true"

# Mesmas tabelas do /backup/export (mantém paridade).
BACKUP_TABLES = [
    ("users", 5000, None), ("imoveis", 5000, None), ("lancamentos", 5000, None),
    ("locacoes", 5000, None), ("metas", 5000, None), ("deals", 5000, None),
    ("dir_tasks", 5000, None), ("eventos", 5000, None),
    ("audit_log", 1000, ("ts", "desc")), ("concorrentes", 5000, None),
    ("shared_kv", 5000, None), ("one_on_ones", 5000, None), ("plantoes", 5000, None),
    ("notifications", 1000, ("ts", "desc")), ("captacoes", 5000, None),
    ("recados", 5000, None), ("commissions", 5000, None),
]


def _access_token():
    """Refresh token (preferencial) → access token; senão GOOGLE_DRIVE_TOKEN direto."""
    rt = os.environ.get("GOOGLE_DRIVE_REFRESH_TOKEN")
    cid = os.environ.get("GOOGLE_DRIVE_CLIENT_ID")
    cs = os.environ.get("GOOGLE_DRIVE_CLIENT_SECRET")
    if rt and cid and cs:
        data = urllib.parse.urlencode({
            "client_id": cid, "client_secret": cs,
            "refresh_token": rt, "grant_type": "refresh_token",
        }).encode("utf-8")
        req = urllib.request.Request(OAUTH_URL, data=data, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=20) as r:
            tok = json.loads(r.read().decode("utf-8"))
        if not tok.get("access_token"):
            raise RuntimeError("OAuth Drive: sem access_token (refresh inválido?)")
        return tok["access_token"]
    direct = os.environ.get("GOOGLE_DRIVE_TOKEN")
    if direct:
        return direct
    return None


def _build_dump(sb, actor):
    dump = {"_meta": {"version": "v3", "exported_at": datetime.now(timezone.utc).isoformat(),
                      "exported_by": {"id": actor.get("id"), "name": actor.get("name")},
                      "source": "PSM-OS-v3/drive"}, "tables": {}}
    total, errors = 0, []
    for table, limit, order in BACKUP_TABLES:
        try:
            q = sb.table(table).select("*").limit(limit)
            if order:
                q = q.order(order[0], desc=(order[1] == "desc"))
            rows = q.execute().data or []
            dump["tables"][table] = rows
            total += len(rows)
        except Exception as e:
            errors.append({"table": table, "error": str(e)[:200]})
            dump["tables"][table] = []
    dump["_meta"]["total_rows"] = total
    dump["_meta"]["errors"] = errors
    return dump


def _upload(access_token, folder_id, filename, content_bytes):
    """Multipart/related upload pro Drive."""
    boundary = "psmbkp_boundary_8f3a2c1d"
    meta = {"name": filename, "parents": [folder_id]}
    pre = ("--" + boundary + "\r\n"
           "Content-Type: application/json; charset=UTF-8\r\n\r\n"
           + json.dumps(meta) + "\r\n"
           "--" + boundary + "\r\n"
           "Content-Type: application/json\r\n\r\n").encode("utf-8")
    post = ("\r\n--" + boundary + "--").encode("utf-8")
    body = pre + content_bytes + post
    req = urllib.request.Request(UPLOAD_URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + access_token,
        "Content-Type": "multipart/related; boundary=" + boundary,
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


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
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID") or DEFAULT_FOLDER_ID

        try:
            access = _access_token()
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"OAuth Drive falhou: {e}"})

        if not access:
            return self._send(503, {
                "ok": False,
                "error": "Google Drive não configurado",
                "configured": False,
                "instructions": [
                    "1. console.cloud.google.com → APIs & Services → habilite Google Drive API",
                    "2. Crie OAuth Client ID (Desktop ou Web)",
                    "3. Gere refresh_token (scope https://www.googleapis.com/auth/drive.file) via OAuth Playground",
                    "4. No Vercel adicione: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN",
                    "5. (opcional) GOOGLE_DRIVE_FOLDER_ID — já tem default pra sua pasta",
                    "6. (opcional) Vercel Cron 0 3 * * * → /api/v3/backup/drive (backup diário 3h)",
                ],
                "folder_id": folder_id,
            })

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        dump = _build_dump(sb, actor)
        content = json.dumps(dump, ensure_ascii=False, default=str).encode("utf-8")
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"psm_os_backup_{ts}.json"

        try:
            res = _upload(access, folder_id, filename, content)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:400]
            except Exception:
                pass
            return self._send(502, {"ok": False, "error": f"Drive HTTP {e.code}", "detail": detail})
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"upload falhou: {e}"})

        file_id = res.get("id")
        audit(self, actor, "backup.drive_ok", target_type="system", target_id=file_id,
              notes=f"{filename} {len(content)} bytes → folder {folder_id}")
        return self._send(200, {
            "ok": True,
            "file_id": file_id,
            "name": filename,
            "size_bytes": len(content),
            "rows": dump["_meta"]["total_rows"],
            "folder_id": folder_id,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        })
