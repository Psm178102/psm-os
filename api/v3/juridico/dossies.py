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
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all, lvl_of  # type: ignore

# (tipo, nome, link oficial default — editável por certidão no dossiê)
#
# LINKS CONFERIDOS UM A UM NO NAVEGADOR EM 16/07/2026 (v84.66). Dois estavam
# quebrados e mandavam a Leire pra um beco:
#  • Federal: o link antigo (certidaointernet/pf/emitir) devolve 404 — e o link
#    que a PRÓPRIA página da Receita aponta (CertInter/PF.asp) TAMBÉM dá 404.
#    O serviço migrou pro portal novo servicos.receitafederal.gov.br, que agora
#    EXIGE LOGIN GOV.BR (acabou o formulário público de CPF+captcha). Confirmado
#    pela PGFN, que aponta "Consultar/Emitir Certidão" pra lá.
#  • IPTU: portal.riopreto.sp.gov.br NÃO RESOLVE mais (DNS morto) → riopreto.sp.gov.br
# E um FALSO POSITIVO importante: o curl dizia que o TRF3 estava fora, mas no
# navegador ele abre normal (era bloqueio anti-bot). Ficou como está.
RECEITA_CND = "https://servicos.receitafederal.gov.br/servico/certidoes/#/home"

CERT_PF = [
    ("federal", "CND Federal — Receita/PGFN (exige login gov.br)", RECEITA_CND),
    ("estadual", "CND Estadual — Dívida Ativa (PGE-SP)", "https://www.dividaativa.pge.sp.gov.br/sc/pages/crda/emitirCrda.jsf"),
    ("cndt", "CNDT — Débitos Trabalhistas (TST)", "https://cndt-certidao.tst.jus.br/inicio.faces"),
    ("tjsp_civel", "Distribuição Cível (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("tjsp_fiscal", "Executivos Fiscais (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("tjsp_criminal", "Distribuição Criminal (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("trf3", "Distribuição Justiça Federal (TRF3)", "https://web.trf3.jus.br/certidao-regional/"),
    ("protestos", "Protestos (CENPROT Nacional)", "https://site.cenprotnacional.org.br/"),
]
# PJ: troca o TJSP criminal (não se aplica) por FGTS/CRF, que banco e cartório pedem
CERT_PJ = [
    ("federal", "CND Federal PJ — Receita/PGFN (exige login gov.br)", RECEITA_CND),
    ("estadual", "CND Estadual — Dívida Ativa (PGE-SP)", "https://www.dividaativa.pge.sp.gov.br/sc/pages/crda/emitirCrda.jsf"),
    ("cndt", "CNDT — Débitos Trabalhistas (TST)", "https://cndt-certidao.tst.jus.br/inicio.faces"),
    ("fgts", "CRF — Regularidade do FGTS (Caixa)", "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf"),
    ("tjsp_civel", "Distribuição Cível (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("tjsp_fiscal", "Executivos Fiscais (TJSP e-SAJ)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do"),
    ("trf3", "Distribuição Justiça Federal (TRF3)", "https://web.trf3.jus.br/certidao-regional/"),
    ("protestos", "Protestos (CENPROT Nacional)", "https://site.cenprotnacional.org.br/"),
]
CERT_IMOVEL = [
    ("iptu", "Certidão Negativa de Tributos Imobiliários (Prefeitura)", "https://riopreto.sp.gov.br/"),
    ("condominio", "Declaração de quitação de condomínio (administradora/síndico)", ""),
]

CAMPOS_PF = ("nome", "cpf", "rg", "nascimento", "mae", "pai", "naturalidade",
             "estado_civil", "profissao", "endereco", "email", "telefone",
             "conjuge_nome", "conjuge_cpf", "conjuge_rg")
CAMPOS_PJ = ("razao_social", "cnpj", "inscricao_estadual", "endereco", "email", "telefone")
CAMPOS_IMOVEL = ("endereco", "matricula", "cartorio", "inscricao_municipal", "cidade", "condominio")
CASADO = ("casado", "casada", "uniao_estavel", "união estável", "uniao estavel")

# venda usa comprador/vendedor; locação usa locatário/locador — mesmo dossiê.
# FIADOR entra como parte de pleno direito: é ele que responde pela dívida, então
# gera o pacote completo de CND igual a qualquer outra parte.
PAPEIS = {
    "comprador": "Comprador", "vendedor": "Vendedor",
    "locatario": "Locatário", "locador": "Locador",
    "fiador": "Fiador",
}
STATUS_CND = ("aguardando", "emitida", "nao_emitida", "bloqueada")
RESULTADO_CND = ("positiva", "negativa")   # só faz sentido depois de emitida

# ── Garantia da locação (2º ato: só existe em locação) ──────────────────────
# Depois que as CNDs voltam, alguém ANALISA e aprova (ou não) a garantia.
# Cada tipo pede um detalhe diferente — o front usa 'pede' pra rotular o campo.
# Os 3 tipos que a PSM aceita (decisão do Paulo, v84.70). Caução/outra saíram
# do menu; se algum dossiê antigo tiver um tipo fora da lista, o rótulo degrada
# pra "—" mas o dado não é apagado.
GARANTIAS = {
    "fiador":      {"nome": "Fiador", "pede": "Quem é o fiador (cadastre como parte 'Fiador' pra gerar as CNDs dele)"},
    "seguro":      {"nome": "Seguro-fiança", "pede": "Seguradora + nº da apólice"},
    "capitalizacao": {"nome": "Título de capitalização", "pede": "Instituição + nº do título"},
}
# pendente_doc (v84.70): a garantia foi escolhida mas falta papel do cliente
# (apólice, comprovante do título, docs do fiador). Não é decisão — é espera;
# por isso NÃO carimba decidido_por, mas avisa o caso pra alguém ir cobrar.
STATUS_GARANTIA = ("nao_definida", "em_analise", "pendente_doc", "aprovada", "reprovada")
GARANTIA_LBL = {
    "nao_definida": "Garantia não definida", "em_analise": "Garantia em análise",
    "pendente_doc": "Garantia PENDENTE DE DOC",
    "aprovada": "Garantia APROVADA", "reprovada": "Garantia REPROVADA",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _txt(v, n=200):
    return (str(v or "").strip()[:n] or None)


def _parte(raw):
    """Uma parte do negócio: PF ou PJ. PJ carrega os sócios representantes —
    e cada sócio gera o pacote de PF (decisão do Paulo), porque é o que banco e
    cartório exigem em compra por empresa."""
    if not isinstance(raw, dict):
        return None
    papel = (raw.get("papel") or "").strip().lower()
    if papel not in PAPEIS:
        return None
    tipo = "pj" if (raw.get("tipo") or "pf").lower() == "pj" else "pf"
    p = {"id": _txt(raw.get("id")) or ("pt_" + uuid.uuid4().hex[:10]),
         "papel": papel, "tipo": tipo}
    campos = CAMPOS_PJ if tipo == "pj" else CAMPOS_PF
    for k in campos:
        p[k] = _txt(raw.get(k), 300)
    if tipo == "pj":
        socios = []
        for s in (raw.get("socios") or [])[:10]:
            if not isinstance(s, dict):
                continue
            so = {"id": _txt(s.get("id")) or ("sc_" + uuid.uuid4().hex[:8])}
            for k in CAMPOS_PF:
                so[k] = _txt(s.get(k), 300)
            if so.get("nome") or so.get("cpf"):
                socios.append(so)
        p["socios"] = socios
        if not (p.get("razao_social") or p.get("cnpj")):
            return None
    else:
        if not (p.get("nome") or p.get("cpf")):
            return None
    return p


def _nome_de(p):
    return p.get("razao_social") if p.get("tipo") == "pj" else p.get("nome")


def _doc_de(p):
    return p.get("cnpj") if p.get("tipo") == "pj" else p.get("cpf")


def _garantia(raw, antiga=None):
    """A garantia da locação. Guarda o HISTÓRICO da decisão (quem aprovou/
    reprovou e quando) — 'foi aprovada?' sem quem e quando não serve de nada
    quando o contrato dá problema seis meses depois."""
    a = antiga or {}
    if not isinstance(raw, dict):
        return a or {"tipo": None, "status": "nao_definida"}
    tipo = (raw.get("tipo") or "").strip().lower()
    if tipo and tipo not in GARANTIAS:
        tipo = None  # tipo fora do menu não entra; o antigo (se houver) fica
    st = (raw.get("status") or a.get("status") or "nao_definida").strip().lower()
    if st not in STATUS_GARANTIA:
        st = "nao_definida"
    # tipo escolhido mas ninguém decidiu ainda → entra em análise sozinho
    if tipo and st == "nao_definida":
        st = "em_analise"
    return {
        "tipo": tipo or a.get("tipo"),
        "detalhe": _txt(raw.get("detalhe"), 400) or a.get("detalhe"),
        "valor": _txt(raw.get("valor"), 60) or a.get("valor"),
        "status": st,
        "obs": _txt(raw.get("obs"), 600) or a.get("obs"),
        "decidido_por": a.get("decidido_por"),
        "decidido_em": a.get("decidido_em"),
    }


def _imovel(raw):
    if not isinstance(raw, dict):
        return None
    i = {k: (bool(raw.get(k)) if k == "condominio" else (str(raw.get(k) or "").strip()[:300] or None))
         for k in CAMPOS_IMOVEL}
    return i if i.get("endereco") or i.get("matricula") or i.get("inscricao_municipal") else None


def gerar_checklist(d, existentes):
    """Monta certidoes[] percorrendo TODAS as partes (vários compradores/
    vendedores, PF ou PJ), os cônjuges e os sócios representantes de cada PJ.
    Preserva o andamento (status/resultado/validade/arquivo/obs/link) do que já
    existe, casando por (alvo, tipo) — a chave usa o id da parte, então mexer
    numa parte não zera o trabalho já feito nas outras."""
    antigas = {(c.get("alvo"), c.get("tipo")): c for c in (existentes or []) if isinstance(c, dict)}
    # SEGUNDA CHANCE por (rotulo, tipo) — v84.74. O id da parte deveria ser
    # estável, mas a tela de edição o descartava e cada save gerava ids novos:
    # nada casava e TODO o andamento voltava pra "aguardando" em silêncio (a
    # Leire perdeu um caso inteiro assim). O front foi consertado, mas este
    # fallback fica: o rótulo carrega papel+nome, que sobrevivem à edição.
    por_rotulo = {(c.get("rotulo"), c.get("tipo")): c
                  for c in (existentes or []) if isinstance(c, dict)}
    out = []

    def add(alvo, rotulo, lista):
        for tipo, nome, link in lista:
            velho = antigas.get((alvo, tipo)) or por_rotulo.get((rotulo, tipo)) or {}
            out.append({
                "alvo": alvo, "rotulo": rotulo, "tipo": tipo, "nome": nome,
                "link": velho.get("link") or link,
                "status": velho.get("status") or "aguardando",
                "resultado": velho.get("resultado"),          # positiva | negativa
                "validade": velho.get("validade"),
                "arquivo_url": velho.get("arquivo_url"),
                "obs": velho.get("obs"),
                "emitida_em": velho.get("emitida_em"),
                "por": velho.get("por"),
            })

    def casado(p):
        ec = (p.get("estado_civil") or "").lower().replace("ã", "a")
        return ec in CASADO and (p.get("conjuge_nome") or p.get("conjuge_cpf"))

    for p in (d.get("partes") or []):
        if not isinstance(p, dict):
            continue
        pid = p.get("id") or "?"
        papel = PAPEIS.get(p.get("papel"), p.get("papel") or "parte")
        nome = _nome_de(p) or _doc_de(p) or "(sem nome)"
        if p.get("tipo") == "pj":
            add(f"{pid}", f"{papel} PJ — {nome}", CERT_PJ)
            # sócio representante gera o pacote de PF (banco e cartório exigem)
            for s in (p.get("socios") or []):
                sn = s.get("nome") or s.get("cpf") or "(sócio)"
                add(f"{pid}:{s.get('id')}", f"Sócio de {nome} — {sn}", CERT_PF)
                if casado(s):
                    add(f"{pid}:{s.get('id')}:cj",
                        f"Cônjuge do sócio {sn} — {s.get('conjuge_nome') or s.get('conjuge_cpf')}", CERT_PF)
        else:
            add(f"{pid}", f"{papel} — {nome}", CERT_PF)
            if casado(p):
                add(f"{pid}:cj", f"Cônjuge de {nome} — {p.get('conjuge_nome') or p.get('conjuge_cpf')}", CERT_PF)

    im = d.get("imovel") or {}
    if im:
        certs_im = [CERT_IMOVEL[0]] + ([CERT_IMOVEL[1]] if im.get("condominio") else [])
        add("imovel", f"Imóvel — {im.get('endereco') or ('matrícula ' + str(im.get('matricula') or ''))}", certs_im)
    return out


def envolvidos(d):
    """Quem está no caso — base da visibilidade E de quem recebe notificação.
    Decisão do Paulo: vê quem está envolvido + quem tem alçada. Corretor não vê
    dossiê de outro corretor: aqui tem CPF, RG e nome da mãe de cliente."""
    ids = {d.get("criado_por"), d.get("corretor_id"), d.get("responsavel_id")}
    for x in (d.get("envolvidos_extra") or []):
        ids.add(x)
    return {i for i in ids if i}


# Alçada: quem enxerga QUALQUER dossiê sem estar no caso.
#  • lvl>=7 → sócio, diretor, gerente
#  • backoffice → é quem executa a emissão e cuida do jurídico/financeiro
ALCADA_ROLES = ("backoffice",)


def pode_ver(d, user):
    lvl = user.get("lvl") or 0
    if lvl >= 7 or (user.get("role") or "") in ALCADA_ROLES:
        return True
    return str(user.get("id")) in envolvidos(d)


def pode_editar(d, user):
    """Quem mexe: alçada, quem criou, ou o responsável pela emissão (a Leire
    PRECISA marcar status — se ela não puder editar, o módulo não funciona)."""
    lvl = user.get("lvl") or 0
    if lvl >= 7 or (user.get("role") or "") in ALCADA_ROLES:
        return True
    uid = str(user.get("id"))
    return uid in {str(d.get("criado_por") or ""), str(d.get("responsavel_id") or "")}


def _avisar(handler_self, sb, d, user, titulo, corpo):
    """Notifica TODO MUNDO do caso + a alçada, em tempo real (sino + push).
    Nunca notifica quem disparou a ação — ninguém precisa de aviso do que
    acabou de fazer."""
    try:
        alvos = set(envolvidos(d))
        us = sb.table("users").select("id,role,status").limit(300).execute().data or []
        for u in us:
            if (u.get("status") or "").lower() != "ativo":
                continue
            if (lvl_of(u.get("role")) or 0) >= 7 or (u.get("role") or "") in ALCADA_ROLES:
                alvos.add(str(u["id"]))
        alvos.discard(str(user.get("id")))
        if alvos:
            notify_all(list(alvos), tipo="cnd.dossie", title=titulo, body=corpo,
                       link="#/cnds", target_type="cnd_dossie", target_id=d.get("id"))
    except Exception as e:
        print(f"[cnd] notify err: {e}")


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
            # busca tudo e filtra no PYTHON: a regra é um OU entre 3 colunas
            # (criou / é o corretor / é o responsável) e filtro composto do
            # PostgREST já nos traiu duas vezes nesta base. O .eq("criado_por")
            # antigo era um BUG pro fluxo novo: a Leire, sendo RESPONSÁVEL por
            # um dossiê que o Paulo cadastrou, não enxergava o próprio trabalho.
            rows = sb.table("cnd_dossies").select("*") \
                .order("atualizado_em", desc=True).limit(1000).execute().data or []
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        rows = [d for d in rows if pode_ver(d, user)]
        usuarios = []
        try:
            # role/lvl/ativo INCLUSOS (v84.70): o front filtra o dropdown de
            # responsável por role/lvl — sem esses campos, TODO usuário falhava
            # no filtro e o seletor abria VAZIO: era impossível atribuir a Leire
            # ou a Mariane a um caso. Mesmo bug de contrato do status/cstatus.
            # A lista continua completa (inativos inclusos) porque ela também
            # resolve NOMES de dossiês antigos; o front só oferece os ativos.
            us = sb.table("users").select("id,name,role,status").limit(200).execute().data or []
            usuarios = [{"id": u.get("id"), "name": u.get("name"),
                         "role": u.get("role"), "lvl": lvl_of(u.get("role")) or 0,
                         "ativo": (u.get("status") or "").lower() == "ativo"}
                        for u in us]
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
            # inclui o RESPONSÁVEL pela emissão: a regra antiga (só gestão ou
            # quem criou) impedia a Leire de marcar a CND que ela mesma emitiu.
            return pode_editar(d, user)

        try:
            if action == "upsert":
                titulo = str(body.get("titulo") or "").strip()[:200]
                if not titulo:
                    return self._send(400, {"ok": False, "error": "título obrigatório"})
                tn = "locacao" if (body.get("tipo_negocio") or "venda") == "locacao" else "venda"
                partes = [p for p in (_parte(x) for x in (body.get("partes") or [])[:20]) if p]
                novo = {"titulo": titulo,
                        "tipo_negocio": tn,
                        "partes": partes,
                        "imovel": _imovel(body.get("imovel")),
                        "responsavel_id": _txt(body.get("responsavel_id"), 60),
                        "corretor_id": _txt(body.get("corretor_id"), 60),
                        "drive_url": _txt(body.get("drive_url"), 500),
                        "obs": (str(body.get("obs") or "").strip()[:2000] or None),
                        "atualizado_em": _now()}
                if body.get("status") in ("aberto", "completo", "arquivado"):
                    novo["status"] = body["status"]
                if body.get("id"):
                    d = dossie(body["id"])
                    if not d:
                        return self._send(404, {"ok": False, "error": "dossiê não encontrado"})
                    if not pode_mexer(d):
                        return self._send(403, {"ok": False, "error": "sem permissão neste dossiê"})
                    novo["certidoes"] = gerar_checklist(novo, d.get("certidoes"))
                    if tn == "locacao":
                        novo["garantia"] = _garantia(body.get("garantia") or {}, d.get("garantia") or {})
                    sb.table("cnd_dossies").update(novo).eq("id", str(d["id"])).execute()
                    did = str(d["id"])
                    virou = novo.get("responsavel_id") and novo["responsavel_id"] != d.get("responsavel_id")
                else:
                    novo["certidoes"] = gerar_checklist(novo, [])
                    if tn == "locacao":
                        novo["garantia"] = _garantia(body.get("garantia") or {}, {})
                    novo["criado_por"] = uid
                    r = sb.table("cnd_dossies").insert(novo).execute().data or []
                    did = str(r[0]["id"]) if r else None
                    virou = bool(novo.get("responsavel_id"))
                # snapshot ANTES/DEPOIS no audit (v84.74): quando o incidente da
                # Leire apagou um caso, o upsert só tinha logado o título — o
                # estado anterior (validades, links de PDF) era irrecuperável.
                # Com o before completo, qualquer estrago futuro tem desfazer.
                audit(self, user, "cnd.dossie_upsert", "cnd_dossies", did, notes=titulo,
                      before=({"partes": d.get("partes"), "certidoes": d.get("certidoes"),
                               "garantia": d.get("garantia")} if body.get("id") and d else None),
                      after={"partes": novo.get("partes"), "certidoes": novo.get("certidoes")})
                # avisa o caso; quem virou responsável precisa saber que caiu no colo dele
                d2 = {**novo, "id": did}
                if virou:
                    _avisar(self, sb, d2, user, "📋 Dossiê de CNDs atribuído",
                            f"{titulo} — {len(novo['certidoes'])} certidão(ões) pra emitir")
                return self._send(200, {"ok": True, "id": did, "certidoes": novo["certidoes"],
                                        "garantia": novo.get("garantia")})

            # ── garantia da locação: definir tipo/detalhe e APROVAR ou REPROVAR ──
            if action == "set_garantia":
                d = dossie(body.get("id"))
                if not d:
                    return self._send(404, {"ok": False, "error": "dossiê não encontrado"})
                if not pode_editar(d, user):
                    return self._send(403, {"ok": False, "error": "sem permissão neste dossiê"})
                if (d.get("tipo_negocio") or "venda") != "locacao":
                    return self._send(400, {"ok": False, "error": "garantia só existe em locação"})
                antiga = d.get("garantia") or {}
                g = _garantia(body.get("garantia") or {}, antiga)
                # aprovar/reprovar é DECISÃO: carimba quem e quando
                if g["status"] in ("aprovada", "reprovada") and g["status"] != antiga.get("status"):
                    g["decidido_por"] = str(user.get("id"))
                    g["decidido_em"] = _now()
                sb.table("cnd_dossies").update({"garantia": g, "atualizado_em": _now()}) \
                    .eq("id", d["id"]).execute()
                audit(self, user, "cnd.garantia", "cnd_dossie", d["id"],
                      before=antiga, after=g)
                if g["status"] != antiga.get("status"):
                    tipo_lbl = (GARANTIAS.get(g.get("tipo")) or {}).get("nome") or "—"
                    _avisar(self, sb, d, user,
                            {"aprovada": "✅ Garantia APROVADA", "reprovada": "❌ Garantia REPROVADA",
                             "pendente_doc": "📄 Garantia PENDENTE DE DOC — falta papel do cliente",
                             "em_analise": "🔎 Garantia em análise"}.get(g["status"], "Garantia atualizada"),
                            f"{d.get('titulo') or 'Locação'} · {tipo_lbl}"
                            + (f" — {g.get('detalhe')}" if g.get("detalhe") else ""))
                return self._send(200, {"ok": True, "garantia": g})

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
                        antes_st, antes_res = cert.get("status"), cert.get("resultado")
                        # DOIS EIXOS SEPARADOS (antes era um só e se atrapalhava):
                        #  status    = andamento da EMISSÃO (aguardando/emitida/
                        #              não emitida/bloqueada)
                        #  resultado = o que a certidão DIZ (positiva/negativa)
                        # 'positiva' não é status: uma certidão emitida pode vir
                        # positiva, e as duas informações precisam coexistir.
                        if body.get("cstatus") in STATUS_CND:
                            cert["status"] = body["cstatus"]
                            cert["emitida_em"] = _now() if body["cstatus"] == "emitida" else None
                            cert["por"] = uid if body["cstatus"] == "emitida" else cert.get("por")
                            if body["cstatus"] != "emitida":
                                cert["resultado"] = None   # não emitida não tem resultado
                        if "resultado" in body:
                            r = body.get("resultado")
                            cert["resultado"] = r if r in RESULTADO_CND else None
                        for k in ("validade", "arquivo_url", "obs", "link"):
                            if k in body:
                                cert[k] = (str(body.get(k) or "").strip()[:1000] or None)
                        novo_st, novo_res = cert.get("status"), cert.get("resultado")
                if not achou:
                    return self._send(404, {"ok": False, "error": "certidão não encontrada no checklist"})
                sb.table("cnd_dossies").update({"certidoes": certs, "atualizado_em": _now()}) \
                    .eq("id", str(d["id"])).execute()
                audit(self, user, "cnd.set_cert", "cnd_dossie", str(d["id"]),
                      notes=f"{alvo}/{tipo}: {antes_st}/{antes_res} → {novo_st}/{novo_res}")
                # avisa só o que muda o jogo: certidão POSITIVA (tem débito!),
                # bloqueada ou não emitida. Emitir negativa é o esperado — não
                # vira sino pra 6 pessoas.
                cert_nome = next((c.get("nome") for c in certs if c.get("alvo") == alvo and c.get("tipo") == tipo), tipo)
                rot = next((c.get("rotulo") for c in certs if c.get("alvo") == alvo and c.get("tipo") == tipo), "")
                if novo_res == "positiva" and antes_res != "positiva":
                    _avisar(self, sb, d, user, "🔴 CND POSITIVA — há débito",
                            f"{d.get('titulo')} · {rot} · {cert_nome}")
                elif novo_st in ("bloqueada", "nao_emitida") and novo_st != antes_st:
                    _avisar(self, sb, d, user,
                            "🚫 Certidão bloqueada" if novo_st == "bloqueada" else "⚠️ Certidão não emitida",
                            f"{d.get('titulo')} · {rot} · {cert_nome}")
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
