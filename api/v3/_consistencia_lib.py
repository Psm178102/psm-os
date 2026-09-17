"""
_consistencia_lib.py — TESTE NOTURNO DOS NÚMEROS ENTRE TELAS. v88.0

Pedido do Paulo (17/09/2026, item 6 da unificação de métricas): depois de pôr todas as telas no motor único,
um teste que roda sozinho toda noite, recalcula o MESMO número pelo caminho de cada tela e avisa o sócio se
alguma divergir — pra incongruência nunca mais ser descoberta pelo time no meio de uma reunião.

Cada verificação devolve {id, tela, metrica, escopo, esperado, obtido, ok, msg}. "esperado" é sempre o motor
único (_metricas_lib.resumo, Dicionário de Métricas); "obtido" é o número que a tela calcula ou exibe.
Tolerância: contagem exata; valor em R$ até R$ 1 (arredondamento).

Entradas: comparar(sb, hoje) → {"ok", "falhas", "checks", "janela", "ts"}. O endpoint é
/api/v3/system/consistency (?cron=1 roda, grava shared_kv consistencia_telas:<data> e avisa os sócios).
"""
from datetime import datetime, timedelta, timezone

import _metricas_lib as MX

KV_PREFIXO = "consistencia_telas:"
TOL_VALOR = 1.0
SYNC_MAX_H = 2.0          # em horário comercial (seg–sáb 9h–20h) o RD não pode ficar mais que isso sem sync
TEAM_NOME = {"conquista": "Conquista", "map": "MAP", "terceiros": "Terceiros", "locacao": "Locação", "_empresa": "Empresa"}


def _brl(v):
    return "R$ " + f"{float(v or 0):,.0f}".replace(",", ".")


class Checagem:
    def __init__(self):
        self.itens = []

    def comparar(self, cid, tela, metrica, escopo, esperado, obtido, valor=False):
        if esperado is None or obtido is None:
            return
        tol = TOL_VALOR if valor else 0
        ok = abs(float(esperado) - float(obtido)) <= tol
        fmt = _brl if valor else (lambda x: f"{float(x):g}".replace(".", ","))
        nome = TEAM_NOME.get(escopo, escopo)
        msg = (f"{tela} · {metrica} · {nome}: {fmt(obtido)} = motor" if ok else
               f"{tela} mostra {metrica} {fmt(obtido)} para {nome}, o motor único dá {fmt(esperado)}")
        self.itens.append({"id": f"{cid}:{escopo}", "tela": tela, "metrica": metrica, "escopo": escopo,
                           "esperado": round(float(esperado), 2), "obtido": round(float(obtido), 2), "ok": ok, "msg": msg})

    def falhou(self, cid, tela, msg):
        """A verificação não conseguiu rodar — conta como falha (silêncio não é sucesso)."""
        self.itens.append({"id": cid, "tela": tela, "metrica": "execução", "escopo": "-", "esperado": None,
                           "obtido": None, "ok": False, "msg": f"{tela}: não consegui recalcular ({str(msg)[:140]})"})

    def aviso(self, cid, tela, ok, msg):
        self.itens.append({"id": cid, "tela": tela, "metrica": "frescor", "escopo": "-", "esperado": None,
                           "obtido": None, "ok": bool(ok), "msg": msg})


# ─── verificações ────────────────────────────────────────────────────────────
def _projecao(ck, sb, mx):
    """🎯 Meta · Realizado · Projeção (Gestão Comercial, 1:1, Cérebro, Meu dia): realizado do mês = motor."""
    import _projecao_lib as PJ
    pj = PJ.projecao(sb, {"h": "mes"}, fresh=True)
    alvo = [("_empresa", mx.get("empresa"), pj.get("empresa"))]
    alvo += [(tk, e, (pj.get("equipes") or {}).get(tk)) for tk, e in (mx.get("equipes") or {}).items()]
    for esc, b, p in alvo:
        if not (b and p):
            continue
        # a empresa do motor soma também vendas sem corretor e de quem saiu; a projeção só soma pessoas ativas
        fora = ("sem_corretor", "inativos") if esc == "_empresa" else ()
        vendas_b = b["vendas"] - sum(((b.get(f) or {}).get("vendas") or 0) for f in fora)
        vgv_b = b["vgv"] - sum(((b.get(f) or {}).get("vgv") or 0) for f in fora)
        ck.comparar("projecao_vendas", "Projeção oficial", "vendas do mês", esc, vendas_b, p["realizado"]["vendas"])
        ck.comparar("projecao_vgv", "Projeção oficial", "VGV do mês", esc, vgv_b, p["realizado"]["vgv"], valor=True)


def _frescor(ck, sb, hoje):
    agora = MX.agora_brt()
    ts = MX.to_brt(MX.versao_deals(sb))
    comercial = agora.weekday() < 6 and 9 <= agora.hour < 20
    if not ts:
        ck.aviso("sync_rd", "Sync do RD", False, "Não consegui ler o último sync do RD (deals.synced_at).")
        return
    idade_h = (agora - ts).total_seconds() / 3600
    ok = (not comercial) or idade_h <= SYNC_MAX_H
    ck.aviso("sync_rd", "Sync do RD", ok,
             f"Dados do RD de {ts.strftime('%d/%m %H:%M')} ({idade_h:.1f} h)" if ok else
             f"Sync do RD parado há {idade_h:.1f} h (dados de {ts.strftime('%d/%m %H:%M')}) — todas as telas estão com número velho.")


VERIFICACOES = (
    ("projecao", _projecao),
)


def comparar(sb, hoje=None):
    hoje = hoje or MX.hoje_brt()
    since, until = hoje.replace(day=1), hoje
    ck = Checagem()
    try:
        mx = MX.resumo(sb, {"since": since.isoformat(), "until": until.isoformat()}, fresh=True, hoje=hoje)
    except Exception as e:
        ck.falhou("motor", "Motor único", e)
        return _fechar(ck, since, until)
    for nome, fn in VERIFICACOES:
        try:
            fn(ck, sb, mx)
        except Exception as e:
            ck.falhou(nome, nome, e)
    try:
        _frescor(ck, sb, hoje)
    except Exception as e:
        ck.falhou("sync_rd", "Sync do RD", e)
    return _fechar(ck, since, until)


def _fechar(ck, since, until):
    falhas = [c for c in ck.itens if not c["ok"]]
    return {"ok": not falhas, "falhas": len(falhas), "checks": ck.itens,
            "janela": {"since": since.isoformat(), "until": until.isoformat()},
            "ts": datetime.now(timezone.utc).isoformat()}


def resumo_aviso(res, limite=6):
    """Texto curto pro sino/celular do sócio."""
    falhas = [c for c in res.get("checks") or [] if not c["ok"]]
    if not falhas:
        return None, None
    telas = sorted({c["tela"] for c in falhas})
    titulo = f"🔎 {len(falhas)} número(s) divergente(s) entre telas: " + ", ".join(telas[:4]) + ("…" if len(telas) > 4 else "")
    corpo = " · ".join(c["msg"] for c in falhas[:limite])
    return titulo[:140], corpo[:600]
