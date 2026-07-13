"""
GET/POST /api/v3/producao/avaliacoes — AVALIAÇÕES & FEEDBACKS (Mariane). v84.29

Kanban de coleta de NPS pós-visita, alimentado SOZINHO pelo RD CRM: todo deal
que passou pela etapa de VISITA REALIZADA nos funis MAP, Conquista, Terceiros
e Locação (deal_stage_events, janela configurável — default 60 dias) vira card
na coluna "Origens", com a origem = frente do funil.

Colunas (ids estruturais, nomes editáveis):
  📥 origens → 💬 abordagem → ⭐ nota_feedback → 🔴 nota_baixa /
  ✅ ciclo_realizado / 🗑 descarte

Regras da NOTA (0–10, action=nota):
  ≥ 9  → ciclo_realizado + cria card 🌟 nps_promotor no Kanban da Indicação
         Premiada (ou re-prioriza o existente) — promotor entra na fila quente
  ≤ 6  → nota_baixa + notifica a gestão NA HORA (detrator)
  7–8  → fica em nota_feedback (neutro; Mariane decide o próximo passo)
  Toda nota loga producao_eventos 'nps_coletado' — as métricas de NPS da
  Mariane no Painel de Fiscalização andam sozinhas.

Menções: qualquer card pode mencionar gerente/corretor/sócios (user_ids) →
sino+push pros mencionados verem a situação.

Fluxos de mensagem POR ORIGEM (editáveis, shared_kv 'avaliacoes_fluxos').
Auth: lvl>=2; set_cfg/set_fluxos/excluir lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of, notify_all  # type: ignore
from _fisc_lib import _kv, _kv_set, gestores_ids  # type: ignore

CFG_KEY = "avaliacoes_cfg"
FLUXOS_KEY = "avaliacoes_fluxos"
FRENTES_AV = ("map", "conquista", "terceiros", "locacoes")
COLS_FIXAS = ("origens", "descarte", "nota_baixa", "ciclo_realizado")
CAMPOS_EDIT = ("nome", "contato", "obs", "etiquetas")

DEFAULT_CFG = {
    "colunas": [
        {"id": "origens", "nome": "Origens", "emoji": "📥", "cor": "#64748b"},
        {"id": "abordagem", "nome": "Abordagem", "emoji": "💬", "cor": "#2563eb"},
        {"id": "nota_feedback", "nome": "Nota + Feedback", "emoji": "⭐", "cor": "#d97706"},
        {"id": "nota_baixa", "nome": "Nota baixa", "emoji": "🔴", "cor": "#dc2626"},
        {"id": "ciclo_realizado", "nome": "Ciclo realizado", "emoji": "✅", "cor": "#16a34a"},
        {"id": "descarte", "nome": "Descarte", "emoji": "🗑", "cor": "#94a3b8"},
    ],
    "etiquetas": [
        {"id": "urgente", "nome": "Urgente", "cor": "#dc2626"},
        {"id": "vip", "nome": "VIP", "cor": "#7c3aed"},
        {"id": "recontatar", "nome": "Recontatar", "cor": "#0891b2"},
        {"id": "resolvido", "nome": "Resolvido", "cor": "#16a34a"},
    ],
    "janela_dias": 60,
    "promotor_min": 9,
    "detrator_max": 6,
}

DEFAULT_FLUXOS = [
    {"id": "map", "emoji": "🏘", "nome": "MAP (loteamentos / prontos)",
     "quando_usar": "Visitou imóvel/loteamento MAP. Coletar até 48h após a visita — quanto mais fresco, mais sincero.",
     "passos": [
         {"titulo": "Coleta da nota", "envio": "até 48h após a visita",
          "texto": "Oi {nome}! Aqui é a Mariane, da PSM 😊 Obrigada pela visita! Me ajuda numa coisa rapidinha: de 0 a 10, quanto você recomendaria a PSM pra um amigo?"},
         {"titulo": "Nota 9–10 — agradecer + semear indicação", "envio": "logo após a nota",
          "texto": "Uau, obrigada! 🥰 Isso significa muito pra gente. E já que você curtiu: conhece alguém procurando terreno ou casa? Sua indicação vale prêmio em dinheiro aqui na PSM 💰"},
         {"titulo": "Nota 7–8 — entender o que faltou", "envio": "logo após a nota",
          "texto": "Obrigada pela nota! Me conta: o que faltou pra ser um 10? Quero melhorar isso pra você 🙏"},
         {"titulo": "Nota 0–6 — resolver e escalar JÁ", "envio": "na hora, prioridade máxima",
          "texto": "Poxa, sinto muito 🙏 Me conta o que aconteceu? Vou levar isso pro gerente AGORA e a gente te retorna ainda hoje."},
     ]},
    {"id": "conquista", "emoji": "🚀", "nome": "Conquista (1º imóvel / MCMV)",
     "quando_usar": "Visitou pela Equipe Conquista — normalmente 1ª compra, cliente mais ansioso. Tom acolhedor.",
     "passos": [
         {"titulo": "Coleta da nota", "envio": "até 48h após a visita",
          "texto": "Oi {nome}! Mariane da PSM aqui 😊 Que legal sua visita — realizar o 1º imóvel é demais! De 0 a 10, como foi a experiência com o nosso time?"},
         {"titulo": "Nota 9–10 — agradecer + semear indicação", "envio": "logo após a nota",
          "texto": "Que alegria! 🥰 Obrigada de verdade. E se algum amigo ou parente também sonha com a casa própria, me apresenta: sua indicação vale prêmio em dinheiro 💰"},
         {"titulo": "Nota 7–8 — entender o que faltou", "envio": "logo após a nota",
          "texto": "Valeu pela sinceridade! O que a gente pode fazer melhor pra chegar no 10? Tô aqui pra isso 🙏"},
         {"titulo": "Nota 0–6 — resolver e escalar JÁ", "envio": "na hora, prioridade máxima",
          "texto": "Sinto muito por essa experiência 🙏 Me conta o que houve? Já vou acionar o gerente e te retornamos hoje."},
     ]},
    {"id": "terceiros", "emoji": "🤝", "nome": "Terceiros (imóveis de parceiros)",
     "quando_usar": "Visitou imóvel de terceiros. Atenção: a experiência pode ter envolvido corretor parceiro.",
     "passos": [
         {"titulo": "Coleta da nota", "envio": "até 48h após a visita",
          "texto": "Oi {nome}, tudo bem? Mariane da PSM 😊 Obrigada pela visita! De 0 a 10, como foi o atendimento e a visita pra você?"},
         {"titulo": "Nota 9–10 — agradecer + semear indicação", "envio": "logo após a nota",
          "texto": "Obrigada! 🥰 Ficamos felizes demais. Conhece mais alguém procurando imóvel? Indicação sua vale prêmio em dinheiro aqui na PSM 💰"},
         {"titulo": "Nota 7–8 — entender o que faltou", "envio": "logo após a nota",
          "texto": "Obrigada pela nota! Me conta o que faltou pro 10 — atendimento, imóvel, agilidade? Quero acertar isso 🙏"},
         {"titulo": "Nota 0–6 — resolver e escalar JÁ", "envio": "na hora, prioridade máxima",
          "texto": "Poxa, me desculpa por isso 🙏 O que aconteceu? Vou tratar com o gerente agora e te dou retorno ainda hoje."},
     ]},
    {"id": "locacoes", "emoji": "🔑", "nome": "Locação",
     "quando_usar": "Visitou imóvel pra alugar. Ciclo rápido — coletar no mesmo dia se der.",
     "passos": [
         {"titulo": "Coleta da nota", "envio": "no mesmo dia da visita",
          "texto": "Oi {nome}! Mariane da PSM 😊 Obrigada pela visita de hoje! De 0 a 10, como foi a experiência com a gente?"},
         {"titulo": "Nota 9–10 — agradecer + semear indicação", "envio": "logo após a nota",
          "texto": "Obrigada! 🥰 E olha: se souber de alguém querendo alugar (ou dono querendo colocar pra alugar), sua indicação fechando contrato vale prêmio em dinheiro 💰"},
         {"titulo": "Nota 7–8 — entender o que faltou", "envio": "logo após a nota",
          "texto": "Valeu pela nota! O que faltou pro 10? Se for algo do imóvel ou do processo, me fala que eu corro atrás 🙏"},
         {"titulo": "Nota 0–6 — resolver e escalar JÁ", "envio": "na hora, prioridade máxima",
          "texto": "Sinto muito 🙏 Me conta o que houve? Vou levar pro gerente agora — locação tem que ser rápida e redonda."},
     ]},
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _cfg(sb):
    v = _kv(sb, CFG_KEY)
    if isinstance(v, dict) and v.get("colunas"):
        return {**DEFAULT_CFG, **v}
    _kv_set(sb, CFG_KEY, DEFAULT_CFG)
    return json.loads(json.dumps(DEFAULT_CFG))


def _fluxos_load(sb):
    v = _kv(sb, FLUXOS_KEY)
    fx = v.get("fluxos") if isinstance(v, dict) else None
    if fx:
        return fx
    _kv_set(sb, FLUXOS_KEY, {"fluxos": DEFAULT_FLUXOS})
    return json.loads(json.dumps(DEFAULT_FLUXOS))


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


def _page_all(make_q, max_rows=6000):
    out, page = [], 1000
    for i in range(0, max_rows, page):
        rows = make_q().range(i, i + page - 1).execute().data or []
        out.extend(rows)
        if len(rows) < page:
            break
    return out


def _sincronizar_av(sb, user):
    """Visitas realizadas (janela_dias) nos 4 funis → cards em 'origens'."""
    cfg = _cfg(sb)
    dias = max(7, min(365, int(cfg.get("janela_dias") or 60)))
    corte = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
    try:
        ja_rows = _page_all(lambda: sb.table("avaliacoes_kanban").select("deal_id")
                            .not_.is_("deal_id", "null").order("criado_em").order("id"), max_rows=20000)
        ja = {str(r["deal_id"]) for r in ja_rows if r.get("deal_id")}
    except Exception:
        ja = set()
    evs = _page_all(lambda: sb.table("deal_stage_events").select("deal_id,pipeline_name,occurred_at")
                    .ilike("stage_name", "%visita%").gte("occurred_at", corte)
                    .order("occurred_at"), max_rows=6000)
    alvo = {}
    for e in evs:
        did = str(e.get("deal_id") or "")
        fr = frente_of(e.get("pipeline_name"))
        if not did or did in ja or fr not in FRENTES_AV:
            continue
        cur = alvo.get(did)
        if not cur or str(e.get("occurred_at") or "") > str(cur["visita_em"] or ""):
            alvo[did] = {"origem": fr, "visita_em": e.get("occurred_at")}
    novos, res = [], {f: 0 for f in FRENTES_AV}
    ids = list(alvo.keys())
    for i in range(0, len(ids), 150):
        try:
            dd = sb.table("deals").select("id,name,user_email,contacts:rd_raw->contacts") \
                .in_("id", ids[i:i + 150]).execute().data or []
        except Exception:
            continue
        for d in dd:
            did = str(d.get("id"))
            info = alvo.get(did) or {}
            nome = (d.get("name") or "").strip()
            if not nome:
                continue
            novos.append({"deal_id": did, "origem": info.get("origem") or "map",
                          "nome": nome[:160], "contato": _phone(d.get("contacts")),
                          "corretor_email": (d.get("user_email") or "").lower() or None,
                          "coluna": "origens", "visita_em": info.get("visita_em"),
                          "atualizado_por": str(user.get("id"))})
            res[info.get("origem") or "map"] += 1
    criadas = 0
    for i in range(0, len(novos), 500):
        lote = novos[i:i + 500]
        try:
            sb.table("avaliacoes_kanban").upsert(lote, on_conflict="deal_id",
                                                 ignore_duplicates=True).execute()
            criadas += len(lote)
        except Exception:
            for c in lote:
                try:
                    sb.table("avaliacoes_kanban").insert(c).execute()
                    criadas += 1
                except Exception:
                    pass
    return res, criadas


def _promotor_para_indicacao(sb, c, user):
    """Nota ≥9: entra (ou sobe) no Kanban da Indicação Premiada como nps_promotor."""
    try:
        did = c.get("deal_id")
        if did:
            ex = sb.table("indicacao_kanban").select("id,coluna,abordado_em") \
                .eq("deal_id", str(did)).limit(1).execute().data or []
            if ex:
                if ex[0].get("coluna") == "a_abordar" and not ex[0].get("abordado_em"):
                    sb.table("indicacao_kanban").update({"base": "nps_promotor"}) \
                        .eq("id", ex[0]["id"]).execute()
                return "repriorizado"
        row = {"base": "nps_promotor", "nome": (c.get("nome") or "?")[:160],
               "contato": c.get("contato"), "coluna": "a_abordar",
               "atualizado_por": str(user.get("id"))}
        if did:
            row["deal_id"] = str(did)
        sb.table("indicacao_kanban").insert(row).execute()
        return "criado"
    except Exception:
        return None


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
            rows = _page_all(lambda: sb.table("avaliacoes_kanban").select(
                "id,deal_id,origem,nome,contato,corretor_email,coluna,nota,feedback,etiquetas,"
                "obs,mencoes,descarte_motivo,tarefa,indicacao_criada,visita_em,abordado_em,"
                "criado_em,atualizado_em")
                .order("atualizado_em", desc=True).order("id"), max_rows=10000)
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        usuarios = []
        try:
            usuarios = sb.table("users").select("id,name,role,email").eq("active", True) \
                .limit(200).execute().data or []
        except Exception:
            try:
                usuarios = sb.table("users").select("id,name,role,email").limit(200).execute().data or []
            except Exception:
                pass
        return self._send(200, {"ok": True, "cards": rows, "cfg": _cfg(sb),
                                "fluxos": _fluxos_load(sb),
                                "users": [{"id": u.get("id"), "name": u.get("name"),
                                           "role": u.get("role"), "email": (u.get("email") or "").lower()}
                                          for u in usuarios],
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
        cfg = _cfg(sb)

        def card(cid):
            rows = sb.table("avaliacoes_kanban").select("*").eq("id", str(cid)).limit(1).execute().data or []
            return rows[0] if rows else None

        try:
            if action == "sincronizar":
                res, criadas = _sincronizar_av(sb, user)
                audit(self, user, "av.sincronizar", "avaliacoes_kanban", None,
                      notes=f"criadas={criadas} {res}")
                return self._send(200, {"ok": True, "criadas": criadas, "por_origem": res})

            if action == "mover":
                c = card(body.get("id"))
                col = (body.get("coluna") or "").strip()
                if not c or not col:
                    return self._send(400, {"ok": False, "error": "id e coluna obrigatórios"})
                cols = {x["id"] for x in cfg.get("colunas") or []}
                if col not in cols:
                    return self._send(400, {"ok": False, "error": "coluna não existe"})
                upd = {"coluna": col, "atualizado_em": _now(), "atualizado_por": str(user.get("id"))}
                if col == "descarte":
                    upd["descarte_motivo"] = str(body.get("motivo") or "").strip()[:200] or None
                elif c.get("coluna") == "descarte":
                    upd["descarte_motivo"] = None
                if col not in ("descarte", "origens") and not c.get("abordado_em"):
                    upd["abordado_em"] = _now()
                sb.table("avaliacoes_kanban").update(upd).eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True})

            if action == "nota":
                c = card(body.get("id"))
                if not c:
                    return self._send(404, {"ok": False, "error": "card não encontrado"})
                try:
                    nota = float(body.get("nota"))
                except (TypeError, ValueError):
                    return self._send(400, {"ok": False, "error": "nota de 0 a 10 obrigatória"})
                if not 0 <= nota <= 10:
                    return self._send(400, {"ok": False, "error": "nota de 0 a 10"})
                fb = (str(body.get("feedback") or "").strip()[:2000] or None)
                pmin = int(cfg.get("promotor_min") or 9)
                dmax = int(cfg.get("detrator_max") or 6)
                destino = "ciclo_realizado" if nota >= pmin else ("nota_baixa" if nota <= dmax else "nota_feedback")
                upd = {"nota": nota, "feedback": fb, "coluna": destino,
                       "atualizado_em": _now(), "atualizado_por": str(user.get("id"))}
                if not c.get("abordado_em"):
                    upd["abordado_em"] = _now()
                resultado = {"coluna": destino}
                if nota >= pmin and not c.get("indicacao_criada"):
                    r = _promotor_para_indicacao(sb, c, user)
                    if r:
                        upd["indicacao_criada"] = True
                        resultado["indicacao"] = r
                sb.table("avaliacoes_kanban").update(upd).eq("id", str(c["id"])).execute()
                try:  # métricas da Mariane na Fiscalização andam sozinhas
                    sb.table("producao_eventos").insert({
                        "colaborador": "mariane", "tipo": "nps_coletado", "valor": nota,
                        "ref_type": "avaliacoes_kanban", "ref_id": str(c["id"]),
                        "meta": {"rotulo": (c.get("nome") or "")[:80], "origem": c.get("origem"),
                                 "feedback": (fb or "")[:200]},
                        "criado_por": str(user.get("id"))}).execute()
                except Exception:
                    pass
                if nota <= dmax:
                    try:
                        notify_all(gestores_ids(sb), "fiscalizacao", "🔴 NPS baixo — agir agora",
                                   body=f"{c.get('nome')} deu nota {int(nota)}"
                                        + (f': "{fb[:140]}"' if fb else "") + f" (origem {c.get('origem')})",
                                   link="#/cs-avaliacoes")
                        resultado["gestao_notificada"] = True
                    except Exception:
                        pass
                audit(self, user, "av.nota", "avaliacoes_kanban", str(c["id"]), notes=f"nota={nota}")
                return self._send(200, {"ok": True, **resultado})

            if action == "mencionar":
                c = card(body.get("id"))
                ids = [str(x) for x in (body.get("user_ids") or []) if x][:20]
                if not c or not ids:
                    return self._send(400, {"ok": False, "error": "id e user_ids obrigatórios"})
                nota_txt = f"nota {int(c['nota'])}" if c.get("nota") is not None else "sem nota ainda"
                try:
                    notify_all(ids, "fiscalizacao", "👀 Você foi mencionado numa avaliação",
                               body=f"{user.get('name')} mencionou você: {c.get('nome')} ({nota_txt})"
                                    + (f' — "{str(c.get("feedback"))[:120]}"' if c.get("feedback") else ""),
                               link="#/cs-avaliacoes", target_type="avaliacoes_kanban", target_id=str(c["id"]))
                except Exception as e:
                    return self._send(500, {"ok": False, "error": f"notificação: {e}"})
                mencoes = (c.get("mencoes") or []) + [{"user_ids": ids, "por": str(user.get("id")),
                                                       "nome_por": user.get("name"), "ts": _now()}]
                sb.table("avaliacoes_kanban").update({"mencoes": mencoes[-30:], "atualizado_em": _now()}) \
                    .eq("id", str(c["id"])).execute()
                audit(self, user, "av.mencionar", "avaliacoes_kanban", str(c["id"]), notes=",".join(ids))
                return self._send(200, {"ok": True, "notificados": len(ids)})

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
                upd.update({"atualizado_em": _now(), "atualizado_por": str(user.get("id"))})
                sb.table("avaliacoes_kanban").update(upd).eq("id", str(c["id"])).execute()
                return self._send(200, {"ok": True})

            if action == "novo":
                nome = str(body.get("nome") or "").strip()
                if not nome:
                    return self._send(400, {"ok": False, "error": "nome obrigatório"})
                ins = {"origem": "manual", "nome": nome[:160],
                       "contato": (str(body.get("contato") or "").strip()[:40] or None),
                       "coluna": "origens", "atualizado_por": str(user.get("id"))}
                r = sb.table("avaliacoes_kanban").insert(ins).execute().data or []
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
                titulo = (str(body.get("titulo") or "").strip()[:140] or f"Avaliação — {c.get('nome')}")
                ev = {"id": "evav_" + uuid.uuid4().hex[:10], "tipo": "tarefa",
                      "titulo": titulo, "data": data, "hora_inicio": hi, "hora_fim": hf,
                      "all_day": not hi, "participantes": [str(user.get("id"))],
                      "descricao": f"Avaliações & Feedbacks · {c.get('nome')} ({c.get('contato') or 'sem fone'})",
                      "status": "agendado"}
                antigo = (c.get("tarefa") or {}).get("evento_id")
                if antigo:
                    try:
                        sb.table("eventos").delete().eq("id", antigo).execute()
                    except Exception:
                        pass
                sb.table("eventos").insert(ev).execute()
                tarefa = {"data": data, "hora_ini": hi, "hora_fim": hf, "titulo": titulo, "evento_id": ev["id"]}
                sb.table("avaliacoes_kanban").update({"tarefa": tarefa, "atualizado_em": _now()}) \
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
                audit(self, user, "av.set_fluxos", "shared_kv", FLUXOS_KEY, notes=f"{len(out)} fluxo(s)")
                return self._send(200, {"ok": True, "fluxos": out})

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
                    return self._send(400, {"ok": False, "error": "colunas estruturais não podem sair: " + ", ".join(COLS_FIXAS)})
                for x in (body.get("etiquetas") or [])[:20]:
                    if not isinstance(x, dict) or not str(x.get("nome") or "").strip():
                        continue
                    tags.append({"id": (str(x.get("id") or "").strip() or "tag_" + uuid.uuid4().hex[:6]),
                                 "nome": str(x["nome"]).strip()[:30],
                                 "cor": (str(x.get("cor") or "#64748b").strip()[:16])})
                novo = {**cfg, "colunas": cols, "etiquetas": tags}
                try:
                    novo["janela_dias"] = max(7, min(365, int(body.get("janela_dias") or cfg.get("janela_dias") or 60)))
                except (TypeError, ValueError):
                    pass
                _kv_set(sb, CFG_KEY, novo)
                audit(self, user, "av.set_cfg", "shared_kv", CFG_KEY, notes=f"{len(cols)} col / {len(tags)} tags")
                return self._send(200, {"ok": True, "cfg": novo})

            if action == "excluir":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "excluir card é da gestão (use o descarte)"})
                cid = str(body.get("id") or "")
                sb.table("avaliacoes_kanban").delete().eq("id", cid).execute()
                audit(self, user, "av.excluir", "avaliacoes_kanban", cid)
                return self._send(200, {"ok": True})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
