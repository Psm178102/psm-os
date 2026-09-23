"""Teste da lógica de alertas da Central de Operações (api/v3/system/ops_central.py).

Roda sem rede e sem credenciais:
    python3 tests/test_ops_central.py

Cobre: status das rotinas do heartbeat (atraso, falha, semanal), dedupe dos alertas
(novo → avisa; persiste → relembra só de 6 em 6h e só erro; some → "resolvido"),
silêncio, piora atenção→erro e o congelamento fora do expediente.
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "system"))
import ops_central as O  # noqa: E402

NOW = datetime(2026, 9, 23, 18, 0, tzinfo=timezone.utc)   # 15h BRT


def iso(h_atras):
    return (NOW - timedelta(hours=h_atras)).isoformat()


def it(id_, status, nome=None):
    return {"id": id_, "nome": nome or id_, "status": status, "detalhe": "x", "grupo": "rotinas"}


def test_heartbeat():
    assert O.avaliar_heartbeat("k", 0.5, iso(0.4), "heartbeat", NOW)[0] == "ok"
    assert O.avaliar_heartbeat("k", 0.5, iso(1.6), "heartbeat", NOW)[0] == "warn"     # > 0.5+1h
    assert O.avaliar_heartbeat("k", 0.5, iso(7), "heartbeat", NOW)[0] == "error"      # > 0.5+6h
    assert O.avaliar_heartbeat("k", 24, iso(8 * 24), "heartbeat", NOW)[0] == "error"  # backup 8 dias
    assert O.avaliar_heartbeat("k", 24, iso(30), "heartbeat", NOW)[0] == "ok"         # < 48h
    assert O.avaliar_heartbeat("k", 24, iso(50), "heartbeat", NOW)[0] == "warn"
    st, det = O.avaliar_heartbeat("k", 2, iso(0.1), "falha: HTTP 500", NOW)
    assert st == "error" and "HTTP 500" in det
    assert O.avaliar_heartbeat("k", 1, None, None, NOW)[0] == "error"
    assert O.avaliar_heartbeat("k", None, iso(9 * 24), "heartbeat", NOW)[0] == "error"
    assert O.avaliar_heartbeat("k", None, iso(3 * 24), "heartbeat", NOW)[0] == "ok"
    assert "executando" in O.avaliar_heartbeat("k", 0.5, iso(0.2), "heartbeat (em execução, timeout do aguardo)", NOW)[1]


def test_diff():
    # 1ª vez: erro e atenção avisam; ok não entra
    novo, novos, rel, res = O.diff_alertas([it("a", "error"), it("b", "warn"), it("c", "ok")], {}, {}, NOW)
    assert {i["id"] for i in novos} == {"a", "b"} and not rel and not res
    assert set(novo) == {"a", "b"}
    # 1h depois, igual: nada (dedupe)
    n1 = NOW + timedelta(hours=1)
    novo2, novos2, rel2, res2 = O.diff_alertas([it("a", "error"), it("b", "warn")], novo, {}, n1)
    assert not novos2 and not rel2 and not res2
    assert novo2["a"]["desde"] == novo["a"]["desde"]
    # 7h depois: relembra só o ERRO
    n7 = NOW + timedelta(hours=7)
    _, novos3, rel3, _ = O.diff_alertas([it("a", "error"), it("b", "warn")], novo, {}, n7)
    assert not novos3 and [i["id"] for i in rel3] == ["a"]
    # atenção piorou pra erro: avisa na hora
    _, novos4, _, _ = O.diff_alertas([it("a", "error"), it("b", "error")], novo, {}, n1)
    assert [i["id"] for i in novos4] == ["b"]
    # sumiu: resolvido
    _, _, _, res5 = O.diff_alertas([it("b", "warn")], novo, {}, n1)
    assert res5 == ["a"]


def test_herda_nao_alerta():
    h = it("ag:vera", "error"); h["herda"] = "in:anthropic"
    _, novos, _, _ = O.diff_alertas([it("in:anthropic", "error"), h], {}, {}, NOW)
    assert [i["id"] for i in novos] == ["in:anthropic"]


def test_silencio():
    sil = {"a": (NOW + timedelta(hours=5)).isoformat()}
    novo, novos, rel, _ = O.diff_alertas([it("a", "error")], {}, sil, NOW)
    assert not novos and not rel and "a" in novo          # registra, mas não avisa
    vencido = {"a": (NOW - timedelta(hours=1)).isoformat()}
    _, novos, _, _ = O.diff_alertas([it("a", "error")], {}, vencido, NOW)
    assert [i["id"] for i in novos] == ["a"]


def test_fora_do_expediente():
    madrugada = datetime(2026, 9, 23, 8, 0, tzinfo=timezone.utc)   # 5h BRT
    itens = [it("hb:sync_rd_inc", "error"), it("hb:backup_auto", "error")]
    ign = O.fora_do_expediente(itens, madrugada)
    assert ign == {"hb:sync_rd_inc"}                               # backup (24h) segue valendo
    assert O.fora_do_expediente(itens, NOW) == set()
    anterior = {"hb:sync_rd_inc": {"status": "error", "desde": iso(10), "avisado_em": iso(10)}}
    novo, novos, rel, res = O.diff_alertas([it("hb:sync_rd_inc", "ok")], anterior, {}, madrugada, ignorar=ign)
    assert not res and novo["hb:sync_rd_inc"] == anterior["hb:sync_rd_inc"]   # congelado
    _, novos, _, _ = O.diff_alertas(itens, {}, {}, madrugada, ignorar=ign)
    assert [i["id"] for i in novos] == ["hb:backup_auto"]


def test_resumo_e_idade():
    st, r = O.resumo([it("a", "ok"), it("b", "warn"), it("c", "unknown")])
    assert st == "warn" and r["ok"] == 1 and r["unknown"] == 1
    assert O.avaliar_idade(None, 0, 0) == "unknown"
    assert O.avaliar_idade(None, 1, 2) == "error"
    assert O.avaliar_idade(3, 2, 5) == "warn"
    assert O.fmt_idade(0.2) == "há 12 min" and O.fmt_idade(5) == "há 5h" and O.fmt_idade(72) == "há 3 dias"


if __name__ == "__main__":
    n = 0
    for nome, fn in list(globals().items()):
        if nome.startswith("test_") and callable(fn):
            fn()
            n += 1
            print("ok ", nome)
    print(f"{n} testes passaram")
