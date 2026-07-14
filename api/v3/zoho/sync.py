"""
POST /api/v3/zoho/sync — sincroniza a agenda do usuário logado nos 2 sentidos.
GET  /api/v3/zoho/sync — mesma coisa (conveniência).

Janela: hoje-7d … hoje+60d.
  PULL  Zoho → House: eventos do Zoho viram/atualizam linhas em `eventos`
        (origem=zoho, owner_id=user, casados por zoho_uid).
  PUSH  House → Zoho: eventos onde o user é participante, origem≠zoho e ainda
        sem zoho_uid viram eventos no Zoho; guarda o uid de volta (não duplica).

Também é importado pelo sync_cron (roda pra todos os conectados).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid, urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
import _zoho_lib as z  # type: ignore


def _range_param():
    now = datetime.now(timezone.utc)
    ini = (now - timedelta(days=7)).strftime("%Y%m%dT000000Z")
    fim = (now + timedelta(days=60)).strftime("%Y%m%dT235959Z")
    return json.dumps({"start": ini, "end": fim})


def _list_zoho(token, cal_uid):
    url = f"{z.calendar_base()}/calendars/{cal_uid}/events?range=" + urllib.parse.quote(_range_param())
    data = z._req("GET", url, token)
    return data.get("events") or []


def _create_zoho(token, cal_uid, eventdata):
    url = f"{z.calendar_base()}/calendars/{cal_uid}/events?eventdata=" + urllib.parse.quote(json.dumps(eventdata))
    return z._req("POST", url, token)


def sync_user(sb, conn):
    """Sincroniza um usuário. Devolve resumo {puxados, criados_house, enviados, erros}."""
    uid = str(conn.get("user_id"))
    token, _dom = z.access_token(conn)
    cal_uid = conn.get("calendar_uid")
    if not cal_uid:
        cal_uid, _ = z.default_calendar_uid(token)
        if cal_uid:
            sb.table("zoho_conexoes").update({"calendar_uid": cal_uid}).eq("user_id", uid).execute()
    if not cal_uid:
        return {"erro": "sem agenda default no Zoho"}

    res = {"puxados": 0, "criados_house": 0, "atualizados_house": 0, "enviados": 0, "erros": 0}
    hoje = datetime.now(timezone.utc).date()
    ini_d = (hoje - timedelta(days=7)).isoformat()
    fim_d = (hoje + timedelta(days=60)).isoformat()

    # ── PULL: Zoho → House ──────────────────────────────────────────────
    try:
        zevs = _list_zoho(token, cal_uid)
    except Exception:
        zevs = []
    existentes = {}
    try:
        rows = sb.table("eventos").select("id,zoho_uid,zoho_etag").eq("owner_id", uid) \
            .not_.is_("zoho_uid", "null").limit(3000).execute().data or []
        existentes = {str(r["zoho_uid"]): r for r in rows if r.get("zoho_uid")}
    except Exception:
        pass
    for ze in zevs:
        zu = ze.get("uid")
        if not zu:
            continue
        row = z.zoho_to_house_event(ze, uid)
        if not row.get("data"):
            continue
        cur = existentes.get(str(zu))
        try:
            if cur:
                if str(cur.get("zoho_etag") or "") != row["zoho_etag"]:
                    sb.table("eventos").update(row).eq("id", cur["id"]).execute()
                    res["atualizados_house"] += 1
                res["puxados"] += 1
            else:
                row["id"] = "evzo_" + uuid.uuid4().hex[:12]
                row["participantes"] = [uid]
                sb.table("eventos").insert(row).execute()
                res["criados_house"] += 1
                res["puxados"] += 1
        except Exception:
            res["erros"] += 1

    # ── PUSH: House → Zoho ──────────────────────────────────────────────
    try:
        casa = sb.table("eventos").select("*").contains("participantes", [uid]) \
            .is_("zoho_uid", "null").gte("data", ini_d).lte("data", fim_d) \
            .limit(500).execute().data or []
    except Exception:
        casa = []
    for ev in casa:
        if (ev.get("origem") or "house") == "zoho":
            continue
        if not ev.get("data"):
            continue
        try:
            created = _create_zoho(token, cal_uid, z.house_to_zoho_event(ev))
            new = (created.get("events") or [{}])
            new_uid = (new[0].get("uid") if new else None) or created.get("uid")
            if new_uid:
                sb.table("eventos").update({"zoho_uid": new_uid, "origem": (ev.get("origem") or "house"),
                                            "owner_id": (ev.get("owner_id") or uid)}).eq("id", ev["id"]).execute()
                res["enviados"] += 1
        except Exception:
            res["erros"] += 1

    try:
        sb.table("zoho_conexoes").update({"last_sync_at": z.now_iso(), "last_sync_res": res,
                                          "atualizado_em": z.now_iso()}).eq("user_id", uid).execute()
    except Exception:
        pass
    return res


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def _run(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        conn = z.get_conn(sb, user.get("id"))
        if not conn:
            return self._send(400, {"ok": False, "error": "Zoho não conectado — clique em Conectar meu Zoho"})
        try:
            res = sync_user(sb, conn)
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        return self._send(200, {"ok": True, **res})

    def do_POST(self):
        self._run()

    def do_GET(self):
        self._run()
