"""
GET/POST /api/v3/agenda/prefs — lembretes e conexões da Agenda & Tarefas do usuário logado. v87.81

GET  → { ok, prefs:{lembrete_evento_min, lembrete_tarefa_min, resumo_diario},
         ics_url|null, push:{configurado, inscricoes}, lembrete_por_item }
POST { prefs:{...} }              → grava as preferências (só as chaves conhecidas)
POST { action:"ics_gerar" }       → cria/troca o link secreto de assinatura (o antigo para de funcionar)
POST { action:"ics_revogar" }     → desliga o link de assinatura
POST { action:"teste" }           → manda uma notificação de teste pra VOCÊ (sino + push)

Cada um só lê e grava o PRÓPRIO registro (shared_kv agenda_prefs::<uid>).
"""
from http.server import BaseHTTPRequestHandler
import json, os, secrets, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
import _agenda_prefs as P  # type: ignore


def _base_url(h):
    host = h.headers.get("x-forwarded-host") or h.headers.get("Host") or "www.housepsm.com.br"
    proto = h.headers.get("x-forwarded-proto") or ("http" if host.startswith(("localhost", "127.")) else "https")
    return f"{proto}://{host}"


def _ics_url(h, uid, token):
    return f"{_base_url(h)}/api/v3/agenda/ics?u={uid}&k={token}" if token else None


def _lembrete_por_item(sb):
    """A coluna lembrete_min existe? (migração v87.81). Sem ela o lembrete é só o padrão."""
    try:
        sb.table("eventos").select("lembrete_min").limit(1).execute()
        return True
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _estado(self, sb, uid, prefs):
        try:
            n = len(sb.table("push_subscriptions").select("endpoint").eq("user_id", uid).execute().data or [])
        except Exception:
            n = 0
        publico = {k: prefs.get(k) for k in P.DEFAULTS}
        return {"ok": True, "prefs": publico, "opcoes_min": list(P.OPCOES_MIN),
                "ics_url": _ics_url(self, uid, prefs.get("ics_token")),
                "push": {"configurado": bool(os.environ.get("VAPID_PRIVATE_KEY")), "inscricoes": n},
                "lembrete_por_item": _lembrete_por_item(sb)}

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, self._estado(sb, user["id"], P.ler(sb, user["id"])))

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        uid = user["id"]
        acao = (body.get("action") or "").strip().lower()
        try:
            if acao == "ics_gerar":
                prefs = P.gravar(sb, uid, {"ics_token": secrets.token_urlsafe(24)})
                audit(self, user, "agenda.ics.gerar", target_type="agenda_prefs", target_id=uid)
            elif acao == "ics_revogar":
                prefs = P.gravar(sb, uid, {"ics_token": None})
                audit(self, user, "agenda.ics.revogar", target_type="agenda_prefs", target_id=uid)
            elif acao == "teste":
                notify_all([uid], tipo="agenda.lembrete", title="🔔 Teste de notificação",
                           body="Se chegou no seu celular/navegador, os lembretes da agenda vão chegar também.",
                           link="#/", target_type="agenda_teste", target_id=uid)
                prefs = P.ler(sb, uid)
            else:
                entrada = body.get("prefs") if isinstance(body.get("prefs"), dict) else {}
                limpo = {}
                for k in ("lembrete_evento_min", "lembrete_tarefa_min"):
                    if k in entrada:
                        v = P.minutos(entrada[k], None)
                        if v is None:
                            return self._send(400, {"ok": False, "error": f"{k} inválido"})
                        limpo[k] = v
                if "resumo_diario" in entrada:
                    limpo["resumo_diario"] = bool(entrada["resumo_diario"])
                if not limpo:
                    return self._send(400, {"ok": False, "error": "nada para salvar"})
                prefs = P.gravar(sb, uid, limpo)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        return self._send(200, self._estado(sb, uid, prefs))
