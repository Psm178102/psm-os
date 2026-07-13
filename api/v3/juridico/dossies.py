"""
GET/POST /api/v3/juridico/dossies — DOSSIÊS DE CNDs (Jurídico). v84.37

Cadastro estruturado de comprador + vendedor + imóvel (ou só um deles) e o
CHECKLIST de certidões gerado pelo perfil:
  - vendedor: lista completa (federal, estadual, CNDT, TJSP cível/fiscal/
    criminal, TRF3, protestos) — se casado/união estável, o cônjuge ganha a
    mesma lista (praxe de due diligence)
  - comprador: lista básica (federal + CNDT)
  - imóvel: tributos municipais (IPTU) + quitação de condomínio (se marcado)

Cada certidão: link oficial de emissão (editável), status (pendente/emitida/
POSITIVA), validade (alerta de vencida no front) e URL do PDF anexado.
A matrícula atualizada fica FORA (tem custo — decisão do sócio).

Visão por HIERARQUIA: lvl>=7 vê todos os dossiês; abaixo disso, cada um vê
só os que criou. Editar/excluir: criador ou gestão.

Auth: lvl>=2 (quem tem a aba CNDs no menu usa).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

# (tipo, nome, link oficial default — editável por certidão no dossiê)
CERT_PESSOA_FULL = [
    ("federal", "CND Federal — Receita/PGFN", "https://servicos.receita.fazenda.gov.br/servicos/certidaointernet/pf/emitir"),
    ("estadual", "CND Estadual — Dívida Ativa (PGE-SP)", "https://www.dividaativa.pge.sp.gov.br/sc/pages/crda/emitirCrda.jsf"),
    ("cndt", "CNDT — Débitos Trabalhistas (TST)", "https://cndt-certidao.tst.jus.br/inicio.faces"),
    ("tjsp_civel", "Distribuição Cível (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("tjsp_fiscal", "Executivos Fiscais (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("tjsp_criminal", "Distribuição Criminal (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("trf3", "Distribuição Justiça Federal (TRF3)", "https://web.trf3.jus.br/certidao"),
    ("protestos", "Protestos (CENPROT Nacional)", "https://site.cenprotnacional.org.br/"),
]
CERT_PESSOA_BASICA = [CERT_PESSOA_FULL[0], CERT_PESSOA_FULL[2]]  # federal + CNDT
CERT_IMOVEL = [
    ("iptu", "Certidão Negativa de Tributos Imobiliários (Prefeitura)", "https://portal.riopreto.sp.gov.br/"),
    ("condominio", "Declaração de quitação de condomínio (administradora/síndico)", ""),
]
CAMPOS_PESSOA = ("nome", "cpf", "rg", "nascimento", "mae", "pai", "naturalidade",
                 "estado_civil", "profissao", "endereco",
                 "conjuge_nome", "conjuge_cpf", "conjuge_rg")
CAMPOS_IMOVEL = ("endereco", "matricula", "cartorio", "inscricao_municipal", "cidade", "condominio")
CASADO = ("casado", "casada", "uniao_estavel", "união estável", "uniao estavel")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _pessoa(raw):
    if not isinstance(raw, dict):
        return None
    p = {k: (str(raw.get(k) or "").strip()[:200] or None) for k in CAMPOS_PESSOA}
    return p if p.get("nome") or p.get("cpf") else None


def _imovel(raw):
    if not isinstance(raw, dict):
        return None
    i = {k: (bool(raw.get(k)) if k == "condominio" else (str(raw.get(k) or "").strip()[:300] or None))
         for k in CAMPOS_IMOVEL}
    return i if i.get("endereco") or i.get("matricula") or i.get("inscricao_municipal") else None


def gerar_checklist(d, existentes):
    """Monta certidoes[] pelo perfil, preservando o andamento (status/validade/
    arquivo/obs/link) das já existentes por chave (alvo, tipo)."""
    antigas = {(c.get("alvo"), c.get("tipo")): c for c in (existentes or []) if isinstance(c, dict)}
    out = []

    def add(alvo, rotulo, lista):
        for tipo, nome, link in lista:
            velho = antigas.get((alvo, tipo)) or {}
            out.append({"alvo": alvo, "rotulo": rotulo, "tipo": tipo, "nome": nome,
                        "link": velho.get("link") or link,
                        "status": velho.get("status") or "pendente",
                        "validade": velho.get("validade"),
                        "arquivo_url": velho.get("arquivo_url"),
                        "obs": velho.get("obs"),
                        "emitida_em": velho.get("emitida_em")})

    v = d.get("vendedor") or {}
    c = d.get("comprador") or {}
    im = d.get("imovel") or {}
    if v.get("nome") or v.get("cpf"):
        add("vendedor", f"Vendedor — {v.get('nome') or v.get('cpf')}", CERT_PESSOA_FULL)
        if (v.get("estado_civil") or "").lower().replace("ã", "a") in CASADO and (v.get("conjuge_nome") or v.get("conjuge_cpf")):
            add("conjuge_vendedor", f"Cônjuge do vendedor — {v.get('conjuge_nome') or v.get('conjuge_cpf')}", CERT_PESSOA_FULL)
    if c.get("nome") or c.get("cpf"):
        add("comprador", f"Comprador — {c.get('nome') or c.get('cpf')}", CERT_PESSOA_BASICA)
    if im:
        certs_im = [CERT_IMOVEL[0]] + ([CERT_IMOVEL[1]] if im.get("condominio") else [])
        add("imovel", f"Imóvel — {im.get('endereco') or ('matrícula ' + str(im.get('matricula') or ''))}", certs_im)
    return out


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
        lvl = user.get("lvl") or 0
        try:
            q = sb.table("cnd_dossies").select("*").order("atualizado_em", desc=True).limit(500)
            if lvl < 7:  # hierarquia: abaixo da gestão, só os próprios
                q = q.eq("criado_por", str(user.get("id")))
            rows = q.execute().data or []
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        usuarios = []
        try:
            usuarios = sb.table("users").select("id,name").limit(200).execute().data or []
        except Exception:
            pass
        return self._send(200, {"ok": True, "dossies": rows,
                                "users": usuarios, "eu": str(user.get("id")),
                                "gestao": lvl >= 7})

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

        def dossie(did):
            rows = sb.table("cnd_dossies").select("*").eq("id", str(did)).limit(1).execute().data or []
            return rows[0] if rows else None

        def pode_mexer(d):
            return lvl >= 7 or str(d.get("criado_por") or "") == uid

        try:
            if action == "upsert":
                titulo = str(body.get("titulo") or "").strip()[:200]
                if not titulo:
                    return self._send(400, {"ok": False, "error": "título obrigatório"})
                novo = {"titulo": titulo,
                        "comprador": _pessoa(body.get("comprador")),
                        "vendedor": _pessoa(body.get("vendedor")),
                        "imovel": _imovel(body.get("imovel")),
                        "obs": (str(body.get("obs") or "").strip()[:2000] or None),
                        "atualizado_em": _now()}
                if body.get("status") in ("aberto", "completo", "arquivado"):
                    novo["status"] = body["status"]
                if body.get("id"):
                    d = dossie(body["id"])
                    if not d:
                        return self._send(404, {"ok": False, "error": "dossiê não encontrado"})
                    if not pode_mexer(d):
                        return self._send(403, {"ok": False, "error": "só quem criou (ou a gestão) edita este dossiê"})
                    novo["certidoes"] = gerar_checklist(novo, d.get("certidoes"))
                    sb.table("cnd_dossies").update(novo).eq("id", str(d["id"])).execute()
                    did = str(d["id"])
                else:
                    novo["certidoes"] = gerar_checklist(novo, [])
                    novo["criado_por"] = uid
                    r = sb.table("cnd_dossies").insert(novo).execute().data or []
                    did = str(r[0]["id"]) if r else None
                audit(self, user, "cnd.dossie_upsert", "cnd_dossies", did, notes=titulo)
                return self._send(200, {"ok": True, "id": did, "certidoes": novo["certidoes"]})

            if action == "set_cert":
                d = dossie(body.get("id"))
                if not d:
                    return self._send(404, {"ok": False, "error": "dossiê não encontrado"})
                if not pode_mexer(d):
                    return self._send(403, {"ok": False, "error": "só quem criou (ou a gestão) edita este dossiê"})
                alvo, tipo = str(body.get("alvo") or ""), str(body.get("tipo") or "")
                certs = d.get("certidoes") or []
                achou = False
                for cert in certs:
                    if cert.get("alvo") == alvo and cert.get("tipo") == tipo:
                        achou = True
                        if body.get("cstatus") in ("pendente", "emitida", "positiva"):
                            cert["status"] = body["cstatus"]
                            cert["emitida_em"] = _now() if body["cstatus"] in ("emitida", "positiva") else None
                        for k in ("validade", "arquivo_url", "obs", "link"):
                            if k in body:
                                cert[k] = (str(body.get(k) or "").strip()[:1000] or None)
                if not achou:
                    return self._send(404, {"ok": False, "error": "certidão não encontrada no checklist"})
                sb.table("cnd_dossies").update({"certidoes": certs, "atualizado_em": _now()}) \
                    .eq("id", str(d["id"])).execute()
                return self._send(200, {"ok": True, "certidoes": certs})

            if action == "delete":
                d = dossie(body.get("id"))
                if not d:
                    return self._send(404, {"ok": False, "error": "dossiê não encontrado"})
                if not pode_mexer(d):
                    return self._send(403, {"ok": False, "error": "só quem criou (ou a gestão) exclui"})
                sb.table("cnd_dossies").delete().eq("id", str(d["id"])).execute()
                audit(self, user, "cnd.dossie_delete", "cnd_dossies", str(d["id"]), notes=d.get("titulo"))
                return self._send(200, {"ok": True})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
