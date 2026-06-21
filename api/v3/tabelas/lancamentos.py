"""
GET/POST /api/v3/tabelas/lancamentos — Tabelas de lançamentos NATIVAS (editor no sistema). v81.3

Em vez de subir xlsx (que renderizava feio), o gestor monta a tabela direto no sistema:
linhas e colunas editáveis. Organizado por MARCA (conquista | imoveis) e CATEGORIA livre
(ex.: MAP dentro de PSM Imóveis). Pode importar xlsx só pra preencher a grade.

shared_kv 'tabelas_lancamentos' = { "tabelas": [
   { id, marca: 'conquista'|'imoveis', categoria, colunas:[str], linhas:[[cell]],
     atualizado_em, por }
] }

GET  (lvl >= 2): { ok, tabelas, can_edit }
POST (lvl >= 5): action save  { tabela:{id?,marca,categoria,colunas,linhas} }
                 action delete { id }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "tabelas_lancamentos"
MARCAS = ("conquista", "imoveis")
MAX_TABELAS = 60
MAX_COLS = 60
MAX_LINHAS = 5000


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
    except Exception:
        v = {}
    ts = (v or {}).get("tabelas") if isinstance(v, dict) else None
    out = []
    if isinstance(ts, list):
        for t in ts:
            if not isinstance(t, dict):
                continue
            out.append({
                "id": str(t.get("id") or ""),
                "marca": t.get("marca") if t.get("marca") in MARCAS else "imoveis",
                "categoria": str(t.get("categoria") or "")[:120],
                "colunas": [str(c)[:200] for c in (t.get("colunas") or [])][:MAX_COLS],
                "linhas": [[("" if c is None else str(c))[:500] for c in (r or [])[:MAX_COLS]]
                           for r in (t.get("linhas") or [])[:MAX_LINHAS] if isinstance(r, list)],
                "atualizado_em": t.get("atualizado_em"),
                "por": t.get("por"),
            })
    return out


def _write(sb, tabelas):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"tabelas": tabelas},
                                 "updated_at": datetime.now(timezone.utc).isoformat()},
                                on_conflict="key").execute()


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
            return self._send(200, {"ok": True, "tabelas": _read(sb),
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

        action = (body.get("action") or "save").strip()
        try:
            sb = supabase_client()
            tabelas = _read(sb)

            if action == "delete":
                tid = str(body.get("id") or "")
                tabelas = [t for t in tabelas if t["id"] != tid]
            else:  # save
                t = body.get("tabela") or {}
                marca = t.get("marca") if t.get("marca") in MARCAS else "imoveis"
                colunas = [str(c)[:200] for c in (t.get("colunas") or [])][:MAX_COLS]
                linhas = []
                for r in (t.get("linhas") or [])[:MAX_LINHAS]:
                    if isinstance(r, list):
                        linhas.append([("" if c is None else str(c))[:500] for c in r[:MAX_COLS]])
                rec = {
                    "id": str(t.get("id") or "") or ("tbl_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")),
                    "marca": marca, "categoria": str(t.get("categoria") or "Sem categoria")[:120],
                    "colunas": colunas, "linhas": linhas,
                    "atualizado_em": datetime.now(timezone.utc).isoformat(), "por": actor.get("id"),
                }
                if len(tabelas) >= MAX_TABELAS and not any(x["id"] == rec["id"] for x in tabelas):
                    return self._send(400, {"ok": False, "error": "limite de tabelas atingido"})
                tabelas = [rec if x["id"] == rec["id"] else x for x in tabelas]
                if not any(x["id"] == rec["id"] for x in tabelas):
                    tabelas.append(rec)

            _write(sb, tabelas)
            try:
                audit(self, actor, "tabela_lancamento_" + action, "kv", KV_KEY, notes=None)
            except Exception:
                pass
            return self._send(200, {"ok": True, "tabelas": _read(sb)})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
