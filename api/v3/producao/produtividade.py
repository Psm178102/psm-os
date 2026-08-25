"""
GET /api/v3/producao/produtividade[?janela=90][&me=1] — Peça 6 da Produtividade Real (v86.78).

Consolida, POR CORRETOR, as 3 camadas:
  1. ESFORÇO (janela curta): toques/visitas de producao_eventos (registro no ato).
  2. RENDIMENTO (janela móvel): conversão lead→venda vs a MÉDIA DA EQUIPE (mesmo funil),
     no-show, pasta (aprovada/reprovada/etc), SLA de 1º contato (mediana).
  3. RESULTADO: vendas/VGV na janela + acurácia do forecast declarado.
+ QUADRANTE atividade × rendimento (maquina | talento_ocioso | esforco_sem_tecnica | escada).

Permissão: lvl>=5 vê tudo (gerente já chega filtrado pela equipe nas telas que consomem);
corretor (lvl>=2) SÓ com ?me=1 — devolve apenas o próprio bloco, sem comparativo nominal.
REGRA DURA (spec): rendimento individual nunca vai pra modo TV / ranking público.
Cache: shared_kv prod_real_cache (10 min).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone, timedelta
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from _prod_lib import first_touch_map, email_local, METAS_CORRETOR  # type: ignore

KV_CACHE = "prod_real_cache"
CACHE_MIN = 10
PASTA_BOAS = ("aprovada", "aprovado")
PASTA_RUINS = ("reprovada", "reprovado")


def _fetch_all(q_builder, cap=20):
    out, page, size = [], 0, 1000
    while page < cap:
        try:
            rows = q_builder().range(page * size, page * size + size - 1).execute().data or []
        except Exception:
            break
        out.extend(rows)
        if len(rows) < size:
            break
        page += 1
    return out


def _compute(sb, janela):
    now = datetime.now(timezone.utc)
    desde = (now - timedelta(days=janela)).isoformat()
    desde7 = (now - timedelta(days=7)).isoformat()

    # deals da janela (safra: lead NASCIDO na janela) — base do rendimento
    deals = _fetch_all(lambda: sb.table("deals")
                       .select("id,user_email,pipeline_name,win,amount,created_at_rd")
                       .gte("created_at_rd", desde).order("created_at_rd", desc=True))
    # vendas fechadas na janela (independente da safra) — camada resultado
    wins = _fetch_all(lambda: sb.table("deals")
                      .select("id,user_email,amount,closed_at")
                      .eq("win", True).gte("closed_at", desde))
    # eventos de produção da janela
    evs = _fetch_all(lambda: sb.table("producao_eventos")
                     .select("colaborador,tipo,ts,ref_id,meta")
                     .gte("ts", desde).order("ts", desc=True))

    por = {}   # email_local -> agregado
    def slot(k):
        if k not in por:
            por[k] = {"corretor": k, "leads": 0, "vendas_safra": 0, "vendas": 0, "vgv": 0.0,
                      "funis": {}, "toques_7d": 0, "toques_por_bloco": {}, "visitas_7d": 0,
                      "visita_realizada": 0, "no_show": 0, "no_show_motivos": {},
                      "pasta": {}, "perdas": {}, "sla_min": [], "deal_ids": []}
        return por[k]

    for d in deals:
        k = email_local(d.get("user_email"))
        if not k:
            continue
        s = slot(k)
        s["leads"] += 1
        s["deal_ids"].append(str(d["id"]))
        pipe = d.get("pipeline_name") or "?"
        s["funis"][pipe] = s["funis"].get(pipe, 0) + 1
        if d.get("win") is True:
            s["vendas_safra"] += 1

    for w in wins:
        k = email_local(w.get("user_email"))
        if not k:
            continue
        s = slot(k)
        s["vendas"] += 1
        try:
            s["vgv"] += float(w.get("amount") or 0)
        except Exception:
            pass

    for e in evs:
        k = str(e.get("colaborador") or "").lower()
        if not k or k not in por and e.get("tipo") not in ("toque_ligacao", "toque_whatsapp",
                                                           "visita_realizada", "no_show", "pasta_status",
                                                           "perda_motivo", "visita_marcada"):
            continue
        s = slot(k)
        t = e.get("tipo")
        m = e.get("meta") or {}
        if isinstance(m, str):
            try:
                m = json.loads(m)
            except Exception:
                m = {}
        recente = str(e.get("ts") or "") >= desde7
        if t in ("toque_ligacao", "toque_whatsapp"):
            if recente:
                s["toques_7d"] += 1
                b = (m or {}).get("bloco") or "outro"
                s["toques_por_bloco"][b] = s["toques_por_bloco"].get(b, 0) + 1
        elif t == "visita_realizada":
            s["visita_realizada"] += 1
            if recente:
                s["visitas_7d"] += 1
        elif t == "no_show":
            s["no_show"] += 1
            mot = (m or {}).get("motivo") or (m or {}).get("valor") or "sem_motivo"
            s["no_show_motivos"][mot] = s["no_show_motivos"].get(mot, 0) + 1
        elif t == "pasta_status":
            v = str((m or {}).get("valor") or "").lower()
            if v:
                s["pasta"][v] = s["pasta"].get(v, 0) + 1
        elif t == "perda_motivo":
            v = str((m or {}).get("valor") or "sem_motivo").lower()
            s["perdas"][v] = s["perdas"].get(v, 0) + 1

    # SLA (mediana de minutos até o 1º contato) — só leads com telefone de trabalho útil
    all_ids = [i for s in por.values() for i in s["deal_ids"][:200]]
    touched = first_touch_map(sb, all_ids[:1500])
    created = {str(d["id"]): d.get("created_at_rd") for d in deals}
    for s in por.values():
        for did in s["deal_ids"][:200]:
            ft, cr = touched.get(did), created.get(did)
            if not ft or not cr:
                continue
            try:
                dt = (datetime.fromisoformat(str(ft).replace("Z", "+00:00"))
                      - datetime.fromisoformat(str(cr).replace("Z", "+00:00"))).total_seconds() / 60
                if 0 <= dt <= 60 * 24 * 7:
                    s["sla_min"].append(round(dt, 1))
            except Exception:
                pass

    # forecast (acurácia dos 3 últimos meses fechados)
    fc = {}
    try:
        rows = sb.table("shared_kv").select("key,value").like("key", "forecast:%").execute().data or []
        for r in rows:
            fc[r["key"]] = r["value"] if not isinstance(r["value"], str) else json.loads(r["value"])
    except Exception:
        pass

    # médias de equipe (mesmo funil dominante) p/ normalizar o rendimento
    conv_por_funil = {}
    for s in por.values():
        if s["leads"] >= 5:
            funil = max(s["funis"], key=s["funis"].get) if s["funis"] else "?"
            conv_por_funil.setdefault(funil, []).append(s["vendas_safra"] / s["leads"])
    mediana_funil = {f: median(v) for f, v in conv_por_funil.items() if v}

    out = []
    for k, s in sorted(por.items()):
        if s["leads"] == 0 and s["toques_7d"] == 0 and s["vendas"] == 0:
            continue
        funil = max(s["funis"], key=s["funis"].get) if s["funis"] else "?"
        conv = (s["vendas_safra"] / s["leads"]) if s["leads"] else None
        base = mediana_funil.get(funil)
        # camadas → quadrante (amostra mínima: 30 leads pra julgar rendimento — spec)
        meta_toques = METAS_CORRETOR["toques_dia"] * 5
        atividade_pct = round(100 * s["toques_7d"] / meta_toques) if meta_toques else None
        rend = None
        if conv is not None and base and s["leads"] >= 30:
            rend = "alto" if conv >= base else "baixo"
        ativ = None if atividade_pct is None else ("alta" if atividade_pct >= 70 else "baixa")
        quadrante = None
        if ativ and rend:
            quadrante = {("alta", "alto"): "maquina", ("baixa", "alto"): "talento_ocioso",
                         ("alta", "baixo"): "esforco_sem_tecnica", ("baixa", "baixo"): "escada"}[(ativ, rend)]
        vis_total = s["visita_realizada"] + s["no_show"]
        # forecast do mês corrente (declarado no Meu Painel) — acurácia fecha no Fecho do Mês
        fkey = next((mk for mk in fc if mk.endswith(":" + now.strftime("%Y-%m"))
                     and email_local(mk.split(":")[1] if mk.count(":") == 2 else "") == k), None)
        f_atual = None
        if fkey and isinstance(fc[fkey], dict) and (fc[fkey].get("versoes") or []):
            f_atual = (fc[fkey]["versoes"] or [])[-1]
        out.append({
            "corretor": k, "funil": funil, "leads_janela": s["leads"],
            "vendas_janela": s["vendas"], "vgv_janela": round(s["vgv"]),
            "conv_pct": round(conv * 100, 2) if conv is not None else None,
            "conv_equipe_pct": round(base * 100, 2) if base else None,
            "amostra_ok": s["leads"] >= 30,
            "toques_7d": s["toques_7d"], "toques_por_bloco": s["toques_por_bloco"],
            "atividade_pct": atividade_pct, "visitas_7d": s["visitas_7d"],
            "no_show_pct": round(100 * s["no_show"] / vis_total) if vis_total else None,
            "no_show_motivos": s["no_show_motivos"],
            "pasta": s["pasta"],
            "pasta_aprovacao_pct": _pct(s["pasta"], PASTA_BOAS),
            "pasta_reprovacao_pct": _pct(s["pasta"], PASTA_RUINS),
            "perdas_motivos": s["perdas"],
            "sla_mediana_min": round(median(s["sla_min"]), 1) if s["sla_min"] else None,
            "sla_amostra": len(s["sla_min"]),
            "forecast_mes": f_atual,
            "quadrante": quadrante,
        })
    return {"janela_dias": janela, "gerado_em": now.isoformat(),
            "metas": METAS_CORRETOR, "corretores": out,
            "nota": "Rendimento sempre vs mediana do MESMO funil; amostra mínima 30 leads. "
                    "NUNCA expor rendimento individual em TV/ranking público (spec)."}


def _pct(d, keys):
    tot = sum(d.values())
    if not tot:
        return None
    n = sum(v for k, v in d.items() if any(x in k for x in keys))
    return round(100 * n / tot)


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        me = q.get("me") == "1"
        lvl = user.get("lvl") or 0
        if lvl < 5 and not me:
            return self._send(403, {"ok": False, "error": "corretor vê só a própria produtividade (?me=1)"})
        try:
            janela = max(7, min(365, int(q.get("janela") or 90)))
        except Exception:
            janela = 90
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # cache 10 min (computo é pesado; permissão filtra DEPOIS do cache — padrão gc)
        ck = f"{KV_CACHE}:{janela}"
        data = None
        try:
            rows = sb.table("shared_kv").select("value,updated_at").eq("key", ck).limit(1).execute().data or []
            if rows:
                age = (datetime.now(timezone.utc)
                       - datetime.fromisoformat(str(rows[0]["updated_at"]).replace("Z", "+00:00"))).total_seconds()
                if age < CACHE_MIN * 60:
                    data = rows[0]["value"]
                    if isinstance(data, str):
                        data = json.loads(data)
        except Exception:
            data = None
        if data is None:
            data = _compute(sb, janela)
            try:
                sb.table("shared_kv").upsert({"key": ck, "value": data,
                                              "updated_at": datetime.now(timezone.utc).isoformat()},
                                             on_conflict="key").execute()
            except Exception:
                pass

        if me and lvl < 5:
            mine = email_local(user.get("email"))
            bloco = next((c for c in data.get("corretores", []) if c["corretor"] == mine), None)
            if bloco:
                # sem comparativo nominal: só o próprio + a mediana da equipe
                bloco = dict(bloco)
                bloco.pop("perdas_motivos", None)
            return self._send(200, {"ok": True, "janela_dias": data.get("janela_dias"),
                                    "eu": bloco, "metas": data.get("metas")})
        return self._send(200, {"ok": True, **data})
