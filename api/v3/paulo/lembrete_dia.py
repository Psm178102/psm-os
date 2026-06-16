"""GET /api/v3/paulo/lembrete_dia — aviso no DIA da gravação (Academy) / prazo (Projetos). v77.61
Notifica o responsável das aulas/projetos cuja data é hoje (BRT). Chamado pelo heartbeat
(Authorization: Bearer CRON_SECRET) ou por um diretor (lvl≥7) pra testar.
Dedup: não repete o lembrete do mesmo card no mesmo dia.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify, bearer_from_headers  # type: ignore

CFG = {
    "academy":  {"ico": "🎬", "term": "publicada", "label": "Hoje é dia de gravar", "link": "#/academy-studio"},
    "projetos": {"ico": "📌", "term": "concluido", "label": "Prazo de projeto é hoje", "link": "#/projetos"},
}


def _resolve_user(sb, nome):
    if not nome:
        return None
    try:
        n = nome.strip().lower()
        for r in (sb.table("users").select("id,name").execute().data or []):
            full = (r.get("name") or "").lower()
            if full and (full == n or full.split(" ")[0] == n or n in full):
                return r["id"]
    except Exception:
        pass
    return None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _authorized(self):
        secret = (os.environ.get("CRON_SECRET") or "").strip()
        tok = (bearer_from_headers(self.headers) or "").strip()
        if secret and tok == secret:
            return True
        try:
            require_user(self, min_lvl=7)  # diretoria pode disparar manualmente
            return True
        except AuthError:
            return False

    def do_GET(self):
        if not self._authorized():
            return self._send(401, {"ok": False, "error": "não autorizado"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        hoje = (datetime.now(timezone.utc) - timedelta(hours=3)).date().isoformat()  # BRT
        try:
            cards = (sb.table("paulo_cards")
                     .select("id,board,titulo,plataforma,data_ref,status,responsavel,owner_id")
                     .in_("board", list(CFG.keys())).eq("data_ref", hoje).limit(500).execute().data or [])
        except Exception as e:
            return self._send(200, {"ok": False, "error": str(e)})
        # dedup: cards que já receberam lembrete hoje
        ja = set()
        try:
            ids = [c["id"] for c in cards]
            if ids:
                prev = (sb.table("notifications").select("target_id")
                        .eq("tipo", "lembrete").in_("target_id", ids)
                        .gte("created_at", hoje + "T00:00:00").execute().data or [])
                ja = {p.get("target_id") for p in prev}
        except Exception:
            pass
        enviados = 0
        for c in cards:
            cfg = CFG[c["board"]]
            if c.get("status") == cfg["term"]:
                continue
            if c["id"] in ja:
                continue
            uid = _resolve_user(sb, c.get("responsavel")) or c.get("owner_id")
            if not uid:
                continue
            titulo = (c.get("titulo") or "Sem título")[:80]
            extra = f" ({c.get('plataforma')})" if c.get("plataforma") else ""
            n = notify(uid, "lembrete", f"{cfg['ico']} {cfg['label']}: {titulo}{extra}",
                       "Confira no painel e marque o checklist quando concluir.",
                       link=cfg["link"], target_type="paulo_cards", target_id=c["id"])
            enviados += n or 0
        return self._send(200, {"ok": True, "data": hoje, "cards_hoje": len(cards), "avisos": enviados})
