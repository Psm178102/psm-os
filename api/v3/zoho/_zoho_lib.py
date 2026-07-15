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
SCOPES = "ZohoCalendar.calendar.ALL,ZohoCalendar.event.ALL,ZohoCalendar.resources.ALL,ZohoCalendar.freebusy.READ"
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


def house_to_zoho_event(ev):
    """Monta o dict eventdata do Zoho a partir de um evento do House."""
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


def zoho_to_house_event(ze, owner_id):
    """Evento do Zoho → dict pra tabela eventos (origem=zoho)."""
    dt = ze.get("dateandtime") or {}
    data, hi, all_day = _parse_zoho_dt(dt.get("start"))
    _, hf, _ = _parse_zoho_dt(dt.get("end"))
    return {
        "tipo": "evento", "titulo": (ze.get("title") or "Evento Zoho")[:200],
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
