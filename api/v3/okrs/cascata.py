"""GET /api/v3/okrs/cascata?ano=2026&ciclo=Q3%202026 — Desdobramento estratégico (v88.13)

Monta a cadeia inteira já calculada, pra Diretoria ler de cima pra baixo:

  Norte (visão/missão — tabela estrategia)
    └ Objetivo estratégico do ano (estrategia, tipo='objetivo')
        └ OKR do ciclo (okrs.objetivo_id)
            └ KR — manual (curr/target digitados) OU ligado às Metas
                   (fonte 'vgv' | 'vendas': realizado e meta vêm da aba Metas,
                    mesma conta de /metas/atingimento, somando os meses do ciclo)
            └ Projetos (paulo_cards board=projetos, okr_id)

Progresso sobe sozinho: KR → OKR (média) → Objetivo (média). O status do OKR
deixa de ser digitado: compara o progresso com o RITMO (quanto do ciclo já
passou). 'completed' marcado à mão continua valendo.

Também devolve a SAÚDE da cascata: objetivo sem OKR, OKR sem objetivo/dono/
projeto, projeto ativo sem OKR, KR manual parado.

lvl >= 5 (Líder+), igual à edição de OKR.
"""
from http.server import BaseHTTPRequestHandler
import calendar
import importlib.util
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PJ_CHECK_N = 7                      # itens do checklist padrão de projeto (projetos.js)
PJ_ATIVOS = {"ideia", "planejamento", "andamento", "revisao"}
FONTES = {"vgv": "VGV (aba Metas)", "vendas": "Vendas (aba Metas)"}
KR_PARADO_DIAS = 21


def _hoje():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date()


def meses_do_ciclo(ciclo, ano_padrao):
    """'Q3 2026' → (2026, [7,8,9]); 'S2 2026' → 7..12; 'ANO 2026' → 1..12."""
    partes = str(ciclo or "").strip().upper().split()
    try:
        ano = int(partes[-1]) if partes and partes[-1].isdigit() else ano_padrao
    except Exception:
        ano = ano_padrao
    tag = partes[0] if partes else "ANO"
    if tag.startswith("Q") and tag[1:].isdigit() and 1 <= int(tag[1:]) <= 4:
        q = int(tag[1:]); return ano, list(range(3 * q - 2, 3 * q + 1))
    if tag.startswith("S") and tag[1:].isdigit() and int(tag[1:]) in (1, 2):
        s = int(tag[1:]); return ano, list(range(6 * s - 5, 6 * s + 1))
    return ano, list(range(1, 13))


def ritmo_pct(ano, meses, hoje):
    """% do ciclo já decorrido (0 antes de começar, 100 depois de terminar)."""
    ini = date(ano, meses[0], 1)
    fim = date(ano, meses[-1], calendar.monthrange(ano, meses[-1])[1])
    if hoje < ini: return 0
    if hoje >= fim: return 100
    return round(((hoje - ini).days + 1) / ((fim - ini).days + 1) * 100)


def status_por_ritmo(pct, ritmo):
    if ritmo <= 0: return "nao_iniciado"
    if pct >= ritmo * 0.9: return "on_track"
    if pct >= ritmo * 0.6: return "at_risk"
    return "off_track"


def _pj_pct(c):
    if c.get("status") == "concluido": return 100
    return min(100, round(len((c.get("checklist") or {})) / PJ_CHECK_N * 100))


def _metas_empresa(sb, ano):
    """{mes: {meta_vgv, meta_vendas, vgv, vendas}} da empresa — mesma régua da aba Metas."""
    spec = importlib.util.spec_from_file_location("_okr_metas_atingimento", os.path.join(_V3, "metas", "atingimento.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    r = mod.calcular(sb, {"id": "_okr_cascata", "lvl": 10, "role": "socio", "team": ""}, ano)
    out = {m: {"meta_vgv": 0.0, "meta_vendas": 0, "vgv": 0.0, "vendas": 0} for m in range(1, 13)}
    for g in r.get("grid") or []:
        for c in g.get("cells") or []:
            o = out.get(c.get("mes"))
            if not o: continue
            o["meta_vgv"] += float(c.get("meta_vgv") or 0)
            o["meta_vendas"] += int(c.get("meta_vendas") or 0)
            o["vgv"] += float(c.get("atingido_vgv") or 0)
            o["vendas"] += int(c.get("vendas_count") or 0)
    for m, fg in (r.get("fora_do_grid_mensal") or {}).items():   # desligados + sem corretor: venda real conta
        o = out.get(int(m))
        if o:
            o["vgv"] += float(fg.get("vgv") or 0)
            o["vendas"] += int(fg.get("vendas") or 0)
    return out


def calcular_kr(kr, ano, meses, metas, hoje):
    k = dict(kr)
    fonte = k.get("fonte") or "manual"
    if fonte in FONTES and metas is not None:
        chave_real, chave_meta = ("vgv", "meta_vgv") if fonte == "vgv" else ("vendas", "meta_vendas")
        k["curr"] = round(sum(metas[m][chave_real] for m in meses), 2)
        meta_metas = round(sum(metas[m][chave_meta] for m in meses), 2)
        k["meta_das_metas"] = meta_metas
        if k.get("meta_modo") != "manual":
            k["target"] = meta_metas
        k["unit"] = "R$" if fonte == "vgv" else "vendas"
        k["fonte_lbl"] = FONTES[fonte]
    try: curr = float(k.get("curr") or 0)
    except Exception: curr = 0.0
    try: target = float(k.get("target") or 0)
    except Exception: target = 0.0
    k["pct"] = round(curr / target * 100) if target > 0 else 0
    k["sem_meta"] = target <= 0
    if fonte == "manual" and k.get("atualizado_em"):
        try:
            dias = (hoje - date.fromisoformat(str(k["atualizado_em"])[:10])).days
            k["parado_dias"] = dias if dias >= KR_PARADO_DIAS else None
        except Exception:
            pass
    return k


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try: params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception: params = {}
        hoje = _hoje()
        try: ano = int(params.get("ano") or hoje.year)
        except Exception: ano = hoje.year
        filtro_ciclo = (params.get("ciclo") or "").strip()   # vazio = todos os ciclos do ano

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            est = sb.table("estrategia").select("*").eq("ano", ano).order("ordem").limit(300).execute().data or []
            okrs = sb.table("okrs").select("*").order("criado_em").limit(300).execute().data or []
            nomes = {u["id"]: u.get("name") for u in (sb.table("users").select("id,name").limit(500).execute().data or [])}
            projs = sb.table("paulo_cards").select("id,titulo,status,responsavel,checklist,data_ref,data_entrega,okr_id,updated_at") \
                .eq("board", "projetos").limit(500).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        norte = {t: [r for r in est if r.get("tipo") == t and r.get("status") != "cancelado"] for t in ("visao", "missao")}
        objetivos = [r for r in est if r.get("tipo") == "objetivo" and r.get("status") != "cancelado"]

        # só OKRs do ano pedido (e do ciclo, se filtrado)
        sel = []
        for o in okrs:
            a, meses = meses_do_ciclo(o.get("ciclo"), ano)
            if a != ano: continue
            if filtro_ciclo and (o.get("ciclo") or "").strip().upper() != filtro_ciclo.upper(): continue
            sel.append((o, meses))

        precisa_metas = any((kr or {}).get("fonte") in FONTES for o, _ in sel for kr in (o.get("krs") or []))
        metas, erro_metas = None, None
        if precisa_metas:
            try: metas = _metas_empresa(sb, ano)
            except Exception as e: erro_metas = f"Metas indisponíveis: {e}"

        pj_por_okr = {}
        for c in projs:
            if c.get("status") == "excluido": continue
            c["pct"] = _pj_pct(c)
            c["atrasado"] = bool(c.get("data_ref") and c.get("status") in PJ_ATIVOS and str(c["data_ref"])[:10] < hoje.isoformat())
            if c.get("okr_id"): pj_por_okr.setdefault(c["okr_id"], []).append(c)

        okrs_out = []
        for o, meses in sel:
            ritmo = ritmo_pct(ano, meses, hoje)
            krs = [calcular_kr(kr or {}, ano, meses, metas, hoje) for kr in (o.get("krs") or [])]
            pct = round(sum(min(100, k["pct"]) for k in krs) / len(krs)) if krs else 0
            ps = pj_por_okr.get(o["id"], [])
            okrs_out.append({
                **{k: o.get(k) for k in ("id", "objetivo", "ciclo", "responsavel", "area", "objetivo_id", "updated_at")},
                "responsavel_nome": nomes.get(o.get("responsavel")) or o.get("responsavel"),   # okrs.responsavel = users.id (FK)
                "krs": krs, "pct": pct, "ritmo": ritmo,
                "status_manual": o.get("status"),
                "status": "completed" if o.get("status") == "completed" else status_por_ritmo(pct, ritmo),
                "projetos": ps,
                "projetos_pct": round(sum(p["pct"] for p in ps) / len(ps)) if ps else None,
            })

        ids_obj = {str(ob["id"]) for ob in objetivos}
        obj_out = []
        for ob in objetivos:
            filhos = [x for x in okrs_out if str(x.get("objetivo_id") or "") == str(ob["id"])]
            obj_out.append({
                **{k: ob.get(k) for k in ("id", "titulo", "descricao", "status", "ordem")},
                "okrs": filhos,
                "pct": round(sum(x["pct"] for x in filhos) / len(filhos)) if filhos else 0,
            })
        soltos = [x for x in okrs_out if str(x.get("objetivo_id") or "") not in ids_obj]

        todos_okr = {o["id"] for o in okrs}
        orfaos = [c for c in projs if c.get("status") in PJ_ATIVOS and (not c.get("okr_id") or c["okr_id"] not in todos_okr)]

        saude = {
            "objetivos": len(obj_out),
            "okrs": len(okrs_out),
            "on_track": sum(1 for x in okrs_out if x["status"] in ("on_track", "completed")),
            "at_risk": sum(1 for x in okrs_out if x["status"] == "at_risk"),
            "off_track": sum(1 for x in okrs_out if x["status"] == "off_track"),
            "pct_geral": round(sum(x["pct"] for x in okrs_out) / len(okrs_out)) if okrs_out else 0,
            "alertas": [],
        }
        al = saude["alertas"]
        if not norte["visao"] or not norte["missao"]:
            al.append({"nivel": "alto", "txt": "Norte incompleto: falta " + " e ".join(t for t in ("visão", "missão") if not norte["visao" if t == "visão" else "missao"]), "acao": "#/norte-estrategico"})
        if not obj_out:
            al.append({"nivel": "alto", "txt": f"Nenhum objetivo estratégico cadastrado para {ano}", "acao": "novo-objetivo"})
        for ob in obj_out:
            if not ob["okrs"]: al.append({"nivel": "medio", "txt": f"Objetivo sem OKR: {ob['titulo']}", "acao": "novo-okr:" + str(ob["id"])})
        for x in okrs_out:
            if not x.get("responsavel"): al.append({"nivel": "medio", "txt": f"OKR sem dono: {x['objetivo']}", "acao": "editar-okr:" + x["id"]})
            if not x["krs"]: al.append({"nivel": "medio", "txt": f"OKR sem resultado-chave: {x['objetivo']}", "acao": "editar-okr:" + x["id"]})
            for k in x["krs"]:
                if k.get("parado_dias"): al.append({"nivel": "baixo", "txt": f"KR sem atualização há {k['parado_dias']} dias: {k.get('label') or '—'}", "acao": "editar-okr:" + x["id"]})
                if k.get("sem_meta"): al.append({"nivel": "baixo", "txt": f"KR sem meta: {k.get('label') or '—'}", "acao": "editar-okr:" + x["id"]})
        if soltos: al.append({"nivel": "medio", "txt": f"{len(soltos)} OKR(s) sem objetivo estratégico", "acao": "#soltos"})
        if orfaos: al.append({"nivel": "medio", "txt": f"{len(orfaos)} projeto(s) ativo(s) sem OKR — esforço que não move nenhum resultado", "acao": "#orfaos"})
        if erro_metas: al.append({"nivel": "alto", "txt": erro_metas, "acao": None})

        return self._send(200, {
            "ok": True, "ano": ano, "ciclo": filtro_ciclo or None, "hoje": hoje.isoformat(),
            "norte": norte, "objetivos": obj_out, "okrs_sem_objetivo": soltos,
            "projetos_orfaos": orfaos, "saude": saude,
        })
