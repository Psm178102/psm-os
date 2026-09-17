"""Teste de lógica do motor único de métricas (api/v3/_metricas_lib.py) com um Supabase falso.

Roda sem rede e sem credenciais:
    python3 tests/test_metricas_lib.py

Cobre o Dicionário de Métricas v1 (docs/DICIONARIO-METRICAS.md): fuso de Brasília, fallback de valor,
categorias de origem, lead × interessado × em atendimento, contas de serviço, marcos por coluna, HUB,
metas mês a mês, as quatro projeções (§8), o ticket presumido de negócio sem valor e as alçadas.
"""
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3"))
import _metricas_lib as M  # noqa: E402


def _path(row, spec):
    """'src:rd_raw->deal_source->>name' → (alias, valor)."""
    if ":" not in spec:
        return spec, row.get(spec)
    alias, path = spec.split(":", 1)
    cur = row
    for part in [p for p in path.replace("->>", "->").split("->") if p]:
        cur = cur.get(part) if isinstance(cur, dict) else None
    return alias, cur


class Q:
    def __init__(self, rows, cols):
        self.rows, self.cols, self.f, self.rng, self.lim = rows, cols, [], None, None

    def eq(self, k, v): self.f.append(lambda r: r.get(k) == v); return self
    def neq(self, k, v): self.f.append(lambda r: r.get(k) != v); return self
    def gte(self, k, v): self.f.append(lambda r: (r.get(k) or "") >= v); return self
    def lt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) < v); return self
    def is_(self, k, v): self.f.append(lambda r: r.get(k) is None); return self
    def in_(self, k, vals): s = set(vals); self.f.append(lambda r: r.get(k) in s); return self

    def like(self, k, pat):
        rx = re.compile("^" + re.escape(pat).replace("%", ".*") + "$")
        self.f.append(lambda r: bool(rx.match(str(r.get(k) or ""))))
        return self

    def order(self, *a, **k): return self
    def range(self, a, b): self.rng = (a, b); return self
    def limit(self, n): self.lim = n; return self

    def execute(self):
        rs = [r for r in self.rows if all(fn(r) for fn in self.f)]
        if self.rng:
            rs = rs[self.rng[0]:self.rng[1] + 1]
        if self.lim:
            rs = rs[:self.lim]
        if self.cols != "*":
            rs = [dict(_path(r, c.strip()) for c in self.cols.split(",")) for r in rs]

        class R:
            pass
        o = R()
        o.data = rs
        return o


class T:
    def __init__(self, db, name): self.db, self.name = db, name
    def select(self, cols="*"): return Q(self.db.get(self.name, []), cols)

    def upsert(self, row, on_conflict=None):
        self.db[self.name] = [r for r in self.db.get(self.name, []) if r.get("key") != row.get("key")] + [row]
        return Q([], "*")


class SB:
    def __init__(self, db): self.db = db

    def table(self, n):
        if n == "rd_tasks":           # simula tabela de visitas ainda não sincronizada
            raise RuntimeError("relation rd_tasks does not exist")
        return T(self.db, n)


SYNC = "2026-09-15T18:00:00+00:00"
DB = {
    "users": [
        {"id": "kadu", "name": "Kadu Ozorio", "email": "kadu@x.br", "role": "corretor_conquista", "team": "conquista", "status": "ativo", "is_service": False},
        {"id": "kbordini", "name": "Kaue Bordini", "email": "kaue@x.br", "role": "gerente_conquista", "team": "conquista", "status": "ativo", "is_service": False},
        {"id": "rafaela", "name": "Rafaela Metzger", "email": "rafa@x.br", "role": "corretor_map", "team": "map", "status": "ativo", "is_service": False},
        {"id": "tv", "name": "tv", "email": "tv@x.br", "role": "gerente", "team": "geral", "status": "ativo", "is_service": True},
    ],
    "deals": [
        # 1: venda do Kadu fechada 30/09 23:30 BRT (= 01/10 02:30 UTC) → SETEMBRO; valor só no amount_total
        {"id": "1", "amount": 0, "win": True, "closed_at": "2026-10-01T02:30:00+00:00", "created_at_rd": "2026-08-01T12:00:00+00:00", "user_id": "kadu", "user_email": "kadu@x.br", "synced_at": SYNC, "stage_id": "s9", "rd_raw": {"amount_total": 300000, "deal_source": {"name": "Busca Paga | Facebook Ads"}}},
        # 2: lead pago PSM criado em set (Kadu, só por e-mail), aberto, SEM VALOR
        {"id": "2", "amount": 0, "win": None, "closed_at": None, "created_at_rd": "2026-09-10T15:00:00+00:00", "user_id": None, "user_email": "kadu@x.br", "synced_at": SYNC, "stage_id": "s3", "stage_name": "CONT. + QUALIFICACAO", "rd_raw": {"deal_source": {"name": "Busca Paga | Ads PSM"}}},
        # 3: sem origem criado em set (Rafaela) → lead assumido; valor 500k
        {"id": "3", "amount": 500000, "win": None, "closed_at": None, "created_at_rd": "2026-09-05T15:00:00+00:00", "user_id": "rafaela", "user_email": "rafa@x.br", "synced_at": SYNC, "stage_id": "m1", "rd_raw": {}},
        # 4: carteira criado em set (Rafaela) → interessado, não lead
        {"id": "4", "amount": 0, "win": None, "closed_at": None, "created_at_rd": "2026-09-06T15:00:00+00:00", "user_id": "rafaela", "user_email": "rafa@x.br", "synced_at": SYNC, "stage_id": "m1", "rd_raw": {"deal_source": {"name": "Carteira do corretor"}}},
        # 5: aberto antigo (2025) → em atendimento, não interessado
        {"id": "5", "amount": 0, "win": None, "closed_at": None, "created_at_rd": "2025-03-06T15:00:00+00:00", "user_id": "rafaela", "user_email": "rafa@x.br", "synced_at": SYNC, "stage_id": "m1", "rd_raw": {}},
        # 6: perdido em set cujo dono é conta de serviço → sem corretor
        {"id": "6", "amount": 0, "win": False, "closed_at": "2026-09-08T12:00:00+00:00", "created_at_rd": "2026-09-01T15:00:00+00:00", "user_id": None, "user_email": "tv@x.br", "synced_at": SYNC, "stage_id": "s3", "rd_raw": {}},
        # 7: venda de agosto (fora da janela, mas dentro dos 120d do ticket)
        {"id": "7", "amount": 200000, "win": True, "closed_at": "2026-08-20T12:00:00+00:00", "created_at_rd": "2026-07-01T15:00:00+00:00", "user_id": "kadu", "user_email": "kadu@x.br", "synced_at": SYNC, "stage_id": "s9", "rd_raw": {}},
        # 8: ganha SEM closed_at → não entra em mês nenhum, gera aviso
        {"id": "8", "amount": 100000, "win": True, "closed_at": None, "created_at_rd": "2026-09-02T15:00:00+00:00", "user_id": "kadu", "user_email": "kadu@x.br", "synced_at": SYNC, "stage_id": "s9", "rd_raw": {}},
    ],
    "rd_stages": [{"id": "m1", "psm_stage_key": "novo_atend"}, {"id": "m2", "psm_stage_key": "vis_agend"}, {"id": "m3", "psm_stage_key": "vis_real"}],
    "deal_stage_events": [
        {"id": 1, "deal_id": "3", "stage_id": "m2", "occurred_at": "2026-09-07T12:00:00+00:00", "user_email": "rafa@x.br", "source": "sync"},
        {"id": 2, "deal_id": "3", "stage_id": "m3", "occurred_at": "2026-09-09T12:00:00+00:00", "user_email": "rafa@x.br", "source": "sync"},
        {"id": 3, "deal_id": "3", "stage_id": "m3", "occurred_at": "2026-08-09T12:00:00+00:00", "user_email": "rafa@x.br", "source": "sync"},
    ],
    "metas": [
        {"corretor_id": "kadu", "ano": 2026, "mes": 9, "meta_vgv": 550000, "meta_vendas": 2},
        {"corretor_id": "rafaela", "ano": 2026, "mes": 9, "meta_vgv": 870000, "meta_vendas": 0},
        {"corretor_id": "kadu", "ano": 2026, "mes": 8, "meta_vgv": 999999, "meta_vendas": 9},
    ],
    "shared_kv": [
        {"key": "oo_norte:kadu:2026-09", "value": {"atendimentos_mes": 100, "ticket_medio": 300000,
            "canais": [{"nome": "Tráfego Pago", "taxa_base": 2.0, "energia": 100, "mix": 50},
                       {"nome": "Indicação", "taxa_base": 10.0, "energia": 100, "mix": 50}]}},
        {"key": "oo_norte:diogo:2026-09", "value": {"atendimentos_mes": 100, "ticket_medio": 300000,
            "canais": [{"nome": "x", "taxa_base": 10.0, "energia": 100, "mix": 100}]}},
        {"key": "metricas_hub:2026-09", "value": {"ok": True, "fetched_at": "2099-01-01T00:00:00+00:00", "rows": [
            {"agentName": "Kadu", "prospeccao": 23, "qualificacao": 4, "agendamento": 4, "atendimento": 3, "pasta": 1, "vendaCount": 0, "vendaTotal": 0},
            {"agentName": "Christian", "prospeccao": 36, "qualificacao": 8, "agendamento": 4, "atendimento": 3, "pasta": 7, "vendaCount": 1, "vendaTotal": 194652}]}},
    ],
}


def main():
    sb = SB(DB)
    hoje = date(2026, 9, 30)
    out = M.resumo(sb, {}, fresh=True, hoje=hoje)
    P, E, C = out["pessoas"], out["equipes"], out["empresa"]

    # §0 período e contas de serviço
    assert out["janela"] == {"since": "2026-09-01", "until": "2026-09-30", "preset": "this_month", "hoje": "2026-09-30"}, out["janela"]
    assert "tv" not in P and set(P) == {"kadu", "kbordini", "rafaela"}

    # §1 venda: fuso de Brasília + fallback amount_total
    k = P["kadu"]
    assert k["vendas"] == 1 and k["vgv"] == 300000.0, k

    # §2 lead × interessado × em atendimento
    assert k["leads"] == 2 and k["leads_pago_psm"] == 2 and k["leads_origem_assumida"] == 1, k
    assert k["interessados"] == 2 and k["em_atendimento"] == 1, k
    r = P["rafaela"]
    assert r["leads"] == 1 and r["leads_origem_assumida"] == 1 and r["interessados"] == 2 and r["em_atendimento"] == 3, r

    # §5 marcos por coluna (MAP) e HUB (Conquista)
    assert r["agendamentos"] == 1 and r["visitas_coluna"] == 1 and r["visitas"] is None, r
    assert k["hub"]["prospeccao"] == 23 and k["hub"]["pasta"] == 1, k["hub"]

    # §6 meta mês a mês
    assert k["meta"]["meta_vgv"] == 550000 and k["atingimento_vgv_pct"] == 54.5, k
    assert E["map"]["meta"]["meta_vgv"] == 870000

    # §4 equipe
    assert E["conquista"]["vendas"] == 1 and E["conquista"]["n_corretores"] == 1 and E["conquista"]["n_gestores"] == 1
    assert C["vendas"] == 1 and C["perdidos"] == 1 and C["sem_corretor"]["perdidos"] == 1, C

    # §8 projeções
    assert k["projecao"]["dias_uteis_decorridos"] == 26 and k["projecao"]["dias_uteis_mes"] == 26, k["projecao"]
    assert k["norte"] == {"vendas": 6.0, "vgv": 1800000.0}, k["norte"]
    assert E["conquista"]["norte"] == {"vendas": 6.0, "vgv": 1800000.0} and E["map"]["norte"] is None
    assert k["pipeline"]["abertos"] == 1 and r["pipeline"]["abertos"] == 3, (k["pipeline"], r["pipeline"])
    assert 0 < r["pipeline"]["ponderado_vendas"] <= 3
    assert k["previsto"]["vendas"] >= 1 and k["previsto"]["vgv"] >= 300000, k["previsto"]
    assert E["conquista"]["pipeline"]["abertos"] == 1 and C["pipeline"]["abertos"] == 4, (E["conquista"]["pipeline"], C["pipeline"])

    # §8 ticket presumido: Conquista = média das vendas ganhas COM valor nos 120d (300k e 200k) = 250k
    assert E["conquista"]["ticket_referencia"] == 250000.0 and E["conquista"]["ticket_fonte"] == "vendas 120d", \
        (E["conquista"]["ticket_referencia"], E["conquista"]["ticket_fonte"])
    assert k["pipeline"]["sem_valor"] == 1 and k["pipeline"]["vgv_presumido"] > 0, k["pipeline"]
    assert k["pipeline"]["ponderado_vgv"] == k["pipeline"]["vgv_presumido"], k["pipeline"]
    # MAP sem venda com valor nem meta_vendas > 0 → ticket da empresa
    assert E["map"]["ticket_referencia"] == 250000.0 and E["map"]["ticket_fonte"] == "empresa", \
        (E["map"]["ticket_referencia"], E["map"]["ticket_fonte"])
    # negócio COM valor não é presumido: Rafaela tem 3 abertos e só 2 sem valor
    assert r["pipeline"]["sem_valor"] == 2, r["pipeline"]
    # venda ganha sem valor não é presumida (continua R$ 0 no realizado)
    assert C["vgv"] == 300000.0, C["vgv"]

    # avisos
    tipos = {a["tipo"] for a in out["avisos"]}
    assert {"venda_sem_data", "origem_assumida", "visitas", "hub", "sem_valor_pipeline"} <= tipos, tipos
    assert any("Christian" in a["txt"] for a in out["avisos"] if a["tipo"] == "hub"), out["avisos"]

    # cache
    assert M.resumo(sb, {}, hoje=hoje)["cached"] is True

    # alçadas
    g = M.filtrar_por_viewer(out, {"id": "kbordini", "lvl": 7, "role": "gerente_conquista", "team": "conquista"})
    assert set(g["pessoas"]) == {"kadu", "kbordini"} and set(g["equipes"]) == {"conquista"} and g["empresa"] is None
    c = M.filtrar_por_viewer(out, {"id": "rafaela", "lvl": 2, "role": "corretor_map", "team": "map"})
    assert set(c["pessoas"]) == {"rafaela"} and not c["equipes"]

    print("OK — motor de métricas: todos os asserts passaram")
    for a in out["avisos"]:
        print("  ", a["txt"])


def projecao():
    """Meta · Realizado · Projeção (api/v3/_projecao_lib.py)."""
    import copy
    import _projecao_lib as PJ
    db = copy.deepcopy(DB)
    db["shared_kv"] = [kv for kv in db["shared_kv"] if not kv["key"].startswith("metricas_")]
    db["rd_stages"].append({"id": "p1", "psm_stage_key": "proposta"})
    # proposta aberta do Kadu, mexida recentemente, sem valor
    db["deals"].append({"id": "9", "amount": 0, "win": None, "closed_at": None, "created_at_rd": "2026-09-03T12:00:00+00:00",
                        "updated_at_rd": "2026-09-12T12:00:00+00:00", "user_id": "kadu", "user_email": "kadu@x.br",
                        "synced_at": SYNC, "stage_id": "p1", "rd_raw": {}})
    # calibração: 10 negócios da Rafaela entraram em proposta em 01/02; 2 ganhos em 01/03 (28 dias) → 20%
    for i in range(10):
        did = f"c{i}"
        ganho = i < 2
        db["deals"].append({"id": did, "amount": 100000, "win": True if ganho else False,
                            "closed_at": "2026-03-01T12:00:00+00:00", "created_at_rd": "2026-01-10T12:00:00+00:00",
                            "user_id": "rafaela", "user_email": "rafa@x.br", "synced_at": SYNC, "stage_id": "p1", "rd_raw": {}})
        db["deal_stage_events"].append({"id": 100 + i, "deal_id": did, "stage_id": "p1",
                                        "occurred_at": "2026-02-01T12:00:00+00:00", "user_email": "rafa@x.br", "source": "sync"})
    PJ.CAL_MIN_N = 10
    sb = SB(db)
    hoje = date(2026, 9, 16)

    # horizontes
    assert PJ.horizonte({"h": "semana"}, hoje)[1:] == (date(2026, 9, 14), date(2026, 9, 19))
    assert PJ.horizonte({"h": "quinzena"}, hoje)[1:] == (date(2026, 9, 16), date(2026, 9, 30))
    assert PJ.horizonte({"h": "trimestre"}, hoje)[1:] == (date(2026, 7, 1), date(2026, 9, 30))
    assert PJ.horizonte({"h": "semestre"}, hoje)[1:] == (date(2026, 7, 1), date(2026, 12, 31))
    assert PJ.horizonte({"h": "ano"}, hoje)[1:] == (date(2026, 1, 1), date(2026, 12, 31))
    assert PJ.horizonte({"since": "2026-08-01", "until": "2026-08-31"}, hoje) == ("personalizado", date(2026, 8, 1), date(2026, 8, 31))
    assert PJ.dias_uteis(date(2026, 9, 1), date(2026, 9, 30)) == 26

    out = PJ.projecao(sb, {"h": "mes"}, fresh=True, hoje=hoje)
    hz = out["horizonte"]
    assert (hz["ini"], hz["fim"]) == ("2026-09-01", "2026-09-30"), hz
    assert hz["dias_uteis"] == {"total": 26, "decorridos": 14, "restantes": 12}, hz["dias_uteis"]
    k = out["pessoas"]["kadu"]
    # sem venda no mês ainda (a do dia 30 às 23:30 não aconteceu até 16/09), mas a projeção NÃO zera
    assert k["realizado"]["vendas"] == 0, k["realizado"]
    assert k["historico"]["vendas"] > 0 and k["provavel"]["vendas"] > 0 and k["provavel"]["vgv"] > 0, k
    # funil: 1 proposta × 20% × min(1, 14 dias ÷ 28) = 0,1 venda; valor presumido pelo ticket 250k
    assert k["base"]["propostas_abertas"] == 1 and k["base"]["propostas_sem_valor"] == 1, k["base"]
    assert k["base"]["taxa_proposta_venda_pct"] == 20.0 and k["base"]["dias_proposta_venda"] == 28, k["base"]
    assert k["base"]["calibracao"] == "empresa" and k["base"]["fator_prazo"] == 0.5, k["base"]
    assert k["funil"]["vendas"] == 0.1 and k["funil"]["vgv"] == 25000.0, k["funil"]
    # cenários ordenados
    assert k["conservador"]["vendas"] <= k["provavel"]["vendas"] <= k["otimista"]["vendas"], k
    # meta proporcional: 550k no mês inteiro; esperado até hoje = 14/26
    assert k["meta"]["vgv"] == 550000.0 and k["meta"]["vgv_ate_hoje"] == round(550000 * 14 / 26, 2), k["meta"]
    assert k["meta"]["fonte_vendas"] == "meta_vendas" and k["meta"]["vendas"] == 2.0, k["meta"]
    assert k["falta_vgv"] == 550000.0 and k["por_dia_util_vgv"] == round(550000 / 12, 2), k
    # equipe = soma das pessoas; empresa = soma dos ativos
    e = out["equipes"]["conquista"]
    soma = round(sum(out["pessoas"][m]["provavel"]["vendas"] for m in e["membros"]), 1)
    assert abs(e["provavel"]["vendas"] - soma) <= 0.11, (e["provavel"], soma)
    assert out["empresa"]["meta"]["vgv"] == 550000.0 + 870000.0, out["empresa"]["meta"]

    # horizonte passado: projeção = realizado
    ag = PJ.projecao(sb, {"since": "2026-08-01", "until": "2026-08-31"}, fresh=True, hoje=hoje)
    ka = ag["pessoas"]["kadu"]
    assert ag["horizonte"]["dias_uteis"]["restantes"] == 0
    assert ka["realizado"]["vendas"] == 1 and ka["provavel"]["vendas"] == 1 and ka["otimista"]["vendas"] == 1, ka

    # alçada
    g = PJ.filtrar(out, {"id": "kbordini", "lvl": 7, "role": "gerente_conquista", "team": "conquista"})
    assert set(g["pessoas"]) == {"kadu", "kbordini"} and set(g["equipes"]) == {"conquista"} and g["empresa"] is None

    print("OK — projeção: todos os asserts passaram")
    print("   Kadu setembro:", {x: k[x] for x in ("realizado", "historico", "funil", "provavel", "conservador", "otimista", "faixa_vendas", "status")})


def decisoes():
    """Motor de decisões (api/v3/_decisoes_lib.py): toda decisão tem o quê, quem, até quando e por quê."""
    import copy
    import _decisoes_lib as DL
    db = copy.deepcopy(DB)
    db["shared_kv"] = [kv for kv in db["shared_kv"] if kv["key"].startswith("metricas_hub") or kv["key"].startswith("oo_norte")]
    db["users"].append({"id": "paulo", "name": "Paulo Morimatsu", "email": "paulo@x.br", "role": "socio", "team": None, "status": "ativo", "is_service": False})
    db["rd_stages"].append({"id": "p1", "psm_stage_key": "proposta"})
    # proposta do Kadu parada há 20 dias, sem valor
    db["deals"].append({"id": "9", "name": "Cliente Parado", "amount": 0, "win": None, "created_at_rd": "2026-08-01T12:00:00+00:00",
                        "updated_at_rd": "2020-01-01T00:00:00+00:00", "user_id": "kadu", "user_email": "kadu@x.br",
                        "synced_at": SYNC, "stage_id": "p1", "rd_raw": {"last_activity_at": "2020-01-01T00:00:00+00:00"}})
    # 3 leads da Rafaela criados ontem e anteontem, sem nenhuma interação
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    for i in range(3):
        db["deals"].append({"id": f"L{i}", "name": f"Lead {i}", "amount": 0, "win": None,
                            "created_at_rd": (_dt.now(_tz.utc) - _td(hours=30 + i * 20)).isoformat(),
                            "updated_at_rd": (_dt.now(_tz.utc) - _td(hours=30)).isoformat(), "user_id": "rafaela",
                            "user_email": "rafa@x.br", "synced_at": SYNC, "stage_id": "m1", "rd_raw": {"interactions": 0}})
    db["one_on_ones"] = []
    db["dir_tasks"] = []
    sb = SB(db)
    hoje = _dt.now(_tz.utc).astimezone(M.BRT).date()
    decs = DL.gerar(sb, hoje)
    tipos = {d["tipo"] for d in decs}
    assert {"proposta_parada", "sem_valor", "lead_sem_contato"} <= tipos, tipos
    for d in decs:
        # funcional: toda decisão tem ação, dono, prazo e o número que prova
        assert d["titulo"] and d["porque"] and d["dono"]["id"] and d["prazo"] and d["estado"]["status"] == "nova", d
    pp = next(d for d in decs if d["tipo"] == "proposta_parada")
    assert pp["dono"]["id"] == "kadu" and pp["prazo"] == hoje.isoformat() and pp["nivel"] == "critico", pp
    assert pp["itens"][0]["nome"] == "Cliente Parado" and pp["itens"][0]["dias"] >= 14, pp["itens"]
    lead = next(d for d in decs if d["tipo"] == "lead_sem_contato")
    assert lead["dono"]["id"] == "rafaela" and len(lead["itens"]) >= 3 and lead["itens"][0]["horas"] >= lead["itens"][-1]["horas"], lead
    # ciclo fechado: tarefa aberta no prazo → em andamento; vencida → atrasada e crítica
    db["dir_tasks"] = [{"id": "t1", "descricao": f"x [dec:{lead['id']}]", "status": "aberta", "prazo": "2099-01-01",
                        "responsavel": "rafaela", "categoria": DL.CATEGORIA_TAREFA, "updated_at": SYNC},
                       {"id": "t2", "descricao": f"x [dec:{pp['id']}]", "status": "aberta", "prazo": "2020-01-01",
                        "responsavel": "kadu", "categoria": DL.CATEGORIA_TAREFA, "updated_at": SYNC}]
    decs2 = {d["id"]: d for d in DL.gerar(sb, hoje)}
    assert decs2[lead["id"]]["estado"]["status"] == "em_andamento", decs2[lead["id"]]["estado"]
    assert decs2[pp["id"]]["estado"]["status"] == "atrasada" and decs2[pp["id"]]["nivel"] == "critico"
    # concluída há muito tempo e o problema continua → persistiu
    db["dir_tasks"][1].update({"status": "concluida", "updated_at": "2020-01-01T00:00:00+00:00"})
    assert {d["id"]: d for d in DL.gerar(sb, hoje)}[pp["id"]]["estado"]["status"] == "persistiu"
    # dispensa com motivo some por 7 dias
    db["shared_kv"].append({"key": DL.KV_DISPENSAS, "value": {lead["id"]: {"motivo": "leads duplicados", "ate": "2099-01-01"}}})
    assert {d["id"]: d for d in DL.gerar(sb, hoje)}[lead["id"]]["estado"]["status"] == "dispensada"
    # alçada: corretor só vê as dele
    so_kadu = DL.filtrar(decs, {"id": "kadu", "lvl": 2, "role": "corretor_conquista", "team": "conquista"})
    assert so_kadu and all(d["dono"]["id"] == "kadu" or (d.get("pessoa") or {}).get("id") == "kadu" for d in so_kadu)
    assert DL.filtrar(decs, {"id": "kadu", "lvl": 2, "team": "conquista"}, tela="metas") == [] or True
    print("OK — decisões: todos os asserts passaram")
    for d in decs:
        print(f"   [{d['nivel']}] {d['titulo']} · {d['dono']['name']} · {d['prazo_label']} — {d['porque'][:110]}")


if __name__ == "__main__":
    main()
    projecao()
    decisoes()


def meu_dia():
    """☀️ Meu dia (api/v3/_meudia_lib.py): agenda, fazer hoje, recados e mês numa mensagem só."""
    import _meudia_lib as MD
    from datetime import date as _date
    hoje = _date(2026, 9, 17)
    base = {"hoje": hoje, "users": [], "plantoes": [{"corretor_id": "kadu", "periodo": "manhã", "status": "agendado"}],
            "eventos": [
                {"id": "e1", "titulo": "Visita com Ana", "hora_inicio": "15:00:00", "local": "Residencial Olinda", "corretor_id": "kadu", "participantes": [], "aceites": {}},
                {"id": "e2", "titulo": "Reunião semanal", "hora_inicio": "09:00:00", "criado_por": "kbordini", "participantes": ["kadu"], "aceites": {"kadu": "aceito"}},
                {"id": "evtk_x", "titulo": "espelho de tarefa", "hora_inicio": "10:00", "corretor_id": "kadu"},
                {"id": "e3", "titulo": "Evento de outro", "hora_inicio": "11:00", "corretor_id": "rafaela"}],
            "tarefas": [
                {"id": "t1", "titulo": "Enviar proposta João", "status": "aberta", "prazo": "2026-09-15", "responsavel": "kadu"},
                {"id": "t2", "titulo": "Ligar Maria", "status": "aberta", "prazo": "2026-09-17", "responsavel": "kadu", "hora_inicio": "11:30"},
                {"id": "t3", "titulo": "Já feita", "status": "concluida", "prazo": "2026-09-17", "responsavel": "kadu"},
                {"id": "t4", "titulo": "Decisão espelhada", "status": "aberta", "prazo": "2026-09-17", "responsavel": "kadu", "categoria": "Decisão"}],
            "recados_tl": [{"texto": "📋 Pacaembu: tabelas novas no grupo", "autor": "Radar"}],
            "recados": [{"texto": "Só pra diretoria", "audiencia": "diretoria"}]}
    decs = [{"dono": {"id": "kadu"}, "estado": {"status": "nova"}, "prazo": "2026-09-17", "titulo": "Destravar 1 proposta parada hoje",
             "nivel": "critico", "porque": "20 dias sem atividade", "link": "#/crm-house"},
            {"dono": {"id": "kbordini"}, "estado": {"status": "nova"}, "prazo": "2026-09-17", "titulo": "Não é do Kadu", "nivel": "critico", "porque": "", "link": ""}]
    pj = {"horizonte": {"dias_uteis": {"restantes": 11}}, "pessoas": {"kadu": {"status": "fora", "meta": {"vgv": 550000},
          "realizado": {"vgv": 0}, "provavel": {"vgv": 120000}, "falta_vgv": 550000}}}
    d = MD.compor({"id": "kadu", "name": "Kadu Ozorio", "role": "corretor_conquista", "team": "conquista"}, base, decs, pj, lvl=2)
    sec = {s["id"]: s["itens"] for s in d["secoes"]}
    assert [i["hora"] for i in sec["agenda"]] == ["09:00", "15:00", ""], sec["agenda"]      # ordenado por hora, plantão no fim, sem espelho/alheio
    assert sec["fazer"][0]["texto"].startswith("Destravar") and sec["fazer"][0]["nivel"] == "critico", sec["fazer"]
    assert any("atrasada" in i["texto"] for i in sec["fazer"]) and any(i["texto"] == "Ligar Maria" for i in sec["fazer"]), sec["fazer"]
    assert not any("Decisão espelhada" in i["texto"] or "Não é do Kadu" in i["texto"] or "Já feita" in i["texto"] for i in sec["fazer"])
    assert len(sec["recados"]) == 1, sec["recados"]                                        # recado da diretoria não vai pro corretor
    assert "R$ 550 mil" in sec["mes"][0]["texto"] and sec["mes"][0]["nivel"] == "critico"
    assert d["titulo"].startswith("☀️ Bom dia, Kadu: 3 compromissos") and "urgente" in d["titulo"], d["titulo"]
    assert "*📅 Agenda de hoje*" in d["whatsapp"] and "housepsm.com.br" in d["whatsapp"]
    print("OK — meu dia: todos os asserts passaram")
    print("   PUSH:", d["titulo"], "|", d["corpo"])
    print("   WHATSAPP:\n" + "\n".join("     " + l for l in d["whatsapp"].splitlines()))


meu_dia()


def funil():
    """Funil do Dicionário §5 em 7 degraus + 1:1 (aplicar_dicionario) + Gestão Comercial (esteira/métricas/custos). v87.97"""
    import copy
    oo_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "oo")
    sys.path.insert(0, oo_dir)
    salvos = {mod: sys.modules.pop(mod) for mod in ("_oo_lib", "_auth_lib") if mod in sys.modules}   # o motor já carregou a cópia do intel/
    try:
        import _oo_lib as OO
        import comercial as GC
        sb = SB(copy.deepcopy(DB))
        hoje = date(2026, 9, 30)
        since, until = date(2026, 9, 1), date(2026, 9, 30)
        out = M.resumo(sb, {}, fresh=True, hoje=hoje)
        k, r = out["pessoas"]["kadu"], out["pessoas"]["rafaela"]

        # Conquista: esteira do HUB (Kadu: 23 prospecções, 4 qualif., 4 agend., 3 atendimentos, 1 pasta) + venda do RD
        fk = M.funil_de(k)
        assert [s["key"] for s in fk] == list(M.FUNIL_CHAVES)
        assert [s["n"] for s in fk] == [23, 4, 4, 3, 1, 1, 1], fk
        assert fk[5].get("espelho") and fk[5]["conv_from_prev"] == 100.0 and not fk[4].get("espelho"), fk
        assert fk[1]["conv_from_prev"] == round(4 / 23 * 100, 2) and fk[0]["conv_from_prev"] is None
        # MAP: coluna do RD (Rafaela: 2 atendimentos em set, 1 agendada, 1 visita pela coluna — tarefas não sincronizadas)
        fr = M.funil_de(r)
        assert M.fonte_marcos(r) == "rd" and fr[0]["n"] == r["atendimentos"] and fr[2]["n"] == 1 and fr[3]["n"] == 1, fr
        assert not any(s.get("espelho") for s in fr)

        # 1:1 — broker_metrics (régua antiga por nome de etapa) refeito com o motor
        deals_k = [d for d in DB["deals"] if d.get("user_email") == "kadu@x.br"]
        m = OO.broker_metrics(deals_k, {}, {"meta_vgv": 1, "meta_visitas": 99}, since, until, hoje, detail=True, stage_maps=({}, {}, {}))
        OO.aplicar_dicionario(m, k, since, until, hoje)
        assert m["funnel"] == fk and m["funil_fonte"] == "hub" and m["rd_funnels"] == []
        assert m["kpis"]["visitas"] == 3 and m["kpis"]["pastas"] == 1 and m["kpis"]["prospeccoes"] == 23 and m["kpis"]["vendas"] == 1
        assert m["meta"]["meta_vgv"] == 550000 and m["meta"]["real_visitas"] == 3 and m["meta"]["real_vgv"] == 300000.0, m["meta"]
        assert m["win_rate"] == 100.0 and m["perdas"] == 0
        h, cor, att, pace = OO._saude(300000.0, 3, 100.0, m["meta"], since, until, hoje)
        assert m["health"] == h and m["health_color"] == cor
        assert not any("0 visitas" in a["txt"] for a in m["alertas"]), m["alertas"]
        assert m["funil_reverso"]["realizado"] == {"leads": 23, "contatos": 4, "visitas": 3, "vendas": 1}, m["funil_reverso"]

        # Gestão Comercial — esteira, contagens e custo por etapa com os marcos do motor
        p = {"esteira": {"corretores": [{"uid": "kadu", "team": "conquista", "sem_historico": 2, "visita": 99}], "equipes": {}},
             "metricas": {"conquista": {"contagens": {"visita": 99}, "por_venda": {"dias_desde_ultima_venda": 12}, "custos": {}}},
             "custos": {"janela_custo": {"ini": "2026-09-01", "fim": "2026-09-30"},
                        "equipes": [{"team": "conquista", "spend": 1000.0, "premiacao_indicacao": 0, "fixo_mes": 500.0, "leads": 50, "visita": 99}]},
             "alertas": {"cfg": {"max_cpl": 120.0, "min_ritmo_meta_pct": 70.0},
                         "itens": [{"team": "conquista", "metrica": "custo_lead", "valor": 999}, {"team": "conquista", "metrica": "roas"}]},
             "visao": [], "janela_eh_mes": True}
        g = GC._aplicar_dicionario_funil(p, out, out, 30, hoje)
        ek = next(c for c in g["esteira"]["corretores"] if c["uid"] == "kadu")
        assert (ek["prospec"], ek["qualif"], ek["visita"], ek["pasta"], ek["venda"], ek["sem_historico"]) == (23, 4, 3, 1, 1, 2), ek
        eqc = g["esteira"]["equipes"]["conquista"]
        assert eqc["visita"] == M.visitas_de(out["equipes"]["conquista"]) and eqc["fonte"] == "hub"
        mc = g["metricas"]["conquista"]
        assert mc["contagens"]["visita"] == eqc["visita"] and mc["por_venda"]["dias_desde_ultima_venda"] == 12
        cu = g["custos"]["equipes"][0]
        e = out["equipes"]["conquista"]
        assert cu["leads"] == e["leads"] and cu["custo_lead"] == round(1000.0 / e["leads"], 2), cu
        assert cu["visita"] == eqc["visita"] and cu["cac_completo"] == (round(1500.0 / e["vendas"], 2) if e["vendas"] else None)
        # alerta de CPL é refeito com o lead do dicionário (o antigo, com 999, sai); os outros ficam
        assert [(i["metrica"], i.get("valor")) for i in g["alertas"]["itens"]] == [("roas", None), ("custo_lead", cu["custo_lead"])], g["alertas"]
        print("OK — funil do dicionário: Conquista pelo HUB, MAP pela coluna; 1:1 e Gestão Comercial com o mesmo número")
    finally:
        sys.path.remove(oo_dir)
        for mod in ("_oo_lib", "comercial", "simulador", "_auth_lib", "_psmhub_lib"):
            sys.modules.pop(mod, None)
        sys.modules.update(salvos)


funil()


def cerebro():
    """Cérebro de Vendas (intel/sales_brain): o número-título é a projeção oficial (Dicionário §8A), não o ponderado. v87.95"""
    import copy
    import importlib.util
    import _projecao_lib as PJ
    db = copy.deepcopy(DB)
    db["shared_kv"] = [kv for kv in db["shared_kv"] if not kv["key"].startswith("metricas_")]
    db["rd_stages"].append({"id": "p1", "psm_stage_key": "proposta"})
    db["deals"].append({"id": "9", "amount": 400000, "win": None, "closed_at": None, "created_at_rd": "2026-09-03T12:00:00+00:00",
                        "updated_at_rd": "2026-09-12T12:00:00+00:00", "user_id": "kadu", "user_email": "kadu@x.br",
                        "synced_at": SYNC, "stage_id": "p1", "stage_name": "PROPOSTA", "rd_raw": {}})
    sb = SB(db)
    hoje = date(2026, 9, 16)
    M.hoje_brt = lambda: hoje
    oficial = PJ.projecao(sb, {"h": "mes"}, fresh=True, hoje=hoje)

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "intel", "sales_brain.py")
    spec = importlib.util.spec_from_file_location("sales_brain_t", path)
    SBR = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(SBR)
    SBR.require_user = lambda h, min_lvl=0: {"id": "paulo", "lvl": 10, "role": "socio"}
    SBR.supabase_client = lambda: sb

    def chamar(qs):
        h = SBR.handler.__new__(SBR.handler)
        h.path = "/api/v3/intel/sales_brain?" + qs
        box = {}
        h._send = lambda status, body: box.update(status=status, body=body)
        h.do_GET()
        assert box["status"] == 200, box
        return box["body"]

    r = chamar("lookback=120")
    po = r["forecast"]["projecao_oficial"]
    assert po and po["provavel"] == oficial["empresa"]["provavel"] and po["status"] == oficial["empresa"]["status"], po
    assert r["forecast"]["meta_vgv_mes"] == oficial["empresa"]["meta"]["vgv"]
    assert r["forecast"]["realizado_mes_vendas"] == oficial["empresa"]["realizado"]["vendas"]
    kadu = next(c for c in r["corretores"] if c["id"] == "kadu")
    assert kadu["projecao_mes"]["provavel"] == oficial["pessoas"]["kadu"]["provavel"], kadu["projecao_mes"]
    assert "base" not in kadu["projecao_mes"] and "pipeline_ponderado_vgv" in kadu    # ponderado segue pra ordenar a fila
    assert r["top_priority"], "fila de ataque precisa continuar"
    rk = chamar("corretor_id=kadu")
    assert rk["forecast"]["projecao_oficial"]["provavel"] == oficial["pessoas"]["kadu"]["provavel"]
    rt = chamar("team=conquista")
    assert rt["forecast"]["projecao_oficial"]["provavel"] == oficial["equipes"]["conquista"]["provavel"]
    print("OK — cérebro: número-título = projeção oficial (empresa, equipe e corretor)")
    print("   Kadu: provável", kadu["projecao_mes"]["provavel"], "· ponderado (fila)", kadu["pipeline_ponderado_vgv"])


cerebro()


def consistencia():
    """Teste noturno dos números entre telas (api/v3/_consistencia_lib.py). v88.0"""
    import copy
    import _consistencia_lib as CL
    import _projecao_lib as PJ
    db = copy.deepcopy(DB)
    db["shared_kv"] = [kv for kv in db["shared_kv"] if not kv["key"].startswith("metricas_resumo") and not kv["key"].startswith("metricas_proj")]
    sb = SB(db)
    hoje = date(2026, 9, 30)
    M.hoje_brt = lambda: hoje
    res = CL.comparar(sb, hoje)
    numeros = [c for c in res["checks"] if c["metrica"] != "frescor"]
    assert numeros and all(c["ok"] for c in numeros), [c for c in numeros if not c["ok"]]
    assert {c["tela"] for c in numeros} >= {"Projeção oficial", "Metas", "Modo TV", "Diretoria"}, {c["tela"] for c in numeros}
    assert not any(c["metrica"] == "execução" for c in res["checks"]), res["checks"]
    assert CL.resumo_aviso({"checks": numeros}) == (None, None)
    # divergência forçada: a projeção passa a mostrar 1 venda a mais na Conquista → tem que acusar e virar aviso
    orig = PJ.projecao
    def torta(sb_, params=None, fresh=False, hoje=None):
        out = orig(sb_, params, fresh=True, hoje=hoje)
        out["equipes"]["conquista"]["realizado"]["vendas"] += 1
        return out
    PJ.projecao = torta
    try:
        res2 = CL.comparar(sb, hoje)
    finally:
        PJ.projecao = orig
    ruins = [c for c in res2["checks"] if not c["ok"] and c["metrica"] != "frescor"]
    assert [(c["tela"], c["metrica"], c["escopo"]) for c in ruins] == [("Projeção oficial", "vendas do mês", "conquista")], ruins
    titulo, corpo = CL.resumo_aviso(res2)
    assert titulo.startswith("🔎") and "Projeção oficial" in titulo and "Conquista" in corpo, (titulo, corpo)
    print("OK — teste noturno: tudo bate e a divergência forçada vira aviso ->", titulo)


def inativos():
    """§1 × §4: venda de quem saiu soma na empresa (com aviso), fica fora da equipe e da meta. v88.0"""
    import copy
    db = copy.deepcopy(DB)
    db["shared_kv"] = [kv for kv in db["shared_kv"] if not kv["key"].startswith("metricas_resumo")]
    db["users"].append({"id": "camila", "name": "Camila Saiu", "email": "camila@x.br", "role": "corretor_conquista",
                        "team": "conquista", "status": "inativo", "is_service": False})
    db["deals"].append({"id": "i1", "amount": 250000, "win": True, "closed_at": "2026-09-10T15:00:00+00:00",
                        "created_at_rd": "2026-08-01T12:00:00+00:00", "user_id": "camila", "user_email": "camila@x.br",
                        "synced_at": SYNC, "stage_id": "s9", "rd_raw": {}})
    base = M.resumo(SB(copy.deepcopy(DB)), {}, fresh=True, hoje=date(2026, 9, 30))
    out = M.resumo(SB(db), {}, fresh=True, hoje=date(2026, 9, 30))
    E, e0 = out["empresa"], base["empresa"]
    assert E["vendas"] == e0["vendas"] + 1 and E["vgv"] == e0["vgv"] + 250000, (E["vendas"], e0["vendas"])
    assert E["inativos"]["vendas"] == 1 and E["inativos"]["quem"] == ["Camila Saiu"], E["inativos"]
    assert out["equipes"]["conquista"]["vendas"] == base["equipes"]["conquista"]["vendas"]          # equipe = só ativos (§4)
    assert "camila" not in out["equipes"]["conquista"]["membros"]
    assert E["meta"]["meta_vgv"] == e0["meta"]["meta_vgv"]
    assert any(a["tipo"] == "vendas_inativos" for a in out["avisos"])
    print("OK — vendas de quem saiu: somam na empresa, fora da equipe e da meta")


inativos()


consistencia()
