"""GET/POST/DELETE /api/v3/gp/talentos — Base de Talentos

GET:    list (lvl>=5)
POST:   upsert (lvl>=5)
DELETE: ?id=X (lvl>=5)
"""
from http.server import BaseHTTPRequestHandler
import base64, json, os, re, sys, urllib.parse
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


# ── v89.35: documentação do candidato (anexos da ficha) ──
# Bucket PRIVADO: RG, CPF, comprovante… são dado pessoal — nada de URL pública.
# O arquivo só abre por link assinado de 5 min, pedido por quem passa no _gate.
DOC_BUCKET = "talentos-docs"
DOC_MAX_BYTES = 3_200_000   # o corpo do Vercel corta em ~4,5 MB e o base64 infla 33%
DOC_MAX_POR_FICHA = 40
DOC_MIME = {
    "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "webp": "image/webp", "heic": "image/heic",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _doc_nome(name):
    name = (name or "arquivo").strip().replace(" ", "_")
    name = re.sub(r"[^A-Za-z0-9._-]", "", name) or "arquivo"
    return name[-80:]


def _docs_da_ficha(sb, tid):
    """(lista de documentos, ficha existe?). Erro de coluna ausente sobe pra quem chamou."""
    cur = sb.table("gp_talentos").select("documentos").eq("id", tid).limit(1).execute().data or []
    if not cur:
        return [], False
    docs = cur[0].get("documentos") or []
    if isinstance(docs, str):
        try: docs = json.loads(docs)
        except Exception: docs = []
    return (docs if isinstance(docs, list) else []), True


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
        if action == "doc_upload":
            return self._doc_upload(sb, actor, body)
        if action == "doc_link":
            return self._doc_link(sb, actor, body)
        if action == "doc_del":
            return self._doc_del(sb, actor, body)
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

    # ── v89.35: documentação do candidato ──
    def _doc_upload(self, sb, actor, body):
        tid = str(body.get("id") or "").strip()
        if not tid: return self._send(400, {"ok": False, "error": "salve a ficha antes de anexar documentos"})
        filename = _doc_nome(body.get("filename"))
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in DOC_MIME:
            return self._send(400, {"ok": False, "error": "Tipo de arquivo não aceito. Envie PDF, imagem (JPG/PNG/WEBP/HEIC) ou Word."})
        raw = body.get("content_b64") or ""
        if "," in raw and raw.strip().lower().startswith("data:"):
            raw = raw.split(",", 1)[1]
        try:
            data = base64.b64decode(raw)
        except Exception:
            return self._send(400, {"ok": False, "error": "conteúdo do arquivo inválido"})
        if not data: return self._send(400, {"ok": False, "error": "arquivo vazio"})
        if len(data) > DOC_MAX_BYTES:
            return self._send(413, {"ok": False, "error": "Arquivo acima de 3 MB. Reduza o PDF (ou envie foto) e tente de novo."})
        try:
            docs, existe = _docs_da_ficha(sb, tid)
        except Exception as e:
            if "documentos" in str(e):
                return self._send(503, {"ok": False, "error": "coluna 'documentos' ainda não existe — rode a migração supabase/gp_talentos_documentos_v89_35.sql"})
            return self._send(500, {"ok": False, "error": str(e)[:300]})
        if not existe:
            return self._send(404, {"ok": False, "error": "ficha não encontrada — recarregue a página (F5) e tente de novo"})
        if len(docs) >= DOC_MAX_POR_FICHA:
            return self._send(400, {"ok": False, "error": f"limite de {DOC_MAX_POR_FICHA} documentos por candidato"})
        try:
            sb.storage.create_bucket(DOC_BUCKET, options={"public": False})
        except Exception:
            pass   # já existe
        agora = datetime.now(timezone.utc)
        doc_id = f"doc_{int(agora.timestamp()*1000)}"
        path = f"{re.sub(r'[^A-Za-z0-9_-]', '', tid)}/{doc_id}_{filename}"
        try:
            sb.storage.from_(DOC_BUCKET).upload(path, data, {"content-type": DOC_MIME[ext]})
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"upload falhou: {str(e)[:160]}"})
        docs.append({
            "id": doc_id, "tipo": (body.get("tipo") or "Outro").strip()[:60],
            "nome": (body.get("filename") or filename).strip()[:120], "path": path,
            "mime": DOC_MIME[ext], "size": len(data),
            "by": actor.get("name") or actor.get("email") or "—", "at": agora.isoformat(),
        })
        try:
            n, dropped = _safe_update(sb, "gp_talentos", tid, {"documentos": docs, "updated_at": agora.isoformat()})
        except Exception as e:
            n, dropped = 0, [str(e)[:200]]
        if n == 0 or "documentos" in dropped:
            try: sb.storage.from_(DOC_BUCKET).remove([path])   # não deixa arquivo órfão
            except Exception: pass
            return self._send(500, {"ok": False, "error": "não consegui registrar o documento na ficha — tente de novo"})
        audit(self, actor, "gp.talento.doc_upload", target_type="gp_talentos", target_id=tid,
              notes=f"{docs[-1]['tipo']} · {filename} · {len(data)} bytes")
        return self._send(200, {"ok": True, "documentos": docs})

    def _doc_link(self, sb, actor, body):
        tid = str(body.get("id") or "").strip(); doc_id = str(body.get("doc_id") or "").strip()
        try:
            docs, _ = _docs_da_ficha(sb, tid)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:300]})
        d = next((x for x in docs if x.get("id") == doc_id), None)   # só abre o que está NESTA ficha
        if not d: return self._send(404, {"ok": False, "error": "documento não encontrado"})
        try:
            r = sb.storage.from_(DOC_BUCKET).create_signed_url(d["path"], 300)
            url = r.get("signedURL") or r.get("signedUrl") or r.get("signed_url")
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"não consegui abrir o arquivo: {str(e)[:160]}"})
        if not url: return self._send(502, {"ok": False, "error": "não consegui abrir o arquivo"})
        audit(self, actor, "gp.talento.doc_abrir", target_type="gp_talentos", target_id=tid, notes=d.get("nome", "")[:80])
        return self._send(200, {"ok": True, "url": url})

    def _doc_del(self, sb, actor, body):
        tid = str(body.get("id") or "").strip(); doc_id = str(body.get("doc_id") or "").strip()
        try:
            docs, _ = _docs_da_ficha(sb, tid)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:300]})
        d = next((x for x in docs if x.get("id") == doc_id), None)
        if not d: return self._send(404, {"ok": False, "error": "documento não encontrado"})
        docs = [x for x in docs if x.get("id") != doc_id]
        try:
            _safe_update(sb, "gp_talentos", tid, {"documentos": docs, "updated_at": datetime.now(timezone.utc).isoformat()})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:300]})
        try: sb.storage.from_(DOC_BUCKET).remove([d["path"]])
        except Exception as e: print(f"[gp_talentos] doc_del storage: {e}")
        audit(self, actor, "gp.talento.doc_del", target_type="gp_talentos", target_id=tid, notes=d.get("nome", "")[:80])
        return self._send(200, {"ok": True, "documentos": docs})

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
        try:   # v89.35: ficha excluída leva os documentos junto (dado pessoal não fica órfão)
            docs, _ = _docs_da_ficha(sb, tid)
        except Exception:
            docs = []
        try:
            sb.table("gp_talentos").delete().eq("id", tid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        paths = [d.get("path") for d in docs if d.get("path")]
        if paths:
            try: sb.storage.from_(DOC_BUCKET).remove(paths)
            except Exception as e: print(f"[gp_talentos] delete docs storage: {e}")
        audit(self, actor, "gp.talento.delete", target_type="gp_talentos", target_id=tid)
        return self._send(200, {"ok": True})
