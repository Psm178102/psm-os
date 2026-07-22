"""
GET /api/v3/pulse — assinatura LEVE de "última mudança" do sistema. v81.27

O frontend chama isto a cada ~12s; quando a assinatura muda, ele sabe que algo
mudou (tarefa, recado, venda, config, notificação…) e re-renderiza a página atual.
Assim o sistema fica em TEMPO REAL entre devices, mas SEM re-desenhar à toa (só
quando algo realmente mudou). Cada consulta é um "order by <col> desc limit 1"
(barato) e tolerante a falha — se uma tabela/coluna não existir, é ignorada.

Auth: qualquer usuário logado (lvl>=0).
Resposta: { ok, sig }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

# (tabela, coluna de tempo) — sinais das superfícies "ao vivo" do sistema.
SIGNALS = [
    ("audit_log", "ts"),            # quase todo write de usuário passa por audit()
    ("tasks", "updated_at"),        # tarefas
    ("deals", "updated_at_rd"),     # vendas / CRM / oportunidades
    ("notifications", "created_at"),  # notificações (sino)
    ("shared_kv", "updated_at"),    # recados/timeline, permissões, scripts, tabelas, configs
    ("leads_lp", "ts_recebido"),    # lead da LP chegou via webhook (sem navegador que emita o sinal)
]


def _max(sb, table, col):
    try:
        rows = sb.table(table).select(col).order(col, desc=True).limit(1).execute().data or []
        return str(rows[0].get(col) or "") if rows else ""
    except Exception:
        return ""


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        sig = "|".join(_max(sb, t, c) for t, c in SIGNALS)
        return self._send(200, {"ok": True, "sig": sig})
