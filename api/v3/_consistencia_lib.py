"""
_consistencia_lib.py — TESTE NOTURNO DOS NÚMEROS ENTRE TELAS. v88.0

Pedido do Paulo (17/09/2026, item 6 da unificação de métricas): depois de pôr todas as telas no motor único,
um teste que roda sozinho toda noite, recalcula o MESMO número pelo caminho de cada tela e avisa o sócio se
alguma divergir — pra incongruência nunca mais ser descoberta pelo time no meio de uma reunião.

Cada verificação devolve {id, tela, metrica, escopo, esperado, obtido, ok, msg}. "esperado" é sempre o motor
único (_metricas_lib.resumo, Dicionário de Métricas); "obtido" é o número que a tela calcula ou exibe.
Tolerância: contagem exata; valor em R$ até R$ 1 (arredondamento).

Entradas: comparar(sb, hoje) → {"ok", "falhas", "checks", "janela", "ts"}. O endpoint é
/api/v3/system/consistency (?cron=1 roda, grava shared_kv consistencia_telas:<data> e avisa os sócios).
"""
import importlib.util
import os
from datetime import datetime, timedelta, timezone

import _metricas_lib as MX

_V3 = os.path.dirname(os.path.abspath(__file__))

KV_PREFIXO = "consistencia_telas:"
TOL_VALOR = 1.0
SYNC_MAX_H = 2.0          # em horário comercial (seg–sáb 9h–20h) o RD não pode ficar mais que isso sem sync
TEAM_NOME = {"conquista": "Conquista", "map": "MAP", "terceiros": "Terceiros", "locacao": "Locação", "_empresa": "Empresa"}


def _brl(v):
    """v88.37 (Paulo, 24/set): R$ sempre cheio com centavos — nunca "mil"/"mi"."""
    n = float(v or 0)
    return ("-" if n < 0 else "") + "R$ " + f"{abs(n):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


class Checagem:
    def __init__(self):
        self.itens = []

    def comparar(self, cid, tela, metrica, escopo, esperado, obtido, valor=False):
        if esperado is None or obtido is None:
            return
        tol = TOL_VALOR if valor else 0
        ok = abs(float(esperado) - float(obtido)) <= tol
        fmt = _brl if valor else (lambda x: f"{float(x):g}".replace(".", ","))
        nome = TEAM_NOME.get(escopo, escopo)
        msg = (f"{tela} · {metrica} · {nome}: {fmt(obtido)} = motor" if ok else
               f"{tela} mostra {metrica} {fmt(obtido)} para {nome}, o motor único dá {fmt(esperado)}")
        self.itens.append({"id": f"{cid}:{escopo}", "tela": tela, "metrica": metrica, "escopo": escopo,
                           "esperado": round(float(esperado), 2), "obtido": round(float(obtido), 2), "ok": ok, "msg": msg})

    def falhou(self, cid, tela, msg):
        """A verificação não conseguiu rodar — conta como falha (silêncio não é sucesso)."""
        self.itens.append({"id": cid, "tela": tela, "metrica": "execução", "escopo": "-", "esperado": None,
                           "obtido": None, "ok": False, "msg": f"{tela}: não consegui recalcular ({str(msg)[:140]})"})

    def aviso(self, cid, tela, ok, msg):
        self.itens.append({"id": cid, "tela": tela, "metrica": "frescor", "escopo": "-", "esperado": None,
                           "obtido": None, "ok": bool(ok), "msg": msg})


class Contexto:
    """Retratos do motor carregados uma vez só por rodada (mês, ano, hoje, projeção)."""
    def __init__(self, sb, hoje, mx):
        self.sb, self.hoje, self.mx, self._c = sb, hoje, mx, {}

    def _get(self, k, fn):
        if k not in self._c:
            self._c[k] = fn()
        return self._c[k]

    def ano(self):
        return self._get("ano", lambda: MX.resumo(self.sb, {"since": self.hoje.replace(month=1, day=1).isoformat(),
                                                            "until": self.hoje.isoformat()}, hoje=self.hoje))

    def dia(self):
        return self._get("dia", lambda: MX.resumo(self.sb, {"since": self.hoje.isoformat(), "until": self.hoje.isoformat()}, hoje=self.hoje))

    def pj(self):
        import _projecao_lib as PJ
        return self._get("pj", lambda: PJ.projecao(self.sb, {"h": "mes"}, fresh=True, hoje=self.hoje))


def _tela(rel, nome):
    """Carrega o módulo de uma tela (api/v3/<rel>) sem passar pelo handler HTTP."""
    spec = importlib.util.spec_from_file_location(nome, os.path.join(_V3, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


USUARIO_TECNICO = {"id": "_consistencia", "name": "Teste noturno", "lvl": 10, "role": "socio", "team": ""}


def _chamar(mod, caminho, sb):
    """Roda o do_GET de uma tela com o usuário técnico (sócio) e devolve o JSON — sem rede. O require_user
    trocado é o do módulo carregado só pra este teste, não o da função em produção."""
    mod.require_user = lambda h, min_lvl=0, **k: dict(USUARIO_TECNICO)
    mod.supabase_client = lambda: sb   # a mesma conexão da rodada
    h = mod.handler.__new__(mod.handler)
    h.path, h.headers = caminho, {}
    caixa = {}
    h._send = lambda status, body: caixa.update(status=status, body=body)
    h.do_GET()
    if caixa.get("status") != 200:
        raise RuntimeError(f"{caminho} → {caixa.get('status')}: {str(caixa.get('body'))[:120]}")
    return caixa["body"]


# ─── verificações ────────────────────────────────────────────────────────────
def _projecao(ck, ctx):
    """🎯 Meta · Realizado · Projeção (Gestão Comercial, 1:1, Cérebro, Meu dia): realizado do mês = motor."""
    mx, pj = ctx.mx, ctx.pj()
    alvo = [("_empresa", mx.get("empresa"), pj.get("empresa"))]
    alvo += [(tk, e, (pj.get("equipes") or {}).get(tk)) for tk, e in (mx.get("equipes") or {}).items()]
    for esc, b, p in alvo:
        if not (b and p):
            continue
        ck.comparar("projecao_vendas", "Projeção oficial", "vendas do mês", esc, b["vendas"], p["realizado"]["vendas"])
        ck.comparar("projecao_vgv", "Projeção oficial", "VGV do mês", esc, b["vgv"], p["realizado"]["vgv"], valor=True)


def _frescor(ck, sb, hoje):
    agora = MX.agora_brt()
    ts = MX.to_brt(MX.versao_deals(sb))
    comercial = agora.weekday() < 6 and 9 <= agora.hour < 20
    if not ts:
        ck.aviso("sync_rd", "Sync do RD", False, "Não consegui ler o último sync do RD (deals.synced_at).")
        return
    idade_h = (agora - ts).total_seconds() / 3600
    ok = (not comercial) or idade_h <= SYNC_MAX_H
    ck.aviso("sync_rd", "Sync do RD", ok,
             f"Dados do RD de {ts.strftime('%d/%m %H:%M')} ({idade_h:.1f} h)" if ok else
             f"Sync do RD parado há {idade_h:.1f} h (dados de {ts.strftime('%d/%m %H:%M')}) — todas as telas estão com número velho.")


def _metas(ck, ctx):
    """📊 Metas / Ranking / Relatórios / Sr. Gerência (metas/atingimento): vendas, VGV e meta do mês e do ano."""
    AT = _tela("metas/atingimento.py", "_cons_metas_atingimento")
    h = ctx.hoje
    r = AT.calcular(ctx.sb, {"id": "_consistencia", "lvl": 10, "role": "socio"}, h.year)
    fora = r.get("fora_do_grid_mensal") or {}
    cel = [c for g in r["grid"] for c in g["cells"] if c["mes"] == h.month]
    e = ctx.mx["empresa"]
    ck.comparar("metas_vendas_mes", "Metas", "vendas do mês", "_empresa", e["vendas"],
                sum(c["vendas_count"] for c in cel) + (fora.get(str(h.month)) or {}).get("vendas", 0))
    ck.comparar("metas_vgv_mes", "Metas", "VGV do mês", "_empresa", e["vgv"],
                sum(c["atingido_vgv"] for c in cel) + (fora.get(str(h.month)) or {}).get("vgv", 0), valor=True)
    ck.comparar("metas_meta_mes", "Metas", "meta de VGV do mês", "_empresa", (e.get("meta") or {}).get("meta_vgv"),
                sum(c["meta_vgv"] for c in cel), valor=True)
    ea = ctx.ano()["empresa"]
    ck.comparar("metas_vendas_ano", "Metas", "vendas do ano", "_empresa", ea["vendas"], r["totals"]["vendas_count"])
    ck.comparar("metas_vgv_ano", "Metas", "VGV do ano", "_empresa", ea["vgv"], r["totals"]["atingido_vgv"], valor=True)
    for g in r["grid"]:
        b = (ctx.mx.get("pessoas") or {}).get(g["user"].get("id"))
        c = next((c for c in g["cells"] if c["mes"] == h.month), None)
        if b and c:
            ck.comparar("metas_pessoa_vgv", "Metas", "VGV do mês", b.get("name") or b["id"], b["vgv"], c["atingido_vgv"], valor=True)


def _tv(ck, ctx):
    """📺 Modo TV (arena/tv): placar, meta, pipeline, projeção de fechamento e leads de hoje."""
    TV = _tela("arena/tv.py", "_cons_arena_tv")
    out = TV._build(ctx.sb)
    pl, mt, pr, de = out["placar"], out["meta"], out["projecao"], out["destaques"]
    e = ctx.mx["empresa"]
    ck.comparar("tv_vendas_mes", "Modo TV", "vendas do mês", "_empresa", e["vendas"], pl["vendas_mes"])
    ck.comparar("tv_vgv_mes", "Modo TV", "VGV do mês", "_empresa", e["vgv"], pl["vgv_mes"], valor=True)
    ck.comparar("tv_meta_mes", "Modo TV", "meta de VGV do mês", "_empresa", (e.get("meta") or {}).get("meta_vgv"), mt["meta_vgv"], valor=True)
    ck.comparar("tv_em_atendimento", "Modo TV", "negócios em atendimento", "_empresa", e["em_atendimento"], pl["pipeline_count"])
    ea = ctx.ano()["empresa"]
    ck.comparar("tv_vendas_ano", "Modo TV", "vendas do ano", "_empresa", ea["vendas"], pl["vendas_ano"])
    ck.comparar("tv_vgv_ano", "Modo TV", "VGV do ano", "_empresa", ea["vgv"], pl["vgv_ano"], valor=True)
    pe = ctx.pj().get("empresa")
    if pe:
        ck.comparar("tv_projecao", "Modo TV", "projeção de fechamento", "_empresa", pe["provavel"]["vgv"], pr["projecao_fim"], valor=True)
    ck.comparar("tv_leads_hoje", "Modo TV", "leads de hoje", "_empresa", ctx.dia()["empresa"]["leads"], de["leads_hoje"])


def _diretoria(ck, ctx):
    """🏛 Dashboard da Diretoria / Governança / Centro de Inteligência (diretoria/dashboard)."""
    DD = _tela("diretoria/dashboard.py", "_cons_diretoria_dashboard")
    h = ctx.hoje
    k = _chamar(DD, f"/api/v3/diretoria/dashboard?ano={h.year}&periodo=ytd", ctx.sb).get("kpis") or {}
    e, ea = ctx.mx["empresa"], ctx.ano()["empresa"]
    ck.comparar("dir_vendas_mes", "Diretoria", "vendas do mês", "_empresa", e["vendas"], k.get("atingido_vendas_mes"))
    ck.comparar("dir_vgv_mes", "Diretoria", "VGV do mês", "_empresa", e["vgv"], k.get("atingido_vgv_mes"), valor=True)
    ck.comparar("dir_meta_mes", "Diretoria", "meta de VGV do mês", "_empresa", (e.get("meta") or {}).get("meta_vgv"), k.get("meta_vgv_mes"), valor=True)
    ck.comparar("dir_vendas_ano", "Diretoria", "vendas do ano", "_empresa", ea["vendas"], k.get("atingido_vendas_ano"))
    ck.comparar("dir_vgv_ano", "Diretoria", "VGV do ano", "_empresa", ea["vgv"], k.get("atingido_vgv_ano"), valor=True)
    ck.comparar("dir_pessoas", "Diretoria", "equipe ativa", "_empresa", e.get("n_pessoas_ativas"), k.get("users_ativos"))
    ex = (k.get("exec") or {}).get("kpis") or {}
    ck.comparar("dir_exec_vgv", "Diretoria (painel executivo)", "VGV do ano até hoje", "_empresa", ea["vgv"], ex.get("vgv"), valor=True)


def _reconcile(ck, ctx):
    """🔗 Conciliação PSM HUB × RD (psmhub/reconcile): o lado RD do mês = motor."""
    RC = _tela("psmhub/reconcile.py", "_cons_psmhub_reconcile")
    h = ctx.hoje
    b = _chamar(RC, f"/api/v3/psmhub/reconcile?month={h.month}&year={h.year}", ctx.sb)
    if b.get("pending_config"):
        return
    t = b.get("totals") or {}
    e = ctx.mx["empresa"]
    ck.comparar("rec_rd_vendas", "Conciliação HUB × RD", "vendas do RD no mês", "_empresa", e["vendas"], t.get("rd_empresa_vendas"))
    ck.comparar("rec_rd_vgv", "Conciliação HUB × RD", "VGV do RD no mês", "_empresa", e["vgv"], t.get("rd_empresa_vgv"), valor=True)


def _marketing(ck, ctx):
    """📣 Marketing / Centro de Inteligência / funil da TV (marketing/crm_metrics): vendas, VGV e leads do mês."""
    CM = _tela("marketing/crm_metrics.py", "_cons_marketing_crm_metrics")
    g = _chamar(CM, "/api/v3/marketing/crm_metrics?date_preset=this_month", ctx.sb).get("global") or {}
    e = ctx.mx["empresa"]
    ck.comparar("mkt_vendas", "Marketing (CRM)", "vendas do mês", "_empresa", e["vendas"], g.get("vendas"))
    ck.comparar("mkt_vgv", "Marketing (CRM)", "VGV do mês", "_empresa", e["vgv"], g.get("vgv"), valor=True)
    ck.comparar("mkt_leads", "Marketing (CRM)", "leads de tráfego pago do mês", "_empresa", e["leads"], g.get("leads"))


VERIFICACOES = (
    ("projecao", _projecao),
    ("metas", _metas),
    ("tv", _tv),
    ("diretoria", _diretoria),
    ("reconcile", _reconcile),
    ("marketing", _marketing),
)


def comparar(sb, hoje=None):
    hoje = hoje or MX.hoje_brt()
    since, until = hoje.replace(day=1), hoje
    ck = Checagem()
    try:
        mx = MX.resumo(sb, {"since": since.isoformat(), "until": until.isoformat()}, fresh=True, hoje=hoje)
    except Exception as e:
        ck.falhou("motor", "Motor único", e)
        return _fechar(ck, since, until)
    ctx = Contexto(sb, hoje, mx)
    for nome, fn in VERIFICACOES:
        try:
            fn(ck, ctx)
        except Exception as e:
            ck.falhou(nome, nome, e)
    try:
        _frescor(ck, sb, hoje)
    except Exception as e:
        ck.falhou("sync_rd", "Sync do RD", e)
    return _fechar(ck, since, until)


def _fechar(ck, since, until):
    falhas = [c for c in ck.itens if not c["ok"]]
    return {"ok": not falhas, "falhas": len(falhas), "checks": ck.itens,
            "janela": {"since": since.isoformat(), "until": until.isoformat()},
            "ts": datetime.now(timezone.utc).isoformat()}


def resumo_aviso(res, limite=6):
    """Texto curto pro sino/celular do sócio."""
    falhas = [c for c in res.get("checks") or [] if not c["ok"]]
    if not falhas:
        return None, None
    telas = sorted({c["tela"] for c in falhas})
    titulo = f"🔎 {len(falhas)} número(s) divergente(s) entre telas: " + ", ".join(telas[:4]) + ("…" if len(telas) > 4 else "")
    corpo = " · ".join(c["msg"] for c in falhas[:limite])
    return titulo[:140], corpo[:600]
