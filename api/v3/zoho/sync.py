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


DIAS_ATRAS, DIAS_FRENTE = 7, 60


def _page(make_q, cap=4000):
    """PostgREST devolve no máximo 1000 linhas por vez — sem paginar, uma
    agenda grande simplesmente perde eventos sem avisar."""
    out, page = [], 1000
    for i in range(0, cap, page):
        rows = make_q().range(i, i + page - 1).execute().data or []
        out.extend(rows)
        if len(rows) < page:
            break
    return out


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

    res = {"puxados": 0, "criados_house": 0, "atualizados_house": 0, "apagados_house": 0,
           "enviados": 0, "atualizados_zoho": 0, "erros": 0}
    agora = datetime.now(timezone.utc)
    hoje = agora.date()
    ini_d = (hoje - timedelta(days=DIAS_ATRAS)).isoformat()
    fim_d = (hoje + timedelta(days=DIAS_FRENTE)).isoformat()

    # ── PULL: Zoho → House (fatiado em janelas de 31d — teto da API) ────
    zevs = z.listar_eventos(token, cal_uid, agora - timedelta(days=DIAS_ATRAS),
                            agora + timedelta(days=DIAS_FRENTE))
    existentes = {}
    try:
        rows = sb.table("eventos").select("id,zoho_uid,zoho_etag").eq("owner_id", uid) \
            .not_.is_("zoho_uid", "null").gte("data", ini_d).lte("data", fim_d) \
            .limit(3000).execute().data or []
        existentes = {str(r["zoho_uid"]): r for r in rows if r.get("zoho_uid")}
    except Exception:
        pass
    vivos = set()
    for ze in zevs:
        zu = ze.get("uid")
        if not zu:
            continue
        row = z.zoho_to_house_event(ze, uid)
        if not row.get("data"):
            continue
        vivos.add(str(zu))
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

    # apagado no Zoho → some do House (só o que NASCEU no Zoho; evento do House
    # que o dono removeu do Zoho não é apagado aqui — quem manda é a origem)
    for zu, cur in existentes.items():
        if zu in vivos:
            continue
        try:
            sb.table("eventos").delete().eq("id", cur["id"]).like("id", "evzo_%").execute()
            res["apagados_house"] += 1
        except Exception:
            res["erros"] += 1

    # ── PUSH: House → Zoho (cria os novos E atualiza os que mudaram) ────
    # NÃO usar .contains() aqui: o cliente PostgREST gera sintaxe de array PG
    # (cs.{x}) que NÃO casa com coluna jsonb — a query voltava vazia e o except
    # engolia, então o push ficava em 0 com "erros: 0" (parecia que não havia
    # nada pra enviar). Mesma pegadinha que já mordeu o kanban de reativação:
    # filtro complexo do PostgREST não é confiável → busca por data e filtra
    # participantes no Python.
    try:
        casa = _page(lambda: sb.table("eventos").select("*")
                     .gte("data", ini_d).lte("data", fim_d).order("id"), cap=4000)
    except Exception:
        casa = []
        res["erros"] += 1
    casa = [e for e in casa if uid in (e.get("participantes") or [])]
    for ev in casa:
        if (ev.get("origem") or "house") == "zoho" or not ev.get("data"):
            continue
        # convite pendente/recusado NÃO vai pro calendário dele (v84.57) — quem
        # é dono/responsável não tem marca, então passa direto
        if (ev.get("aceites") or {}).get(uid) in ("pendente", "recusado"):
            continue
        try:
            ed = z.house_to_zoho_event(ev)
            if not ev.get("zoho_uid"):
                new_uid, etag = z.criar_evento(token, cal_uid, ed)
                if new_uid:
                    sb.table("eventos").update({"zoho_uid": new_uid, "zoho_etag": etag,
                                                "zoho_hash": z.hash_evento(ev),
                                                "origem": (ev.get("origem") or "house"),
                                                "owner_id": (ev.get("owner_id") or uid)}).eq("id", ev["id"]).execute()
                    res["enviados"] += 1
                else:
                    # o Zoho respondeu num formato que eu não reconheci: isso é
                    # ERRO, não "nada a fazer" — não pode sumir da contagem
                    res["erros"] += 1
            elif z.hash_evento(ev) != (ev.get("zoho_hash") or ""):
                # mudou no House depois de sincronizado → reflete no Zoho
                etag = z.atualizar_evento(token, cal_uid, ev["zoho_uid"], ed, ev.get("zoho_etag"))
                sb.table("eventos").update({"zoho_etag": etag or ev.get("zoho_etag"),
                                            "zoho_hash": z.hash_evento(ev)}).eq("id", ev["id"]).execute()
                res["atualizados_zoho"] += 1
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
