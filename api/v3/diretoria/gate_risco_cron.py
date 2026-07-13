"""
GET /api/v3/diretoria/gate_risco_cron — ALERTA DE GATE EM RISCO (dia 20). v84.21

Regra 8 do plano: cada gate compra o direito do próximo mês. No dia 20, se o
mês está abaixo de 50% da meta (Conquista OU VGV próprio), a diretoria recebe
🔴 com o buraco em reais — 10 dias pra reagir, não uma surpresa no dia 31.
Cron: 0 12 20 * * (9h BRT do dia 20). Auth: CRON_SECRET ou lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify_all, lvl_of  # type: ignore
from plano_resgate import _kv_get, _real, SEED  # type: ignore

BRT = timezone(timedelta(hours=-3))


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):
            try:
                require_user(self, min_lvl=7)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        plano = _kv_get(sb) or SEED
        real = _real(sb, plano)
        mes = next((m for m in plano.get("meses", []) if m["id"] == real.get("mes_id")), None)
        if not mes:
            return self._send(200, {"ok": True, "skip": "mês fora do plano"})
        vgv = real.get("vgv") or {}
        riscos = []
        for rotulo, real_v, meta_v in (
                ("Conquista", vgv.get("conquista", 0), float(mes.get("conquista") or 0)),
                ("VGV próprio", vgv.get("map", 0) + vgv.get("terceiros", 0), float(mes.get("proprio") or 0))):
            if meta_v > 0 and real_v / meta_v < 0.5:
                riscos.append(f"{rotulo}: R$ {real_v:,.2f} de R$ {meta_v:,.2f} "
                              f"({100 * real_v / meta_v:.0f}%) — buraco de R$ {meta_v - real_v:,.2f}")
        notified = 0
        if riscos:
            corpo = (f"Dia 20 de {mes.get('nome')} e o gate está em risco:\n" + "\n".join("• " + r for r in riscos)
                     + f"\nGate do mês: {mes.get('gate')}. Restam ~10 dias.")
            try:
                users = sb.table("users").select("id,role,status").execute().data or []
                alvo = [u["id"] for u in users if u.get("id") and (u.get("status") or "ativo") == "ativo"
                        and lvl_of(u.get("role")) >= 7]
                if alvo:
                    notified = notify_all(alvo, "fiscalizacao", "🔴 GATE DO MÊS EM RISCO",
                                          body=corpo[:400], link="#/estrategia")
            except Exception:
                pass
        return self._send(200, {"ok": True, "riscos": riscos, "notified": notified})
