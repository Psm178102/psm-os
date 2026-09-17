"""
/api/v3/metricas/decisoes — MOTOR DE DECISÕES (api/v3/_decisoes_lib.py). v87.92

GET  ?tela=gestao|produtividade|oo|cerebro|sala|kpis|metas [&team=] [&pessoa=] [&fresh=1]
     → {decisoes:[...], contagem:{...}, dados_de_hhmm}
GET  ?cron=1  (Authorization: Bearer CRON_SECRET) → push diário "suas decisões de hoje" pra cada dono (1×/dia, a partir das 7h BRT)
POST {acao:"tarefa", id}            → cria a tarefa na Agenda do DONO (categoria Decisão, prazo da decisão, [dec:id])
POST {acao:"dispensar", id, motivo} → some por 7 dias com motivo registrado (lvl≥5)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse, uuid, time
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
if _V3 not in sys.path:
    sys.path.append(_V3)
from _auth_lib import require_user, AuthError, supabase_client, audit, notify, current_user  # type: ignore
import _metricas_lib as MX  # type: ignore
import _decisoes_lib as DL  # type: ignore


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

    def do_GET(self):
        q = self._q()
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        if q.get("cron") == "1":
            return self._cron(sb)
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        fresh = q.get("fresh") == "1" and (user.get("lvl") or 0) >= 5
        try:
            decs = DL.decisoes(sb, fresh=fresh)
        except Exception as e:
            body = {"ok": False, "error": f"decisões: {str(e)[:200]}"}
            if (user.get("lvl") or 0) >= 10:
                import traceback
                body["trace"] = traceback.format_exc()[-1500:]
            return self._send(500, body)
        vis = DL.filtrar(decs, user, tela=q.get("tela") or None, team=q.get("team") or None, pessoa=q.get("pessoa") or None)
        return self._send(200, {"ok": True, "decisoes": vis, "contagem": DL.resumo_contagem(vis),
                                "hoje": MX.hoje_brt().isoformat(), "viewer": {"id": user.get("id"), "lvl": user.get("lvl")}})

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
        did = str(body.get("id") or "")
        decs = DL.decisoes(sb)
        dec = next((d for d in DL.filtrar(decs, user) if d["id"] == did), None)
        if not dec:
            return self._send(404, {"ok": False, "error": "decisão não encontrada (pode já ter sido resolvida — atualize a tela)"})
        acao = body.get("acao")
        lvl = user.get("lvl") or 0

        if acao == "tarefa":
            if dec["estado"]["status"] in ("em_andamento", "atrasada") and dec["estado"].get("task_id"):
                return self._send(200, {"ok": True, "ja_existe": True, "task_id": dec["estado"]["task_id"]})
            dono = dec["dono"]["id"]
            if dono != user.get("id") and lvl < 5:
                return self._send(403, {"ok": False, "error": "só a gestão delega decisão para outra pessoa"})
            itens = "\n".join(f"• {i.get('nome')}" + (f" — {i['dias']} dias parado" if i.get("dias") is not None else "")
                              + (f" — {i['horas']}h sem contato" if i.get("horas") is not None else "") for i in dec.get("itens") or [])
            tid = f"dec_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"
            row = {
                "id": tid, "titulo": dec["titulo"][:140],
                "descricao": f"{dec['porque']}\n\n{itens}\n\nOnde agir: {dec.get('link') or '—'}\n[dec:{dec['id']}]".strip(),
                "status": "aberta", "prioridade": "alta" if dec["nivel"] == "critico" else "media",
                "categoria": DL.CATEGORIA_TAREFA, "responsavel": dono, "criado_por": user.get("id"),
                "criado_em": int(time.time() * 1000), "inicio": MX.hoje_brt().isoformat(), "prazo": dec["prazo"],
                "historico": [{"ts": datetime.now(timezone.utc).isoformat(), "by": user.get("id"), "acao": "criada pelo motor de decisões"}],
            }
            try:
                sb.table("dir_tasks").insert(row).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"não consegui criar a tarefa: {str(e)[:160]}"})
            try:
                sys.path.append(os.path.join(_V3, "tasks"))
                from _espelho_agenda import espelhar  # type: ignore
                espelhar(sb, row)
            except Exception as e:
                print(f"[decisoes] espelho agenda: {e}")
            if dono != user.get("id"):
                notify(dono, "decisao", f"🧭 {dec['titulo'][:90]}", f"{dec['porque'][:180]} · prazo {dec['prazo_label']}", link="#/", target_type="task", target_id=tid)
            audit(self, user, "decisao.tarefa", "dir_tasks", tid, notes=dec["id"])
            DL.invalidar(sb)
            return self._send(200, {"ok": True, "task_id": tid})

        if acao == "dispensar":
            if lvl < 5:
                return self._send(403, {"ok": False, "error": "só a gestão dispensa uma decisão"})
            motivo = str(body.get("motivo") or "").strip()
            if len(motivo) < 5:
                return self._send(400, {"ok": False, "error": "escreva o motivo (mín. 5 letras) — fica registrado"})
            disp = MX._kv_read(sb, DL.KV_DISPENSAS) or {}
            hoje = MX.hoje_brt()
            disp = {k: v for k, v in disp.items() if isinstance(v, dict) and str(v.get("ate", "")) >= hoje.isoformat()}
            disp[did] = {"motivo": motivo[:300], "por": user.get("id"), "em": datetime.now(timezone.utc).isoformat(),
                         "ate": (hoje + timedelta(days=DL.DISPENSA_DIAS)).isoformat()}
            MX._kv_write(sb, DL.KV_DISPENSAS, disp)
            audit(self, user, "decisao.dispensar", "decisao", did, notes=motivo[:200])
            DL.invalidar(sb)
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": "acao deve ser 'tarefa' ou 'dispensar'"})

    def _cron(self, sb):
        auth = self.headers.get("Authorization") or ""
        secret = os.environ.get("CRON_SECRET") or ""
        if not secret or auth != f"Bearer {secret}":
            return self._send(401, {"ok": False, "error": "cron sem CRON_SECRET"})
        agora_b = MX.agora_brt()
        if agora_b.hour < 7:
            return self._send(200, {"ok": True, "skip": "antes das 7h"})
        key = f"decisoes_push:{agora_b.date().isoformat()}"
        if MX._kv_read(sb, key):
            return self._send(200, {"ok": True, "skip": "já enviado hoje"})
        decs = DL.decisoes(sb, fresh=True)
        por_dono = {}
        for d in decs:
            if d["estado"]["status"] in ("dispensada", "em_andamento", "resolvendo"):
                continue
            por_dono.setdefault(d["dono"]["id"], []).append(d)
        enviados = 0
        users = {u["id"]: u for u in (sb.table("users").select("id,role").execute().data or [])}
        for uid, ds in por_dono.items():
            crit = sum(1 for d in ds if d["nivel"] == "critico")
            role = ((users.get(uid) or {}).get("role") or "").lower()
            link = "#/cockpit-conquista" if role.startswith("corretor") else "#/gestao-comercial"
            primeira = ds[0]
            corpo = f"1ª: {primeira['titulo']} (prazo {primeira['prazo_label']})" + (f" · +{len(ds) - 1} outra(s)" if len(ds) > 1 else "")
            enviados += notify(uid, "decisao_dia", f"🧭 {len(ds)} decisão(ões) sua(s) hoje" + (f" · {crit} crítica(s)" if crit else ""),
                               corpo, link=link, target_type="decisao", target_id=primeira["id"])
        MX._kv_write(sb, key, {"enviados": enviados, "donos": len(por_dono), "em": datetime.now(timezone.utc).isoformat()})
        return self._send(200, {"ok": True, "enviados": enviados, "donos": len(por_dono)})
