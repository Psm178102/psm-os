"""
_placar_lib.py — 🎯 Placares da Inteligência (v89.2): o sistema passa a medir se ACERTA.

Decisão do Paulo (29/09/2026): "o agente prepara, eu decido". Três placares + qualidade do dado:
  1. Projeção   — foto diária (intel_placar_projecao); no fim do mês: erro da projeção por dia útil.
  2. Nota       — foto semanal da nota dos leads (intel_placar_notas); 30/60 d depois: quentes × frios.
  3. Decisões   — usa as fotos diárias do motor (shared_kv 'decisoes:v1:<dia>', desde 23/09): quanto
                  tempo cada problema fica aberto, se virou tarefa e se resolve mais rápido com tarefa.
  +  Qualidade  — por corretor: quantos leads são descartados no 1º degrau, sem interação, parados.

Banco pequeno (memória "house-psm-db-fragil"): fotos pequenas, 1 gravação/dia, leituras com cache.
"""
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_V3 = os.path.dirname(_HERE)
for _p in (_HERE, _V3):
    if _p not in sys.path:
        sys.path.append(_p)
import _metricas_lib as MX  # type: ignore
import _projecao_lib as PJ  # type: ignore

EQUIPES = ("conquista", "map", "terceiros", "locacao")
NIVEL = {"novo_atend": 1, "tent_contato": 1, "contato_qual": 2, "precisa_ag": 3, "vis_agend": 3,
         "vis_real": 4, "proposta": 5, "contrato": 6}
COM_TAREFA = ("em_andamento", "atrasada", "resolvendo", "persistiu")


def segunda(d):
    return d - timedelta(days=d.weekday())


# ─── 1. Projeção: foto diária ─────────────────────────────────────────────────
def gravar_projecao(sb, hoje=None):
    hoje = hoje or MX.hoje_brt()
    ja = sb.table("intel_placar_projecao").select("dia").eq("dia", hoje.isoformat()).limit(1).execute().data or []
    if ja:
        return {"projecao": "já gravada hoje"}
    pj = PJ.projecao(sb, {"h": "mes"}, hoje=hoje)
    du = ((pj.get("horizonte") or {}).get("dias_uteis") or {})
    blocos = [("_empresa", pj.get("empresa") or {})] + [(k, v) for k, v in (pj.get("equipes") or {}).items() if k in EQUIPES]

    def g(b, k, c):
        return ((b.get(k) or {}).get(c))

    linhas = [{
        "dia": hoje.isoformat(), "equipe": eq, "mes": f"{hoje.year:04d}-{hoje.month:02d}",
        "realizado_vgv": g(b, "realizado", "vgv"), "realizado_vendas": g(b, "realizado", "vendas"),
        "provavel_vgv": g(b, "provavel", "vgv"), "provavel_vendas": g(b, "provavel", "vendas"),
        "conservador_vgv": g(b, "conservador", "vgv"), "otimista_vgv": g(b, "otimista", "vgv"),
        "meta_vgv": g(b, "meta", "vgv"), "meta_vendas": g(b, "meta", "vendas"),
        "du_decorridos": du.get("decorridos"), "du_total": du.get("total"),
    } for eq, b in blocos if b]
    if linhas:
        sb.table("intel_placar_projecao").upsert(linhas, on_conflict="dia,equipe").execute()
    return {"projecao": f"{len(linhas)} linhas"}


def placar_projecao(sb, hoje):
    """Para cada mês FECHADO: erro de cada foto contra o realizado final, por dia útil."""
    rows = sb.table("intel_placar_projecao").select(
        "dia,equipe,mes,realizado_vgv,provavel_vgv,du_decorridos,du_total").order("dia").execute().data or []
    if not rows:
        return {"status": "coletando", "desde": None, "texto": "Começou a gravar hoje. Primeiro resultado no fechamento do mês."}
    mes_atual = f"{hoje.year:04d}-{hoje.month:02d}"
    por_mes = defaultdict(list)
    for r in rows:
        por_mes[(r["mes"], r["equipe"])].append(r)
    meses = []
    for (mes, eq), fotos in sorted(por_mes.items()):
        if mes >= mes_atual:
            continue
        final = float(fotos[-1].get("realizado_vgv") or 0)   # a última foto do mês ≈ realizado final
        pts = []
        for f in fotos:
            prev = float(f.get("provavel_vgv") or 0)
            if final > 0:
                pts.append({"du": f.get("du_decorridos"), "erro_pct": round(abs(prev - final) / final * 100, 1)})
        confiavel = next((p["du"] for p in pts if all(q["erro_pct"] <= 10 for q in pts if (q["du"] or 0) >= (p["du"] or 0))), None)
        meses.append({"mes": mes, "equipe": eq, "realizado_final": final, "pontos": pts, "confiavel_a_partir_du": confiavel})
    desde = rows[0]["dia"]
    if not meses:
        return {"status": "coletando", "desde": desde,
                "texto": f"Gravando desde {desde}. Primeiro resultado no fechamento de {mes_atual}."}
    return {"status": "ok", "desde": desde, "meses": meses}


# ─── 2. Nota dos leads: foto semanal ──────────────────────────────────────────
def gravar_notas(sb, hoje=None):
    hoje = hoje or MX.hoje_brt()
    sem = segunda(hoje)
    ja = sb.table("intel_placar_notas").select("deal_id").eq("semana", sem.isoformat()).limit(1).execute().data or []
    if ja:
        return {"notas": "já gravadas nesta semana"}
    from _brain_lib import channel_winrates, score_open  # type: ignore
    agora = datetime.now(timezone.utc)
    fora = MX.emails_fora(sb)
    cols = "id,amount,win,closed_at,created_at_rd,updated_at_rd,stage_name,user_id,user_email,pipeline_name,rd_raw"
    fech = MX._paginado(lambda: sb.table("deals").select("win,rd_raw,user_email")
                        .gte("closed_at", (agora - timedelta(days=120)).isoformat()).order("id"), cap=10)
    overall, ch_wr, ch_n = channel_winrates(MX.sem_fora(fech, fora))
    abertos = MX._paginado(lambda: sb.table("deals").select(cols).is_("win", "null")
                           .gte("created_at_rd", (agora - timedelta(days=60)).isoformat()).order("id"), cap=10)
    linhas = []
    for d in MX.sem_fora(abertos, fora):
        s = score_open(d, overall, ch_wr, ch_n, agora)
        if not s:
            continue
        linhas.append({"semana": sem.isoformat(), "deal_id": str(d["id"]), "score": s["score"], "temp": s["temp"],
                       "ms": s["ms"], "canal": s["canal"], "user_id": d.get("user_id"), "user_email": d.get("user_email"),
                       "pipeline": d.get("pipeline_name"), "amount": s["amount"], "created_at_rd": d.get("created_at_rd")})
    for i in range(0, len(linhas), 500):
        sb.table("intel_placar_notas").upsert(linhas[i:i + 500], on_conflict="semana,deal_id").execute()
    return {"notas": f"{len(linhas)} negócios pontuados na semana {sem.isoformat()}"}


def placar_notas(sb, hoje):
    """Fotos com 30+ dias: quanto de cada temperatura avançou e vendeu depois."""
    fotos = sb.table("intel_placar_notas").select("semana").order("semana").limit(1).execute().data or []
    if not fotos:
        return {"status": "coletando", "texto": "Primeira foto sai nesta semana. Resultado 30 dias depois."}
    desde = fotos[0]["semana"]
    corte = (hoje - timedelta(days=30)).isoformat()
    rows = sb.table("intel_placar_notas").select("semana,deal_id,temp").lte("semana", corte).execute().data or []
    if not rows:
        return {"status": "coletando", "desde": desde,
                "texto": f"Fotografando desde {desde}. Primeiro resultado em {(date.fromisoformat(desde) + timedelta(days=30)).strftime('%d/%m')}."}
    ids = sorted({r["deal_id"] for r in rows})
    destino = {}
    for i in range(0, len(ids), 150):
        for d in sb.table("deals").select("id,win,stage_id").in_("id", ids[i:i + 150]).execute().data or []:
            destino[str(d["id"])] = d
    chave = {str(s["id"]): s.get("psm_stage_key") for s in (sb.table("rd_stages").select("id,psm_stage_key").execute().data or [])}
    grp = defaultdict(lambda: {"n": 0, "visita": 0, "venda": 0})
    for r in rows:
        d = destino.get(r["deal_id"]) or {}
        g = grp[r["temp"]]
        g["n"] += 1
        nivel = NIVEL.get(chave.get(str(d.get("stage_id"))), 0)   # perdido fica na coluna onde parou
        if d.get("win") is True:
            g["venda"] += 1
        if d.get("win") is True or nivel >= 4:
            g["visita"] += 1
    out = {t: {**v, "visita_pct": round(v["visita"] / v["n"] * 100, 1) if v["n"] else None,
               "venda_pct": round(v["venda"] / v["n"] * 100, 2) if v["n"] else None} for t, v in grp.items()}
    q, f = out.get("quente", {}), out.get("frio", {})
    lift = round(q["venda_pct"] / f["venda_pct"], 1) if q.get("venda_pct") and f.get("venda_pct") else None
    return {"status": "ok", "desde": desde, "grupos": out, "lift_quente_frio": lift,
            "veredito": (None if lift is None else ("a nota funciona" if lift >= 3 else "a nota não separa bem — recalibrar"))}


# ─── 3. Decisões: histórico das fotos diárias do motor ────────────────────────
def placar_decisoes(sb, hoje):
    rows = sb.table("shared_kv").select("key,value").like("key", "decisoes:v1:%").execute().data or []
    dias = []
    for r in rows:
        try:
            dia = date.fromisoformat(r["key"].split(":")[-1])
        except ValueError:
            continue
        v = r.get("value") or {}
        dias.append((dia, (v.get("data") if isinstance(v, dict) else None) or []))
    dias.sort()
    if not dias:
        return {"status": "sem_dados"}
    ultimo = dias[-1][0]
    vis = {}
    for dia, lista in dias:
        for d in lista:
            if not isinstance(d, dict) or not d.get("id"):
                continue
            s = vis.setdefault(d["id"], {"tipo": d.get("tipo"), "label": d.get("tipo_label") or d.get("tipo"),
                                         "primeiro": dia, "ultimo": dia, "tarefa": False})
            s["ultimo"] = dia
            if ((d.get("estado") or {}).get("status")) in COM_TAREFA:
                s["tarefa"] = True
    por_tipo = defaultdict(lambda: {"total": 0, "abertas": 0, "resolvidas": 0, "com_tarefa": 0,
                                    "dias_res": [], "dias_res_tarefa": [], "dias_res_sem": [], "idade_abertas": []})
    for s in vis.values():
        t = por_tipo[s["label"]]
        t["total"] += 1
        t["com_tarefa"] += int(s["tarefa"])
        if s["ultimo"] < ultimo:   # sumiu do motor = problema resolvido
            dur = (s["ultimo"] - s["primeiro"]).days + 1
            t["resolvidas"] += 1
            t["dias_res"].append(dur)
            (t["dias_res_tarefa"] if s["tarefa"] else t["dias_res_sem"]).append(dur)
        else:
            t["abertas"] += 1
            t["idade_abertas"].append((ultimo - s["primeiro"]).days + 1)

    def med(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    tipos = [{"tipo": k, "total": v["total"], "abertas": v["abertas"], "resolvidas": v["resolvidas"],
              "com_tarefa": v["com_tarefa"], "dias_para_resolver": med(v["dias_res"]),
              "dias_com_tarefa": med(v["dias_res_tarefa"]), "dias_sem_tarefa": med(v["dias_res_sem"]),
              "idade_media_abertas": med(v["idade_abertas"])} for k, v in por_tipo.items()]
    tipos.sort(key=lambda x: -x["total"])
    tot = {k: sum(t[k] for t in tipos) for k in ("total", "abertas", "resolvidas", "com_tarefa")}
    return {"status": "ok", "desde": dias[0][0].isoformat(), "ate": ultimo.isoformat(), "dias": len(dias),
            "totais": tot, "tipos": tipos}


# ─── + Qualidade do dado: o lead foi trabalhado ou descartado cedo? ───────────
def qualidade(sb, hoje):
    agora = datetime.now(timezone.utc)
    fora = MX.emails_fora(sb)
    cols = "id,user_id,user_email,stage_id,win,created_at_rd,nint:rd_raw->interactions,lr:rd_raw->deal_lost_reason->>name"
    rows = MX._paginado(lambda: sb.table("deals").select(cols)
                        .gte("created_at_rd", (agora - timedelta(days=30)).isoformat())
                        .lt("created_at_rd", (agora - timedelta(hours=48)).isoformat()).order("id"), cap=10)
    rows = MX.sem_fora(rows, fora)
    chave = {str(s["id"]): s.get("psm_stage_key") for s in (sb.table("rd_stages").select("id,psm_stage_key").execute().data or [])}
    nomes = {str(u["id"]): u.get("name") or u["id"] for u in (sb.table("users").select("id,name").execute().data or [])}
    emails = {(u.get("email") or "").lower(): u.get("name") for u in (sb.table("users").select("name,email").execute().data or []) if u.get("email")}
    pessoas = defaultdict(lambda: {"entraram": 0, "descartados_cedo": 0, "sem_interacao": 0, "parados_1o": 0,
                                   "avancaram": 0, "motivos": defaultdict(int)})
    for d in rows:
        dono = nomes.get(str(d.get("user_id") or "")) or emails.get((d.get("user_email") or "").lower()) or "sem dono"
        p = pessoas[dono]
        p["entraram"] += 1
        nivel = NIVEL.get(chave.get(str(d.get("stage_id"))), 0)
        nint = d.get("nint")
        try:
            nint = int(nint) if nint is not None else None
        except (TypeError, ValueError):
            nint = None
        if d.get("win") is True or nivel >= 2:
            p["avancaram"] += 1
        elif d.get("win") is False:
            p["descartados_cedo"] += 1
            p["motivos"][(d.get("lr") or "sem motivo").strip()] += 1
        elif nint == 0:
            p["sem_interacao"] += 1
        else:
            p["parados_1o"] += 1
    out = []
    for nome, p in pessoas.items():
        top = sorted(p["motivos"].items(), key=lambda x: -x[1])[:2]
        out.append({"nome": nome, **{k: p[k] for k in ("entraram", "descartados_cedo", "sem_interacao", "parados_1o", "avancaram")},
                    "descartados_pct": round(p["descartados_cedo"] / p["entraram"] * 100, 1) if p["entraram"] else None,
                    "motivos_top": [{"motivo": m, "n": n} for m, n in top]})
    out.sort(key=lambda x: -x["entraram"])
    tot = {k: sum(x[k] for x in out) for k in ("entraram", "descartados_cedo", "sem_interacao", "parados_1o", "avancaram")}
    return {"janela": "leads que entraram há 2 a 30 dias", "totais": tot, "corretores": out}
