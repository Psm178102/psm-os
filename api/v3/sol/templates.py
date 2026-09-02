"""
POST /api/v3/sol/templates — templates de WhatsApp da Sol × Graph API da Meta
Header: Authorization: Bearer <token> — SÓ SÓCIO (lvl >= 10).

Body:
  {"action": "submit", "nome": "<nome do template em sol_config.templates>"}
      → POST https://graph.facebook.com/v21.0/{META_WABA_ID}/message_templates
        (name/language pt_BR/category/components BODY) e marca em_analise.
  {"action": "sync"}
      → GET  .../{META_WABA_ID}/message_templates?fields=name,status,id,category
        e espelha o status da Meta em sol_config.templates
        (APPROVED→aprovado, PENDING/IN_APPEAL→em_analise, REJECTED→rejeitado).

Envs: META_WA_TOKEN + META_WABA_ID (a WABA da Sol ainda não existe — sem os
envs o endpoint responde erro AMIGÁVEL, nunca stack trace, e nada quebra).
O valor do token NUNCA aparece em resposta nem em log.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

GRAPH = "https://graph.facebook.com/v21.0"
CATEGORIAS_OK = ("UTILITY", "MARKETING", "AUTHENTICATION")
STATUS_META = {"APPROVED": "aprovado", "PENDING": "em_analise",
               "IN_APPEAL": "em_analise", "REJECTED": "rejeitado",
               "PAUSED": "pausado", "DISABLED": "rejeitado"}


def _envs():
    tok = os.environ.get("META_WA_TOKEN", "").strip()
    waba = os.environ.get("META_WABA_ID", "").strip()
    return tok, waba


def _graph(method, url, token, payload=None):
    """Chamada à Graph API (urllib, padrão do repo). Devolve (status, dict)."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "psm-os-sol/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            err = {}
        msg = ((err.get("error") or {}).get("message")) or f"HTTP {e.code}"
        return e.code, {"error": msg}
    except Exception as e:
        return 0, {"error": f"rede: {e}"}


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def _load_templates(self, sb):
        rows = (sb.table("sol_config").select("valor")
                .eq("chave", "templates").limit(1).execute().data or [])
        tpls = (rows[0].get("valor") if rows else None) or []
        return tpls if isinstance(tpls, list) else []

    def _save_templates(self, sb, tpls):
        sb.table("sol_config").upsert({
            "chave": "templates", "valor": tpls,
            "atualizado_em": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="chave").execute()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = str(body.get("action") or "").strip().lower()
        if action not in ("submit", "sync"):
            return self._send(400, {"ok": False, "error": "action precisa ser submit ou sync"})

        token, waba = _envs()
        if not token or not waba:
            # erro AMIGÁVEL de propósito: a WABA ainda não saiu — a tela mostra isso
            return self._send(503, {"ok": False, "pendente_setup": True,
                                    "error": "token da WABA ainda não configurado — "
                                             "setar META_WA_TOKEN e META_WABA_ID no Vercel"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        try:
            tpls = self._load_templates(sb)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        if action == "submit":
            nome = str(body.get("nome") or "").strip()
            tpl = next((t for t in tpls if isinstance(t, dict) and t.get("nome") == nome), None)
            if not tpl:
                return self._send(404, {"ok": False, "error": f"template {nome!r} não está em sol_config.templates"})
            corpo = str(tpl.get("corpo") or "").strip()
            categoria = str(tpl.get("categoria") or "UTILITY").strip().upper()
            if not corpo:
                return self._send(400, {"ok": False, "error": "template sem corpo"})
            if categoria not in CATEGORIAS_OK:
                return self._send(400, {"ok": False, "error": f"categoria inválida ({categoria})"})
            st, resp = _graph("POST", f"{GRAPH}/{urllib.parse.quote(waba)}/message_templates", token, {
                "name": nome, "language": "pt_BR", "category": categoria,
                "components": [{"type": "BODY", "text": corpo}],
            })
            if st != 200 or resp.get("error"):
                return self._send(502, {"ok": False, "error": f"Meta recusou: {resp.get('error') or st}"})
            tpl["status_meta"] = "em_analise"
            if resp.get("id"):
                tpl["template_id"] = resp["id"]
            try:
                self._save_templates(sb, tpls)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "sol.template_submit", target_type="sol_template", target_id=nome,
                  after={"status_meta": "em_analise", "template_id": tpl.get("template_id")})
            return self._send(200, {"ok": True, "template": tpl})

        # action == "sync"
        st, resp = _graph("GET",
                          f"{GRAPH}/{urllib.parse.quote(waba)}/message_templates"
                          "?fields=name,status,id,category&limit=100", token)
        if st != 200 or resp.get("error"):
            return self._send(502, {"ok": False, "error": f"Meta recusou: {resp.get('error') or st}"})
        na_meta = {str(t.get("name")): t for t in (resp.get("data") or []) if isinstance(t, dict)}
        mudou = 0
        for tpl in tpls:
            if not isinstance(tpl, dict):
                continue
            m = na_meta.get(str(tpl.get("nome")))
            if not m:
                continue
            novo = STATUS_META.get(str(m.get("status") or "").upper())
            if novo and tpl.get("status_meta") != novo:
                tpl["status_meta"] = novo
                mudou += 1
            if m.get("id") and not tpl.get("template_id"):
                tpl["template_id"] = m["id"]
        if mudou:
            try:
                self._save_templates(sb, tpls)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "sol.template_sync", target_type="sol_template",
              notes=f"{mudou} status atualizados")
        return self._send(200, {"ok": True, "atualizados": mudou, "templates": tpls})
