# -*- coding: utf-8 -*-
"""Teste da roleta de leads do WhatsApp (api/v3/wa/_leads_lib.py) com um Supabase falso.

Roda sem rede, sem credenciais e sem tocar no RD:
    python3 tests/test_wa_roleta.py

Cobre: classificação pela frase de origem (inclusive "minha casa" do dono que quer
vender × Minha Casa Minha Vida), roleta por carga com corretor inativo fora,
idempotência do webhook, conversa em andamento, triagem tardia, fallback do
gestor, o portão cfg.ativo, o SLA e o repique.
"""
import sys, types, os, json, itertools
from datetime import datetime, timezone

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3", "wa")

# ── stubs dos libs do repo (evita puxar supabase/jwt) ──────────────────────
avisos = []
_auth = types.ModuleType("_auth_lib")
_auth.notify = lambda ids, tipo, title, body=None, **k: avisos.append((list(ids), title, body))
_auth.send_web_push = lambda ids, title, body=None, **k: None
sys.modules["_auth_lib"] = _auth

import re as _re
_wa = types.ModuleType("_wa_lib")
def _norm(raw):
    dig = _re.sub(r"\D", "", str(raw or "")).lstrip("0")
    if len(dig) < 10: return None
    if not dig.startswith("55"): dig = "55" + dig
    return dig if len(dig) <= 15 else None
_wa.normalize_phone = _norm
sys.modules["_wa_lib"] = _wa

sys.path.insert(0, BASE)
import _leads_lib as L


# ── FakeSB ────────────────────────────────────────────────────────────────
class Q:
    def __init__(self, db, tab):
        self.db, self.tab, self.f, self.lim, self.ordem = db, tab, [], None, None
        self.payload = None; self.op = None
    # leitura
    def select(self, *a, **k): self.op = "select"; return self
    def eq(self, c, v): self.f.append((c, "eq", v)); return self
    def neq(self, c, v): self.f.append((c, "neq", v)); return self
    def gte(self, c, v): self.f.append((c, "gte", v)); return self
    def lt(self, c, v): self.f.append((c, "lt", v)); return self
    def in_(self, c, v): self.f.append((c, "in", v)); return self
    def is_(self, c, v): self.f.append((c, "is", v)); return self
    def order(self, c, desc=False): self.ordem = (c, desc); return self
    def limit(self, n): self.lim = n; return self
    # escrita
    def insert(self, row): self.op, self.payload = "insert", row; return self
    def update(self, row): self.op, self.payload = "update", row; return self
    def upsert(self, row, on_conflict=None): self.op, self.payload = "upsert", row; return self

    def _match(self, r):
        for c, o, v in self.f:
            got = r.get(c)
            if o == "eq" and got != v: return False
            if o == "neq" and got == v: return False
            if o == "gte" and not (got and str(got) >= str(v)): return False
            if o == "lt" and not (got and str(got) < str(v)): return False
            if o == "in" and got not in v: return False
            if o == "is" and v == "null" and got is not None: return False
        return True

    def execute(self):
        rows = self.db.setdefault(self.tab, [])
        if self.op == "insert":
            r = dict(self.payload)
            r.setdefault("id", next(self.db["_seq"]))
            r.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            for k, v in {"status": "novo", "repiques": 0, "historico": [],
                         "ficha": {}, "trilha": "indefinido"}.items():
                r.setdefault(k, v)
            if r.get("wa_msg_id") and any(x.get("wa_msg_id") == r["wa_msg_id"] for x in rows):
                raise Exception("23505 duplicate key")
            rows.append(r)
            return types.SimpleNamespace(data=[r])
        if self.op == "upsert":
            key = "key" if self.tab == "shared_kv" else "id"
            p = self.payload if isinstance(self.payload, dict) else self.payload[0]
            for r in rows:
                if r.get(key) == p.get(key):
                    r.update(p); return types.SimpleNamespace(data=[r])
            rows.append(dict(p)); return types.SimpleNamespace(data=[p])
        if self.op == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit: r.update(self.payload)
            return types.SimpleNamespace(data=hit)
        out = [r for r in rows if self._match(r)]
        if self.ordem:
            c, desc = self.ordem
            out = sorted(out, key=lambda r: str(r.get(c) or ""), reverse=desc)
        if self.lim: out = out[:self.lim]
        return types.SimpleNamespace(data=[dict(r) for r in out])


class FakeSB:
    def __init__(self): self.db = {"_seq": itertools.count(1)}
    def table(self, t): return Q(self.db, t)


def cenario():
    sb = FakeSB()
    sb.db["users"] = [
        {"id": "u-ana", "name": "Ana", "email": "ana@psm.com", "role": "corretor", "status": "ativo"},
        {"id": "u-bruno", "name": "Bruno", "email": "bruno@psm.com", "role": "corretor", "status": "ativo"},
        {"id": "u-caio", "name": "Caio", "email": "caio@psm.com", "role": "corretor", "status": "inativo"},
        {"id": "u-ge", "name": "Gerente", "email": "ge@psm.com", "role": "gerente", "status": "ativo"},
    ]
    L.kv_set(sb, L.KV_CFG, {
        "ativo": True,
        "trilhas": {"comprar": ["u-ana", "u-bruno", "u-caio"], "captacao": ["u-ge"],
                    "locacao": [], "conquista": ["u-ana"]},
        "rd_stage": {t: "" for t in L.TRILHAS},     # sem RD: o card local ainda nasce
        "horario": {"ini": "00:00", "fim": "23:59", "dias": [0, 1, 2, 3, 4, 5, 6]},
    })
    return sb


def linha(n, ok, extra=""):
    print(("  ok   " if ok else "  FALHA ") + n + ((" — " + extra) if extra else ""))
    return ok


def main():
    print("\n1. Classificação da frase de origem")
    casos = [("Quero saber sobre o Lux JK", "comprar"),
             ("Quero vender meu imóvel", "captacao"),
             ("quero alugar um apto no Bosque", "locacao"),
             ("Quero meu primeiro imóvel", "conquista"),
             ("Oi", "indefinido"),
             ("quanto vale minha casa no Redentora?", "captacao"),
             ("vi a placa do imóvel 4471", "comprar"),
             ("é do minha casa minha vida?", "conquista"),
             ("tenho FGTS, dá pra usar?", "conquista"),
             ("quero anunciar meu apartamento com vocês", "captacao")]
    todos = all(linha(f'"{t}" → {L.classificar(t)}', L.classificar(t) == e, f"esperado {e}")
                for t, e in casos)

    print("\n2. Roleta por carga (Caio está inativo — não pode receber)")
    sb = cenario()
    donos = []
    for i in range(4):
        r = L.processar_mensagem(sb, f"1799911110{i}", "Quero saber sobre o Lux JK", msg_id=f"m{i}")
        donos.append(r.get("corretor_id"))
    todos &= linha(f"4 leads → {donos}", donos.count("u-ana") == 2 and donos.count("u-bruno") == 2
                   and "u-caio" not in donos, "esperado 2 Ana / 2 Bruno, zero Caio")

    print("\n3. Idempotência e conversa em andamento")
    r1 = L.processar_mensagem(sb, "17999111100", "Quero saber sobre o Lux JK", msg_id="m0")
    todos &= linha(f"mesmo msg_id → {r1.get('acao')}", r1.get("acao") == "duplicado")
    r2 = L.processar_mensagem(sb, "17999111100", "pode ser amanhã às 10h", msg_id="m99")
    todos &= linha(f"2ª mensagem do mesmo número → {r2.get('acao')}", r2.get("acao") == "anexado")
    leads = sb.db["wa_leads"]
    todos &= linha(f"total de leads = {len(leads)}", len(leads) == 4, "4 números, 4 leads")

    print("\n4. Lead sem etiqueta espera a triagem e depois entra na fila")
    r3 = L.processar_mensagem(sb, "17988000001", "oi", msg_id="x1")
    todos &= linha(f'"oi" → {r3.get("acao")}', r3.get("acao") == "aguardando_triagem")
    r4 = L.processar_mensagem(sb, "17988000001", "é para vender meu imóvel", msg_id="x2")
    lead = [l for l in sb.db["wa_leads"] if l["wa_phone"] == "5517988000001"][0]
    todos &= linha(f"depois da triagem → {r4.get('acao')} / {lead['trilha']} / dono {lead.get('corretor_id')}",
                   r4.get("acao") == "classificado" and lead["trilha"] == "captacao"
                   and lead["corretor_id"] == "u-ge")

    print("\n5. Trilha sem ninguém na fila cai no fallback (gerente/sócio)")
    r5 = L.processar_mensagem(sb, "17977000002", "quero alugar", msg_id="y1")
    todos &= linha(f"locação sem fila → {r5.get('acao')}", r5.get("acao") == "sem_dono")
    todos &= linha(f"gerente avisado: {avisos[-1][0]}", "u-ge" in avisos[-1][0])

    print("\n6. Portão desligado: registra e não distribui")
    sb2 = cenario()
    L.kv_set(sb2, L.KV_CFG, {**L.get_cfg(sb2), "ativo": False})
    r6 = L.processar_mensagem(sb2, "17966000003", "quero comprar apartamento", msg_id="z1")
    todos &= linha(f"cfg.ativo=false → {r6.get('acao')}", r6.get("acao") == "registrado")

    print("\n7. SLA: quem não assume vira cobrança do gestor")
    antes = len(avisos)
    for l in sb.db["wa_leads"]:
        if l.get("status") == "distribuido":
            l["distribuido_em"] = "2020-01-01T00:00:00+00:00"
    res = L.varrer(sb)
    todos &= linha(f"varredura → {res}", res["cobrados"] >= 1 and len(avisos) > antes)

    print("\n8. Repique automático troca o dono")
    cfg = L.get_cfg(sb); cfg["repique_auto"] = True; L.kv_set(sb, L.KV_CFG, cfg)
    alvo = [l for l in sb.db["wa_leads"] if l.get("status") == "distribuido"
            and l.get("trilha") == "comprar"][0]
    dono0 = alvo["corretor_id"]; alvo["distribuido_em"] = "2020-01-01T00:00:00+00:00"
    L.varrer(sb)
    dono1 = [l for l in sb.db["wa_leads"] if l["id"] == alvo["id"]][0]["corretor_id"]
    todos &= linha(f"dono {dono0} → {dono1}", dono0 != dono1)

    print("\n" + ("TUDO VERDE" if todos else "TEM FALHA ACIMA"))
    return 0 if todos else 1


sys.exit(main())
