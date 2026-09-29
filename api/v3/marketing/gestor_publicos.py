# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/marketing/gestor_publicos — Públicos via Marketing API (v87.16)

Fase 2 do Sr. Gestor de Tráfego (GO do Paulo 03/set): criar públicos
personalizados no Meta direto da base RD CRM (segmentos) e das listas/mailings
subidas no House, e públicos semelhantes (lookalike) — sem CSV manual.

GET  ?action=status               → capacidade por conta: lista custom audiences
                                    (testa ads_management + termo de Custom
                                    Audiences; erro do Meta vem legível). lvl>=5
GET  ?action=listar&conta=act_... → públicos da conta (id, nome, tamanho, status)
POST action=criar_personalizado   → SÓ SÓCIO. {conta, nome, descricao,
                                    fonte: 'crm'|'lista',
                                    (crm) frente/status/dias_parado_min/com_fone,
                                    (lista) lista_id}
                                    Cria a audience e sobe os contatos com hash
                                    SHA-256 (fone normalizado 55DDD…, e-mail
                                    minúsculo) em lotes de 5.000 — o dado NUNCA
                                    sai do servidor sem hash.
POST action=criar_lookalike       → SÓ SÓCIO. {conta, origem_id, nome, ratio 0.01-0.10}

Tudo auditado (audit_log + gt_acoes_log). Tokens só das envs (nunca no banco).
"""
from http.server import BaseHTTPRequestHandler
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore
from _accounts_lib import resolver_contas  # type: ignore
from gestor import kv_get, segmentar, log_acao, _contatos_do_raw  # type: ignore
from _auth_lib import frente_of  # type: ignore
from datetime import datetime, timezone, timedelta
import _publicos_kit as kit  # type: ignore  # v88.98: kit automático (fase 2 da autonomia)

# v88.98: contas que o kit mantém (a pessoal do Paulo fica fora do usuário de sistema)
KIT_CONTAS = {"conquista": "act_1851397782164698", "imoveis": "act_1413862082678408"}

GRAPH = "https://graph.facebook.com/v21.0"
LOTE = 5000

# Régua de temperatura (v87.17 — pedido do Paulo: frio/morno/quente):
#   QUENTE = ganhou OU chegou em etapa de fundo (pasta/aprovação/proposta,
#            oportunidade do mês, visita, venda, carteira)
#   MORNO  = aberto fora do fundo, com movimento nos últimos 60 dias
#   FRIO   = perdido OU aberto parado 60+ dias (reativação)
_RX_FUNDO = re.compile(r"PASTA|APROVA|PROPOSTA|OPORT. DO M|VISITA|VENDA|CARTEIRA")


def segmentar_temperatura(sb, temp, frente="todas", max_rows=20000):
    now = datetime.now(timezone.utc)
    out, pg = [], 0
    while pg < 40 and len(out) < max_rows:
        rows = (sb.table("deals")
                .select("id,name,win,pipeline_name,stage_name,updated_at_rd,created_at_rd,rd_raw")
                .order("updated_at_rd", desc=True)
                .range(pg * 500, pg * 500 + 499).execute().data or [])
        if not rows:
            break
        for d in rows:
            if frente and frente != "todas" and frente_of(d.get("pipeline_name")) != frente:
                continue
            st = (d.get("stage_name") or "").upper()
            fundo = bool(_RX_FUNDO.search(st))
            try:
                up = datetime.fromisoformat(str(d.get("updated_at_rd") or d.get("created_at_rd")).replace("Z", "+00:00"))
                dias = (now - up).days
            except Exception:
                dias = 9999
            if d.get("win") is True or (d.get("win") is None and fundo):
                classe = "quente"
            elif d.get("win") is None and dias <= 60:
                classe = "morno"
            else:
                classe = "frio"
            if classe != temp:
                continue
            _n, fones, emails = _contatos_do_raw(d.get("rd_raw"))
            if not fones and not emails:
                continue
            out.append({"fone": fones[0] if fones else "", "email": emails[0] if emails else ""})
        pg += 1
    return out


def _tokens_da_conta(sb, act_id):
    """[token_da_conta?, principal] sem duplicar — v87.19: se o token específico
    da conta falhar (ex.: #100 sem permissão de custom audience), tentamos o
    principal em seguida."""
    ids, _labels, tokens = resolver_contas(sb)
    principal = os.environ.get("META_ACCESS_TOKEN") or ""
    out = []
    # v88.98: o usuário de sistema (META_WRITE_TOKEN, ads_management) vem primeiro — o token
    # principal é só leitura e não cria público. Falhou nele (ex.: conta pessoal) → cai nos outros.
    escrita = os.environ.get("META_WRITE_TOKEN") or ""
    if escrita:
        out.append(escrita)
    try:
        i = ids.index(act_id)
        if tokens[i] and tokens[i] not in out:
            out.append(tokens[i])
    except ValueError:
        pass
    if principal and principal not in out:
        out.append(principal)
    return out or [principal]


def _token_da_conta(sb, act_id):
    return _tokens_da_conta(sb, act_id)[0]


def _graph_retry(method, path, params, sb, act_id):
    """Tenta a chamada com cada token disponível da conta (específico → principal)."""
    ultimo = (False, "sem token")
    for tk in _tokens_da_conta(sb, act_id):
        ok, data = _graph(method, path, params, tk)
        if ok:
            return ok, data, tk
        ultimo = (ok, data)
    return ultimo[0], ultimo[1], None


def _graph(method, path, params, token):
    """Chamada Graph com erro legível. Retorna (ok, data|msg)."""
    try:
        if method in ("GET", "DELETE"):
            qs = urllib.parse.urlencode({**params, "access_token": token})
            req = urllib.request.Request(f"{GRAPH}/{path}?{qs}", method=method)
        else:
            data = urllib.parse.urlencode({**params, "access_token": token}).encode()
            req = urllib.request.Request(f"{GRAPH}/{path}", data=data, method="POST")
        with urllib.request.urlopen(req, timeout=45) as resp:
            return True, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            err = (json.loads(e.read().decode()).get("error") or {})
            msg = err.get("error_user_msg") or err.get("message") or f"HTTP {e.code}"
            det = [str(x) for x in (err.get("code"), err.get("error_subcode"), err.get("type")) if x]
            if det:
                msg += " [" + "/".join(det) + "]"
            # termo de Custom Audience não aceito vem como subcode 1870034/2654
            if "terms" in msg.lower() or err.get("error_subcode") in (1870034, 2654):
                msg += " — aceite o Termo de Públicos Personalizados no Gerenciador de Negócios (1 clique, uma vez): business.facebook.com/ads/manage/customaudiences/tos"
            return False, msg
        except Exception:
            return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)


def _sha(v):
    return hashlib.sha256(v.encode("utf-8")).hexdigest()


def _linhas_hash(rows):
    """[(PHONE_SHA256, EMAIL_SHA256)] a partir de linhas {fone, email} já
    normalizadas (fone 55DDDN…, email minúsculo). Campo ausente vira ''."""
    out = []
    for r in rows:
        f = re.sub(r"\D", "", str(r.get("fone") or ""))
        e = str(r.get("email") or "").strip().lower()
        if not f and not e:
            continue
        out.append([_sha(f) if f else "", _sha(e) if e else ""])
    return out


def _detectar_contatos_lista(linhas):
    """Acha colunas de fone/e-mail numa lista subida (nomes livres) e devolve
    linhas normalizadas {fone, email}."""
    if not linhas:
        return []
    cols = list(linhas[0].keys())
    low = {c: c.lower() for c in cols}
    col_f = next((c for c in cols if any(k in low[c] for k in ("fone", "telefone", "celular", "whats", "phone", "tel"))), None)
    col_e = next((c for c in cols if "mail" in low[c]), None)
    out = []
    for ln in linhas:
        f = re.sub(r"\D", "", str(ln.get(col_f) or "")) if col_f else ""
        if f and len(f) >= 10 and not f.startswith("55"):
            f = "55" + f
        e = str(ln.get(col_e) or "").strip().lower() if col_e else ""
        if (f and len(f) >= 12) or ("@" in e):
            out.append({"fone": f if len(f) >= 12 else "", "email": e if "@" in e else ""})
    return out


def rodar_kit(sb, simular=False, forcar_crm=False):
    """Mantém o kit nas contas do KIT_CONTAS. Só varre o CRM (pesado) quando alguma lista
    venceu (7 dias) ou não existe — ou quando o sócio força."""
    estado = kv_get(sb, kit.KV_KIT, {}) or {}
    agora = datetime.now(timezone.utc)
    precisa = forcar_crm
    for marca in KIT_CONTAS:
        for chave, _t, _r in kit.LISTAS:
            try:
                idade = (agora - datetime.fromisoformat(((estado.get(marca) or {}).get(chave) or {}).get("atualizado_em"))).days
            except Exception:
                idade = 999
            precisa = precisa or idade >= kit.REFRESH_LISTA_DIAS
    crm = kit.varrer_crm(sb, frente_of, agora) if precisa else None
    tok = lambda act: (_tokens_da_conta(sb, act) or [""])[0]
    return kit.manter_kit(sb, _graph, KIT_CONTAS, tok, frente_of, simular=simular, agora=agora, crm=crm,
                          forcar=forcar_crm)


def _kit_resumo(rel):
    cont = {}
    for r in rel:
        cont[r["acao"]] = cont.get(r["acao"], 0) + 1
    return cont


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        action = params.get("action") or "status"
        # v88.98: rodada diária do kit (heartbeat, CRON_SECRET) — respeita o interruptor do Cérebro
        if action == "kit" and params.get("cron"):
            tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
            if not (os.environ.get("CRON_SECRET") and tok == os.environ.get("CRON_SECRET")):
                return self._send(401, {"ok": False, "error": "cron sem segredo"})
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False, "error": "backend indisponível"})
            aut = ((kv_get(sb, "gt_config", {}) or {}).get("autonomia") or {})
            if aut.get("publicos_auto") is False:
                return self._send(200, {"ok": True, "rodou": False, "motivo": "kit de públicos desligado no Cérebro"})
            ult = (kv_get(sb, kit.KV_KIT, {}) or {}).get("_ultima_rodada") or ""
            if ult[:10] == datetime.now(timezone.utc).date().isoformat():
                return self._send(200, {"ok": True, "rodou": False, "motivo": "já rodou hoje"})
            _est, rel = rodar_kit(sb)
            erros = [r for r in rel if not r["ok"] and r["acao"] in ("erro",)]
            log_acao(sb, {"name": "🤖 Sr. Tráfego (automático)"}, "publicos_kit", {"nome": "kit de públicos"},
                     json.dumps(_kit_resumo(rel), ensure_ascii=False), not erros,
                     "; ".join(f"{e['marca']}/{e['chave']}: {e['detalhe']}" for e in erros)[:500] or "ok")
            return self._send(200, {"ok": True, "rodou": True, "resumo": _kit_resumo(rel), "erros": erros})
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # v89.0: interesses do Meta (público frio segmentado) — busca + tamanho no raio de Rio Preto.
        # ?q=termo1|termo2  → [{id, name, path, tamanho_br}]
        # ?estimar=ID,ID&raio=25&conta=act_  → alcance estimado no raio (modo original, sem Advantage)
        if action == "interesses":
            act = params.get("conta") or KIT_CONTAS["conquista"]
            tk = (_tokens_da_conta(sb, act) or [""])[0]
            out = {"ok": True}
            if params.get("q"):
                achados = []
                for termo in [t.strip() for t in params["q"].split("|") if t.strip()][:15]:
                    ok, d = _graph("GET", "search", {"type": "adinterest", "q": termo, "limit": 8, "locale": "pt_BR"}, tk)
                    for it in (d.get("data") or []) if ok else []:
                        achados.append({"termo": termo, "id": it.get("id"), "name": it.get("name"),
                                        "path": " > ".join(it.get("path") or []),
                                        "br_min": it.get("audience_size_lower_bound"),
                                        "br_max": it.get("audience_size_upper_bound")})
                    if not ok:
                        achados.append({"termo": termo, "erro": d})
                out["interesses"] = achados
            if params.get("estimar"):
                ok, geo = _graph("GET", "search", {"type": "adgeolocation", "q": "São José do Rio Preto",
                                                   "location_types": json.dumps(["city"]), "country_code": "BR"}, tk)
                cidade = next((g for g in (geo.get("data") or []) if "Rio Preto" in str(g.get("name"))), None) if ok else None
                if not cidade:
                    return self._send(502, {"ok": False, "error": f"não achei Rio Preto no Meta: {geo}"})
                raio = max(10, min(80, int(params.get("raio") or 25)))
                grupos = [[{"id": i.strip()} for i in g.split(",") if i.strip()] for g in params["estimar"].split(";")]
                estimativas = []
                for g in grupos:
                    spec = {"geo_locations": {"cities": [{"key": cidade["key"], "radius": raio, "distance_unit": "kilometer"}]},
                            "age_min": int(params.get("idade_min") or 22), "age_max": int(params.get("idade_max") or 45),
                            "flexible_spec": [{"interests": g}],
                            "targeting_automation": {"advantage_audience": 0}}
                    ok2, est = _graph("GET", f"{act}/delivery_estimate", {"optimization_goal": "LEAD_GENERATION",
                                                                           "targeting_spec": json.dumps(spec)}, tk)
                    d0 = ((est.get("data") or [{}])[0]) if ok2 else {}
                    estimativas.append({"ids": [x["id"] for x in g], "min": d0.get("estimate_mau_lower_bound"),
                                        "max": d0.get("estimate_mau_upper_bound"), "erro": None if ok2 else est})
                out["cidade"] = {"key": cidade["key"], "name": cidade.get("name"), "raio_km": raio}
                out["estimativas"] = estimativas
            return self._send(200, out)

        # v88.98: estado do kit (o que existe, tamanho, temperatura, última atualização)
        if action == "kit":
            return self._send(200, {"ok": True, "kit": kv_get(sb, kit.KV_KIT, {}) or {}})

        # v88.98: o que o token de escrita consegue fazer com públicos, conta a conta
        if action == "capacidade":
            out = {}
            for marca, act in KIT_CONTAS.items():
                tk = (_tokens_da_conta(sb, act) or [""])[0]
                ok, info = _graph("GET", act, {"fields": "name,tos_accepted,account_status"}, tk)
                out[marca] = {"conta": act, "info": info if ok else {"erro": info},
                              "fontes": kit.descobrir_fontes(_graph, act, tk)}
            return self._send(200, {"ok": True, "token": "META_WRITE_TOKEN" if os.environ.get("META_WRITE_TOKEN") else "META_ACCESS_TOKEN",
                                    "contas": out})

        campos = "id,name,subtype,approximate_count_lower_bound,delivery_status,operation_status,time_updated"

        if action == "status":
            ids, labels, _t = resolver_contas(sb)
            contas = []
            for i, act in enumerate(ids):
                ok, data, _tk = _graph_retry("GET", f"{act}/customaudiences", {"fields": campos, "limit": 25}, sb, act)
                contas.append({"id": act, "label": labels[i] if i < len(labels) else act,
                               "ok": ok,
                               "publicos": (data.get("data") if ok else None),
                               "erro": (None if ok else data)})
            return self._send(200, {"ok": True, "contas": contas})

        if action == "app_info":
            # v87.20: identifica o APP dono de cada token (é nele que se pede o
            # Acesso Padrão do Marketing API pro erro #100 dos públicos de lista)
            vistos, apps = set(), []
            ids, labels, tokens = resolver_contas(sb)
            todos = [("principal (META_ACCESS_TOKEN)", os.environ.get("META_ACCESS_TOKEN") or "")]
            todos += [(f"token da conta {labels[i] if i < len(labels) else a}", tokens[i])
                      for i, a in enumerate(ids) if i < len(tokens) and tokens[i]]
            for rotulo, tk in todos:
                if not tk or tk[:24] in vistos:
                    continue
                vistos.add(tk[:24])
                ok, data = _graph("GET", "app", {"fields": "id,name,link"}, tk)
                ok2, quem = _graph("GET", "me", {"fields": "id,name"}, tk)
                apps.append({"token": rotulo,
                             "app": (data if ok else {"erro": data}),
                             "usuario": (quem if ok2 else {"erro": quem})})
            return self._send(200, {"ok": True, "apps": apps})

        if action == "listar":
            act = params.get("conta") or ""
            if not re.match(r"^act_\d+$", act):
                return self._send(400, {"ok": False, "error": "conta inválida (act_...)"})
            ok, data, _tk = _graph_retry("GET", f"{act}/customaudiences", {"fields": campos, "limit": 100}, sb, act)
            if not ok:
                return self._send(502, {"ok": False, "error": data})
            return self._send(200, {"ok": True, "publicos": data.get("data") or []})

        return self._send(400, {"ok": False, "error": "action inválida"})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)  # criação de público = sócio
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = str(body.get("action") or "")
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        # v88.98: kit manual (sócio) — simular=true só mostra o que faria
        if action == "kit":
            _est, rel = rodar_kit(sb, simular=bool(body.get("simular")), forcar_crm=bool(body.get("forcar_crm")))
            if not body.get("simular"):
                log_acao(sb, actor, "publicos_kit", {"nome": "kit de públicos"},
                         json.dumps(_kit_resumo(rel), ensure_ascii=False), True, "ok")
            return self._send(200, {"ok": True, "simulado": bool(body.get("simular")),
                                    "resumo": _kit_resumo(rel), "itens": rel})

        # v88.98.3: apagar ÓRFÃO do kit (sócio) — só público com o prefixo do kit que NÃO é mais um nome
        # vigente (ex.: duplicata criada por renomeação). Nunca toca público feito à mão.
        if action == "kit_apagar":
            marca = str(body.get("marca") or "")
            act = KIT_CONTAS.get(marca)
            pid = str(body.get("publico_id") or "")
            if not act or not re.match(r"^\d{5,25}$", pid):
                return self._send(400, {"ok": False, "error": "marca/publico_id inválidos"})
            tk = (_tokens_da_conta(sb, act) or [""])[0]
            ok, info = _graph("GET", pid, {"fields": "name,account_id"}, tk)
            if not ok:
                return self._send(502, {"ok": False, "error": info})
            nome_p = str(info.get("name") or "")
            if (not nome_p.startswith(kit.PREFIXO) or nome_p in kit.nomes_do_kit(marca)
                    or str(info.get("account_id") or "") != act.replace("act_", "")):
                return self._send(400, {"ok": False, "error": f"'{nome_p}' não é órfão do kit — não apago"})
            ok, r = _graph("DELETE", pid, {}, tk)
            log_acao(sb, actor, "publico_apagar", {"id": pid, "nome": nome_p}, "órfão do kit", ok, r)
            return self._send(200 if ok else 502, {"ok": ok, "apagado": nome_p if ok else None, "resp": r})

        act = str(body.get("conta") or "")
        if not re.match(r"^act_\d+$", act):
            return self._send(400, {"ok": False, "error": "conta inválida (act_...)"})
        nome = str(body.get("nome") or "").strip()[:120]

        # ── público personalizado (CRM ou lista) ───────────────────────
        if action == "criar_personalizado":
            if not nome:
                return self._send(400, {"ok": False, "error": "nome obrigatório"})
            fonte = body.get("fonte") or "crm"
            if fonte == "lista":
                lid = str(body.get("lista_id") or "")
                box = kv_get(sb, f"gt_lista:{lid}", {})
                rows = _detectar_contatos_lista(box.get("linhas") or [])
                origem_desc = f"lista {lid}"
            elif body.get("temperatura") in ("quente", "morno", "frio"):
                temp = body.get("temperatura")
                rows = segmentar_temperatura(sb, temp, body.get("frente") or "todas")
                origem_desc = f"CRM temperatura={temp} frente={body.get('frente') or 'todas'}"
            else:
                rows = segmentar(sb, body.get("frente") or "todas", body.get("status") or "todos",
                                 int(body.get("dias_parado_min") or 0), True)
                origem_desc = f"CRM {body.get('frente') or 'todas'}/{body.get('status') or 'todos'}"
            hashes = _linhas_hash(rows)
            if len(hashes) < 20:
                return self._send(400, {"ok": False, "error": f"só {len(hashes)} contatos válidos — o Meta precisa de pelo menos ~100 pra parear bem (mínimo aqui: 20)"})

            ok, data, token = _graph_retry("POST", f"{act}/customaudiences", {
                "name": nome,
                "description": (str(body.get("descricao") or origem_desc))[:200],
                "subtype": "CUSTOM",
                "customer_file_source": "USER_PROVIDED_ONLY",
            }, sb, act)
            if not ok:
                log_acao(sb, actor, "publico_criar", {"nome": nome}, origem_desc, False, data)
                return self._send(502, {"ok": False, "error": data})
            aud_id = data.get("id")

            enviados = 0
            for i in range(0, len(hashes), LOTE):
                lote = hashes[i:i + LOTE]
                ok2, r2 = _graph("POST", f"{aud_id}/users", {
                    "payload": json.dumps({"schema": ["PHONE_SHA256", "EMAIL_SHA256"], "data": lote}),
                }, token)
                if not ok2:
                    log_acao(sb, actor, "publico_upload", {"id": aud_id, "nome": nome}, f"lote {i}", False, r2)
                    return self._send(502, {"ok": False, "error": f"público criado ({aud_id}) mas upload falhou no lote {i}: {r2}",
                                            "publico_id": aud_id, "enviados": enviados})
                enviados += len(lote)

            log_acao(sb, actor, "publico_criar", {"id": aud_id, "nome": nome}, f"{origem_desc} · {enviados} contatos", True, "ok")
            audit(self, actor, "gestor_trafego.publico_criar", target_type="meta_audience", target_id=str(aud_id),
                  notes=f"{nome} · {origem_desc} · {enviados} contatos (hash sha256)")
            return self._send(200, {"ok": True, "publico_id": aud_id, "nome": nome, "contatos_enviados": enviados,
                                    "obs": "o Meta leva de 1h a 24h pra parear e mostrar o tamanho"})

        # ── lookalike ──────────────────────────────────────────────────
        if action == "criar_lookalike":
            origem = str(body.get("origem_id") or "")
            if not re.match(r"^\d{5,25}$", origem):
                return self._send(400, {"ok": False, "error": "origem_id inválido"})
            try:
                ratio = float(body.get("ratio") or 0.01)
            except Exception:
                ratio = 0.01
            ratio = min(max(ratio, 0.01), 0.10)
            nome_lal = nome or f"LAL {int(ratio * 100)}% BR"
            ok, data, _tk = _graph_retry("POST", f"{act}/customaudiences", {
                "name": nome_lal,
                "subtype": "LOOKALIKE",
                "origin_audience_id": origem,
                "lookalike_spec": json.dumps({"type": "similarity", "ratio": ratio, "country": "BR"}),
            }, sb, act)
            log_acao(sb, actor, "lookalike_criar", {"id": (data.get('id') if ok else None), "nome": nome_lal},
                     f"origem {origem} ratio {ratio}", ok, data if not ok else "ok")
            if not ok:
                return self._send(502, {"ok": False, "error": data})
            audit(self, actor, "gestor_trafego.lookalike_criar", target_type="meta_audience",
                  target_id=str(data.get("id")), notes=f"{nome_lal} origem={origem}")
            return self._send(200, {"ok": True, "publico_id": data.get("id"), "nome": nome_lal})

        return self._send(400, {"ok": False, "error": "action inválida"})
