"""
GET /api/v3/agenda/ics?u=<user_id>&k=<token> — a agenda da pessoa como CALENDÁRIO
ASSINÁVEL (iCalendar). v87.81

Pra quem não usa Zoho: cola o link no Google Agenda ("Outras agendas → Do URL"),
no iPhone (Ajustes → Calendário → Contas → Adicionar assinatura) ou no Outlook
("Adicionar calendário → Da Internet") e os compromissos + tarefas com data do
House aparecem lá, atualizando sozinhos (quem define a frequência é o app: o
Google leva algumas horas; o iPhone deixa escolher).

Sem JWT (o Google busca de fora): quem abre é o token secreto de 32 caracteres
guardado em agenda_prefs::<uid>. Gerar de novo troca o token e mata o link antigo.
Só leitura, só a agenda da própria pessoa, janela hoje-30 … hoje+180.
"""
from http.server import BaseHTTPRequestHandler
import hmac, os, sys, urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
import _agenda_prefs as P  # type: ignore

TZID = "America/Sao_Paulo"
EVENTO_FORA = ("cancelado", "cancelada")
TAREFA_FORA = ("cancelada",)


def _esc(s):
    return (str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(linha):
    """RFC 5545: linhas com mais de 75 octetos quebram com CRLF + espaço."""
    b = linha.encode("utf-8")
    if len(b) <= 75:
        return linha
    partes, atual = [], b""
    for ch in linha:
        cb = ch.encode("utf-8")
        if len(atual) + len(cb) > (75 if not partes else 74):
            partes.append(atual.decode("utf-8"))
            atual = b""
        atual += cb
    partes.append(atual.decode("utf-8"))
    return "\r\n ".join(partes)


def _dt(data, hora):
    d = str(data)[:10].replace("-", "")
    if not hora:
        return None
    h = str(hora)[:5].replace(":", "")
    return f"{d}T{h}00"


def _vevent(uid, titulo, data, hi, hf, local=None, desc=None, status=None, agora=""):
    linhas = ["BEGIN:VEVENT", f"UID:{uid}@housepsm.com.br", f"DTSTAMP:{agora}",
              f"SUMMARY:{_esc(titulo)}"]
    ini = _dt(data, hi)
    if ini:
        fim = _dt(data, hf) if hf and str(hf)[:5] > str(hi)[:5] else None
        if not fim:
            t = datetime.strptime(ini, "%Y%m%dT%H%M%S") + timedelta(hours=1)
            fim = t.strftime("%Y%m%dT%H%M%S")
        linhas += [f"DTSTART;TZID={TZID}:{ini}", f"DTEND;TZID={TZID}:{fim}"]
    else:
        d = datetime.strptime(str(data)[:10], "%Y-%m-%d")
        linhas += [f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}",
                   f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}"]
    if local:
        linhas.append(f"LOCATION:{_esc(local)}")
    if desc:
        linhas.append(f"DESCRIPTION:{_esc(str(desc)[:1500])}")
    if status:
        linhas.append(f"STATUS:{status}")
    linhas.append("END:VEVENT")
    return linhas


def montar_ics(sb, uid, nome):
    hoje = (datetime.now(timezone.utc) - timedelta(hours=3)).date()
    since, until = (hoje - timedelta(days=30)).isoformat(), (hoje + timedelta(days=180)).isoformat()
    agora = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//House PSM//Agenda e Tarefas//PT-BR",
           "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
           f"X-WR-CALNAME:{_esc('House PSM · ' + (nome or 'Agenda'))}", f"X-WR-TIMEZONE:{TZID}",
           "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
           "BEGIN:VTIMEZONE", f"TZID:{TZID}", "BEGIN:STANDARD", "DTSTART:19700101T000000",
           "TZOFFSETFROM:-0300", "TZOFFSETTO:-0300", "TZNAME:-03", "END:STANDARD", "END:VTIMEZONE"]
    try:
        evs = (sb.table("eventos").select("*").gte("data", since).lte("data", until)
               .order("data").limit(2000).execute().data or [])
    except Exception:
        evs = []
    for e in evs:
        eid = str(e.get("id") or "")
        if eid.startswith("evtk_") or (e.get("status") or "") in EVENTO_FORA:
            continue   # espelho de tarefa entra pela própria tarefa, logo abaixo
        dono = uid in (e.get("criado_por"), e.get("corretor_id"), e.get("owner_id"))
        conv = uid in (e.get("participantes") or [])
        if not (dono or (conv and (e.get("aceites") or {}).get(uid) not in ("pendente", "recusado"))):
            continue
        out += _vevent(eid, e.get("titulo") or "Compromisso", e.get("data"), e.get("hora_inicio"),
                       e.get("hora_fim"), e.get("local"), e.get("descricao"),
                       "CONFIRMED" if (e.get("status") or "") == "confirmado" else None, agora)
    try:
        ts = (sb.table("dir_tasks").select("*").eq("responsavel", uid)
              .gte("prazo", since).lte("prazo", until).limit(1000).execute().data or [])
    except Exception:
        ts = []
    for t in ts:
        if (t.get("status") or "") in TAREFA_FORA:
            continue
        feita = (t.get("status") or "") == "concluida"
        out += _vevent("task-" + str(t.get("id")), ("✔ " if feita else "✅ ") + str(t.get("titulo") or "Tarefa"),
                       t.get("prazo"), t.get("hora_inicio"), t.get("hora_fim"), None,
                       t.get("descricao"), None, agora)
    try:
        pls = (sb.table("plantoes").select("*").eq("corretor_id", uid)
               .gte("data", since).lte("data", until).limit(300).execute().data or [])
    except Exception:
        pls = []
    for p in pls:
        if (p.get("status") or "") in ("cancelado",):
            continue
        per = p.get("periodo")
        out += _vevent("plantao-" + str(p.get("id")), "🛡 Plantão" + (f" · {per}" if per else ""),
                       p.get("data"), None, None, None, p.get("observacoes"), None, agora)
    out.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in out) + "\r\n"


class handler(BaseHTTPRequestHandler):
    def _txt(self, status, msg):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(msg.encode("utf-8"))

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        uid, tok = (q.get("u") or "").strip(), (q.get("k") or "").strip()
        if not uid or len(tok) < 20:
            return self._txt(404, "link inválido")
        sb = supabase_client()
        if not sb:
            return self._txt(503, "indisponível")
        guardado = P.ler(sb, uid).get("ics_token") or ""
        if not guardado or not hmac.compare_digest(str(guardado), tok):
            return self._txt(404, "link inválido ou revogado")
        try:
            u = sb.table("users").select("name,status").eq("id", uid).limit(1).execute().data or []
        except Exception:
            u = []
        if not u or (u[0].get("status") or "ativo") != "ativo":
            return self._txt(404, "link inválido ou revogado")
        corpo = montar_ics(sb, uid, (u[0].get("name") or "").split(" ")[0]).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar; charset=utf-8")
        self.send_header("Content-Disposition", 'inline; filename="house-psm-agenda.ics"')
        self.send_header("Cache-Control", "private, max-age=900")
        self.end_headers()
        self.wfile.write(corpo)
