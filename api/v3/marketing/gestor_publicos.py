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


def _token_da_conta(sb, act_id):
    ids, _labels, tokens = resolver_contas(sb)
    principal = os.environ.get("META_ACCESS_TOKEN") or ""
    try:
        i = ids.index(act_id)
        return tokens[i] or principal
    except ValueError:
        return principal


def _graph(method, path, params, token):
    """Chamada Graph com erro legível. Retorna (ok, data|msg)."""
    try:
        if method == "GET":
            qs = urllib.parse.urlencode({**params, "access_token": token})
            req = urllib.request.Request(f"{GRAPH}/{path}?{qs}")
        else:
            data = urllib.parse.urlencode({**params, "access_token": token}).encode()
            req = urllib.request.Request(f"{GRAPH}/{path}", data=data, method="POST")
        with urllib.request.urlopen(req, timeout=45) as resp:
            return True, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            err = (json.loads(e.read().decode()).get("error") or {})
            msg = err.get("error_user_msg") or err.get("message") or f"HTTP {e.code}"
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
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        action = params.get("action") or "status"
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        campos = "id,name,subtype,approximate_count_lower_bound,delivery_status,operation_status,time_updated"

        if action == "status":
            ids, labels, _t = resolver_contas(sb)
            contas = []
            for i, act in enumerate(ids):
                ok, data = _graph("GET", f"{act}/customaudiences", {"fields": campos, "limit": 25}, _token_da_conta(sb, act))
                contas.append({"id": act, "label": labels[i] if i < len(labels) else act,
                               "ok": ok,
                               "publicos": (data.get("data") if ok else None),
                               "erro": (None if ok else data)})
            return self._send(200, {"ok": True, "contas": contas})

        if action == "listar":
            act = params.get("conta") or ""
            if not re.match(r"^act_\d+$", act):
                return self._send(400, {"ok": False, "error": "conta inválida (act_...)"})
            ok, data = _graph("GET", f"{act}/customaudiences", {"fields": campos, "limit": 100}, _token_da_conta(sb, act))
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

        act = str(body.get("conta") or "")
        if not re.match(r"^act_\d+$", act):
            return self._send(400, {"ok": False, "error": "conta inválida (act_...)"})
        token = _token_da_conta(sb, act)
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

            ok, data = _graph("POST", f"{act}/customaudiences", {
                "name": nome,
                "description": (str(body.get("descricao") or origem_desc))[:200],
                "subtype": "CUSTOM",
                "customer_file_source": "USER_PROVIDED_ONLY",
            }, token)
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
            ok, data = _graph("POST", f"{act}/customaudiences", {
                "name": nome_lal,
                "subtype": "LOOKALIKE",
                "origin_audience_id": origem,
                "lookalike_spec": json.dumps({"type": "similarity", "ratio": ratio, "country": "BR"}),
            }, token)
            log_acao(sb, actor, "lookalike_criar", {"id": (data.get('id') if ok else None), "nome": nome_lal},
                     f"origem {origem} ratio {ratio}", ok, data if not ok else "ok")
            if not ok:
                return self._send(502, {"ok": False, "error": data})
            audit(self, actor, "gestor_trafego.lookalike_criar", target_type="meta_audience",
                  target_id=str(data.get("id")), notes=f"{nome_lal} origem={origem}")
            return self._send(200, {"ok": True, "publico_id": data.get("id"), "nome": nome_lal})

        return self._send(400, {"ok": False, "error": "action inválida"})
