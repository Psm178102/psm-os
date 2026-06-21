"""
GET /api/v3/tasks/feed — CENTRAL do usuário: tudo que é "dele" pra fazer/acompanhar,
independente da aba que criou. Agrega, pro usuário logado: v77.69
  • dir_tasks   (tarefas manuais)            → kind 'tarefa'
  • eventos     (Agenda; inclui Academy/Projetos espelhados via evp_) → 'evento'/'academy'/'projeto'
  • captacoes   (responsável, não concluídas) → 'captacao'
  • one_on_ones (próximo 1:1 / ações)         → 'oneonone'
  • plantoes    (escalas futuras)             → 'plantao'

Cada fonte é best-effort (try/except → []), então uma tabela ausente nunca quebra o feed.
Resposta: { ok, items:[{kind,id,titulo,sub,data,status,prioridade,origem,ico,link,done}], counts }.
lvl>=0 (cada um vê o seu).
"""
from http.server import BaseHTTPRequestHandler
import os, sys, json
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

TAREFA_DONE = ("concluida", "cancelada")
EVENTO_DONE = ("realizado", "concluido", "concluida", "cancelado", "cancelada")
PLANTAO_DONE = ("concluido", "realizado", "cancelado")
CAPT_DONE = ("concluido", "concluida", "arquivado", "arquivada", "perdido", "perdida", "publicada")


def _today_brt():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


def _d(s):
    return str(s)[:10] if s else None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        uid = user.get("id")
        uname = (user.get("name") or "").strip().lower()
        uemail = (user.get("email") or "").strip().lower()
        items = []
        prod = {"solicitadas": 0, "concluidas": 0, "pendentes": 0, "atrasadas": 0, "pct": None}
        hoje_iso = _today_brt().isoformat()

        # mapa id->nome (pra resolver QUEM)
        umap = {}
        try:
            for u in (sb.table("users").select("id,name").execute().data or []):
                umap[u.get("id")] = u.get("name")
        except Exception:
            pass

        # 1) dir_tasks (minhas) + cálculo de PRODUTIVIDADE (tarefas atribuídas a mim)
        try:
            rows = (sb.table("dir_tasks").select("*")
                    .or_(f"responsavel.eq.{uid},criado_por.eq.{uid}")
                    .order("updated_at", desc=True).limit(500).execute().data or [])
            for t in rows:
                st = (t.get("status") or "aberta")
                items.append({"kind": "tarefa", "id": t.get("id"), "titulo": t.get("titulo") or "(sem título)",
                              "sub": t.get("descricao"), "data": _d(t.get("prazo")), "status": st,
                              "prioridade": t.get("prioridade"), "origem": "Tarefa", "ico": "📋",
                              "link": "#/tarefas", "done": st in TAREFA_DONE,
                              "quem": umap.get(t.get("responsavel")) or (user.get("name") if t.get("responsavel") == uid else "—")})
            # produtividade = concluídas ÷ solicitadas (tarefas atribuídas a mim; canceladas fora)
            mine = [t for t in rows if t.get("responsavel") == uid and (t.get("status") or "") != "cancelada"]
            sol = len(mine)
            conc = sum(1 for t in mine if (t.get("status") or "") == "concluida")
            pend = sum(1 for t in mine if (t.get("status") or "") not in TAREFA_DONE)
            atr = sum(1 for t in mine if t.get("prazo") and _d(t.get("prazo")) < hoje_iso and (t.get("status") or "") not in TAREFA_DONE)
            prod = {"solicitadas": sol, "concluidas": conc, "pendentes": pend, "atrasadas": atr,
                    "pct": round(conc / sol * 100, 2) if sol else None}
        except Exception as e:
            print(f"[feed] dir_tasks: {e}")

        # 2) eventos (Agenda + Academy/Projetos espelhados) — janela -30..+180
        try:
            since = (_today_brt() - timedelta(days=30)).isoformat()
            until = (_today_brt() + timedelta(days=180)).isoformat()
            evs = (sb.table("eventos").select("*").gte("data", since).lte("data", until)
                   .order("data").limit(900).execute().data or [])
            for e in evs:
                parts = e.get("participantes") or []
                if not (e.get("corretor_id") == uid or e.get("criado_por") == uid or (isinstance(parts, list) and uid in parts)):
                    continue
                eid = str(e.get("id") or "")
                desc = (e.get("descricao") or "")
                kind, origem, ico, link = "evento", "Agenda", "📅", "#/agenda"
                if eid.startswith("evp_"):
                    if desc.startswith("Gravação Academy"):
                        kind, origem, ico, link = "academy", "Academy", "🎬", "#/academy-studio"
                    elif desc.startswith("Projeto"):
                        kind, origem, ico, link = "projeto", "Projeto", "📌", "#/projetos"
                st = (e.get("status") or "agendado")
                items.append({"kind": kind, "id": eid, "titulo": e.get("titulo") or "(evento)",
                              "sub": desc or e.get("local"), "data": _d(e.get("data")), "status": st,
                              "prioridade": None, "origem": origem, "ico": ico, "link": link,
                              "done": st in EVENTO_DONE,
                              "quem": umap.get(e.get("corretor_id")) or umap.get(e.get("criado_por")) or "—"})
        except Exception as e:
            print(f"[feed] eventos: {e}")

        # 3) captacoes (minhas, não concluídas)
        try:
            caps = (sb.table("captacoes").select("*").order("updated_at", desc=True).limit(1000).execute().data or [])
            for c in caps:
                mine = (c.get("responsavel_id") == uid) or (uname and (c.get("responsavel") or "").strip().lower() == uname)
                if not mine:
                    continue
                st = (c.get("status") or "")
                if st.lower() in CAPT_DONE:
                    continue
                titulo = c.get("condominio") or c.get("endereco") or "Captação"
                items.append({"kind": "captacao", "id": c.get("id"), "titulo": titulo,
                              "sub": c.get("proprietario"), "data": _d(c.get("stage_changed_at") or c.get("updated_at")),
                              "status": st or "em andamento", "prioridade": None, "origem": "Captação",
                              "ico": "📥", "link": "#/captacoes", "done": False,
                              "quem": c.get("responsavel") or umap.get(c.get("responsavel_id")) or user.get("name")})
        except Exception as e:
            print(f"[feed] captacoes: {e}")

        # 4) one_on_ones (próximo 1:1 pendente)
        try:
            hoje = _today_brt().isoformat()
            oos = (sb.table("one_on_ones").select("*")
                   .or_(f"corretor_id.eq.{uid},lider_id.eq.{uid}")
                   .order("data", desc=True).limit(300).execute().data or [])
            for o in oos:
                prox = _d(o.get("proxima_data"))
                if not prox or prox < hoje:   # só os com retorno marcado pra hoje/futuro
                    continue
                items.append({"kind": "oneonone", "id": o.get("id"), "titulo": "Próximo One-on-One",
                              "sub": (o.get("acoes") or "")[:120] or None, "data": prox, "status": "agendado",
                              "prioridade": None, "origem": "One-on-One", "ico": "👥",
                              "link": "#/one-on-one", "done": False,
                              "quem": umap.get(o.get("corretor_id")) or user.get("name")})
        except Exception as e:
            print(f"[feed] one_on_ones: {e}")

        # 5) plantoes (minhas escalas de hoje em diante)
        try:
            ontem = (_today_brt() - timedelta(days=1)).isoformat()
            pls = (sb.table("plantoes").select("*").eq("corretor_id", uid)
                   .gte("data", ontem).order("data").limit(200).execute().data or [])
            for p in pls:
                st = (p.get("status") or "agendado")
                per = p.get("periodo")
                items.append({"kind": "plantao", "id": p.get("id"),
                              "titulo": "Plantão" + (f" · {per}" if per else ""),
                              "sub": p.get("observacoes"), "data": _d(p.get("data")), "status": st,
                              "prioridade": None, "origem": "Plantão", "ico": "🛡",
                              "link": "#/plantoes", "done": st in PLANTAO_DONE,
                              "quem": user.get("name")})
        except Exception as e:
            print(f"[feed] plantoes: {e}")

        # 6) paulo_cards — CRIATIVOS + CONTEÚDO atribuídos a mim (briefings/posts pra fazer)
        #    (academy/projetos já entram via 'eventos'; aqui entram os boards de marketing).
        #    Match do responsável por E-MAIL (criativos) OU NOME (conteúdo), case-insensitive.
        CARD_BOARDS = {
            "criativos":          ("Criativo", "🎨", "#/criativos"),
            "conteudo":           ("Conteúdo", "🎬", "#/paulo-conteudo"),
            "conteudo_imoveis":   ("Conteúdo", "🎬", "#/conteudo-imoveis"),
            "conteudo_conquista": ("Conteúdo", "🎬", "#/conteudo-conquista"),
        }
        CARD_DONE = ("publicado", "publicada", "aprovado", "concluido", "concluida", "entregue")
        CARD_CANCEL = ("cancelado", "cancelada", "arquivado", "arquivada")
        try:
            cards = (sb.table("paulo_cards").select("*").in_("board", list(CARD_BOARDS.keys()))
                     .order("updated_at", desc=True).limit(800).execute().data or [])
            csol = cconc = cpend = catr = 0
            for c in cards:
                resp = (c.get("responsavel") or "").strip().lower()
                if not resp or (resp != uemail and resp != uname):
                    continue
                meta = CARD_BOARDS.get(c.get("board"))
                if not meta:
                    continue
                origem, ico, link = meta
                st = (c.get("status") or "").lower()
                d = _d(c.get("data_ref"))
                done = st in CARD_DONE
                items.append({"kind": ("criativo" if c.get("board") == "criativos" else "conteudo"),
                              "id": c.get("id"), "titulo": c.get("titulo") or "(sem título)",
                              "sub": c.get("formato") or c.get("plataforma"), "data": d,
                              "status": st or "solicitado", "prioridade": None, "origem": origem,
                              "ico": ico, "link": link, "done": done,
                              "quem": c.get("responsavel") or user.get("name")})
                # produtividade: cada card é uma "solicitação" minha (canceladas/arquivadas fora)
                if st not in CARD_CANCEL:
                    csol += 1
                    if done:
                        cconc += 1
                    else:
                        cpend += 1
                        if d and d < hoje_iso:
                            catr += 1
            # funde os cards na produtividade (relevante p/ marketing, cujo trabalho é criativo/conteúdo)
            if csol:
                prod["solicitadas"] += csol
                prod["concluidas"] += cconc
                prod["pendentes"] += cpend
                prod["atrasadas"] += catr
                prod["pct"] = round(prod["concluidas"] / prod["solicitadas"] * 100, 2) if prod["solicitadas"] else None
        except Exception as e:
            print(f"[feed] cards: {e}")

        # counts
        hoje = _today_brt().isoformat()
        sem = (_today_brt() + timedelta(days=7)).isoformat()
        pend = [i for i in items if not i.get("done")]
        counts = {
            "total": len(items),
            "pendentes": len(pend),
            "atrasados": sum(1 for i in pend if i.get("data") and i["data"] < hoje),
            "hoje": sum(1 for i in pend if i.get("data") == hoje),
            "semana": sum(1 for i in pend if i.get("data") and hoje < i["data"] <= sem),
            "por_origem": {},
        }
        for i in items:
            counts["por_origem"][i["origem"]] = counts["por_origem"].get(i["origem"], 0) + 1

        return self._send(200, {"ok": True, "items": items, "counts": counts, "prod": prod,
                                "role": (user.get("role") or "corretor"), "lvl": user.get("lvl"),
                                "fetched_at": datetime.now(timezone.utc).isoformat()})
