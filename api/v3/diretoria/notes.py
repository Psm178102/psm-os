"""GET/POST/DELETE /api/v3/diretoria/notes — Anotações da diretoria

Notas manuais da diretoria em dois "canais" (kind):
  - kind=atencao  → pontos de atenção escritos à mão (complementam o radar automático)
  - kind=insight  → insights/ideias estratégicas escritos à mão

GET    ?kind=atencao|insight (lvl>=7): lista do canal
POST   (lvl>=7): cria/edita { id?, kind, titulo, texto, prioridade, status, tags }
DELETE ?id=X (lvl>=7)

Upsert TOLERANTE (mesmo padrão de academy/captacoes): se uma coluna ainda não
existe no banco (PGRST204), descarta e salva o resto. Degrada gracioso se a
tabela não existir (front mostra aviso pra rodar o SQL).
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KINDS = {"atencao", "insight"}


def _safe_upsert(sb, table, row):
    r = dict(row)
    dropped = []
    for _ in range(20):
        try:
            return sb.table(table).upsert(r).execute(), dropped
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                dropped.append(m.group(1))
                r.pop(m.group(1), None)
                continue
            raise
    return sb.table(table).upsert(r).execute(), dropped


def _missing(e):
    s = str(e)
    return "diretoria_notes" in s or "does not exist" in s or "schema cache" in s


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        kind = (params.get("kind") or "").strip()
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            q = sb.table("diretoria_notes").select("*")
            if kind in KINDS:
                q = q.eq("kind", kind)
            rows = q.order("updated_at", desc=True).limit(2000).execute().data or []
            return self._send(200, {"ok": True, "notes": rows})
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": True, "notes": [], "pending": True,
                                        "hint": "rode supabase/sprint9_23_diretoria_notes.sql"})
            return self._send(500, {"ok": False, "error": str(e)})

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

        kind = (body.get("kind") or "").strip()
        if kind not in KINDS:
            return self._send(400, {"ok": False, "error": "kind inválido (atencao|insight)"})
        titulo = (body.get("titulo") or "").strip()
        if not titulo:
            return self._send(400, {"ok": False, "error": "Título é obrigatório"})

        is_new = not body.get("id")
        cid = body.get("id") or f"note_{int(datetime.now().timestamp()*1000)}"
        row = {
            "id": cid,
            "kind": kind,
            "titulo": titulo,
            "texto": (body.get("texto") or "").strip() or None,
            "prioridade": (body.get("prioridade") or "media").strip() or "media",
            "status": (body.get("status") or "aberto").strip() or "aberto",
            "tags": (body.get("tags") or "").strip() or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if is_new:
            row["autor"] = actor.get("id")
            row["autor_nome"] = actor.get("name")

        try:
            r, dropped = _safe_upsert(sb, "diretoria_notes", row)
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": False, "pending": True,
                                        "error": "Tabela diretoria_notes ainda não existe — rode supabase/sprint9_23_diretoria_notes.sql"})
            return self._send(500, {"ok": False, "error": str(e)})
        if dropped:
            print(f"[notes] colunas ausentes ignoradas (rode sprint9_23_diretoria_notes.sql): {dropped}")

        audit(self, actor, "diretoria.note.upsert", target_type="diretoria_notes", target_id=cid,
              notes=f"{kind} · {titulo}")
        return self._send(200, {"ok": True, "row": (r.data or [row])[0], "dropped": dropped})

    def do_DELETE(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        cid = params.get("id")
        if not cid:
            return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("diretoria_notes").delete().eq("id", cid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "diretoria.note.delete", target_type="diretoria_notes", target_id=cid)
        return self._send(200, {"ok": True})
