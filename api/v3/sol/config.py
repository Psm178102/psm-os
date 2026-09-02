"""
POST /api/v3/sol/config — atualiza uma chave de sol_config
Body: { "chave": "autonomia_padrao", "valor": { "modo": "copiloto" | "autonoma" } }
Header: Authorization: Bearer <token> — SÓ SÓCIO (lvl >= 10).

Chaves permitidas (whitelist — nada além disso entra):
  - autonomia_padrao  → {"modo": "copiloto" | "autonoma"}
  - persona_versao    → {"versao": "<texto curto>"}
  - reguas            → {"<regua>": [{"dias": num>=0, "porta": janela|utilidade|marketing,
                         "intencao": "<slug>"}, ...], ...}  (editor da aba Réguas)
  - custos_fixos      → {"infra_mensal_brl": num>=0, "elevenlabs_mensal_brl": num>=0}
                        (rateados pro-rata/dia no bloco Gastos da aba Análises)
(numero_whatsapp NÃO é editável por aqui de propósito: número/phone_id/token
 são setup de infra — mudam no Supabase/Vercel, não num toggle de tela.
 templates também não: quem escreve a chave 'templates' é api/v3/sol/templates.py,
 que sincroniza com a Graph API.)
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

CHAVES_OK = ("autonomia_padrao", "persona_versao", "reguas", "custos_fixos")
MODOS_OK = ("copiloto", "autonoma")
PORTAS_OK = ("janela", "utilidade", "marketing")
SLUG_RE = re.compile(r"^[a-z0-9_]{1,60}$")


def _valida_reguas(valor):
    """Valida o JSON de réguas. Devolve (valor_limpo, None) ou (None, erro)."""
    if not isinstance(valor, dict) or not valor or len(valor) > 30:
        return None, "reguas precisa ser um objeto {regua: [passos]} (1-30 réguas)"
    limpo = {}
    for nome, passos in valor.items():
        if not SLUG_RE.match(str(nome or "")):
            return None, f"nome de régua inválido: {nome!r} (a-z, 0-9, _)"
        if not isinstance(passos, list) or not passos or len(passos) > 30:
            return None, f"régua {nome}: precisa de 1-30 passos"
        ps = []
        for p in passos:
            if not isinstance(p, dict):
                return None, f"régua {nome}: passo precisa ser objeto"
            try:
                dias = float(p.get("dias"))
            except Exception:
                return None, f"régua {nome}: dias precisa ser número"
            if not (0 <= dias <= 365):
                return None, f"régua {nome}: dias fora de 0-365"
            porta = str(p.get("porta") or "").strip().lower()
            if porta not in PORTAS_OK:
                return None, f"régua {nome}: porta inválida ({porta!r})"
            intencao = str(p.get("intencao") or "").strip().lower()
            if not SLUG_RE.match(intencao):
                return None, f"régua {nome}: intenção inválida ({intencao!r})"
            ps.append({"dias": dias, "porta": porta, "intencao": intencao})
        limpo[str(nome)] = ps
    return limpo, None


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

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

        chave = str(body.get("chave") or "").strip()
        valor = body.get("valor")
        if chave not in CHAVES_OK:
            return self._send(400, {"ok": False, "error": f"chave inválida (permitidas: {', '.join(CHAVES_OK)})"})
        if not isinstance(valor, dict):
            return self._send(400, {"ok": False, "error": "valor precisa ser um objeto JSON"})

        # validação por chave
        if chave == "autonomia_padrao":
            modo = str(valor.get("modo") or "").strip().lower()
            if modo not in MODOS_OK:
                return self._send(400, {"ok": False, "error": f"modo inválido (permitidos: {', '.join(MODOS_OK)})"})
            valor = {"modo": modo}
        elif chave == "persona_versao":
            versao = str(valor.get("versao") or "").strip()
            if not versao or len(versao) > 80:
                return self._send(400, {"ok": False, "error": "versao obrigatória (até 80 chars)"})
            valor = {"versao": versao}
        elif chave == "reguas":
            valor, err = _valida_reguas(valor)
            if err:
                return self._send(400, {"ok": False, "error": err})
        elif chave == "custos_fixos":
            limpo = {}
            for campo in ("infra_mensal_brl", "elevenlabs_mensal_brl"):
                try:
                    v = float(valor.get(campo) or 0)
                except Exception:
                    return self._send(400, {"ok": False, "error": f"{campo} precisa ser número"})
                if not (0 <= v <= 100000):
                    return self._send(400, {"ok": False, "error": f"{campo} fora de 0-100000"})
                limpo[campo] = round(v, 2)
            valor = limpo

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        try:
            antes = sb.table("sol_config").select("valor").eq("chave", chave).limit(1).execute().data or []
            row = {
                "chave": chave,
                "valor": valor,
                "atualizado_em": datetime.now(timezone.utc).isoformat(),
            }
            sb.table("sol_config").upsert(row, on_conflict="chave").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "sol.config_update", target_type="sol_config", target_id=chave,
              before=(antes[0].get("valor") if antes else None), after=valor)
        return self._send(200, {"ok": True, "chave": chave, "valor": valor})
