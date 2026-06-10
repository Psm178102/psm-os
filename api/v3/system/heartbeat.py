"""GET /api/v3/system/heartbeat — cron de auto-cura PELO USO (v77.31).
O agendador do Vercel é não-confiável no plano atual (5 crons configurados,
plano suporta 2 rodando 1×/dia) — captar_cron (*/2min) e meta_cache (*/10min)
NUNCA rodaram como esperado, e o war briefing semanal depende de sorte.

Solução: o frontend chama este endpoint no boot (debounce 20min/navegador).
Ele olha a tabela cron_state e executa NO MÁXIMO 1 job vencido por chamada
(request curta), via self-call HTTP ao próprio cron com o CRON_SECRET do
servidor (nada exposto ao cliente). Com o uso diário do sistema, tudo converge:
  • captar          — a cada 2h   (varre etapa CAPTAR IMÓVEL → cria captações)
  • meta_monthly    — a cada 24h  (arquiva histórico mensal do Meta)
  • war_briefing    — semanal     (gera o Briefing de Guerra a partir de segunda)
Os 2 slots de cron reais do Vercel ficam pros diários críticos (sync RD +
meta_monthly) como primeira linha; o heartbeat é a rede que NUNCA falha junto.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

JOBS = [
    # (key, path, intervalo_horas)  — ordem = prioridade
    ("captar",       "/api/v3/crm/captar_cron",             2),
    ("meta_monthly", "/api/v3/marketing/meta_monthly_cron", 24),
    ("war_briefing", "/api/v3/intel/war_briefing_cron",     None),  # semanal (lógica própria)
]


def _monday_utc(now):
    m = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return m


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        secret = os.environ.get("CRON_SECRET", "").strip()
        if not secret:
            return self._send(200, {"ok": False, "error": "CRON_SECRET ausente — heartbeat inativo"})

        now = datetime.now(timezone.utc)
        try:
            rows = sb.table("cron_state").select("key,ran_at").execute().data or []
        except Exception as e:
            return self._send(200, {"ok": False, "error": f"cron_state: {e} — rode supabase/sprint_cron_state.sql"})
        ran = {}
        for r in rows:
            try:
                ran[r["key"]] = datetime.fromisoformat(str(r["ran_at"]).replace("Z", "+00:00"))
            except Exception:
                pass

        # escolhe o 1º job vencido (ordem = prioridade); executa só 1 por chamada
        alvo = None
        for key, path, hours in JOBS:
            last = ran.get(key)
            if hours is None:  # semanal: roda 1× por semana, a partir de segunda 00:00 UTC
                if last is None or last < _monday_utc(now):
                    alvo = (key, path)
                    break
            else:
                if last is None or (now - last) > timedelta(hours=hours):
                    alvo = (key, path)
                    break
        if not alvo:
            return self._send(200, {"ok": True, "idle": True, "jobs": {k: ran.get(k) for k, _, _ in JOBS}})

        key, path = alvo
        prev = ran.get(key)
        # marca ANTES (evita corrida de 2 boots simultâneos); reverte se falhar
        try:
            sb.table("cron_state").upsert({"key": key, "ran_at": now.isoformat(), "note": "heartbeat"},
                                          on_conflict="key").execute()
        except Exception as e:
            return self._send(200, {"ok": False, "error": f"lock: {e}"})

        host = (self.headers.get("Host") or "www.housepsm.com.br").split(",")[0].strip()
        url = f"https://{host}{path}"
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {secret}",
                                                       "User-Agent": "PSM-OS-heartbeat"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = (r.read().decode("utf-8") or "")[:300]
                return self._send(200, {"ok": True, "ran": key, "status": r.status, "resp": body})
        except Exception as e:
            # falhou → devolve o ran_at antigo pro próximo heartbeat tentar de novo
            try:
                if prev:
                    sb.table("cron_state").upsert({"key": key, "ran_at": prev.isoformat(),
                                                   "note": f"falha: {str(e)[:120]}"}, on_conflict="key").execute()
                else:
                    sb.table("cron_state").delete().eq("key", key).execute()
            except Exception:
                pass
            return self._send(200, {"ok": False, "ran": key, "error": str(e)[:200]})
