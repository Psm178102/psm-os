"""
🤖 Sr. Gestor de Tráfego — MOTOR AUTOMÁTICO (fase 1 da autonomia, v88.87)

Política do Paulo (28/09/2026): o agente age SOZINHO em pausar, reativar,
ajustar e remanejar verba — "porém SEMPRE mantendo o orçamento definido pelo
Paulo". O orçamento é definido mês a mês por marca no Cérebro
(gt_config.orcamentos["AAAA-MM"] = {conquista, imoveis}). Sem orçamento do
mês, o motor NÃO mexe em verba — só faz a pausa de proteção (queima sem lead).

Nasce em MODO SOMBRA (gt_config.autonomia.ativo = false): calcula e mostra
"o que eu faria", sem executar. O sócio liga com um clique no Cérebro.

GET  ?cron=1                 → roda o ciclo se um horário venceu (10h/13h/16h/20h BRT)
                               e ainda não rodou hoje. CRON_SECRET.
GET                          → estado (lvl>=5): modo, ações de hoje, último ciclo.
POST {action:'rodar'}        → força um ciclo agora (sócio). Respeita o modo sombra.
POST {action:'desfazer', id} → desfaz uma ação automática (sócio).

Regras da fase 1 (todas protegem ou redistribuem — nunca passam do orçamento):
  R1  queima sem lead   — campanha gastou ≥ limite da marca HOJE e 0 lead → pausa.
  R2  CPL alto          — CPL dos últimos 3 dias > CPL máximo (com gasto relevante) → −20% de verba.
  R3  orçamento         — soma das verbas diárias ativas > o que cabe no mês → corta (piores primeiro, até −30%);
                          sobra relevante → aumenta as melhores (até +20%), sempre dentro do que cabe.
  R4  recomendações     — pendentes de pausa/verba/reativação saídas do relatório viram ação
                          (reativar e aumentar só se couber no orçamento).
Limites: máx de ações automáticas/dia (autonomia.max_acoes_dia) + guardrails do sócio
(R$/dia por objeto e variação máxima por ação).
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qsl
from datetime import datetime, timezone
import calendar
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, supabase_client, lvl_of,  # type: ignore
                       notify, send_web_push, agora_brt)
from gestor import (kv_get, kv_set, _graph_post, _graph_get_msg, log_acao,  # type: ignore
                    qualidade_leads, cod_campanha, recs_get, KV_CONFIG, KV_RECS,
                    GUARDRAILS_DEFAULT, CONTA_MARCA, _ID_RX, _now_iso)

KV = "gt_auto"
SLOTS = (10, 13, 16, 20)            # horários BRT do ciclo (20h pega as recomendações do relatório das 19h)
MARCA_LBL = {"conquista": "PSM Conquista", "imoveis": "PSM Imóveis"}
AUTONOMIA_DEFAULT = {
    "ativo": False,                                     # nasce em modo sombra
    "max_acoes_dia": 5,
    "queima_sem_lead": {"conquista": 40.0, "imoveis": 150.0},
    "cpl_alvo": {"conquista": 12.0, "imoveis": 60.0},
    "cpl_max": {"conquista": 18.0, "imoveis": 110.0},
    "fora_max_pct": 25.0,
    "campanhas_limite": {"dia": 1, "semana": 3, "mes": 6},   # usado na fase 4 (criar campanha)
}
PISO_VERBA = 10.0                   # R$/dia mínimo que o motor deixa num objeto


def autonomia(cfg):
    a = dict(AUTONOMIA_DEFAULT)
    for k, v in ((cfg or {}).get("autonomia") or {}).items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            a[k] = {**a[k], **v}
        else:
            a[k] = v
    return a


def mes_chave(agora):
    return agora.strftime("%Y-%m")


def dias_restantes(agora):
    ultimo = calendar.monthrange(agora.year, agora.month)[1]
    return ultimo - agora.day + 1


# ─── decisão (função pura — testável sem Meta) ──────────────────────────
def planejar(marcas, aut, orc_mes, dias_rest, qual_cod, guard):
    """marcas = {marca: {"gasto_mes": float, "camps": [
         {"id", "nome", "holders": [{"id", "tipo", "daily"}],
          "hoje": {"spend", "leads"}, "d3": {"spend", "leads"}}]}}
    Devolve a lista de ações planejadas, na ordem de prioridade."""
    acoes = []
    teto = float(guard.get("orcamento_max_brl_dia") or 500)
    for marca, m in marcas.items():
        alvo = float(aut["cpl_alvo"].get(marca) or 0) or None
        maxc = float(aut["cpl_max"].get(marca) or 0) or None
        queima = float(aut["queima_sem_lead"].get(marca) or 0) or None
        fora_max = float(aut.get("fora_max_pct") or 25)
        camps = m.get("camps") or []

        def fora(c):
            return (qual_cod.get(cod_campanha(c.get("nome")) or "") or {}).get("pct_fora")

        def cpl3(c):
            d = c.get("d3") or {}
            return (d.get("spend") or 0) / d["leads"] if d.get("leads") else None

        # R1 — queima sem lead hoje → pausa
        pausadas = set()
        if queima:
            for c in camps:
                h = c.get("hoje") or {}
                if (h.get("spend") or 0) >= queima and not h.get("leads"):
                    acoes.append({"regra": "R1", "marca": marca, "op": "pause", "tipo": "campaign",
                                  "alvo": c["id"], "nome": c.get("nome"), "antes": "ACTIVE", "depois": "PAUSED",
                                  "motivo": f"gastou R$ {h['spend']:.0f} hoje sem nenhum lead "
                                            f"(limite {MARCA_LBL[marca]}: R$ {queima:.0f})"})
                    pausadas.add(c["id"])
        vivos = [c for c in camps if c["id"] not in pausadas]
        mexidos = set()

        # R3 — cabe no orçamento do mês?
        B = (orc_mes or {}).get(marca)
        if B:
            cabe_dia = max(0.0, float(B) - float(m.get("gasto_mes") or 0)) / max(1, dias_rest)
            soma = sum(h["daily"] for c in vivos for h in c.get("holders") or [])

            def pior(c):
                v = cpl3(c)
                base = (v / alvo) if (v is not None and alvo) else 99.0
                f = fora(c)
                return base * (1 + (f or 0) / 100)

            if soma > cabe_dia * 1.05:
                excesso = soma - cabe_dia
                for c in sorted(vivos, key=pior, reverse=True):
                    for h in c.get("holders") or []:
                        if excesso <= 0.5:
                            break
                        corte = min(h["daily"] * 0.30, excesso, h["daily"] - PISO_VERBA)
                        if corte < 1:
                            continue
                        acoes.append({"regra": "R3", "marca": marca, "op": "budget", "tipo": h["tipo"],
                                      "alvo": h["id"], "nome": c.get("nome"), "antes": round(h["daily"], 2),
                                      "depois": round(h["daily"] - corte, 2),
                                      "motivo": f"o mês não comporta: cabem R$ {cabe_dia:.0f}/dia no orçamento de "
                                                f"R$ {float(B):,.0f} e as verbas somam R$ {soma:.0f}/dia — corto primeiro "
                                                f"quem tem pior custo/qualidade"})
                        mexidos.add(h["id"])
                        excesso -= corte
            elif soma < cabe_dia * 0.85 and alvo:
                folga = cabe_dia - soma
                boas = [c for c in vivos
                        if (c.get("d3") or {}).get("leads", 0) >= 3 and cpl3(c) is not None and cpl3(c) <= alvo
                        and (fora(c) is None or fora(c) <= fora_max)]
                for c in sorted(boas, key=pior):
                    for h in c.get("holders") or []:
                        if folga <= 0.5:
                            break
                        aum = min(h["daily"] * 0.20, folga, teto - h["daily"])
                        if aum < 1:
                            continue
                        acoes.append({"regra": "R3", "marca": marca, "op": "budget", "tipo": h["tipo"],
                                      "alvo": h["id"], "nome": c.get("nome"), "antes": round(h["daily"], 2),
                                      "depois": round(h["daily"] + aum, 2),
                                      "motivo": f"sobra orçamento (cabem R$ {cabe_dia:.0f}/dia, verbas somam "
                                                f"R$ {soma:.0f}/dia) — reforço quem tem CPL de R$ {cpl3(c):.2f} "
                                                f"dentro do alvo e lead do raio"})
                        mexidos.add(h["id"])
                        folga -= aum

        # R2 — CPL de 3 dias acima do máximo → −20%
        if maxc:
            for c in vivos:
                v = cpl3(c)
                gasto3 = (c.get("d3") or {}).get("spend") or 0
                if v is None or v <= maxc or gasto3 < 2 * maxc:
                    continue
                for h in c.get("holders") or []:
                    if h["id"] in mexidos:
                        continue
                    novo = round(h["daily"] * 0.80, 2)
                    if novo < PISO_VERBA:
                        continue
                    acoes.append({"regra": "R2", "marca": marca, "op": "budget", "tipo": h["tipo"],
                                  "alvo": h["id"], "nome": c.get("nome"), "antes": round(h["daily"], 2),
                                  "depois": novo,
                                  "motivo": f"CPL dos últimos 3 dias em R$ {v:.2f}, acima do máximo de R$ {maxc:.0f}"})
                    mexidos.add(h["id"])
    ordem = {"R1": 0, "R3": 1, "R2": 2, "R4": 3}
    return sorted(acoes, key=lambda a: ordem.get(a["regra"], 9))


# ─── leitura do Meta ───────────────────────────────────────────────────
RESULTADOS = ("lead", "onsite_conversion.messaging_conversation_started_7d")


def _leads(actions):
    """Resultado = lead (formulário/site) OU conversa iniciada (clique pro WhatsApp).
    Sem contar conversa, o R1 pausaria por engano campanha de WhatsApp da Vera."""
    tot = 0
    for a in actions or []:
        if a.get("action_type") in RESULTADOS:
            try:
                tot += int(float(a.get("value") or 0))
            except Exception:
                pass
    return tot


def _por_campanha(r):
    out = {}
    if r.get("ok"):
        for row in (r.get("data") or {}).get("data") or []:
            out[str(row.get("campaign_id"))] = {"spend": float(row.get("spend") or 0), "leads": _leads(row.get("actions"))}
    return out


def ler_meta(token_r, token_w):
    """{marca: {gasto_mes, camps}} + erros. Conta que o token de escrita não alcança
    (a pessoal do Paulo) entra só no gasto do mês — o motor não mexe nela."""
    marcas = {k: {"gasto_mes": 0.0, "camps": []} for k in MARCA_LBL}
    erros = []
    for act, marca in CONTA_MARCA.items():
        mtd = _graph_get_msg(f"{act}/insights", {"date_preset": "this_month", "fields": "spend"}, token_r)
        if mtd.get("ok"):
            for row in (mtd.get("data") or {}).get("data") or []:
                marcas[marca]["gasto_mes"] += float(row.get("spend") or 0)
        else:
            erros.append(f"{act} gasto do mês: {mtd.get('erro')}")
        if not token_w:
            continue
        cps = _graph_get_msg(f"{act}/campaigns", {"fields": "id,name,daily_budget,effective_status",
                                                  "effective_status": '["ACTIVE"]', "limit": 200}, token_w)
        if not cps.get("ok"):
            continue          # conta fora do alcance do token de escrita
        ads = _graph_get_msg(f"{act}/adsets", {"fields": "id,campaign_id,daily_budget,effective_status",
                                               "effective_status": '["ACTIVE"]', "limit": 300}, token_w)
        hoje = _por_campanha(_graph_get_msg(f"{act}/insights", {"level": "campaign", "date_preset": "today",
                                                                "fields": "campaign_id,spend,actions", "limit": 200}, token_w))
        d3 = _por_campanha(_graph_get_msg(f"{act}/insights", {"level": "campaign", "date_preset": "last_3d",
                                                              "fields": "campaign_id,spend,actions", "limit": 200}, token_w))
        adsets = {}
        for s in ((ads.get("data") or {}).get("data") or []) if ads.get("ok") else []:
            if s.get("daily_budget"):
                adsets.setdefault(str(s.get("campaign_id")), []).append(
                    {"id": str(s["id"]), "tipo": "adset", "daily": int(s["daily_budget"]) / 100.0})
        for c in (cps.get("data") or {}).get("data") or []:
            cid = str(c["id"])
            if c.get("daily_budget"):
                holders = [{"id": cid, "tipo": "campaign", "daily": int(c["daily_budget"]) / 100.0}]
            else:
                holders = adsets.get(cid, [])          # ABO: verba mora nos conjuntos
            marcas[marca]["camps"].append({
                "id": cid, "nome": c.get("name"), "conta": act, "holders": holders,
                "hoje": hoje.get(cid, {"spend": 0.0, "leads": 0}),
                "d3": d3.get(cid, {"spend": 0.0, "leads": 0}),
            })
    return marcas, erros


# ─── estado / execução ─────────────────────────────────────────────────
def _estado(sb, hoje):
    st = kv_get(sb, KV, {}) or {}
    if (st.get("hoje") or {}).get("data") != hoje:
        hist = (st.get("historico") or [])
        if st.get("hoje"):
            hist = [st["hoje"]] + hist
        st = {"hoje": {"data": hoje, "slots": [], "acoes": []}, "historico": hist[:14],
              "ultimo_ciclo": st.get("ultimo_ciclo")}
    return st


def _executar(sb, token_w, a, guard):
    teto = float(guard.get("orcamento_max_brl_dia") or 500)
    var_max = float(guard.get("variacao_max_pct") or 30)
    if not _ID_RX.match(str(a.get("alvo") or "")):
        return False, "alvo inválido"
    if a["op"] == "pause":
        fields = {"status": "PAUSED"}
    elif a["op"] == "resume":
        fields = {"status": "ACTIVE"}
    else:
        novo, antes = float(a["depois"]), float(a["antes"] or 0)
        if novo > teto:
            return False, f"acima do teto de R$ {teto:.0f}/dia"
        if antes > 0 and abs(novo - antes) / antes * 100 > var_max + 0.01:
            return False, f"variação acima de {var_max:.0f}%"
        fields = {"daily_budget": str(int(round(novo * 100)))}
    ok, resp = _graph_post(str(a["alvo"]), fields, token_w)
    log_acao(sb, {"name": "🤖 Sr. Tráfego (automático)"}, a["op"],
             {"id": a["alvo"], "nome": a.get("nome")}, a.get("depois"), ok, resp)
    return ok, resp


def recomendacoes_executaveis(sb, marcas, orc_mes, dias_rest, token_w=""):
    """R4 — recomendações pendentes que a política deixa o agente executar sozinho."""
    idx = {}
    for marca, m in marcas.items():
        for c in m["camps"]:
            idx[c["id"]] = (marca, c)
    folga = {}
    for marca, m in marcas.items():
        B = (orc_mes or {}).get(marca)
        if B:
            soma = sum(h["daily"] for c in m["camps"] for h in c.get("holders") or [])
            folga[marca] = max(0.0, float(B) - m["gasto_mes"]) / max(1, dias_rest) - soma
    out = []
    for r in recs_get(sb):
        if r.get("estado") != "pendente" or not r.get("campanha_id"):
            continue
        cid = str(r["campanha_id"])
        if r["op"] == "pause" and cid in idx:
            out.append({"regra": "R4", "marca": idx[cid][0], "op": "pause", "tipo": "campaign", "alvo": cid,
                        "nome": r.get("campanha"), "antes": "ACTIVE", "depois": "PAUSED", "rec_id": r["id"],
                        "motivo": "recomendação do relatório: " + (r.get("motivo") or "")})
        elif r["op"] == "budget" and cid in idx and r.get("orcamento_brl"):
            marca, c = idx[cid]
            hs = c.get("holders") or []
            if len(hs) != 1 or hs[0]["tipo"] != "campaign":
                continue      # verba nos conjuntos: fica para o sócio decidir
            antes, novo = hs[0]["daily"], float(r["orcamento_brl"])
            if novo > antes and (novo - antes) > folga.get(marca, 0):
                continue      # aumentar só se couber no orçamento
            out.append({"regra": "R4", "marca": marca, "op": "budget", "tipo": "campaign", "alvo": cid,
                        "nome": r.get("campanha"), "antes": antes, "depois": novo, "rec_id": r["id"],
                        "motivo": "recomendação do relatório: " + (r.get("motivo") or "")})
            folga[marca] = folga.get(marca, 0) - max(0.0, novo - antes)
        elif r["op"] == "resume" and cid not in idx and token_w:
            # campanha pausada: descobre a conta (→ marca) e o custo diário; só reativa se couber
            info = _graph_get_msg(cid, {"fields": "account_id,daily_budget,name"}, token_w)
            if not info.get("ok"):
                continue
            d = info.get("data") or {}
            marca = CONTA_MARCA.get("act_" + str(d.get("account_id") or ""))
            custo = int(d["daily_budget"]) / 100.0 if d.get("daily_budget") else 30.0
            if marca and folga.get(marca, 0) >= custo:
                out.append({"regra": "R4", "marca": marca, "op": "resume", "tipo": "campaign", "alvo": cid,
                            "nome": r.get("campanha") or d.get("name"), "antes": "PAUSED", "depois": "ACTIVE",
                            "rec_id": r["id"], "motivo": "recomendação do relatório: " + (r.get("motivo") or "")})
                folga[marca] -= custo
    return out


def ciclo(sb, slot, actor="cron"):
    agora = agora_brt()
    hoje = agora.date().isoformat()
    cfg = kv_get(sb, KV_CONFIG, {}) or {}
    aut = autonomia(cfg)
    guard = {**GUARDRAILS_DEFAULT, **(cfg.get("guardrails") or {})}
    orc_mes = ((cfg.get("orcamentos") or {}).get(mes_chave(agora))) or {}
    token_r = os.environ.get("META_ACCESS_TOKEN") or ""
    token_w = os.environ.get("META_WRITE_TOKEN") or ""
    st = _estado(sb, hoje)

    marcas, erros = ler_meta(token_r, token_w)
    qual_cod, _qm = qualidade_leads(sb, 7)
    drest = dias_restantes(agora)
    plano = planejar(marcas, aut, orc_mes, drest, qual_cod, guard)
    alvos = {a["alvo"] for a in plano}
    plano += [r for r in recomendacoes_executaveis(sb, marcas, orc_mes, drest, token_w) if r["alvo"] not in alvos]

    # v88.87.1 — sem efeito cascata: o 1º ciclo real (28/09) sugeriu o MESMO corte às 10h e às
    # 13h. Ligado, isso cortaria 20% a cada ciclo (4×/dia ≈ −59% no dia). Agora cada regra age no
    # máximo 1× por objeto por dia, e o corte por CPL alto (R2) espera 3 dias pra ver o efeito.
    def _chaves(acoes, estados=("executada", "sombra")):
        return {(a.get("regra"), str(a.get("alvo"))) for a in acoes or [] if a.get("estado") in estados}
    feito_hoje = _chaves(st["hoje"]["acoes"])
    feito_3d = feito_hoje | set().union(*[_chaves(h.get("acoes")) for h in (st.get("historico") or [])[:3]] or [set()])
    plano = [a for a in plano
             if (a["regra"], str(a["alvo"])) not in (feito_3d if a["regra"] == "R2" else feito_hoje)]

    ja_hoje = sum(1 for a in st["hoje"]["acoes"] if a.get("estado") == "executada")
    vaga = max(0, int(aut.get("max_acoes_dia") or 5) - ja_hoje)
    ligado = bool(aut.get("ativo")) and bool(token_w)
    feitas = []
    for i, a in enumerate(plano):
        a = {**a, "id": "auto_" + uuid.uuid4().hex[:8], "ts": _now_iso(), "slot": slot}
        if not ligado:
            a["estado"] = "sombra"
        elif i >= vaga:
            a["estado"] = "limite_dia"
        else:
            ok, resp = _executar(sb, token_w, a, guard)
            a["estado"] = "executada" if ok else "falhou"
            a["resp"] = str(resp)[:200]
            if ok and a.get("rec_id"):
                itens = recs_get(sb)
                for r in itens:
                    if r.get("id") == a["rec_id"]:
                        r["estado"], r["resultado"] = "executada", "Executada automaticamente (política de autonomia)."
                        r["decidido_por"], r["decidido_em"] = "🤖 automático", _now_iso()
                kv_set(sb, KV_RECS, {"itens": itens})
        feitas.append(a)

    st["hoje"]["slots"] = sorted(set(st["hoje"]["slots"] + [slot]))
    st["hoje"]["acoes"] = (feitas + st["hoje"]["acoes"])[:60]
    resumo = {"ts": _now_iso(), "slot": slot, "por": actor, "modo": "ligado" if ligado else "sombra",
              "orcamento_mes": orc_mes, "dias_restantes": drest,
              "gasto_mes": {k: round(v["gasto_mes"], 2) for k, v in marcas.items()},
              "campanhas_lidas": {k: len(v["camps"]) for k, v in marcas.items()},
              "acoes": len(feitas), "erros": erros[:5], "sem_token_escrita": not token_w}
    st["ultimo_ciclo"] = resumo
    kv_set(sb, KV, st)

    if feitas:
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us if (u.get("status") or "ativo") == "ativo"
                      and lvl_of((u.get("role") or "").lower()) >= 10]
            exec_ = [a for a in feitas if a["estado"] == "executada"]
            if ligado:
                titulo = f"🤖 Sr. Tráfego agiu sozinho: {len(exec_)} ação(ões)"
            else:
                titulo = f"🤖 Modo sombra: eu faria {len(feitas)} ação(ões)"
            corpo = " · ".join(f"{'⏸' if a['op'] == 'pause' else '▶️' if a['op'] == 'resume' else '💰'} "
                               f"{str(a.get('nome') or '')[:40]}" for a in feitas[:4])
            notify(socios, "gt_auto", titulo, body=corpo, link="#/gestor-trafego",
                   target_type="gt_auto", target_id=hoje)
            send_web_push(socios, titulo, body=corpo, link="#/gestor-trafego", tag="gt_auto")
        except Exception:
            pass
    return resumo, feitas


def desfazer(sb, acao_id, user):
    token_w = os.environ.get("META_WRITE_TOKEN") or ""
    st = kv_get(sb, KV, {}) or {}
    for a in ((st.get("hoje") or {}).get("acoes") or []):
        if a.get("id") != acao_id:
            continue
        if a.get("estado") != "executada":
            return 409, {"ok": False, "error": f"essa ação está '{a.get('estado')}', nada a desfazer"}
        if a["op"] == "pause":
            fields = {"status": "ACTIVE"}
        elif a["op"] == "resume":
            fields = {"status": "PAUSED"}
        else:
            fields = {"daily_budget": str(int(round(float(a["antes"]) * 100)))}
        ok, resp = _graph_post(str(a["alvo"]), fields, token_w)
        log_acao(sb, user, "desfazer_" + a["op"], {"id": a["alvo"], "nome": a.get("nome")}, a.get("antes"), ok, resp)
        if not ok:
            return 502, {"ok": False, "error": f"Meta recusou: {resp}"}
        a["estado"] = "desfeita"
        a["desfeita_por"] = user.get("name") or user.get("id")
        kv_set(sb, KV, st)
        return 200, {"ok": True, "acao": a}
    return 404, {"ok": False, "error": "ação não encontrada (só dá pra desfazer as de hoje)"}


def _slot_devido(sb, agora):
    st = kv_get(sb, KV, {}) or {}
    feitos = (st.get("hoje") or {}).get("slots") or [] if (st.get("hoje") or {}).get("data") == agora.date().isoformat() else []
    devidos = [s for s in SLOTS if agora.hour >= s and s not in feitos]
    return devidos[-1] if devidos else None


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def _cron_ok(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        return bool(secret) and tok == secret

    def do_GET(self):
        params = dict(parse_qsl(urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        if params.get("cron"):
            if not self._cron_ok():
                try:
                    require_user(self, min_lvl=10)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            slot = _slot_devido(sb, agora_brt())
            if slot is None:
                return self._send(200, {"ok": True, "rodou": False, "motivo": "nenhum horário vencido"})
            resumo, feitas = ciclo(sb, slot)
            return self._send(200, {"ok": True, "rodou": True, "resumo": resumo})
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        cfg = kv_get(sb, KV_CONFIG, {}) or {}
        st = kv_get(sb, KV, {}) or {}
        return self._send(200, {"ok": True, "autonomia": autonomia(cfg), "estado": st})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        action = str(body.get("action") or "")
        if action == "rodar":
            resumo, feitas = ciclo(sb, agora_brt().hour, actor=user.get("name") or "sócio")
            return self._send(200, {"ok": True, "resumo": resumo, "acoes": feitas})
        if action == "desfazer":
            st, out = desfazer(sb, str(body.get("id") or ""), user)
            return self._send(st, out)
        return self._send(400, {"ok": False, "error": "action inválida (rodar|desfazer)"})
