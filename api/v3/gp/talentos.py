"""GET/POST/DELETE /api/v3/gp/talentos — Base de Talentos

GET:    list (lvl>=5)
POST:   upsert (lvl>=5)
DELETE: ?id=X (lvl>=5)
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, can_route  # type: ignore
import _talentos_rd_lib as RDT  # type: ignore   # v89.10: kanban ⇄ RD funil de Parceria

# v86.67: a alçada desta tela é decidida pela MATRIZ por papel (como no menu), não só por nível.
_GATE_ROUTES = ['/talentos', '/rh-recrutamento']
_GATE_GROUP = 'rh'


def _gate(handler, min_lvl=2):
    actor = require_user(handler, min_lvl=min_lvl)
    sb = supabase_client()
    if sb and not can_route(sb, actor, _GATE_ROUTES, _GATE_GROUP, default_lvl=min_lvl):
        raise AuthError(403, "sem permissão para esta área (matriz de permissões)")
    return actor



def _safe_upsert(sb, table, row):
    """Upsert tolerante: se uma coluna ainda não existe no banco (migração pendente
    → PGRST204), remove ela e tenta de novo. Os campos novos de classificação
    (responsavel/cargo/categoria/creci/experiencia/atividade_atual) só persistem
    depois de rodar o ALTER TABLE; antes disso não quebram o cadastro. v81.83"""
    r = dict(row)
    dropped = []
    for _ in range(15):
        try:
            return sb.table(table).upsert(r).execute(), dropped
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                dropped.append(m.group(1)); r.pop(m.group(1), None); continue
            raise
    return sb.table(table).upsert(r).execute(), dropped


def _safe_update(sb, table, tid, patch):
    """UPDATE tolerante (mesma lógica de coluna-ausente do _safe_upsert), mas
    SEM risco de INSERT: patcheia só a ficha existente por id. Nunca cria linha
    nova → não estoura o NOT NULL de 'nome'. Usar em avaliar/mover, que só tocam
    fichas que já existem. Devolve (nº de linhas afetadas, colunas dropadas). v84.41"""
    r = {k: v for k, v in patch.items() if k != "id"}
    dropped = []
    for _ in range(15):
        try:
            res = sb.table(table).update(r).eq("id", tid).execute()
            return len(res.data or []), dropped
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                dropped.append(m.group(1)); r.pop(m.group(1), None); continue
            raise
    res = sb.table(table).update(r).eq("id", tid).execute()
    return len(res.data or []), dropped


def _anexar_cnd(sb, rows):
    """Pendura em cada candidato o RESUMO do dossiê de CND interno dele
    (módulo CND's → categoria Interno). Assim a ficha e o kanban mostram
    "5/8 emitidas · 1 POSITIVA" sem ninguém redigitar nada — o dado vive num
    lugar só, o dossiê. Silencioso de propósito: se a tabela/coluna ainda não
    existe (migração pendente), o ATS abre igual. v86.56"""
    try:
        ds = sb.table("cnd_dossies").select("id,titulo,talento_id,certidoes,atualizado_em") \
            .eq("tipo_negocio", "interno").limit(1000).execute().data or []
    except Exception as e:
        print(f"[gp_talentos] cnd off: {e}")
        return
    por_tal = {str(d.get("talento_id")): d for d in ds if d.get("talento_id")}
    for t in rows:
        d = por_tal.get(str(t.get("id")))
        if not d:
            continue
        certs = d.get("certidoes") or []
        t["cnd_dossie"] = {
            "id": d.get("id"), "titulo": d.get("titulo"),
            "total": len(certs),
            "emitidas": sum(1 for c in certs if c.get("status") == "emitida"),
            "positivas": sum(1 for c in certs if c.get("resultado") == "positiva"),
            "pendencias": sum(1 for c in certs if c.get("status") in ("bloqueada", "nao_emitida")),
            "atualizado_em": d.get("atualizado_em"),
        }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: actor = _gate(self, 2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("gp_talentos").select("*").order("criado_em", desc=True).limit(3000).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        _anexar_cnd(sb, rows)
        return self._send(200, {"ok": True, "talentos": rows})

    def do_POST(self):
        try: actor = _gate(self, 2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        action = (body.get("action") or "").strip()
        if action == "avaliar":
            return self._avaliar(sb, actor, body)
        if action == "mover":
            return self._mover(sb, actor, body)
        if action == "rd_sync":
            return self._rd_sync(sb)
        if action == "meta_sync":   # v89.15: leads das campanhas de vagas (Meta) → Interessados
            import _talentos_meta_lib as TM  # type: ignore
            try:
                return self._send(200, TM.sincronizar(sb))
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:300]})

        # v89.10: ⭐ da aba "RD ao vivo" — se o negócio já tem ficha, devolve a ficha (sem duplicar)
        rd_id = str(body.get("rd_deal_id") or "").strip()
        if rd_id and not body.get("id"):
            try:
                ja = sb.table("gp_talentos").select("*").eq("rd_deal_id", rd_id).limit(1).execute().data or []
            except Exception:
                ja = []
            if ja:
                return self._send(200, {"ok": True, "row": ja[0], "existente": True})

        # v89.10: ficha ligada ao RD com etapa trocada pelo formulário → move no RD também
        rd_patch = {}
        if body.get("id") and (body.get("etapa") or "").strip():
            try:
                cur = sb.table("gp_talentos").select("etapa,rd_deal_id,rd_etapa").eq("id", body["id"]).limit(1).execute().data or []
            except Exception:
                cur = []
            if cur and cur[0].get("rd_deal_id") and cur[0].get("etapa") != body["etapa"].strip():
                nova_rd, err = RDT.empurrar_etapa(sb, os.environ.get("RD_API_TOKEN"), cur[0], body["etapa"].strip())
                if err:
                    return self._send(502, {"ok": False, "error": "O RD não aceitou a mudança de etapa: " + err})
                if nova_rd:
                    rd_patch = {"rd_etapa": nova_rd}

        nome = (body.get("nome") or "").strip()
        if not nome: return self._send(400, {"ok": False, "error": "nome obrigatório"})

        def _s(k, n=4000):
            v = (body.get(k) or "").strip()
            return v[:n] or None
        def _i(k):
            try: return int(body.get(k)) or None
            except: return None
        row = {
            "id": body.get("id") or f"gpt_{int(datetime.now().timestamp()*1000)}",
            "nome": nome,
            "email": _s("email"),
            "contato": _s("contato"),
            "instagram": _s("instagram", 200),
            "data": body.get("data") or None,
            "setor": _s("setor", 60),
            "funcao": _s("funcao", 120),
            "cenario": _s("cenario"),
            "status": _s("status", 60),
            # classificação rica (v81.83)
            "responsavel": _s("responsavel", 120),
            "cargo": _s("cargo", 80),
            "categoria": _s("categoria", 120),   # corretor: pode ser MÚLTIPLA "MAP, Locação" (v81.98)
            "creci": _s("creci", 40),
            "experiencia": _s("experiencia"),
            "atividade_atual": _s("atividade_atual", 60),
            "local_atividade": _s("local_atividade", 120),   # onde exerce hoje (ex.: Imob. São José) (v81.98)
            "origem": _s("origem", 20) or "manual",
            # ── ATS completo (v81.87) — colunas novas (upsert tolerante até a migração) ──
            "etapa": _s("etapa", 60),
            "canal": _s("canal", 60),                         # origem de recrutamento
            "departamento_solicitante": _s("departamento_solicitante", 80),
            "vaga": _s("vaga", 120),
            "linkedin": _s("linkedin", 300),
            "curriculo_url": _s("curriculo_url", 600),
            "requisitos": _s("requisitos"),
            "perfil_comportamental": _s("perfil_comportamental"),
            "feedback_entrevista": _s("feedback_entrevista"),
            "impeditivos": _s("impeditivos"),
            "cpf": _s("cpf", 30),
            "referencias": _s("referencias"),
            "cnd": _s("cnd"),                                 # situação das CNDs
            "processos": _s("processos"),
            "antecedentes": _s("antecedentes"),
            "analise_juridica": _s("analise_juridica"),
            "analise_comercial": _s("analise_comercial"),
            "pretensao": _s("pretensao", 80),
            "disponibilidade": _s("disponibilidade", 120),
            "score": _i("score"),
            "decisao": _s("decisao", 30),
            "motivo_reprovacao": _s("motivo_reprovacao"),
            "criado_por": actor.get("id"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        row.update(rd_patch)
        if rd_id and not body.get("id"):
            row["rd_deal_id"] = rd_id
        try:
            r, dropped = _safe_upsert(sb, "gp_talentos", row)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if dropped:
            print(f"[gp_talentos] colunas ausentes ignoradas (rode o ALTER TABLE): {dropped}")
        audit(self, actor, "gp.talento.upsert", target_type="gp_talentos",
              target_id=row["id"], notes=nome[:80])
        return self._send(200, {"ok": True, "row": (r.data or [row])[0], "dropped": dropped})

    # ── parecer da avaliação interna (RH / sócio / departamento) ──
    def _avaliar(self, sb, actor, body):
        tid = body.get("id")
        if not tid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        try:
            cur = sb.table("gp_talentos").select("avaliacoes").eq("id", tid).limit(1).execute().data or []
        except Exception:
            cur = []
        av = (cur[0].get("avaliacoes") if cur else None) or []
        if isinstance(av, str):
            try: av = json.loads(av)
            except: av = []
        if not isinstance(av, list): av = []
        parecer = {
            "by_id": actor.get("id"),
            "by_nome": actor.get("name") or actor.get("email") or "—",
            "papel": actor.get("role") or "",
            "voto": (body.get("voto") or "").strip()[:20],          # Aprovo / Reprovo / Standby
            "nota": (lambda v: v if isinstance(v, int) else 0)(body.get("nota") if isinstance(body.get("nota"), int) else 0),
            "texto": (body.get("texto") or "").strip()[:3000],
            "at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            parecer["nota"] = max(0, min(5, int(body.get("nota") or 0)))
        except Exception:
            parecer["nota"] = 0
        av.append(parecer)
        try:
            n, _ = _safe_update(sb, "gp_talentos", tid, {"avaliacoes": av,
                                "updated_at": datetime.now(timezone.utc).isoformat()})
            if n == 0:
                return self._send(404, {"ok": False, "error": "ficha não encontrada — recarregue a página (F5) e tente de novo"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "gp.talento.avaliar", target_type="gp_talentos", target_id=tid,
              notes=parecer["voto"])
        return self._send(200, {"ok": True, "avaliacoes": av})

    # ── mover de etapa no pipeline (registra histórico) ──
    def _mover(self, sb, actor, body):
        tid = body.get("id"); etapa = (body.get("etapa") or "").strip()[:60]
        if not tid or not etapa: return self._send(400, {"ok": False, "error": "id e etapa"})
        try:
            cur = sb.table("gp_talentos").select("etapa,historico,rd_deal_id,rd_etapa").eq("id", tid).limit(1).execute().data or []
        except Exception:
            cur = []
        de = (cur[0].get("etapa") if cur else None) or ""
        # v89.10: card ligado ao RD indo pra coluna que existe no RD → move o negócio lá primeiro
        nova_rd = None
        if cur and cur[0].get("rd_deal_id"):
            nova_rd, err = RDT.empurrar_etapa(sb, os.environ.get("RD_API_TOKEN"), cur[0], etapa)
            if err:
                return self._send(502, {"ok": False, "error": "O RD não aceitou a mudança de etapa: " + err})
        hist = (cur[0].get("historico") if cur else None) or []
        if isinstance(hist, str):
            try: hist = json.loads(hist)
            except: hist = []
        if not isinstance(hist, list): hist = []
        hist.append({"de": de, "para": etapa, "by": actor.get("name") or "—",
                     "at": datetime.now(timezone.utc).isoformat()})
        patch = {"etapa": etapa, "historico": hist,
                 "updated_at": datetime.now(timezone.utc).isoformat()}
        if nova_rd:
            patch["rd_etapa"] = nova_rd
        try:
            n, _ = _safe_update(sb, "gp_talentos", tid, patch)
            if n == 0:
                return self._send(404, {"ok": False, "error": "ficha não encontrada — recarregue a página (F5) e tente de novo"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "gp.talento.mover", target_type="gp_talentos", target_id=tid, notes=etapa)
        return self._send(200, {"ok": True, "etapa": etapa, "historico": hist, "rd_etapa": nova_rd})

    # ── v89.10: puxa o funil de Parceria do RD (ao vivo; espelho se o RD falhar) ──
    def _rd_sync(self, sb):
        token = os.environ.get("RD_API_TOKEN")
        pid = RDT.pipeline_id(sb)
        fonte, aviso = "rd", None
        try:
            if not token:
                raise RuntimeError("RD_API_TOKEN não configurado")
            deals = RDT.deals_ao_vivo(token, pid)
        except Exception as e:
            fonte, aviso = "espelho", str(e)[:200]
            deals = RDT.deals_do_espelho(sb, pid)
        try:
            r = RDT.reconciliar(sb, deals, pid)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:300]})
        return self._send(200, {"ok": True, "fonte": fonte, "aviso": aviso, **r,
                                "at": datetime.now(timezone.utc).isoformat()})

    def do_DELETE(self):
        try: actor = _gate(self, 2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        tid = params.get("id")
        if not tid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("gp_talentos").delete().eq("id", tid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "gp.talento.delete", target_type="gp_talentos", target_id=tid)
        return self._send(200, {"ok": True})
