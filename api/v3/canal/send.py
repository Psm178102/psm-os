"""POST /api/v3/canal/send — envia mensagem ao Canal Anônimo

Qualquer usuário autenticado (lvl>=2). Pode ser anônimo ou identificado.
Body: { msg (obrigatório), identificar (bool), nome?, anexo? (base64), anexo_name?, anexo_type? }

A msg vai pra tabela canal_anonimo. Diretores (lvl>=7) recebem notification.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify  # type: ignore


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
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        msg = (body.get("msg") or "").strip()
        if not msg: return self._send(400, {"ok": False, "error": "msg obrigatória"})
        if len(msg) > 5000: return self._send(400, {"ok": False, "error": "msg muito longa (máx 5000)"})

        identificar = bool(body.get("identificar"))
        nome = "Anônimo"
        if identificar:
            n = (body.get("nome") or "").strip()
            nome = n or (actor.get("name") or "Identificado sem nome")

        # Anexo (base64). Limit 2MB pra não explodir o banco.
        anexo_data = body.get("anexo") or None
        anexo_name = (body.get("anexo_name") or "").strip() or None
        anexo_type = (body.get("anexo_type") or "").strip() or None
        if anexo_data and len(anexo_data) > 2 * 1024 * 1024 * 1.4:  # ~2MB base64
            return self._send(400, {"ok": False, "error": "anexo muito grande (máx 2MB)"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        row = {
            "de": nome,
            "msg": msg,
            "anexo": anexo_name,
            "anexo_data": anexo_data,
            "anexo_type": anexo_type,
            "lido": False,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        try:
            r = sb.table("canal_anonimo").insert(row).execute()
            inserted = (r.data or [{}])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Audit (NÃO inclui o conteúdo da msg pra preservar anonimato real)
        audit(self, actor, "canal.send", target_type="canal_anonimo",
              target_id=str(inserted.get("id")),
              notes=f"{'identificado' if identificar else 'anônimo'} msg_len={len(msg)} anexo={'sim' if anexo_data else 'não'}")

        # Notifica diretores (lvl>=7)
        try:
            dirs = sb.table("users").select("id").gte("lvl", 7).execute().data or []
            dir_ids = [d["id"] for d in dirs if d.get("id")]
            if dir_ids:
                notify(dir_ids, "canal",
                       f"📬 Nova mensagem no Canal Anônimo ({nome})",
                       msg[:120] + ("..." if len(msg) > 120 else ""),
                       link="/v2/canal",
                       target_type="canal_anonimo",
                       target_id=str(inserted.get("id")))
        except Exception:
            pass  # notify falhou, mas msg foi gravada

        return self._send(200, {"ok": True, "id": inserted.get("id")})
