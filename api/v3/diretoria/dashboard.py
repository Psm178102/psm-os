"""
GET /api/v3/diretoria/dashboard[?ano=2026]
Header: Authorization: Bearer <token>

KPIs consolidados pra Diretoria: VGV ano, atingimento global,
comissões pendentes, # users ativos, # deals ganhos, dias até fechar mês.
Requer Sócio/Gerente (lvl>=7).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            url = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(url.query))
        except Exception:
            params = {}
        now = datetime.now(timezone.utc)
        try: ano = int(params.get("ano") or now.year)
        except: ano = now.year
        mes_atual = now.month
        # filtros do painel executivo (v81.99): período + frente
        periodo = (params.get("periodo") or "ano").lower().strip()
        frente_sel = (params.get("frente") or "todas").lower().strip()

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        kpis = {}
        errors = []

        # 1. Users ativos
        try:
            uq = sb.table("users").select("id,name,email,status,team,hide_from_ranking").execute().data or []
            ativos = [u for u in uq if (u.get("status") or "ativo") == "ativo"]
            kpis["users_ativos"] = len(ativos)
            kpis["users_total"] = len(uq)
            # Por team
            by_team = {}
            for u in ativos:
                t = u.get("team") or "geral"
                by_team[t] = by_team.get(t, 0) + 1
            kpis["users_by_team"] = by_team
        except Exception as e:
            errors.append(f"users: {e}")
            kpis["users_ativos"] = 0; kpis["users_total"] = 0

        # 2. Metas ano
        try:
            mq = sb.table("metas").select("meta_vgv,meta_vendas").eq("ano", ano).execute().data or []
            kpis["meta_vgv_ano"]    = sum(float(m.get("meta_vgv") or 0) for m in mq)
            kpis["meta_vendas_ano"] = sum(int(m.get("meta_vendas") or 0) for m in mq)
            kpis["metas_count"]     = len(mq)
        except Exception as e:
            errors.append(f"metas: {e}")
            kpis["meta_vgv_ano"] = 0; kpis["meta_vendas_ano"] = 0

        # 3. Deals ganhos do ano (Postgres)
        try:
            start = f"{ano}-01-01T00:00:00+00:00"
            end   = f"{ano+1}-01-01T00:00:00+00:00"
            dq = sb.table("deals").select("amount,closed_at") \
                .eq("win", True).gte("closed_at", start).lt("closed_at", end).execute().data or []
            kpis["atingido_vgv_ano"] = sum(float(d.get("amount") or 0) for d in dq)
            kpis["atingido_vendas_ano"] = len(dq)
            # Mês atual + série mensal real (12 meses) p/ sparklines/gráfico premium
            kpis["atingido_vgv_mes"] = 0; kpis["atingido_vendas_mes"] = 0
            vgv_mes = [0.0] * 12
            vendas_mes = [0] * 12
            for d in dq:
                ca = d.get("closed_at")
                if not ca: continue
                try:
                    dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
                    amt = float(d.get("amount") or 0)
                    if 1 <= dt.month <= 12:
                        vgv_mes[dt.month - 1] += amt
                        vendas_mes[dt.month - 1] += 1
                    if dt.month == mes_atual:
                        kpis["atingido_vgv_mes"] += amt
                        kpis["atingido_vendas_mes"] += 1
                except: pass
            kpis["vgv_por_mes"] = [round(v, 2) for v in vgv_mes]
            kpis["vendas_por_mes"] = vendas_mes
            # Meta mensal = meta anual / 12 (linha de referência no gráfico)
            kpis["meta_vgv_mes"] = round((kpis.get("meta_vgv_ano") or 0) / 12.0, 2)
            kpis["atingimento_pct"] = (kpis["atingido_vgv_ano"] / kpis["meta_vgv_ano"] * 100) if kpis["meta_vgv_ano"] > 0 else None
        except Exception as e:
            errors.append(f"deals: {e}")
            kpis["atingido_vgv_ano"] = 0; kpis["atingido_vendas_ano"] = 0
            kpis["atingido_vgv_mes"] = 0; kpis["atingido_vendas_mes"] = 0

        # 4. Tarefas (count)
        try:
            tq = sb.table("dir_tasks").select("status").execute().data or []
            counts = {}
            for t in tq:
                s = t.get("status") or "aberta"
                counts[s] = counts.get(s, 0) + 1
            kpis["tarefas"] = counts
            kpis["tarefas_abertas"] = counts.get("aberta", 0) + counts.get("em_andamento", 0)
        except Exception as e:
            errors.append(f"tarefas: {e}")
            kpis["tarefas"] = {}; kpis["tarefas_abertas"] = 0

        # 5. Eventos hoje + próximos 7 dias
        try:
            today_iso = date.today().isoformat()
            from datetime import timedelta
            in7 = (date.today() + timedelta(days=7)).isoformat()
            eq = sb.table("eventos").select("id,tipo,status").gte("data", today_iso).lte("data", in7).execute().data or []
            kpis["eventos_proxima_semana"] = len(eq)
            kpis["eventos_hoje"] = len([e for e in eq if eq])  # simplificado
        except Exception as e:
            errors.append(f"eventos: {e}")
            kpis["eventos_proxima_semana"] = 0

        # 6. Audit últimas 24h
        try:
            from datetime import timedelta
            since_24h = (now - timedelta(hours=24)).isoformat()
            aq = []
            _pg = 0
            while True:
                _ch = sb.table("audit_log").select("action").gte("ts", since_24h).order("ts").range(_pg * 1000, _pg * 1000 + 999).execute().data or []
                aq.extend(_ch)
                if len(_ch) < 1000 or _pg >= 30:
                    break
                _pg += 1
            kpis["audit_24h"] = len(aq)
            # Top actions
            counts = {}
            for a in aq:
                k = a.get("action") or "?"
                counts[k] = counts.get(k, 0) + 1
            kpis["top_actions_24h"] = sorted(counts.items(), key=lambda x: -x[1])[:5]
            kpis["top_actions_24h"] = [{"action": k, "count": v} for k, v in kpis["top_actions_24h"]]
        except Exception as e:
            errors.append(f"audit: {e}")
            kpis["audit_24h"] = 0; kpis["top_actions_24h"] = []

        # 7. Recados ativos
        try:
            rq = sb.table("recados").select("id,prioridade,data_fim") \
                .or_(f"data_fim.is.null,data_fim.gte.{now.isoformat()}") \
                .execute().data or []
            kpis["recados_ativos"] = len(rq)
            kpis["recados_criticos"] = len([r for r in rq if (r.get("prioridade") or "") == "critica"])
        except Exception as e:
            errors.append(f"recados: {e}")
            kpis["recados_ativos"] = 0; kpis["recados_criticos"] = 0

        # 8. Métricas executivas (só Diretoria). Premissas de negócio AJUSTÁVEIS via
        #    shared_kv 'exec_premissas' {comissao_pct, custo_var_pct, custo_fixo_mensal}.
        try:
            # Premissas PSM (Paulo): comissão 4% do VGV, custo variável 1,45% do VGV,
            # custo fixo R$ 70k/mês. custo_var_pct é % SOBRE O VGV (não sobre a comissão).
            COMISSAO_PCT, CUSTO_VAR_PCT, CUSTO_FIXO_MENSAL = 0.04, 0.0145, 70000.0
            try:
                cfg = sb.table("shared_kv").select("value").eq("key", "exec_premissas").limit(1).execute().data or []
                if cfg and isinstance(cfg[0].get("value"), dict):
                    v = cfg[0]["value"]
                    COMISSAO_PCT = float(v.get("comissao_pct") or COMISSAO_PCT)
                    CUSTO_VAR_PCT = float(v.get("custo_var_pct") or CUSTO_VAR_PCT)
                    if v.get("custo_fixo_mensal") not in (None, ""):
                        CUSTO_FIXO_MENSAL = float(v["custo_fixo_mensal"])
            except Exception:
                pass
            v_ano = kpis.get("atingido_vendas_ano") or 0
            vgv_ano = kpis.get("atingido_vgv_ano") or 0
            v_mes = kpis.get("atingido_vendas_mes") or 0
            ticket = (vgv_ano / v_ano) if v_ano else 0.0
            receita_venda = ticket * COMISSAO_PCT                 # comissão bruta PSM por venda (4% VGV)
            custo_var_venda = ticket * CUSTO_VAR_PCT              # custo variável por venda (1,45% VGV)
            kpis["ticket_medio"] = round(ticket, 2)
            kpis["comissao_venda"] = round(receita_venda, 2)
            kpis["margem_contrib_venda"] = round(receita_venda - custo_var_venda, 2)  # comissão − custo variável
            kpis["ltv"] = round(receita_venda, 2)                 # valor (comissão) médio por cliente
            kpis["custo_fixo_mensal"] = CUSTO_FIXO_MENSAL
            kpis["custo_fixo_por_venda"] = round(CUSTO_FIXO_MENSAL / v_mes, 2) if (CUSTO_FIXO_MENSAL and v_mes) else None
            ut = kpis.get("users_total") or 0
            ua = kpis.get("users_ativos") or 0
            kpis["users_inativos"] = ut - ua
            kpis["turnover_pct"] = round((ut - ua) / ut * 100, 2) if ut else None
            kpis["exec_premissas"] = {"comissao_pct": COMISSAO_PCT, "custo_var_pct": CUSTO_VAR_PCT,
                                       "custo_fixo_mensal": CUSTO_FIXO_MENSAL}
        except Exception as e:
            errors.append(f"exec_metrics: {e}")

        # 9. PAINEL EXECUTIVO FILTRÁVEL (v81.99) — período + frente, comparativos
        #    REAIS vs período anterior, quebra por frente, ranking e forecast.
        #    Tudo derivado de dados reais (deals ganhos + metas). A frente vem do
        #    pipeline_name do RD (mapeamento abaixo). Meta por frente NÃO é confiável
        #    (metas não têm frente limpa) → só há meta/atingimento no nível global.
        try:
            kpis["exec"] = self._exec_block(sb, ano, mes_atual, periodo, frente_sel, uq)
        except Exception as e:
            errors.append(f"exec: {e}")
            kpis["exec"] = None

        return self._send(200, {
            "ok": len(errors) == 0,
            "ano": ano,
            "mes": mes_atual,
            "periodo": periodo,
            "frente": frente_sel,
            "kpis": kpis,
            "errors": errors,
            "fetched_at": now.isoformat(),
        })

    # ───────────────────────── Painel executivo (v81.99) ─────────────────────────
    FRENTES = [("conquista", "Conquista", "#3b82f6"), ("map", "MAP", "#22c55e"),
               ("locacao", "Locação", "#a855f7"), ("terceiros", "Terceiros", "#f59e0b")]
    MESN = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

    @staticmethod
    def _frente_of(pn):
        p = (pn or "").upper()
        if "CONQUISTA" in p: return "conquista"
        if "LOCA" in p:      return "locacao"     # FUNIL DE LOCACAO
        if "TERCEIRO" in p:  return "terceiros"
        if "MAP" in p:       return "map"          # FUNIL MAP, CARTEIRA MAP PAULO
        return "outros"                            # PARCERIA/sem funil → fora das vendas

    def _exec_block(self, sb, ano, mes_atual, periodo, frente_sel, uq):
        from datetime import datetime as _dt
        FR = self.FRENTES
        cur_month = mes_atual if ano == datetime.now(timezone.utc).year else 12

        def months_of(code):
            if code == "ytd": return list(range(1, cur_month + 1))
            if code and code[0] == "t" and code[1:].isdigit():
                q = min(max(int(code[1:]), 1), 4); return list(range((q - 1) * 3 + 1, q * 3 + 1))
            if code and code[0] == "m" and code[1:].isdigit():
                m = min(max(int(code[1:]), 1), 12); return [m]
            return list(range(1, 13))   # 'ano' (default)
        pmonths = months_of(periodo)

        # deals ganhos de 2 anos (ano-1 e ano) com frente + dono, p/ comparativos reais
        dd = sb.table("deals").select("amount,closed_at,pipeline_name,user_email,user_id") \
            .eq("win", True).gte("closed_at", f"{ano-1}-01-01T00:00:00+00:00") \
            .lt("closed_at", f"{ano+1}-01-01T00:00:00+00:00").execute().data or []

        # arrays de 24 meses: idx 0..11 = ano-1, 12..23 = ano
        vgv24 = [0.0] * 24; ven24 = [0] * 24
        vgv24f = {c: [0.0] * 24 for c, _, _ in FR}
        ven24f = {c: [0] * 24 for c, _, _ in FR}
        rank = {}
        for d in dd:
            try: dt = _dt.fromisoformat(str(d.get("closed_at")).replace("Z", "+00:00"))
            except Exception: continue
            base = 0 if dt.year == ano - 1 else 12 if dt.year == ano else None
            if base is None or not (1 <= dt.month <= 12): continue
            idx = base + dt.month - 1
            amt = float(d.get("amount") or 0)
            fr = self._frente_of(d.get("pipeline_name"))
            vgv24[idx] += amt; ven24[idx] += 1
            if fr in vgv24f: vgv24f[fr][idx] += amt; ven24f[fr][idx] += 1
            if dt.year == ano and dt.month in pmonths and (frente_sel == "todas" or fr == frente_sel):
                key = (d.get("user_email") or d.get("user_id") or "—")
                r = rank.setdefault(key, [0.0, 0]); r[0] += amt; r[1] += 1

        # metas 24 meses (meta_vgv por mês) — só nível global tem meta confiável
        meta24 = [0.0] * 24
        try:
            mm = sb.table("metas").select("ano,mes,meta_vgv").in_("ano", [ano - 1, ano]).execute().data or []
            for m in mm:
                y = int(m.get("ano") or 0); mo = int(m.get("mes") or 0)
                base = 0 if y == ano - 1 else 12 if y == ano else None
                if base is None or not (1 <= mo <= 12): continue
                meta24[base + mo - 1] += float(m.get("meta_vgv") or 0)
        except Exception:
            pass

        abs_p = [12 + (m - 1) for m in pmonths]
        win = len(abs_p)
        abs_prev = [i - win for i in abs_p if i - win >= 0]

        has_meta = frente_sel == "todas"
        cur_vgv = vgv24 if has_meta else vgv24f.get(frente_sel, [0.0] * 24)
        cur_ven = ven24 if has_meta else ven24f.get(frente_sel, [0] * 24)

        def s(arr, idxs): return sum(arr[i] for i in idxs)
        def pctd(a, b): return round((a - b) / b * 100, 1) if b else None

        vgv_p = s(cur_vgv, abs_p); ven_p = int(s(cur_ven, abs_p))
        vgv_pv = s(cur_vgv, abs_prev); ven_pv = int(s(cur_ven, abs_prev))
        meta_p = s(meta24, abs_p) if has_meta else None
        ticket = round(vgv_p / ven_p, 2) if ven_p else 0.0

        # quebra por frente (sempre as 4 de venda, escopo do período)
        total_p_all = s(vgv24, abs_p) or 0.0
        por_frente = []
        for c, l, cor in FR:
            v = s(vgv24f[c], abs_p); n = int(s(ven24f[c], abs_p)); vpv = s(vgv24f[c], abs_prev)
            por_frente.append({"code": c, "label": l, "cor": cor, "vgv": round(v, 2), "vendas": n,
                               "ticket": round(v / n, 2) if n else 0.0,
                               "share_pct": round(v / total_p_all * 100, 1) if total_p_all else 0.0,
                               "delta_pct": pctd(v, vpv)})

        # ranking de corretores (nome via lookup)
        um_email = {}; um_id = {}
        for u in (uq or []):
            if u.get("email"): um_email[str(u["email"]).lower()] = u.get("name") or u["email"]
            if u.get("id"): um_id[u["id"]] = u.get("name")
        def nm(k):
            if not k or k == "—": return "—"
            return um_email.get(str(k).lower()) or um_id.get(k) or str(k)
        ranking = sorted([{"nome": nm(k), "vgv": round(v[0], 2), "vendas": v[1]} for k, v in rank.items()],
                         key=lambda x: -x["vgv"])[:10]

        # séries do ano corrente (12 meses) p/ o gráfico — escopo da frente
        serie = {
            "meses": self.MESN,
            "vgv": [round(cur_vgv[12 + i], 2) for i in range(12)],
            "meta": [round(meta24[12 + i], 2) for i in range(12)] if has_meta else None,
            "vgv_ano_ant": [round(cur_vgv[i], 2) for i in range(12)],
        }

        # forecast / projeção — só faz sentido no escopo do ano e no global
        forecast = None
        if periodo in ("ano", "ytd") and has_meta:
            ytd = sum(cur_vgv[12 + i] for i in range(cur_month))
            meta_ano = sum(meta24[12 + i] for i in range(12))
            rem = 12 - cur_month
            falta = meta_ano - ytd
            run_rate = ytd / cur_month * 12 if cur_month else 0.0
            forecast = {"ytd_vgv": round(ytd, 2), "elapsed_months": cur_month,
                        "meta_ano": round(meta_ano, 2), "run_rate_anual": round(run_rate, 2),
                        "proj_pct": round(run_rate / meta_ano * 100, 1) if meta_ano else None,
                        "falta": round(falta, 2),
                        "ritmo_necessario_mes": round(falta / rem, 2) if (rem > 0 and falta > 0) else 0.0,
                        "on_track": (run_rate >= meta_ano) if meta_ano else None}

        def plabel(code):
            if code == "ytd": return f"YTD {ano} · Jan–{self.MESN[cur_month-1]}"
            if code and code[0] == "t": return f"{code[1]}º Trimestre {ano}"
            if code and code[0] == "m": return f"{self.MESN[min(max(int(code[1:]),1),12)-1]} / {ano}"
            return f"Ano {ano}"

        return {
            "periodo": {"code": periodo, "label": plabel(periodo), "meses": pmonths,
                        "is_year_scope": periodo in ("ano", "ytd")},
            "frente": frente_sel,
            "frentes": [{"code": c, "label": l, "cor": cor} for c, l, cor in FR],
            "kpis": {
                "vgv": round(vgv_p, 2), "vendas": ven_p, "ticket": ticket,
                "vgv_prev": round(vgv_pv, 2), "vendas_prev": ven_pv,
                "delta_vgv_pct": pctd(vgv_p, vgv_pv), "delta_vendas_pct": pctd(ven_p, ven_pv),
                "meta": round(meta_p, 2) if meta_p is not None else None,
                "ating_pct": round(vgv_p / meta_p * 100, 1) if (meta_p and meta_p > 0) else None,
                "gap": round((meta_p - vgv_p), 2) if meta_p is not None else None,
                "has_meta": has_meta,
                "label_periodo": plabel(periodo),
            },
            "serie": serie,
            "por_frente": por_frente,
            "ranking": ranking,
            "forecast": forecast,
        }
