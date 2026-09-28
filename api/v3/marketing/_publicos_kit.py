# -*- coding: utf-8 -*-
"""
_publicos_kit — KIT PADRÃO de públicos do Sr. Gestor de Tráfego (v88.98, fase 2 da autonomia).

Pedido do Paulo (28/09): o agente cria público semelhante, morno, quente, personalizado e frio
segmentado sozinho — nos PERÍODOS CERTOS. Criar público não gasta verba; quem gasta é o conjunto
de anúncios que o usa (isso continua na régua do orçamento).

Dois tipos, dois jeitos de manter a janela certa:
  • ENGAJAMENTO / SITE (formulário, IG, página, pixel) — o Meta atualiza sozinho todo dia (janela
    rolante). Basta criar uma vez; o kit só recria se alguém apagar.
  • LISTA DO CRM (quente, compradores, leads recentes, semente qualificada) — é uma foto: o kit
    SUBSTITUI os contatos toda semana (usersreplace), com hash SHA-256 (nada sai sem hash).
  • SEMELHANTE — sempre da SEMENTE QUALIFICADA (DDD 17), nunca de "todos os leads" (copiaria o lead
    de fora de Rio Preto). País BR; o raio de Rio Preto é travado no conjunto, no modo original
    (sem Advantage — regra do Paulo 19/09).

Nome de tudo que o kit cria começa com PREFIXO — é assim que ele reconhece o que é dele e nunca
mexe nos públicos feitos à mão (ex.: exclusão de corretores).
"""
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta

PREFIXO = "[Sr.Tráfego]"
KV_KIT = "gt_publicos_kit"
DIA = 86400
REFRESH_LISTA_DIAS = 7
_RX_FUNDO = re.compile(r"PASTA|APROVA|PROPOSTA|OPORT. DO M|VISITA|VENDA|CARTEIRA")

# marca → frentes do CRM que alimentam as listas dela
FRENTES_MARCA = {"conquista": ("conquista",), "imoveis": ("map", "terceiros")}

# (chave, temperatura, rótulo, tipo_fonte, evento, dias)
#   tipo_fonte: lead (formulário da página) | ig_business | page | pixel
ENGAJAMENTO = [
    ("form_abriu_30",  "quente", "Abriu formulário · 30d",          "lead",        "lead_generation_opened",    30),
    ("form_enviou_90", "quente", "Enviou formulário · 90d",         "lead",        "lead_generation_submitted", 90),
    ("ig_msg_30",      "quente", "Mandou direct no IG · 30d",       "ig_business", "ig_user_messaged_business", 30),
    ("pag_msg_30",     "quente", "Mandou mensagem na página · 30d", "page",        "page_messaged",             30),
    ("lp_14",          "quente", "Visitou a LP · 14d",              "pixel",       "PageView",                  14),
    ("ig_eng_90",      "morno",  "Engajou no IG · 90d",             "ig_business", "ig_business_profile_all",   90),
    ("ig_eng_180",     "morno",  "Engajou no IG · 180d",            "ig_business", "ig_business_profile_all",   180),
    ("pag_eng_90",     "morno",  "Engajou na página · 90d",         "page",        "page_engaged",              90),
    ("lp_90",          "morno",  "Visitou a LP · 90d",              "pixel",       "PageView",                  90),
]

# listas do CRM (fotos semanais)
LISTAS = [
    ("crm_quente",   "quente",   "CRM quente (fundo de funil + vendas)"),
    ("semente_17",   "semente",  "Semente qualificada DDD 17 (chegou a visita/proposta ou comprou)"),
    ("excl_compr",   "exclusao", "EXCLUIR · já compraram"),
    ("excl_leads30", "exclusao", "EXCLUIR · lead dos últimos 30d (campanha fria)"),
]

# semelhantes (semente → ratio)
# (chave, temp, rótulo, início, fim) — faixas que NÃO se sobrepõem (0–1% e 1–3%); o Meta recusa
# "semelhante duplicado" quando duas começam do zero com a mesma origem.
SEMELHANTES = [("lal_1", "semelhante", "Semelhante 0–1% da semente DDD 17", 0.0, 0.01),
               ("lal_3", "semelhante", "Semelhante 1–3% da semente DDD 17", 0.01, 0.03)]


def nome_publico(marca, rotulo):
    return f"{PREFIXO} {'Conquista' if marca == 'conquista' else 'Imóveis'} · {rotulo}"[:120]


def regra_engajamento(tipo, fonte_id, evento, dias):
    filtro = {"field": "event", "operator": "eq", "value": evento}
    return {"inclusions": {"operator": "or", "rules": [{
        "event_sources": [{"id": str(fonte_id), "type": tipo}],
        "retention_seconds": int(dias) * DIA,
        "filter": {"operator": "and", "filters": [filtro]},
    }]}}


def _sha(v):
    return hashlib.sha256(v.encode("utf-8")).hexdigest()


def _contatos(contacts):
    fones, emails = [], []
    for c in contacts or []:
        for p in (c.get("phones") or []):
            dig = re.sub(r"\D", "", str(p.get("phone") or ""))
            if len(dig) >= 10:
                fones.append(dig if dig.startswith("55") else "55" + dig)
        for e in (c.get("emails") or []):
            em = str(e.get("email") or "").strip().lower()
            if "@" in em:
                emails.append(em)
    return fones, emails


def varrer_crm(sb, frente_of, agora=None, max_pag=40):
    """UMA passada nos deals → {marca: {lista: [[PHONE_SHA256, EMAIL_SHA256], ...]}}.
    Só puxa rd_raw->contacts (não o rd_raw inteiro) pra caber no tempo da função."""
    agora = agora or datetime.now(timezone.utc)
    marca_da_frente = {f: m for m, fs in FRENTES_MARCA.items() for f in fs}
    out = {m: {k: {} for k, _t, _r in LISTAS} for m in FRENTES_MARCA}
    pg = 0
    while pg < max_pag:
        rows = (sb.table("deals")
                .select("id,win,pipeline_name,stage_name,created_at_rd,contacts:rd_raw->contacts")
                .order("id").range(pg * 1000, pg * 1000 + 999).execute().data or [])
        if not rows:
            break
        for d in rows:
            marca = marca_da_frente.get(frente_of(d.get("pipeline_name")))
            if not marca:
                continue
            fones, emails = _contatos(d.get("contacts"))
            if not fones and not emails:
                continue
            f, e = (fones[0] if fones else ""), (emails[0] if emails else "")
            chave = f or e
            linha = [_sha(f) if f else "", _sha(e) if e else ""]
            ganho = d.get("win") is True
            no_fundo = bool(_RX_FUNDO.search((d.get("stage_name") or "").upper()))
            fundo = d.get("win") is None and no_fundo
            listas = out[marca]
            if ganho or fundo:
                listas["crm_quente"][chave] = linha
            # semente = quem virou comprador QUALIFICADO: vendeu ou chegou a visita/aprovação/proposta,
            # mesmo que depois tenha perdido (o perdido fica na etapa em que caiu). Sem isso a semente
            # da Conquista não chegava aos 100 que o Meta pede pro semelhante.
            if (ganho or no_fundo) and f[2:4] == "17":
                listas["semente_17"][chave] = linha
            if ganho:
                listas["excl_compr"][chave] = linha
            try:
                cri = datetime.fromisoformat(str(d.get("created_at_rd")).replace("Z", "+00:00"))
                if (agora - cri).days <= 30:
                    listas["excl_leads30"][chave] = linha
            except Exception:
                pass
        pg += 1
    return {m: {k: list(v.values()) for k, v in ls.items()} for m, ls in out.items()}


def descobrir_fontes(graph, act, token):
    """Página, IG e pixel que a conta usa (dos criativos dos anúncios + pixels da conta)."""
    fontes = {"page": None, "ig_business": None, "pixel": None, "obs": []}
    ok, data = graph("GET", f"{act}/ads", {
        "fields": "creative{actor_id,instagram_user_id,object_story_spec}",
        "limit": 50, "effective_status": json.dumps(["ACTIVE", "PAUSED"])}, token)
    pags, igs = {}, {}
    if ok:
        for ad in data.get("data") or []:
            cr = ad.get("creative") or {}
            oss = cr.get("object_story_spec") or {}
            p = oss.get("page_id") or cr.get("actor_id")
            ig = cr.get("instagram_user_id") or oss.get("instagram_user_id") or oss.get("instagram_actor_id")
            if p:
                pags[str(p)] = pags.get(str(p), 0) + 1
            if ig:
                igs[str(ig)] = igs.get(str(ig), 0) + 1
    else:
        fontes["obs"].append(f"anúncios: {data}")
    if pags:
        fontes["page"] = max(pags, key=pags.get)
    if igs:
        fontes["ig_business"] = max(igs, key=igs.get)
    okp, px = graph("GET", f"{act}/adspixels", {"fields": "id,name,last_fired_time,is_unavailable"}, token)
    if okp:
        vivos = [p for p in (px.get("data") or []) if p.get("last_fired_time") and not p.get("is_unavailable")]
        vivos.sort(key=lambda p: p.get("last_fired_time") or "", reverse=True)
        if vivos:
            fontes["pixel"] = vivos[0]["id"]
            fontes["pixel_nome"] = vivos[0].get("name")
            fontes["pixel_ultimo_disparo"] = vivos[0].get("last_fired_time")
    else:
        fontes["obs"].append(f"pixels: {px}")
    return fontes


def _existentes(graph, act, token):
    ok, data = graph("GET", f"{act}/customaudiences",
                     {"fields": "id,name,approximate_count_lower_bound,delivery_status", "limit": 200}, token)
    if not ok:
        return None, data
    return {a.get("name"): a for a in (data.get("data") or []) if str(a.get("name") or "").startswith(PREFIXO)}, None


def _subir(graph, aud_id, linhas, token, substituir):
    """Sobe/substitui os contatos em lotes de 5.000 (sessão única do Meta)."""
    if not linhas:
        return True, 0
    import random
    sessao = random.randint(10 ** 9, 2 ** 31 - 1)
    lotes = [linhas[i:i + 5000] for i in range(0, len(linhas), 5000)]
    edge = "usersreplace" if substituir else "users"
    for n, lote in enumerate(lotes, 1):
        params = {"payload": json.dumps({"schema": ["PHONE_SHA256", "EMAIL_SHA256"], "data": lote})}
        if substituir:
            params["session"] = json.dumps({"session_id": sessao, "batch_seq": n,
                                            "last_batch_flag": n == len(lotes),
                                            "estimated_num_total": len(linhas)})
        ok, r = graph("POST", f"{aud_id}/{edge}", params, token)
        if not ok:
            return False, f"lote {n}: {r}"
    return True, len(linhas)


def manter_kit(sb, graph, contas_marca, token_de, frente_of, simular=False, agora=None, crm=None):
    """Cria o que falta e atualiza as listas vencidas. Idempotente.
    contas_marca: {marca: act_id}. token_de(act) → token. Devolve (estado, relatorio[])."""
    agora = agora or datetime.now(timezone.utc)
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KIT).limit(1).execute().data or []
        estado = rows[0]["value"] if rows and isinstance(rows[0]["value"], dict) else {}
    except Exception:
        estado = {}
    rel = []

    def reg(marca, chave, acao, detalhe, ok=True, extra=None):
        rel.append({"marca": marca, "chave": chave, "acao": acao, "ok": ok, "detalhe": str(detalhe)[:300]})
        if not simular:
            e = estado.setdefault(marca, {}).setdefault(chave, {})
            e.update({"ult_acao": acao, "ok": ok, "detalhe": str(detalhe)[:300], "ts": agora.isoformat()})
            if extra:
                e.update(extra)

    for marca, act in contas_marca.items():
        token = token_de(act)
        exist, erro = _existentes(graph, act, token)
        if exist is None:
            reg(marca, "_conta", "erro", f"não consegui listar os públicos: {erro}", False)
            continue
        fontes = descobrir_fontes(graph, act, token)
        estado.setdefault(marca, {})["_fontes"] = {k: v for k, v in fontes.items() if k != "obs"}

        # 1) engajamento / site — cria uma vez, o Meta rola a janela sozinho
        for chave, temp, rotulo, tipo, evento, dias in ENGAJAMENTO:
            nome = nome_publico(marca, rotulo)
            if nome in exist:
                reg(marca, chave, "ok", "já existe (janela rolante)", extra={"id": exist[nome]["id"], "nome": nome,
                    "tamanho": exist[nome].get("approximate_count_lower_bound"), "temp": temp})
                continue
            fonte = fontes.get(tipo if tipo != "lead" else "page")
            if not fonte:
                reg(marca, chave, "pulado", f"sem {'pixel ativo' if tipo == 'pixel' else tipo} nesta conta", False,
                    extra={"nome": nome, "temp": temp})
                continue
            if simular:
                reg(marca, chave, "criaria", f"{rotulo} (fonte {tipo} {fonte})")
                continue
            ok, data = graph("POST", f"{act}/customaudiences", {
                "name": nome, "prefill": "true",
                "description": f"Kit do Sr. Tráfego · {temp} · janela {dias}d rolante",
                "rule": json.dumps(regra_engajamento(tipo, fonte, evento, dias)),
            }, token)
            reg(marca, chave, "criado" if ok else "erro", data.get("id") if ok else data, ok,
                extra={"id": data.get("id") if ok else None, "nome": nome, "temp": temp})

        # 2) listas do CRM — foto semanal
        crm_marca = (crm or {}).get(marca) or {}
        for chave, temp, rotulo in LISTAS:
            nome = nome_publico(marca, rotulo)
            linhas = crm_marca.get(chave) or []
            ant = (estado.get(marca) or {}).get(chave) or {}
            try:
                idade = (agora - datetime.fromisoformat(ant.get("atualizado_em"))).days
            except Exception:
                idade = 999
            if nome in exist and idade < REFRESH_LISTA_DIAS:
                reg(marca, chave, "ok", f"atualizada há {idade}d", extra={"id": exist[nome]["id"], "nome": nome,
                    "tamanho": exist[nome].get("approximate_count_lower_bound"), "temp": temp})
                continue
            if crm is None:
                reg(marca, chave, "pendente", "lista vence nesta rodada — CRM não foi varrido")
                continue
            if len(linhas) < 20:
                reg(marca, chave, "pulado", f"só {len(linhas)} contatos (mínimo 20)", False, extra={"nome": nome, "temp": temp})
                continue
            if simular:
                reg(marca, chave, "criaria" if nome not in exist else "atualizaria", f"{len(linhas)} contatos")
                continue
            aud_id = (exist.get(nome) or {}).get("id")
            novo = not aud_id
            if novo:
                ok, data = graph("POST", f"{act}/customaudiences", {
                    "name": nome, "subtype": "CUSTOM", "customer_file_source": "USER_PROVIDED_ONLY",
                    "description": f"Kit do Sr. Tráfego · {temp} · lista do CRM atualizada toda semana"}, token)
                if not ok:
                    reg(marca, chave, "erro", data, False, extra={"nome": nome, "temp": temp})
                    continue
                aud_id = data.get("id")
                exist[nome] = {"id": aud_id}
                ok2, r2 = _subir(graph, aud_id, linhas, token, substituir=False)
            else:
                ok2, r2 = _subir(graph, aud_id, linhas, token, substituir=True)
            reg(marca, chave, ("criado" if novo else "atualizado") if ok2 else "erro",
                f"{r2} contatos" if ok2 else r2, ok2,
                extra={"id": aud_id, "nome": nome, "temp": temp, "contatos": len(linhas),
                       **({"atualizado_em": agora.isoformat()} if ok2 else {})})

        # 3) semelhantes — da semente qualificada
        semente = (estado.get(marca) or {}).get("semente_17") or {}
        for chave, temp, rotulo, inicio, ratio in SEMELHANTES:
            nome = nome_publico(marca, rotulo)
            if chave == "lal_1":   # o 0–1% já nasceu com o nome antigo em 28/09 — reconhece os dois
                antigo = nome_publico(marca, "Semelhante 1% da semente DDD 17")
                if antigo in exist:
                    nome = antigo
            if nome in exist:
                reg(marca, chave, "ok", "já existe (o Meta renova a partir da semente)",
                    extra={"id": exist[nome]["id"], "nome": nome, "temp": temp})
                continue
            if not semente.get("id"):
                reg(marca, chave, "pendente", "aguardando a semente DDD 17", extra={"nome": nome, "temp": temp})
                continue
            if simular:
                reg(marca, chave, "criaria", f"{int(inicio * 100)}–{int(ratio * 100)}% BR da semente {semente.get('id')}")
                continue
            ok, data = graph("POST", f"{act}/customaudiences", {
                "name": nome, "subtype": "LOOKALIKE", "origin_audience_id": semente["id"],
                "lookalike_spec": json.dumps({"type": "similarity", "country": "BR", "ratio": ratio,
                                              **({"starting_ratio": inicio} if inicio else {})}),
            }, token)
            # semente recém-subida ainda não pareou → o Meta recusa; tenta de novo na próxima rodada
            reg(marca, chave, "criado" if ok else "pendente", data.get("id") if ok else data, ok,
                extra={"id": data.get("id") if ok else None, "nome": nome, "temp": temp})

    if not simular:
        estado["_ultima_rodada"] = agora.isoformat()
        try:
            sb.table("shared_kv").upsert({"key": KV_KIT, "value": estado,
                                          "updated_at": agora.isoformat()}, on_conflict="key").execute()
        except Exception:
            pass
    return estado, rel
