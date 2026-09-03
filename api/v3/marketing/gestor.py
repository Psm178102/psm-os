# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/marketing/gestor — Gestor de Tráfego (Sr. Tráfego) v87.5
Header: Authorization: Bearer <token>

Backend único do módulo Gestor de Tráfego (menu Marketing):

GET  ?action=painel      → estado completo: config, alertas (regras + avaliação
                           ao vivo contra o cache Meta 7d/30d), públicos, listas,
                           log de ações. Líder+ (lvl>=5).
GET  ?action=segmento    → conta/preview um segmento da base RD (deals):
                           &frente=conquista|map|terceiros|locacoes|outros|todas
                           &status=aberto|ganho|perdido|todos
                           &dias_parado_min=N &com_fone=1
POST action=segmento_csv → CSV do segmento (nome/telefone/email normalizados p/
                           público personalizado no Ads Manager). Líder+.
POST action=config       → salva chave whitelisted de gt_config. SÓ sócio.
POST action=alertas      → salva regras de alerta (gt_alertas). SÓ sócio.
POST action=publico      → cria/atualiza/remove plano de público (gt_publicos).
POST action=lista        → sobe lista/mailing (parseada no front): {nome, marca,
                           origem, colunas, linhas[]} → gt_lista:<id>. Líder+.
POST action=lista_del    → remove lista. SÓ sócio.
POST action=meta_exec    → AÇÃO IMEDIATA AUTORIZADA no Meta (pausar/reativar
                           campanha/conjunto/anúncio, mudar orçamento diário),
                           guardada pelos guardrails de gt_config. SÓ sócio.

Tudo em shared_kv (aditivo, sem migração): gt_config, gt_alertas, gt_publicos,
gt_listas_idx, gt_lista:<id>, gt_acoes_log. Token Meta NUNCA sai das envs.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client, frente_of  # type: ignore
from _meta_cache_lib import build_cache_key, read_cache  # type: ignore
from _accounts_lib import resolver_contas  # type: ignore

GRAPH_API = "https://graph.facebook.com/v21.0"

KV_CONFIG = "gt_config"
KV_ALERTAS = "gt_alertas"
KV_PUBLICOS = "gt_publicos"
KV_LISTAS_IDX = "gt_listas_idx"
KV_LOG = "gt_acoes_log"

# Guardrails padrão — o sócio edita por cima (gt_config.guardrails)
GUARDRAILS_DEFAULT = {
    "ops_permitidas": ["pause", "resume", "budget"],
    "orcamento_max_brl_dia": 500.0,     # teto absoluto de orçamento diário por objeto
    "variacao_max_pct": 30.0,           # variação máx. de orçamento numa ação
    "max_acoes_dia": 20,                # circuit breaker: nº máx. de execuções/dia
}

CONFIG_CHAVES_OK = ("persona_extra", "estrategia", "conhecimento_extra",
                    "metricas_custom", "guardrails")

METRICAS_ALERTA = ("cpl", "spend", "leads", "ctr", "frequency", "cpm")
JANELAS_OK = ("last_7d", "last_30d")
SEVERIDADES = ("info", "atencao", "critico")

_ID_RX = re.compile(r"^[0-9]{5,25}$")           # ids de objeto do Graph
_SLUG_RX = re.compile(r"^[a-z0-9_-]{1,60}$")


# ─── KV helpers ────────────────────────────────────────────────────────
def kv_get(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, (dict, list)) else (default if default is not None else {})
    except Exception:
        return default if default is not None else {}


def kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value}, on_conflict="key").execute()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def log_acao(sb, user, op, alvo, params, ok, resp):
    """Anexa no gt_acoes_log (capado em 200 itens)."""
    try:
        log = kv_get(sb, KV_LOG, {"itens": []})
        itens = log.get("itens") or []
        itens.insert(0, {
            "ts": _now_iso(), "user": user.get("name") or user.get("email"),
            "op": op, "alvo": alvo, "params": params, "ok": bool(ok),
            "resp": str(resp)[:400],
        })
        kv_set(sb, KV_LOG, {"itens": itens[:200]})
    except Exception:
        pass


# ─── Avaliação de alertas contra o cache Meta ──────────────────────────
def _metricas_do_payload(payload):
    """Extrai métricas agregadas de um payload do /api/meta-ads (cacheado)."""
    if not isinstance(payload, dict):
        return None
    tot = ((payload.get("totals") or {}).get("cur")) or {}
    spend = float(tot.get("spend") or 0)
    results = int(tot.get("results") or 0)
    clicks = int(tot.get("clicks") or 0)
    imps = int(tot.get("impressions") or 0)
    freqs = [float(a.get("frequency") or 0) for a in (payload.get("accounts") or []) if a.get("frequency")]
    return {
        "spend": round(spend, 2),
        "leads": results,
        "cpl": round(spend / results, 2) if results else 0,
        "ctr": round(clicks / imps * 100, 3) if imps else 0,
        "cpm": round(spend / imps * 1000, 2) if imps else 0,
        "frequency": round(max(freqs), 2) if freqs else 0,
        "clicks": clicks,
        "impressions": imps,
        "period": payload.get("period"),
        "fetchedAt": payload.get("fetchedAt"),
    }


def avaliar_alertas(sb, regras):
    """Avalia cada regra ativa contra o cache compartilhado. Nunca chama o Meta
    live (o cron mantém o cache quente) — se não houver cache, marca sem_dado."""
    caches = {}
    for jan in JANELAS_OK:
        payload, age_s, _src = read_cache(sb, build_cache_key(jan, "", ""), 10 ** 9)
        caches[jan] = _metricas_do_payload(payload)
    out = []
    for r in (regras or []):
        if not r.get("ativo", True):
            continue
        jan = r.get("janela") if r.get("janela") in JANELAS_OK else "last_7d"
        met = r.get("metrica")
        m = caches.get(jan)
        item = {**r, "janela": jan}
        if not m or met not in m:
            item.update({"estado": "sem_dado", "valor_atual": None})
            out.append(item)
            continue
        atual = m[met]
        try:
            limiar = float(r.get("valor"))
        except Exception:
            item.update({"estado": "regra_invalida", "valor_atual": atual})
            out.append(item)
            continue
        disparou = (atual > limiar) if r.get("op") == ">" else (atual < limiar)
        item.update({"estado": "disparado" if disparou else "ok", "valor_atual": atual})
        out.append(item)
    return out, caches


# ─── Segmentação da base RD (deals) ────────────────────────────────────
def _contatos_do_raw(raw):
    """(nome, fones[], emails[]) do rd_raw."""
    nome, fones, emails = None, [], []
    try:
        if isinstance(raw, str):
            raw = json.loads(raw)
        for c in (raw or {}).get("contacts") or []:
            if not nome and c.get("name"):
                nome = str(c["name"])[:80]
            for p in (c.get("phones") or []):
                dig = re.sub(r"\D", "", str(p.get("phone") or ""))
                if len(dig) >= 10:
                    if not dig.startswith("55"):
                        dig = "55" + dig
                    fones.append(dig)
            for e in (c.get("emails") or []):
                em = str(e.get("email") or "").strip().lower()
                if "@" in em:
                    emails.append(em)
    except Exception:
        pass
    return nome, fones, emails


def segmentar(sb, frente, status, dias_min, com_fone, max_rows=15000):
    """Varre deals paginado e devolve linhas do segmento."""
    now = datetime.now(timezone.utc)
    out = []
    pg = 0
    while pg < 40 and len(out) < max_rows:
        q = sb.table("deals").select(
            "id,name,win,pipeline_name,stage_name,updated_at_rd,created_at_rd,rd_raw")
        if status == "aberto":
            q = q.is_("win", "null")
        elif status == "ganho":
            q = q.eq("win", True)
        elif status == "perdido":
            q = q.eq("win", False)
        rows = q.order("updated_at_rd", desc=True).range(pg * 500, pg * 500 + 499).execute().data or []
        if not rows:
            break
        for d in rows:
            if frente and frente != "todas" and frente_of(d.get("pipeline_name")) != frente:
                continue
            if dias_min:
                try:
                    up = datetime.fromisoformat(str(d.get("updated_at_rd") or d.get("created_at_rd")).replace("Z", "+00:00"))
                    if (now - up).days < dias_min:
                        continue
                except Exception:
                    continue
            nome, fones, emails = _contatos_do_raw(d.get("rd_raw"))
            if com_fone and not fones:
                continue
            out.append({
                "deal_id": d.get("id"),
                "nome": nome or d.get("name") or "—",
                "fone": fones[0] if fones else "",
                "email": emails[0] if emails else "",
                "funil": d.get("pipeline_name") or "",
                "etapa": d.get("stage_name") or "",
                "status": "ganho" if d.get("win") is True else ("perdido" if d.get("win") is False else "aberto"),
            })
        pg += 1
    return out


# ─── Execução no Meta (Graph API) ──────────────────────────────────────
def _graph_post(object_id, fields, token):
    data = urllib.parse.urlencode({**fields, "access_token": token}).encode()
    req = urllib.request.Request(f"{GRAPH_API}/{object_id}", data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode())
            msg = ((err.get("error") or {}).get("message")) or str(err)
        except Exception:
            msg = f"HTTP {e.code}"
        return False, msg
    except Exception as e:
        return False, str(e)


def _graph_get(path, params, token):
    qs = urllib.parse.urlencode({**params, "access_token": token})
    try:
        with urllib.request.urlopen(f"{GRAPH_API}/{path}?{qs}", timeout=30) as resp:
            return True, json.loads(resp.read().decode() or "{}")
    except Exception as e:
        return False, str(e)


def _acoes_hoje(sb):
    log = kv_get(sb, KV_LOG, {"itens": []})
    hoje = datetime.now(timezone.utc).date().isoformat()
    return sum(1 for i in (log.get("itens") or []) if str(i.get("ts", "")).startswith(hoje) and i.get("ok"))


# ─── Handler ───────────────────────────────────────────────────────────
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

    # ─── GET ───────────────────────────────────────────────────────────
    def do_GET(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        url = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(url.query))
        action = params.get("action") or "painel"

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        if action == "painel":
            cfg = kv_get(sb, KV_CONFIG, {})
            regras = (kv_get(sb, KV_ALERTAS, {}) or {}).get("regras") or []
            alertas, caches = avaliar_alertas(sb, regras)
            ids, labels, _ = resolver_contas(sb)
            return self._send(200, {
                "ok": True,
                "config": cfg,
                "guardrails": {**GUARDRAILS_DEFAULT, **(cfg.get("guardrails") or {})},
                "alertas": {"regras": regras, "avaliacao": alertas},
                "metricas": caches,
                "contas": [{"id": i, "label": l} for i, l in zip(ids, labels)],
                "publicos": (kv_get(sb, KV_PUBLICOS, {}) or {}).get("planos") or [],
                "listas": (kv_get(sb, KV_LISTAS_IDX, {}) or {}).get("listas") or [],
                "log": (kv_get(sb, KV_LOG, {}) or {}).get("itens", [])[:30],
                "pode_agir": (user.get("lvl") or 0) >= 10,
            })

        if action == "segmento":
            frente = params.get("frente") or "todas"
            status = params.get("status") or "todos"
            try:
                dias_min = int(params.get("dias_parado_min") or 0)
            except Exception:
                dias_min = 0
            com_fone = bool(params.get("com_fone"))
            rows = segmentar(sb, frente, status, dias_min, com_fone)
            com_f = sum(1 for r in rows if r["fone"])
            com_e = sum(1 for r in rows if r["email"])
            return self._send(200, {
                "ok": True, "total": len(rows), "com_fone": com_f, "com_email": com_e,
                "preview": rows[:20],
            })

        return self._send(400, {"ok": False, "error": "action inválida"})

    # ─── POST ──────────────────────────────────────────────────────────
    def do_POST(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = str(body.get("action") or "").strip()
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        lvl = user.get("lvl") or 0

        # ── config (sócio) ─────────────────────────────────────────────
        if action == "config":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "só sócio edita a configuração do gestor"})
            chave = str(body.get("chave") or "")
            valor = body.get("valor")
            if chave not in CONFIG_CHAVES_OK:
                return self._send(400, {"ok": False, "error": f"chave inválida (permitidas: {', '.join(CONFIG_CHAVES_OK)})"})
            if chave in ("persona_extra", "conhecimento_extra"):
                valor = str(valor or "")[:20000]
            elif chave == "estrategia":
                if not isinstance(valor, dict):
                    return self._send(400, {"ok": False, "error": "estrategia precisa ser objeto {conquista, imoveis}"})
                valor = {k: str(valor.get(k) or "")[:8000] for k in ("conquista", "imoveis")}
            elif chave == "metricas_custom":
                if not isinstance(valor, list) or len(valor) > 20:
                    return self._send(400, {"ok": False, "error": "metricas_custom: lista de até 20 itens"})
                valor = [{"nome": str(m.get("nome") or "")[:80], "descricao": str(m.get("descricao") or "")[:400]}
                         for m in valor if isinstance(m, dict) and m.get("nome")]
            elif chave == "guardrails":
                if not isinstance(valor, dict):
                    return self._send(400, {"ok": False, "error": "guardrails precisa ser objeto"})
                limpo = dict(GUARDRAILS_DEFAULT)
                ops = valor.get("ops_permitidas")
                if isinstance(ops, list):
                    limpo["ops_permitidas"] = [o for o in ops if o in ("pause", "resume", "budget")]
                for campo, teto in (("orcamento_max_brl_dia", 100000), ("variacao_max_pct", 100), ("max_acoes_dia", 200)):
                    try:
                        v = float(valor.get(campo, limpo[campo]))
                    except Exception:
                        return self._send(400, {"ok": False, "error": f"{campo} precisa ser número"})
                    if not (0 <= v <= teto):
                        return self._send(400, {"ok": False, "error": f"{campo} fora de 0-{teto}"})
                    limpo[campo] = v
                valor = limpo
            cfg = kv_get(sb, KV_CONFIG, {})
            antes = cfg.get(chave)
            cfg[chave] = valor
            cfg["atualizado_em"] = _now_iso()
            kv_set(sb, KV_CONFIG, cfg)
            audit(self, user, "gestor_trafego.config", target_type="gt_config", target_id=chave,
                  before=antes, after=valor)
            return self._send(200, {"ok": True, "chave": chave})

        # ── alertas (sócio) ────────────────────────────────────────────
        if action == "alertas":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "só sócio edita regras de alerta"})
            regras = body.get("regras")
            if not isinstance(regras, list) or len(regras) > 40:
                return self._send(400, {"ok": False, "error": "regras: lista de até 40 itens"})
            limpo = []
            for r in regras:
                if not isinstance(r, dict):
                    continue
                met = r.get("metrica")
                if met not in METRICAS_ALERTA:
                    return self._send(400, {"ok": False, "error": f"métrica inválida: {met!r}"})
                if r.get("op") not in (">", "<"):
                    return self._send(400, {"ok": False, "error": "op precisa ser > ou <"})
                try:
                    val = float(r.get("valor"))
                except Exception:
                    return self._send(400, {"ok": False, "error": "valor precisa ser número"})
                limpo.append({
                    "id": str(r.get("id") or uuid.uuid4().hex[:8]),
                    "nome": str(r.get("nome") or "")[:120],
                    "metrica": met, "op": r.get("op"), "valor": val,
                    "janela": r.get("janela") if r.get("janela") in JANELAS_OK else "last_7d",
                    "severidade": r.get("severidade") if r.get("severidade") in SEVERIDADES else "atencao",
                    "ativo": bool(r.get("ativo", True)),
                })
            kv_set(sb, KV_ALERTAS, {"regras": limpo, "atualizado_em": _now_iso()})
            audit(self, user, "gestor_trafego.alertas", target_type="gt_alertas", target_id="regras",
                  notes=f"{len(limpo)} regras")
            return self._send(200, {"ok": True, "regras": limpo})

        # ── planos de público ──────────────────────────────────────────
        if action == "publico":
            plano = body.get("plano")
            remover = body.get("remover")
            box = kv_get(sb, KV_PUBLICOS, {"planos": []})
            planos = box.get("planos") or []
            if remover:
                planos = [p for p in planos if p.get("id") != remover]
            elif isinstance(plano, dict) and plano.get("nome"):
                pid = str(plano.get("id") or uuid.uuid4().hex[:8])
                novo = {
                    "id": pid,
                    "nome": str(plano.get("nome"))[:120],
                    "marca": plano.get("marca") if plano.get("marca") in ("conquista", "imoveis", "ambas") else "conquista",
                    "tipo": plano.get("tipo") if plano.get("tipo") in ("personalizado", "semelhante", "salvo", "envolvimento") else "personalizado",
                    "fonte": str(plano.get("fonte") or "")[:400],
                    "definicao": str(plano.get("definicao") or "")[:2000],
                    "status": plano.get("status") if plano.get("status") in ("ideia", "criado_no_meta", "ativo", "pausado") else "ideia",
                    "notas": str(plano.get("notas") or "")[:2000],
                    "atualizado_em": _now_iso(),
                }
                planos = [p for p in planos if p.get("id") != pid] + [novo]
            else:
                return self._send(400, {"ok": False, "error": "envie plano{nome,...} ou remover=<id>"})
            kv_set(sb, KV_PUBLICOS, {"planos": planos[:60]})
            audit(self, user, "gestor_trafego.publico", target_type="gt_publicos",
                  target_id=(remover or (plano or {}).get("nome", "")))
            return self._send(200, {"ok": True, "planos": planos})

        # ── listas / mailings ──────────────────────────────────────────
        if action == "lista":
            nome = str(body.get("nome") or "").strip()
            linhas = body.get("linhas")
            if not nome or not isinstance(linhas, list) or not linhas:
                return self._send(400, {"ok": False, "error": "nome e linhas[] obrigatórios"})
            if len(linhas) > 20000:
                return self._send(400, {"ok": False, "error": "máximo 20.000 linhas por lista"})
            lid = uuid.uuid4().hex[:10]
            colunas = [str(c)[:60] for c in (body.get("colunas") or [])][:30]
            linhas_limpo = []
            for ln in linhas:
                if isinstance(ln, dict):
                    linhas_limpo.append({str(k)[:60]: str(v)[:300] for k, v in list(ln.items())[:30]})
            meta = {
                "id": lid, "nome": nome[:120],
                "marca": body.get("marca") if body.get("marca") in ("conquista", "imoveis", "ambas") else "ambas",
                "origem": str(body.get("origem") or "upload")[:200],
                "colunas": colunas, "n": len(linhas_limpo),
                "criado_por": user.get("name") or user.get("email"),
                "criado_em": _now_iso(),
            }
            kv_set(sb, f"gt_lista:{lid}", {"linhas": linhas_limpo})
            idx = kv_get(sb, KV_LISTAS_IDX, {"listas": []})
            idx["listas"] = ([meta] + (idx.get("listas") or []))[:50]
            kv_set(sb, KV_LISTAS_IDX, idx)
            audit(self, user, "gestor_trafego.lista_upload", target_type="gt_lista", target_id=lid,
                  notes=f"{nome} ({len(linhas_limpo)} linhas)")
            return self._send(200, {"ok": True, "lista": meta})

        if action == "lista_del":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "só sócio remove listas"})
            lid = str(body.get("id") or "")
            idx = kv_get(sb, KV_LISTAS_IDX, {"listas": []})
            idx["listas"] = [l for l in (idx.get("listas") or []) if l.get("id") != lid]
            kv_set(sb, KV_LISTAS_IDX, idx)
            try:
                sb.table("shared_kv").delete().eq("key", f"gt_lista:{lid}").execute()
            except Exception:
                pass
            audit(self, user, "gestor_trafego.lista_del", target_type="gt_lista", target_id=lid)
            return self._send(200, {"ok": True})

        # ── export CSV (segmento RD ou lista) ──────────────────────────
        if action == "segmento_csv":
            fonte = body.get("fonte") or "crm"
            if fonte == "lista":
                lid = str(body.get("lista_id") or "")
                box = kv_get(sb, f"gt_lista:{lid}", {})
                linhas = box.get("linhas") or []
                if not linhas:
                    return self._send(404, {"ok": False, "error": "lista vazia ou não encontrada"})
                cols = list(linhas[0].keys())
                csv_lines = [",".join(cols)]
                for ln in linhas:
                    csv_lines.append(",".join('"' + str(ln.get(c, "")).replace('"', '""') + '"' for c in cols))
                nome_arq = f"lista_{lid}"
            else:
                rows = segmentar(sb, body.get("frente") or "todas", body.get("status") or "todos",
                                 int(body.get("dias_parado_min") or 0), bool(body.get("com_fone")))
                # colunas no formato que o Ads Manager reconhece no upload
                csv_lines = ["fn,phone,email"]
                for r in rows:
                    csv_lines.append('"{}","{}","{}"'.format(
                        r["nome"].replace('"', '""'), r["fone"], r["email"]))
                nome_arq = "segmento_{}_{}".format(body.get("frente") or "todas", body.get("status") or "todos")
            audit(self, user, "gestor_trafego.export_csv", target_type="gt_segmento", target_id=nome_arq,
                  notes=f"{len(csv_lines) - 1} linhas")
            return self._send(200, {"ok": True, "nome": nome_arq, "n": len(csv_lines) - 1,
                                    "csv": "\n".join(csv_lines)})

        # ── ação imediata no Meta (sócio + guardrails) ─────────────────
        if action == "meta_exec":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "ações no Meta são exclusivas do sócio"})
            op = str(body.get("op") or "")
            alvo = str(body.get("alvo_id") or "")
            alvo_nome = str(body.get("alvo_nome") or alvo)[:160]
            if not _ID_RX.match(alvo):
                return self._send(400, {"ok": False, "error": "alvo_id inválido"})

            cfg = kv_get(sb, KV_CONFIG, {})
            g = {**GUARDRAILS_DEFAULT, **(cfg.get("guardrails") or {})}
            if op not in ("pause", "resume", "budget"):
                return self._send(400, {"ok": False, "error": "op inválida (pause|resume|budget)"})
            if op not in (g.get("ops_permitidas") or []):
                return self._send(403, {"ok": False, "error": f"op '{op}' bloqueada pelos guardrails"})
            if _acoes_hoje(sb) >= int(g.get("max_acoes_dia") or 20):
                return self._send(429, {"ok": False, "error": "limite diário de ações atingido (guardrail)"})

            token = os.environ.get("META_ACCESS_TOKEN") or ""
            if not token:
                return self._send(503, {"ok": False, "error": "META_ACCESS_TOKEN não configurado"})

            if op in ("pause", "resume"):
                fields = {"status": "PAUSED" if op == "pause" else "ACTIVE"}
            else:
                try:
                    novo = float(body.get("orcamento_brl"))
                except Exception:
                    return self._send(400, {"ok": False, "error": "orcamento_brl precisa ser número"})
                if not (1 <= novo <= float(g.get("orcamento_max_brl_dia") or 500)):
                    return self._send(400, {"ok": False, "error": f"orçamento fora do teto do guardrail (R$ {g.get('orcamento_max_brl_dia')}/dia)"})
                ok_atual, atual = _graph_get(alvo, {"fields": "daily_budget,name"}, token)
                if ok_atual and atual.get("daily_budget"):
                    atual_brl = int(atual["daily_budget"]) / 100.0
                    if atual_brl > 0:
                        var_pct = abs(novo - atual_brl) / atual_brl * 100
                        if var_pct > float(g.get("variacao_max_pct") or 30):
                            return self._send(400, {"ok": False, "error": f"variação de {var_pct:.0f}% excede o guardrail ({g.get('variacao_max_pct')}%)"})
                fields = {"daily_budget": str(int(round(novo * 100)))}

            ok, resp = _graph_post(alvo, fields, token)
            log_acao(sb, user, op, {"id": alvo, "nome": alvo_nome}, body.get("orcamento_brl"), ok, resp)
            audit(self, user, "gestor_trafego.meta_exec", target_type="meta_object", target_id=alvo,
                  notes=f"op={op} ok={ok} {str(resp)[:180]}")
            if not ok:
                return self._send(502, {"ok": False, "error": f"Meta recusou: {resp}"})
            return self._send(200, {"ok": True, "op": op, "alvo": alvo, "resp": resp})

        return self._send(400, {"ok": False, "error": "action inválida"})
