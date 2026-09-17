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
import datetime as _dtm
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (  # type: ignore
    supabase_client, require_user, AuthError, bearer_from_headers, verify_jwt
)

# (tabela, coluna de tempo) — sinais das superfícies "ao vivo" do sistema.
SIGNALS = [
    # v84.95 — audit_log e notifications SAÍRAM da assinatura: audit_log muda a cada
    # login/cron/push do sistema INTEIRO e redesenhava a página de todo mundo à toa
    # (o "fica atualizando sozinho"); notificação já tem o sino próprio (refreshNotifs).
    # v88.6 — era ("tasks", "updated_at"): a tabela `tasks` NUNCA existiu neste banco
    # (PostgREST devolvia 404 a cada pulso, e o _max engolia calado). Tarefa mora em
    # `dir_tasks` desde sempre — ver tasks/list.py, tasks/feed.py e tasks/upsert.py.
    # Resultado: mexer em tarefa não mudava a assinatura, e a pill "🔄 Novos dados"
    # nunca acendia por tarefa. O nome errado era o bug INTEIRO: a coluna já se mexe
    # sozinha a cada UPDATE pelo trigger dir_tasks_updated_at → set_updated_at().
    ("dir_tasks", "updated_at"),    # tarefas (tela Agenda & Tarefas)
    ("deals", "updated_at_rd"),     # vendas / CRM / oportunidades
    ("shared_kv", "updated_at"),    # recados/timeline, permissões, scripts, tabelas, configs
    ("leads_lp", "ts_recebido"),    # lead da LP chegou via webhook (sem navegador que emita o sinal)
]


# Pares que já falharam NESTE processo — o log sai uma vez por par, não a cada pulso.
_SINAL_MUDO = set()


def _max(sb, table, col):
    """Maior valor de `col` em `table` ("" se não der). Tolerante por design:
    um sinal quebrado não pode derrubar o tempo real do sistema inteiro.

    v88.6: tolerante SIM, mudo NÃO. O par ("tasks","updated_at") passou meses
    devolvendo 404 sem ninguém ver porque este `except` era silencioso — sinal
    morto e uma requisição jogada fora por pulso, por aba. Agora loga 1x por
    (tabela, coluna) por processo: aparece no runtime log da Vercel na primeira
    vez e não vira spam nas ~600 chamadas seguintes do mesmo processo."""
    try:
        rows = sb.table(table).select(col).order(col, desc=True).limit(1).execute().data or []
        return str(rows[0].get(col) or "") if rows else ""
    except Exception as e:
        if (table, col) not in _SINAL_MUDO:
            _SINAL_MUDO.add((table, col))
            print(f"[pulse] SINAL MORTO {table}.{col} — assinatura sem este sinal: {e}")
        return ""


# ─── 🕵️ Sinal de vida da sessão (v88.5, pedido do Paulo) ───────────────────
# O app já bate AQUI a cada 6s enquanto a aba está VISÍVEL. Aproveitar essa
# batida que já existe é de propósito: nenhuma requisição nova aparece no
# navegador de quem está sendo medido, e "tempo de uso" passa a significar
# tempo com a tela realmente aberta (aba fechada não pulsa → não conta).
# Quem lê isso é só o sócio, em /api/v3/checkin/uso.
#
# Duas travas de escrita: este cache de processo (60s) evita a ida ao banco à
# toa, e a própria função SQL psm_session_beat ignora batida < 45s. Best-effort:
# falhar aqui NUNCA pode derrubar o pulso (é o tempo real do sistema).
_BEAT = {}          # jti -> epoch da última gravação feita por ESTE processo
_BEAT_GAP = 60.0


def _sinal_de_vida(handler, sb, user):
    try:
        if not sb or not user:
            return
        claims = verify_jwt(bearer_from_headers(handler.headers)) or {}
        jti = claims.get("jti")
        if not jti:
            return
        agora = time.time()
        ultimo = _BEAT.get(jti)
        if ultimo is not None and (agora - ultimo) < _BEAT_GAP:
            return
        if len(_BEAT) > 500:        # processo quente não vira depósito de jti
            _BEAT.clear()
        _BEAT[jti] = agora

        def _iso(unix):
            if not unix:
                return None
            return _dtm.datetime.fromtimestamp(int(unix), _dtm.timezone.utc).isoformat()

        ip = (handler.headers.get("X-Forwarded-For") or "").split(",")[0].strip() \
             or handler.headers.get("X-Real-IP") or ""
        sb.rpc("psm_session_beat", {
            "p_jti":  jti,
            "p_user": user.get("id"),
            "p_iat":  _iso(claims.get("iat")),   # hora do login de verdade
            "p_exp":  _iso(claims.get("exp")),
            "p_ua":   (handler.headers.get("User-Agent") or "")[:255],
            "p_ip":   (ip or "")[:64],
        }).execute()
    except Exception as e:
        print(f"[pulse] sinal de vida falhou: {e}")


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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        _sinal_de_vida(self, sb, user)      # v88.5 — marca presença real da sessão
        sig = "|".join(_max(sb, t, c) for t, c in SIGNALS)
        return self._send(200, {"ok": True, "sig": sig})
