"""GET/POST/DELETE /api/v3/diretoria/academy — PSM Academy (academia interna)

Biblioteca de treinamento PSM: trilhas, playbooks, scripts, vídeos e docs.
Conteúdo real cadastrado pela diretoria (links Drive/YouTube ou texto inline).

GET    (lvl>=2): lista todos os itens (qualquer logado consome o conteúdo)
POST   (lvl>=7): cria/edita item (gerência/diretoria)
DELETE ?id=X (lvl>=7)

Upsert TOLERANTE (mesmo padrão das captações): se uma coluna ainda não existe
no banco (migração não rodada → PGRST204), descarta essa coluna e salva o resto.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


def _safe_upsert(sb, table, row):
    """Upsert tolerante a colunas ausentes (PGRST204): remove a coluna que não
    existe e tenta de novo, em vez de quebrar o save inteiro."""
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
            require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = (sb.table("academy_items").select("*")
                    .order("trilha").order("ordem").order("updated_at", desc=True)
                    .limit(2000).execute().data or [])
            return self._send(200, {"ok": True, "items": rows})
        except Exception as e:
            # tabela ainda não criada → degrada gracioso (front mostra aviso)
            if "academy_items" in str(e) or "does not exist" in str(e):
                return self._send(200, {"ok": True, "items": [], "pending": True,
                                        "hint": "rode supabase/sprint9_22_academy.sql"})
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

        titulo = (body.get("titulo") or "").strip()
        if not titulo:
            return self._send(400, {"ok": False, "error": "Título é obrigatório"})

        is_new = not body.get("id")
        cid = body.get("id") or f"acad_{int(datetime.now().timestamp()*1000)}"

        def _int(v, d=0):
            try:
                return int(v)
            except Exception:
                return d

        row = {
            "id": cid,
            "trilha": (body.get("trilha") or "Geral").strip() or "Geral",
            "tipo": (body.get("tipo") or "link").strip() or "link",
            "titulo": titulo,
            "descricao": (body.get("descricao") or "").strip() or None,
            "url": (body.get("url") or "").strip() or None,
            "conteudo": (body.get("conteudo") or "").strip() or None,
            "cargo": (body.get("cargo") or "todos").strip() or "todos",
            "nivel": (body.get("nivel") or "").strip() or None,
            "duracao": (body.get("duracao") or "").strip() or None,
            "tags": (body.get("tags") or "").strip() or None,
            "ordem": _int(body.get("ordem"), 0),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if is_new:
            row["criado_por"] = actor.get("id")

        try:
            r, dropped = _safe_upsert(sb, "academy_items", row)
        except Exception as e:
            if "academy_items" in str(e) or "does not exist" in str(e):
                return self._send(200, {"ok": False, "pending": True,
                                        "error": "Tabela academy_items ainda não existe — rode supabase/sprint9_22_academy.sql"})
            return self._send(500, {"ok": False, "error": str(e)})
        if dropped:
            print(f"[academy] colunas ausentes ignoradas (rode sprint9_22_academy.sql): {dropped}")

        audit(self, actor, "academy.upsert", target_type="academy_items", target_id=cid,
              notes=f"{row['trilha']} · {titulo}")
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
            sb.table("academy_items").delete().eq("id", cid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "academy.delete", target_type="academy_items", target_id=cid)
        return self._send(200, {"ok": True})
