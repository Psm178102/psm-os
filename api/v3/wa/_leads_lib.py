# -*- coding: utf-8 -*-
"""
_leads_lib — a mensagem no WhatsApp vira card com dono. v88.9

O que ele resolve: hoje quatro tipos de lead (comprar, captação, locação e
primeiro imóvel) caem no MESMO número da Vera e morrem no aplicativo. Aqui cada
primeira mensagem de um número novo vira:
  1. trilha       — pela frase de origem (o link do anúncio já vem etiquetado);
  2. dono         — a roleta escolhe o corretor daquela trilha;
  3. card no RD   — contato + deal na etapa de entrada, já com o dono;
  4. espelho      — a mesma linha em `deals`, para o card aparecer no kanban do
                    House na hora, sem esperar o sync;
  5. aviso        — notificação + push para o corretor, nunca broadcast.

A IA que responde (nativa do Meta no app, ou a nossa) é indiferente para este
arquivo: o gatilho é a mensagem do cliente chegando pelo webhook da Cloud API.
Trocar o cérebro depois não mexe no CRM.

Config em shared_kv (sem migração), editável em /api/v3/wa/roleta:
  wa_roleta_config = CFG_DEFAULT abaixo
  wa_roleta_state  = { "<trilha>": {"idx": n, "ultimo": iso} }   (modo rodízio)

PORTÃO: cfg["ativo"] nasce False. Enquanto ninguém ligar, o webhook só registra
o lead local — nada é criado no RD e ninguém é notificado.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import notify, send_web_push  # type: ignore
from _wa_lib import normalize_phone  # type: ignore

KV_CFG = "wa_roleta_config"
KV_STATE = "wa_roleta_state"
KV_RDUSERS = "wa_rd_users"          # cache email → user_id do RD (24h)
RD_BASE = "https://crm.rdstation.com/api/v1"
BRT = timezone(timedelta(hours=-3))
HTTP_TIMEOUT = 6                    # o webhook da Meta re-tenta: melhor falhar rápido
HIST_MAX = 30                       # mensagens guardadas por lead

TRILHAS = ("comprar", "captacao", "locacao", "conquista")
LABEL = {
    "comprar": "Comprar",
    "captacao": "Captação",
    "locacao": "Locação",
    "conquista": "Conquista · primeiro imóvel",
    "indefinido": "A classificar",
}

CFG_DEFAULT = {
    "ativo": False,                  # portão do sócio
    "trilhas": {t: [] for t in TRILHAS},      # user_ids do House, na ordem da fila
    "rd_stage": {t: "" for t in TRILHAS},     # etapa de entrada no RD por trilha
    "rd_source_id": "",               # origem do deal no RD (opcional)
    "modo": "carga",                  # carga = menor número de leads hoje · rodizio = fila circular
    "horario": {"ini": "08:30", "fim": "18:30", "dias": [0, 1, 2, 3, 4, 5]},
    "fora_horario": "fila",           # fila = guarda e distribui na abertura · distribui = manda assim mesmo
    "dedupe_dias": 30,                # mesmo número dentro da janela não abre lead novo
    "sla_min": 15,                    # aviso ao gestor se ninguém assumir
    "repique_auto": False,            # passar para o próximo da fila quando estourar o SLA
    "repique_max": 2,
    "fallback": [],                   # quem recebe quando a fila da trilha está vazia ([] = gerentes + sócios)
}

# Ordem importa: "vender meu imóvel" também contém "imóvel".
REGRAS = (
    # "minha casa" sozinho é do dono que quer VENDER ("quanto vale minha casa") —
    # o programa só conta com o nome inteiro ou com "programa" na frente.
    ("conquista", r"primeiro\s+im[oó]vel|\bmcmv\b|minha\s+casa\s+minha\s+vida|"
                  r"programa\s+minha\s+casa|casa\s+verde|financiamento\s+popular|"
                  r"subs[ií]dio|\bfgts\b"),
    ("captacao", r"\bvender\b|\bvenda\b|avaliar|avalia[cç][aã]o|quanto\s+vale|anunciar\s+meu|colocar\s+.{0,12}venda"),
    ("locacao", r"\balugar\b|aluguel|loca[cç][aã]o|\blocar\b|inquilin"),
    ("comprar", r"lan[cç]amento|comprar|compra\b|apartamento|\bcasa\b|terreno|\bplaca\b|quero\s+saber|im[oó]vel"),
)


# ─── kv ───────────────────────────────────────────────────────────────────
def kv_get(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        return rows[0]["value"] if rows else (default if default is not None else {})
    except Exception:
        return default if default is not None else {}


def kv_set(sb, key, value):
    try:
        sb.table("shared_kv").upsert({"key": key, "value": value,
                                      "updated_at": datetime.now(timezone.utc).isoformat()},
                                     on_conflict="key").execute()
        return True
    except Exception:
        return False


def get_cfg(sb):
    cfg = json.loads(json.dumps(CFG_DEFAULT))       # cópia profunda
    salvo = kv_get(sb, KV_CFG, {})
    if isinstance(salvo, dict):
        for k, v in salvo.items():
            if v is None:
                continue
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


def log(sb, ok, acao, motivo=None, phone=None, lead_id=None):
    try:
        sb.table("wa_leads_log").insert({
            "ok": bool(ok), "acao": (acao or "")[:40],
            "motivo": (motivo or "")[:200] or None,
            "wa_phone": (phone or "")[:20] or None, "lead_id": lead_id}).execute()
    except Exception:
        pass


# ─── classificação ────────────────────────────────────────────────────────
def classificar(texto):
    """Trilha pela frase de origem. 'indefinido' quando a mensagem não diz nada
    (orgânico, 'oi') — esse lead espera a pergunta de triagem, não vai pro RD."""
    t = (texto or "").strip().lower()
    if not t:
        return "indefinido"
    for trilha, rx in REGRAS:
        if re.search(rx, t):
            return trilha
    return "indefinido"


def horario_comercial(cfg, agora=None):
    now = agora or datetime.now(BRT)
    h = cfg.get("horario") or {}
    if now.weekday() not in (h.get("dias") or [0, 1, 2, 3, 4, 5]):
        return False
    hm = now.strftime("%H:%M")
    return (h.get("ini") or "08:30") <= hm < (h.get("fim") or "18:30")


# ─── roleta ───────────────────────────────────────────────────────────────
def _users_ativos(sb):
    try:
        rows = sb.table("users").select("id,name,email,role,status").execute().data or []
    except Exception:
        return {}
    return {u["id"]: u for u in rows if u.get("id") and (u.get("status") or "ativo") == "ativo"}


def _fallback_ids(sb, cfg):
    ids = [i for i in (cfg.get("fallback") or []) if i]
    if ids:
        return ids
    return [u["id"] for u in _users_ativos(sb).values()
            if (u.get("role") or "").startswith("gerente") or (u.get("role") or "") == "socio"]


def _carga_hoje(sb, ids):
    """Quantos leads cada um da fila recebeu hoje — é o que torna a escolha justa
    e imune a corrida entre duas execuções simultâneas do webhook."""
    zero = {i: 0 for i in ids}
    if not ids:
        return zero
    try:
        desde = datetime.now(BRT).replace(hour=0, minute=0, second=0, microsecond=0)
        rows = (sb.table("wa_leads").select("corretor_id")
                .gte("distribuido_em", desde.astimezone(timezone.utc).isoformat())
                .in_("corretor_id", ids).limit(500).execute().data or [])
        for r in rows:
            cid = r.get("corretor_id")
            if cid in zero:
                zero[cid] += 1
    except Exception:
        pass
    return zero


def escolher_corretor(sb, cfg, trilha):
    """Devolve (user_id, motivo). None = ninguém elegível; quem avisa é o chamador."""
    fila = [i for i in ((cfg.get("trilhas") or {}).get(trilha) or []) if i]
    ativos = _users_ativos(sb)
    fila = [i for i in fila if i in ativos]
    if not fila:
        return None, "fila da trilha vazia (ou todos inativos)"

    if (cfg.get("modo") or "carga") == "rodizio":
        st = kv_get(sb, KV_STATE, {}) or {}
        idx = int(((st.get(trilha) or {}).get("idx", -1)))
        prox = (idx + 1) % len(fila)
        st[trilha] = {"idx": prox, "ultimo": datetime.now(timezone.utc).isoformat()}
        kv_set(sb, KV_STATE, st)
        return fila[prox], "rodízio"

    carga = _carga_hoje(sb, fila)
    escolhido = sorted(fila, key=lambda i: (carga.get(i, 0), fila.index(i)))[0]
    return escolhido, f"menor carga hoje ({carga.get(escolhido, 0)})"


# ─── RD Station CRM ───────────────────────────────────────────────────────
def _rd_token():
    return (os.environ.get("RD_CRM_TOKEN") or os.environ.get("RD_API_TOKEN") or "").strip()


def _rd(path, method="GET", payload=None):
    tok = _rd_token()
    if not tok:
        return None, "RD_CRM_TOKEN não configurado"
    sep = "&" if "?" in path else "?"
    url = f"{RD_BASE}{path}{sep}token={urllib.parse.quote(tok)}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8") or "{}"), None
    except urllib.error.HTTPError as e:
        try:
            corpo = e.read().decode("utf-8")[:200]
        except Exception:
            corpo = ""
        return None, f"RD {e.code}: {corpo}"
    except Exception as e:
        return None, f"RD: {str(e)[:150]}"


def rd_user_id(sb, email):
    """id do usuário no RD a partir do e-mail do House. Cache de 24h em kv —
    sem isso o deal nasce sem dono e o corretor não vê nada no funil dele."""
    email = (email or "").strip().lower()
    if not email:
        return None
    cache = kv_get(sb, KV_RDUSERS, {}) or {}
    ts = cache.get("_ts") or ""
    fresco = False
    try:
        fresco = (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds() < 86400
    except Exception:
        fresco = False
    if fresco and email in cache:
        return cache.get(email)
    data, err = _rd("/users", "GET")
    if err or not isinstance(data, (list, dict)):
        return cache.get(email)
    users = data if isinstance(data, list) else (data.get("users") or [])
    novo = {"_ts": datetime.now(timezone.utc).isoformat()}
    for u in users:
        e = (u.get("email") or "").strip().lower()
        if e:
            novo[e] = u.get("id")
    kv_set(sb, KV_RDUSERS, novo)
    return novo.get(email)


def rd_deal_aberto_do_telefone(phone):
    """(deal, None) se esse telefone JÁ é de alguém no RD com negócio aberto.
    Cliente que volta não pode entrar na roleta — seria roubar o card do dono."""
    data, err = _rd(f"/contacts?q={urllib.parse.quote(phone[-11:])}", "GET")
    if err:
        return None, err
    contatos = (data or {}).get("contacts") or []
    if not contatos:
        return None, None
    cid = contatos[0].get("id")
    if not cid:
        return None, None
    data2, err2 = _rd(f"/deals?contact_id={urllib.parse.quote(str(cid))}", "GET")
    if err2:
        return None, err2
    for d in ((data2 or {}).get("deals") or []):
        if not d.get("closed_at") and d.get("win") is None:
            return d, None
    return None, None


def criar_deal_rd(sb, cfg, trilha, nome, phone, corretor_email):
    """Cria contato + deal na etapa de entrada da trilha, já com dono."""
    stage = ((cfg.get("rd_stage") or {}).get(trilha) or "").strip()
    if not stage:
        return None, f"etapa de entrada da trilha '{trilha}' não configurada"
    deal = {"name": f"{nome or 'Lead WhatsApp'} · {LABEL.get(trilha, trilha)}",
            "deal_stage_id": stage}
    uid = rd_user_id(sb, corretor_email)
    if uid:
        deal["user_id"] = uid
    if (cfg.get("rd_source_id") or "").strip():
        deal["deal_source_id"] = cfg["rd_source_id"].strip()
    payload = {
        "deal": deal,
        "contacts": [{"name": nome or f"WhatsApp {phone[-4:]}",
                      "phones": [{"phone": "+" + phone, "type": "cellphone"}]}],
    }
    data, err = _rd("/deals", "POST", payload)
    if err:
        return None, err
    return data or {}, None


def espelhar_deal(sb, deal_raw, corretor_id, corretor_email, trilha, cfg):
    """Mesma linha que o sync escreveria (crm/sync._deal_to_row) — o card aparece
    no kanban do House na hora, e o próximo sync faz upsert por id sem duplicar."""
    if not (deal_raw or {}).get("id"):
        return False
    stage = deal_raw.get("deal_stage") or {}
    pipe = deal_raw.get("deal_pipeline") or {}
    row = {
        "id": deal_raw.get("id"),
        "name": (deal_raw.get("name") or "")[:255],
        "win": deal_raw.get("win"),
        "created_at_rd": deal_raw.get("created_at"),
        "updated_at_rd": deal_raw.get("updated_at"),
        "pipeline_id": pipe.get("id") if isinstance(pipe, dict) else None,
        "pipeline_name": (pipe.get("name") if isinstance(pipe, dict) else None) or None,
        "stage_id": (stage.get("id") if isinstance(stage, dict) else None)
                    or ((cfg.get("rd_stage") or {}).get(trilha) or None),
        "stage_name": (stage.get("name") if isinstance(stage, dict) else None) or None,
        "user_email": (corretor_email or "").lower() or None,
        "user_id": corretor_id,
        "rd_raw": deal_raw,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        sb.table("deals").upsert(row, on_conflict="id").execute()
        return True
    except Exception:
        return False


# ─── entrada: uma mensagem do cliente ─────────────────────────────────────
def processar_mensagem(sb, phone_raw, texto, msg_id=None, perfil_nome=None):
    """Chamado pelo webhook a cada mensagem recebida. Idempotente por wa_msg_id.
    Nunca levanta exceção: o webhook precisa responder 200 para a Meta."""
    out = {"acao": None, "trilha": None, "lead_id": None}
    phone = normalize_phone(phone_raw)
    if not phone:
        return {"acao": "ignorado", "motivo": "telefone inválido"}
    cfg = get_cfg(sb)
    agora = datetime.now(timezone.utc)

    # idempotência: a Meta reenvia o mesmo evento quando o 200 demora
    if msg_id:
        try:
            ja = (sb.table("wa_leads").select("id").eq("wa_msg_id", msg_id)
                  .limit(1).execute().data or [])
            if ja:
                return {"acao": "duplicado", "motivo": "msg_id repetido", "lead_id": ja[0]["id"]}
        except Exception:
            pass

    trilha = classificar(texto)
    out["trilha"] = trilha

    # conversa já aberta: anexa a mensagem e sai (inclusive para reclassificar)
    try:
        desde = (agora - timedelta(days=int(cfg.get("dedupe_dias") or 30))).isoformat()
        anteriores = (sb.table("wa_leads")
                      .select("id,trilha,status,historico,corretor_id")
                      .eq("wa_phone", phone).gte("created_at", desde)
                      .order("created_at", desc=True).limit(1).execute().data or [])
    except Exception:
        anteriores = []
    if anteriores:
        lead = anteriores[0]
        hist = (lead.get("historico") or [])[-(HIST_MAX - 1):]
        hist.append({"ts": agora.isoformat(), "de": "cliente", "txt": (texto or "")[:400]})
        upd = {"historico": hist, "updated_at": agora.isoformat()}
        # lead que entrou sem trilha e agora se revelou: classifica e distribui
        virou = lead.get("trilha") == "indefinido" and trilha != "indefinido"
        if virou:
            upd["trilha"] = trilha
        try:
            sb.table("wa_leads").update(upd).eq("id", lead["id"]).execute()
        except Exception:
            pass
        if virou and lead.get("status") == "novo":
            distribuir(sb, lead["id"], cfg=cfg)
            return {"acao": "classificado", "trilha": trilha, "lead_id": lead["id"]}
        return {"acao": "anexado", "trilha": lead.get("trilha"), "lead_id": lead["id"]}

    # cliente antigo com negócio aberto: avisa o dono, não entra na roleta
    dono_atual = None
    if cfg.get("ativo") and _rd_token():
        deal_aberto, _ = rd_deal_aberto_do_telefone(phone)
        if deal_aberto:
            dono_atual = ((deal_aberto.get("user") or {}) or {}).get("email")

    row = {
        "wa_phone": phone,
        "wa_msg_id": msg_id or None,
        "nome": (perfil_nome or "")[:160] or None,
        "trilha": trilha,
        "primeira_msg": (texto or "")[:400] or None,
        "status": "duplicado" if dono_atual else "novo",
        "historico": [{"ts": agora.isoformat(), "de": "cliente", "txt": (texto or "")[:400]}],
    }
    try:
        novo = sb.table("wa_leads").insert(row).execute().data or []
        lead_id = novo[0]["id"] if novo else None
    except Exception as e:
        msg = str(e)
        if "23505" in msg or "duplicate" in msg.lower():
            return {"acao": "duplicado", "motivo": "corrida de retry"}
        log(sb, False, "erro_insert", msg[:150], phone)
        return {"acao": "erro", "motivo": msg[:150]}
    out["lead_id"] = lead_id

    if dono_atual:
        log(sb, True, "duplicado", f"já é cliente de {dono_atual}", phone, lead_id)
        _avisar_dono_antigo(sb, dono_atual, row["nome"], phone, lead_id)
        out["acao"] = "cliente_existente"
        return out

    if not cfg.get("ativo"):
        log(sb, True, "so_registrado", "roleta desligada (cfg.ativo=false)", phone, lead_id)
        out["acao"] = "registrado"
        return out

    if trilha == "indefinido":
        log(sb, True, "sem_trilha", "aguardando a pergunta de triagem", phone, lead_id)
        out["acao"] = "aguardando_triagem"
        return out

    if not horario_comercial(cfg) and (cfg.get("fora_horario") or "fila") == "fila":
        log(sb, True, "na_fila", "fora do horário — distribui na abertura", phone, lead_id)
        out["acao"] = "na_fila"
        return out

    d = distribuir(sb, lead_id, cfg=cfg)
    out["acao"] = d.get("acao")
    out["corretor_id"] = d.get("corretor_id")
    return out


def _avisar_dono_antigo(sb, email, nome, phone, lead_id):
    try:
        alvo = [u["id"] for u in _users_ativos(sb).values()
                if (u.get("email") or "").lower() == (email or "").lower()]
        if not alvo:
            return
        titulo = f"💬 {nome or 'Seu cliente'} chamou no WhatsApp"
        corpo = f"wa.me/{phone} — já é seu no RD, não entrou na roleta."
        notify(alvo, "wa_lead", titulo, corpo, link="#/crm-house",
               target_type="wa_lead", target_id=str(lead_id))
        send_web_push(alvo, titulo, corpo, link="#/crm-house", tag="wa_lead")
    except Exception:
        pass


# ─── distribuição ─────────────────────────────────────────────────────────
def distribuir(sb, lead_id, cfg=None, excluir=None):
    """Escolhe o dono, cria o card no RD, espelha no House e avisa. Idempotente:
    lead que já tem rd_deal_id não é criado de novo (só reatribuído)."""
    cfg = cfg or get_cfg(sb)
    try:
        rows = (sb.table("wa_leads").select("*").eq("id", lead_id).limit(1).execute().data or [])
    except Exception as e:
        return {"acao": "erro", "motivo": str(e)[:150]}
    if not rows:
        return {"acao": "erro", "motivo": "lead não encontrado"}
    lead = rows[0]
    trilha = lead.get("trilha") or "indefinido"
    if trilha == "indefinido":
        return {"acao": "aguardando_triagem"}

    corretor_id, motivo = escolher_corretor(sb, cfg, trilha)
    if excluir and corretor_id == excluir:
        fila = [i for i in ((cfg.get("trilhas") or {}).get(trilha) or []) if i and i != excluir]
        corretor_id = fila[0] if fila else None
        motivo = "repique"
    ativos = _users_ativos(sb)
    corretor = ativos.get(corretor_id) if corretor_id else None

    agora = datetime.now(timezone.utc).isoformat()
    upd = {"status": "distribuido", "distribuido_em": agora, "updated_at": agora,
           "corretor_id": corretor_id}

    deal_id = lead.get("rd_deal_id")
    erro = None
    if not deal_id:
        deal, erro = criar_deal_rd(sb, cfg, trilha, lead.get("nome"), lead.get("wa_phone"),
                                   (corretor or {}).get("email"))
        if deal and deal.get("id"):
            deal_id = deal.get("id")
            upd["rd_deal_id"] = deal_id
            cont = (deal.get("contacts") or [{}])
            upd["rd_contact_id"] = (cont[0] or {}).get("id") if cont else None
            espelhar_deal(sb, deal, corretor_id, (corretor or {}).get("email"), trilha, cfg)
        else:
            upd["erro"] = (erro or "falha ao criar no RD")[:200]
    if erro:
        log(sb, False, "erro_rd", erro, lead.get("wa_phone"), lead_id)

    try:
        sb.table("wa_leads").update(upd).eq("id", lead_id).execute()
    except Exception:
        pass

    alvo = [corretor_id] if corretor_id else _fallback_ids(sb, cfg)
    nome = lead.get("nome") or "Lead novo"
    titulo = f"📲 {LABEL.get(trilha, trilha)}: {nome}"
    corpo = (f"wa.me/{lead.get('wa_phone')} · \"{(lead.get('primeira_msg') or '')[:60]}\" · "
             f"responda em até {cfg.get('sla_min', 15)}min")
    if not corretor_id:
        corpo = f"SEM DONO ({motivo}) — {corpo}"
    try:
        notify(alvo, "wa_lead", titulo, corpo, link="#/crm-house",
               target_type="wa_lead", target_id=str(lead_id))
        send_web_push(alvo, titulo, corpo, link="#/crm-house", tag="wa_lead")
    except Exception:
        pass
    log(sb, bool(corretor_id), "distribuido" if corretor_id else "sem_dono", motivo,
        lead.get("wa_phone"), lead_id)
    return {"acao": "distribuido" if corretor_id else "sem_dono",
            "corretor_id": corretor_id, "motivo": motivo, "rd_deal_id": deal_id, "erro": erro}


def assumir(sb, lead_id, user_id):
    agora = datetime.now(timezone.utc).isoformat()
    try:
        sb.table("wa_leads").update({"status": "assumido", "assumido_em": agora,
                                     "corretor_id": user_id, "updated_at": agora}
                                    ).eq("id", lead_id).execute()
        return True
    except Exception:
        return False


def varrer(sb):
    """Cron: (1) distribui o que ficou na fila da noite, (2) cobra quem não
    assumiu dentro do SLA — e repica para o próximo se o sócio tiver ligado."""
    cfg = get_cfg(sb)
    res = {"distribuidos": 0, "cobrados": 0, "repicados": 0}
    if not cfg.get("ativo"):
        return res
    agora = datetime.now(timezone.utc)

    if horario_comercial(cfg):
        try:
            fila = (sb.table("wa_leads").select("id")
                    .eq("status", "novo").neq("trilha", "indefinido")
                    .order("created_at").limit(50).execute().data or [])
        except Exception:
            fila = []
        for l in fila:
            distribuir(sb, l["id"], cfg=cfg)
            res["distribuidos"] += 1

    limite = (agora - timedelta(minutes=int(cfg.get("sla_min") or 15))).isoformat()
    try:
        pend = (sb.table("wa_leads").select("id,nome,wa_phone,corretor_id,repiques,trilha")
                .eq("status", "distribuido").is_("assumido_em", "null")
                .lt("distribuido_em", limite).limit(50).execute().data or [])
    except Exception:
        pend = []
    for l in pend:
        if cfg.get("repique_auto") and (l.get("repiques") or 0) < int(cfg.get("repique_max") or 2):
            try:
                sb.table("wa_leads").update({"repiques": (l.get("repiques") or 0) + 1}
                                            ).eq("id", l["id"]).execute()
            except Exception:
                pass
            distribuir(sb, l["id"], cfg=cfg, excluir=l.get("corretor_id"))
            res["repicados"] += 1
            continue
        alvo = _fallback_ids(sb, cfg)
        titulo = f"⏰ Lead sem resposta: {l.get('nome') or l.get('wa_phone')}"
        corpo = f"{LABEL.get(l.get('trilha'), '')} · passou de {cfg.get('sla_min', 15)}min sem ninguém assumir"
        try:
            notify(alvo, "wa_lead_sla", titulo, corpo, link="#/crm-house",
                   target_type="wa_lead", target_id=str(l["id"]))
        except Exception:
            pass
        res["cobrados"] += 1
    return res
