"""
GET/POST /api/v3/gp/treinamentos3 — Treinamentos com ciclo de vida. v87.77

Substitui o blob shared_kv 'gp_treinamentos2' (fica intacto, como backup) por duas
tabelas: treinamentos + treinamento_participantes (supabase/treinamentos_v3.sql).

CICLO: agendado → realizado (depois da chamada) | cancelado. "Hoje" e "aguardando
chamada" são derivados da data — não viram status.

AGENDA + ZOHO: cada participante (e o instrutor, se for do time) ganha a PRÓPRIA
cópia do evento — eventos.id = 'evt_<treino>__<user>', dona = a pessoa. Assim o
treino aparece na agenda/Início dela e vai pro Zoho DELA. (Um evento do House
guarda um único zoho_uid: com uma linha só, só 1 convidado receberia no Zoho.)
O push pro Zoho é na hora, com teto de tempo; o que sobrar o sync de 30 min envia.

QUEM (decisão do Paulo, 10/set): administra = sócio/diretor, gerente e líder. O
instrutor do treino faz a chamada e edita o próprio treino. Todo mundo vê os
treinos em que está. Sino/push só pra quem foi convocado (regra de alçada).

GET  ?escopo=meus                  → treinos em que participo ou sou instrutor
     ?escopo=todos   (admin)       → todos + usuarios + zoho_ids + modulos da Academy
     ?extras=1       (admin)       → só usuarios + zoho_ids + modulos (editor)
     ?user_id=X      (admin/próprio) → treinos da pessoa (bloco do One-on-One)
     ?id=X                         → um treino
POST {action:'salvar', treino:{...}, participantes:[user_id], origem}
     {action:'chamada', id, presencas:{uid:{presenca, obs}}, carga_real, observacao}
     {action:'realizar', id, presencas, carga_real, observacao}
     {action:'confirmar', id, confirmacao:'confirmado'|'nao_vai', motivo}
     {action:'cancelar', id, motivo}
     {action:'excluir', id}        (lvl>=7)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time, uuid, urllib.parse
from datetime import datetime, timezone, date

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all, hoje_brt  # type: ignore

# Zoho: reaproveita o empurrador da Agenda (token/calendário de cada usuário).
# Se não carregar, o treino salva igual e o sync de 30 min envia depois.
_AGENDA = os.path.join(os.path.dirname(_HERE), "agenda")
if _AGENDA not in sys.path:
    sys.path.append(_AGENDA)
try:
    from _zoho_push import push_evento, delete_evento, _lib as _zoho_lib  # type: ignore
except Exception:
    push_evento = delete_evento = None

    def _zoho_lib():
        return None


FORMATOS = ("coletivo", "individual")
TIPOS = ("tecnico", "comportamental", "comercial", "lideranca", "integracao")
MODALIDADES = ("presencial", "online")
PRESENCAS = ("presente", "atrasado", "ausente", "justificado")
CONFIRMACOES = ("confirmado", "nao_vai")
MAX_PART = 300
ZOHO_BUDGET_S = 7.0          # teto do push na hora; o resto vai no sync de 30 min
COR = "#0d9488"
DIAS = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _s(v, n=4000):
    v = ("" if v is None else str(v)).strip()
    return v[:n] or None


def _data(v):
    v = _s(v, 10)
    if not v:
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except Exception:
        return None


def _hora(v):
    v = _s(v, 8)
    if not v:
        return None
    try:
        hh, mm = v.split(":")[:2]
        h, m = int(hh), int(mm)
        if 0 <= h < 24 and 0 <= m < 60:
            return f"{h:02d}:{m:02d}"
    except Exception:
        pass
    return None


def _is_admin(actor):
    if (actor.get("lvl") or 0) >= 10:
        return True
    for r in (actor.get("roles") or [actor.get("role")]):
        r = (r or "").strip().lower()
        if r in ("socio", "diretor", "líder") or r.startswith("gerente") or r.startswith("lider"):
            return True
    return False


def _pode_gerir(actor, t):
    return _is_admin(actor) or bool(t and t.get("instrutor_id") and t.get("instrutor_id") == actor.get("id"))


def _users(sb):
    for cols in ("id,name,team,role,status,hide_from_ranking", "id,name,team,role,status"):
        try:
            return sb.table("users").select(cols).execute().data or []
        except Exception:
            continue
    return []


def _ativo(u):
    return (u.get("status") or "ativo").strip().lower() == "ativo"


def _clean(raw):
    titulo = _s(raw.get("titulo"), 240)
    if not titulo:
        return None, "título obrigatório"
    data = _data(raw.get("data"))
    if not data:
        return None, "data obrigatória"
    mats = []
    for m in (raw.get("materiais") or [])[:30]:
        if isinstance(m, dict) and (m.get("url") or m.get("titulo")):
            mats.append({"tipo": _s(m.get("tipo"), 20) or "link",
                         "titulo": _s(m.get("titulo"), 160) or "", "url": _s(m.get("url"), 600) or ""})
    hi = _hora(raw.get("hora_inicio"))
    return {
        "titulo": titulo,
        "descricao": _s(raw.get("descricao")),
        "formato": raw.get("formato") if raw.get("formato") in FORMATOS else "coletivo",
        "tipo": raw.get("tipo") if raw.get("tipo") in TIPOS else None,
        "habilidade": _s(raw.get("habilidade"), 40),
        "equipe": _s(raw.get("equipe"), 80),
        "setor": _s(raw.get("setor"), 80),
        "modalidade": raw.get("modalidade") if raw.get("modalidade") in MODALIDADES else None,
        "local": _s(raw.get("local"), 300),
        "instrutor": _s(raw.get("instrutor"), 120),
        "instrutor_id": _s(raw.get("instrutor_id"), 80),
        "data": data,
        "hora_inicio": hi,
        "hora_fim": _hora(raw.get("hora_fim")) if hi else None,
        "carga_horaria": _s(raw.get("carga_horaria"), 30),
        "obrigatorio": bool(raw.get("obrigatorio")),
        "trilha": _s(raw.get("trilha"), 120),
        "modulo": _s(raw.get("modulo"), 160),
        "materiais": mats,
    }, None


def _get_treino(sb, tid):
    if not tid:
        return None
    rows = sb.table("treinamentos").select("*").eq("id", tid).limit(1).execute().data or []
    return rows[0] if rows else None


def _parts_de(sb, tids):
    out = {}
    tids = [t for t in tids if t]
    for i in range(0, len(tids), 200):
        for p in (sb.table("treinamento_participantes").select("*")
                  .in_("treinamento_id", tids[i:i + 200]).execute().data or []):
            out.setdefault(p["treinamento_id"], []).append(p)
    return out


def _resumo(t, ps):
    t["n_participantes"] = len(ps)
    t["n_confirmados"] = sum(1 for p in ps if p.get("confirmacao") == "confirmado")
    t["n_presentes"] = sum(1 for p in ps if p.get("presenca") in ("presente", "atrasado"))
    return t


def _extras(sb):
    us = [{"id": u.get("id"), "name": u.get("name"), "team": u.get("team"), "role": u.get("role"),
           "status": u.get("status") or "ativo", "hide_from_ranking": bool(u.get("hide_from_ranking"))}
          for u in _users(sb)]
    try:
        zids = sorted({str(r.get("user_id")) for r in (sb.table("zoho_conexoes").select("user_id").execute().data or [])
                       if r.get("user_id")})
    except Exception:
        zids = []
    mods, seen = [], set()
    try:
        for r in (sb.table("academy_items").select("trilha,modulo").limit(3000).execute().data or []):
            k = ((r.get("trilha") or "").strip(), (r.get("modulo") or "").strip())
            if k[0] and k[1] and k not in seen:
                seen.add(k)
                mods.append({"trilha": k[0], "modulo": k[1]})
    except Exception:
        pass
    return {"usuarios": us, "zoho_ids": zids, "modulos": mods}


# ─── Agenda + Zoho ──────────────────────────────────────────────────────────
def _ev_id(tid, uid):
    return f"evt_{tid}__{uid}"


def _quando(t):
    try:
        d = date.fromisoformat(str(t.get("data"))[:10])
        s = f"{DIAS[d.weekday()]} {d.strftime('%d/%m')}"
    except Exception:
        s = str(t.get("data") or "")
    hi, hf = str(t.get("hora_inicio") or "")[:5], str(t.get("hora_fim") or "")[:5]
    if hi:
        s += f" · {hi}" + (f"–{hf}" if hf else "")
    if t.get("local"):
        s += f" · {t['local']}"
    return s


def _mirror_row(t, uid):
    desc = "Treinamento" + (" obrigatório" if t.get("obrigatorio") else "") + \
           (" individual" if t.get("formato") == "individual" else "")
    if t.get("instrutor"):
        desc += f" · instrutor: {t['instrutor']}"
    if t.get("descricao"):
        desc += "\n" + str(t["descricao"])[:600]
    hi = t.get("hora_inicio") or None
    return {
        "id": _ev_id(t["id"], uid), "tipo": "treinamento",
        "titulo": ("🎓 " + t["titulo"])[:200], "descricao": desc,
        "data": str(t["data"])[:10], "hora_inicio": hi, "hora_fim": (t.get("hora_fim") or None) if hi else None,
        "all_day": not hi,
        # dona = a pessoa: entra na agenda/Início dela e no Zoho dela (nunca na do gestor que criou)
        "corretor_id": uid, "owner_id": uid, "criado_por": uid,
        "participantes": [uid], "aceites": {}, "local": t.get("local"), "cor": COR,
        "status": "realizado" if t.get("status") == "realizado" else "agendado",
        "origem": "house",
    }


def _sync_agenda(sb, t, part_ids, validos):
    """Deixa as cópias da Agenda iguais ao treino (cria/atualiza/remove) e empurra
    pro Zoho de quem conectou. Best-effort: nunca derruba o save."""
    res = {"agenda": 0, "zoho": 0, "zoho_pendente": 0, "removidos": 0}
    tid = t["id"]
    alvo = []
    if t.get("status") != "cancelado" and t.get("data"):
        for u in list(part_ids) + [t.get("instrutor_id")]:
            if u and u in validos and u not in alvo:
                alvo.append(u)
    try:
        atuais = sb.table("eventos").select("*").like("id", f"evt_{tid}__%").execute().data or []
    except Exception:
        atuais = []
    for ev in atuais:
        dono = ev.get("owner_id") or ev.get("corretor_id")
        if dono in alvo:
            continue
        try:
            if delete_evento and ev.get("zoho_uid"):
                delete_evento(sb, ev, dono)
        except Exception:
            pass
        try:
            sb.table("eventos").delete().eq("id", ev["id"]).execute()
            res["removidos"] += 1
        except Exception:
            pass
    if not alvo:
        return res
    try:
        sb.table("eventos").upsert([_mirror_row(t, u) for u in alvo], on_conflict="id").execute()
        res["agenda"] = len(alvo)
    except Exception as e:
        print(f"[treinos] agenda: {e}")
        return res
    z = _zoho_lib() if push_evento else None
    if not z:
        return res
    try:
        conectados = {str(r.get("user_id")) for r in (sb.table("zoho_conexoes").select("user_id")
                                                      .in_("user_id", alvo).execute().data or [])}
    except Exception:
        conectados = set()
    ids = [_ev_id(tid, u) for u in alvo if u in conectados]
    if not ids:
        return res
    try:
        evs = sb.table("eventos").select("*").in_("id", ids).execute().data or []
    except Exception:
        evs = []
    t0 = time.monotonic()
    for ev in evs:
        if ev.get("zoho_uid") and ev.get("zoho_hash") == z.hash_evento(ev):
            continue                      # já está igual no Zoho da pessoa
        if time.monotonic() - t0 > ZOHO_BUDGET_S:
            res["zoho_pendente"] += 1
            continue
        try:
            patch = push_evento(sb, ev, ev.get("owner_id"))
            if patch:
                sb.table("eventos").update(patch).eq("id", ev["id"]).execute()
                res["zoho"] += 1
            else:
                res["zoho_pendente"] += 1
        except Exception:
            res["zoho_pendente"] += 1
    return res


def _avisar(ids, actor, titulo, body, tid):
    ids = [u for u in dict.fromkeys(ids) if u and u != actor.get("id")]
    if not ids:
        return 0
    try:
        return notify_all(ids, "treinamento", titulo[:255], body, link=f"#/rh-treinamentos?id={tid}",
                          target_type="treinamento", target_id=tid) or 0
    except Exception:
        return 0


def _da_pessoa(sb, alvo, completo, incluir_instrutor):
    mine = sb.table("treinamento_participantes").select("*").eq("user_id", alvo).execute().data or []
    ids = [p["treinamento_id"] for p in mine]
    by = {}
    if ids:
        for i in range(0, len(ids), 200):
            for t in (sb.table("treinamentos").select("*").in_("id", ids[i:i + 200]).execute().data or []):
                by[t["id"]] = t
    if incluir_instrutor:
        for t in (sb.table("treinamentos").select("*").eq("instrutor_id", alvo).execute().data or []):
            by.setdefault(t["id"], t)
    allp = _parts_de(sb, list(by.keys()))
    out = []
    for t in by.values():
        ps = allp.get(t["id"], [])
        t["eu"] = next((p for p in ps if p.get("user_id") == alvo), None)
        _resumo(t, ps)
        if completo or t.get("instrutor_id") == alvo:
            t["participantes"] = ps
        out.append(t)
    out.sort(key=lambda t: str(t.get("data") or ""), reverse=True)
    return out


def _pendente(e):
    m = str(e)
    return "treinamento" in m and ("does not exist" in m or "PGRST205" in m or "Could not find the table" in m)


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    # ── leitura ──────────────────────────────────────────────────────────────
    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        uid, admin = actor.get("id"), _is_admin(actor)
        try:
            if q.get("extras"):
                if not admin:
                    return self._send(403, {"ok": False, "error": "só a gestão"})
                return self._send(200, {"ok": True, "admin": True, **_extras(sb)})

            if q.get("id"):
                t = _get_treino(sb, q["id"])
                if not t:
                    return self._send(404, {"ok": False, "error": "treinamento não encontrado"})
                ps = _parts_de(sb, [t["id"]]).get(t["id"], [])
                _resumo(t, ps)
                gerir = _pode_gerir(actor, t)
                if gerir:
                    t["participantes"] = ps
                    return self._send(200, {"ok": True, "treino": t, "admin": admin, "gerir": True, **_extras(sb)})
                eu = next((p for p in ps if p.get("user_id") == uid), None)
                if not eu:
                    return self._send(403, {"ok": False, "error": "você não está neste treinamento"})
                t["participantes"] = [eu]
                t["eu"] = eu
                return self._send(200, {"ok": True, "treino": t, "admin": admin, "gerir": False})

            alvo = q.get("user_id")
            if alvo:
                if not (admin or alvo == uid):
                    return self._send(403, {"ok": False, "error": "sem acesso"})
                return self._send(200, {"ok": True, "admin": admin,
                                        "treinos": _da_pessoa(sb, alvo, completo=admin, incluir_instrutor=False)})

            escopo = q.get("escopo") or ("todos" if admin else "meus")
            if escopo == "todos":
                if not admin:
                    return self._send(403, {"ok": False, "error": "só a gestão vê todos os treinamentos"})
                ts = sb.table("treinamentos").select("*").order("data", desc=True).limit(1500).execute().data or []
                pm = _parts_de(sb, [t["id"] for t in ts])
                for t in ts:
                    t["participantes"] = pm.get(t["id"], [])
                    _resumo(t, t["participantes"])
                return self._send(200, {"ok": True, "admin": True, "treinos": ts, **_extras(sb)})
            return self._send(200, {"ok": True, "admin": admin,
                                    "treinos": _da_pessoa(sb, uid, completo=False, incluir_instrutor=True)})
        except Exception as e:
            if _pendente(e):
                return self._send(200, {"ok": True, "pending": True, "treinos": [], "admin": admin,
                                        "hint": "rode supabase/treinamentos_v3.sql"})
            return self._send(500, {"ok": False, "error": str(e)[:300]})

    # ── escrita ──────────────────────────────────────────────────────────────
    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        action = body.get("action") or "salvar"
        fn = {"salvar": self._salvar, "chamada": self._chamada, "realizar": self._chamada,
              "confirmar": self._confirmar, "cancelar": self._cancelar, "excluir": self._excluir}.get(action)
        if not fn:
            return self._send(400, {"ok": False, "error": "ação inválida"})
        try:
            return fn(sb, actor, body, action)
        except Exception as e:
            if _pendente(e):
                return self._send(503, {"ok": False, "error": "Tabelas de treinamento ainda não criadas (supabase/treinamentos_v3.sql)"})
            return self._send(500, {"ok": False, "error": str(e)[:300]})

    def _salvar(self, sb, actor, body, _action):
        raw = body.get("treino") if isinstance(body.get("treino"), dict) else {}
        tid = _s(raw.get("id"), 80)
        atual = _get_treino(sb, tid) if tid else None
        if tid and not atual:
            return self._send(404, {"ok": False, "error": "treinamento não encontrado"})
        if atual:
            if not _pode_gerir(actor, atual):
                return self._send(403, {"ok": False, "error": "só a gestão ou o instrutor edita este treinamento"})
            if atual.get("status") == "cancelado":
                return self._send(400, {"ok": False, "error": "treinamento cancelado não pode ser editado"})
        elif not _is_admin(actor):
            return self._send(403, {"ok": False, "error": "só sócio, gerente ou líder agenda treinamento"})
        t, erro = _clean(raw)
        if erro:
            return self._send(400, {"ok": False, "error": erro})

        users = _users(sb)
        umap = {u.get("id"): u for u in users if u.get("id")}
        validos = {u.get("id") for u in users if u.get("id") and _ativo(u)}
        antes = [p["user_id"] for p in (sb.table("treinamento_participantes").select("user_id")
                                        .eq("treinamento_id", tid).execute().data or [])] if atual else []
        pids = []
        for p in (body.get("participantes") or [])[:MAX_PART]:
            p = _s(p, 80)
            # inativo só fica se já estava (histórico); convocar de novo, não
            if p and p in umap and (p in validos or p in antes) and p not in pids:
                pids.append(p)
        if not pids:
            return self._send(400, {"ok": False, "error": "convoque ao menos 1 pessoa"})
        if t["formato"] == "individual" and len(pids) != 1:
            return self._send(400, {"ok": False, "error": "treino individual é com 1 pessoa"})
        if t["instrutor_id"] and t["instrutor_id"] not in umap:
            t["instrutor_id"] = None
        if t["instrutor_id"] and not t["instrutor"]:
            t["instrutor"] = umap[t["instrutor_id"]].get("name")

        now = _now()
        if atual:
            t["updated_at"] = now
            sb.table("treinamentos").update(t).eq("id", tid).execute()
            t = {**atual, **t, "id": tid}
        else:
            tid = "trn_" + uuid.uuid4().hex[:12]
            t.update({"id": tid, "status": "agendado", "origem": _s(body.get("origem"), 30) or "treinamentos",
                      "criado_por": actor.get("id"), "created_at": now, "updated_at": now})
            sb.table("treinamentos").insert(t).execute()

        # participantes: quem já estava mantém confirmação/presença
        novos = [u for u in pids if u not in antes]
        saiu = [u for u in antes if u not in pids]
        if novos:
            sb.table("treinamento_participantes").insert(
                [{"treinamento_id": tid, "user_id": u, "nome": umap[u].get("name") or u} for u in novos]).execute()
        for u in saiu:
            sb.table("treinamento_participantes").delete().eq("treinamento_id", tid).eq("user_id", u).execute()

        ag = _sync_agenda(sb, t, pids, validos)

        avisados = 0
        if str(t["data"]) >= hoje_brt().isoformat() and t.get("status") == "agendado":
            quando = _quando(t)
            ob = "Obrigatório · " if t.get("obrigatorio") else ""
            conv = [u for u in novos if u in validos]
            avisados += _avisar(conv, actor, f"🎓 Treinamento: {t['titulo']}", f"{ob}{quando}", tid)
            if t.get("instrutor_id") and t["instrutor_id"] not in pids and (not atual or atual.get("instrutor_id") != t["instrutor_id"]):
                avisados += _avisar([t["instrutor_id"]], actor, f"🎤 Você vai ministrar: {t['titulo']}", quando, tid)
            if atual:
                def _k(x, k):
                    v = str(x.get(k) or "")
                    return v[:5] if k.startswith("hora") else v[:10] if k == "data" else v
                if any(_k(atual, k) != _k(t, k) for k in ("data", "hora_inicio", "hora_fim", "local")):
                    ficou = [u for u in pids if u in antes and u in validos]
                    avisados += _avisar(ficou, actor, f"🎓 Treinamento remarcado: {t['titulo']}", f"Novo horário: {quando}", tid)

        audit(self, actor, "treino.salvar" if atual else "treino.criar", target_type="treinamentos",
              target_id=tid, notes=f"{t['titulo'][:60]} · {len(pids)} pessoa(s)")
        return self._send(200, {"ok": True, "id": tid, "novos": len(novos), "removidos": len(saiu),
                                "avisados": avisados, "agenda": ag})

    def _chamada(self, sb, actor, body, action):
        t = _get_treino(sb, _s(body.get("id"), 80))
        if not t:
            return self._send(404, {"ok": False, "error": "treinamento não encontrado"})
        if not _pode_gerir(actor, t):
            return self._send(403, {"ok": False, "error": "só a gestão ou o instrutor faz a chamada"})
        if t.get("status") == "cancelado":
            return self._send(400, {"ok": False, "error": "treinamento cancelado"})
        if action == "realizar" and str(t.get("data") or "") > hoje_brt().isoformat():
            return self._send(400, {"ok": False, "error": "o treinamento ainda não aconteceu"})
        ps = _parts_de(sb, [t["id"]]).get(t["id"], [])
        pres = body.get("presencas") if isinstance(body.get("presencas"), dict) else {}
        now = _now()
        for p in ps:
            v = pres.get(p["user_id"])
            if not isinstance(v, dict):
                continue
            pr = v.get("presenca") or None
            if pr is not None and pr not in PRESENCAS:
                continue
            patch = {"presenca": pr, "presenca_obs": _s(v.get("obs"), 300),
                     "marcado_por": actor.get("id"), "marcado_em": now}
            sb.table("treinamento_participantes").update(patch) \
                .eq("treinamento_id", t["id"]).eq("user_id", p["user_id"]).execute()
            p.update(patch)
        tpatch = {"updated_at": now}
        if "carga_real" in body:
            tpatch["carga_real"] = _s(body.get("carga_real"), 30)
        if "observacao" in body:
            tpatch["observacao"] = _s(body.get("observacao"))
        if action == "realizar":
            faltam = [p.get("nome") or p["user_id"] for p in ps if not p.get("presenca")]
            if faltam:
                sb.table("treinamentos").update(tpatch).eq("id", t["id"]).execute()
                return self._send(400, {"ok": False, "faltam": faltam,
                                        "error": "falta marcar a presença de: " + ", ".join(faltam[:8])})
            tpatch.update({"status": "realizado", "realizado_em": now, "realizado_por": actor.get("id")})
        sb.table("treinamentos").update(tpatch).eq("id", t["id"]).execute()
        t.update(tpatch)
        if action == "realizar":
            # as cópias da Agenda viram 'realizado' (saem das pendências do Início)
            try:
                sb.table("eventos").update({"status": "realizado"}).like("id", f"evt_{t['id']}__%").execute()
            except Exception:
                pass
        pres_n = sum(1 for p in ps if p.get("presenca") in ("presente", "atrasado"))
        audit(self, actor, "treino." + action, target_type="treinamentos", target_id=t["id"],
              notes=f"{t['titulo'][:60]} · {pres_n}/{len(ps)} presentes")
        t["participantes"] = ps
        _resumo(t, ps)
        return self._send(200, {"ok": True, "treino": t})

    def _confirmar(self, sb, actor, body, _action):
        t = _get_treino(sb, _s(body.get("id"), 80))
        if not t:
            return self._send(404, {"ok": False, "error": "treinamento não encontrado"})
        uid = actor.get("id")
        rows = sb.table("treinamento_participantes").select("*").eq("treinamento_id", t["id"]) \
            .eq("user_id", uid).limit(1).execute().data or []
        if not rows:
            return self._send(403, {"ok": False, "error": "você não está neste treinamento"})
        c = body.get("confirmacao")
        if c not in CONFIRMACOES:
            return self._send(400, {"ok": False, "error": "confirmação inválida"})
        if t.get("status") != "agendado":
            return self._send(400, {"ok": False, "error": "este treinamento não está mais aberto"})
        motivo = _s(body.get("motivo"), 300) if c == "nao_vai" else None
        sb.table("treinamento_participantes").update(
            {"confirmacao": c, "confirmacao_motivo": motivo, "confirmado_em": _now()}) \
            .eq("treinamento_id", t["id"]).eq("user_id", uid).execute()
        if c == "nao_vai":
            _avisar([t.get("criado_por"), t.get("instrutor_id")], actor,
                    f"🙋 {actor.get('name') or uid} não vai no treino: {t['titulo']}",
                    motivo or "Sem motivo informado.", t["id"])
        audit(self, actor, "treino.confirmar", target_type="treinamentos", target_id=t["id"], notes=c)
        return self._send(200, {"ok": True})

    def _cancelar(self, sb, actor, body, _action):
        t = _get_treino(sb, _s(body.get("id"), 80))
        if not t:
            return self._send(404, {"ok": False, "error": "treinamento não encontrado"})
        if not _pode_gerir(actor, t):
            return self._send(403, {"ok": False, "error": "só a gestão ou o instrutor cancela"})
        if t.get("status") == "realizado":
            return self._send(400, {"ok": False, "error": "treinamento já realizado"})
        motivo = _s(body.get("motivo"), 300)
        sb.table("treinamentos").update({"status": "cancelado", "cancel_motivo": motivo, "updated_at": _now()}) \
            .eq("id", t["id"]).execute()
        t["status"] = "cancelado"
        ag = _sync_agenda(sb, t, [], set())
        ps = [p["user_id"] for p in _parts_de(sb, [t["id"]]).get(t["id"], [])]
        avisados = 0
        if str(t.get("data") or "") >= hoje_brt().isoformat():
            avisados = _avisar(ps + [t.get("instrutor_id")], actor, f"🚫 Treinamento cancelado: {t['titulo']}",
                               (motivo + " · " if motivo else "") + _quando(t), t["id"])
        audit(self, actor, "treino.cancelar", target_type="treinamentos", target_id=t["id"], notes=motivo)
        return self._send(200, {"ok": True, "avisados": avisados, "agenda": ag})

    def _excluir(self, sb, actor, body, _action):
        if (actor.get("lvl") or 0) < 7:
            return self._send(403, {"ok": False, "error": "só sócio ou gerente exclui"})
        t = _get_treino(sb, _s(body.get("id"), 80))
        if not t:
            return self._send(404, {"ok": False, "error": "treinamento não encontrado"})
        ag = _sync_agenda(sb, {**t, "status": "cancelado"}, [], set())
        sb.table("treinamento_participantes").delete().eq("treinamento_id", t["id"]).execute()
        sb.table("treinamentos").delete().eq("id", t["id"]).execute()
        audit(self, actor, "treino.excluir", target_type="treinamentos", target_id=t["id"],
              before={"titulo": t.get("titulo"), "data": t.get("data")})
        return self._send(200, {"ok": True, "agenda": ag})
