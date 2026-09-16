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


if __name__ == "__main__":
    main()
    projecao()
