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


# ─── PSM HUB: meta da EQUIPE do mês (lá a meta é team-level, não por corretor).
# Shape real validado em 12/ago: /api/metas/metrics → {config:{metaVgv},
# progress:{prospeccoes|agendamentos|visitas|pastas|vendas:{necessario}}}.
# O rateio por corretor (÷ ativos) acontece no chamador. ─────────────────────
def _hub_meta_equipe(month, year):
    if not hub_configured():
        return None, "PSMHUB_EMAIL/PSMHUB_PASSWORD não configurados"
    try:
        mm = hub_get(f"/api/metas/metrics?month={month}&year={year}") or {}
    except Exception as e:
        return None, f"metas/metrics: {str(e)[:120]}"
    prog = mm.get("progress") or {}

    def nec(k):
        return _num((prog.get(k) or {}).get("necessario"), None)

    out = {"prospeccoes": nec("prospeccoes"), "agendamentos": nec("agendamentos"),
           "visitas": nec("visitas"), "pastas": nec("pastas"), "vendas": nec("vendas"),
           "meta_vgv": _num((mm.get("config") or {}).get("metaVgv"), None)}
    if not any(v for v in out.values() if v):
        return None, "HUB sem metas do mês (metas/metrics vazio)"
    return out, None


def _rateio(hub_eq, n):
    """Meta da equipe ÷ corretores ativos → meta individual (HUB manda)."""
    if not hub_eq or n <= 0:
        return None
    div = lambda v: (round(v / n, 1) if v else None)
    return {"atendimentos": div(hub_eq.get("prospeccoes")),
            "agendamentos": div(hub_eq.get("agendamentos")),
            "visitas": div(hub_eq.get("visitas")),
            "pastas": div(hub_eq.get("pastas")),
            "vendas": div(hub_eq.get("vendas")),
            "n_corretores": n}


# ─── monta o cfg do norte a partir do estado calibrado + rateio da meta HUB ──
def montar_cfg(estado, u, cfg_motor, hub_meta):
    """hub_meta = rateio individual (meta da EQUIPE no HUB ÷ corretores ativos)."""
    fontes = {}
    hub_meta = hub_meta or {}
    n_hub = hub_meta.get("n_corretores")
    tag_hub = f"hub_equipe÷{n_hub}" if n_hub else "hub"
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
        atend, fontes["atendimentos"] = round(hub_meta["atendimentos"]), tag_hub
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
        vendas_meta, fontes["vendas"] = float(hub_meta["vendas"]), tag_hub
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
    # etapas que o HUB dita (meta da equipe rateada) SOBREPÕEM o funil reverso
    for et, hk in (("agendamento", "agendamentos"), ("visita", "visitas"), ("pasta", "pastas")):
        if hub_meta.get(hk):
            metas_etapas[et] = round(float(hub_meta[hk]), 1)
            fontes[et] = tag_hub
    if hub_meta.get("atendimentos"):
        metas_etapas["lead"] = round(float(hub_meta["atendimentos"]), 1)
    # monotonia: funil de META nunca cresce lead→pasta (misturar HUB + funil reverso
    # pode conflitar — ex.: reverso pedir 141 contatos com teto HUB de 118 leads;
    # a meta do HUB manda no teto)
    prev = None
    for et in ETAPAS[:-1]:
        val = metas_etapas.get(et)
        if val is None:
            continue
        if prev is not None and val > prev:
            metas_etapas[et] = prev
        prev = metas_etapas[et]

    return {
        "atendimentos_mes": atend,
        "ticket_medio": round(_num(ticket), 2),
        "canais": canais,
        "metas_etapas": metas_etapas,
        "obs": f"⚡ preenchido automático (RD 90d + PSM HUB) em {datetime.now(timezone.utc).strftime('%d/%m/%Y')}",
        "auto": {"ts": _now_iso(), "fontes": fontes},
    }, fontes


def aplicar(sb, u, ym, cfg_motor, hub_rateio, force, quem):
    """Aplica o norte automático de UM corretor. Retorna (status, detalhe)."""
    uid = str(u.get("id"))
    key = f"oo_norte:{uid}:{ym}"
    cur, okr = _kv_read(sb, key)
    if not okr:
        return "erro_leitura", "não consegui LER o norte atual — pulado por segurança"
    if cur and not cur.get("auto") and not force:
        return "manual", "norte editado por humano — automático não encosta"
    estado = calibrar(sb, uid, u, cfg_motor)
    novo_campos, fontes = montar_cfg(estado, u, cfg_motor, hub_rateio)
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
            corrs = corretores_conquista(sb)
            hub_eq, hub_err = _hub_meta_equipe(now.month, now.year)
            rate = _rateio(hub_eq, len(corrs))
            res, aplicados = [], 0
            for u in corrs:
                st, det = aplicar(sb, u, ym, cfg_motor, rate, force=False,
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
        corrs = corretores_conquista(sb)
        hub_eq, hub_err = _hub_meta_equipe(m, y)
        rate = _rateio(hub_eq, len(corrs))
        out = []
        for u in corrs:
            key = f"oo_norte:{u.get('id')}:{ym}"
            cur, okr = _kv_read(sb, key)
            status = "erro_leitura" if not okr else \
                ("vazio" if not cur else ("auto" if cur.get("auto") else "manual"))
            try:
                estado = calibrar(sb, str(u.get("id")), u, cfg_motor)
                proposto, fontes = montar_cfg(estado, u, cfg_motor, rate)
            except Exception as e:
                proposto, fontes = None, {"erro": str(e)[:120]}
            out.append({"corretor_id": u.get("id"), "nome": u.get("name"),
                        "status_atual": status, "proposto": proposto, "fontes": fontes})
        return self._send(200, {"ok": True, "ym": ym, "hub_ok": not hub_err, "hub_err": hub_err,
                                "hub_meta_equipe": hub_eq, "rateio": rate,
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
        alvos = corretores_conquista(sb)
        hub_eq, hub_err = _hub_meta_equipe(m, y)
        rate = _rateio(hub_eq, len(alvos))   # rateio pela equipe TODA, mesmo aplicando em 1

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
            st, det = aplicar(sb, u, ym, cfg_motor, rate, force=force, quem=quem)
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
