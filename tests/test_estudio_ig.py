"""Teste do 📸 Estúdio Instagram (api/v3/marketing/estudio.py) com Supabase e IA falsos.

Roda sem rede e sem credenciais:
    python3 tests/test_estudio_ig.py

Cobre: as 13 skills montam system prompt com o cânone; anti-robô bloqueia a Sol que
"viveu" e o "Não é X. É Y." sem se enganar com o bloco AUDITORIA; gerar → nota do
Auditor vai pro Placar (cmo_notas); corte 8 trava o envio; ≥8 cai na fila do Paulo
(cmo_pecas) com o texto completo; o veredito do Paulo volta pro histórico.
"""
import io
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "marketing"))
import _ig_skills_data as IG  # noqa: E402
from _ig_checks import checar  # noqa: E402
import estudio as E  # noqa: E402


# ─── Supabase falso (só shared_kv/users) ─────────────────────────────────
class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, db, table): self.db, self.table, self.k, self.payload, self.ins, self.upd = db, table, None, None, None, None
    def select(self, *_a): return self
    def eq(self, _c, v): self.k = v; return self
    def limit(self, _n): return self
    def upsert(self, row): self.payload = row; return self
    def insert(self, row): self.ins = row; return self
    def update(self, row): self.upd = row; return self

    def execute(self):
        if self.table == "users":
            return _R([{"id": "u1", "role": "socio", "status": "ativo"}])
        if self.table == "paulo_cards":
            cards = self.db.setdefault("_cards", [])
            if self.ins is not None:
                cards.append(dict(self.ins)); return _R([self.ins])
            if self.upd is not None:
                for c in cards:
                    if c["id"] == self.k: c.update(self.upd)
                return _R([])
            return _R([c for c in cards if c.get("board") == self.k])
        if self.payload is not None:
            self.db[self.payload["key"]] = json.loads(json.dumps(self.payload["value"]))
            return _R([self.payload])
        return _R([{"value": self.db[self.k]}] if self.k in self.db else [])


class _SB:
    def __init__(self): self.db = {}
    def table(self, t): return _Q(self.db, t)


SB = _SB()
E.supabase_client = lambda: SB
E.audit = lambda *a, **k: None
E.notify = lambda *a, **k: None
E.send_web_push = lambda *a, **k: None
E.lvl_of = lambda role: 10
ATOR = {"nome": "Teste", "login": "teste"}
E.require_user = lambda self, min_lvl=0: ATOR

BOM = ("Já somou o aluguel de 2026? Essa é a única conta sem data para acabar!\n"
       "Toda semana alguém me pergunta se dá pra usar o FGTS na entrada. Dá, e pra quem mora na Zona Norte "
       "a conta muda bastante.\nComenta SIMULA que a Sol te chama com a tabela atualizada. "
       "Simulação sujeita a análise de crédito CAIXA.\n#PsmConquista #ImovelRioPreto #SeuImovelSuaConquista")
NOTA = {"v": 8.6}


def fake_ia(system, user, max_tokens=3000, temperature=0.6, json_mode=False):
    if "AUDITOR DE MARKETING" in system:
        return json.dumps({"nota": NOTA["v"], "itens": {"gancho": 3, "clareza_cta": 2, "marca": 2, "evidencia": 1,
                                                          "originalidade": 1}, "motivos": ["evidência fraca"],
                           "titulo": "FGTS na entrada", "gancho_texto": "Já somou o aluguel de 2026?",
                           "cta": "Comenta SIMULA", "serie": "Sol Explica", "canal": "IG Reels",
                           "pendencias": ""}), "fake", None, None
    return BOM, "fake", None, None


E._ia = fake_ia


def call(method, body=None):
    h = E.handler.__new__(E.handler)
    raw = json.dumps(body or {}).encode()
    h.headers = {"Content-Length": str(len(raw))}
    h.rfile = io.BytesIO(raw)
    out = {}
    h._send = lambda status, b: out.update(status=status, body=b)
    getattr(h, "do_" + method)()
    return out["status"], out["body"]


def test_prompts():
    assert len(IG.SKILLS) == 13 and "REGRA-MÃE" in IG.CANON
    for sid in E.UI:
        s = E._system_skill(sid)
        assert "MODO HOUSE" in s and "REGRA-MÃE" in s and f"SKILL {sid}" in s, sid


def test_antirrobo():
    ruim = ("Não é só um apartamento. É a sua conquista!\nEu já passei por isso, paguei aluguel por anos.\n\n"
            "AUDITORIA: evitei \"Não é X. É Y.\" e \"aprovação garantida\"\n")
    r = checar(ruim)
    txt = " | ".join(r["bloqueios"])
    assert r["veredito"] == "BLOQUEADO", r
    assert "Não é X" in txt and "passei por isso" in txt, txt
    assert not any("aprovação garantida" in b.lower() for b in r["bloqueios"]), "leu o bloco AUDITORIA"
    assert checar(BOM)["bloqueios"] == []


def test_fluxo():
    st, b = call("POST", {"acao": "gerar", "skill": "ig-caption", "pedido": "legenda FGTS na entrada"})
    assert st == 200, b
    item = b["item"]
    assert item["auditoria"]["nota"] == 8.6 and item["checagem"]["bloqueios"] == []
    assert SB.db["cmo_notas"]["itens"][0]["agente"] == "estudio:ig-caption"

    st, b = call("POST", {"acao": "enviar", "id": item["id"]})
    assert st == 200, b
    peca = SB.db["cmo_pecas"]["itens"][0]
    assert peca["status"] == "pendente" and peca["texto"] == BOM and peca["origem"] == "estudio"
    card = SB.db["_cards"][0]
    assert card["board"] == "conteudo_conquista" and card["status"] == "aprovacao" and peca["card_id"] == card["id"]
    st, b = call("POST", {"acao": "enviar", "id": item["id"]})
    assert st == 409, "enviou duas vezes"

    # veredito do Paulo no /cmo move o card (aprovada → agendar)
    import importlib.util
    spec = importlib.util.spec_from_file_location("cmo", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "diretoria", "cmo.py"))
    C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
    C.supabase_client = lambda: SB; C.audit = lambda *a, **k: None; C.require_user = lambda self, min_lvl=0: ATOR
    h = C.handler.__new__(C.handler); raw = json.dumps({"acao": "validar", "peca_id": peca["id"], "veredito": "aprovada"}).encode()
    h.headers = {"Content-Length": str(len(raw))}; h.rfile = io.BytesIO(raw); out = {}
    h._send = lambda s, bb: out.update(s=s, b=bb); h.do_POST()
    assert out["s"] == 200 and card["status"] == "agendamento", out
    SB.db["cmo_pecas"]["itens"][0]["status"] = "pendente"

    # abaixo do corte não sobe
    NOTA["v"] = 7.4
    st, b = call("POST", {"acao": "gerar", "skill": "ig-reel", "pedido": "reel FGTS"})
    st2, b2 = call("POST", {"acao": "enviar", "id": b["item"]["id"]})
    assert st2 == 422 and "corte" in b2["error"], b2

    # insumo (não-peça) gera mas não tem fila; refazer carrega versão
    st, b = call("POST", {"acao": "gerar", "skill": "ig-reel", "pedido": "x", "base_id": b["item"]["id"], "ajuste": "gancho com número"})
    assert st == 200 and b["item"]["versao"] == 2

    # veredito do Paulo volta pro histórico
    SB.db["cmo_pecas"]["itens"][0]["status"] = "ajustar"
    SB.db["cmo_pecas"]["itens"][0]["motivo"] = "começa pelo número"
    st, b = call("GET")
    h = next(x for x in b["historico"] if x.get("peca_id") == peca["id"])
    assert h["veredito"] == "ajustar" and h["veredito_motivo"] == "começa pelo número"
    assert len(b["skills"]) == 14

    # peça cortada no limite não sobe pra fila
    NOTA["v"] = 9.0
    E._ia = lambda *a, **k: (BOM, "fake", None, "cortado no limite de tamanho") if "AUDITOR DE MARKETING" not in a[0] else fake_ia(*a, **k)
    st, b2 = call("POST", {"acao": "gerar", "skill": "ig-caption", "pedido": "x"})
    E._ia = fake_ia
    st3, b3 = call("POST", {"acao": "enviar", "id": b2["item"]["id"]})
    assert st3 == 422 and "cortado" in b3["error"], b3
    assert b["esteira"]["por_etapa"]["agendamento"] == 1


def test_portfolio():
    SB.db["tabelas_lancamentos"] = {"tabelas": [
        {"marca": "conquista", "categoria": "MCMV", "colunas": ["Empreendimento", "Renda"], "linhas": [["SOLIS", "2.400"]]},
        {"marca": "imoveis", "categoria": "MAP", "colunas": ["a"], "linhas": [["LUX JK"]]}]}
    p = E._portfolio(SB)
    assert "SOLIS" in p and "LUX JK" not in p, p   # só a Conquista entra
    assert "PORTFÓLIO CONQUISTA AO VIVO" in E._system_skill("ig-caption", p)


if __name__ == "__main__":
    for fn in (test_prompts, test_antirrobo, test_fluxo, test_portfolio):
        fn()
        print("ok", fn.__name__)
    print("TUDO OK")
