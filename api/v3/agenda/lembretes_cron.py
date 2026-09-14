"""
GET /api/v3/agenda/lembretes_cron — ⏰ LEMBRETE antes do compromisso/tarefa. v87.81

Roda pelo Vercel Cron a cada 5 min (Authorization: Bearer CRON_SECRET). Pra cada
compromisso e tarefa COM HORÁRIO de hoje/amanhã, calcula a hora do aviso
(início − lembrete) e, se ela já chegou e o compromisso ainda não começou, manda
sino + push pra quem é afetado:
  • compromisso → responsável (ou quem criou, se não há responsável) + convidados
    que aceitaram (pendente/recusado NÃO recebem) — regra de alçada;
  • tarefa → responsável (ou quem criou, se não há responsável).

Quanto antes: lembrete_min do item; se vazio, o padrão de CADA pessoa
(agenda_prefs::<uid>: 30 min compromisso / 15 min tarefa); -1 = sem lembrete.
Não repete: cada aviso enviado fica em shared_kv 'agenda_lembretes_enviados'
com a chave item|data|hora|min|pessoa — reagendar gera chave nova e re-arma.

Um sócio logado pode testar: ?dry=1 mostra o que sairia agora, sem enviar.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify, send_web_push  # type: ignore
import _agenda_prefs as P  # type: ignore

KV_ENVIADOS = "agenda_lembretes_enviados"
EVENTO_FORA = ("cancelado", "cancelada", "realizado", "concluido", "concluida")
TAREFA_FORA = ("concluida", "cancelada")
# o cron pode atrasar/pular uma rodada: aviso vencido há até 20 min ainda sai,
# desde que o compromisso não tenha começado há mais de 5 min
ATRASO_MAX_MIN = 20
TOLERANCIA_INICIO_MIN = 5


def _agora_brt():
    # horário "de parede" de Brasília (sem horário de verão desde 2019)
    return (datetime.now(timezone.utc) - timedelta(hours=3)).replace(tzinfo=None)


def _verify_cron(headers):
    secret = os.environ.get("CRON_SECRET")
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    return bool(secret) and auth.lower().startswith("bearer ") and auth[7:].strip() == secret


def _inicio(data, hora):
    try:
        return datetime.strptime(f"{str(data)[:10]} {str(hora)[:5]}", "%Y-%m-%d %H:%M")
    except Exception:
        return None


def _fmt_antes(m):
    if m <= 0:
        return "Agora"
    if m < 60:
        return f"Em {m} min"
    if m % 1440 == 0:
        return "Amanhã" if m == 1440 else f"Em {m // 1440} dias"
    if m % 60 == 0:
        return f"Em {m // 60}h"
    return f"Em {m // 60}h{m % 60:02d}"


def _enviados(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_ENVIADOS).limit(1).execute().data or []
        v = rows[0].get("value") if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _salvar_enviados(sb, env, agora):
    corte = (agora - timedelta(days=3)).isoformat()
    limpo = {k: t for k, t in env.items() if str(t) >= corte}
    sb.table("shared_kv").upsert({"key": KV_ENVIADOS, "value": limpo,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def calcular(sb, agora):
    """Lista de avisos devidos AGORA: [{chave, uid, titulo, corpo, link, tag}]."""
    hoje = agora.date()
    d0, d2 = hoje.isoformat(), (hoje + timedelta(days=2)).isoformat()   # "1 dia antes" alcança amanhã
    prefs = P.ler_todos(sb)
    ativos = None
    try:
        ativos = {str(u["id"]): u.get("name") for u in
                  (sb.table("users").select("id,name,status").execute().data or [])
                  if (u.get("status") or "ativo") == "ativo"}
    except Exception:
        pass
    avisos = []

    def pref(uid, campo):
        return P.minutos((prefs.get(str(uid)) or P.DEFAULTS).get(campo), P.DEFAULTS[campo])

    def devido(ini, antes):
        if antes is None or antes < 0 or not ini:
            return False
        hora_aviso = ini - timedelta(minutes=antes)
        return (hora_aviso <= agora <= hora_aviso + timedelta(minutes=ATRASO_MAX_MIN)
                and agora <= ini + timedelta(minutes=TOLERANCIA_INICIO_MIN))

    # ── compromissos ──
    try:
        evs = (sb.table("eventos").select("*").gte("data", d0).lte("data", d2)
               .limit(2000).execute().data or [])
    except Exception:
        evs = []
    for e in evs:
        eid = str(e.get("id") or "")
        if eid.startswith("evtk_") or (e.get("status") or "") in EVENTO_FORA or not e.get("hora_inicio"):
            continue   # evtk_ = espelho de tarefa (a tarefa avisa por conta própria)
        ini = _inicio(e.get("data"), e.get("hora_inicio"))
        ac = e.get("aceites") or {}
        pessoas = {e.get("corretor_id") or e.get("criado_por") or e.get("owner_id")}
        pessoas |= {p for p in (e.get("participantes") or []) if ac.get(p) not in ("pendente", "recusado")}
        for uid in pessoas - {None, ""}:
            if ativos is not None and str(uid) not in ativos:
                continue
            antes = P.minutos(e.get("lembrete_min"), pref(uid, "lembrete_evento_min"))
            if not devido(ini, antes):
                continue
            hf = str(e.get("hora_fim") or "")[:5]
            corpo = f"{str(e.get('hora_inicio'))[:5]}{('–' + hf) if hf else ''}"
            if e.get("local"):
                corpo += f" · {e.get('local')}"
            avisos.append({"chave": f"{eid}|{e.get('data')}|{str(e.get('hora_inicio'))[:5]}|{antes}|{uid}",
                           "uid": uid, "titulo": f"⏰ {_fmt_antes(antes)}: {e.get('titulo') or 'Compromisso'}",
                           "corpo": corpo, "link": f"#/?item=evento:{eid}", "target": ("evento", eid)})

    # ── tarefas com horário ──
    try:
        ts = (sb.table("dir_tasks").select("*").gte("prazo", d0).lte("prazo", d2)
              .limit(2000).execute().data or [])
    except Exception:
        ts = []
    for t in ts:
        if (t.get("status") or "") in TAREFA_FORA or not t.get("hora_inicio"):
            continue
        uid = t.get("responsavel") or t.get("criado_por")
        if not uid or (ativos is not None and str(uid) not in ativos):
            continue
        ini = _inicio(t.get("prazo"), t.get("hora_inicio"))
        antes = P.minutos(t.get("lembrete_min"), pref(uid, "lembrete_tarefa_min"))
        if not devido(ini, antes):
            continue
        tid = t.get("id")
        avisos.append({"chave": f"task-{tid}|{t.get('prazo')}|{str(t.get('hora_inicio'))[:5]}|{antes}|{uid}",
                       "uid": uid, "titulo": f"⏰ {_fmt_antes(antes)}: {t.get('titulo') or 'Tarefa'}",
                       "corpo": f"Tarefa às {str(t.get('hora_inicio'))[:5]}" + (f" · prioridade {t.get('prioridade')}" if t.get("prioridade") in ("alta", "critica") else ""),
                       "link": f"#/?item=tarefa:{tid}", "target": ("task", tid)})
    return avisos


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
        if not _verify_cron(self.headers):
            try:
                require_user(self, min_lvl=10)   # sócio pode testar
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
            if not dry:
                return self._send(400, {"ok": False, "error": "fora do cron use ?dry=1"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        agora = _agora_brt()
        avisos = calcular(sb, agora)
        env = _enviados(sb)
        novos = [a for a in avisos if a["chave"] not in env]
        if dry:
            return self._send(200, {"ok": True, "dry": True, "agora_brt": agora.isoformat(),
                                    "devidos": len(avisos), "a_enviar": novos[:50]})
        enviados = 0
        for a in novos:
            try:
                notify([a["uid"]], tipo="agenda.lembrete", title=a["titulo"], body=a["corpo"],
                       link=a["link"], target_type=a["target"][0], target_id=a["target"][1])
                # tag por item: 2 lembretes na mesma hora não se sobrescrevem no celular
                send_web_push([a["uid"]], a["titulo"], a["corpo"], a["link"],
                              tag=f"lembrete-{a['target'][1]}")
                enviados += 1
            except Exception as e:
                print(f"[lembretes] falha {a['chave']}: {e}")
            env[a["chave"]] = agora.isoformat()   # marca mesmo com falha: não martela a cada 5 min
        if novos:
            try:
                _salvar_enviados(sb, env, agora)
            except Exception as e:
                print(f"[lembretes] kv: {e}")
        return self._send(200, {"ok": True, "agora_brt": agora.isoformat(),
                                "devidos": len(avisos), "enviados": enviados})
