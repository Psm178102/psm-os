"""
GET  /api/v3/zoho/salas?dia=YYYY-MM-DD — salas de reunião do escritório + ocupação
POST /api/v3/zoho/salas — reserva uma sala  {resource_id, dia, hora_inicio, hora_fim, titulo}

As salas são os RECURSOS → LOCALIZAÇÕES do Zoho (Resource Booking). v84.58

DUAS DECISÕES QUE VALEM EXPLICAR:

1) LER usa a conexão de QUALQUER pessoa (a primeira conectada serve): as salas
   são da empresa, não de ninguém. Assim quem ainda não conectou o próprio Zoho
   TAMBÉM enxerga o mapa de ocupação — o objetivo é "TODOS verem fácil".

2) RESERVAR exige a conexão da PRÓPRIA pessoa: a reserva nasce no nome de quem
   reservou. Usar o token de outro criaria reserva no nome errado — pior que
   não deixar reservar.

Requer o escopo ZohoCalendar.resources.ALL (adicionado na v84.58 — quem tinha
conectado antes precisa reconectar; hoje não há ninguém nessa situação).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timedelta, timezone as _tz

TZ = "America/Sao_Paulo"
# O Vercel roda em UTC. Sem isto o "ocupada agora" usaria a hora de Londres e a
# sala apareceria ocupada 3h fora do horário real.
def _agora():
    return datetime.now(_tz(timedelta(hours=-3)))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
import _zoho_lib as z  # type: ignore

def _lista(d, *chaves):
    """O Zoho às vezes devolve a lista CRUA e às vezes embrulhada num dict —
    o shape real não bate com o que a doc sugere (mesma pegadinha do Kenlo).
    Aceita os dois e nunca estoura .get() em cima de lista."""
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        for k in chaves:
            v = d.get(k)
            if isinstance(v, list):
                return v
        # último recurso: a primeira lista de dicts que aparecer
        for v in d.values():
            if isinstance(v, list) and (not v or isinstance(v[0], dict)):
                return v
    return []


def _tokens_conectados(sb, preferido=None):
    """TODOS os tokens utilizáveis, o do próprio usuário primeiro.

    v84.71: virou lista porque o freebusy exige o escopo novo (freebusy.READ)
    e quem conectou antes dele tem token sem essa permissão. A leitura de sala
    é dado da EMPRESA — se o token do usuário levar 401, o de um colega que já
    reconectou serve. UM reconecte destrava o mapa pra todo mundo."""
    try:
        rows = sb.table("zoho_conexoes").select("*").limit(20).execute().data or []
    except Exception:
        rows = []
    rows.sort(key=lambda c: 0 if str(c.get("user_id")) == str(preferido) else 1)
    toks = []
    for c in rows:
        try:
            toks.append((z.access_token(c)[0], str(c.get("user_id"))))
        except Exception:
            continue
    return toks


def _salas(token, branch_id=None):
    qs = {"showHidden": "false", "isCurTime": "true"}
    if branch_id:
        qs["branchId"] = str(branch_id)
    d = z._req("GET", f"{z.calendar_base()}/resources?" + urllib.parse.urlencode(qs), token)
    return _lista(d, "resources", "data")


def _fb_por_recurso(token, sala, dia):
    """Forma A (doc "Get resource free busy detail"): /resources/{id}/freebusy.
    Resposta documentada:
      {"range":"20260715_20260715",
       "<resource_id>": {"20260715": [{"start_time":"1415","end_time":"1430",
                                       "all_day":false}]}}
    Em produção esta forma deu 404 nas duas salas (v84.68) — fica na cadeia
    porque o 404 pode ser da conta/plano, não do caminho, e custa 1 request.
    """
    rid = str(sala.get("resource_id") or sala.get("id") or "")
    if not rid:
        raise ValueError("sala sem resource_id")
    d0 = datetime.strptime(dia, "%Y-%m-%d").strftime("%m/%d/%Y")
    qs = {"start_date": d0, "end_date": d0, "timezone": TZ}
    url = f"{z.calendar_base()}/resources/{urllib.parse.quote(rid)}/freebusy?" + urllib.parse.urlencode(qs)
    d = z._req("GET", url, token)
    if not isinstance(d, dict):
        raise ValueError("shape inesperado")
    chave = datetime.strptime(dia, "%Y-%m-%d").strftime("%Y%m%d")
    out = []
    for k, v in d.items():
        if k == "range" or not isinstance(v, dict):
            continue
        for s in (v.get(chave) or []):
            if not isinstance(s, dict):
                continue
            if s.get("all_day"):
                out.append({"inicio": None, "fim": None, "dia_todo": True})
                continue
            i, f = _hhmm(s.get("start_time")), _hhmm(s.get("end_time"))
            if i and f:
                out.append({"inicio": i, "fim": f, "dia_todo": False})
    return out


def _fb_por_email(token, sala, dia):
    """Forma B (doc "Get user's free/busy details"): /calendars/freebusy?uemail=…

    A sala do Zoho TEM caixa própria (res_email_id) — então dá pra perguntar a
    agenda dela como se fosse a de uma pessoa. Formato dos parâmetros:
    yyyyMMdd'T'HHmmss. Resposta:
      {"freebusy":[{"startTime":"20170419T190000Z","endTime":"20170419T193000Z",
                    "fbtype":"busy"}]}

    ATENÇÃO AO FUSO: aqui os horários voltam em UTC (sufixo Z) — ao contrário da
    forma A, que responde no fuso pedido. Sem converter, uma reunião das 14h
    apareceria às 17h. É o mesmo erro de 3h do relógio do Vercel, só que vindo
    do outro lado.
    """
    email = (sala.get("res_email_id") or "").strip()
    if not email:
        raise ValueError("sala sem res_email_id")
    # JANELA LARGA DE PROPÓSITO (±1 dia) e recorte no fuso DAQUI. A doc não diz
    # em que fuso o Zoho lê sdate/edate. Se ele ler como UTC, pedir 00:00–23:59
    # do dia daria 21h de ONTEM às 20h59 de hoje em Brasília: toda reunião
    # marcada depois das 21h sumiria da tela e entraria lixo da madrugada
    # anterior. Pedindo folga dos dois lados e filtrando por data local, o fuso
    # que o Zoho usa deixa de importar.
    d1 = datetime.strptime(dia, "%Y-%m-%d")
    ini_q = (d1 - timedelta(days=1)).strftime("%Y%m%d") + "T000000"
    fim_q = (d1 + timedelta(days=1)).strftime("%Y%m%d") + "T235959"
    qs = {"uemail": email, "sdate": ini_q, "edate": fim_q, "ftype": "eventbased"}
    url = f"{z.calendar_base()}/calendars/freebusy?" + urllib.parse.urlencode(qs)
    d = z._req("GET", url, token)
    itens = _lista(d, "freebusy", "data")

    BRT = _tz(timedelta(hours=-3))
    dia_ini = d1.replace(tzinfo=BRT)
    dia_fim = dia_ini + timedelta(days=1)
    out = []
    for s in itens:
        if not isinstance(s, dict):
            continue
        if str(s.get("fbtype") or "busy").lower() != "busy":
            continue  # 'free'/'tentative' não ocupa a sala
        ini = _para_brt(s.get("startTime"))
        fim = _para_brt(s.get("endTime"))
        if not ini or not fim:
            continue
        if fim <= dia_ini or ini >= dia_fim:
            continue  # reunião de outro dia — a folga da janela trouxe, aqui sai
        cortou_ini, cortou_fim = ini < dia_ini, fim > dia_fim
        ini = max(ini, dia_ini)
        fim = min(fim, dia_fim)
        if cortou_ini and cortou_fim:
            out.append({"inicio": None, "fim": None, "dia_todo": True})
        else:
            out.append({"inicio": ini.strftime("%H:%M"),
                        "fim": "23:59" if cortou_fim else fim.strftime("%H:%M"),
                        "dia_todo": False})
    return out


def _para_brt(s):
    """'20260715T190000Z' -> datetime em BRT. None se não parsear.
    O sufixo Z é UTC; sem Z, assumo que já veio no fuso local (o Zoho varia)."""
    s = str(s or "").strip()
    utc = s.endswith("Z")
    try:
        dt = datetime.strptime(s.rstrip("Z"), "%Y%m%dT%H%M%S")
    except Exception:
        return None
    dt = dt.replace(tzinfo=_tz(timedelta(0)) if utc else _tz(timedelta(hours=-3)))
    return dt.astimezone(_tz(timedelta(hours=-3)))


def _freebusy(tokens, sala, dia, comeca=0):
    """Devolve (reservas, forma, idx_do_token_que_respondeu).

    E-mail primeiro (formato confirmado na doc), em CADA token: 401/403 aqui é
    'este token não tem o escopo freebusy' — o do colega pode ter, então segue
    pro próximo. Erro que não é permissão não melhora trocando token: para.
    Recurso fica de reserva (deu 404 nesta conta, mas custa 1 request e o 404
    pode ser do plano). `comeca` lembra qual token funcionou pra sala anterior
    — as outras salas nem tentam os que já falharam.
    Estoura só se TUDO falhar — o chamador pinta cinza, nunca 'livre'."""
    erros = []
    for i in range(comeca, len(tokens)):
        try:
            return _reservas(_fb_por_email(tokens[i][0], sala, dia)), "email", i
        except Exception as e:
            msg = str(e)
            erros.append(f"email[{tokens[i][1]}]: {msg[:40]}")
            if "401" not in msg and "403" not in msg:
                break
    try:
        return _reservas(_fb_por_recurso(tokens[comeca][0], sala, dia)), "recurso", comeca
    except Exception as e:
        erros.append(f"recurso: {str(e)[:40]}")
    raise RuntimeError(" · ".join(erros))


def _hhmm(s):
    """'1415' -> '14:15'. Devolve None se não for o formato esperado."""
    s = str(s or "").strip()
    if len(s) == 4 and s.isdigit():
        return f"{s[:2]}:{s[2:]}"
    return None


def _reservas(slots):
    """Cada forma da cadeia já devolve {inicio, fim, dia_todo}; aqui só ordena e
    tira repetido (a mesma reunião pode vir 2x se a sala estiver em 2 agendas)."""
    vistos, out = set(), []
    for s in slots:
        ch = (s.get("inicio"), s.get("fim"), s.get("dia_todo"))
        if ch in vistos:
            continue
        vistos.add(ch)
        out.append(s)
    return sorted(out, key=lambda r: ("" if r["dia_todo"] else (r["inicio"] or "")))


def _situacao(reservas, dia, agora):
    """Semáforo HONESTO. 'ocupada agora' só faz sentido HOJE — em outro dia a
    pergunta certa é 'tem reserva?', e responder 'livre agora' sobre amanhã é
    inventar. Devolve (estado, ate/proxima)."""
    if any(r["dia_todo"] for r in reservas):
        return ("ocupada", None) if dia == agora.strftime("%Y-%m-%d") else ("tem_reserva", None)
    if dia != agora.strftime("%Y-%m-%d"):
        return ("tem_reserva" if reservas else "sem_reserva"), None
    hm = agora.strftime("%H:%M")
    for r in reservas:
        if r["inicio"] <= hm < r["fim"]:
            return "ocupada", r["fim"]
    prox = next((r["inicio"] for r in reservas if r["inicio"] > hm), None)
    return "livre", prox


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if not z.configured():
            return self._send(200, {"ok": True, "configurado": False, "salas": []})

        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        dia = (q.get("dia") or [_agora().strftime("%Y-%m-%d")])[0]
        # ?debug=1 (sócio) devolve o shape CRU da Zoho. O shape real não bate
        # com a doc, e adivinhar formato às cegas custa uma rodada de deploy.
        debug = (q.get("debug") or [""])[0] == "1" and (user.get("lvl") or 0) >= 7

        tokens = _tokens_conectados(sb, user.get("id"))
        if not tokens:
            # ninguém conectou ainda — é informação, não erro
            return self._send(200, {"ok": True, "configurado": True, "sem_conexao": True,
                                    "salas": [], "dia": dia,
                                    "aviso": "Nenhuma conta Zoho conectada ainda. Conecte a sua pra liberar o mapa das salas."})
        token = tokens[0][0]
        eh_meu = tokens[0][1] == str(user.get("id"))
        cru = {}
        try:
            # /resources responde SEM branchId, e cada sala já traz o branch_id
            # dentro dela. A "Get Branch list API" que a doc cita não tem caminho
            # publicado — e não precisa: o dado vem junto do recurso.
            salas = _salas(token)
            branch_id = next((s.get("branch_id") for s in salas
                              if isinstance(s, dict) and s.get("branch_id")), None)
        except Exception as e:
            msg = str(e)
            # 401 aqui quase sempre é ESCOPO, não token inválido: quem conectou
            # antes da v84.58 autorizou só calendar+event, sem resources.ALL.
            # O token segue válido pra agenda — só não pode ler recursos.
            if "401" in msg:
                return self._send(200, {"ok": True, "configurado": True, "salas": [], "dia": dia,
                                        "precisa_reconectar": True,
                                        "erro_zoho": "Sua conexão com o Zoho é anterior à permissão de Recursos."})
            return self._send(200, {"ok": True, "configurado": True, "erro_zoho": msg[:200],
                                    "salas": [], "dia": dia})

        agora = _agora()
        out, falhas = [], []
        idx = 0  # memo: qual token respondeu — a próxima sala começa por ele
        for s in salas:
            if not isinstance(s, dict):
                continue
            rid = str(s.get("resource_id") or s.get("id") or "")
            nome = s.get("resource_name") or s.get("name")
            # uma chamada POR SALA (são 2 aqui). Se a ocupação de UMA falhar, a
            # sala aparece com a agenda DESCONHECIDA — nunca como "livre". Dizer
            # "livre" quando não se sabe é o erro que manda dois times pra mesma
            # sala; o certo é admitir que não deu pra ler.
            try:
                reservas, forma, idx = _freebusy(tokens, s, dia, idx)
                estado, marca = _situacao(reservas, dia, agora)
                erro_sala = None
            except Exception as e:
                reservas, forma = [], None
                estado, marca, erro_sala = "desconhecida", None, str(e)[:160]
                falhas.append(nome)
            if debug:
                cru.setdefault("fb", {})[nome] = {"forma": forma, "reservas": reservas,
                                                  "via": tokens[idx][1] if forma else None,
                                                  "erro": erro_sala}
            out.append({
                "id": rid,
                "nome": nome,
                "capacidade": s.get("capacity"),
                "local": s.get("location"),
                "categoria": s.get("category_name"),
                "email": s.get("res_email_id"),
                "estado": estado,          # ocupada | livre | tem_reserva | sem_reserva | desconhecida
                "ate": marca if estado == "ocupada" else None,   # ocupada até HH:MM
                "proxima": marca if estado == "livre" else None,  # livre até a próxima às HH:MM
                "reservas": reservas,
                "erro": erro_sala,
            })
        if debug:
            cru["salas_cru"] = salas[:1]
            cru["branch_usado"] = branch_id
        # Todas as falhas foram 401 no e-mail = NENHUMA conexão tem o escopo de
        # disponibilidade (freebusy.READ, v84.71). Não é bug: é permissão que
        # nasceu depois das conexões. UM reconecte resolve pra empresa toda.
        falta_escopo = bool(falhas) and all(
            "401" in (s.get("erro") or "") for s in out if s.get("erro"))
        return self._send(200, {"ok": True, "configurado": True, "dia": dia,
                                "hoje": dia == agora.strftime("%Y-%m-%d"),
                                "agora": agora.strftime("%H:%M"),
                                "branch_id": branch_id, "eu_conectado": eh_meu,
                                "salas": out, "total": len(out),
                                **({"falhas": falhas} if falhas else {}),
                                **({"falta_permissao_horarios": True} if falta_escopo else {}),
                                **({"cru": cru} if debug else {})})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n else "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        rid = str(body.get("resource_id") or "")
        dia = (body.get("dia") or "").strip()
        hi = (body.get("hora_inicio") or "").strip()
        hf = (body.get("hora_fim") or "").strip()
        titulo = (body.get("titulo") or "Reunião").strip()
        if not (rid and dia and hi and hf):
            return self._send(400, {"ok": False, "error": "resource_id, dia, hora_inicio e hora_fim obrigatórios"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        # reserva SEMPRE com a conexão da própria pessoa — senão nasce no nome errado
        conn = z.get_conn(sb, user.get("id"))
        if not conn:
            return self._send(400, {"ok": False, "precisa_conectar": True,
                                    "error": "Conecte seu Zoho pra reservar — a sala fica reservada no seu nome."})
        try:
            token, _ = z.access_token(conn)
            # v84.73: contrato REAL da doc "Book a resource" (o meu antigo levava
            # 400): o parâmetro é bookingData (case-sensitive, era bookingdata),
            # a sala vai em resources:[{resource_id,type:0}] (ia solta no topo)
            # e o horário é LOCAL sem Z (yyyyMMddTHHmmss) com o fuso no objeto
            # (eu mandava o formato de evento).
            d0 = dia.replace("-", "")
            payload = {"title": titulo[:250],
                       "dateandtime": {"start": f"{d0}T{hi.replace(':','')}00",
                                       "end": f"{d0}T{hf.replace(':','')}00",
                                       "timezone": TZ},
                       "resources": [{"resource_id": rid, "type": 0}]}
            url = f"{z.calendar_base()}/bookings?bookingData=" + urllib.parse.quote(json.dumps(payload))
            r = z._req("POST", url, token)
        except Exception as e:
            msg = str(e)
            if "RESOURCE_NOT_AVAILABLE" in msg:
                return self._send(409, {"ok": False, "conflito": True,
                                        "error": "A sala já está reservada nesse horário — confira o mapa e escolha outro."})
            if "401" in msg or "403" in msg:
                # token da pessoa sem o escopo de reservas (anterior à v84.73)
                return self._send(400, {"ok": False, "precisa_reconectar": True,
                                        "error": "Sua conexão com o Zoho é anterior à permissão de Reservas — desconecte e conecte de novo na Agenda."})
            return self._send(502, {"ok": False, "error": f"Zoho recusou a reserva: {msg[:200]}"})
        audit(self, user, "zoho.sala.reservar", "resource", rid, notes=f"{dia} {hi}-{hf}")
        return self._send(200, {"ok": True, "reserva": r})
