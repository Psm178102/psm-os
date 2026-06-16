"""GET/POST/DELETE /api/v3/paulo/cards — boards pessoais do Paulo (v77.48).
  board=negocios  → "Meus Negócios" do Paulo (PRIVADO por dono — não é a imobiliária).
  board=conteudo  → conteúdo da marca Paulo Morimatsu (COMPARTILHADO: Paulo + marketing),
                    organizado por plataforma (IG/TikTok/YouTube) e etapa.

GET    ?board=negocios|conteudo            → { ok, cards:[...] }
POST   {action:'upsert', board, ...campos} → cria/edita (gera id se novo)
POST   {action:'move', id, status}         → muda etapa
POST   {action:'delete', id}               → apaga
lvl>=7 (Diretoria/Sócio). negocios é filtrado pelo dono; conteudo é compartilhado.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

FIELDS = ["titulo", "status", "plataforma", "formato", "valor", "link", "data_ref", "obs", "ordem", "semana", "responsavel", "checklist"]
BOARDS = ("negocios", "conteudo", "conteudo_imoveis", "conteudo_conquista", "academy")
CONTEUDO_BOARDS = ("conteudo", "conteudo_imoveis", "conteudo_conquista", "academy")  # compartilhados, lvl>=3


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=3)  # conteudo: marketing+ ; negocios: trava em 7 abaixo
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        board = q.get("board") if q.get("board") in BOARDS else "negocios"
        if board == "negocios" and (actor.get("lvl") or 0) < 7:
            return self._send(403, {"ok": False, "error": "negócios pessoais: requer nível ≥ 7"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            qq = sb.table("paulo_cards").select("*").eq("board", board)
            if board == "negocios":   # privado por dono
                qq = qq.eq("owner_id", actor.get("id"))
            rows = qq.order("ordem").order("created_at").limit(1000).execute().data or []
        except Exception as e:
            return self._send(200, {"ok": False, "error": str(e), "cards": [], "pending": "rode supabase/sprint_paulo_e_captstale.sql"})
        return self._send(200, {"ok": True, "board": board, "cards": rows})

    def _board_of(self, sb, cid):
        try:
            r = sb.table("paulo_cards").select("board").eq("id", cid).limit(1).execute().data or []
            return (r[0].get("board") if r else None)
        except Exception:
            return None

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=3)  # conteudo: marketing+ ; negocios: trava em 7 abaixo
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        action = body.get("action") or "upsert"
        now = datetime.now(timezone.utc).isoformat()
        is_socio = (actor.get("lvl") or 0) >= 7

        if action == "delete":
            cid = body.get("id")
            if not cid:
                return self._send(400, {"ok": False, "error": "id"})
            if self._board_of(sb, cid) == "negocios" and not is_socio:
                return self._send(403, {"ok": False, "error": "negócios pessoais: requer nível ≥ 7"})
            try:
                sb.table("paulo_cards").delete().eq("id", cid).execute()
                audit(self, actor, "paulo.card_delete", target_type="paulo_cards", target_id=cid)
                return self._send(200, {"ok": True, "deleted": cid})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        if action == "move":
            cid = body.get("id"); status = (body.get("status") or "").strip()
            if not cid or not status:
                return self._send(400, {"ok": False, "error": "id e status"})
            if self._board_of(sb, cid) == "negocios" and not is_socio:
                return self._send(403, {"ok": False, "error": "negócios pessoais: requer nível ≥ 7"})
            try:
                sb.table("paulo_cards").update({"status": status, "updated_at": now}).eq("id", cid).execute()
                return self._send(200, {"ok": True})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        if action == "bulk":
            # importação em lote (planilha de conteúdo). Qualquer board de conteúdo. v77.55+
            bb = body.get("board") if body.get("board") in CONTEUDO_BOARDS else "conteudo"
            items = body.get("cards") or []
            if not isinstance(items, list) or not items:
                return self._send(400, {"ok": False, "error": "cards vazio"})
            rows = []
            for it in items[:500]:
                r = {k: it.get(k) for k in FIELDS if k in it}
                for k in ("titulo", "status", "plataforma", "formato", "link", "obs", "data_ref", "responsavel"):
                    if k in r and (r[k] is None or str(r[k]).strip() == ""):
                        r[k] = None
                if "semana" in r:
                    try: r["semana"] = int(r["semana"]) if r["semana"] not in (None, "") else None
                    except Exception: r["semana"] = None
                if not r.get("titulo"):
                    continue
                r.update({"id": "pc_" + uuid.uuid4().hex[:12], "board": bb,
                          "owner_id": actor.get("id"), "status": r.get("status") or "curadoria",
                          "created_at": now, "updated_at": now})
                rows.append(r)
            if not rows:
                return self._send(400, {"ok": False, "error": "nenhuma linha válida"})
            try:
                sb.table("paulo_cards").insert(rows).execute()
                audit(self, actor, "paulo.bulk_import", target_type="paulo_cards", notes=f"{len(rows)} conteúdos")
                return self._send(200, {"ok": True, "inserted": len(rows)})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

        # upsert
        board = body.get("board") if body.get("board") in BOARDS else "negocios"
        if board == "negocios" and not is_socio:
            return self._send(403, {"ok": False, "error": "negócios pessoais: requer nível ≥ 7"})
        # editar card existente de negocios também trava abaixo de 7
        if body.get("id") and self._board_of(sb, body.get("id")) == "negocios" and not is_socio:
            return self._send(403, {"ok": False, "error": "negócios pessoais: requer nível ≥ 7"})
        cid = body.get("id")
        row = {k: body.get(k) for k in FIELDS if k in body}
        # normaliza vazios
        for k in ("titulo", "status", "plataforma", "formato", "link", "obs", "data_ref", "responsavel"):
            if k in row and (row[k] is None or str(row[k]).strip() == ""):
                row[k] = None
        if "valor" in row:
            try: row["valor"] = float(row["valor"]) if row["valor"] not in (None, "") else None
            except Exception: row["valor"] = None
        if "semana" in row:
            try: row["semana"] = int(row["semana"]) if row["semana"] not in (None, "") else None
            except Exception: row["semana"] = None
        row["updated_at"] = now
        try:
            if cid:
                sb.table("paulo_cards").update(row).eq("id", cid).execute()
            else:
                cid = "pc_" + uuid.uuid4().hex[:12]
                row.update({"id": cid, "board": board, "owner_id": actor.get("id"), "created_at": now})
                if not row.get("status"):
                    row["status"] = "ideia" if board == "negocios" else "curadoria"
                sb.table("paulo_cards").insert(row).execute()
            audit(self, actor, "paulo.card_upsert", target_type="paulo_cards", target_id=cid)
            return self._send(200, {"ok": True, "id": cid})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_DELETE(self):
        # alias p/ ?id=
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        self.rfile = self.rfile  # noop
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        cid = q.get("id")
        if not cid:
            return self._send(400, {"ok": False, "error": "id"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("paulo_cards").delete().eq("id", cid).execute()
            return self._send(200, {"ok": True, "deleted": cid})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
