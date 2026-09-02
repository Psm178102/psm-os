"""
/api/v3/sol/aprovacao — fila de aprovação do modo COPILOTO + transcrição

GET  (sem params)      → fila: eventos 'aprovacao_pendente' ainda sem decisão
GET  ?conversa_id=N    → transcrição completa da conversa (eventos com payload)
POST {evento_id, acao: aprovado|corrigido|bloqueado, texto?}
     → grava um NOVO evento de decisão em sol_eventos (append-only, nada é
       editado): payload = {ref_evento_id, texto_final, decidido_por}.
       'corrigido' exige texto. O executor da Sol lê a decisão e envia (ou não).

⚠️ NÍVEL 5 (≠ dos outros endpoints da Sol, que são 10): a FILA é operação do
dia a dia — a Leire/gestão aprova mensagem em copiloto, não o sócio. A página
/central-sol segue gated em 10 no front; quando o sócio abrir a operação, é só
baixar o ROUTE_MIN_LVL — o backend já está no nível certo. O que sai daqui é
seguro pra lvl 5: telefone SEMPRE mascarado, nenhuma config/custo/token.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

ACOES_OK = ("aprovado", "corrigido", "bloqueado")
DECISOES = ACOES_OK  # tipos de evento que encerram uma pendência


def _mascara_fone(raw):
    """5517996612193 → (17) 9****-2193 (mesma máscara do painel.py)."""
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("55") and len(d) >= 12:
        d = d[2:]
    if len(d) < 8:
        return "***" if d else ""
    ddd, resto = (d[:2], d[2:]) if len(d) >= 10 else ("", d)
    pre = f"({ddd}) " if ddd else ""
    return f"{pre}{resto[0]}****-{resto[-4:]}"


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    # ── GET: fila OU transcrição ──────────────────────────────────────────
    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        qs = parse_qs(urlparse(self.path).query)
        conversa_id = (qs.get("conversa_id") or [None])[0]

        if conversa_id:
            try:
                cid = int(conversa_id)
            except Exception:
                return self._send(400, {"ok": False, "error": "conversa_id inválido"})
            try:
                conv = (sb.table("sol_conversas")
                        .select("id,nome,telefone,origem,etapa_funil,regua,status")
                        .eq("id", cid).limit(1).execute().data or [])
                evs = (sb.table("sol_eventos")
                       .select("id,tipo,payload,criado_em")
                       .eq("conversa_id", cid)
                       .order("criado_em").limit(500).execute().data or [])
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            if not conv:
                return self._send(404, {"ok": False, "error": "conversa não encontrada"})
            c = conv[0]
            c["telefone"] = _mascara_fone(c.get("telefone"))
            return self._send(200, {"ok": True, "conversa": c, "eventos": evs})

        # fila: pendentes sem decisão posterior (decisão referencia ref_evento_id)
        try:
            pend = (sb.table("sol_eventos")
                    .select("id,conversa_id,payload,criado_em")
                    .eq("tipo", "aprovacao_pendente")
                    .order("criado_em", desc=True).limit(100).execute().data or [])
            dec = (sb.table("sol_eventos")
                   .select("payload")
                   .in_("tipo", list(DECISOES))
                   .order("criado_em", desc=True).limit(300).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        decididos = set()
        for d in dec:
            ref = (d.get("payload") or {}).get("ref_evento_id")
            if ref is not None:
                decididos.add(int(ref))
        fila = [p for p in pend if int(p["id"]) not in decididos]

        # enriquece com nome/fone mascarado da conversa
        cids = sorted({p["conversa_id"] for p in fila if p.get("conversa_id")})
        nomes = {}
        if cids:
            try:
                rows = (sb.table("sol_conversas").select("id,nome,telefone,origem")
                        .in_("id", cids).execute().data or [])
                nomes = {r["id"]: r for r in rows}
            except Exception:
                nomes = {}
        for p in fila:
            c = nomes.get(p.get("conversa_id")) or {}
            p["nome"] = c.get("nome")
            p["telefone"] = _mascara_fone(c.get("telefone"))
            p["origem"] = c.get("origem")
        return self._send(200, {"ok": True, "fila": fila})

    # ── POST: decisão sobre uma pendência ─────────────────────────────────
    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        acao = str(body.get("acao") or "").strip().lower()
        texto = str(body.get("texto") or "").strip()
        try:
            evento_id = int(body.get("evento_id"))
        except Exception:
            return self._send(400, {"ok": False, "error": "evento_id obrigatório (inteiro)"})
        if acao not in ACOES_OK:
            return self._send(400, {"ok": False, "error": f"acao inválida (permitidas: {', '.join(ACOES_OK)})"})
        if acao == "corrigido" and not texto:
            return self._send(400, {"ok": False, "error": "corrigido exige o texto final"})
        if len(texto) > 4000:
            return self._send(400, {"ok": False, "error": "texto longo demais (4000 chars)"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            orig = (sb.table("sol_eventos").select("id,conversa_id,tipo,payload")
                    .eq("id", evento_id).limit(1).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if not orig or orig[0].get("tipo") != "aprovacao_pendente":
            return self._send(404, {"ok": False, "error": "pendência não encontrada"})
        orig = orig[0]

        # já decidida? (append-only: procura decisão referenciando este id)
        try:
            ja = (sb.table("sol_eventos").select("id,tipo")
                  .in_("tipo", list(DECISOES))
                  .eq("payload->>ref_evento_id", str(evento_id))
                  .limit(1).execute().data or [])
            if ja:
                return self._send(409, {"ok": False, "error": f"já decidida ({ja[0].get('tipo')})"})
        except Exception:
            pass  # best-effort — pior caso: 2 decisões, executor usa a 1ª

        texto_final = texto if acao == "corrigido" else \
            ((orig.get("payload") or {}).get("texto_proposto") or (orig.get("payload") or {}).get("texto") or "")
        if acao == "bloqueado":
            texto_final = ""
        row = {
            "conversa_id": orig.get("conversa_id"),
            "tipo": acao,
            "payload": {
                "ref_evento_id": evento_id,
                "texto_final": texto_final,
                "decidido_por": actor.get("email") or actor.get("id"),
            },
        }
        try:
            ins = sb.table("sol_eventos").insert(row).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "sol.aprovacao", target_type="sol_evento", target_id=str(evento_id),
              before={"tipo": "aprovacao_pendente"}, after={"tipo": acao},
              notes=(texto_final[:200] if acao == "corrigido" else None))
        return self._send(200, {"ok": True, "acao": acao, "evento": (ins[0] if ins else row)})
