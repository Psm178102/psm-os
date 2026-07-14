"""
GET /api/v3/producao/kanban_cadencia_cron — cron diário 9h BRT (12 UTC), seg-sex.

1) Sincroniza as 3 bases do RD → cards novos no Kanban de Abordagem.
2) Gera a fila do dia (atrasadas → follow-ups → cobranças → novas até o lote)
   e notifica a responsável (sino + push) com o resumo.
3) Sincroniza as visitas dos 4 funis → cards novos em Avaliações & Feedbacks.

Idempotente por dia — rodar 2x no mesmo dia não duplica a fila.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
from indicacao_kanban import _sincronizar, gerar_fila  # type: ignore
from avaliacoes import _sincronizar_av  # type: ignore
from reativacao_kanban import _sincronizar as _sinc_reativ, gerar_fila as fila_reativ  # type: ignore


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        sb = supabase_client()
        if not sb:
            self.send_response(503); self.end_headers()
            self.wfile.write(b'{"ok": false, "error": "backend"}')
            return
        out = {"ok": True}
        try:
            res, criadas = _sincronizar(sb, {"id": "cron"})
            out["sync"] = {"criadas": criadas, "por_base": res}
        except Exception as e:
            out["sync"] = {"erro": str(e)[:150]}
        try:
            out["fila"] = gerar_fila(sb)
        except Exception as e:
            out["fila"] = {"erro": str(e)[:150]}
        try:
            res_av, criadas_av = _sincronizar_av(sb, {"id": "cron"})
            out["avaliacoes"] = {"criadas": criadas_av, "por_origem": res_av}
        except Exception as e:
            out["avaliacoes"] = {"erro": str(e)[:150]}
        try:
            out["reativacao_sync"] = _sinc_reativ(sb, {"id": "cron"})
        except Exception as e:
            out["reativacao_sync"] = {"erro": str(e)[:150]}
        try:
            out["reativacao_fila"] = fila_reativ(sb)
        except Exception as e:
            out["reativacao_fila"] = {"erro": str(e)[:150]}
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(out, ensure_ascii=False, default=str).encode("utf-8"))
