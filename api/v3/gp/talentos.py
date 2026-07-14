"""GET/POST/DELETE /api/v3/gp/talentos — Base de Talentos

GET:    list (lvl>=5)
POST:   upsert (lvl>=5)
DELETE: ?id=X (lvl>=5)
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


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
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("gp_talentos").select("*").order("criado_em", desc=True).limit(500).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "talentos": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
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
            cur = sb.table("gp_talentos").select("etapa,historico").eq("id", tid).limit(1).execute().data or []
        except Exception:
            cur = []
        de = (cur[0].get("etapa") if cur else None) or ""
        hist = (cur[0].get("historico") if cur else None) or []
        if isinstance(hist, str):
            try: hist = json.loads(hist)
            except: hist = []
        if not isinstance(hist, list): hist = []
        hist.append({"de": de, "para": etapa, "by": actor.get("name") or "—",
                     "at": datetime.now(timezone.utc).isoformat()})
        patch = {"etapa": etapa, "historico": hist,
                 "updated_at": datetime.now(timezone.utc).isoformat()}
        try:
            n, _ = _safe_update(sb, "gp_talentos", tid, patch)
            if n == 0:
                return self._send(404, {"ok": False, "error": "ficha não encontrada — recarregue a página (F5) e tente de novo"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "gp.talento.mover", target_type="gp_talentos", target_id=tid, notes=etapa)
        return self._send(200, {"ok": True, "etapa": etapa, "historico": hist})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=2)
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
