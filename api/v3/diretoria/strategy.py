"""GET/POST /api/v3/diretoria/strategy — Quadros da Estratégia (documentos JSON)

Guarda os artefatos visuais da aba Estratégia como documentos JSON, um por
"board":
  - board=mindmap    → mapa mental estratégico {nodes:[{id,text,x,y,color,parent}]}
  - board=orgchart   → organograma editável  {nodes:[...]}
  - board=cronograma → cronograma            {items:[{id,titulo,tipo,periodo,status,responsavel,obs}]}

GET  ?board=<nome>  (lvl>=7) → { ok, board, data }
POST { board, data } (lvl>=7) → upsert do documento inteiro

Tabela: estrategia_boards (board text pk, data jsonb, updated_at). Degrada
gracioso se a tabela não existir (front mostra aviso pra rodar o SQL).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

BOARDS = {"mindmap", "orgchart", "cronograma", "dados_mercado", "custos_compartilhados", "sim_trafego"}


def _missing(e):
    s = str(e)
    return "estrategia_boards" in s or "does not exist" in s or "schema cache" in s


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
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
        board = (params.get("board") or "").strip()
        if board not in BOARDS:
            return self._send(400, {"ok": False, "error": "board inválido (mindmap|orgchart|cronograma)"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("estrategia_boards").select("data,updated_at").eq("board", board).limit(1).execute().data or []
            data = (rows[0].get("data") if rows else None) or {}
            return self._send(200, {"ok": True, "board": board, "data": data,
                                    "updated_at": (rows[0].get("updated_at") if rows else None)})
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": True, "board": board, "data": {}, "pending": True,
                                        "hint": "rode supabase/sprint9_24_estrategia.sql"})
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

        board = (body.get("board") or "").strip()
        if board not in BOARDS:
            return self._send(400, {"ok": False, "error": "board inválido"})
        data = body.get("data")
        if not isinstance(data, (dict, list)):
            return self._send(400, {"ok": False, "error": "data deve ser objeto/lista"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("estrategia_boards").upsert(
                {"board": board, "data": data, "updated_at": datetime.now(timezone.utc).isoformat()},
                on_conflict="board",
            ).execute()
        except Exception as e:
            if _missing(e):
                return self._send(200, {"ok": False, "pending": True,
                                        "error": "Tabela estrategia_boards ainda não existe — rode supabase/sprint9_24_estrategia.sql"})
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "estrategia.board.save", target_type="estrategia_boards", target_id=board)
        return self._send(200, {"ok": True, "board": board})
