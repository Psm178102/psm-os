"""
⚡ Norte do Mês AUTOMÁTICO — Equipe Conquista (v86.2).

Preenche o Norte do Mês (kv oo_norte:<uid>:<YYYY-MM>) dos corretores da equipe
Conquista SOZINHO, com dado real:
  • RD CRM (funil Conquista): taxas 90d por marco, canais reais (share + conversão
    por origem), ticket, volume de leads/mês — via calibrar() do simulador.
  • PSM HUB (psmhub.com.br, ponte já ativa): metas por corretor (atendimentos/
    vendas quando existirem lá) — elo por E-MAIL (mesma chave do reconcile).
Cada campo sai com a FONTE explícita; nada é inventado.

REGRA ANTI-DESFAZER (lição de 10/ago: mudança de dado ≠ bug): só grava quando o
norte do mês está VAZIO ou foi gravado pelo próprio automático (cfg.auto).
Norte tocado por humano = manual → o robô NÃO encosta (só com force=true, que é
um clique explícito do gestor no editor). Editar pelo editor remove a marca auto.

GET  ?ym=YYYY-MM               → preview por corretor (nada grava). lvl>=7
GET  (Bearer CRON_SECRET)      → cron semanal: aplica mês corrente (vazio|auto)
POST {action:'aplicar', corretor_id?|todos:true, ym, force?} → grava. lvl>=7
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit, notify_all, lvl_of  # type: ignore
from _psmhub_lib import get as hub_get, configured as hub_configured  # type: ignore
from simulador import (  # type: ignore
    calibrar, cenario_calibrado, simulate, atividade_para, cadeia_de, motor_cfg,
    _kv_read, _kv_write, _num, ETAPAS,
)

TEAM_SUB = "conquista"   # equipe-alvo (substring do users.team)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _norm_email(s):
    return (str(s or "").strip().lower()) or None


# ─── PSM HUB: metas por corretor (tolerante a formato — melhor esforço) ─────
def _hub_metas_por_email(month, year):
    """{email: {atendimentos?, vendas?, visitas?}} + erros. Caça campos numéricos
    com nome reconhecível em metas_config/metas_metrics, ligados ao agente pelo
    e-mail (via /api/agents). Formato desconhecido → simplesmente não acha (ok)."""
    if not hub_configured():
        return {}, "PSMHUB_EMAIL/PSMHUB_PASSWORD não configurados"
    mq = f"month={month}&year={year}"
    try:
        agents = hub_get("/api/agents") or []
    except Exception as e:
        return {}, f"agents: {str(e)[:120]}"
    if isinstance(agents, dict):
        agents = agents.get("agents") or agents.get("data") or agents.get("items") or []
    email_by_id = {}
    for a in agents if isinstance(agents, list) else []:
        if not isinstance(a, dict):
            continue
        aid = a.get("id") or a.get("agentId") or a.get("_id")
        em = _norm_email(a.get("userEmail") or a.get("email"))
        if aid is not None and em:
            email_by_id[str(aid)] = em

    blobs = []
    for path in (f"/api/metas/config?{mq}", f"/api/metas/metrics?{mq}"):
        try:
            blobs.append(hub_get(path))
        except Exception:
            pass

    CAMPO = {"atendimentos": ("atendimento", "atend"), "vendas": ("venda", "sales"),
             "visitas": ("visita",)}
    out = {}

    def _cata(node):
        """Varre recursivamente atrás de objetos ligados a um agente com metas."""
        if isinstance(node, list):
            for x in node:
                _cata(x)
            return
        if not isinstance(node, dict):
            return
        aid = node.get("agentId") or node.get("agent_id") or node.get("userId")
        em = _norm_email(node.get("userEmail") or node.get("email")) or \
            (email_by_id.get(str(aid)) if aid is not None else None)
        if em:
            metas = out.setdefault(em, {})
            for campo, subs in CAMPO.items():
                if campo in metas:
                    continue
                for k, v in node.items():
                    kl = str(k).lower()
                    if any(s in kl for s in subs) and ("meta" in kl or kl in subs or "target" in kl or "goal" in kl):
                        n = _num(v, None)
                        if n is not None and n > 0:
                            metas[campo] = n
                            break
        for v in node.values():
            if isinstance(v, (dict, list)):
                _cata(v)

    for b in blobs:
        try:
            _cata(b)
        except Exception:
            pass
    return {k: v for k, v in out.items() if v}, None


# ─── monta o cfg do norte a partir do estado calibrado + metas HUB ──────────
def montar_cfg(estado, u, cfg_motor, hub_meta):
    fontes = {}
    hub_meta = hub_meta or {}
    conv_geral = 0.0
    tot_leads = sum((c.get("leads") or 0) for c in (estado.get("canais") or []))
    if tot_leads:
        conv_geral = (estado.get("vendas_90d") or 0) / tot_leads

    canais = []
    for c in (estado.get("canais") or []):
        taxa = round(conv_geral * _num(c.get("taxa_rel"), 1.0) * 100, 2)
        canais.append({"nome": c.get("label") or c.get("key"),
                       "taxa_base": taxa if taxa > 0 else 1.0,
                       "energia": 100, "mix": round(_num(c.get("share")) * 100, 1)})
    fontes["canais"] = "rd" if canais else "vazio"

    if hub_meta.get("atendimentos"):
        atend, fontes["atendimentos"] = round(hub_meta["atendimentos"]), "hub"
    else:
        atend, fontes["atendimentos"] = round(_num(estado.get("volume_mensal_leads"))), "rd"

    faixa_c = ((cfg_motor.get("faixas") or {}).get("conquista") or {})
    if estado.get("ticket_corretor"):
        ticket, fontes["ticket"] = estado["ticket_corretor"], "rd_corretor"
    elif estado.get("ticket_equipe"):
        ticket, fontes["ticket"] = estado["ticket_equipe"], "rd_equipe"
    else:
        ticket, fontes["ticket"] = _num(faixa_c.get("ticket"), 240000), "faixa"

    # metas por etapa: meta de vendas (HUB se houver; senão previsto do calibrado)
    cen = cenario_calibrado(estado, u)
    cen["atendimentos_mes"] = max(1, atend)
    sim = simulate(estado, cen, cfg_motor)
    if hub_meta.get("vendas"):
        vendas_meta, fontes["vendas"] = float(hub_meta["vendas"]), "hub"
    else:
        vendas_meta, fontes["vendas"] = max(0.5, round(sim["vendas_prev"], 1)), "rd_previsto"
    rows, _h = atividade_para(vendas_meta, {k: _num(v) for k, v in sim["taxas"].items()},
                              sim["fator_ticket"] * sim["fator_canais"], cadeia_de(estado, cfg_motor))
    metas_etapas = {k: None for k in ETAPAS}
    for r in rows:
        mk = min(5, max(0, int(r.get("marco") or 0)))
        if metas_etapas[ETAPAS[mk]] is None:
            metas_etapas[ETAPAS[mk]] = round(r["valor"], 1)
    metas_etapas["venda"] = round(vendas_meta, 1)
    if hub_meta.get("visitas"):
        metas_etapas["visita"] = round(float(hub_meta["visitas"]), 1)
        fontes["visitas"] = "hub"

    return {
        "atendimentos_mes": atend,
        "ticket_medio": round(_num(ticket), 2),
        "canais": canais,
        "metas_etapas": metas_etapas,
        "obs": f"⚡ preenchido automático (RD 90d + PSM HUB) em {datetime.now(timezone.utc).strftime('%d/%m/%Y')}",
        "auto": {"ts": _now_iso(), "fontes": fontes},
    }, fontes


def aplicar(sb, u, ym, cfg_motor, hub_metas, force, quem):
    """Aplica o norte automático de UM corretor. Retorna (status, detalhe)."""
    uid = str(u.get("id"))
    key = f"oo_norte:{uid}:{ym}"
    cur, okr = _kv_read(sb, key)
    if not okr:
        return "erro_leitura", "não consegui LER o norte atual — pulado por segurança"
    if cur and not cur.get("auto") and not force:
        return "manual", "norte editado por humano — automático não encosta"
    estado = calibrar(sb, uid, u, cfg_motor)
    novo_campos, fontes = montar_cfg(estado, u, cfg_motor, hub_metas.get(_norm_email(u.get("email"))))
    before = json.loads(json.dumps(cur)) if cur else None
    cfg = cur or {"changelog": []}
    cfg.update(novo_campos)
    log = cfg.get("changelog") or []
    log.append({"quem": quem, "quando": _now_iso(),
                "mudancas": [{"campo": "norte automático", "de": "—",
                              "para": f"RD+HUB · fontes {json.dumps(fontes, ensure_ascii=False)}"}]})
    cfg["changelog"] = log[-60:]
    if not _kv_write(sb, key, cfg, updated_by=None):
        return "erro_gravacao", "gravação falhou"
    return ("atualizado" if before else "criado"), {"fontes": fontes, "before": before, "after": cfg}


def corretores_conquista(sb):
    try:
        rows = sb.table("users").select("id,name,email,role,team,status").execute().data or []
    except Exception:
        return []
    out = []
    for x in rows:
        if (x.get("status") or "ativo") != "ativo":
            continue
        if TEAM_SUB not in (x.get("team") or "").strip().lower():
            continue
        r = (x.get("role") or "").lower()
        if not (r.startswith("corretor") or r in ("lider", "líder", "gerente")):
            continue
        if r in ("lider", "líder", "gerente"):
            continue   # gestor não tem norte individual
        out.append(x)
    return out


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _is_cron(self):
        sec = os.environ.get("CRON_SECRET")
        auth = self.headers.get("Authorization") or ""
        return bool(sec) and auth == f"Bearer {sec}"

    # ── GET: preview (sócio) ou execução do cron ──
    def do_GET(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        now = datetime.now(timezone.utc)

        if self._is_cron():
            ym = f"{now.year:04d}-{now.month:02d}"
            cfg_motor = motor_cfg(sb)
            hub_metas, hub_err = _hub_metas_por_email(now.month, now.year)
            res, aplicados = [], 0
            for u in corretores_conquista(sb):
                st, det = aplicar(sb, u, ym, cfg_motor, hub_metas, force=False,
                                  quem="⚙️ automático (cron RD+HUB)")
                res.append({"corretor": u.get("name"), "status": st})
                if st in ("criado", "atualizado"):
                    aplicados += 1
            # alçada: resumo pra sócios + gestor da Conquista (nunca broadcast)
            if aplicados:
                dest = set()
                try:
                    for x in (sb.table("users").select("id,role,team,status").execute().data or []):
                        if (x.get("status") or "ativo") != "ativo" or not x.get("id"):
                            continue
                        r = (x.get("role") or "").lower()
                        if lvl_of(r) >= 10 or (r in ("lider", "líder", "gerente")
                                               and TEAM_SUB in (x.get("team") or "").lower()):
                            dest.add(str(x["id"]))
                except Exception:
                    pass
                if dest:
                    notify_all(list(dest), "norte_auto",
                               f"⚡ Norte do Mês da Conquista atualizado ({aplicados} corretor(es))",
                               f"Preenchimento automático RD+HUB de {ym}. Norte editado à mão não foi tocado."
                               + (f" · HUB: {hub_err}" if hub_err else ""),
                               link="/v2/#/one-on-one", target_type="oo_norte", target_id=ym)
            return self._send(200, {"ok": True, "cron": True, "ym": ym,
                                    "aplicados": aplicados, "hub_err": hub_err, "res": res})

        try:
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        ym = q.get("ym") or f"{now.year:04d}-{now.month:02d}"
        try:
            y, m = int(ym[:4]), int(ym[5:7])
        except Exception:
            return self._send(400, {"ok": False, "error": "ym inválido (YYYY-MM)"})
        cfg_motor = motor_cfg(sb)
        hub_metas, hub_err = _hub_metas_por_email(m, y)
        out = []
        for u in corretores_conquista(sb):
            key = f"oo_norte:{u.get('id')}:{ym}"
            cur, okr = _kv_read(sb, key)
            status = "erro_leitura" if not okr else \
                ("vazio" if not cur else ("auto" if cur.get("auto") else "manual"))
            try:
                estado = calibrar(sb, str(u.get("id")), u, cfg_motor)
                proposto, fontes = montar_cfg(estado, u, cfg_motor,
                                              hub_metas.get(_norm_email(u.get("email"))))
            except Exception as e:
                proposto, fontes = None, {"erro": str(e)[:120]}
            out.append({"corretor_id": u.get("id"), "nome": u.get("name"),
                        "status_atual": status, "proposto": proposto, "fontes": fontes})
        return self._send(200, {"ok": True, "ym": ym, "hub_ok": not hub_err, "hub_err": hub_err,
                                "corretores": out,
                                "regra": "grava só VAZIO ou AUTO; manual exige force (clique explícito)"})

    # ── POST: aplicar (sócio) ──
    def do_POST(self):
        try:
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if (body.get("action") or "") != "aplicar":
            return self._send(400, {"ok": False, "error": "action=aplicar"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        now = datetime.now(timezone.utc)
        ym = body.get("ym") or f"{now.year:04d}-{now.month:02d}"
        try:
            y, m = int(ym[:4]), int(ym[5:7])
        except Exception:
            return self._send(400, {"ok": False, "error": "ym inválido (YYYY-MM)"})
        force = bool(body.get("force"))
        quem = f"⚡ auto (RD+HUB) por {user.get('name') or user.get('email')}"
        cfg_motor = motor_cfg(sb)
        hub_metas, hub_err = _hub_metas_por_email(m, y)

        alvos = corretores_conquista(sb)
        cid = body.get("corretor_id")
        if cid:
            alvos = [u for u in alvos if str(u.get("id")) == str(cid)]
            if not alvos:
                # permite forçar corretor fora da Conquista? NÃO — regra do Paulo é Conquista.
                return self._send(404, {"ok": False, "error": "corretor não é da equipe Conquista (auto é só Conquista)"})
        elif not body.get("todos"):
            return self._send(400, {"ok": False, "error": "corretor_id ou todos:true"})

        res, aplicados = [], 0
        for u in alvos:
            st, det = aplicar(sb, u, ym, cfg_motor, hub_metas, force=force, quem=quem)
            if st in ("criado", "atualizado"):
                aplicados += 1
                audit(self, user, "oo_norte.auto", target_type="oo_norte",
                      target_id=f"{u.get('id')}:{ym}",
                      before=det.get("before"), after=det.get("after"),
                      notes=f"{st} automático (RD+HUB){' FORCE' if force else ''}")
                res.append({"corretor": u.get("name"), "status": st, "fontes": det.get("fontes")})
            else:
                res.append({"corretor": u.get("name"), "status": st, "detalhe": det})
        return self._send(200, {"ok": True, "ym": ym, "aplicados": aplicados,
                                "hub_ok": not hub_err, "hub_err": hub_err, "res": res})
