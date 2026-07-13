"""
GET/POST /api/v3/producao/indicacao_kanban — KANBAN DE ABORDAGEM (Mariane). v84.25

O pipeline de abordagem pra pedir indicação, alimentado SOZINHO pelo RD CRM
em 3 bases (prioridade: quente > frio; um deal entra só 1 vez, unique deal_id):
  🏆 fechou_12m  — fechou negócio na PSM nos últimos 12 meses (win + closed_at)
  👣 visita_60d  — realizou visita (deal_stage_events estágio ~visita, funis
                   MAP + Conquista) nos últimos 60 dias
  🗂 carteira_map — todos do funil CARTEIRA MAP do RD

Card: coluna (drag&drop), etiquetas, obs, objetivo (venda|captacao|locacao),
valor da indicação, prêmio, tarefa com data+hora início/fim (vira evento na
Agenda), descarte com motivo, e "🎁 virou indicação" (cria a ficha no funil
da Indicação Premiada e amarra as duas pontas).

Interligações:
- 1ª vez que o card sai de "a_abordar" (não-descarte) → producao_eventos
  'abordagem_indicacao' (o contador de 45/dia da Mariane anda sozinho).
- Colunas e etiquetas são EDITÁVEIS (shared_kv indicacao_kanban_cfg, lvl>=7);
  'a_abordar' e 'descartado' são estruturais (não removíveis).

Auth: lvl>=2 (Mariane pra cima); set_cfg/excluir lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of, notify_all  # type: ignore
from _fisc_lib import _kv, _kv_set, get_cfg as fisc_cfg  # type: ignore

CFG_KEY = "indicacao_kanban_cfg"
CADENCIA_KEY = "kanban_cadencia_ultimo"
DEFAULT_CFG = {
    "colunas": [
        {"id": "a_abordar", "nome": "A abordar", "emoji": "📥", "cor": "#64748b"},
        {"id": "abordado", "nome": "Abordado — aguardando", "emoji": "💬", "cor": "#2563eb"},
        {"id": "topou", "nome": "Topou indicar", "emoji": "🤝", "cor": "#d97706"},
        {"id": "indicou", "nome": "Indicou", "emoji": "🎁", "cor": "#16a34a"},
        {"id": "descartado", "nome": "Descartado", "emoji": "🗑", "cor": "#dc2626"},
    ],
    "etiquetas": [
        {"id": "quente", "nome": "Quente", "cor": "#dc2626"},
        {"id": "morno", "nome": "Morno", "cor": "#d97706"},
        {"id": "frio", "nome": "Frio", "cor": "#2563eb"},
        {"id": "vip", "nome": "VIP", "cor": "#7c3aed"},
        {"id": "recontatar", "nome": "Recontatar", "cor": "#0891b2"},
    ],
    "cadencia": {
        "ativa": True,
        "lote_dia": 45,          # meta diária de cards trabalhados (espelha a meta da Fiscalização)
        "followup_dias": 3,      # 'abordado' parado há N dias → follow-up
        "topou_dias": 2,         # 'topou' sem indicação há N dias → cobrar o contato
        "prioridade": ["nps_promotor", "fechou_12m", "visita_60d", "manual", "funil_map"],
        "responsavel_match": "mariane",
    },
}
COLS_FIXAS = ("a_abordar", "descartado")
OBJETIVOS = ("venda", "captacao", "locacao")
CAMPOS_EDIT = ("nome", "contato", "obs", "objetivo", "valor_indicacao", "premio", "etiquetas")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _cfg(sb):
    v = _kv(sb, CFG_KEY)
    if isinstance(v, dict) and v.get("colunas"):
        cad = v.get("cadencia") or {}
        # base antiga 'carteira_map' virou 'funil_map' (v84.28); nps_promotor entra na frente (v84.29)
        prio = [("funil_map" if b == "carteira_map" else b)
                for b in (cad.get("prioridade") or DEFAULT_CFG["cadencia"]["prioridade"])]
        if "nps_promotor" not in prio:
            prio.insert(0, "nps_promotor")
        cad["prioridade"] = prio
        v["cadencia"] = {**DEFAULT_CFG["cadencia"], **cad}
        return v
    _kv_set(sb, CFG_KEY, DEFAULT_CFG)
    return json.loads(json.dumps(DEFAULT_CFG))


def _phone(contacts):
    """1º telefone da lista contacts[].phones[] do RD, só dígitos."""
    try:
        for c in contacts or []:
            for p in c.get("phones") or []:
                d = re.sub(r"\D", "", str(p.get("phone") or ""))
                if len(d) >= 10:
                    return d
    except Exception:
        pass
    return None


def _page_all(make_q, max_rows=6000):
    """Pagina além do teto de 1000 linhas do PostgREST. make_q() cria o query
    (JÁ com .order() estável — paginação sem ordem pula/duplica linhas)."""
    out, page = [], 1000
    for i in range(0, max_rows, page):
        rows = make_q().range(i, i + page - 1).execute().data or []
        out.extend(rows)
        if len(rows) < page:
            break
    return out


def _existentes(sb):
    """deal_ids que já têm card (pra sync não duplicar)."""
    try:
        rows = _page_all(lambda: sb.table("indicacao_kanban").select("deal_id")
                         .not_.is_("deal_id", "null").order("criado_em").order("id"), max_rows=20000)
        return {str(r["deal_id"]) for r in rows if r.get("deal_id")}
    except Exception:
        return set()


def _inserir_lote(sb, cards):
    """Insere em lotes de 500; ignora duplicados (unique deal_id)."""
    criadas = 0
    for i in range(0, len(cards), 500):
        lote = cards[i:i + 500]
        try:
            sb.table("indicacao_kanban").upsert(lote, on_conflict="deal_id",
                                                ignore_duplicates=True).execute()
            criadas += len(lote)
        except Exception:
            for c in lote:  # fallback: 1 a 1 pra não perder o lote por 1 conflito
                try:
                    sb.table("indicacao_kanban").insert(c).execute()
                    criadas += 1
                except Exception:
                    pass
    return criadas


def _sincronizar(sb, user):
    """As 3 bases do RD → cards novos em 'a_abordar'. Devolve contagem por base."""
    ja = _existentes(sb)
    novos, res = [], {"fechou_12m": 0, "visita_60d": 0, "funil_map": 0}
    # só o miolo de contatos do rd_raw (o blob inteiro ×6000 deals estoura a função)
    SEL = "id,name,contacts:rd_raw->contacts"

    def add(deal, base):
        did = str(deal.get("id"))
        if not did or did in ja:
            return
        nome = (deal.get("name") or "").strip()
        if not nome:
            return
        ja.add(did)
        novos.append({"deal_id": did, "base": base, "nome": nome[:160],
                      "contato": _phone(deal.get("contacts")),
                      "coluna": "a_abordar", "atualizado_por": str(user.get("id"))})
        res[base] += 1

    # 🏆 Base 3 primeiro (mais quente ganha a etiqueta de base)
    corte12m = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    try:
        rows = _page_all(lambda: sb.table("deals").select(SEL).eq("win", True)
                         .gte("closed_at", corte12m).order("id"), max_rows=3000)
        for d in rows:
            add(d, "fechou_12m")
    except Exception:
        pass

    # 👣 Base 2: visitas 60d (event sourcing), funis MAP + Conquista
    corte60d = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    try:
        evs = _page_all(lambda: sb.table("deal_stage_events").select("deal_id,pipeline_name")
                        .ilike("stage_name", "%visita%").gte("occurred_at", corte60d)
                        .order("occurred_at"), max_rows=4000)
        ids = list({str(e["deal_id"]) for e in evs
                    if e.get("deal_id") and frente_of(e.get("pipeline_name")) in ("map", "conquista")
                    and str(e["deal_id"]) not in ja})
        for i in range(0, len(ids), 150):
            dd = sb.table("deals").select(SEL).in_("id", ids[i:i + 150]).execute().data or []
            for d in dd:
                add(d, "visita_60d")
    except Exception:
        pass

    # 🗂 Base 1: FUNIL MAP inteiro (base de clientes pra pedir indicação)
    try:
        rows = _page_all(lambda: sb.table("deals").select(SEL)
                         .ilike("pipeline_name", "funil map").order("id"), max_rows=8000)
        for d in rows:
            add(d, "funil_map")
    except Exception:
        pass

    criadas = _inserir_lote(sb, novos) if novos else 0
    return res, criadas


def _responsavel_ids(sb, match):
    """user ids que batem no match (mesma regra user_match da Fiscalização)."""
    try:
        rows = sb.table("users").select("id,name,login,email").limit(500).execute().data or []
        m = (match or "").lower()
        return [str(r["id"]) for r in rows
                if m and m in " ".join(str(r.get(k) or "") for k in ("name", "login", "email")).lower()]
    except Exception:
        return []


def gerar_fila(sb, force=False):
    """Monta a fila do dia: ⏰ atrasadas → 🔁 follow-ups → 🤝 cobranças → 📞 novas
    (até o lote, bases quentes primeiro). Marca tarefa auto nos cards e notifica
    a responsável. Idempotente por dia (force refaz)."""
    cfg = _cfg(sb)
    cad = cfg.get("cadencia") or {}
    if not cad.get("ativa", True):
        return {"ok": False, "motivo": "cadência desligada na config"}
    brt = timezone(timedelta(hours=-3))
    hoje = datetime.now(brt).date().isoformat()
    ultimo = _kv(sb, CADENCIA_KEY)
    if not force and ultimo.get("data") == hoje:
        return {"ok": True, "ja_gerada": True, **(ultimo.get("res") or {})}
    lote = max(1, min(500, int(cad.get("lote_dia") or 45)))
    fu_dias = max(1, min(30, int(cad.get("followup_dias") or 3)))
    tp_dias = max(1, min(30, int(cad.get("topou_dias") or 2)))
    agora = datetime.now(timezone.utc)
    corte_fu = (agora - timedelta(days=fu_dias)).isoformat()
    corte_tp = (agora - timedelta(days=tp_dias)).isoformat()

    rows = _page_all(lambda: sb.table("indicacao_kanban").select(
        "id,coluna,base,tarefa,indicacao_id,atualizado_em,criado_em")
        .neq("coluna", "descartado").neq("coluna", "indicou").order("id"), max_rows=8000)

    def t(c):
        return c.get("tarefa") or {}

    def manual_futura(c):
        return bool(t(c).get("data") and not t(c).get("auto") and str(t(c)["data"]) >= hoje)

    usados = set()

    def pega(cond, chave_ord=None, limite=None):
        sel = [c for c in rows if c["id"] not in usados and not manual_futura(c) and cond(c)]
        if chave_ord:
            sel.sort(key=chave_ord)
        if limite is not None:
            sel = sel[:limite]
        usados.update(c["id"] for c in sel)
        return sel

    atrasadas = pega(lambda c: t(c).get("auto") and str(t(c).get("data") or "9999") < hoje)
    followups = pega(lambda c: c["coluna"] == "abordado" and str(c.get("atualizado_em") or "") <= corte_fu)
    cobrancas = pega(lambda c: c["coluna"] == "topou" and not c.get("indicacao_id")
                     and str(c.get("atualizado_em") or "") <= corte_tp)
    prio = {b: i for i, b in enumerate(cad.get("prioridade") or [])}
    resto = max(0, lote - len(atrasadas) - len(followups) - len(cobrancas))
    novas = pega(lambda c: c["coluna"] == "a_abordar" and not t(c).get("data"),
                 chave_ord=lambda c: (prio.get(c.get("base"), 9), str(c.get("criado_em") or "")),
                 limite=resto)

    grupos = [(atrasadas, "atrasada", "⏰ Atrasada — prioridade máxima"),
              (followups, "followup", "🔁 Follow-up (sem resposta)"),
              (cobrancas, "cobranca", "🤝 Cobrar o contato do indicado"),
              (novas, "nova", "📞 Abordar (fila de hoje)")]
    for lista, tipo, titulo in grupos:
        for c in lista:
            try:
                sb.table("indicacao_kanban").update(
                    {"tarefa": {"data": hoje, "titulo": titulo, "auto": True, "tipo_fila": tipo},
                     "atualizado_por": "cadencia"}).eq("id", c["id"]).execute()
            except Exception:
                pass

    res = {"data": hoje, "total": len(usados), "atrasadas": len(atrasadas),
           "followups": len(followups), "cobrancas": len(cobrancas), "novas": len(novas)}
    _kv_set(sb, CADENCIA_KEY, {"data": hoje, "res": res})

    if res["total"]:
        try:
            match = cad.get("responsavel_match") or \
                (((fisc_cfg(sb).get("colaboradores") or {}).get("mariane") or {}).get("user_match") or "mariane")
            ids = _responsavel_ids(sb, match)
            if ids:
                corpo = (f"{res['total']} contato(s) na sua fila: "
                         f"⏰ {res['atrasadas']} atrasada(s) · 🔁 {res['followups']} follow-up(s) · "
                         f"🤝 {res['cobrancas']} cobrança(s) · 📞 {res['novas']} nova(s). "
                         "Abra o Kanban e trabalhe de cima pra baixo.")
                notify_all(ids, tipo="fiscalizacao", title="📋 Sua fila de indicação de hoje",
                           body=corpo[:300], link="#/cs-indicacoes")
        except Exception:
            pass
    return {"ok": True, **res}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = _page_all(lambda: sb.table("indicacao_kanban").select(
                "id,deal_id,base,nome,contato,coluna,etiquetas,obs,objetivo,valor_indicacao,"
                "premio,descarte_motivo,tarefa,indicacao_id,abordado_em,criado_em,atualizado_em")
                .order("atualizado_em", desc=True).order("id"), max_rows=8000)
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        return self._send(200, {"ok": True, "cards": rows, "cfg": _cfg(sb),
                                "can_cfg": (user.get("lvl") or 0) >= 7})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
            body = json.loads(raw or "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        action = (body.get("action") or "").strip()
        lvl = user.get("lvl") or 0

        def card(cid):
            rows = sb.table("indicacao_kanban").select("*").eq("id", str(cid)).limit(1).execute().data or []
            return rows[0] if rows else None

        def log_abordagem(c):
            """1ª saída de a_abordar (não-descarte) conta na Fiscalização."""
            try:
                sb.table("producao_eventos").insert({
                    "colaborador": "mariane", "tipo": "abordagem_indicacao",
                    "ref_type": "indicacao_kanban", "ref_id": str(c["id"]),
                    "meta": {"rotulo": (c.get("nome") or "")[:80], "base": c.get("base")},
                    "criado_por": str(user.get("id"))}).execute()
            except Exception:
                pass

        try:
            if action == "sincronizar":
                res, criadas = _sincronizar(sb, user)
                audit(self, user, "ik.sincronizar", "indicacao_kanban", None,
                      notes=f"criadas={criadas} {res}")
                return self._send(200, {"ok": True, "criadas": criadas, "por_base": res})

            if action == "gerar_fila":
                r = gerar_fila(sb, force=bool(body.get("force")))
                audit(self, user, "ik.gerar_fila", "indicacao_kanban", None, notes=str(r)[:200])
                return self._send(200, r)

            if action == "mover":
                c = card(body.get("id"))
                col = (body.get("coluna") or "").strip()
                if not c or not col:
                    return self._send(400, {"ok": False, "error": "id e coluna obrigatórios"})
                cols = {x["id"] for x in _cfg(sb).get("colunas") or []}
                if col not in cols:
                    return self._send(400, {"ok": False, "error": "coluna não existe"})
                upd = {"coluna": col, "atualizado_em": _now(), "atualizado_por": str(user.get("id"))}
                if col == "descartado":
                    upd["descarte_motivo"] = str(body.get("motivo") or "").strip()[:200] or None
                elif c.get("coluna") == "descartado":
                    upd["descarte_motivo"] = None  # voltou do descarte
                if col != "descartado" and c.get("coluna") == "a_abordar" and not c.get("abordado_em"):
                    upd["abordado_em"] = _now()
                    log_abordagem(c)
                if (c.get("tarefa") or {}).get("auto"):
                    upd["tarefa"] = None  # mover = tarefa da fila cumprida
                sb.table("indicacao_kanban").update(upd).eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True})

            if action == "editar":
                c = card(body.get("id"))
                if not c:
                    return self._send(404, {"ok": False, "error": "card não encontrado"})
                upd = {}
                for k in CAMPOS_EDIT:
                    if k not in body:
                        continue
                    v = body.get(k)
                    if k == "etiquetas":
                        upd[k] = [str(x)[:40] for x in v][:12] if isinstance(v, list) else []
                    elif k in ("valor_indicacao", "premio"):
                        try:
                            upd[k] = float(v) if v not in (None, "") else None
                        except (TypeError, ValueError):
                            pass
                    elif k == "objetivo":
                        upd[k] = v if v in OBJETIVOS else None
                    else:
                        upd[k] = (str(v).strip()[:2000] or None) if v is not None else None
                if not upd:
                    return self._send(400, {"ok": False, "error": "nada pra salvar"})
                upd.update({"atualizado_em": _now(), "atualizado_por": str(user.get("id"))})
                sb.table("indicacao_kanban").update(upd).eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True})

            if action == "novo":  # card manual
                nome = str(body.get("nome") or "").strip()
                if not nome:
                    return self._send(400, {"ok": False, "error": "nome obrigatório"})
                ins = {"base": "manual", "nome": nome[:160],
                       "contato": (str(body.get("contato") or "").strip()[:40] or None),
                       "coluna": "a_abordar", "atualizado_por": str(user.get("id"))}
                r = sb.table("indicacao_kanban").insert(ins).execute().data or []
                return self._send(200, {"ok": True, "id": (r[0]["id"] if r else None)})

            if action == "tarefa":
                c = card(body.get("id"))
                if not c:
                    return self._send(404, {"ok": False, "error": "card não encontrado"})
                data = str(body.get("data") or "").strip()[:10]
                if not data:
                    return self._send(400, {"ok": False, "error": "data obrigatória"})
                hi = (str(body.get("hora_ini") or "").strip()[:5] or None)
                hf = (str(body.get("hora_fim") or "").strip()[:5] or None)
                titulo = (str(body.get("titulo") or "").strip()[:140]
                          or f"Indicação — {c.get('nome')}")
                ev = {"id": "evik_" + uuid.uuid4().hex[:10], "tipo": "tarefa",
                      "titulo": titulo, "data": data, "hora_inicio": hi, "hora_fim": hf,
                      "all_day": not hi, "participantes": [str(user.get("id"))],
                      "descricao": f"Kanban Indicação Premiada · {c.get('nome')} ({c.get('contato') or 'sem fone'})",
                      "status": "agendado"}
                antigo = (c.get("tarefa") or {}).get("evento_id")
                if antigo:
                    try:
                        sb.table("eventos").delete().eq("id", antigo).execute()
                    except Exception:
                        pass
                sb.table("eventos").insert(ev).execute()
                tarefa = {"data": data, "hora_ini": hi, "hora_fim": hf,
                          "titulo": titulo, "evento_id": ev["id"]}
                sb.table("indicacao_kanban").update({"tarefa": tarefa, "atualizado_em": _now(),
                                                     "atualizado_por": str(user.get("id"))}) \
                    .eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True, "tarefa": tarefa})

            if action == "virar_indicacao":
                c = card(body.get("id"))
                if not c:
                    return self._send(404, {"ok": False, "error": "card não encontrado"})
                tipo = body.get("tipo") if body.get("tipo") in ("venda", "locacao") else "venda"
                ind = {"tipo": tipo, "origem": "abordagem", "status": "nova",
                       "indicador_nome": (c.get("nome") or "?")[:120],
                       "indicador_contato": c.get("contato"),
                       "indicado_nome": (str(body.get("indicado_nome") or "").strip()[:120] or None),
                       "indicado_contato": (str(body.get("indicado_contato") or "").strip()[:40] or None),
                       "obs": f"Via Kanban de Abordagem (base {c.get('base')})",
                       "criado_por": str(user.get("id"))}
                r = sb.table("indicacoes").insert(ind).execute().data or []
                iid = str(r[0]["id"]) if r else None
                upd = {"coluna": "indicou", "indicacao_id": iid, "atualizado_em": _now(),
                       "atualizado_por": str(user.get("id"))}
                if not c.get("abordado_em"):
                    upd["abordado_em"] = _now()
                    log_abordagem(c)
                sb.table("indicacao_kanban").update(upd).eq("id", str(c["id"])).execute()
                audit(self, user, "ik.virar_indicacao", "indicacoes", iid, notes=c.get("nome"))
                return self._send(200, {"ok": True, "indicacao_id": iid})

            if action == "set_cfg":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "editar o quadro é da gestão (lvl>=7)"})
                cols, tags = [], []
                for x in (body.get("colunas") or [])[:12]:
                    if not isinstance(x, dict) or not str(x.get("nome") or "").strip():
                        continue
                    cols.append({"id": (str(x.get("id") or "").strip() or "col_" + uuid.uuid4().hex[:6]),
                                 "nome": str(x["nome"]).strip()[:40],
                                 "emoji": (str(x.get("emoji") or "📌").strip()[:8] or "📌"),
                                 "cor": (str(x.get("cor") or "#64748b").strip()[:16])})
                ids = [c["id"] for c in cols]
                if not all(f in ids for f in COLS_FIXAS):
                    return self._send(400, {"ok": False, "error": "as colunas 'a_abordar' e 'descartado' são estruturais e não podem sair"})
                for x in (body.get("etiquetas") or [])[:20]:
                    if not isinstance(x, dict) or not str(x.get("nome") or "").strip():
                        continue
                    tags.append({"id": (str(x.get("id") or "").strip() or "tag_" + uuid.uuid4().hex[:6]),
                                 "nome": str(x["nome"]).strip()[:30],
                                 "cor": (str(x.get("cor") or "#64748b").strip()[:16])})
                atual = _cfg(sb)
                cad = dict(atual.get("cadencia") or DEFAULT_CFG["cadencia"])
                bc = body.get("cadencia")
                if isinstance(bc, dict):
                    if "ativa" in bc:
                        cad["ativa"] = bool(bc["ativa"])
                    for k, lim in (("lote_dia", 500), ("followup_dias", 30), ("topou_dias", 30)):
                        if bc.get(k) is not None:
                            try:
                                cad[k] = max(1, min(lim, int(bc[k])))
                            except (TypeError, ValueError):
                                pass
                cfg = {"colunas": cols, "etiquetas": tags, "cadencia": cad}
                _kv_set(sb, CFG_KEY, cfg)
                audit(self, user, "ik.set_cfg", "shared_kv", CFG_KEY, notes=f"{len(cols)} col / {len(tags)} tags")
                return self._send(200, {"ok": True, "cfg": cfg})

            if action == "limpar_base":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "limpar base é da gestão (lvl>=7)"})
                b = str(body.get("base") or "").strip()
                if not b:
                    return self._send(400, {"ok": False, "error": "base obrigatória"})
                # só remove cards INTOCADOS (nunca abordados, sem indicação amarrada)
                r = sb.table("indicacao_kanban").delete().eq("base", b).eq("coluna", "a_abordar") \
                    .is_("abordado_em", "null").is_("indicacao_id", "null").execute()
                n = len(r.data or [])
                audit(self, user, "ik.limpar_base", "indicacao_kanban", None, notes=f"base={b} removidos={n}")
                return self._send(200, {"ok": True, "removidos": n})

            if action == "excluir":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "excluir card é da gestão (use o descarte)"})
                cid = str(body.get("id") or "")
                sb.table("indicacao_kanban").delete().eq("id", cid).execute()
                audit(self, user, "ik.excluir", "indicacao_kanban", cid)
                return self._send(200, {"ok": True})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
