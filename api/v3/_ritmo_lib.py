"""
_ritmo_lib.py — 🔁 MOTOR DE CADÊNCIA: rotina vira tarefa, tarefa vencida sobe, reunião sem ata avisa. v88.97

Pedido do Paulo (28/09/2026): "toda reunião tem que sair com tarefas, prazos e responsáveis, e o
House tem que mapear a cadência, a rotina e as responsabilidades, alertando o máximo possível".

Diagnóstico que motivou (banco, 28/09):
  • rotina_conquista (30 itens Isa × Kauê) com ZERO marcações desde 23/09; rotina_imoveis nunca aberta;
  • 4 atas de reunião desde julho e nenhum combinado virou tarefa;
  • ninguém tem WhatsApp cadastrado e só o Paulo tem push — alerta só chegava no sino.

O motor (chamado pelo tasks/ritmo_cron, que o heartbeat roda de hora em hora):
  1. gerar_rotina   — cada item das rotinas ATIVAS (diretoria/rotina.py) vira 1 tarefa em dir_tasks por
                      período, com dono e prazo (fim do período). Id determinístico → idempotente.
  2. sincronizar    — check da tela de Rotina ⇄ tarefa concluída (os dois lados andam juntos);
                      tarefa DIÁRIA de rotina que passou do dia fecha como "não feita".
  3. escalonar      — véspera → dono · +N dias → gestor · +M dias → os dois sócios. Um aviso por
                      pessoa por rodada (agrupado), 1× por estágio por tarefa (kv cadencia_alertas).
                      "Vence hoje" e "atrasada" pro DONO já saem no ☀️ Meu dia — aqui não repete.
  4. reunioes       — formato de reunião (gp/reunioes_formatos) que devia ter acontecido ontem e não
                      tem ata → avisa o dono. Segunda: quem tem tarefa SEM PRAZO recebe a lista.

Configuração (shared_kv cadencia_config, editável na tela 🔁 Ritmo da Gestão): rotinas ativas por papel,
gestor de cada pessoa, dias da escada e liga/desliga dos avisos. Canais: sino + push + WhatsApp
(quem tem número em users.whatsapp e o servidor tem Evolution).
"""
import calendar
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
for _d in (os.path.join(_HERE, "diretoria"), os.path.join(_HERE, "wa")):
    if _d not in sys.path:
        sys.path.append(_d)

KV_CONFIG = "cadencia_config"
KV_ALERTAS = "cadencia_alertas"
KV_FORMATOS, KV_ATAS_KV = "reunioes_formatos", "reunioes_atas"
DONE = ("concluida", "concluída", "cancelada", "feita", "done")

# papel da rotina (diretoria/rotina.py) → quem executa no House
PAPEL_USERS = {"isa": ["isa"], "kaue": ["kbordini"], "paulo": ["paulo"], "map": ["rafaela", "yara"]}
# dono do formato de reunião (texto livre) → user id
DONO_FORMATO = {"paulo": "paulo", "isa": "isa", "isabella": "isa", "kaue": "kbordini", "kauê": "kbordini"}

DEFAULT_CONFIG = {
    # O Paulo começa primeiro (Mapa de Frentes, 28/09): a rotina dele liga já; as outras ligam
    # depois da conversa entre os sócios — um clique na tela.
    "rotinas_ativas": {"imoveis:paulo": True, "imoveis:map": False, "conquista:isa": False, "conquista:kaue": False},
    "gestores": {"kbordini": "isa", "mariane": "isa", "isa": "paulo", "paulo": "isa",
                 "rafaela": "paulo", "yara": "paulo", "joao_henrique": "paulo",
                 "_corretor_conquista": "kbordini", "_corretor_map": "paulo"},
    "socios": ["paulo", "isa"],
    "escada": {"gestor": 3, "socios": 7},
    "avisos": {"vespera": True, "gestor": True, "socios": True, "reuniao_sem_ata": True, "sem_prazo": True},
}


# ─── util ─────────────────────────────────────────────────────────────────
def hoje_brt():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


def _d(v):
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except Exception:
        return None


def _kv(sb, key, default):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
    except Exception:
        return None
    v = rows[0]["value"] if rows else None
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = None
    return v if isinstance(v, dict) else default


def _kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def config(sb):
    c = _kv(sb, KV_CONFIG, {}) or {}
    out = json.loads(json.dumps(DEFAULT_CONFIG))
    for k, v in c.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def gestor_de(cfg, uid, users_by_id):
    g = (cfg.get("gestores") or {})
    if g.get(uid):
        return g[uid]
    role = (users_by_id.get(uid) or {}).get("role") or ""
    return g.get("_" + role)


def _ultimo_util(d):
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def prazo_do_periodo(cad, d):
    """Último dia útil do período que contém d (mesma divisão de diretoria/rotina.periodo)."""
    if cad == "diario":
        return d
    seg = d - timedelta(days=d.weekday())
    if cad == "semanal":
        return seg + timedelta(days=4)
    if cad == "quinzenal":
        w = d.isocalendar()[1]
        ini = seg - timedelta(weeks=(w - 1) % 2)
        return ini + timedelta(days=11)          # sexta da 2ª semana
    if cad == "mensal":
        return _ultimo_util(date(d.year, d.month, calendar.monthrange(d.year, d.month)[1]))
    m = ((d.month - 1) // 3 + 1) * 3               # trimestral
    return _ultimo_util(date(d.year, m, calendar.monthrange(d.year, m)[1]))


def task_id_rotina(unidade, item, periodo):
    return "rt_" + unidade[:3] + "_" + item + "_" + re.sub(r"[^0-9A-Za-z]", "", periodo)


def _rotina_mod():
    import rotina as R  # type: ignore  (api/v3/diretoria/rotina.py)
    return R


# ─── 1+2. rotina → tarefas, e o sincronismo com os checks ────────────────
def gerar_rotina(sb, cfg, hoje, dry=False):
    R = _rotina_mod()
    ativas = cfg.get("rotinas_ativas") or {}
    criadas, sinc, fechadas = [], 0, 0
    for unidade, un in R.UNIDADES.items():
        papeis = [q for q in un["quens"] if ativas.get(f"{unidade}:{q}")]
        if not papeis or hoje < un["inicio"]:
            continue
        _data = _kv(sb, un["kv"], {"checks": {}}) or {}
        un = R.efetiva(un, _data)   # v89.17: a rotina editada na tela vale por cima do padrão
        checks = _data.get("checks") or {}
        dirty = False
        for t in un["tarefas"]:
            if t["quem"] not in papeis:
                continue
            if t["cad"] == "diario" and hoje.weekday() >= 5:
                continue
            p = R.periodo(t["cad"], hoje)
            tid = task_id_rotina(unidade, t["id"], p)
            quem = PAPEL_USERS.get(t["quem"]) or []
            if not quem:
                continue
            try:
                cur = sb.table("dir_tasks").select("id,status").eq("id", tid).limit(1).execute().data or []
            except Exception:
                continue
            feito_kv = (checks.get(p) or {}).get(t["id"])
            if not cur:
                if dry:
                    criadas.append(tid)
                    continue
                row = {
                    "id": tid, "titulo": t["txt"][:200],
                    "descricao": (f"🔁 Rotina · {un['titulo']} ({t['cad']})" + (f" — {t['porque']}" if t.get("porque") else "")
                                  + (f"\nOnde: {t['link']}" if t.get("link") else "")),
                    "status": "concluida" if feito_kv else "aberta", "prioridade": "media",
                    "categoria": f"Rotina · {un['titulo']}"[:80],
                    "responsavel": quem[0], "corresponsaveis": quem[1:],   # coluna NOT NULL: lista vazia, nunca None
                    "criado_por": "sistema", "criado_em": int(datetime.now(timezone.utc).timestamp() * 1000),
                    "inicio": hoje.isoformat(), "prazo": prazo_do_periodo(t["cad"], hoje).isoformat(),
                    "historico": [{"ts": datetime.now(timezone.utc).isoformat(), "actor_id": "sistema",
                                   "actor_name": "Motor do Ritmo", "action": "create", "periodo": p}],
                }
                try:
                    sb.table("dir_tasks").insert(row).execute()
                    criadas.append(tid)
                except Exception as e:
                    print(f"[cadencia] rotina {tid}: {e}")
                continue
            st = (cur[0].get("status") or "").lower()
            # tarefa concluída pelo Meu dia/Tarefas → marca o check da tela de Rotina
            if st in ("concluida", "concluída") and not feito_kv and not dry:
                checks.setdefault(p, {})[t["id"]] = {"ts": datetime.now(timezone.utc).isoformat(),
                                                     "por": "via tarefa", "nota": None}
                dirty = True
                sinc += 1
            # check marcado na tela → conclui a tarefa
            elif feito_kv and st not in DONE and not dry:
                marcar_tarefa(sb, tid, True, "via Rotina")
                sinc += 1
        if dirty:
            try:
                data = _kv(sb, un["kv"], {"checks": {}}) or {"checks": {}}
                for per, itens in checks.items():
                    data.setdefault("checks", {}).setdefault(per, {}).update(itens)
                _kv_set(sb, un["kv"], data)
            except Exception as e:
                print(f"[cadencia] sync checks {unidade}: {e}")
    # diária de rotina que passou do dia: fecha como não feita (não empilha nem escala)
    if not dry:
        try:
            velhas = (sb.table("dir_tasks").select("id,status,prazo,observacoes").like("id", "rt_%")
                      .in_("status", ["aberta", "em_andamento", "atrasada"]).lt("prazo", hoje.isoformat())
                      .limit(500).execute().data or [])
            for v in velhas:
                if "_D" in v["id"]:
                    sb.table("dir_tasks").update({"status": "cancelada", "observacoes": "❌ não feita no dia (rotina)",
                                                  "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", v["id"]).execute()
                    fechadas += 1
        except Exception as e:
            print(f"[cadencia] fechar diárias: {e}")
    return {"criadas": len(criadas), "sincronizadas": sinc, "diarias_fechadas": fechadas, "ids": criadas[:50]}


def marcar_tarefa(sb, tid, feito, por):
    try:
        cur = sb.table("dir_tasks").select("status,historico").eq("id", tid).limit(1).execute().data or []
        if not cur:
            return False
        hist = cur[0].get("historico") or []
        novo = "concluida" if feito else "aberta"
        hist.append({"ts": datetime.now(timezone.utc).isoformat(), "actor_id": "sistema", "actor_name": por,
                     "action": "status", "from": cur[0].get("status"), "to": novo})
        sb.table("dir_tasks").update({"status": novo, "historico": hist[-60:],
                                      "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", tid).execute()
        return True
    except Exception as e:
        print(f"[cadencia] marcar {tid}: {e}")
        return False


# ─── 3. escada de atraso ──────────────────────────────────────────────────
def escalonar(sb, cfg, hoje, users_by_id, estado):
    """Devolve {destinatario: [linhas]} e atualiza `estado` {task_id: [estagios já avisados]}."""
    av = cfg.get("avisos") or {}
    esc = cfg.get("escada") or {}
    g_dias, s_dias = int(esc.get("gestor") or 3), int(esc.get("socios") or 7)
    socios = [s for s in (cfg.get("socios") or []) if s in users_by_id]
    try:
        tarefas = (sb.table("dir_tasks").select("id,titulo,status,prazo,responsavel")
                   .not_.in_("status", list(DONE)).not_.is_("prazo", "null").limit(3000).execute().data or [])
    except Exception as e:
        print(f"[cadencia] ler tarefas: {e}")
        return {}
    msgs = {}
    abertas = set()

    def add(uid, linha):
        if uid and uid in users_by_id:
            msgs.setdefault(uid, []).append(linha)

    for t in tarefas:
        pz, dono = _d(t.get("prazo")), t.get("responsavel")
        if not pz or not dono or "_D" in (t["id"] if t["id"].startswith("rt_") else ""):
            continue
        abertas.add(t["id"])
        dias = (hoje - pz).days
        feitos = estado.setdefault(t["id"], [])
        nome = (users_by_id.get(dono) or {}).get("name") or dono
        tit = (t.get("titulo") or "")[:90]
        if dias == -1 and av.get("vespera") and "vespera" not in feitos:
            add(dono, f"⏰ vence amanhã: {tit}")
            feitos.append("vespera")
        # quem já recebe o degrau mais alto nesta rodada não recebe o mais baixo da mesma tarefa
        vai_socios = dias >= s_dias and av.get("socios") and "socios" not in feitos
        if dias >= g_dias and av.get("gestor") and "gestor" not in feitos:
            g = gestor_de(cfg, dono, users_by_id)
            if g and g != dono and not (vai_socios and g in socios):
                add(g, f"🟠 {nome} · {dias} dias atrasada: {tit}")
            feitos.append("gestor")
        if vai_socios:
            for s in socios:
                if s != dono:
                    add(s, f"🔴 {nome} · {dias} dias atrasada (vai pra pauta de segunda): {tit}")
            feitos.append("socios")
    for k in [k for k in estado if k not in abertas]:
        estado.pop(k, None)   # tarefa fechou (ou perdeu prazo): some do estado
    return msgs


# ─── feriados (v89.22): reunião que cai em feriado vai pro PRÓXIMO dia útil ───
def _pascoa(y):
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    return date(y, mes, (h + l - 7 * m + 114) % 31 + 1)


_FER = {}


def feriados(y):
    """Nacionais + SP (09/07) + São José do Rio Preto (19/03) + Carnaval, Sexta Santa e Corpus Christi."""
    if y not in _FER:
        p = _pascoa(y)
        fixos = [(1, 1), (3, 19), (4, 21), (5, 1), (7, 9), (9, 7), (10, 12), (11, 2), (11, 15), (11, 20), (12, 25)]
        _FER[y] = {date(y, m, d) for m, d in fixos} | {p - timedelta(days=48), p - timedelta(days=47),
                                                        p - timedelta(days=2), p + timedelta(days=60)}
    return _FER[y]


def dia_util(d):
    return d.weekday() < 5 and d not in feriados(d.year)


def bate(f, d):
    """A reunião acontece no dia d? Já com a regra do feriado: caiu em feriado → próximo dia útil.
    v89.25: excecoes[AAAA-MM-DD].cancelada → não acontece naquele dia."""
    if not dia_util(d):
        return False
    if ((f.get("excecoes") or {}).get(d.isoformat()) or {}).get("cancelada"):
        return False
    if _bate(f, d):
        return True
    x = d - timedelta(days=1)
    while not dia_util(x):
        if x.weekday() < 5 and _bate(f, x):   # feriado em dia de semana logo antes de d
            return True
        x -= timedelta(days=1)
    return False


# ─── 4. reuniões sem ata + tarefas sem prazo ──────────────────────────────
def _bate(f, d):
    c = f.get("cadencia") or {}
    wd, t = d.weekday(), c.get("tipo")
    if t == "semanal":   # v89.21: pular_1a = não acontece na 1ª semana do mês
        return wd in (c.get("dias") or []) and not (c.get("pular_1a") and d.day <= 7)
    if t == "quinzenal":
        try:
            return wd == c.get("dia") and ((d - date.fromisoformat(c.get("ref"))).days // 7) % 2 == 0
        except Exception:
            return False
    if t == "mensal_nth":
        return wd == c.get("dia") and (d.day - 1) // 7 + 1 == int(c.get("nth") or 1)
    if t == "mensal_ultima":
        return wd == c.get("dia") and d.day > calendar.monthrange(d.year, d.month)[1] - 7
    if t == "mensal_dias":   # v89.20: dia 10/20/último (fim de semana → sexta anterior)
        ult = calendar.monthrange(d.year, d.month)[1]
        for n in c.get("dias_mes") or []:
            try:
                x = date(d.year, d.month, min(int(n), ult))
            except Exception:
                continue
            while x.weekday() >= 5:
                x -= timedelta(days=1)
            if x == d:
                return True
    return False   # sob_demanda não entra na conta de ata


def formatos(sb):
    fk = _kv(sb, KV_FORMATOS, None)
    if fk and fk.get("formatos"):
        return fk["formatos"]
    try:
        sys.path.append(os.path.join(_HERE, "gp"))
        import reunioes_formatos as RF  # type: ignore
        return RF.SEED_FORMATOS
    except Exception:
        return []


def dono_formato(f):
    return DONO_FORMATO.get(str(f.get("dono") or "").strip().lower())


def atas_por_formato_dia(sb, desde):
    """{(formato_id, 'AAAA-MM-DD')} de toda ata registrada (kv da rotina v2.3 + tabela reunioes_atas)."""
    out = set()
    ak = _kv(sb, KV_ATAS_KV, {"atas": []}) or {}
    for a in ak.get("atas") or []:
        dia = str(a.get("data") or (_brt_date(a.get("ts")) or ""))[:10]
        if a.get("formato_id") and dia >= desde.isoformat():
            out.add((a["formato_id"], dia))
    try:
        rows = (sb.table("reunioes_atas").select("formato_id,data").gte("data", desde.isoformat())
                .limit(2000).execute().data or [])
        for r in rows:
            if r.get("formato_id"):
                out.add((r["formato_id"], str(r.get("data"))[:10]))
    except Exception:
        pass
    return out


def _brt_date(ts):
    try:
        return (datetime.fromisoformat(str(ts).replace("Z", "+00:00")) - timedelta(hours=3)).date().isoformat()
    except Exception:
        return None


def _vale(f, d):
    desde = _d(f.get("desde"))
    return not (desde and d < desde) and bate(f, d)


def bate_na_agenda(f, d, todos):
    """bate() + v89.29 "cede_para": [ids] — se alguma dessas reuniões acontece no mesmo dia, esta sai
    daquele dia (ex.: Conteúdo MAP cede pro Financeiro; Treinamento MAP cede pro Treinamento geral)."""
    if not bate(f, d):
        return False
    ced = set(f.get("cede_para") or [])
    return not (ced and any(g.get("id") in ced and _vale(g, d) for g in (todos or [])))


def reunioes_previstas(fs, ini, fim, todos=None):
    """[(formato, dia)] que deviam ter acontecido entre ini e fim (inclusive), respeitando 'desde'
    e o "cede_para" (procurado em `todos`, ou em `fs` se não vier)."""
    todos = todos if todos is not None else fs
    out, d = [], ini
    while d <= fim:
        for f in fs:
            desde = _d(f.get("desde"))
            if desde and d < desde:
                continue
            if bate_na_agenda(f, d, todos):
                out.append((f, d))
        d += timedelta(days=1)
    return out


# ─── 5. agenda → calendário (v89.23) ─────────────────────────────────────
# Reunião da Agenda com "calendario": true vira compromisso de verdade em `eventos`
# (id rito_<formato>_<AAAAMMDD>, origem 'rito'), ~5 semanas à frente e já com a regra do
# feriado. O dono do calendário é o organizador (Paulo, se estiver na reunião): o sync do
# Zoho manda cada ocorrência pro Zoho DELE com os demais como convidados (attendees) —
# assim chega a quem não conectou o Zoho. Data que sumiu (feriado, agenda editada, reunião
# removida) é apagada no House e no Zoho.
RITO_DIAS = 35


def _ids_participantes(f, ativos):
    ids = []
    for m in (f.get("participantes") or []):
        m = str(m or "").strip().lower()
        if not m:
            continue
        exato = [u for u in ativos if u["id"] == m]   # id exato ganha do nome ("paulo" ≠ "João Paulo")
        for u in (exato or [u for u in ativos if m in (u.get("name") or "").lower()]):
            if u["id"] not in ids:
                ids.append(u["id"])
    for p in (f.get("papeis") or []):
        for u in ativos:
            if (p == "*" or (u.get("role") or "") == p) and u["id"] not in ids:
                ids.append(u["id"])
    return ids


def _hora_fim(hora, dur):
    hh, mm = (int(x) for x in str(hora).split(":")[:2])
    t = hh * 60 + mm + int(dur or 60)
    return f"{min(t // 60, 23):02d}:{t % 60:02d}"


def hora_do_dia(f, iso):
    """v89.24: exceção pontual de horário — formato.excecoes = {"AAAA-MM-DD": {"hora": "14:00"}}."""
    return ((f.get("excecoes") or {}).get(iso) or {}).get("hora") or f.get("hora")


def materializar_ritos(sb, hoje, dry=False):
    out = {"criados": 0, "atualizados": 0, "apagados": 0, "erros": 0}
    todos = formatos(sb)
    fs = [f for f in todos if f.get("calendario") and f.get("hora")
          and (f.get("cadencia") or {}).get("tipo") not in (None, "sob_demanda")]
    try:
        us = sb.table("users").select("id,name,role,status,is_service").execute().data or []
    except Exception:
        us = sb.table("users").select("id,name,role,status").execute().data or []
    ativos = [u for u in us if (u.get("status") or "ativo") == "ativo" and not u.get("is_service")]
    fim = hoje + timedelta(days=RITO_DIAS)
    desejados = {}
    for f in fs:
        part = _ids_participantes(f, ativos)
        if not part:
            continue
        dono = "paulo" if "paulo" in part else (dono_formato(f) if dono_formato(f) in part else part[0])
        pauta = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(f.get("pauta") or []))
        for fd, d in reunioes_previstas([f], hoje, fim, todos):
            eid = f"rito_{f['id']}_{d.strftime('%Y%m%d')}"
            desejados[eid] = {
                "id": eid, "tipo": "reuniao", "titulo": f"{f.get('emoji') or '📋'} {f.get('nome')}"[:200],
                "descricao": (f"Reunião fixa da Agenda (Ritos & Reuniões) · conduz: {f.get('dono') or '—'}\n"
                              f"Pauta:\n{pauta}" + (f"\nPainel: {f.get('painel_nome')}" if f.get("painel_nome") else "")
                              + "\nDepois da reunião: registrar a ata no House (Ritos & Reuniões → Agenda)."),
                "data": d.isoformat(), "hora_inicio": hora_do_dia(f, d.isoformat()),
                "hora_fim": _hora_fim(hora_do_dia(f, d.isoformat()), f.get("dur_min")),
                "all_day": False, "participantes": part, "owner_id": dono, "criado_por": dono,
                "origem": "rito", "status": "agendado", "local": f.get("local") or None,
            }
    try:
        atuais = (sb.table("eventos").select("id,data,hora_inicio,hora_fim,titulo,descricao,participantes,owner_id,zoho_uid,zoho_etag")
                  .like("id", "rito_%").gte("data", hoje.isoformat()).limit(1000).execute().data or [])
    except Exception as e:
        return {"erro": str(e)[:120]}
    atuais = {a["id"]: a for a in atuais}
    if dry:
        return {"dry": True, "criar": sorted(set(desejados) - set(atuais)), "apagar": sorted(set(atuais) - set(desejados))}
    for eid, ev in desejados.items():
        cur = atuais.get(eid)
        try:
            if not cur:
                sb.table("eventos").insert({**ev, "aceites": {}}).execute()
                out["criados"] += 1
            else:
                mud = {k: ev[k] for k in ("titulo", "descricao", "hora_inicio", "hora_fim", "participantes", "owner_id")
                       if str(cur.get(k) or "")[:5 if k.startswith("hora") else None] != str(ev[k] or "")[:5 if k.startswith("hora") else None]}
                if mud:   # o sync do Zoho percebe pelo hash e atualiza lá
                    sb.table("eventos").update(mud).eq("id", eid).execute()
                    out["atualizados"] += 1
        except Exception as e:
            out["erros"] += 1
            print(f"[ritos] {eid}: {e}")
    for eid, cur in atuais.items():
        if eid in desejados:
            continue
        try:
            if cur.get("zoho_uid"):
                _ag = os.path.join(_HERE, "agenda")
                if _ag not in sys.path:
                    sys.path.append(_ag)
                import _zoho_push as ZP  # type: ignore
                if not ZP.delete_evento(sb, cur, cur.get("owner_id")):
                    out["erros"] += 1   # não apaga no House sem apagar no Zoho: tenta de novo na próxima rodada
                    continue
            sb.table("eventos").delete().eq("id", eid).execute()
            out["apagados"] += 1
        except Exception as e:
            out["erros"] += 1
            print(f"[ritos] apagar {eid}: {e}")
    return out


def reunioes_sem_ata(sb, cfg, hoje, estado_reun):
    if not (cfg.get("avisos") or {}).get("reuniao_sem_ata"):
        return {}
    ontem = hoje - timedelta(days=1)
    if ontem.weekday() >= 5:
        return {}
    feitas = atas_por_formato_dia(sb, ontem)
    msgs = {}
    # v89.27: bloco de trabalho com "sem_ata" (ex.: testes de campanha) lembra e vai pro calendário, mas não cobra ata
    _todos = formatos(sb)
    for f, d in reunioes_previstas([f for f in _todos if not f.get("sem_ata")], ontem, ontem, _todos):
        chave = f"{f.get('id')}|{d.isoformat()}"
        if (f.get("id"), d.isoformat()) in feitas or chave in estado_reun:
            continue
        dono = dono_formato(f)
        if dono:
            msgs.setdefault(dono, []).append(
                f"📋 {f.get('emoji', '')} {f.get('nome')} de ontem sem ata — registre o que foi combinado (dono + prazo) ou avise que não aconteceu")
        estado_reun[chave] = hoje.isoformat()
    return msgs


def sem_prazo(sb, cfg, hoje, users_by_id):
    if not (cfg.get("avisos") or {}).get("sem_prazo") or hoje.weekday() != 0:
        return {}
    try:
        rows = (sb.table("dir_tasks").select("id,titulo,responsavel").is_("prazo", "null")
                .not_.in_("status", list(DONE)).limit(2000).execute().data or [])
    except Exception:
        return {}
    por = {}
    for r in rows:
        if r.get("responsavel") in users_by_id:
            por.setdefault(r["responsavel"], []).append(r.get("titulo") or "")
    return {u: [f"📌 {len(ts)} tarefa(s) sem prazo — tarefa sem data não é cobrada. Ex.: " + "; ".join(t[:50] for t in ts[:3])]
            for u, ts in por.items()}


# ─── entrega ──────────────────────────────────────────────────────────────
def _wa_ok():
    return bool(os.environ.get("EVOLUTION_API_URL") and os.environ.get("EVOLUTION_API_KEY") and os.environ.get("EVOLUTION_INSTANCE"))


def entregar(msgs, users_by_id, notify_all):
    enviados = []
    try:
        from _wa_lib import evolution_send, normalize_phone  # type: ignore
    except Exception:
        evolution_send = normalize_phone = None
    for uid, linhas in msgs.items():
        if not linhas:
            continue
        titulo = f"🔁 Ritmo da Gestão: {len(linhas)} ponto(s) de atenção"
        corpo = "\n".join(linhas[:15]) + (f"\n… e mais {len(linhas) - 15}" if len(linhas) > 15 else "")
        canais = []
        try:
            notify_all([uid], "cadencia", titulo, corpo, link="#/reunioes?tab=ritmo", target_type="cadencia", target_id=hoje_brt().isoformat())
            canais.append("sino+push")
        except Exception as e:
            print(f"[cadencia] notify {uid}: {e}")
        u = users_by_id.get(uid) or {}
        if u.get("whatsapp") and evolution_send and _wa_ok():
            num = normalize_phone(u["whatsapp"])
            if num:
                r = evolution_send(num, f"*{titulo}*\n\n{corpo}\n\nAbra o House → 🔁 Ritmo da Gestão")
                canais.append("whatsapp" if r.get("ok") else "whatsapp_falhou")
        enviados.append({"para": uid, "itens": len(linhas), "canais": canais})
    return enviados


def rodar(sb, notify_all, dry=False, hoje=None):
    hoje = hoje or hoje_brt()
    cfg = config(sb)
    try:
        users = sb.table("users").select("id,name,role,status,whatsapp").execute().data or []
    except Exception:
        users = sb.table("users").select("id,name,role,status").execute().data or []
    users_by_id = {u["id"]: u for u in users if (u.get("status") or "ativo") == "ativo"}
    estado = _kv(sb, KV_ALERTAS, {}) if not dry else json.loads(json.dumps(_kv(sb, KV_ALERTAS, {}) or {}))
    if estado is None:
        return {"ok": False, "skip": "kv indisponível"}
    estado.setdefault("tarefas", {})
    estado.setdefault("reunioes", {})
    rot = gerar_rotina(sb, cfg, hoje, dry=dry)
    try:
        ritos = materializar_ritos(sb, hoje, dry=dry)   # v89.23: agenda → calendário (House + Zoho)
    except Exception as e:
        ritos = {"erro": str(e)[:120]}
    msgs = {}
    for fonte in (escalonar(sb, cfg, hoje, users_by_id, estado["tarefas"]),
                  reunioes_sem_ata(sb, cfg, hoje, estado["reunioes"]),
                  sem_prazo(sb, cfg, hoje, users_by_id) if estado.get("sem_prazo_dia") != hoje.isoformat() else {}):
        for uid, ls in fonte.items():
            msgs.setdefault(uid, []).extend(ls)
    # guarda só 60 dias de reuniões avisadas
    corte = (hoje - timedelta(days=60)).isoformat()
    estado["reunioes"] = {k: v for k, v in estado["reunioes"].items() if v >= corte}
    if dry:
        return {"ok": True, "dry": True, "rotina": rot, "ritos": ritos, "mensagens": msgs}
    estado["sem_prazo_dia"] = hoje.isoformat() if hoje.weekday() == 0 else estado.get("sem_prazo_dia")
    enviados = entregar(msgs, users_by_id, notify_all)
    try:
        _kv_set(sb, KV_ALERTAS, estado)
    except Exception as e:
        print(f"[cadencia] salvar estado: {e}")
    return {"ok": True, "rotina": rot, "ritos": ritos, "enviados": enviados}
