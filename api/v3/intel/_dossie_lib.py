"""
_dossie_lib — DOSSIÊ COMPLETO do negócio pra alimentar as análises de IA. v84.4

A auditoria de jul/2026 achou o porquê da Inteligência "não funcionar": a IA
recebia ~10 números agregados (dieta de pobre) num modelo pequeno. Este módulo
monta o CONTEXTO RICO — custos reais, break-even, frentes, funil, mídia,
reativação, concorrência e continuidade (briefing anterior + ordens) — e todas
as análises (analyze, briefing, insights) comem do mesmo prato.

⚠️ CÓPIA SINCRONIZADA: vive em api/v3/ia/ E api/v3/intel/ (Vercel isola os dirs,
mesmo padrão do _auth_lib). Mudou aqui → copiar pra lá.
"""
import json
from datetime import datetime, timezone

# espelho das premissas default do viab.py (fonte: Paulo, jul/2026) — o orçamento
# salvo (viab_orcamento) sobrepõe quando existir.
PREMISSAS = {
    "map":       {"bruta": 4.0, "corretor": 2.0, "gerente": 0.0,  "imposto": 8.0},
    "conquista": {"bruta": 4.0, "corretor": 1.5, "gerente": 0.25, "imposto": 8.0},
    "terceiros": {"bruta": 6.0, "corretor": 3.0, "gerente": 0.0,  "imposto": 8.0},
    "locacoes":  {"bruta": 100.0, "corretor": 30.0, "gerente": 0.0, "imposto": 8.0},
}


def _kv(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else default
        if isinstance(v, str):
            v = json.loads(v)
        return v if v is not None else default
    except Exception:
        return default


def _brl(n):
    try:
        return f"R$ {float(n):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "R$ ?"


def compile_dossie(sb, frente_of):
    """Monta o dossiê em markdown compacto. frente_of vem do _auth_lib do chamador."""
    now = datetime.now(timezone.utc)
    ano, mes = now.year, now.month
    L = []
    L.append(f"# DOSSIÊ PSM — {now.strftime('%d/%m/%Y')} (dados reais do sistema)")

    # ── custos reais (Viabilidade) ──
    try:
        vc = (_kv(sb, "viab_custos_orcado", {}) or {}).get(str(ano)) or {}
        itens = vc.get("itens") or []
        fixo = sum(float(i.get("valor") or 0) for i in itens if (i.get("classe") or "fixo") == "fixo")
        var_pct = sum(float(i.get("valor") or 0) for i in itens if i.get("classe") == "variavel")
        pl = sum(float(i.get("valor") or 0) for i in itens
                 if "labore" in (i.get("desc") or "").lower() or (i.get("cat") == "Sócios"))
        rateiam = vc.get("rateio_empresas") or ["map", "conquista", "locacoes", "terceiros"]
        L.append(f"\n## Custos reais (mensal)\n- Custo fixo total: {_brl(fixo)}/mês ({len(itens)} itens) · "
                 f"pró-labore sócios (Paulo+Isabella): {_brl(pl)} · custo variável: {var_pct:.2f}% do VGV\n"
                 f"- Sem pró-labore: {_brl(fixo - pl)}/mês · Frentes que rateiam o overhead: {', '.join(rateiam)}")
    except Exception:
        fixo, pl = 0, 0

    # ── metas × realizado + realizado por frente ──
    realizado_fr = {}
    vgv_ano = 0.0
    vendas_ano = 0
    vgv_mes_atual = 0.0
    try:
        meta = sum(float(m.get("meta_vgv") or 0) for m in
                   (sb.table("metas").select("meta_vgv").eq("ano", ano).execute().data or []))
        dd = sb.table("deals").select("amount,closed_at,pipeline_name").eq("win", True) \
            .gte("closed_at", f"{ano}-01-01T00:00:00+00:00").execute().data or []
        for d in dd:
            amt = float(d.get("amount") or 0)
            fr = frente_of(d.get("pipeline_name"))
            realizado_fr.setdefault(fr, [0.0, 0])
            realizado_fr[fr][0] += amt
            realizado_fr[fr][1] += 1
            vgv_ano += amt
            vendas_ano += 1
            try:
                if datetime.fromisoformat(str(d["closed_at"]).replace("Z", "+00:00")).month == mes:
                    vgv_mes_atual += amt
            except Exception:
                pass
        atg = f"{vgv_ano / meta * 100:.0f}%" if meta else "sem meta"
        por_fr = " · ".join(f"{f}: {_brl(v[0])} ({v[1]}v)" for f, v in sorted(realizado_fr.items(), key=lambda x: -x[1][0]))
        L.append(f"\n## Vendas {ano} (CRM real)\n- VGV ano: {_brl(vgv_ano)} em {vendas_ano} vendas · mês atual: {_brl(vgv_mes_atual)}\n"
                 f"- Meta anual: {_brl(meta)} → atingimento {atg} (meta reconhecidamente descalibrada; será refeita)\n"
                 f"- Por frente: {por_fr or '—'}")
    except Exception:
        pass

    # ── margens/premissas + break-even ──
    try:
        prem = " · ".join(f"{f}: bruta {p['bruta']}% − corretor {p['corretor']}% − gerente {p['gerente']}% − imposto {p['imposto']}% s/comissão"
                          for f, p in PREMISSAS.items() if f != "locacoes")
        mg_conq = PREMISSAS["conquista"]
        margem_conq = mg_conq["bruta"] - mg_conq["corretor"] - mg_conq["gerente"] - mg_conq["bruta"] * mg_conq["imposto"] / 100
        be_com = (fixo / (margem_conq / 100)) if margem_conq else 0
        be_sem = ((fixo - pl) / (margem_conq / 100)) if margem_conq else 0
        L.append(f"\n## Economia do negócio\n- Premissas de comissão: {prem}\n"
                 f"- Margem líquida Conquista ≈ {margem_conq:.2f}% do VGV → break-even só-Conquista: "
                 f"{_brl(be_com)}/mês de VGV (com pró-labore) · {_brl(be_sem)} (sem)\n"
                 f"- Sócio vendendo direto (Terceiros/MAP) retém ~4,5% — 3× a margem de corretagem; "
                 f"Locação: adm recorrente ~10% do aluguel é piso mensal que não zera")
    except Exception:
        pass

    # ── pipeline aberto por frente ──
    try:
        aberto = {}
        pg = 0
        while pg < 6:
            rows = sb.table("deals").select("pipeline_name,amount,updated_at_rd").is_("win", "null") \
                .range(pg * 1000, pg * 1000 + 999).execute().data or []
            for d in rows:
                fr = frente_of(d.get("pipeline_name"))
                aberto.setdefault(fr, [0, 0.0, 0])
                aberto[fr][0] += 1
                aberto[fr][1] += float(d.get("amount") or 0)
                try:
                    dias = (now - datetime.fromisoformat(str(d.get("updated_at_rd")).replace("Z", "+00:00"))).days
                    if dias > 30:
                        aberto[fr][2] += 1
                except Exception:
                    pass
            if len(rows) < 1000:
                break
            pg += 1
        txt = " · ".join(f"{f}: {v[0]} negócios ({_brl(v[1])}; {v[2]} parados +30d)"
                         for f, v in sorted(aberto.items(), key=lambda x: -x[1][0]))
        L.append(f"\n## Pipeline aberto (CRM)\n- {txt or '—'}")
    except Exception:
        pass

    # ── mídia (Meta Ads real) ──
    try:
        ads = sb.table("meta_ads_monthly").select("ano,mes,spend").order("ano", desc=True) \
            .order("mes", desc=True).limit(3).execute().data or []
        if ads:
            L.append("\n## Mídia (Meta Ads, gasto real)\n- " +
                     " · ".join(f"{a['mes']}/{a['ano']}: {_brl(a.get('spend'))}" for a in ads))
    except Exception:
        pass

    # ── reativação MAP (fila + campanha) ──
    try:
        estado = _kv(sb, "reativacao_map", {}) or {}
        cont = {}
        for st in estado.values():
            s = (st or {}).get("st") or "?"
            cont[s] = cont.get(s, 0) + 1
        sends30 = sb.table("wa_sends").select("id,is_sim").gte(
            "sent_at", f"{ano}-01-01T00:00:00+00:00").execute().data or []
        sim = len([s for s in sends30 if s.get("is_sim")])
        L.append(f"\n## Reativação MAP (base ~1.849 leads parados; margem de sócio 4,5% se Paulo fecha)\n"
                 f"- Fila trabalhada: {json.dumps(cont, ensure_ascii=False) if cont else 'ainda não começou'} · "
                 f"campanha WA: {len(sends30)} envios no ano, {sim} responderam SIM")
    except Exception:
        pass

    # ── concorrência ──
    try:
        cc = sb.table("concorrentes").select("nome,seguidores,anuncios_count") \
            .order("anuncios_count", desc=True).limit(8).execute().data or []
        if cc:
            L.append("\n## Concorrência (radar)\n- " +
                     " · ".join(f"{c.get('nome')} ({c.get('seguidores') or '?'} seg, {c.get('anuncios_count') or 0} ads)"
                                for c in cc))
    except Exception:
        pass

    # ── continuidade: briefing anterior + ordens ──
    try:
        wb = sb.table("war_briefings").select("created_at,briefing").order("created_at", desc=True) \
            .limit(1).execute().data or []
        if wb:
            dt = str(wb[0].get("created_at") or "")[:10]
            L.append(f"\n## Briefing anterior ({dt}) — pra dar CONTINUIDADE, não repetir\n"
                     + (wb[0].get("briefing") or "")[:900])
        ordens = _kv(sb, "war_ordens", {}) or {}
        if ordens.get("itens"):
            st = "; ".join(f"[{'x' if o.get('feito') else ' '}] {o.get('txt')}" for o in ordens["itens"][:6])
            L.append(f"\n## Ordens da semana passada (status real)\n- {st}")
    except Exception:
        pass

    L.append("\n## Contexto fixo\n- PSM Imóveis, São José do Rio Preto/SP. Sócios: Paulo (closer, agenda limitada ~3-4 fechamentos/mês) e Isabella (operação, não vende). "
             "Equipe Conquista limitada (~7 corretores, 0,33 venda/corretor/mês). Frentes MAP/Terceiros/Locação pausadas (sem equipe dedicada). "
             "Mariane (recepção) opera a fila de reativação. Objetivo nº1: break-even sem pró-labore; nº2: com pró-labore.")
    return "\n".join(L)
