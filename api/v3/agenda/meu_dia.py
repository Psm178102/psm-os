"""
/api/v3/agenda/meu_dia — ☀️ MEU DIA (api/v3/_meudia_lib.py). v87.93

GET                         → o dia da pessoa logada (agenda, fazer hoje, recados, meu mês) + canais de entrega
GET  ?pessoa=<uid>          → o dia de outra pessoa (lvl≥5)
GET  ?cron=1                → ENVIA pra todo mundo 1×/dia a partir das 7h BRT (Bearer CRON_SECRET; heartbeat + cron)
POST {action:"whatsapp", numero}  → grava o WhatsApp da própria pessoa ("" apaga)
POST {action:"canal", whatsapp:bool} → liga/desliga o Meu dia no WhatsApp (pref da pessoa)
POST {action:"teste"}       → manda o Meu dia AGORA pra você mesmo (sino + celular + WhatsApp, se ligado)

Entrega: sino do House + push no celular (quem ativou) + WhatsApp (quem cadastrou número e ligou, se o
servidor tiver Evolution API configurada). Quem desligou "Resumo do dia" nos lembretes não recebe.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
for _d in (_V3, os.path.join(_V3, "wa")):
    if _d not in sys.path:
        sys.path.append(_d)
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all, lvl_of  # type: ignore
import _agenda_prefs as P  # type: ignore
import _metricas_lib as MX  # type: ignore
import _meudia_lib as MD  # type: ignore


def _wa():
    try:
        from _wa_lib import evolution_send, normalize_phone  # type: ignore
        return evolution_send, normalize_phone
    except Exception:
        return None, None


def _wa_configurado():
    return bool(os.environ.get("EVOLUTION_API_URL") and os.environ.get("EVOLUTION_API_KEY") and os.environ.get("EVOLUTION_INSTANCE"))


def _contexto(sb, hoje):
    """Decisões e projeção do mês (best-effort: sem elas o Meu dia sai só com agenda/tarefas/recados)."""
    decs, pj = [], None
    try:
        import _decisoes_lib as DL  # type: ignore
        decs = DL.decisoes(sb, hoje=hoje)
    except Exception as e:
        print(f"[meu_dia] decisões indisponíveis: {e}")
    try:
        import _projecao_lib as PJ  # type: ignore
        pj = PJ.projecao(sb, {"h": "mes"}, hoje=hoje)
    except Exception as e:
        print(f"[meu_dia] projeção indisponível: {e}")
    return decs, pj


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _q(self):
        try:
            return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            return {}

    # ── entrega pra uma pessoa ──
    def _entregar(self, sb, u, dia, prefs):
        canais = []
        if prefs.get("resumo_diario") is False:
            return ["desligado"]
        notify_all(u["id"], "meu_dia", dia["titulo"][:120], dia["corpo"], link="#/", target_type="meu_dia", target_id=dia["hoje"])
        canais.append("sino+push")
        if prefs.get("meu_dia_whatsapp") and u.get("whatsapp") and _wa_configurado():
            send, norm = _wa()
            num = norm(u["whatsapp"]) if norm else None
            if send and num:
                r = send(num, dia["whatsapp"])
                canais.append("whatsapp" if r.get("ok") else "whatsapp_falhou")
        return canais

    def do_GET(self):
        q = self._q()
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        hoje = MX.hoje_brt()
        if q.get("cron") == "1":
            return self._cron(sb, hoje, q)
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        alvo_id = q.get("pessoa") or user["id"]
        if alvo_id != user["id"] and (user.get("lvl") or 0) < 5:
            return self._send(403, {"ok": False, "error": "só a gestão vê o dia de outra pessoa"})
        base = MD.carregar(sb, hoje)
        alvo = next((u for u in base["users"] if u["id"] == alvo_id), None)
        if not alvo:
            return self._send(404, {"ok": False, "error": "pessoa não encontrada"})
        decs, pj = _contexto(sb, hoje)
        dia = MD.compor(alvo, base, decs, pj, lvl=lvl_of(alvo.get("role")))
        prefs = P.ler(sb, alvo_id)
        dia["canais"] = {
            "whatsapp_numero": alvo.get("whatsapp") or "",
            "whatsapp_ligado": bool(prefs.get("meu_dia_whatsapp")),
            "whatsapp_servidor": _wa_configurado(),
            "resumo_diario": prefs.get("resumo_diario") is not False,
        }
        try:
            dia["canais"]["push_inscricoes"] = len(sb.table("push_subscriptions").select("endpoint").eq("user_id", alvo_id).execute().data or [])
        except Exception:
            dia["canais"]["push_inscricoes"] = None
        return self._send(200, {"ok": True, **dia})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        acao = body.get("action")
        uid = user["id"]
        if acao == "whatsapp":
            raw = str(body.get("numero") or "").strip()
            num = None
            if raw:
                _s, norm = _wa()
                num = norm(raw) if norm else None
                if not num:
                    return self._send(400, {"ok": False, "error": "número inválido — use DDD + número, ex.: 17 99123-4567"})
            try:
                sb.table("users").update({"whatsapp": num}).eq("id", uid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"não salvou: {str(e)[:120]}"})
            audit(self, user, "meu_dia.whatsapp", "users", uid, notes="definido" if num else "apagado")
            return self._send(200, {"ok": True, "whatsapp": num})
        if acao == "canal":
            try:
                novo = P.gravar(sb, uid, {"meu_dia_whatsapp": bool(body.get("whatsapp"))})
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"não salvou: {str(e)[:120]}"})
            return self._send(200, {"ok": True, "meu_dia_whatsapp": bool(novo.get("meu_dia_whatsapp"))})
        if acao == "teste":
            hoje = MX.hoje_brt()
            base = MD.carregar(sb, hoje)
            u = next((x for x in base["users"] if x["id"] == uid), None) or user
            decs, pj = _contexto(sb, hoje)
            dia = MD.compor(u, base, decs, pj, lvl=user.get("lvl") or 0)
            prefs = {**P.ler(sb, uid), "resumo_diario": True}
            canais = self._entregar(sb, u, dia, prefs)
            return self._send(200, {"ok": True, "canais": canais, "titulo": dia["titulo"]})
        return self._send(400, {"ok": False, "error": "action deve ser whatsapp, canal ou teste"})

    def _cron(self, sb, hoje, q):
        auth = self.headers.get("Authorization") or ""
        secret = os.environ.get("CRON_SECRET") or ""
        if not secret or auth != f"Bearer {secret}":
            return self._send(401, {"ok": False, "error": "cron sem CRON_SECRET"})
        agora_b = MX.agora_brt()
        if agora_b.hour < 7 and q.get("forcar") != "1":
            return self._send(200, {"ok": True, "skip": "antes das 7h"})
        if hoje.weekday() == 6:
            return self._send(200, {"ok": True, "skip": "domingo"})
        key = f"{MD.KV_ENVIADO}:{hoje.isoformat()}"
        ja = MX._kv_read(sb, key) or {}
        ja = ja if isinstance(ja, dict) else {}
        enviados = set(ja.get("ids") or [])
        base = MD.carregar(sb, hoje)
        decs, pj = _contexto(sb, hoje)
        prefs_todos = P.ler_todos(sb)
        res = {}
        for u in base["users"]:
            if u["id"] in enviados or u.get("is_service") or (u.get("status") or "ativo") != "ativo":
                continue
            lvl = lvl_of(u.get("role"))
            dia = MD.compor(u, base, decs, pj, lvl=lvl)
            r = dia["resumo"]
            # só quem tem algo pra saber ou fazer (sócio/gestor sempre recebe)
            if not (r["compromissos"] or r["acoes"] or r["recados"]) and lvl < 5 and not (u.get("role") or "").startswith("corretor"):
                continue
            prefs = {**P.DEFAULTS, **(prefs_todos.get(u["id"]) or {})}
            try:
                res[u["id"]] = self._entregar(sb, u, dia, prefs)
            except Exception as e:
                res[u["id"]] = [f"erro: {str(e)[:60]}"]
            enviados.add(u["id"])
        MX._kv_write(sb, key, {"ids": sorted(enviados), "em": datetime.now(timezone.utc).isoformat()})
        return self._send(200, {"ok": True, "enviados": len(res), "detalhe": res})
