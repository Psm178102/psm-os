"""
GET/POST /api/v3/morimatsu/state — banco do módulo 🏯 Morimatsu & Associados. v87.52

Escritório de Gestão Patrimonial Imobiliária (boutique pessoal do Paulo — não é
imobiliária). SISTEMA COMPLETO do ciclo, do pré-cadastro à saída do ativo, tudo
dentro do House: cada coleção é uma chave própria do shared_kv (payload pequeno
por tela, sem carregar tudo a cada clique):

  morimatsu_investidores   [ {id, nome, fone, email, documento, endereco, cidade, pj,
                              objetivo, pagamento, faixa, capital, disp, modalidades[],
                              regiao, ocupacao, origem, caixa, obs, coluna, responsavel,
                              proximo_contato, tags[], criado_em, atualizado_em, hist[]} ]
  morimatsu_imoveis        [ {id, titulo, cidade, bairro, tipo, matricula, cartorio,
                              modalidade, credor, leiloeiro, link, avaliacao, lance_min,
                              data_certame, ocupado, debitos_cond, aceita_fin, obs, status,
                              investidor_id, analise{...}, criado_em, atualizado_em} ]
  morimatsu_operacoes      [ {id, investidor_id, imovel_id, data_arrematacao, valor,
                              honorarios{analise,certame,exito}, checklist{...}, destino,
                              saida{...}, status, obs, criado_em, atualizado_em} ]
  morimatsu_atividades     [ {id, tipo, investidor_id, imovel_id, operacao_id, texto,
                              quando, feito, feito_em, autor, criado_em} ]
  morimatsu_roteiro        [ {id, fase, quando, titulo_fase, t, quem, done, em} ]
  morimatsu_minutas        [ {id, slug, cat, ordem, titulo, desc, corpo} ]  # v87.56: só as EDITADAS;
                              # as não-editadas vêm de MINUTAS_PADRAO no front (voltar ao padrão = excluir)
  morimatsu_config         { honorarios:[{servico,valor,obs}], nao_incluso, notas }

SÓ SÓCIO (lvl>=10) — GET e POST. Abrir pra alguém = baixar aqui E no ROUTE_MIN_LVL.

GET  ?col=a,b            → { ok, cols:{a:[...], b:[...]}, updated_at:{a:..} }  (sem col = todas)
POST { op:'upsert', col, item }   → grava/atualiza 1 item (por id) — não clobbera o resto
POST { op:'delete', col, id }     → remove 1 item
POST { op:'set',    col, value }  → substitui a coleção inteira (config / roteiro reordenado)
POST { patch:{...} }              → legado v87.51 (investidores/roteiro/notas) — ainda aceito
Resposta: { ok, col, value } com a coleção já atualizada.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, cargos_of  # type: ignore

# Quem entra: sócio/diretor (lvl 10) e quem OCUPA o cargo de consultor da
# Morimatsu — inclusive como cargo ADICIONAL (v87.64: um login pode ter vários).
# Só nível não serve: gerente também é alto e não pode ler o funil de investidores.
CARGOS_MORIMATSU = ("consultor_morimatsu",)


def pode_morimatsu(u) -> bool:
    if (u or {}).get("lvl", 0) >= 10:
        return True
    return bool(set(CARGOS_MORIMATSU) & set(cargos_of(u)))


PREFIX = "morimatsu_"
LISTAS = {"investidores", "imoveis", "operacoes", "atividades", "roteiro", "minutas"}
OBJETOS = {"config"}
COLS = LISTAS | OBJETOS
MAX_BYTES = 900_000
MAX_ITENS = 5000


def _now():
    return datetime.now(timezone.utc).isoformat()


def _default(col):
    return [] if col in LISTAS else {}


def _load(sb, cols):
    keys = [PREFIX + c for c in cols]
    out, ups = {}, {}
    try:
        rows = sb.table("shared_kv").select("key,value,updated_at").in_("key", keys).execute().data or []
    except Exception:
        rows = []
    by = {r["key"]: r for r in rows}
    # compat v87.51: chave única morimatsu_state (investidores/roteiro/notas) — migra na leitura
    legado = None
    if any(c in ("investidores", "config") for c in cols) and not any(k in by for k in (PREFIX + "investidores", PREFIX + "config")):
        try:
            lr = sb.table("shared_kv").select("value").eq("key", PREFIX + "state").limit(1).execute().data or []
            legado = lr[0]["value"] if lr else None
            if isinstance(legado, str):
                legado = json.loads(legado)
        except Exception:
            legado = None
    for c in cols:
        r = by.get(PREFIX + c)
        val = r["value"] if r else None
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                val = None
        if val is None and isinstance(legado, dict):
            if c == "investidores":
                val = legado.get("investidores")
            elif c == "config":
                val = {"notas": legado.get("notas") or ""}
        want = list if c in LISTAS else dict
        out[c] = val if isinstance(val, want) else _default(c)
        ups[c] = r.get("updated_at") if r else None
    return out, ups


def _save(sb, col, value):
    sb.table("shared_kv").upsert({"key": PREFIX + col, "value": value, "updated_at": _now()},
                                 on_conflict="key").execute()


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
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        if not pode_morimatsu(actor):
            return self._send(403, {"ok": False, "error": "restrito aos sócios e ao consultor Morimatsu"})
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        cols = [c.strip() for c in (qs.get("col") or "").split(",") if c.strip()] or sorted(COLS)
        bad = [c for c in cols if c not in COLS]
        if bad:
            return self._send(400, {"ok": False, "error": f"coleção desconhecida: {bad}", "cols": sorted(COLS)})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        data, ups = _load(sb, cols)
        return self._send(200, {"ok": True, "cols": data, "updated_at": ups})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        if not pode_morimatsu(actor):
            return self._send(403, {"ok": False, "error": "restrito aos sócios e ao consultor Morimatsu"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BYTES:
                return self._send(413, {"ok": False, "error": "payload grande demais"})
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # ── legado v87.51: { patch: {investidores|roteiro|notas} } ──
        patch = body.get("patch")
        if isinstance(patch, dict) and patch and not body.get("op"):
            tocou = []
            try:
                if isinstance(patch.get("investidores"), list):
                    _save(sb, "investidores", patch["investidores"]); tocou.append("investidores")
                if isinstance(patch.get("notas"), str):
                    cfg = _load(sb, ["config"])[0]["config"]; cfg["notas"] = patch["notas"]
                    _save(sb, "config", cfg); tocou.append("config")
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "morimatsu.update", target_type="shared_kv", target_id=",".join(tocou))
            return self._send(200, {"ok": True, "tocou": tocou})

        op = (body.get("op") or "").strip()
        col = (body.get("col") or "").strip()
        if col not in COLS:
            return self._send(400, {"ok": False, "error": "col inválida", "cols": sorted(COLS)})
        if op not in ("upsert", "delete", "set"):
            return self._send(400, {"ok": False, "error": "op precisa ser upsert | delete | set"})
        cur = _load(sb, [col])[0][col]
        try:
            if op == "set":
                value = body.get("value")
                want = list if col in LISTAS else dict
                if not isinstance(value, want):
                    return self._send(400, {"ok": False, "error": f"value precisa ser {'lista' if want is list else 'objeto'}"})
                if want is list and len(value) > MAX_ITENS:
                    return self._send(413, {"ok": False, "error": "itens demais"})
                cur = value
            elif col in OBJETOS:
                return self._send(400, {"ok": False, "error": f"{col} é objeto — use op:'set'"})
            elif op == "upsert":
                item = body.get("item")
                if not isinstance(item, dict) or not str(item.get("id") or "").strip():
                    return self._send(400, {"ok": False, "error": "item precisa ser objeto com id"})
                iid = str(item["id"])
                item["atualizado_em"] = _now()
                item.setdefault("criado_em", item["atualizado_em"])
                idx = next((i for i, x in enumerate(cur) if str(x.get("id")) == iid), -1)
                if idx >= 0:
                    item.setdefault("criado_em", cur[idx].get("criado_em"))
                    cur[idx] = item
                else:
                    if len(cur) >= MAX_ITENS:
                        return self._send(413, {"ok": False, "error": "itens demais"})
                    cur.append(item)
            else:  # delete
                iid = str(body.get("id") or "").strip()
                if not iid:
                    return self._send(400, {"ok": False, "error": "id obrigatório"})
                cur = [x for x in cur if str(x.get("id")) != iid]
            _save(sb, col, cur)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"morimatsu.{op}", target_type="shared_kv", target_id=PREFIX + col)
        return self._send(200, {"ok": True, "col": col, "value": cur})
