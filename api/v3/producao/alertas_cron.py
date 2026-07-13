"""
GET /api/v3/producao/alertas_cron — cobrança das 14h (cron dias úteis 17h UTC). v84.18

🟡 <50% da meta do dia até as 14h → gestores (por colaborador de motor diário)
+ repassa as checagens de doc/ticket (dedupe compartilhado — se o pulso do painel
já avisou hoje, não repete).

Auth: Bearer CRON_SECRET ou lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify_all  # type: ignore
from _fisc_lib import (get_cfg, agora_brt, janelas, eventos_periodo, contadores,  # type: ignore
                       esperado_agora, checar_alertas, gestores_ids, _kv, _kv_set, KV_ALERTAS)


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
        cfg = get_cfg(sb)
        now = agora_brt()
        _, _, mes_ini = janelas(now)
        eventos = eventos_periodo(sb, (mes_ini - timedelta(days=15)).astimezone(timezone.utc).isoformat())
        cont = contadores(eventos, cfg, now)

        avisos = []
        gids = gestores_ids(sb)
        enviados = _kv(sb, KV_ALERTAS)
        hoje = now.strftime("%Y-%m-%d")
        for key, c in (cfg.get("colaboradores") or {}).items():
            motor = c.get("motor")
            if not motor or motor == "mes_composto":
                continue
            m = (c.get("metas") or {}).get(motor) or {}
            esperado = esperado_agora(m, cfg, now)
            feito = float(((cont.get(key) or {}).get(motor) or {}).get("dia") or 0)
            if esperado > 0 and feito / esperado < 0.5:
                chave = f"{hoje}:meta50:{key}"
                if chave not in enviados:
                    try:
                        notify_all(gids, "fiscalizacao",
                                   f"🟡 {c.get('nome', key)} abaixo de 50% da meta",
                                   body=f"{int(feito)} de {esperado:.0f} esperados até agora ({motor}).",
                                   link="#/fiscalizacao")
                    except Exception:
                        pass
                    enviados[chave] = now.isoformat()
                    avisos.append(chave)
        if avisos:
            _kv_set(sb, KV_ALERTAS, {k: v for k, v in enviados.items() if k.startswith(hoje)})

        # docs/tickets/etc. com o mesmo dedupe do pulso
        disparos = checar_alertas(sb, cfg, eventos, notify_all, enviar=True)
        return self._send(200, {"ok": True, "meta50": avisos, "pendencias": disparos})
