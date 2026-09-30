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
# folga nas bordas: o Zoho responde em datetime UTC e o House guarda data local,
# então a fronteira da janela nunca bate exatamente. Só entra na conta de apagar
# quem está DENTRO da janela com essa folga.
FOLGA_BORDA = 2
MAX_NOVOS_POR_RODADA = 300


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


SERIE_DIAS_FRENTE = 120
_BYDAY = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def estender_series(sb):
    """🔁 v89.1.3 — mantém cada série semanal com ocorrências no House até
    hoje+120d (a Agenda lista por data, então precisa de uma linha por semana).
    Só FREQ=WEEKLY por enquanto. Copia a mestra; ocorrência nova nasce sem
    zoho_uid e nunca é enviada sozinha (a mestra já é recorrente no Zoho)."""
    out = {"series": 0, "criadas": 0}
    try:
        mestras = (sb.table("eventos").select("*").not_.is_("rrule", "null")
                   .neq("status", "cancelado").limit(200).execute().data or [])
    except Exception as e:
        return {"erro": str(e)[:120]}
    ate = (datetime.now(timezone.utc) - timedelta(hours=3)).date() + timedelta(days=SERIE_DIAS_FRENTE)
    for m in mestras:
        regra = dict(p.split("=", 1) for p in str(m.get("rrule") or "").split(";") if "=" in p)
        sid = m.get("serie_id")
        if regra.get("FREQ") != "WEEKLY" or not sid or not m.get("data"):
            continue
        out["series"] += 1
        passo = timedelta(weeks=int(regra.get("INTERVAL") or 1))
        try:
            ult = (sb.table("eventos").select("data").eq("serie_id", sid)
                   .order("data", desc=True).limit(1).execute().data or [])
            d = datetime.fromisoformat(str(ult[0]["data"])[:10]).date() if ult else None
        except Exception:
            continue
        if not d:
            continue
        novas = []
        while d + passo <= ate and len(novas) < 60:
            d = d + passo
            if regra.get("BYDAY") and _BYDAY.get(regra["BYDAY"][:2]) != d.weekday():
                continue
            novas.append({k: m.get(k) for k in ("tipo", "titulo", "descricao", "hora_inicio", "hora_fim",
                                                 "all_day", "corretor_id", "participantes", "local", "cor",
                                                 "criado_por", "owner_id", "origem", "serie_id")}
                         | {"id": f"{sid}_{d.strftime('%Y%m%d')}", "data": d.isoformat(),
                            "status": "agendado", "aceites": {}})
        if novas:
            try:
                sb.table("eventos").upsert(novas, on_conflict="id", ignore_duplicates=True).execute()
                out["criadas"] += len(novas)
            except Exception:
                pass
    return out


_PESSOAS = {"em": 0, "mapa": None}


def mapa_pessoas(sb):
    """{email: {id, nome, zoho}} dos usuários ativos — pra convidado do Zoho
    virar participante no House (v89.9). Cache de 10 min por instância."""
    import time
    if _PESSOAS["mapa"] is not None and time.time() - _PESSOAS["em"] < 600:
        return _PESSOAS["mapa"]
    mapa = {}
    try:
        com_zoho = {str(r["user_id"]) for r in (sb.table("zoho_conexoes").select("user_id")
                                                 .limit(500).execute().data or [])}
        for u in (sb.table("users").select("id,name,email,status").limit(500).execute().data or []):
            if u.get("email") and (u.get("status") or "ativo") == "ativo":
                mapa[str(u["email"]).strip().lower()] = {
                    "id": str(u["id"]), "nome": u.get("name") or str(u["id"]),
                    "zoho": str(u["id"]) in com_zoho}
    except Exception:
        return _PESSOAS["mapa"] or {}
    _PESSOAS.update(em=time.time(), mapa=mapa)
    return mapa


# ⚡ modo rápido (v89.9, Paulo 30/09: "tem que ser em tempo real"). O Zoho
# Calendar NÃO tem webhook, então o cron de 1 em 1 minuto pergunta só a janela
# que importa (ontem … +30d = UMA chamada ao Zoho) e compara uma assinatura
# (uid+etag de tudo que veio). Igual à da rodada anterior → não toca no banco.
# Só quando algo mudou roda o PULL completo daquela janela. O PUSH não entra:
# House → Zoho já é na hora (agenda/_zoho_push.py).
RAPIDO_ATRAS, RAPIDO_FRENTE = 1, 30


def _assinatura(zevs, irmaos=None):
    import hashlib
    base = "|".join(sorted(f"{e.get('uid')}:{e.get('etag')}:{','.join(sorted((irmaos or {}).get(str(e.get('uid')), [])))}"
                           for e in zevs if e.get("uid")))
    return hashlib.md5(base.encode("utf-8")).hexdigest()


def _irmaos(sb, uid, uids):
    """{zoho_uid: [owner_id, ...]} de OUTRAS pessoas do House com o mesmo evento
    do Zoho na agenda (= quem participa) + {zoho_uid: zoho_hash} das linhas
    do próprio usuário. Uma consulta leve por lote de 150 uids."""
    outros, meus = {}, {}
    lst = list(uids)
    for i in range(0, len(lst), 150):
        try:
            for r in (sb.table("eventos").select("owner_id,zoho_uid,zoho_hash")
                      .in_("zoho_uid", lst[i:i + 150]).eq("origem", "zoho").limit(2000).execute().data or []):
                zu, dono = str(r.get("zoho_uid")), str(r.get("owner_id") or "")
                if dono == uid:
                    meus[zu] = r.get("zoho_hash") or ""
                elif dono:
                    outros.setdefault(zu, set()).add(dono)
        except Exception:
            pass
    return {k: sorted(v) for k, v in outros.items()}, meus


def sync_user(sb, conn, rapido=False):
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
    atras, frente = (RAPIDO_ATRAS, RAPIDO_FRENTE) if rapido else (DIAS_ATRAS, DIAS_FRENTE)
    ini_d = (hoje - timedelta(days=atras)).isoformat()
    fim_d = (hoje + timedelta(days=frente)).isoformat()

    # ── PULL: Zoho → House (fatiado em janelas de 31d — teto da API) ────
    zevs = z.listar_eventos(token, cal_uid, agora - timedelta(days=atras),
                            agora + timedelta(days=frente))
    vivos_uids = {str(e.get("uid")) for e in zevs if e.get("uid")}
    irmaos, hash_meu = _irmaos(sb, uid, vivos_uids)
    assinatura = _assinatura(zevs, irmaos)
    if rapido:
        if not zevs or assinatura == ((conn.get("last_sync_res") or {}).get("assinatura") or ""):
            return {"sem_mudanca": True}
        res["modo"] = "rapido"
    res["assinatura"] = assinatura if rapido else ""
    pessoas = mapa_pessoas(sb)
    nome_de = {p["id"]: p["nome"] for p in pessoas.values()}
    # ÍNDICE do que já existe, casado por zoho_uid e SEM filtro de data (v86.57).
    # O filtro antigo (data entre hoje-7 e hoje+60) era a ORIGEM do loop de
    # duplicação: o Zoho responde por datetime UTC e devolve o evento da borda
    # (data = hoje-8 no fuso local). Esse evento nunca aparecia no índice, o sync
    # concluía "não existe" e INSERIA de novo — a cada rodada, para sempre. Deu
    # 720 mil linhas para ~1.056 eventos reais em cinco semanas, e o limit(3000)
    # realimentava o estrago (com a tabela inchada, o índice vinha truncado).
    # A RPC zoho_index faz DISTINCT ON (zoho_uid) no banco: uma linha por evento
    # real, não importa quantas cópias existam nem em que data caiam.
    try:
        rows = sb.rpc("zoho_index", {"p_owner": uid}).execute().data or []
        existentes = {str(r["zoho_uid"]): r for r in rows if r.get("zoho_uid")}
    except Exception as e:
        # Sem índice confiável NÃO se insere nada: inserir às cegas é exatamente
        # o que produziu as duplicatas. Melhor a agenda ficar parada uma rodada.
        return {"erro": f"indice de eventos indisponivel: {str(e)[:120]}"}
    # `vivos` é montado ANTES de criar/atualizar: se o loop abaixo parar no meio
    # (trava de segurança ou erro), a lista de "quem ainda existe no Zoho" segue
    # completa. Montá-la dentro do loop faria a fase de deleção enxergar como
    # sumido tudo que ainda não tinha sido processado — e apagar agenda viva.
    vivos = {str(ze.get("uid")) for ze in zevs if ze.get("uid")}
    # v89.1.3: uid que já é de um evento do HOUSE e não deve voltar como linha
    # nova/atualizada: (a) mestra de série — o Zoho devolve a ocorrência da
    # janela e sobrescreveria data da mestra; (b) convite que o House mandou pra
    # agenda de OUTRA pessoa (attendee) — viraria cópia duplicada na agenda dela.
    ja_da_casa = set()
    if vivos:
        try:
            for r in (sb.table("eventos").select("zoho_uid,owner_id,serie_id,origem")
                      .in_("zoho_uid", list(vivos)[:300]).neq("origem", "zoho")
                      .execute().data or []):
                if r.get("serie_id") or str(r.get("owner_id") or "") != uid:
                    ja_da_casa.add(str(r["zoho_uid"]))
        except Exception:
            pass
    for ze in zevs:
        zu = ze.get("uid")
        if not zu:
            continue
        if str(zu) in ja_da_casa:
            res["puxados"] += 1
            continue
        nomes_irmaos = [nome_de.get(o, o) for o in irmaos.get(str(zu), [])]
        row = z.zoho_to_house_event(ze, uid, pessoas, nomes_irmaos)
        # zoho_hash não tem uso em linha vinda do Zoho: guarda quem mais tem o
        # evento, pra reescrever o "com Fulano" quando alguém entra/sai
        row["zoho_hash"] = ",".join(irmaos.get(str(zu), []))
        if not row.get("data"):
            continue
        cur = existentes.get(str(zu))
        try:
            if cur:
                if (str(cur.get("zoho_etag") or "") != row["zoho_etag"]
                        or hash_meu.get(str(zu), "") != row["zoho_hash"]):
                    sb.table("eventos").update(row).eq("id", cur["id"]).execute()
                    res["atualizados_house"] += 1
                res["puxados"] += 1
            else:
                # trava de segurança: uma rodada saudável cria dezenas de eventos,
                # nunca centenas. Se estourar, algo está errado no casamento —
                # para de criar e registra, em vez de encher a tabela em silêncio.
                if res["criados_house"] >= MAX_NOVOS_POR_RODADA:
                    res["abortado"] = "limite de criacao por rodada atingido"
                    res["erros"] += 1
                    break
                row["id"] = "evzo_" + uuid.uuid4().hex[:12]
                sb.table("eventos").insert(row).execute()
                res["criados_house"] += 1
                res["puxados"] += 1
        except Exception:
            res["erros"] += 1

    # apagado no Zoho → some do House (só o que NASCEU no Zoho; evento do House
    # que o dono removeu do Zoho não é apagado aqui — quem manda é a origem)
    # ATENÇÃO (v86.57): `existentes` agora cobre TODO o histórico do usuário, não
    # só a janela. Só é elegível a sumir o evento que está DENTRO da janela que o
    # Zoho realmente respondeu (com folga de borda) — sem esse recorte, todo
    # evento antigo, sobre o qual o Zoho nem foi perguntado, seria apagado aqui.
    # E lista VAZIA não é "a agenda ficou vazia" — é quase sempre falha de API,
    # token vencido ou calendário errado. Apagar em cima disso destrói a agenda
    # de quem só teve um erro de rede. Sem nada vivo, não se apaga nada.
    if not vivos:
        res["delecao_pulada"] = "Zoho nao devolveu evento nenhum na janela"
        vivos = None
    # no modo rápido a janela é curta: a folga de borda vira MARGEM DE SEGURANÇA
    # (só apaga o que está bem dentro do que o Zoho respondeu)
    if rapido:
        del_ini = (hoje - timedelta(days=atras - 1)).isoformat()
        del_fim = (hoje + timedelta(days=frente - FOLGA_BORDA)).isoformat()
    else:
        del_ini = (hoje - timedelta(days=atras + FOLGA_BORDA)).isoformat()
        del_fim = (hoje + timedelta(days=frente + FOLGA_BORDA)).isoformat()
    for zu, cur in (existentes.items() if vivos is not None else []):
        if zu in vivos:
            continue
        if not (del_ini <= str(cur.get("data") or "") <= del_fim):
            continue
        try:
            sb.table("eventos").delete().eq("id", cur["id"]).like("id", "evzo_%").execute()
            res["apagados_house"] += 1
        except Exception:
            res["erros"] += 1

    if rapido:
        try:
            sb.table("zoho_conexoes").update({"last_sync_at": z.now_iso(), "last_sync_res": res,
                                              "atualizado_em": z.now_iso()}).eq("user_id", uid).execute()
        except Exception:
            pass
        return res

    # ── PUSH: House → Zoho (cria os novos E atualiza os que mudaram) ────
    # NÃO usar .contains() aqui: o cliente PostgREST gera sintaxe de array PG
    # (cs.{x}) que NÃO casa com coluna jsonb — a query voltava vazia e o except
    # engolia, então o push ficava em 0 com "erros: 0" (parecia que não havia
    # nada pra enviar). Mesma pegadinha que já mordeu o kanban de reativação:
    # filtro complexo do PostgREST não é confiável → busca por data e filtra
    # participantes no Python.
    try:
        # origem='zoho' é descartada no loop logo abaixo — filtrar no BANCO evita
        # BAIXAR o que só seria jogado fora. Era o grosso do egress: até 4 mil
        # linhas completas por rodada, por usuário, quase todas cópias de zoho.
        casa = _page(lambda: sb.table("eventos").select("*")
                     .neq("origem", "zoho")
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
        # série (v89.1.3): só a mestra vai, e só pelo calendário do DONO — os
        # outros participantes recebem como convidados (attendees)
        if z.serie_fora_do_zoho(ev):
            continue
        if ev.get("rrule") and (ev.get("owner_id") or ev.get("criado_por")) != uid:
            continue
        try:
            conv = z.emails_convidados(sb, ev, uid) if ev.get("rrule") else None
            ed = z.house_to_zoho_event(ev, conv)
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
