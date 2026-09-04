# -*- coding: utf-8 -*-
"""GET /api/v3/diretoria/dossies — 🏛️ Diretoria (sala do CEO IA) · v87.31

Dossiês que o Agente CEO publica (Estado da União às segundas 7h, pareceres,
planos estratégicos, insights). SÓ SÓCIO (lvl>=10) — o gate é AQUI no server,
o menu/rota do front é só conveniência.

Fonte: shared_kv key "diretoria_dossies" (mesmo padrão de leitura do
Sr. Gerência / sr_agente_dossies). Formato:
  { "items": [ { id, tipo ('estado-da-uniao'|'plano-estrategico'|'parecer'|
                 'insight'), titulo, manchete, corpo_md, autor:'CEO',
                 criado_em ISO, fontes:[] }, ... ] }

GET          → lista completa, mais novo primeiro
GET ?meta=1  → só o cabeçalho do mais recente (badge de "novo" no menu — leve)

NENHUMA escrita neste v1: quem escreve é a rotina do Agente CEO (Windows),
direto no Supabase. A key pode não existir ainda → devolve items:[] (o front
mostra o empty state).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

KV_DOSSIES = "diretoria_dossies"


def _load_items(sb):
    rows = (sb.table("shared_kv").select("value,updated_at")
            .eq("key", KV_DOSSIES).limit(1).execute().data or [])
    if not rows:
        return [], None
    v = rows[0].get("value") or {}
    items = v.get("items") if isinstance(v, dict) else None
    if not isinstance(items, list):
        items = []
    # saneamento leve: só dicts. Tipo passa como está — outros agentes (ex.:
    # Sr. CFO publica tipo 'relatorio' no mesmo kv, v87.32) têm tipos próprios
    # e o front tem badge genérico de fallback.
    out = [dict(it) for it in items if isinstance(it, dict)]
    # mais novo primeiro (criado_em ISO ordena lexicograficamente)
    out.sort(key=lambda d: str(d.get("criado_em") or ""), reverse=True)
    return out, rows[0].get("updated_at")


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
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        # 🔒 Diretoria = SÓ sócio. Este require é a fronteira real de segurança.
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        try:
            items, updated_at = _load_items(sb)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if params.get("meta"):
            top = items[0] if items else None
            latest = ({"id": top.get("id"), "criado_em": top.get("criado_em"),
                       "titulo": top.get("titulo"), "tipo": top.get("tipo")} if top else None)
            return self._send(200, {"ok": True, "latest": latest, "total": len(items)})
        return self._send(200, {"ok": True, "items": items, "updated_at": updated_at})
