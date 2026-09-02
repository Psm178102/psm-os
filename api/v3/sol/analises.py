"""
GET /api/v3/sol/analises?dias=14|30|90 — aba Análises da Central da Sol
Header: Authorization: Bearer <token> — SÓ SÓCIO (lvl >= 10).

Lê as 6 views de análise (criadas 01/set) e devolve num payload só:
  - funil:    sol_funil_por_origem (por origem + total agregado em Python).
              ⚠️ a view NÃO tem coluna de data → é all-time; ?dias não se aplica.
  - tempos:   sol_tempos agregada AQUI (mediana 1ª resposta, % <1min, média de
              msgs/conversa) — janela por primeira_msg_lead >= corte.
  - reguas:   sol_performance_reguas ordenada por taxa desc (all-time, sem data).
  - custos:   bloco GASTOS — série diária da janela (buracos zerados) com pilha
              templates (Meta) / IA / FIXOS rateados pro-rata-dia (sol_config
              chave custos_fixos: infra_mensal_brl + elevenlabs_mensal_brl,
              divididos pelos dias DO MÊS de cada dia) + ACUMULADO calculado
              aqui no Python (running sum, não na view) + total do período,
              acumulado do mês corrente, projeção do mês (média diária × dias
              do mês — rótulo honesto no front) e custo por qualificado e por
              agendamento no período (denominadores da sol_metricas_diarias).
  - qualidade: sol_qualidade_diaria na janela (média ponderada por auditorias).
  - heatmap:  sol_heatmap_respostas (grade dia_semana × hora, all-time).
"""
import calendar
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta
from urllib.parse import urlparse, parse_qs
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

DIAS_OK = (14, 30, 90)


def _hoje_sp():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    except Exception:
        return (datetime.utcnow() - timedelta(hours=3)).date()


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        qs = parse_qs(urlparse(self.path).query)
        try:
            dias = int((qs.get("dias") or ["14"])[0])
        except Exception:
            dias = 14
        if dias not in DIAS_OK:
            dias = 14
        hoje = _hoje_sp()
        ini = hoje - timedelta(days=dias - 1)
        corte_ts = f"{ini.isoformat()}T00:00:00-03:00"

        # ── funil por origem (all-time — view sem coluna de data) ─────────
        try:
            funil = (sb.table("sol_funil_por_origem").select("*")
                     .order("conversas", desc=True).limit(50).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"funil: {e}"})
        ETAPAS = ("conversas", "qualificados", "simularam", "viram_card",
                  "agendaram", "handoffs", "ganhos", "opt_outs")
        total = {k: sum(int(r.get(k) or 0) for r in funil) for k in ETAPAS}
        total["origem"] = "__total__"

        # ── tempos: agregação em Python (mediana não dá na view) ──────────
        try:
            tempos_rows = (sb.table("sol_tempos")
                           .select("segundos_1a_resposta,msgs_do_lead,msgs_da_sol")
                           .gte("primeira_msg_lead", corte_ts)
                           .limit(5000).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"tempos: {e}"})
        seg = [float(r["segundos_1a_resposta"]) for r in tempos_rows
               if r.get("segundos_1a_resposta") is not None]
        msgs = [int(r.get("msgs_do_lead") or 0) + int(r.get("msgs_da_sol") or 0)
                for r in tempos_rows]
        tempos = {
            "conversas": len(tempos_rows),
            "mediana_1a_resposta_s": (round(statistics.median(seg), 1) if seg else None),
            "pct_menos_1min": (round(100.0 * sum(1 for s in seg if s < 60) / len(seg), 1) if seg else None),
            "media_msgs_por_conversa": (round(sum(msgs) / len(msgs), 1) if msgs else None),
        }

        # ── performance por régua (all-time) ──────────────────────────────
        try:
            reguas = (sb.table("sol_performance_reguas").select("*")
                      .order("taxa_resposta_pct", desc=True).limit(200).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"reguas: {e}"})

        # ── GASTOS: série empilhada + fixos rateados + acumulado + projeção ─
        mes_ini = hoje.replace(day=1)
        busca_ini = min(ini, mes_ini)   # 1 query cobre a janela E o mês corrente
        try:
            custos_rows = (sb.table("sol_custos_diarios").select("*")
                           .gte("dia", busca_ini.isoformat()).lte("dia", hoje.isoformat())
                           .order("dia").execute().data or [])
            met_rows = (sb.table("sol_metricas_diarias").select("dia,qualificados,agendamentos")
                        .gte("dia", ini.isoformat()).lte("dia", hoje.isoformat())
                        .execute().data or [])
            fx_rows = (sb.table("sol_config").select("valor")
                       .eq("chave", "custos_fixos").limit(1).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"custos: {e}"})

        fx = (fx_rows[0].get("valor") if fx_rows else None) or {}
        try:
            fixo_mensal = float(fx.get("infra_mensal_brl") or 0) + float(fx.get("elevenlabs_mensal_brl") or 0)
        except Exception:
            fixo_mensal = 0.0
        por_dia_c = {str(r.get("dia")): r for r in custos_rows}

        def _dia_gasto(d):
            """Gasto de um dia: variáveis da view + fixo pro-rata (dias DO MÊS do dia)."""
            r = por_dia_c.get(d.isoformat()) or {}
            tpl = float(r.get("custo_templates") or 0)
            ia = float(r.get("custo_ia") or 0)
            fixo = round(fixo_mensal / calendar.monthrange(d.year, d.month)[1], 2) if fixo_mensal else 0.0
            return tpl, ia, fixo

        serie, acum = [], 0.0
        for i in range(dias):
            d = ini + timedelta(days=i)
            tpl, ia, fixo = _dia_gasto(d)
            tot_d = round(tpl + ia + fixo, 2)
            acum = round(acum + tot_d, 2)   # running sum AQUI, não na view
            serie.append({"dia": d.isoformat(), "templates": round(tpl, 2), "ia": round(ia, 2),
                          "fixos": fixo, "total": tot_d, "acumulado": acum})

        c_total = round(sum(s["total"] for s in serie), 2)
        c_tpl = round(sum(s["templates"] for s in serie), 2)
        c_ia = round(sum(s["ia"] for s in serie), 2)
        c_fx = round(sum(s["fixos"] for s in serie), 2)

        # mês corrente: acumulado até hoje + projeção pela média diária
        dias_corridos = (hoje - mes_ini).days + 1
        acum_mes = 0.0
        for i in range(dias_corridos):
            d = mes_ini + timedelta(days=i)
            tpl, ia, fixo = _dia_gasto(d)
            acum_mes += tpl + ia + fixo
        acum_mes = round(acum_mes, 2)
        dias_do_mes = calendar.monthrange(hoje.year, hoje.month)[1]
        projecao_mes = round((acum_mes / dias_corridos) * dias_do_mes, 2) if dias_corridos else None

        q_tot = sum(int(r.get("qualificados") or 0) for r in met_rows)
        a_tot = sum(int(r.get("agendamentos") or 0) for r in met_rows)
        custos = {
            "serie": serie,
            "total": c_total, "templates": c_tpl, "ia": c_ia, "fixos": c_fx,
            "fixo_mensal_brl": round(fixo_mensal, 2),
            "acumulado_mes": acum_mes,
            "projecao_mes": projecao_mes,   # média diária × dias do mês (rótulo honesto no front)
            "qualificados": q_tot, "agendamentos": a_tot,
            "por_qualificado": (round(c_total / q_tot, 2) if q_tot else None),
            "por_agendamento": (round(c_total / a_tot, 2) if a_tot else None),
        }

        # ── qualidade (juiz de QA) — média ponderada por auditorias ───────
        try:
            qual_rows = (sb.table("sol_qualidade_diaria").select("*")
                         .gte("dia", ini.isoformat()).lte("dia", hoje.isoformat())
                         .order("dia").execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"qualidade: {e}"})
        aud = sum(int(r.get("auditorias") or 0) for r in qual_rows)
        soma_notas = sum(float(r.get("nota_media") or 0) * int(r.get("auditorias") or 0)
                         for r in qual_rows)
        qualidade = {
            "serie": qual_rows,
            "auditorias": aud,
            "nota_media": (round(soma_notas / aud, 2) if aud else None),
            "abaixo_de_7": sum(int(r.get("abaixo_de_7") or 0) for r in qual_rows),
        }

        # ── heatmap dia_semana × hora (all-time) ──────────────────────────
        try:
            heat = (sb.table("sol_heatmap_respostas").select("*")
                    .limit(200).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"heatmap: {e}"})

        return self._send(200, {
            "ok": True, "dias": dias,
            "funil": funil, "funil_total": total,
            "tempos": tempos,
            "reguas": reguas,
            "custos": custos,
            "qualidade": qualidade,
            "heatmap": heat,
        })
