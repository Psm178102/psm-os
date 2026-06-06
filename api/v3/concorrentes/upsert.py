"""POST /api/v3/concorrentes/upsert"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED = ["nome", "segmento", "anuncios_count", "link", "observacoes", "ultima_atualizacao",
           "slug", "handle", "tipo", "tier", "seguidores", "posts", "creci", "fb", "bio",
           "engajamento", "imoveis_ativos"]


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
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        # Importar base curada (bulk): só insere quem ainda não existe (por slug),
        # nunca sobrescreve edições. Idempotente.
        if body.get("action") == "bulk":
            items = body.get("items") or []
            if not isinstance(items, list) or not items:
                return self._send(400, {"ok": False, "error": "items vazio"})
            rows = []
            for it in items[:500]:
                slug = (it.get("slug") or "").strip()
                nome = (it.get("nome") or "").strip()
                if not slug or not nome:
                    continue
                r = {"slug": slug, "nome": nome, "criado_por": actor["id"],
                     "ultima_atualizacao": datetime.now(timezone.utc).isoformat()}
                for k in ALLOWED:
                    if k in it and it[k] is not None:
                        r[k] = it[k]
                rows.append(r)
            if not rows:
                return self._send(400, {"ok": False, "error": "nenhum item válido"})
            cols_drop = []
            for _ in range(15):
                try:
                    sb.table("concorrentes").upsert(rows, on_conflict="slug", ignore_duplicates=True).execute()
                    break
                except Exception as e:
                    import re as _re
                    m = _re.search(r"Could not find the '([^']+)' column", str(e))
                    if m:
                        c = m.group(1); cols_drop.append(c)
                        for rr in rows: rr.pop(c, None)
                        continue
                    if "slug" in str(e) and "exist" in str(e).lower():
                        return self._send(200, {"ok": False, "pending": True,
                                                "error": "Rode supabase/sprint9_27_concorrentes_rich.sql (coluna slug)."})
                    return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "concorrente.bulk_import", target_type="concorrente", notes=f"{len(rows)} curados")
            return self._send(200, {"ok": True, "count": len(rows), "dropped": cols_drop})

        cid = body.get("id")
        if body.get("_delete") and cid:
            try:
                sb.table("concorrentes").delete().eq("id", cid).execute()
                audit(self, actor, "concorrente.delete", target_type="concorrente", target_id=str(cid))
                return self._send(200, {"ok": True, "deleted": cid})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        if cid:
            patch = {k: body[k] for k in ALLOWED if k in body}
            try:
                sb.table("concorrentes").update(patch).eq("id", cid).execute()
                audit(self, actor, "concorrente.update", target_type="concorrente", target_id=str(cid), after=patch)
                return self._send(200, {"ok": True, "id": cid, "updated": True})
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        nome = (body.get("nome") or "").strip()
        if not nome: return self._send(400, {"ok": False, "error": "nome obrigatório"})
        row = {"criado_por": actor["id"], "ultima_atualizacao": datetime.now(timezone.utc).isoformat()}
        for k in ALLOWED:
            if k in body and body[k] is not None: row[k] = body[k]
        try:
            res = sb.table("concorrentes").insert(row).execute()
            inserted = (res.data or [row])[0]
            audit(self, actor, "concorrente.create", target_type="concorrente", target_id=str(inserted.get("id")), after=row)
            return self._send(200, {"ok": True, "concorrente": inserted, "created": True})
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
