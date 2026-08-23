"""
💵 PAINEL DE CAIXA (v86.11) — realizado detalhado + fluxo a receber/a pagar +
meta mínima de break-even, TUDO num painel só. Aparece em 2 lugares (mesma
fonte): Métricas de Viabilidade (Diretoria) e Financeiro.

FONTES (cada número diz de onde veio — nada inventado):
  • REALIZADO  → motor da Viabilidade (compute_snapshot: CRM VGV/vendas por frente
    + comissões calculadas pela premissa + custos lançados + Meta Ads automático).
  • A RECEBER  → Radar de Recebíveis (diretoria/recebiveis: valor, data prevista,
    status previsto/travado/confirmado/recebido, marco da esteira, bloqueio).
  • A PAGAR    → NIBO (schedules/debit das 2 empresas, quando envs configurados;
    sem NIBO cai pro custo fixo ORÇADO rateado por semana, avisando) + comissão
    de corretor embutida em cada recebível (sai junto do recebimento).
  • BREAK-EVEN → custo do mês (orçado + tráfego Meta real) ÷ margem marginal
    ponderada das premissas por frente → VGV mínimo e vendas mínimas por frente.

GET  ?ym=YYYY-MM  → painel completo. Sócio/diretor (lvl>=7) OU financeiro/backoffice.
POST action=set_caixa {valor} → posição de caixa inicial (kv caixa_posicao) pro
     acumulado das semanas partir do caixa REAL, não do zero.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, hoje_brt, agora_brt  # type: ignore
from viab import (  # type: ignore
    read_kv, write_kv, orc_for, custo_fixo_mes, compute_snapshot, fontes_auto_ano,
    realizado_ano, LINHAS, LINHA_IDS, TRAFEGO_CATS,
)
import calendar

KV_CAIXA = "caixa_posicao"
KV_HUB_FIN = "psmhub_financeiro_cache"   # MESMO cache da ponte psmhub/financeiro (10min)

# ── PSM HUB financeiro (v86.14 — NIBO foi CANCELADO em 13/ago; a fonte
# financeira agora é o módulo /api/financeiro do Hub: vendas com comissão
# EXATA de corretor/gestor, líquido da imobiliária, NFs e parcelas) ──
import _psmhub_lib as hub  # type: ignore


def hub_financeiro(sb):
    """Vendas do financeiro do Hub, com cache compartilhado de 10min (a mesma
    chave da ponte psmhub/financeiro — quem chegar primeiro aquece pro outro)."""
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_HUB_FIN).limit(1).execute().data or []
        v = (rows[0].get("value") if rows else None) or {}
        if isinstance(v, str):
            v = json.loads(v)
        ts = v.get("_cached_at")
        if ts:
            idade = (datetime.now(timezone.utc) - datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).total_seconds()
            if idade < 600 and isinstance(v.get("financeiro"), list):
                return v["financeiro"], None
    except Exception:
        pass
    if not hub.configured():
        return None, "ponte PSM HUB sem credenciais (PSMHUB_EMAIL/PASSWORD)"
    try:
        fin = hub.get("/api/financeiro")
        if not isinstance(fin, list):
            return None, "Hub /api/financeiro devolveu formato inesperado"
        try:
            sb.table("shared_kv").upsert({"key": KV_HUB_FIN, "value": {
                "ok": True, "financeiro": fin,
                "_cached_at": datetime.now(timezone.utc).isoformat()}}, on_conflict="key").execute()
        except Exception:
            pass
        return fin, None
    except Exception as e:
        return None, str(e)[:160]


def _hoje():
    # fonte única do "hoje" do negócio (Brasil, UTC-3)
    return hoje_brt()


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _is_trafego(it):
    """Item de tráfego pago? (categoria/linha == TRAFEGO_CATS ou começa com 'traf')
    — usado pra NÃO dobrar o tráfego, que já entra pelo Meta Ads real (meta_mkt)."""
    for k in ("cat", "categoria", "linha"):
        v = str(it.get(k) or "").strip().lower()
        if v in TRAFEGO_CATS or v.startswith("traf"):
            return True
    return False


def _add_meses(d, k):
    """Soma k meses de CALENDÁRIO a uma data (preserva o dia quando o mês comporta)."""
    y = d.year + (d.month - 1 + k) // 12
    m = (d.month - 1 + k) % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


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

    def _gate(self):
        user = require_user(self, min_lvl=0)
        ok = (user.get("lvl") or 0) >= 7 or (user.get("role") or "").lower() in ("financeiro", "backoffice")
        if not ok:
            raise AuthError(403, "painel de caixa é diretoria/financeiro")
        return user

    # ─────────────── GET ───────────────
    def do_GET(self):
        try:
            user = self._gate()
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        hoje = _hoje()
        ym = q.get("ym") or f"{hoje.year:04d}-{hoje.month:02d}"
        try:
            ano, mes = int(ym[:4]), int(ym[5:7])
            assert 1 <= mes <= 12
        except Exception:
            return self._send(400, {"ok": False, "error": "ym inválido (YYYY-MM)"})

        avisos = []

        # ── 1) REALIZADO (motor da Viabilidade — competência) ──
        fontes_auto = fontes_auto_ano(sb, ano)
        realizado = compute_snapshot(sb, ano, mes, fontes=fontes_auto)
        # acumulado do ano: snapshots fechados + mês corrente calculado agora
        snaps = read_kv(sb, "viab_snapshots")
        acum = {"vgv": 0.0, "vendas": 0, "receita": 0.0, "lucro": 0.0, "custo": 0.0, "meses": 0}
        for m in range(1, 13):
            body = snaps.get(f"{ano}-{m}") if m != mes else realizado
            if m > mes or not body:
                continue
            c = body.get("consolidado") or {}
            for k in ("vgv", "receita", "lucro", "custo"):
                acum[k] += _num(c.get(k))
            acum["vendas"] += int(c.get("vendas") or 0)
            acum["meses"] += 1
        for k in ("vgv", "receita", "lucro", "custo"):
            acum[k] = round(acum[k], 2)

        # ── 2) A RECEBER (Radar de Recebíveis — caixa) ──
        receb_rows, receb_ok = [], True
        try:
            # select * (padrão da casa) — pedir coluna que não existe derruba a query inteira
            receb_rows = sb.table("recebiveis").select("*").order("data_prevista").limit(1000).execute().data or []
        except Exception as e:
            receb_ok = False
            avisos.append(f"Radar de Recebíveis indisponível ({str(e)[:80]}) — a receber ficou vazio")
        ativos = [r for r in receb_rows if r.get("status") in ("previsto", "travado", "confirmado")]
        recebidos_mes = [r for r in receb_rows if r.get("status") == "recebido"
                         and str(r.get("data_prevista") or "").startswith(ym)]

        orcamento = read_kv(sb, "viab_orcamento")

        def entrada_de(r):
            """Entrada de caixa do recebível: valor líquido informado, senão
            comissão bruta pela premissa da frente (marcado como estimado)."""
            v = _num(r.get("valor_liquido_estimado"), None)
            if v:
                return v, False
            orc = orc_for(orcamento, ano, r.get("frente") if r.get("frente") in LINHA_IDS else "conquista", mes)
            return _num(r.get("valor_bruto")) * _num(orc.get("com_bruta_pct")) / 100.0, True

        def comissao_de(r):
            """Saída casada: comissão de corretor/gerente do mesmo negócio."""
            orc = orc_for(orcamento, ano, r.get("frente") if r.get("frente") in LINHA_IDS else "conquista", mes)
            pct = _num(orc.get("com_corretor_pct")) + _num(orc.get("com_senior_pct")) + _num(orc.get("com_gerente_pct"))
            return _num(r.get("valor_bruto")) * pct / 100.0

        sem_valor = [r for r in ativos if not _num(r.get("valor_liquido_estimado"), None) and not _num(r.get("valor_bruto"), None)]
        sem_data = [r for r in ativos if not r.get("data_prevista")]
        if sem_data:
            avisos.append(f"{len(sem_data)} recebível(is) SEM data prevista — fora do fluxo semanal (aparecem na lista)")

        # ── 3) PSM HUB financeiro (fonte oficial desde 13/ago/2026 — NIBO cancelado):
        # vendas com líquido da imobiliária + comissão EXATA de corretor/gestor +
        # parcelas. A Conquista entra no fluxo POR AQUI (valor exato); o Radar
        # cobre as demais frentes (sem dupla contagem). ──
        hub_fin, hub_err = hub_financeiro(sb)
        hub_ok = hub_fin is not None
        if hub_err:
            avisos.append(f"PSM HUB financeiro indisponível ({hub_err}) — fluxo fica com Radar + custo orçado")
        hub_fin = hub_fin or []
        hub_parcelas = []                      # dicts {dt, ent, com, presumido}
        hub_sem_agenda = []
        hub_presumidas_n = 0
        hub_mes = {"vendas": 0, "vgv": 0.0, "liquido": 0.0, "com_corretor": 0.0, "com_gestor": 0.0}
        corte_atraso = hoje - timedelta(days=45)   # parcela vencida há +45d = presumida liquidada (some do fluxo)
        for vd in hub_fin:
            liq = _num(vd.get("valorLiquido")) or _num(vd.get("valorBruto"))
            com = _num(vd.get("comissaoCorretor")) + _num(vd.get("comissaoGestor"))
            if str(vd.get("dataVenda") or "").startswith(ym):
                hub_mes["vendas"] += 1
                hub_mes["vgv"] += _num(vd.get("vgv"))
                hub_mes["liquido"] += liq
                hub_mes["com_corretor"] += _num(vd.get("comissaoCorretor"))
                hub_mes["com_gestor"] += _num(vd.get("comissaoGestor"))
            n_par = max(1, int(_num(vd.get("nrParcelas"), 1)))
            try:
                d1 = date.fromisoformat(str(vd.get("dataPrimeiraParcela"))[:10]) if vd.get("dataPrimeiraParcela") else None
            except Exception:
                d1 = None
            if not d1:
                # sem agenda de parcela: pendência (só vendas dos últimos 90d — velhas presumidas resolvidas)
                try:
                    dv = date.fromisoformat(str(vd.get("dataVenda"))[:10])
                except Exception:
                    dv = None
                if dv and (hoje - dv).days <= 90 and liq > 0:
                    hub_sem_agenda.append({"cliente": vd.get("cliente"), "corretor": vd.get("vendorName"),
                                           "produto": vd.get("produto"), "liquido": round(liq, 2),
                                           "venda": vd.get("dataVenda")})
                continue
            for k in range(n_par):
                dt_k = _add_meses(d1, k)   # vencimento por mês de CALENDÁRIO (não 30*k dias)
                if dt_k < corte_atraso:
                    continue
                # parcela vencida entre (hoje-45d) e hoje: PRESUMIDA como entrada,
                # mas sem confirmação de pagamento → flag pra não tratar como recebido de fato.
                presumido = dt_k < hoje
                if presumido:
                    hub_presumidas_n += 1
                hub_parcelas.append({"dt": dt_k, "ent": liq / n_par,
                                     "com": com / n_par, "presumido": presumido})
        for k in ("vgv", "liquido", "com_corretor", "com_gestor"):
            hub_mes[k] = round(hub_mes[k], 2)
        if hub_sem_agenda:
            avisos.append(f"{len(hub_sem_agenda)} venda(s) do HUB sem data de parcela — "
                          "R$ fora do fluxo semanal até agendar lá")
        if hub_presumidas_n:
            avisos.append(f"{hub_presumidas_n} parcela(s) do HUB vencida(s) há até 45d entram como "
                          "PRESUMIDAS (sem confirmação de pagamento) — previsto, não recebido de fato")

        # ── 4) FLUXO SEMANAL (10 semanas a partir da segunda desta semana) ──
        # Conquista entra pelo HUB (valor exato); Radar cobre as outras frentes.
        radar_fluxo = ativos if not hub_ok else \
            [r for r in ativos if (r.get("frente") or "").lower() != "conquista"]
        if hub_ok and len(radar_fluxo) < len(ativos):
            avisos.append(f"{len(ativos) - len(radar_fluxo)} recebível(is) da Conquista saem do fluxo pelo "
                          "Radar e entram pelos valores EXATOS do HUB (sem dupla contagem)")
        custos_orc = read_kv(sb, "viab_custos_orcado")
        itens_orc = (custos_orc.get(str(ano)) or {}).get("itens") or []
        # Tráfego pago sai do custo FIXO porque já entra pelo Meta Ads real (meta_mkt)
        # no break-even, e pra não dobrar o desembolso no fluxo semanal (v86.11+).
        itens_orc_sem_traf = [it for it in itens_orc if not _is_trafego(it)]
        seg0 = hoje - timedelta(days=hoje.weekday())
        pos = read_kv(sb, KV_CAIXA) or {}
        caixa_ini = _num(pos.get("valor"), None)
        semanas, acum_fluxo = [], (caixa_ini or 0.0)
        furo = None
        for w in range(10):
            ini = seg0 + timedelta(days=7 * w)
            fim = ini + timedelta(days=6)
            entra_conf = entra_prev = entra_trav = sai_com = 0.0
            for r in radar_fluxo:
                dp = r.get("data_prevista")
                try:
                    dpd = date.fromisoformat(str(dp)[:10]) if dp else None
                except Exception:
                    dpd = None
                # atrasado (data no passado) cai na 1ª semana — ainda é caixa a entrar
                if not dpd or (dpd > fim) or (w > 0 and dpd < ini):
                    continue
                if w == 0 and dpd > fim:
                    continue
                val, _est = entrada_de(r)
                st = r.get("status")
                if st == "confirmado":
                    entra_conf += val
                elif st == "travado":
                    entra_trav += val
                else:
                    entra_prev += val
                sai_com += comissao_de(r)
            # parcelas do HUB desta semana (líquido entra, comissão exata sai junto)
            entra_hub = sai_hub = entra_hub_presum = 0.0
            for par in hub_parcelas:
                dt_k = par["dt"]
                if (ini <= dt_k <= fim) or (w == 0 and dt_k < ini):
                    entra_hub += par["ent"]
                    sai_hub += par["com"]
                    if par["presumido"]:
                        entra_hub_presum += par["ent"]
            sai_fixo = custo_fixo_mes(itens_orc_sem_traf, ini.month) / 4.33
            entra = entra_conf + entra_prev + entra_trav + entra_hub
            sai = sai_fixo + sai_com + sai_hub
            acum_fluxo += (entra_conf + entra_prev + entra_hub) - sai   # travado NÃO conta (realista)
            if furo is None and acum_fluxo < 0:
                furo = ini.isoformat()
            semanas.append({"ini": ini.isoformat(), "fim": fim.isoformat(),
                            "entra_confirmado": round(entra_conf, 2), "entra_previsto": round(entra_prev, 2),
                            "entra_travado": round(entra_trav, 2), "entra_hub": round(entra_hub, 2),
                            "entra_hub_presumido": round(entra_hub_presum, 2),
                            "entra_total": round(entra, 2),
                            "sai_fixo": round(sai_fixo, 2), "sai_comissao": round(sai_com + sai_hub, 2),
                            "sai_total": round(sai, 2), "base_pagar": "orcado+hub",
                            "saldo": round((entra_conf + entra_prev + entra_hub) - sai, 2),
                            "acumulado": round(acum_fluxo, 2)})

        proximos = []
        for r in sorted(ativos, key=lambda x: str(x.get("data_prevista") or "9999")):
            val, est = entrada_de(r)
            proximos.append({"id": r.get("id"), "desc": r.get("descricao"), "frente": r.get("frente"),
                             "valor": round(val, 2), "estimado": est, "status": r.get("status"),
                             "marco": r.get("marco_atual"), "bloqueio": r.get("bloqueio"),
                             "data": r.get("data_prevista"),
                             "corretor": r.get("corretor_nome") or r.get("corretor_id")})
            if len(proximos) >= 20:
                break

        # ── 5) BREAK-EVEN (meta mínima do mês) ──
        fa = fontes_auto.get(str(mes)) or {}
        # custo fixo SEM tráfego + tráfego real (meta_mkt) — evita dobrar o tráfego
        custo_mes = custo_fixo_mes(itens_orc_sem_traf, mes) + _num(fa.get("meta_mkt")) + _num(fa.get("nibo_fixo"))
        margens, pesos, tickets = {}, {}, {}
        real_ano = realizado_ano(sb, ano)
        peso_total = 0.0
        for i in LINHA_IDS:
            orc = orc_for(orcamento, ano, i, mes)
            mg = (_num(orc.get("com_bruta_pct")) * (1 - _num(orc.get("aliquota_pct")) / 100.0)
                  - _num(orc.get("com_corretor_pct")) - _num(orc.get("com_senior_pct"))
                  - _num(orc.get("com_gerente_pct"))) / 100.0
            margens[i] = round(mg, 5)
            w = _num(orc.get("vgv"))
            if w <= 0:   # sem orçado → peso pelo realizado do ano
                w = sum(_num(real_ano[i][str(m)]["vgv"]) for m in range(1, 13))
            pesos[i] = w
            peso_total += w
            t = 0.0
            if _num(orc.get("vendas")) > 0:
                t = _num(orc.get("vgv")) / _num(orc.get("vendas"))
            if t <= 0:
                v_ano = sum(int(real_ano[i][str(m)]["vendas"]) for m in range(1, 13))
                vg_ano = sum(_num(real_ano[i][str(m)]["vgv"]) for m in range(1, 13))
                t = vg_ano / v_ano if v_ano else 0.0
            tickets[i] = round(t, 2)
        if peso_total <= 0:
            pesos = {i: 1.0 for i in LINHA_IDS}
            peso_total = float(len(LINHA_IDS))
        margem_pond = sum(margens[i] * pesos[i] for i in LINHA_IDS) / peso_total
        vgv_min = (custo_mes / margem_pond) if margem_pond > 0 else None
        por_frente = []
        for l in LINHAS:
            i = l["id"]
            share = pesos[i] / peso_total
            vgv_i = (vgv_min or 0) * share
            por_frente.append({"id": i, "nome": l["nome"], "icon": l["icon"],
                               "margem_pct": round(margens[i] * 100, 2),
                               "share_pct": round(share * 100, 1),
                               "vgv_min": round(vgv_i, 2), "ticket": tickets[i],
                               "vendas_min": round(vgv_i / tickets[i], 1) if tickets[i] else None})
        cons = realizado.get("consolidado") or {}
        # gerado marginal do mês = receita − comissões − imposto = lucro + custo
        # (derivado do lucro pra incluir com_gerente, que o consolidado não expõe)
        gerado_mes = _num(cons.get("lucro")) + _num(cons.get("custo"))
        cobertura = (gerado_mes / custo_mes * 100) if custo_mes > 0 else None
        farol = None
        if cobertura is not None:
            farol = "coberto" if cobertura >= 100 else ("perto" if cobertura >= 70 else "descoberto")

        return self._send(200, {
            "ok": True, "ym": ym,
            "fontes": {"crm": True, "recebiveis": receb_ok, "hub_fin": hub_ok,
                       "hub_err": hub_err or None, "meta_ads": True},
            "avisos": avisos,
            "realizado": {"mes": realizado, "acumulado_ano": acum,
                          "recebido_caixa_mes": round(sum(entrada_de(r)[0] for r in recebidos_mes), 2),
                          "hub_mes": hub_mes if hub_ok else None},
            "caixa": {"posicao_inicial": caixa_ini,
                      "posicao_info": {"ts": pos.get("ts"), "por": pos.get("por")} if caixa_ini is not None else None,
                      "semanas": semanas, "furo": furo,
                      "hub": {"ok": hub_ok, "vendas_total": len(hub_fin),
                              "mes": hub_mes if hub_ok else None,
                              "parcelas_futuras": len(hub_parcelas),
                              "parcelas_presumidas": hub_presumidas_n,
                              "sem_agenda": hub_sem_agenda[:10],
                              "sem_agenda_n": len(hub_sem_agenda)},
                      "recebiveis_resumo": {
                          "ativos": len(ativos),
                          "confirmado": round(sum(entrada_de(r)[0] for r in ativos if r.get("status") == "confirmado"), 2),
                          "previsto": round(sum(entrada_de(r)[0] for r in ativos if r.get("status") == "previsto"), 2),
                          "travado": round(sum(entrada_de(r)[0] for r in ativos if r.get("status") == "travado"), 2),
                          "sem_data": len(sem_data), "sem_valor": len(sem_valor)},
                      "proximos": proximos},
            "breakeven": {"custo_mes": round(custo_mes, 2),
                          "margem_ponderada_pct": round(margem_pond * 100, 2),
                          "vgv_minimo": round(vgv_min, 2) if vgv_min else None,
                          "por_frente": por_frente,
                          "gerado_mes": round(gerado_mes, 2),
                          "cobertura_pct": round(cobertura, 1) if cobertura is not None else None,
                          "farol": farol},
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })

    # ─────────────── POST ───────────────
    def do_POST(self):
        try:
            user = self._gate()
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if (body.get("action") or "") != "set_caixa":
            return self._send(400, {"ok": False, "error": "action=set_caixa"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        val = _num(body.get("valor"), None)
        antes = read_kv(sb, KV_CAIXA) or None
        novo = {"valor": val, "ts": datetime.now(timezone.utc).isoformat(),
                "por": user.get("name") or user.get("email")}
        write_kv(sb, KV_CAIXA, novo)
        audit(self, user, "caixa.posicao", target_type="caixa", target_id=KV_CAIXA,
              before=antes, after=novo)
        return self._send(200, {"ok": True, "posicao": novo})
