"""
GET /api/v3/alertas/cron_push — Digest diário de VENCIMENTOS via Web Push. v78.3

Roda pelo Vercel Cron (Authorization: Bearer CRON_SECRET). Pra cada usuário COM
inscrição de push, calcula as pendências do dia e manda 1 notificação no celular/PWA:
  • tarefas atrasadas e tarefas de hoje (dir_tasks)
  • plantão de hoje (plantoes)
  • captação parada há ≥7 dias (captacoes)
  • 1:1 atrasado (one_on_ones)

Também aceita ser disparado por um SÓCIO logado (lvl 10) pra testar:
  ?dry=1  → calcula e mostra quem seria avisado, sem enviar
  ?me=1   → envia só pra você (teste de entrega no seu aparelho)

Reutiliza send_web_push() do _auth_lib e os mesmos campos/regras do feed.
"""
from http.server import BaseHTTPRequestHandler
import os, sys, json
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, send_web_push  # type: ignore

TAREFA_DONE = ("concluida", "cancelada")
PLANTAO_DONE = ("concluido", "realizado", "cancelado")
CAPT_DONE = ("concluido", "concluida", "arquivado", "arquivada", "perdido", "perdida", "publicada")
PARADA_DIAS = 7


def _today_brt():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


def _d(s):
    return str(s)[:10] if s else None


def _verify_cron(headers):
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    return auth.lower().startswith("bearer ") and auth[7:].strip() == secret


def _compute(sb, subs_uids):
    """Retorna {uid: {atrasadas, hoje, plantao, paradas, oo}} só p/ uids em subs_uids."""
    hoje = _today_brt()
    hoje_iso = hoje.isoformat()
    corte = (hoje - timedelta(days=PARADA_DIAS)).isoformat()
    acc = {u: {"atrasadas": 0, "hoje": 0, "plantao": 0, "paradas": 0, "oo": 0} for u in subs_uids}
    sset = set(subs_uids)

    # Tarefas (dir_tasks) — por responsável
    try:
        for t in (sb.table("dir_tasks").select("responsavel,status,prazo").limit(5000).execute().data or []):
            uid = t.get("responsavel")
            if uid not in sset:
                continue
            st = (t.get("status") or "")
            if st in TAREFA_DONE:
                continue
            pz = _d(t.get("prazo"))
            if pz and pz < hoje_iso:
                acc[uid]["atrasadas"] += 1
            elif pz == hoje_iso:
                acc[uid]["hoje"] += 1
    except Exception:
        pass

    # Plantões de hoje (plantoes)
    try:
        for p in (sb.table("plantoes").select("corretor_id,data,status").eq("data", hoje_iso).limit(2000).execute().data or []):
            uid = p.get("corretor_id")
            if uid in sset and (p.get("status") or "") not in PLANTAO_DONE:
                acc[uid]["plantao"] += 1
    except Exception:
        pass

    # Captações paradas ≥7d (captacoes) — por responsavel_id
    try:
        for c in (sb.table("captacoes").select("responsavel_id,status,stage_changed_at,updated_at").limit(5000).execute().data or []):
            uid = c.get("responsavel_id")
            if uid not in sset:
                continue
            if (c.get("status") or "") in CAPT_DONE:
                continue
            last = _d(c.get("stage_changed_at") or c.get("updated_at"))
            if last and last < corte:
                acc[uid]["paradas"] += 1
    except Exception:
        pass

    # 1:1 atrasado (one_on_ones) — maior proxima_data por corretor < hoje
    try:
        oo_max = {}
        for o in (sb.table("one_on_ones").select("corretor_id,proxima_data").limit(5000).execute().data or []):
            uid = o.get("corretor_id")
            pd = _d(o.get("proxima_data"))
            if uid in sset and pd:
                if uid not in oo_max or pd > oo_max[uid]:
                    oo_max[uid] = pd
        for uid, pd in oo_max.items():
            if pd < hoje_iso:
                acc[uid]["oo"] = 1
    except Exception:
        pass

    return acc


def _msg(c):
    parts = []
    if c["atrasadas"]:
        parts.append(f"{c['atrasadas']} tarefa(s) atrasada(s)")
    if c["hoje"]:
        parts.append(f"{c['hoje']} pra hoje")
    if c["plantao"]:
        parts.append("plantão hoje")
    if c["paradas"]:
        parts.append(f"{c['paradas']} captação(ões) parada(s)")
    if c["oo"]:
        parts.append("1:1 atrasado")
    return parts


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        dry = qs.get("dry", ["0"])[0] in ("1", "true")
        only_me = qs.get("me", ["0"])[0] in ("1", "true")

        actor = None
        if not _verify_cron(self.headers):
            try:
                actor = require_user(self, min_lvl=10)   # sócio pode disparar/testar
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # quem tem push ligado
        try:
            subs = sb.table("push_subscriptions").select("user_id").execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": "push_subscriptions: " + str(e)})
        subs_uids = sorted({s.get("user_id") for s in subs if s.get("user_id")})
        if only_me and actor:
            subs_uids = [actor.get("id")] if actor.get("id") in subs_uids else []

        if not subs_uids:
            return self._send(200, {"ok": True, "notified": 0, "motivo": "ninguém com push ativo" + (" (ative em 📲)" if actor else "")})

        acc = _compute(sb, subs_uids)
        notified, detalhe = 0, []
        for uid in subs_uids:
            parts = _msg(acc[uid])
            if not parts:
                continue
            body = "; ".join(parts) + " — abra o painel."
            detalhe.append({"uid": uid, "resumo": body})
            if not dry:
                try:
                    send_web_push(uid, "⏰ Suas pendências de hoje", body, link="#/", tag="vencimentos")
                    notified += 1
                except Exception:
                    pass

        return self._send(200, {"ok": True, "dry": dry, "candidatos": len(detalhe),
                                "notified": notified, "detalhe": detalhe[:30]})
