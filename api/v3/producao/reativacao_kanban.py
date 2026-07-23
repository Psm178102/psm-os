"""
GET/POST /api/v3/producao/reativacao_kanban — REATIVAÇÃO MAP (Leire). v84.40

A antiga fila 1-a-1 virou o kanban completo da metodologia da casa:
- Base automática do RD: deals do FUNIL MAP em ABERTO (win null), parados há
  N+ dias (parado_dias, default 30), COM telefone (é WhatsApp 1-a-1) e fonte
  ≠ "Carteira do corretor" (lead do corretor é dele, a casa não reativa).
- Cadência diária (cron 9h): fila de 40/dia — ⏰ atrasadas → 🔁 follow-ups →
  📞 novas por VALOR do negócio (maiores primeiro) — e notifica a Leire.
- Mover o card: 1ª saída de "A reativar" loga producao_eventos
  'reativacao_tocada' (a meta de 40/dia da Leire na Fiscalização anda sozinha);
  chegar em "🔥 Respondeu" notifica a GESTÃO na hora (o sócio assume o
  fechamento); follow-up automático por coluna (⚙️ 🔁 N dias) cria tarefa +
  evento na Agenda de quem moveu.
- Card: prazo colorido, etiquetas, obs, corretor do RD, wa.me, 🧠 mensagem
  por IA (contexto: o que buscava, valor, tempo parado), descarte com motivo.
- Fluxos de mensagem por SITUAÇÃO (editáveis) — anti-textão, regra da Leire.

Auth: lvl>=2; set_cfg/set_fluxos/excluir/limpar lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
from _fisc_lib import _kv, _kv_ok, _kv_set, gestores_ids  # type: ignore
from _ia_lib import ia, REGRAS_WHATSAPP  # type: ignore

CFG_KEY = "reativacao_kanban_cfg"
FLUXOS_KEY = "reativacao_fluxos"
CADENCIA_KEY = "reativacao_cadencia_ultimo"
FONTE_BLOQUEADA = "carteira do corretor"
COLS_FIXAS = ("a_reativar", "descartado")
CAMPOS_EDIT = ("nome", "contato", "obs", "etiquetas")

DEFAULT_CFG = {
    "colunas": [
        {"id": "a_reativar", "nome": "A reativar", "emoji": "📥", "cor": "#64748b", "followup_dias": 0},
        {"id": "abordado", "nome": "Abordado — aguardando", "emoji": "💬", "cor": "#2563eb", "followup_dias": 3},
        {"id": "respondeu", "nome": "Respondeu / interessado", "emoji": "🔥", "cor": "#d97706", "followup_dias": 1},
        {"id": "reativado", "nome": "Reativado — atendimento retomado", "emoji": "✅", "cor": "#16a34a", "followup_dias": 0},
        {"id": "descartado", "nome": "Descartado", "emoji": "🗑", "cor": "#dc2626", "followup_dias": 0},
    ],
    "etiquetas": [
        {"id": "quente", "nome": "Quente", "cor": "#dc2626"},
        {"id": "morno", "nome": "Morno", "cor": "#d97706"},
        {"id": "frio", "nome": "Frio", "cor": "#2563eb"},
        {"id": "alto_valor", "nome": "Alto valor", "cor": "#7c3aed"},
        {"id": "recontatar", "nome": "Recontatar", "cor": "#0891b2"},
    ],
    "cadencia": {"ativa": True, "lote_dia": 40, "followup_dias": 3,
                 "responsavel_match": "leire", "parado_dias": 30},
}
FUP_DEFAULT = {"abordado": 3, "respondeu": 1}

DEFAULT_FLUXOS = [
    {"id": "reabertura", "emoji": "🧊", "nome": "Reabertura do lead parado",
     "quando_usar": "1ª mensagem pro lead que sumiu. UMA mensagem curta com contexto do que ele buscava (está no card) — nada de catálogo, nada de textão.",
     "passos": [
         {"titulo": "Reabertura com contexto", "envio": "manhã (9h–11h), dia útil",
          "texto": "Oi {nome}, tudo bem? Aqui é a Leire, da PSM 😊 Você chegou a procurar um imóvel com a gente um tempo atrás — ainda tá nos seus planos?"},
         {"titulo": "Respondeu: situar o momento", "envio": "logo após a resposta",
          "texto": "Que bom te ouvir! Me conta: o que mudou de lá pra cá? Ainda procura na mesma região e faixa, ou o plano é outro agora?"},
         {"titulo": "Follow-up sem resposta", "envio": "3 dias depois — SÓ UMA VEZ",
          "texto": "Oi {nome}! Rapidinho: ainda faz sentido a gente te ajudar com o imóvel, ou tiro seu nome da lista? Sem problema nenhum 😊"},
     ]},
    {"id": "respondeu", "emoji": "💬", "nome": "Respondeu — requalificar",
     "quando_usar": "Ele respondeu! Agora é entender o momento SEM interrogatório: uma pergunta por vez, e mover o card pra 🔥 assim que esquentar.",
     "passos": [
         {"titulo": "Momento atual", "envio": "na conversa",
          "texto": "Perfeito! E hoje, o que pesa mais pra você: preço, localização ou condição de entrada? Assim já te mando só o que encaixa 😉"},
         {"titulo": "Esquentou: marcar a conversa", "envio": "se o interesse voltar",
          "texto": "Tenho umas opções que casam com isso. Prefere que o nosso especialista te chame hoje ou amanhã?"},
     ]},
    {"id": "interessado", "emoji": "🔥", "nome": "Interessado — passar o bastão",
     "quando_usar": "Ele quer retomar. Mova o card pra 🔥 Respondeu/interessado — a GESTÃO é notificada na hora e assume o fechamento.",
     "passos": [
         {"titulo": "Confirmar e conectar", "envio": "na hora",
          "texto": "Fechado, {nome}! Vou te conectar com o nosso especialista — ele te chama ainda hoje pra te mostrar o que temos. Combinado?"},
     ]},
    {"id": "nao_responde", "emoji": "😴", "nome": "Não responde — última tentativa",
     "quando_usar": "Já teve reabertura + follow-up e nada. UMA última mensagem elegante e descarta com motivo 'não responde'.",
     "passos": [
         {"titulo": "Última tentativa", "envio": "5+ dias após o follow-up",
          "texto": "Oi {nome}! Última mensagem, prometo 😊 Se um dia voltar a procurar imóvel, a PSM tá aqui. Vou pausar seu atendimento por enquanto, tá bom?"},
     ]},
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _cfg(sb):
    v, _leu = _kv_ok(sb, CFG_KEY)
    if isinstance(v, dict) and v.get("colunas"):
        for col in v.get("colunas") or []:
            if "followup_dias" not in col:
                col["followup_dias"] = FUP_DEFAULT.get(col.get("id"), 0)
        v["cadencia"] = {**DEFAULT_CFG["cadencia"], **(v.get("cadencia") or {})}
        return v
    # v84.88 — seed dos defaults SÓ quando a leitura CONFIRMOU ausência (1º boot).
    # Leitura falhou -> devolve defaults EM MEMÓRIA sem gravar nada por cima.
    if _leu:
        _kv_set(sb, CFG_KEY, DEFAULT_CFG)
    return json.loads(json.dumps(DEFAULT_CFG))


def _fluxos_load(sb):
    v = _kv(sb, FLUXOS_KEY)
    fx = v.get("fluxos") if isinstance(v, dict) else None
    if fx:
        return fx
    _kv_set(sb, FLUXOS_KEY, {"fluxos": DEFAULT_FLUXOS})
    return json.loads(json.dumps(DEFAULT_FLUXOS))


def _fonte(v):
    if isinstance(v, dict):
        return (v.get("name") or "").strip().lower()
    if isinstance(v, str):
        return v.strip().lower()
    return ""


def _phone(contacts):
    try:
        for c in contacts or []:
            for p in c.get("phones") or []:
                d = re.sub(r"\D", "", str(p.get("phone") or ""))
                if len(d) >= 10:
                    return d
    except Exception:
        pass
    return None


def _page_all(make_q, max_rows=8000):
    out, page = [], 1000
    for i in range(0, max_rows, page):
        rows = make_q().range(i, i + page - 1).execute().data or []
        out.extend(rows)
        if len(rows) < page:
            break
    return out


def _tarefa_followup(sb, cfg, card, col_id, uid):
    """Coluna destino com followup_dias > 0: tarefa auto + evento na Agenda de quem moveu."""
    antiga = card.get("tarefa") or {}
    if antiga.get("auto") and antiga.get("evento_id"):
        try:
            sb.table("eventos").delete().eq("id", antiga["evento_id"]).execute()
        except Exception:
            pass
    col = next((x for x in (cfg.get("colunas") or []) if x.get("id") == col_id), None) or {}
    try:
        dias = max(0, min(60, int(col.get("followup_dias") or 0)))
    except (TypeError, ValueError):
        dias = 0
    if dias <= 0:
        return None
    brt = timezone(timedelta(hours=-3))
    alvo = (datetime.now(brt) + timedelta(days=dias)).date().isoformat()
    titulo = f"🔁 Follow-up — {card.get('nome')} ({col.get('nome') or col_id})"[:160]
    ev_id = "evfr_" + uuid.uuid4().hex[:10]
    try:
        sb.table("eventos").insert({"id": ev_id, "tipo": "tarefa", "titulo": titulo,
                                    "data": alvo, "all_day": True, "participantes": [uid],
                                    "descricao": f"Follow-up automático ({dias}d) — Reativação MAP",
                                    "status": "agendado"}).execute()
    except Exception:
        ev_id = None
    return {"data": alvo, "titulo": titulo[:140], "auto": True,
            "tipo_fila": "followup_coluna", "evento_id": ev_id, "por": uid}


def _sincronizar(sb, user):
    """FUNIL MAP aberto (win null) + parado + com fone + fonte liberada → cards.
    Filtra win/parado em PYTHON: o encadeamento .is_('win','null').lte(...) do
    PostgREST não casa de forma confiável (retornava ~12 de ~685). v84.42"""
    cfg = _cfg(sb)
    parado = max(7, min(365, int((cfg.get("cadencia") or {}).get("parado_dias") or 30)))
    corte_dt = datetime.now(timezone.utc) - timedelta(days=parado)
    try:
        ja_rows = _page_all(lambda: sb.table("reativacao_kanban").select("deal_id")
                            .not_.is_("deal_id", "null").order("criado_em").order("id"), max_rows=20000)
        ja = {str(r["deal_id"]) for r in ja_rows if r.get("deal_id")}
    except Exception:
        ja = set()
    SEL = ("id,name,amount,win,closed_at,stage_name,updated_at_rd,user_email,"
           "contacts:rd_raw->contacts,fonte:rd_raw->deal_source")
    rows = _page_all(lambda: sb.table("deals").select(SEL)
                     .ilike("pipeline_name", "funil map").order("id"), max_rows=8000)
    novos, sem_fone = [], 0
    for d in rows:
        did = str(d.get("id"))
        if not did or did in ja:
            continue
        if d.get("win") is not None or d.get("closed_at"):
            continue  # em aberto = win null e sem data de fechamento
        upd = d.get("updated_at_rd")
        try:
            updt = datetime.fromisoformat(str(upd).replace("Z", "+00:00")) if upd else None
        except Exception:
            updt = None
        if not updt or updt > corte_dt:
            continue  # ainda ativo (mexeu recentemente) → não é reativação
        if FONTE_BLOQUEADA in _fonte(d.get("fonte")):
            continue
        nome = (d.get("name") or "").strip()
        fone = _phone(d.get("contacts"))
        if not nome:
            continue
        if not fone:
            sem_fone += 1
            continue  # reativação é WhatsApp 1-a-1: sem fone não entra
        ja.add(did)
        novos.append({"deal_id": did, "nome": nome[:160], "contato": fone,
                      "corretor_email": (d.get("user_email") or "").lower() or None,
                      "valor": d.get("amount"), "estagio": (d.get("stage_name") or "")[:80] or None,
                      "parado_desde": d.get("updated_at_rd"),
                      "coluna": "a_reativar", "atualizado_por": str(user.get("id"))})
    criadas = 0
    for i in range(0, len(novos), 500):
        lote = novos[i:i + 500]
        try:
            sb.table("reativacao_kanban").upsert(lote, on_conflict="deal_id",
                                                 ignore_duplicates=True).execute()
            criadas += len(lote)
        except Exception:
            for c in lote:
                try:
                    sb.table("reativacao_kanban").insert(c).execute()
                    criadas += 1
                except Exception:
                    pass
    return {"criadas": criadas, "sem_fone": sem_fone, "parado_dias": parado}


def _responsavel_ids(sb, match):
    try:
        rows = sb.table("users").select("id,name,login,email").limit(500).execute().data or []
        m = (match or "").lower()
        return [str(r["id"]) for r in rows
                if m and m in " ".join(str(r.get(k) or "") for k in ("name", "login", "email")).lower()]
    except Exception:
        return []


def gerar_fila(sb, force=False):
    """Fila do dia: ⏰ atrasadas → 🔁 follow-ups → 📞 novas por VALOR desc, até o lote."""
    cfg = _cfg(sb)
    cad = cfg.get("cadencia") or {}
    if not cad.get("ativa", True):
        return {"ok": False, "motivo": "cadência desligada na config"}
    brt = timezone(timedelta(hours=-3))
    hoje = datetime.now(brt).date().isoformat()
    ultimo = _kv(sb, CADENCIA_KEY)
    if not force and ultimo.get("data") == hoje:
        return {"ok": True, "ja_gerada": True, **(ultimo.get("res") or {})}
    lote = max(1, min(500, int(cad.get("lote_dia") or 40)))
    fu_dias = max(1, min(30, int(cad.get("followup_dias") or 3)))
    corte_fu = (datetime.now(timezone.utc) - timedelta(days=fu_dias)).isoformat()

    rows = _page_all(lambda: sb.table("reativacao_kanban").select(
        "id,coluna,tarefa,valor,atualizado_em,criado_em")
        .neq("coluna", "descartado").neq("coluna", "reativado").order("id"), max_rows=10000)

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
    resto = max(0, lote - len(atrasadas) - len(followups))
    novas = pega(lambda c: c["coluna"] == "a_reativar" and not t(c).get("data"),
                 chave_ord=lambda c: -(float(c.get("valor") or 0)), limite=resto)

    grupos = [(atrasadas, "⏰ Atrasada — prioridade máxima"),
              (followups, "🔁 Follow-up (sem resposta)"),
              (novas, "📞 Reativar (fila de hoje)")]
    for lista, titulo in grupos:
        for c in lista:
            try:
                sb.table("reativacao_kanban").update(
                    {"tarefa": {"data": hoje, "titulo": titulo, "auto": True, "tipo_fila": "fila"},
                     "atualizado_por": "cadencia"}).eq("id", c["id"]).execute()
            except Exception:
                pass
    res = {"data": hoje, "total": len(usados), "atrasadas": len(atrasadas),
           "followups": len(followups), "novas": len(novas)}
    _kv_set(sb, CADENCIA_KEY, {"data": hoje, "res": res})
    if res["total"]:
        try:
            ids = _responsavel_ids(sb, cad.get("responsavel_match") or "leire")
            if ids:
                corpo = (f"{res['total']} contato(s) na sua fila de reativação: "
                         f"⏰ {res['atrasadas']} atrasada(s) · 🔁 {res['followups']} follow-up(s) · "
                         f"📞 {res['novas']} nova(s) (maiores valores primeiro). Trabalhe de cima pra baixo.")
                notify_all(ids, tipo="fiscalizacao", title="🔁 Sua fila de Reativação MAP de hoje",
                           body=corpo[:300], link="#/reativacao")
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
            rows = _page_all(lambda: sb.table("reativacao_kanban").select(
                "id,deal_id,nome,contato,corretor_email,valor,estagio,parado_desde,coluna,"
                "etiquetas,obs,descarte_motivo,tarefa,abordado_em,reativado_em,criado_em,atualizado_em")
                .order("atualizado_em", desc=True).order("id"), max_rows=10000)
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        usuarios = []
        try:
            usuarios = sb.table("users").select("id,name,email").limit(200).execute().data or []
        except Exception:
            pass
        return self._send(200, {"ok": True, "cards": rows, "cfg": _cfg(sb),
                                "fluxos": _fluxos_load(sb),
                                "users": [{"id": u.get("id"), "name": u.get("name"),
                                           "email": (u.get("email") or "").lower()} for u in usuarios],
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
        uid = str(user.get("id"))

        def card(cid):
            rows = sb.table("reativacao_kanban").select("*").eq("id", str(cid)).limit(1).execute().data or []
            return rows[0] if rows else None

        try:
            if action == "sincronizar":
                res = _sincronizar(sb, user)
                audit(self, user, "rk.sincronizar", "reativacao_kanban", None, notes=str(res)[:180])
                return self._send(200, {"ok": True, **res})

            if action == "gerar_fila":
                r = gerar_fila(sb, force=bool(body.get("force")))
                audit(self, user, "rk.gerar_fila", "reativacao_kanban", None, notes=str(r)[:180])
                return self._send(200, r)

            if action == "mover":
                c = card(body.get("id"))
                col = (body.get("coluna") or "").strip()
                if not c or not col:
                    return self._send(400, {"ok": False, "error": "id e coluna obrigatórios"})
                cfg_k = _cfg(sb)
                cols = {x["id"] for x in cfg_k.get("colunas") or []}
                if col not in cols:
                    return self._send(400, {"ok": False, "error": "coluna não existe"})
                upd = {"coluna": col, "atualizado_em": _now(), "atualizado_por": uid}
                if col == "descartado":
                    upd["descarte_motivo"] = str(body.get("motivo") or "").strip()[:200] or None
                elif c.get("coluna") == "descartado":
                    upd["descarte_motivo"] = None
                if col != "descartado" and c.get("coluna") == "a_reativar" and not c.get("abordado_em"):
                    upd["abordado_em"] = _now()
                    try:  # meta de 40/dia da Leire na Fiscalização anda sozinha
                        sb.table("producao_eventos").insert({
                            "colaborador": "leire", "tipo": "reativacao_tocada",
                            "ref_type": "reativacao_kanban", "ref_id": str(c["id"]),
                            "meta": {"rotulo": (c.get("nome") or "")[:80]},
                            "criado_por": uid}).execute()
                    except Exception:
                        pass
                if col == "respondeu" and c.get("coluna") != "respondeu":
                    try:  # sócio assume o fechamento
                        val = f" · negócio R$ {float(c.get('valor') or 0):,.2f}" if c.get("valor") else ""
                        notify_all(gestores_ids(sb), "fiscalizacao", "🔥 Lead da Reativação MAP respondeu!",
                                   body=f"{c.get('nome')} quer conversar{val}. Assumir o fechamento.",
                                   link="#/reativacao")
                    except Exception:
                        pass
                if col == "reativado" and not c.get("reativado_em"):
                    upd["reativado_em"] = _now()
                nova_t = None if col == "descartado" else _tarefa_followup(sb, cfg_k, c, col, uid)
                if nova_t or (c.get("tarefa") or {}).get("auto"):
                    upd["tarefa"] = nova_t
                sb.table("reativacao_kanban").update(upd).eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True, "followup": (nova_t or {}).get("data")})

            if action == "sugerir_msg":
                c = card(body.get("id"))
                if not c:
                    return self._send(404, {"ok": False, "error": "card não encontrado"})
                dias_parado = ""
                try:
                    dt = datetime.fromisoformat(str(c.get("parado_desde")).replace("Z", "+00:00"))
                    dias_parado = f"parado há ~{(datetime.now(timezone.utc) - dt).days} dias"
                except Exception:
                    pass
                estado = {
                    "a_reativar": "AINDA NÃO FOI REABORDADO — objetivo: reabrir a conversa com naturalidade, citando que ele já procurou imóvel com a PSM; NÃO venda nada na 1ª mensagem",
                    "abordado": "já recebeu a reabertura e não respondeu — objetivo: follow-up leve, uma pergunta só, dando saída fácil",
                    "respondeu": "respondeu e está morno/quente — objetivo: requalificar o momento (região, faixa, entrada) e propor conectar com o especialista",
                }.get(c.get("coluna") or "", "objetivo: avançar a reativação")
                prompt = (f"Você é a Leire, da secretaria de vendas da imobiliária PSM (São José do Rio Preto). "
                          f"Escreva UMA mensagem de WhatsApp pra {c.get('nome')}.\n"
                          f"Contexto: lead do funil MAP (loteamentos/imóveis prontos) que buscou imóvel e parou de responder, {dias_parado}."
                          + (f" Última etapa no CRM: {c.get('estagio')}." if c.get("estagio") else "")
                          + (f" Valor do negócio em aberto: R$ {float(c.get('valor') or 0):,.2f}." if c.get("valor") else "") + "\n"
                          f"Situação: {estado}.\n"
                          + (f"Anotações da equipe: {c.get('obs')}\n" if c.get("obs") else "")
                          + REGRAS_WHATSAPP)
                txt, prov = ia(prompt)
                if not txt:
                    return self._send(503, {"ok": False, "error": "IA indisponível agora — use os fluxos prontos"})
                return self._send(200, {"ok": True, "msg": txt[:1200], "provedor": prov})

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
                    else:
                        upd[k] = (str(v).strip()[:2000] or None) if v is not None else None
                if not upd:
                    return self._send(400, {"ok": False, "error": "nada pra salvar"})
                upd.update({"atualizado_em": _now(), "atualizado_por": uid})
                sb.table("reativacao_kanban").update(upd).eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True})

            if action == "novo":
                nome = str(body.get("nome") or "").strip()
                if not nome:
                    return self._send(400, {"ok": False, "error": "nome obrigatório"})
                ins = {"nome": nome[:160], "contato": (str(body.get("contato") or "").strip()[:40] or None),
                       "coluna": "a_reativar", "atualizado_por": uid}
                r = sb.table("reativacao_kanban").insert(ins).execute().data or []
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
                titulo = (str(body.get("titulo") or "").strip()[:140] or f"Reativação — {c.get('nome')}")
                ev = {"id": "evrk_" + uuid.uuid4().hex[:10], "tipo": "tarefa",
                      "titulo": titulo, "data": data, "hora_inicio": hi, "hora_fim": hf,
                      "all_day": not hi, "participantes": [uid],
                      "descricao": f"Reativação MAP · {c.get('nome')} ({c.get('contato') or 'sem fone'})",
                      "status": "agendado"}
                antigo = (c.get("tarefa") or {}).get("evento_id")
                if antigo:
                    try:
                        sb.table("eventos").delete().eq("id", antigo).execute()
                    except Exception:
                        pass
                sb.table("eventos").insert(ev).execute()
                tarefa = {"data": data, "hora_ini": hi, "hora_fim": hf, "titulo": titulo, "evento_id": ev["id"]}
                sb.table("reativacao_kanban").update({"tarefa": tarefa, "atualizado_em": _now()}) \
                    .eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True, "tarefa": tarefa})

            if action == "set_fluxos":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "editar fluxos é da gestão (lvl>=7)"})
                out = []
                for f in (body.get("fluxos") or [])[:20]:
                    if not isinstance(f, dict):
                        continue
                    passos = []
                    for p in (f.get("passos") or [])[:15]:
                        if not isinstance(p, dict) or not str(p.get("texto") or "").strip():
                            continue
                        passos.append({"titulo": str(p.get("titulo") or "").strip()[:120],
                                       "envio": str(p.get("envio") or "").strip()[:120],
                                       "texto": str(p.get("texto")).strip()[:1500]})
                    nome = str(f.get("nome") or "").strip()
                    if not nome or not passos:
                        continue
                    out.append({"id": (str(f.get("id") or "").strip() or "fx_" + uuid.uuid4().hex[:8]),
                                "emoji": (str(f.get("emoji") or "💬").strip()[:8] or "💬"),
                                "nome": nome[:80],
                                "quando_usar": str(f.get("quando_usar") or "").strip()[:300],
                                "passos": passos})
                if not out:
                    return self._send(400, {"ok": False, "error": "nenhum fluxo válido"})
                _kv_set(sb, FLUXOS_KEY, {"fluxos": out})
                audit(self, user, "rk.set_fluxos", "shared_kv", FLUXOS_KEY, notes=f"{len(out)} fluxo(s)")
                return self._send(200, {"ok": True, "fluxos": out})

            if action == "set_cfg":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "editar o quadro é da gestão (lvl>=7)"})
                cols, tags = [], []
                for x in (body.get("colunas") or [])[:12]:
                    if not isinstance(x, dict) or not str(x.get("nome") or "").strip():
                        continue
                    try:
                        fup = max(0, min(60, int(x.get("followup_dias") or 0)))
                    except (TypeError, ValueError):
                        fup = 0
                    cols.append({"id": (str(x.get("id") or "").strip() or "col_" + uuid.uuid4().hex[:6]),
                                 "nome": str(x["nome"]).strip()[:40],
                                 "emoji": (str(x.get("emoji") or "📌").strip()[:8] or "📌"),
                                 "cor": (str(x.get("cor") or "#64748b").strip()[:16]),
                                 "followup_dias": fup})
                ids = [c["id"] for c in cols]
                if not all(f in ids for f in COLS_FIXAS):
                    return self._send(400, {"ok": False, "error": "colunas estruturais não podem sair: " + ", ".join(COLS_FIXAS)})
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
                    for k, lim in (("lote_dia", 500), ("followup_dias", 30), ("parado_dias", 365)):
                        if bc.get(k) is not None:
                            try:
                                cad[k] = max(1, min(lim, int(bc[k])))
                            except (TypeError, ValueError):
                                pass
                cfg = {"colunas": cols, "etiquetas": tags, "cadencia": cad}
                _kv_set(sb, CFG_KEY, cfg)
                audit(self, user, "rk.set_cfg", "shared_kv", CFG_KEY, notes=f"{len(cols)} col / {len(tags)} tags")
                return self._send(200, {"ok": True, "cfg": cfg})

            if action == "excluir":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "excluir card é da gestão (use o descarte)"})
                cid = str(body.get("id") or "")
                sb.table("reativacao_kanban").delete().eq("id", cid).execute()
                audit(self, user, "rk.excluir", "reativacao_kanban", cid)
                return self._send(200, {"ok": True})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
