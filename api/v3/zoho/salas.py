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
from datetime import datetime

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


def _tok_de_qualquer(sb, preferido=None):
    """Token de leitura: o do próprio usuário se ele estiver conectado; senão o
    de qualquer colega conectado (a sala é da empresa)."""
    try:
        if preferido:
            c = z.get_conn(sb, preferido)
            if c:
                return z.access_token(c)[0], True
        rows = sb.table("zoho_conexoes").select("*").limit(10).execute().data or []
        for c in rows:
            try:
                return z.access_token(c)[0], False
            except Exception:
                continue
    except Exception:
        pass
    return None, False


def _branches(token):
    """A doc cita 'Get Branch list API' mas não publica o caminho. Tentamos as
    formas conhecidas e ficamos com a que responder — sem chutar cegamente."""
    for path in ("branches", "resources/branches", "branch"):
        try:
            v = _lista(z._req("GET", f"{z.calendar_base()}/{path}", token),
                       "branches", "branch", "data")
            if v:
                return v
        except Exception:
            continue
    return []


def _salas(token, branch_id=None):
    qs = {"showHidden": "false", "isCurTime": "true"}
    if branch_id:
        qs["branchId"] = str(branch_id)
    d = z._req("GET", f"{z.calendar_base()}/resources?" + urllib.parse.urlencode(qs), token)
    return _lista(d, "resources", "data")


def _freebusy(token, branch_id, dia):
    """Ocupação do dia (MM/dd/yyyy no Zoho)."""
    d0 = datetime.strptime(dia, "%Y-%m-%d").strftime("%m/%d/%Y")
    qs = {"start_date": d0, "end_date": d0}
    if branch_id:
        qs["branch_id"] = str(branch_id)
    d = z._req("GET", f"{z.calendar_base()}/resources/freebusy?" + urllib.parse.urlencode(qs), token)
    return _lista(d, "resources", "data", "freebusy")


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
        dia = (q.get("dia") or [datetime.now().strftime("%Y-%m-%d")])[0]
        # ?debug=1 (sócio) devolve o shape CRU da Zoho. O shape real não bate
        # com a doc, e adivinhar formato às cegas custa uma rodada de deploy.
        debug = (q.get("debug") or [""])[0] == "1" and (user.get("lvl") or 0) >= 7

        token, eh_meu = _tok_de_qualquer(sb, user.get("id"))
        if not token:
            # ninguém conectou ainda — é informação, não erro
            return self._send(200, {"ok": True, "configurado": True, "sem_conexao": True,
                                    "salas": [], "dia": dia,
                                    "aviso": "Nenhuma conta Zoho conectada ainda. Conecte a sua pra liberar o mapa das salas."})
        cru = {}
        try:
            bs = _branches(token)
            b0 = bs[0] if (bs and isinstance(bs[0], dict)) else {}
            branch_id = b0.get("branch_id") or b0.get("id") or b0.get("branchId")
            salas = _salas(token, branch_id)
            ocup = _freebusy(token, branch_id, dia) if branch_id else []
            if debug:
                cru = {"branches": bs[:2], "salas_cru": salas[:2], "ocup_cru": ocup[:2]}
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

        ocup_por_id = {str(r.get("resource_id")): r for r in ocup if isinstance(r, dict)}
        out = []
        for s in salas:
            if not isinstance(s, dict):
                continue
            rid = str(s.get("resource_id") or s.get("id") or "")
            fb = ocup_por_id.get(rid) or {}
            out.append({
                "id": rid,
                "nome": s.get("resource_name") or s.get("name"),
                "capacidade": s.get("capacity"),
                "local": s.get("location"),
                "categoria": s.get("category_name"),
                "livre_agora": s.get("is_available", fb.get("is_available")),
                "reservas": fb.get("bookings") or fb.get("freebusy") or [],
            })
        return self._send(200, {"ok": True, "configurado": True, "dia": dia,
                                "branch_id": branch_id, "eu_conectado": eh_meu,
                                "salas": out, "total": len(out), **({"cru": cru} if debug else {})})

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
            ini, _ = z._fmt_zoho_dt(dia, hi, False)
            fim, _ = z._fmt_zoho_dt(dia, hf, False)
            payload = {"resource_id": rid, "title": titulo[:250],
                       "dateandtime": {"start": ini, "end": fim, "timezone": "America/Sao_Paulo"}}
            url = f"{z.calendar_base()}/bookings?bookingdata=" + urllib.parse.quote(json.dumps(payload))
            r = z._req("POST", url, token)
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"Zoho recusou a reserva: {str(e)[:200]}"})
        audit(self, user, "zoho.sala.reservar", "resource", rid, notes=f"{dia} {hi}-{hf}")
        return self._send(200, {"ok": True, "reserva": r})
