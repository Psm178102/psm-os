# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/diretoria/diretrizes — 🎯 Diretrizes do CEO (Onda 3 · v87.47)

O ciclo do Agente CEO fecha aqui: recomendação → APROVAÇÃO do sócio → diretriz
com dono e prazo → cobrança automática no Estado da União → aprendizado no
fechamento mensal.

Fonte: shared_kv "ceo_diretrizes"
  {items:[{id, titulo, descricao, dono, prazo (YYYY-MM-DD|null), origem (id do
           dossiê que a gerou), status:'proposta'|'aprovada'|'em_andamento'|
           'concluida'|'atrasada'|'rejeitada'|'falhou',
           criado_em, atualizado_em, resultado, criado_por}]}

Quem escreve:
  - o ceo_cron cria 'proposta' a partir das recomendações do semanal/mensal
    (máx 3/relatório, id idempotente dir_<data>_<slug>) e marca 'atrasada'
    quando o prazo vence — ver ceo_cron.py;
  - o SÓCIO (lvl>=10) aprova/rejeita/conclui/edita AQUI (gate no server).

GET  (lvl>=10) → { ok, items } — propostas e atrasadas primeiro
POST (lvl>=10) → {action, id, ...}:
  aprovar   {id}                      proposta → aprovada
  rejeitar  {id, resultado?}          proposta → rejeitada
  iniciar   {id}                      aprovada → em_andamento
  concluir  {id, resultado}           aprovada|em_andamento|atrasada → concluida
  falhar    {id, resultado}           aprovada|em_andamento|atrasada → falhou
  reabrir   {id}                      concluida|falhou|rejeitada → aprovada
  editar    {id, dono?, prazo?, titulo?, descricao?}
  criar     {titulo, dono, prazo?, descricao?}  → nasce 'aprovada' (sócio criou)
Escrita SEMPRE com trava otimista por md5 (padrão ceo_cron/_kv_write_locked).
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "ceo_diretrizes"
STATUS = ("proposta", "aprovada", "em_andamento", "concluida", "atrasada", "rejeitada", "falhou")
ABERTAS = ("proposta", "aprovada", "em_andamento", "atrasada")
ORDEM = {"proposta": 0, "atrasada": 1, "em_andamento": 2, "aprovada": 3,
         "concluida": 4, "falhou": 5, "rejeitada": 6}
MAX_ITEMS = 200


def _now():
    return datetime.now(timezone.utc).isoformat()


def slugify(txt, maxlen=40):
    s = unicodedata.normalize("NFKD", str(txt or "")).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:maxlen].rstrip("-") or "diretriz"


# ─── KV helpers (mesmo padrão do ceo_cron: trava otimista leve por md5) ──
def _kv_get(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else (default if default is not None else {})
    except Exception:
        return default if default is not None else {}


def _kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value,
                                  "updated_at": _now()}, on_conflict="key").execute()


def _md5(v):
    return hashlib.md5(json.dumps(v, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")).hexdigest()


def _kv_write_locked(sb, key, mutate, retries=3):
    for _ in range(retries):
        antes = _kv_get(sb, key, {})
        h = _md5(antes)
        novo = mutate(json.loads(json.dumps(antes)) if antes else {})
        atual = _kv_get(sb, key, {})
        if _md5(atual) != h:
            continue
        _kv_set(sb, key, novo)
        return novo
    novo = mutate(_kv_get(sb, key, {}))
    _kv_set(sb, key, novo)
    return novo


def _valida_prazo(p):
    if not p:
        return None
    p = str(p)[:10]
    try:
        datetime.strptime(p, "%Y-%m-%d")
        return p
    except ValueError:
        return False


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        # 🔒 Diretoria = SÓ sócio. O gate real é AQUI no server.
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        items = [i for i in (_kv_get(sb, KV_KEY, {}).get("items") or []) if isinstance(i, dict)]
        items.sort(key=lambda i: (ORDEM.get(str(i.get("status")), 9),
                                  str(i.get("prazo") or "9999-12-31"),
                                  str(i.get("criado_em") or "")))
        return self._send(200, {"ok": True, "items": items})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0)
            body = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = str(body.get("action") or "").strip()
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        agora = _now()
        quem = user.get("name") or user.get("login") or "sócio"

        # ── criar (sócio adiciona diretriz já aprovada) ──
        if action == "criar":
            titulo = str(body.get("titulo") or "").strip()
            dono = str(body.get("dono") or "").strip()
            if not titulo or not dono:
                return self._send(400, {"ok": False, "error": "titulo e dono são obrigatórios"})
            prazo = _valida_prazo(body.get("prazo"))
            if prazo is False:
                return self._send(400, {"ok": False, "error": "prazo inválido (use YYYY-MM-DD)"})
            did = f"dir_{agora[:10]}_{slugify(titulo)}"
            novo = {"id": did, "titulo": titulo[:180],
                    "descricao": str(body.get("descricao") or "").strip()[:500],
                    "dono": dono[:60], "prazo": prazo, "origem": "manual",
                    "status": "aprovada", "criado_em": agora, "atualizado_em": agora,
                    "resultado": None, "criado_por": quem}
            estado = {"dup": False}

            def mutate(box):
                estado["dup"] = False   # reset — a trava otimista pode re-rodar o mutate
                items = [i for i in (box.get("items") or []) if isinstance(i, dict)]
                if any(i.get("id") == did for i in items):
                    estado["dup"] = True
                    box["items"] = items
                    return box
                items.insert(0, novo)
                box["items"] = items[:MAX_ITEMS]
                return box
            _kv_write_locked(sb, KV_KEY, mutate)
            if estado["dup"]:
                return self._send(409, {"ok": False, "error": f"já existe a diretriz '{did}' criada hoje com esse título"})
            audit(self, user, "ceo.diretriz_criar", target_type="ceo_diretrizes", target_id=did)
            return self._send(200, {"ok": True, "item": novo})

        # ── demais ações: exigem id existente ──
        did = str(body.get("id") or "").strip()
        if not did:
            return self._send(400, {"ok": False, "error": "id obrigatório"})
        TRANSICOES = {
            "aprovar": (("proposta",), "aprovada"),
            "rejeitar": (("proposta",), "rejeitada"),
            "iniciar": (("aprovada",), "em_andamento"),
            "concluir": (("aprovada", "em_andamento", "atrasada"), "concluida"),
            "falhar": (("aprovada", "em_andamento", "atrasada"), "falhou"),
            "reabrir": (("concluida", "falhou", "rejeitada"), "aprovada"),
        }
        if action not in TRANSICOES and action != "editar":
            return self._send(400, {"ok": False, "error": f"action desconhecida: {action}"})

        estado = {"err": None, "item": None}

        def mutate(box):
            estado["err"] = None; estado["item"] = None   # reset — mutate pode re-rodar
            items = [i for i in (box.get("items") or []) if isinstance(i, dict)]
            alvo = next((i for i in items if str(i.get("id")) == did), None)
            if not alvo:
                estado["err"] = (404, f"diretriz '{did}' não existe")
                box["items"] = items
                return box
            if action == "editar":
                if "dono" in body and str(body.get("dono") or "").strip():
                    alvo["dono"] = str(body["dono"]).strip()[:60]
                if "prazo" in body:
                    p = _valida_prazo(body.get("prazo"))
                    if p is False:
                        estado["err"] = (400, "prazo inválido (use YYYY-MM-DD)")
                        box["items"] = items
                        return box
                    alvo["prazo"] = p
                    # prazo novo no futuro tira a diretriz de 'atrasada'
                    if p and alvo.get("status") == "atrasada" and p >= agora[:10]:
                        alvo["status"] = "aprovada"
                if "titulo" in body and str(body.get("titulo") or "").strip():
                    alvo["titulo"] = str(body["titulo"]).strip()[:180]
                if "descricao" in body:
                    alvo["descricao"] = str(body.get("descricao") or "").strip()[:500]
            else:
                de, para = TRANSICOES[action]
                st = str(alvo.get("status") or "")
                if st not in de:
                    estado["err"] = (409, f"'{action}' exige status ∈ {de} (atual: '{st}')")
                    box["items"] = items
                    return box
                alvo["status"] = para
                if action in ("concluir", "falhar", "rejeitar"):
                    res = str(body.get("resultado") or "").strip()
                    if action != "rejeitar" and not res:
                        estado["err"] = (400, "resultado é obrigatório ao concluir/falhar")
                        box["items"] = items
                        return box
                    alvo["resultado"] = res[:500] or alvo.get("resultado")
                if action == "reabrir":
                    alvo["resultado"] = None
            alvo["atualizado_em"] = agora
            alvo["atualizado_por"] = quem
            estado["item"] = alvo
            box["items"] = items
            return box

        _kv_write_locked(sb, KV_KEY, mutate)
        if estado["err"]:
            return self._send(estado["err"][0], {"ok": False, "error": estado["err"][1]})
        audit(self, user, "ceo.diretriz_" + action, target_type="ceo_diretrizes", target_id=did)
        return self._send(200, {"ok": True, "item": estado["item"]})
