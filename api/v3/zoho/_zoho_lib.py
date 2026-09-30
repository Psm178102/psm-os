"""
_zoho_lib.py — helper compartilhado da integração Zoho Calendar. v84.43

OAuth 2.0 por usuário (cada um conecta o próprio Zoho). O refresh_token fica
em zoho_conexoes; o access_token é derivado na hora e cacheado por ~50 min.

Envs (o SÓCIO cria uma vez no Zoho API Console — app "Server-based"):
  ZOHO_CLIENT_ID       — Client ID do app
  ZOHO_CLIENT_SECRET   — Client Secret
  ZOHO_DC              — data center: com (padrão) | eu | in | com.au | jp
  ZOHO_REDIRECT_URI    — opcional; default https://www.housepsm.com.br/api/v3/zoho/callback

Escopos: ZohoCalendar.calendar.ALL + ZohoCalendar.event.ALL (2 vias).
"""
import hashlib, json, os, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

# resources.ALL entra JUNTO de propósito (v84.58): mudar escopo depois obriga
# TODO MUNDO a reautorizar. Como ninguém conectou ainda, sai de graça agora.
# freebusy.READ (v84.71): a ocupação das salas vem do freebusy por e-mail
# (/calendars/freebusy?uemail=), que exige este escopo — descoberto em produção
# com 401 e confirmado na doc. O medo do v84.58 aconteceu: 3 pessoas já
# conectadas (Paulo/Leire/Mariane) ficam com token SEM este escopo. Mitigação
# em salas.py: a leitura de sala é dado da EMPRESA, então o freebusy tenta o
# token de QUALQUER conexão que já tenha a permissão — UM reconecte destrava o
# mapa pra todo mundo; a agenda de quem não reconectou segue intacta.
# bookings.ALL (v84.73): RESERVAR sala exige escopo próprio (bookings.CREATE);
# levo o .ALL pra já cobrir cancelar/editar reserva sem uma TERCEIRA rodada de
# reconexão. Descoberto na primeira reserva real: 400 de formato + escopo ausente.
SCOPES = "ZohoCalendar.calendar.ALL,ZohoCalendar.event.ALL,ZohoCalendar.resources.ALL,ZohoCalendar.freebusy.READ,ZohoCalendar.bookings.ALL"
_DEFAULT_REDIRECT = "https://www.housepsm.com.br/api/v3/zoho/callback"
_HOME = "https://www.housepsm.com.br/v2/#/agenda"
_tok_cache = {}  # user_id -> {"access": str, "exp": float, "api_domain": str}


def dc():
    return (os.environ.get("ZOHO_DC") or "com").strip().lower()


def accounts_base():
    return f"https://accounts.zoho.{dc()}"


def calendar_base():
    return f"https://calendar.zoho.{dc()}/api/v1"


def redirect_uri():
    return os.environ.get("ZOHO_REDIRECT_URI") or _DEFAULT_REDIRECT


def client_creds():
    return os.environ.get("ZOHO_CLIENT_ID"), os.environ.get("ZOHO_CLIENT_SECRET")


def configured():
    cid, sec = client_creds()
    return bool(cid and sec)


# ── state assinado (protege o OAuth: liga o callback ao user certo) ─────────
def sign_state(user_id):
    import jwt
    secret = os.environ.get("JWT_SECRET") or ""
    return jwt.encode({"uid": str(user_id), "exp": int(time.time()) + 900, "k": "zoho_oauth"},
                      secret, algorithm="HS256")


def verify_state(state):
    import jwt
    secret = os.environ.get("JWT_SECRET") or ""
    try:
        c = jwt.decode(state, secret, algorithms=["HS256"])
        return str(c["uid"]) if c.get("k") == "zoho_oauth" else None
    except Exception:
        return None


def authorize_url(user_id):
    cid, _ = client_creds()
    q = urllib.parse.urlencode({
        "scope": SCOPES, "client_id": cid, "response_type": "code",
        "access_type": "offline", "prompt": "consent",
        "redirect_uri": redirect_uri(), "state": sign_state(user_id)})
    return f"{accounts_base()}/oauth/v2/auth?{q}"


def _post_form(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def exchange_code(code):
    """authorization_code → {refresh_token, access_token, api_domain, expires_in}."""
    cid, sec = client_creds()
    return _post_form(f"{accounts_base()}/oauth/v2/token", {
        "grant_type": "authorization_code", "client_id": cid, "client_secret": sec,
        "redirect_uri": redirect_uri(), "code": code})


def access_token(conn):
    """Access token a partir do refresh_token da conexão. Cache 50 min.

    v84.72: a chave do cache inclui a impressão do REFRESH_TOKEN, não só o
    user_id. Reconectar gera refresh_token novo (com os escopos novos) — mas
    uma instância quente seguia servindo o access antigo do cache por até 50
    min, e o usuário via a reconexão "não funcionar" (401 nas salas) sem ter
    feito nada de errado. Com o token na chave, reconectou = cache novo."""
    uid = str(conn.get("user_id"))
    rt = str(conn.get("refresh_token") or "")
    chave = uid + ":" + hashlib.md5(rt.encode("utf-8")).hexdigest()[:10]
    c = _tok_cache.get(chave)
    if c and c["exp"] > time.time():
        return c["access"], c.get("api_domain") or conn.get("api_domain")
    cid, sec = client_creds()
    data = _post_form(f"{accounts_base()}/oauth/v2/token", {
        "grant_type": "refresh_token", "client_id": cid, "client_secret": sec,
        "refresh_token": conn.get("refresh_token")})
    tok = data.get("access_token")
    if not tok:
        raise RuntimeError("Zoho não devolveu access_token: " + json.dumps(data)[:200])
    _tok_cache[chave] = {"access": tok, "exp": time.time() + 50 * 60,
                         "api_domain": data.get("api_domain") or conn.get("api_domain")}
    return tok, _tok_cache[chave]["api_domain"]


def _req(method, url, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": "Zoho-oauthtoken " + token,
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw.strip() else {}


def hash_evento(ev):
    """Impressão digital dos campos que o Zoho enxerga. Se muda, o evento
    precisa ser re-enviado. É o que diferencia 'editado no House' de
    'já sincronizado e intocado' — sem isso o PUSH só criaria, nunca atualizaria."""
    base = "|".join(str(ev.get(k) or "") for k in
                    ("titulo", "descricao", "local", "data", "hora_inicio", "hora_fim", "all_day"))
    # rrule só entra quando existe: mudar a base de TODOS os eventos faria o push
    # re-enviar a agenda inteira de uma vez
    if ev.get("rrule"):
        base += "|" + str(ev["rrule"])
    return hashlib.md5(base.encode("utf-8")).hexdigest()


def janelas_31d(ini_dt, fim_dt):
    """A API do Zoho RECUSA range > 31 dias (limite documentado). Fatia o
    período em blocos de 30 dias. Sem isso o list volta vazio e a integração
    parece 'funcionar' devolvendo nada."""
    out, cur = [], ini_dt
    while cur < fim_dt:
        prox = min(cur + timedelta(days=30), fim_dt)
        out.append((cur.strftime("%Y%m%dT000000Z"), prox.strftime("%Y%m%dT235959Z")))
        cur = prox + timedelta(days=1)
    return out


def listar_eventos(token, cal_uid, ini_dt, fim_dt):
    """Lista eventos do Zoho no período, respeitando o teto de 31 dias por chamada."""
    vistos, todos = set(), []
    for ini, fim in janelas_31d(ini_dt, fim_dt):
        url = (f"{calendar_base()}/calendars/{cal_uid}/events?range="
               + urllib.parse.quote(json.dumps({"start": ini, "end": fim})))
        try:
            for e in (_req("GET", url, token).get("events") or []):
                u = e.get("uid")
                if u and u not in vistos:
                    vistos.add(u)
                    todos.append(e)
        except Exception:
            continue
    return todos


def criar_evento(token, cal_uid, eventdata):
    url = (f"{calendar_base()}/calendars/{cal_uid}/events?eventdata="
           + urllib.parse.quote(json.dumps(eventdata)))
    r = _req("POST", url, token)
    evs = r.get("events") or []
    return ((evs[0].get("uid") if evs else None) or r.get("uid"),
            str((evs[0].get("etag") if evs else None) or r.get("etag") or ""))


def atualizar_evento(token, cal_uid, event_uid, eventdata, etag):
    """PUT do Zoho exige dateandtime + etag no eventdata (doc oficial)."""
    ed = dict(eventdata)
    ed["etag"] = int(etag) if str(etag).isdigit() else etag
    url = (f"{calendar_base()}/calendars/{cal_uid}/events/{event_uid}?eventdata="
           + urllib.parse.quote(json.dumps(ed)))
    r = _req("PUT", url, token)
    evs = r.get("events") or []
    return str((evs[0].get("etag") if evs else None) or r.get("etag") or "")


def excluir_evento(token, cal_uid, event_uid, etag):
    """DELETE exige etag (header ou eventdata) — mandamos no header."""
    url = f"{calendar_base()}/calendars/{cal_uid}/events/{event_uid}"
    req = urllib.request.Request(url, method="DELETE", headers={
        "Authorization": "Zoho-oauthtoken " + token, "etag": str(etag or "")})
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw.strip() else {}


def default_calendar_uid(token):
    """uid da agenda default do usuário (a marcada isdefault)."""
    data = _req("GET", f"{calendar_base()}/calendars", token)
    cals = data.get("calendars") or []
    for c in cals:
        if c.get("isdefault") in (True, "true", 1):
            return c.get("uid"), c.get("name")
    if cals:
        return cals[0].get("uid"), cals[0].get("name")
    return None, None


def account_email(token):
    """E-mail da conta Zoho (via userinfo). Best-effort."""
    try:
        data = _req("GET", f"{accounts_base()}/oauth/user/info", token)
        return data.get("Email") or data.get("email")
    except Exception:
        return None


# ── conversão de datas Zoho ↔ House ─────────────────────────────────────────
_TZ = "America/Sao_Paulo"


def _fmt_zoho_dt(data_str, hora_str, all_day):
    """House (data 'YYYY-MM-DD' + hora 'HH:MM') → formato Zoho."""
    d = (data_str or "")[:10].replace("-", "")
    if all_day or not hora_str:
        return d, True
    hh = (hora_str or "00:00")[:5].replace(":", "") + "00"
    return f"{d}T{hh}", False


# v89.2.1: quem NÃO precisa integrar o Zoho (não vê o portão nem conta como
# pendente em /integracoes). Decisão do Paulo 30/09: Marcos Anderson (consultor).
DISPENSADOS_ZOHO = {"marcos_anderson"}


def dispensado_zoho(u):
    return bool((u or {}).get("is_service")) or str((u or {}).get("id") or "") in DISPENSADOS_ZOHO


def convida(ev):
    """Evento que vai pro Zoho SÓ pelo calendário do dono, com os demais como
    convidados (attendees): mestra de série (v89.1.3) e reunião da Agenda (origem
    'rito', v89.23)."""
    return bool(ev.get("rrule")) or ev.get("origem") == "rito"


def serie_fora_do_zoho(ev):
    """Ocorrência de série que NÃO é a mestra: nunca vai pro Zoho sozinha — a
    mestra já está lá como evento recorrente (v89.1.3)."""
    return bool(ev.get("serie_id")) and not ev.get("rrule")


def emails_convidados(sb, ev, dono):
    """E-mails dos participantes (menos o dono do calendário) pra irem como
    attendees — é o que põe o evento no Zoho de cada um, mesmo de quem não
    conectou o Zoho no House."""
    outros = [p for p in (ev.get("participantes") or []) if p and p != dono]
    if not outros:
        return []
    try:
        rows = sb.table("users").select("id,email").in_("id", outros).execute().data or []
        return [r["email"] for r in rows if r.get("email")]
    except Exception:
        return []


def house_to_zoho_event(ev, convidados=None):
    """Monta o dict eventdata do Zoho a partir de um evento do House.
    `convidados` (e-mails) e `rrule` só são usados pela mestra de uma série."""
    all_day = bool(ev.get("all_day")) or not ev.get("hora_inicio")
    start, _ = _fmt_zoho_dt(ev.get("data"), ev.get("hora_inicio"), all_day)
    end, _ = _fmt_zoho_dt(ev.get("data"), ev.get("hora_fim") or ev.get("hora_inicio"), all_day)
    if start == end and not all_day:  # evita 0 min
        end = start
    dt = {"start": start, "end": end, "timezone": _TZ}
    ed = {"title": (ev.get("titulo") or "Evento")[:250], "dateandtime": dt}
    if ev.get("descricao"):
        ed["description"] = str(ev["descricao"])[:2000]
    if ev.get("local"):
        ed["location"] = str(ev["local"])[:250]
    if ev.get("rrule"):
        ed["rrule"] = str(ev["rrule"])
    if convidados:
        ed["attendees"] = [{"email": e, "permission": 1, "attendance": 1} for e in convidados]
    return ed


def _parse_zoho_dt(s):
    """Formato Zoho ('YYYYMMDD' ou 'YYYYMMDDTHHMMSS±ZZZZ') → (data, hora, all_day)."""
    if not s:
        return None, None, True
    s = str(s)
    date_part = s[:8]
    data = f"{date_part[:4]}-{date_part[4:6]}-{date_part[6:8]}"
    if "T" not in s:
        return data, None, True
    t = s.split("T", 1)[1]
    hora = f"{t[:2]}:{t[2:4]}" if len(t) >= 4 else None
    return data, hora, False


# v89.8: o Zoho não tem "tipo" — quem cria lá só escreve o título. O House lê
# o título e classifica, pra que 1:1, visita, atendimento, corujão etc. criados
# no Zoho entrem na Agenda (e na TV de visitas) com o tipo certo, não como
# "Evento" genérico. Ordem importa: o primeiro que casar vence.
_TIPO_POR_TITULO = [
    ("oneonone", r"\bone\s*(on|a|to)\s*one\b|\b1\s*[:x]\s*1\b|\b1on1\b|\bum\s*a\s*um\b"),
    ("corujao", r"coruj"),
    ("visita", r"\bvisita"),
    ("atendimento", r"\batendiment|\batender\b"),
    ("plantao", r"\bplant[aã]o"),
    ("treinamento", r"treinament|\btreino\b|onboarding|\baula\b|workshop|\bcapacita"),
    ("reuniao", r"reuni[aã]o|\bmeeting\b|alinhamento|\bdaily\b|\bcall\b"),
    ("ligacao", r"\bliga[cç][aã]o|\bligar\b|follow.?up|\bretornar\b|\bretorno\b"),
    ("assinatura", r"assinatura|\bassinar\b|contrato|escritura|\bcartorio"),
    ("captacao", r"capta[cç][aã]o|\bcaptar\b|avalia[cç][aã]o do imovel|\bfotos?\b do imovel"),
    ("pessoal", r"barbeir|cinema|consulta|medic|dentist|academia|futevolei|futebol|\bcorrida\b|"
                r"aniversari|almoco|jantar|\bvisto\b|viagem|voo\b|exame|terapia|biblic|\bculto\b|\bmissa\b|"
                r"escola|pediatra|salao|manicure|cabelo|\bpessoal\b"),
]


def classificar_tipo(titulo):
    import re, unicodedata
    t = unicodedata.normalize("NFKD", str(titulo or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    for tipo, rx in _TIPO_POR_TITULO:
        if re.search(rx, t):
            return tipo
    # não casou nada: é um compromisso de trabalho sem palavra-chave — nunca
    # "Evento" genérico (Paulo 30/09: "a atividade tem que ser clara")
    return "outro"


def _sem_acento(s):
    import unicodedata
    t = unicodedata.normalize("NFKD", str(s or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def emails_do_evento(ze):
    """E-mails de organizador + convidados de um evento do Zoho."""
    out = []
    for a in (ze.get("attendees") or []):
        e = (a.get("email") if isinstance(a, dict) else a) or ""
        if "@" in str(e):
            out.append(str(e).strip().lower())
    org = ze.get("organizer")
    org = (org.get("email") if isinstance(org, dict) else org) or ""
    if "@" in str(org):
        out.append(str(org).strip().lower())
    return list(dict.fromkeys(out))


def zoho_to_house_event(ze, owner_id, pessoas=None, irmaos=None):
    """Evento do Zoho → dict pra tabela eventos (origem=zoho).

    `pessoas` (v89.9) = {email: {"id", "nome", "zoho"}} dos usuários do House.
    Convidado do Zoho que é do House vira PARTICIPANTE (se não tem Zoho
    conectado — quem tem já recebe a própria cópia pelo próprio sync) e o
    título ganha "com Fulano" quando ainda não cita a pessoa: "ONE ON ONE"
    sozinho não diz nada; "ONE ON ONE — com João Henrique" diz.

    `irmaos` = nomes de quem tem ESTE MESMO evento (zoho_uid) na agenda do
    House. Necessário porque o Zoho não devolve os convidados na listagem da
    agenda de quem ORGANIZOU — o 1:1 do Kauê saía só "ONE ON ONE" do lado dele."""
    dt = ze.get("dateandtime") or {}
    data, hi, all_day = _parse_zoho_dt(dt.get("start"))
    _, hf, _ = _parse_zoho_dt(dt.get("end"))
    titulo = (ze.get("title") or "Compromisso sem título").strip()[:200]
    tipo = classificar_tipo(titulo)
    participantes, nomes = [str(owner_id)], []
    for e in emails_do_evento(ze):
        p = (pessoas or {}).get(e)
        if not p or p["id"] == str(owner_id):
            if not p and e.split("@")[0]:
                nomes.append(e.split("@")[0].split(".")[0].capitalize())
            continue
        if not p.get("zoho"):
            participantes.append(p["id"])
        nomes.append(p["nome"])
    nomes += list(irmaos or [])
    t_norm = _sem_acento(titulo)
    faltam = [n for n in dict.fromkeys(nomes) if n and _sem_acento(n.split()[0]) not in t_norm]
    if faltam and tipo != "pessoal":
        titulo = (titulo + " — com " + ", ".join(faltam[:4]))[:200]
    return {
        "tipo": tipo, "titulo": titulo, "participantes": participantes,
        # visita/atendimento do Zoho pertencem ao dono da agenda — é o que põe
        # na TV de visitas do dia e no filtro por corretor
        **({"corretor_id": str(owner_id)} if tipo in ("visita", "atendimento") else {}),
        "descricao": (ze.get("description") or None),
        "data": data, "hora_inicio": (None if all_day else hi),
        "hora_fim": (None if all_day else hf), "all_day": all_day,
        "local": (ze.get("location") or None), "status": "agendado",
        "origem": "zoho", "owner_id": str(owner_id),
        "zoho_uid": ze.get("uid"), "zoho_etag": str(ze.get("etag") or ""),
    }


def get_conn(sb, user_id):
    try:
        rows = sb.table("zoho_conexoes").select("*").eq("user_id", str(user_id)).limit(1).execute().data or []
        return rows[0] if rows else None
    except Exception:
        return None


def now_iso():
    return datetime.now(timezone.utc).isoformat()
