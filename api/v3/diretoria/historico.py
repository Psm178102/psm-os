# -*- coding: utf-8 -*-
"""GET/POST /api/v3/diretoria/historico — 📜 Histórico Notion (v88.35)

Arquivo da gestão antiga da PSM no Notion (workspace PSM IMÓVEIS → teamspaces PSM VENDAS e
PSM LOCAÇÃO, nov/2024–set/2026) + vendas 2023–2026 normalizadas, para consulta e comparativos
na Diretoria. SÓ sócio (lvl 10): tem cliente, valor e comissão.

GET                      → meta da extração, dataset de vendas e de metas, lista de bancos e o
                           espelho do RD (vendas ganhas por mês / corretor / origem) pro
                           comparativo Notion × RD
GET ?secao=arquivo       → índice das páginas (sem conteúdo)
GET ?pagina=<id>         → uma página (Markdown)
GET ?banco=<id>          → um banco (colunas + linhas)
POST {action:'import', records:[...], reset?:bool}  → grava um lote do arquivo gerado por
     historico-notion/_scripts/convert.py (reset=true no 1º lote apaga a importação anterior)

Dados: tabela hist_notion (RLS sem policies — só o service role lê). Os dados NÃO ficam no
repositório (é público): entram pelo upload da própria tela.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _V3 not in sys.path:
    sys.path.append(_V3)
import _metricas_lib as ML  # type: ignore

TB = "hist_notion"
KINDS = ("pagina", "banco", "dataset")
CAMPOS = ("id", "kind", "titulo", "caminho", "teamspace", "banco", "criado", "editado", "autor", "conteudo", "dados")
LOTE_MAX = 400


def _dataset(sb, nome):
    rows = sb.table(TB).select("dados,importado_em").eq("id", f"dataset:{nome}").limit(1).execute().data or []
    return (rows[0].get("dados"), rows[0].get("importado_em")) if rows else (None, None)


def _rd_espelho(sb):
    """Vendas ganhas do RD agregadas por mês, por ano×corretor e por ano×origem (regras do
    Dicionário de Métricas §1–§3: win=true, mês = closed_at em Brasília, VGV = vgv_de)."""
    cols = ("id,win,closed_at,amount,user_id,user_email,"
            "src:rd_raw->deal_source->>name,oc:origem_cliente,amt_total:rd_raw->amount_total,amt_unique:rd_raw->amount_unique")
    deals = ML._paginado(lambda: sb.table("deals").select(cols).eq("win", True).order("id"), keyset="id")
    users = sb.table("users").select("id,name,email,is_service").execute().data or []
    pessoas = [u for u in users if u.get("id") and not u.get("is_service")]
    nome = {str(u["id"]): (u.get("name") or "").strip() for u in pessoas}
    email2uid = {(u.get("email") or "").lower(): str(u["id"]) for u in pessoas if u.get("email")}
    servico = {(u.get("email") or "").lower() for u in users if u.get("is_service") and u.get("email")}
    mapa = ML.mapa_origens(sb)

    mensal = defaultdict(lambda: {"n": 0, "vgv": 0.0})
    corretor = defaultdict(lambda: {"n": 0, "vgv": 0.0})
    origem = defaultdict(lambda: {"n": 0, "vgv": 0.0})
    sem_data = 0
    for d in deals:
        dt = ML.to_brt(d.get("closed_at"))
        if not dt:
            sem_data += 1
            continue
        v = ML.vgv_de(d)
        mes, ano = dt.strftime("%Y-%m"), dt.strftime("%Y")
        mensal[mes]["n"] += 1; mensal[mes]["vgv"] += v
        uid = ML._dono(d, email2uid, set(nome), servico)
        quem = (nome.get(uid) or "Sem corretor").split(" ")[0].title() if uid else "Sem corretor"
        corretor[(ano, quem)]["n"] += 1; corretor[(ano, quem)]["vgv"] += v
        cat, _ = ML.origem_categoria(ML.origem_nome(d), mapa)   # v88.51: "Origem do cliente" → Fonte (§2)
        origem[(ano, cat)]["n"] += 1; origem[(ano, cat)]["vgv"] += v
    return {
        "mensal": [{"mes": k, **v} for k, v in sorted(mensal.items())],
        "por_corretor": [{"ano": a, "corretor": c, **v} for (a, c), v in sorted(corretor.items())],
        "por_origem": [{"ano": a, "origem_cat": o, **v} for (a, o), v in sorted(origem.items())],
        "sem_data": sem_data,
        "versao": ML.versao_deals(sb),
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: u = require_user(self, min_lvl=10)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        arg = lambda k: (q.get(k) or [""])[0]
        try:
            if arg("pagina"):
                rows = sb.table(TB).select("id,titulo,caminho,teamspace,banco,criado,editado,autor,conteudo") \
                    .eq("kind", "pagina").eq("id", arg("pagina")).limit(1).execute().data or []
                if not rows: return self._send(404, {"ok": False, "error": "página não encontrada"})
                return self._send(200, {"ok": True, "pagina": rows[0]})
            if arg("banco"):
                rows = sb.table(TB).select("id,titulo,caminho,dados").eq("kind", "banco").eq("id", arg("banco")).limit(1).execute().data or []
                if not rows: return self._send(404, {"ok": False, "error": "banco não encontrado"})
                return self._send(200, {"ok": True, "banco": rows[0]})
            if arg("secao") == "arquivo":
                paginas = ML._paginado(lambda: sb.table(TB).select("id,titulo,caminho,teamspace,banco,criado,editado,autor")
                                       .eq("kind", "pagina").order("id"), keyset="id")
                return self._send(200, {"ok": True, "paginas": paginas})

            meta, importado_em = _dataset(sb, "meta")
            if not meta:
                return self._send(200, {"ok": True, "vazio": True})
            vendas, _ = _dataset(sb, "vendas")
            metas, _ = _dataset(sb, "metas")
            bancos = sb.table(TB).select("id,titulo,caminho").eq("kind", "banco").order("caminho").execute().data or []
            try:
                rd = _rd_espelho(sb)
            except Exception as e:  # RD fora não derruba o histórico — a tela avisa
                rd = {"erro": str(e)}
            return self._send(200, {"ok": True, "vazio": False, "meta": meta, "importado_em": importado_em,
                                    "vendas": vendas or [], "metas": metas or [], "bancos": bancos, "rd": rd})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try: u = require_user(self, min_lvl=10)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if body.get("action") != "import": return self._send(400, {"ok": False, "error": "action inválida"})
        recs = body.get("records")
        if not isinstance(recs, list) or not recs or len(recs) > LOTE_MAX:
            return self._send(400, {"ok": False, "error": f"records: lista de 1 a {LOTE_MAX}"})
        agora = datetime.now(timezone.utc).isoformat()   # v88.46: um carimbo só por lote (base do "início")
        limpos = []
        for r in recs:
            if not isinstance(r, dict) or not r.get("id") or r.get("kind") not in KINDS:
                return self._send(400, {"ok": False, "error": "registro inválido (id/kind)"})
            limpo = {k: r.get(k) for k in CAMPOS}
            limpo["importado_em"] = agora
            limpos.append(limpo)
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        # v88.46: importação atômica. Antes o 1º lote APAGAVA a tabela inteira (reset) e um
        # lote que falhasse no meio deixava o histórico vazio/parcial. Agora: todos os lotes
        # fazem upsert (o antigo continua lá) e só o ÚLTIMO lote, depois de tudo gravado,
        # remove o que não veio no arquivo novo (importado_em anterior ao início desta carga).
        inicio = str(body.get("inicio") or "")
        primeiro = bool(body.get("reset") or body.get("primeiro"))
        if primeiro and not inicio:
            inicio = agora
        removidos = 0
        try:
            for i in range(0, len(limpos), 100):
                sb.table(TB).upsert(limpos[i:i + 100], on_conflict="id").execute()
            if body.get("fim") and inicio:
                r = sb.table(TB).delete().lt("importado_em", inicio).execute()
                removidos = len(r.data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e) + " — o histórico anterior foi mantido"})
        if primeiro or body.get("fim"):
            audit(self, u, "historico.import", target_type="hist_notion",
                  notes=("início" if primeiro else "fim") + f" · lote {len(limpos)}"
                        + (f" · {removidos} antigos removidos" if body.get("fim") else ""))
        return self._send(200, {"ok": True, "gravados": len(limpos), "inicio": inicio, "removidos": removidos})
