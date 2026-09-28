"""
GET /api/v3/intel/war_briefing_cron
Header: Authorization: Bearer <CRON_SECRET>

Cron semanal (segunda 10:00 UTC ≈ 07:00 BRT): gera o Briefing de Guerra da
semana (compila vendas + mídia + concorrência → IA), salva e notifica a
gerência/diretoria. Máquina-a-máquina (sem JWT).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, audit, notify_all, lvl_of  # type: ignore
from _briefing_lib import generate_and_store  # type: ignore


def _verify_cron(headers):
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False, "CRON_SECRET ausente no Vercel"
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False, "Authorization ausente"
    return (auth[7:].strip() == secret), ("CRON_SECRET inválido" if auth[7:].strip() != secret else "")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        ok, msg = _verify_cron(self.headers)
        if not ok:
            return self._send(401, {"ok": False, "error": msg})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "Supabase indisponível"})
        # v88.82: 1 briefing automático por semana. Heartbeat + cron do Vercel chamavam os dois e
        # saíam 2-3 briefings na mesma semana (e o de domingo 21h zerava as ordens). Semana = a partir
        # de segunda 10h UTC (07h BRT). ?force=1 gera mesmo assim.
        if "force=1" not in (self.path or ""):
            agora = datetime.now(timezone.utc)
            ancora = (agora - timedelta(days=agora.weekday())).replace(hour=10, minute=0, second=0, microsecond=0)
            if agora < ancora:
                ancora -= timedelta(days=7)
            try:
                ja = (sb.table("war_briefings").select("id").is_("criado_por", "null")
                      .gte("created_at", ancora.isoformat()).limit(1).execute().data or [])
            except Exception:
                ja = []
            if ja:
                return self._send(200, {"ok": True, "skipped": "briefing desta semana já saiu", "desde": ancora.isoformat()})
        try:
            out = generate_and_store(sb, actor_id=None)
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)})

        # Notifica gerência/diretoria (lvl>=7)
        notified = 0
        try:
            users = sb.table("users").select("id,role,status").execute().data or []
            alvo = [u.get("id") for u in users
                    if u.get("id") and (u.get("status") or "ativo") == "ativo"
                    and lvl_of(u.get("role")) >= 10]   # v88.82: seção Inteligência = só sócio
            if alvo:
                notified = notify_all(alvo, "briefing",
                                      "📋 Briefing da semana",
                                      "O briefing e as ordens da semana estão prontos. Assuma ou delegue cada ordem.",
                                      link="#/briefing-guerra",
                                      target_type="war_briefing")
        except Exception as e:
            print(f"[war_briefing_cron] notify: {e}")

        audit(self, None, "intel.war_briefing_cron", target_type="war_briefings",
              target_id="*", notes=f"saved={out.get('saved')} notified={notified} model={out.get('model')}")
        return self._send(200, {"ok": True, "saved": out.get("saved"), "model": out.get("model"),
                                "notified": notified, "at": datetime.now(timezone.utc).isoformat()})
