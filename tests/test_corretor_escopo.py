"""Teste: CORRETOR vê só os próprios números e nunca a Consultoria Arch Leg. v88.91

Roda sem rede e sem credenciais:
    python3 tests/test_corretor_escopo.py

Chama os HANDLERS REAIS do backend (os mesmos que a Vercel serve) logado como cada
tipo de login, com um banco em memória. Simula o pior caso que causou o bug de 28/09:
o override de nível dos papéis corretor_* de volta em 9 na Central de Permissões.

Cobre:
  • nível efetivo de todo corretor = 2 (qualquer equipe, com ou sem cargo adicional)
  • /metrics/overview (Painel inicial / Meu Painel): escopo 'self' e SÓ os números dele
  • /oo/list e /oo/corretor (One-on-One): só o próprio; o de outro → 403
  • /profile/data (Meu Perfil): o próprio ok; o de outro → 403
  • /gp/arch_leg (Consultoria Arch Leg): 403 pra corretor
  • /settings/roles set_lvl: Central recusa subir nível de corretor
  • controles: gerente Conquista e sócio continuam com a visão deles
"""
import io
import json
import os
import sys
import time
import importlib.util

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "v3")
sys.path.insert(0, RAIZ)
import _auth_lib as A  # noqa: E402

# ─── banco em memória ────────────────────────────────────────────────────────
USERS = [
    {"id": "kadu", "name": "Kadu", "role": "corretor_conquista", "team": "conquista", "cargos": []},
    {"id": "stephanie", "name": "Stephanie", "role": "corretor_conquista", "team": "conquista", "cargos": []},
    {"id": "rafaela", "name": "Rafaela", "role": "corretor_map", "team": "map",
     "cargos": ["corretor_locacao", "corretor_terceiros", "consultor_morimatsu"]},
    {"id": "yara", "name": "Yara", "role": "corretor_map", "team": "map", "cargos": ["corretor_locacao", "corretor_terceiros"]},
    {"id": "joao_henrique", "name": "João Henrique", "role": "corretor_map", "team": "map", "cargos": []},
    {"id": "kaue", "name": "Kaue", "role": "gerente_conquista", "team": "conquista", "cargos": []},
    {"id": "paulo", "name": "Paulo", "role": "socio", "team": None, "cargos": []},
]
for u in USERS:
    u.update(status="ativo", email=u["id"] + "@psm", is_service=False, hide_from_ranking=False)

CORRETORES = [u["id"] for u in USERS if u["role"].startswith("corretor")]


def _db():
    deals, comms, oos = [], [], []
    for i, u in enumerate(USERS):
        for k in range(i + 1):   # cada um tem uma quantidade diferente → dá pra saber de quem é o número
            deals.append({"id": f"d-{u['id']}-{k}", "user_id": u["id"], "user_email": u["email"], "amount": 100000,
                          "win": True, "closed_at": "2026-09-10T12:00:00+00:00", "created_at_rd": "2026-09-01T12:00:00+00:00",
                          "updated_at_rd": "2026-09-10T12:00:00+00:00", "pipeline_name": "X", "amt_total": 100000})
            comms.append({"id": f"c-{u['id']}-{k}", "corretor_id": u["id"], "valor": 1000, "status": "pendente",
                          "data": "2026-09-10", "data_pagamento": None})
        oos.append({"id": f"oo-{u['id']}", "corretor_id": u["id"], "lider_id": "kaue", "data": "2026-09-20"})
    return {
        "users": [dict(u) for u in USERS], "deals": deals, "commissions": comms, "one_on_ones": oos,
        "metas": [], "audit_log": [], "dir_tasks": [], "user_profile": [], "oo_feedbacks": [],
        "shared_kv": [{"key": "arch_leg_dossies", "value": {"user:kadu": {"nota": "SENSÍVEL"}, "team:conquista": {"nota": "x"}}}],
    }


class Q:
    """Query builder mínimo do supabase-py: aplica eq/in_/neq; o resto não filtra."""
    def __init__(self, db, t):
        self.db, self.t, self.f, self._lim = db, t, [], None

    def __getattr__(self, name):   # gte, lte, order, ilike, or_, range, not_, is_… → encadeia sem filtrar
        return lambda *a, **k: self

    @property
    def not_(self):
        return self

    def select(self, *a, **k): return self
    def eq(self, c, v): self.f.append(lambda r: str(r.get(c)) == str(v)); return self
    def neq(self, c, v): self.f.append(lambda r: str(r.get(c)) != str(v)); return self
    def in_(self, c, vs): s = {str(x) for x in vs}; self.f.append(lambda r: str(r.get(c)) in s); return self
    def limit(self, n): self._lim = n; return self
    def upsert(self, *a, **k): return self
    def insert(self, *a, **k): return self
    def update(self, *a, **k): return self
    def delete(self, *a, **k): return self

    def execute(self):
        rows = [r for r in self.db.get(self.t, []) if all(f(r) for f in self.f)]
        return type("R", (), {"data": rows[: self._lim] if self._lim else rows, "count": len(rows)})()


class FakeSB:
    def __init__(self): self.db = _db()
    def table(self, t): return Q(self.db, t)
    def rpc(self, *a, **k): return Q({}, "_")


SB = FakeSB()
LOGADO = {"id": None}


def _current_user(_h):
    u = next((x for x in USERS if x["id"] == LOGADO["id"]), None)
    return A.enrich_user(dict(u)) if u else None


# pior caso: override de nível de volta em 9 (o que causou o bug)
A._LVL_OVERRIDES.update(d={"corretor_map": 9, "corretor_conquista": 9}, t=time.time() + 1e6)
A._CUSTOM_LVL.update(d={"consultor_arch_leg": 5, "consultor_morimatsu": 2}, t=time.time() + 1e6)
A.current_user = _current_user
A.supabase_client = lambda: SB
A.audit = lambda *a, **k: None


def _mod(rel):
    path = os.path.join(RAIZ, rel)
    sys.path.insert(0, os.path.dirname(path))
    spec = importlib.util.spec_from_file_location("h_" + rel.replace("/", "_")[:-3], path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    for nome in ("supabase_client", "audit"):
        if hasattr(m, nome):
            setattr(m, nome, getattr(A, nome))
    return m


MODS = {r: _mod(r) for r in ("metrics/overview.py", "oo/list.py", "oo/corretor.py", "profile/data.py",
                             "gp/arch_leg.py", "settings/roles.py")}


def chama(quem, rel, path="/", metodo="GET", body=None):
    LOGADO["id"] = quem
    h = MODS[rel].handler.__new__(MODS[rel].handler)
    raw = json.dumps(body or {}).encode()
    h.path, h.command = path, metodo
    h.headers = {"Authorization": "Bearer x", "Content-Length": str(len(raw)), "Content-Type": "application/json"}
    h.rfile, h.wfile = io.BytesIO(raw), io.BytesIO()
    st = {}
    h.send_response = lambda s, *a: st.setdefault("s", s)
    h.send_header = lambda *a: None
    h.end_headers = lambda: None
    h.log_message = lambda *a: None
    getattr(h, "do_" + metodo)()
    txt = h.wfile.getvalue().decode() or "{}"
    return st.get("s"), json.loads(txt)


def _qtd(uid):   # quantos deals/comissões esse login tem no banco de teste
    return next(i for i, u in enumerate(USERS) if u["id"] == uid) + 1


# ─── testes ──────────────────────────────────────────────────────────────────
def test_nivel():
    for uid in CORRETORES:
        u = _current_user(None)
        LOGADO["id"] = uid
        u = _current_user(None)
        assert u["lvl"] == 2, (uid, u["lvl"])
    LOGADO["id"] = "kaue"; assert _current_user(None)["lvl"] == 7
    LOGADO["id"] = "paulo"; assert _current_user(None)["lvl"] == 10


def test_painel_metricas_so_do_corretor():
    for uid in CORRETORES:
        s, r = chama(uid, "metrics/overview.py", "/api/v3/metrics/overview?fresh=1")
        assert s == 200 and r["scope"] == "self", (uid, s, r.get("scope"))
        assert r["users"]["total"] == 1, (uid, r["users"])
        assert r["commissions"]["count"] == _qtd(uid), (uid, r["commissions"])
    s, r = chama("paulo", "metrics/overview.py", "/api/v3/metrics/overview?fresh=1")
    assert r["scope"] == "global" and r["users"]["total"] == len(USERS)


def test_one_on_one_so_o_proprio():
    for uid in CORRETORES:
        s, r = chama(uid, "oo/list.py", f"/api/v3/oo/list?corretor_id={uid}")
        assert s == 200 and {x["corretor_id"] for x in r["items"]} == {uid}, (uid, r)
        s, _ = chama(uid, "oo/list.py", "/api/v3/oo/list")
        assert s == 403, (uid, "lista geral do 1:1 deveria ser 403", s)
        outro = "kadu" if uid != "kadu" else "rafaela"
        s, _ = chama(uid, "oo/list.py", f"/api/v3/oo/list?corretor_id={outro}")
        assert s == 403, (uid, "1:1 de outro", s)
        s, _ = chama(uid, "oo/corretor.py", f"/api/v3/oo/corretor?id={outro}&corretor_id={outro}")
        assert s == 403, (uid, "cockpit 1:1 de outro", s)


def test_meu_perfil_so_o_proprio():
    for uid in CORRETORES:
        outro = "kadu" if uid != "kadu" else "rafaela"
        s, _ = chama(uid, "profile/data.py", f"/api/v3/profile/data?user_id={outro}")
        assert s == 403, (uid, "perfil de outro", s)
        s, r = chama(uid, "profile/data.py", f"/api/v3/profile/data?user_id={uid}")
        assert s == 200 and (r.get("user") or {}).get("id") == uid, (uid, s, r)


def test_arch_leg_bloqueado():
    for uid in CORRETORES:
        s, r = chama(uid, "gp/arch_leg.py", "/api/v3/gp/arch_leg")
        assert s == 403 and "dossies" not in r, (uid, s)
    s, r = chama("paulo", "gp/arch_leg.py", "/api/v3/gp/arch_leg")
    assert s == 200 and "user:kadu" in r["dossies"]
    s, r = chama("kaue", "gp/arch_leg.py", "/api/v3/gp/arch_leg")   # gerente: só leitura da equipe
    assert s == 200 and r.get("somente_leitura") and list(r["dossies"]) == ["user:kadu"]


def test_central_nao_sobe_nivel_de_corretor():
    s, r = chama("paulo", "settings/roles.py", "/api/v3/settings/roles", "POST",
                 {"action": "set_lvl", "role": "corretor_map", "lvl": 9})
    assert s == 400 and "travado" in r["error"], (s, r)


def test_menu_arch_leg_some_pro_corretor():
    """Roda a regra REAL do menu (v2/js/main.js) no Node: item Arch Leg some pro corretor."""
    import subprocess, shutil
    if not shutil.which("node"):
        print("   (node ausente — pulei o teste do menu)"); return
    main_js = os.path.join(RAIZ, "..", "..", "v2", "js", "main.js")
    js = r"""
const src=require('fs').readFileSync(process.argv[1],'utf8');
const cg=src.match(/export function cargosDe[\s\S]*?\n}\n/)[0].replace('export ','');
const blk=src.match(/  if \(base === .\/rh-arch-leg.\) \{[\s\S]*?\n  \}\n/)[0];
const f=new Function('base','role','user', cg+blk+'return null;');
const casos=JSON.parse(process.argv[2]);
console.log(JSON.stringify(casos.map(([r,c,l])=>f('/rh-arch-leg',r,{role:r,cargos:c,lvl:l}))));
"""
    casos = [[u["role"], u["cargos"], lv] for u in USERS if u["role"].startswith("corretor") for lv in (2, 9)]
    casos += [["gerente_conquista", [], 7], ["consultor_arch_leg", [], 5], ["socio", [], 10]]
    out = subprocess.run(["node", "-e", js, main_js, json.dumps(casos)], capture_output=True, text=True, check=True).stdout
    res = json.loads(out)
    n = len(casos) - 3
    assert res[:n] == [False] * n, ("corretor vendo Arch Leg no menu", res[:n])
    assert res[n:] == [True, True, True], res[n:]


if __name__ == "__main__":
    falhas = 0
    for nome, fn in list(globals().items()):
        if nome.startswith("test_") and callable(fn):
            try:
                fn(); print("✅", nome)
            except AssertionError as e:
                falhas += 1; print("❌", nome, "→", e)
    print("\nOK — corretor vê só o que é dele." if not falhas else f"\n{falhas} teste(s) falharam.")
    sys.exit(1 if falhas else 0)
