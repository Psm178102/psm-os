"""
GET/POST /api/v3/tabelas/dados — Dados RENDERIZÁVEIS da Tabela de Imóveis (mês). v81.0

Antes a tabela (xlsx/csv) era embutida num iframe → o navegador BAIXAVA o arquivo
em vez de exibir. Agora o front parseia a planilha no upload e guarda as linhas aqui;
a página renderiza como TABELA HTML (com busca, cabeçalho fixo). Por equipe: conquista, map.

shared_kv: 'tabela_dados_conquista' / 'tabela_dados_map' =
  { colunas: [str], linhas: [[cell]], filename, atualizado_em, url }

GET  (lvl >= 2): { ok, conquista, map }
POST (lvl >= 5): { equipe: 'conquista'|'map', colunas, linhas, filename, url }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

EQUIPES = ("conquista", "map")
MAX_LINHAS = 5000
MAX_COLS = 60
KEY = lambda e: "tabela_dados_" + e


def _read(sb, e):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KEY(e)).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            return self._send(200, {"ok": True, "conquista": _read(sb, "conquista"),
                                    "map": _read(sb, "map"),
                                    "can_edit": (user.get("lvl") or 0) >= 5})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

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

        equipe = (body.get("equipe") or "").strip().lower()
        if equipe not in EQUIPES:
            return self._send(400, {"ok": False, "error": "equipe inválida (conquista|map)"})

        colunas = [str(c)[:200] for c in (body.get("colunas") or [])][:MAX_COLS]
        linhas = []
        for r in (body.get("linhas") or [])[:MAX_LINHAS]:
            if isinstance(r, list):
                linhas.append([("" if c is None else str(c))[:500] for c in r[:MAX_COLS]])
        doc = {
            "colunas": colunas, "linhas": linhas,
            "filename": str(body.get("filename") or "")[:200],
            "url": str(body.get("url") or "")[:1000],
            "atualizado_em": datetime.now(timezone.utc).isoformat(),
            "atualizado_por": actor.get("id"),
        }
        try:
            sb = supabase_client()
            sb.table("shared_kv").upsert({"key": KEY(equipe), "value": doc,
                                         "updated_at": datetime.now(timezone.utc).isoformat()},
                                        on_conflict="key").execute()
            try:
                audit(self, actor, "tabela_dados_save", "kv", KEY(equipe), notes=f"{len(linhas)} linhas")
            except Exception:
                pass
            return self._send(200, {"ok": True, "n": len(linhas)})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
