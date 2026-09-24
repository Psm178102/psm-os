"""
_meudia_lib.py — ☀️ MEU DIA: o que cada pessoa precisa saber e fazer HOJE, numa mensagem só. v87.93

Pedido do Paulo (17/09/2026): "seria incrível se fosse passado para o corretor os avisos, recados,
compromissos, o que ele precisa fazer no dia!"

Diagnóstico que motivou (17/09): o resumo diário existia (alertas/cron_push) mas nunca chegou a ninguém —
o cron da Vercel não dispara e só 1 dos 8 corretores tem notificação ativada no celular. Informação
parada na tela não chega a quem precisa agir.

Mesma composição em TODO canal (tela, sino, push no celular e WhatsApp):
  📅 Agenda de hoje   compromissos com horário, plantão e treinamentos
  ✅ Fazer hoje        decisões do motor em que a pessoa é dona (proposta parada, lead sem contato, 1:1,
                       RD×HUB…), tarefas atrasadas e de hoje
  📣 Recados           recados ativos da diretoria (faixa do topo) e do mural
  🎯 Meu mês           vendido × meta, projeção provável e quanto falta por dia útil (quem tem meta)
"""
from datetime import datetime, timedelta, timezone

import _metricas_lib as MX

TAREFA_DONE = ("concluida", "concluída", "cancelada", "feita", "done")
PLANTAO_DONE = ("concluido", "realizado", "cancelado")
EVENTO_DONE = ("cancelado", "realizado")
DEC_ESTADOS_ACAO = ("nova", "atrasada", "persistiu", "em_andamento")
KV_ENVIADO = "meu_dia_enviado"


def _brl(v):
    """v88.37 (Paulo, 24/set): R$ sempre cheio com centavos — nunca "mil"/"mi"."""
    n = float(v or 0)
    return ("-" if n < 0 else "") + "R$ " + f"{abs(n):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def _hm(v):
    s = str(v or "")[:5]
    return s if len(s) == 5 and s[2] == ":" else ""


# ─── cargas compartilhadas (1 leitura pra todos os usuários no cron) ─────────
def carregar(sb, hoje):
    hoje_iso = hoje.isoformat()
    out = {"hoje": hoje, "eventos": [], "plantoes": [], "tarefas": [], "recados_tl": [], "recados": [], "users": []}
    try:
        out["users"] = [u for u in (sb.table("users").select("id,name,email,role,team,status,is_service,whatsapp").execute().data or [])
                        if u.get("id")]
    except Exception:
        out["users"] = [u for u in (sb.table("users").select("id,name,email,role,team,status,is_service").execute().data or []) if u.get("id")]
    try:
        out["eventos"] = sb.table("eventos").select("id,titulo,data,hora_inicio,hora_fim,all_day,local,status,corretor_id,criado_por,owner_id,participantes,aceites,tipo") \
            .eq("data", hoje_iso).limit(3000).execute().data or []
    except Exception:
        pass
    try:
        out["plantoes"] = sb.table("plantoes").select("corretor_id,data,periodo,status").eq("data", hoje_iso).limit(500).execute().data or []
    except Exception:
        pass
    try:
        out["tarefas"] = sb.table("dir_tasks").select("id,titulo,status,prazo,responsavel,hora_inicio,prioridade,categoria") \
            .lte("prazo", hoje_iso).limit(5000).execute().data or []
    except Exception:
        pass
    try:
        v = MX._kv_read(sb, "timeline_recados") or {}
        agora = datetime.now(timezone.utc).isoformat()
        its = (v.get("items") if isinstance(v, dict) else None) or []
        out["recados_tl"] = [i for i in its if isinstance(i, dict) and (not i.get("expira_em") or str(i["expira_em"]) > agora)]
    except Exception:
        pass
    try:
        agora = datetime.now(timezone.utc).isoformat()
        out["recados"] = [r for r in (sb.table("recados").select("*").limit(200).execute().data or [])
                          if not r.get("data_fim") or str(r["data_fim"]) > agora]
    except Exception:
        pass
    return out


def _aud_ok(aud, user, lvl):
    a = (aud or "todos").strip().lower()
    if a in ("", "todos", "all"):
        return True
    if a.startswith("equipe:"):
        return (user.get("team") or "").strip().lower() == a.split(":", 1)[1].strip()
    return {"corretores": lvl <= 2, "lideres": lvl >= 5, "gerencia": lvl >= 7, "diretoria": lvl >= 10}.get(a, True)


def compor(user, base, decisoes=None, projecao=None, lvl=0):
    """→ {secoes:[{id,titulo,itens:[{hora,texto,link,nivel}]}], resumo:{...}, titulo, corpo, whatsapp}"""
    uid = user["id"]
    hoje = base["hoje"]
    hoje_iso = hoje.isoformat()
    primeiro = (user.get("name") or "").split(" ")[0] or "tudo bem"

    # 📅 agenda
    agenda = []
    for e in base["eventos"]:
        if str(e.get("id") or "").startswith("evtk_") or (e.get("status") or "") in EVENTO_DONE:
            continue
        ac = e.get("aceites") or {}
        quem = {e.get("corretor_id") or e.get("criado_por") or e.get("owner_id")}
        quem |= {p for p in (e.get("participantes") or []) if ac.get(p) not in ("pendente", "recusado")}
        if uid not in quem:
            continue
        h = "" if e.get("all_day") else _hm(e.get("hora_inicio"))
        txt = (e.get("titulo") or "Compromisso")[:80] + (f" · 📍 {e['local'][:40]}" if e.get("local") else "")
        pend = ac.get(uid) == "pendente"
        agenda.append({"hora": h, "texto": txt + (" (convite sem resposta)" if pend else ""), "link": "#/", "nivel": "info"})
    for p in base["plantoes"]:
        if p.get("corretor_id") == uid and (p.get("status") or "") not in PLANTAO_DONE:
            agenda.append({"hora": "", "texto": f"Plantão {p.get('periodo') or ''}".strip(), "link": "#/plantoes", "nivel": "info"})
    agenda.sort(key=lambda x: (x["hora"] == "", x["hora"]))

    # ✅ fazer hoje
    fazer = []
    for d in (decisoes or []):
        if d["dono"]["id"] != uid or d["estado"]["status"] not in DEC_ESTADOS_ACAO:
            continue
        if d["prazo"] > hoje_iso and d["estado"]["status"] == "em_andamento":
            continue
        marca = {"atrasada": " (atrasada)", "persistiu": " (continua sem resolver)"}.get(d["estado"]["status"], "")
        fazer.append({"hora": "", "texto": d["titulo"] + marca, "link": d.get("link") or "#/",
                      "nivel": "critico" if d["nivel"] == "critico" else "atencao", "detalhe": d["porque"]})
    atrasadas, de_hoje = [], []
    for t in base["tarefas"]:
        if t.get("responsavel") != uid or (t.get("status") or "").lower() in TAREFA_DONE:
            continue
        if t.get("categoria") == "Decisão":
            continue   # já aparece como decisão, sem duplicar
        pz = str(t.get("prazo") or "")[:10]
        if not pz:
            continue
        (atrasadas if pz < hoje_iso else de_hoje).append(t)
    if atrasadas:
        atrasadas.sort(key=lambda t: str(t.get("prazo")))
        dias = (hoje - datetime.fromisoformat(str(atrasadas[0]["prazo"])[:10]).date()).days
        fazer.append({"hora": "", "texto": f"{len(atrasadas)} tarefa(s) atrasada(s) — a mais antiga há {dias} dia(s): {atrasadas[0].get('titulo', '')[:60]}",
                      "link": "#/", "nivel": "critico"})
    for t in sorted(de_hoje, key=lambda t: (_hm(t.get("hora_inicio")) or "99"))[:6]:
        fazer.append({"hora": _hm(t.get("hora_inicio")), "texto": (t.get("titulo") or "Tarefa")[:80], "link": "#/", "nivel": "atencao"})

    # 📣 recados
    recados = []
    for r in base["recados_tl"][:5]:
        recados.append({"hora": "", "texto": (r.get("texto") or "")[:160], "link": "#/", "nivel": "info", "autor": r.get("autor")})
    for r in base["recados"]:
        if _aud_ok(r.get("audiencia"), user, lvl):
            recados.append({"hora": "", "texto": (r.get("texto") or "")[:160], "link": "#/",
                            "nivel": "critico" if r.get("prioridade") == "critica" else "info"})

    # 🎯 mês
    mes = []
    p = (projecao or {}).get("pessoas", {}).get(uid) if projecao else None
    if p and (p["meta"]["vgv"] or 0) > 0:
        hz = projecao.get("horizonte") or {}
        du = (hz.get("dias_uteis") or {}).get("restantes") or 0
        st = {"batida": "🏆 meta batida", "no_ritmo": "🟢 vai bater", "atras": "🟡 atrás", "fora": "🔴 fora do ritmo"}.get(p["status"], "")
        mes.append({"hora": "", "nivel": "critico" if p["status"] == "fora" else "info", "link": "#/",
                    "texto": f"Vendido {_brl(p['realizado']['vgv'])} de {_brl(p['meta']['vgv'])} · provável {_brl(p['provavel']['vgv'])} ({st})"
                             + (f" · faltam {_brl(p['falta_vgv'])} em {du} dias úteis" if p["falta_vgv"] and du else "")})

    secoes = [s for s in (
        {"id": "agenda", "titulo": "📅 Agenda de hoje", "itens": agenda},
        {"id": "fazer", "titulo": "✅ Fazer hoje", "itens": fazer},
        {"id": "recados", "titulo": "📣 Recados", "itens": recados},
        {"id": "mes", "titulo": "🎯 Meu mês", "itens": mes},
    )]
    n_ag, n_fz, n_rc = len(agenda), len(fazer), len(recados)
    crit = sum(1 for i in fazer if i["nivel"] == "critico")
    partes = []
    if n_ag:
        partes.append(f"{n_ag} compromisso{'s' if n_ag > 1 else ''}")
    if n_fz:
        partes.append(f"{n_fz} {'ações' if n_fz > 1 else 'ação'}" + (f" ({crit} urgente{'s' if crit > 1 else ''})" if crit else ""))
    if n_rc:
        partes.append(f"{n_rc} recado{'s' if n_rc > 1 else ''}")
    titulo = f"☀️ Bom dia, {primeiro}: " + (" · ".join(partes) if partes else "dia livre, bora prospectar")
    linhas = []
    primeiro_ag = agenda[0] if agenda else None
    if primeiro_ag:
        linhas.append(f"{primeiro_ag['hora'] + ' ' if primeiro_ag['hora'] else ''}{primeiro_ag['texto']}")
    if fazer:
        linhas.append("1º: " + fazer[0]["texto"])
    if recados:
        linhas.append("📣 " + recados[0]["texto"][:90])
    corpo = " · ".join(linhas)[:220] or "Abra o House e veja sua agenda."

    wz = [f"*☀️ Bom dia, {primeiro}!* Seu dia na PSM — {hoje.strftime('%d/%m')}"]
    for s in secoes:
        if not s["itens"]:
            continue
        wz.append("")
        wz.append(f"*{s['titulo']}*")
        for i in s["itens"][:8]:
            pre = "🔴 " if i["nivel"] == "critico" else ""
            wz.append(f"• {pre}{(i['hora'] + ' — ') if i.get('hora') else ''}{i['texto']}")
    if len(wz) == 1:
        wz.append("\nAgenda livre hoje. Bom dia pra prospectar e reativar a carteira. 💪")
    wz.append("\nAbra o House: https://www.housepsm.com.br/v2/")
    return {"pessoa": {"id": uid, "name": user.get("name")}, "hoje": hoje_iso, "secoes": secoes,
            "resumo": {"compromissos": n_ag, "acoes": n_fz, "urgentes": crit, "recados": n_rc},
            "titulo": titulo, "corpo": corpo, "whatsapp": "\n".join(wz)}
