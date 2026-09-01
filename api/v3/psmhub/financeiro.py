# -*- coding: utf-8 -*-
"""
GET /api/v3/psmhub/financeiro — 💵 FINANCEIRO do PSM HUB pela ponte. v84.97 → v86.89

O Hub (Equipe Conquista) ganhou módulo financeiro; o Paulo quer esses dados
dentro do Financeiro do House. v84.97 cobria só a página de vendas/comissões
(GET /api/financeiro + /api/sales/vendors).

v86.89: o Hub ganhou MAIS páginas de financeiro (mapeadas ao vivo em 01/set):
Painel Geral, Painel de Acompanhamento (centro de custo), Contas a Pagar/
Receber, Recorrências, Conciliação, DRE e Viabilidade. Cada uma vira uma
`?secao=` aqui, buscando os MESMOS endpoints que a tela do Hub chama.
Cada endpoint é best-effort: um 403 num deles não derruba a seção — a
resposta traz `endpoints` com o status de cada um (ok/sem_permissao/erro),
pra ficar visível o que falta liberar pro usuário de serviço no Hub.

Auth: lvl>=7 (mesma alçada do restante da ponte). Login do serviço via
_psmhub_lib (credencial SÓ no Vercel). Cache 10min em shared_kv por
seção+período — ?nocache=1 força ao vivo.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.error
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
import _psmhub_lib as hub  # type: ignore

KV_CACHE = "psmhub_financeiro_cache"   # cache legado da seção comissoes (mantido)
TTL_S = 600

# Endpoints do Hub por seção — espelham o que cada página /financeiro/* chama.
# {ano}/{mes} são substituídos pelos parâmetros da query.
SECOES = {
    "painel": {
        "config":            "/api/painel/config",
        "contas_bancarias":  "/api/financial-accounts",
        "grupos_cc":         "/api/cost-centers/groups",
        "centros_custo":     "/api/biz-cost-centers",
        "realizado":         "/api/cost-centers/realized?year={ano}",
    },
    "acompanhamento": {
        "orcado":            "/api/cost-centers/budget?year={ano}",
        "realizado":         "/api/cost-centers/realized?year={ano}",
        "grupos_cc":         "/api/cost-centers/groups",
    },
    "contas": {
        "lancamentos":       "/api/financial-entries?basis=competencia",
        "faturas_cartao":    "/api/card-invoices?",
        "contas_bancarias":  "/api/financial-accounts",
        "centros_custo":     "/api/biz-cost-centers",
    },
    "recorrencias": {
        "recorrencias":      "/api/financial-recurrences",
        "faltantes":         "/api/financial-recurrences/faltantes",
    },
    "conciliacao": {
        "conciliacao":       "/api/financeiro/conciliacao-comissoes?ano={ano}",
        "vinculos_sugeridos": "/api/financeiro/vinculos-sugeridos?limite=200",
        "prazo_recebimento": "/api/financeiro/prazo-recebimento?ano={ano}",
    },
    "dre": {
        "realizado":         "/api/cost-centers/realized?year={ano}&basis=competencia",
        "grupos_cc":         "/api/cost-centers/groups",
        "centros_custo":     "/api/biz-cost-centers",
    },
    "viabilidade": {
        "resumo_vendas":     "/api/viabilidade/sales-summary?year={ano}&month={mes}",
        "config":            "/api/viabilidade/config",
    },
}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    # cache compartilhado (financeiro não muda a cada segundo; poupa o Hub)
    def _cache_get(self, sb, key):
        try:
            rows = sb.table("shared_kv").select("value,updated_at").eq("key", key).limit(1).execute().data or []
            if rows:
                v = rows[0].get("value") or {}
                ts = v.get("_cached_at")
                if ts:
                    idade = (datetime.now(timezone.utc) - datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).total_seconds()
                    if idade < TTL_S:
                        v["cache"] = {"hit": True, "age_s": int(idade)}
                        return v
        except Exception:
            pass
        return None

    def _cache_put(self, sb, key, out):
        try:
            sb.table("shared_kv").upsert({"key": key, "value": out,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception:
            pass

    def do_GET(self):
        try:
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        if not hub.configured():
            return self._send(503, {"ok": False, "error": "ponte PSM HUB sem credenciais (PSMHUB_EMAIL/PASSWORD no Vercel)"})
        sb = supabase_client()
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        nocache = q.get("nocache") == "1"
        secao = (q.get("secao") or "comissoes").strip().lower()
        agora = datetime.now(timezone.utc)
        ano = q.get("ano") or str(agora.year)
        mes = q.get("mes") or str(agora.month)

        # ── seção legada: vendas/comissões (comportamento v84.97 intacto) ──
        if secao == "comissoes":
            if sb and not nocache:
                hit = self._cache_get(sb, KV_CACHE)
                if hit:
                    return self._send(200, hit)
            out = {"ok": True, "_cached_at": agora.isoformat()}
            try:
                out["financeiro"] = hub.get("/api/financeiro")
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    return self._send(200, {"ok": False, "sem_permissao": True,
                                            "error": "O usuário de serviço da ponte não tem a permissão 'Financeiro' no PSM HUB. "
                                                     "Abra o Hub → Configurações → permissões do usuário integracao@ e libere o menu Financeiro."})
                return self._send(502, {"ok": False, "error": f"Hub respondeu HTTP {e.code} em /api/financeiro"})
            except Exception as e:
                return self._send(502, {"ok": False, "error": f"ponte: {str(e)[:180]}"})
            try:
                out["vendors"] = hub.get("/api/sales/vendors")
            except Exception:
                out["vendors"] = None   # best-effort (a tela do Hub usa pra nomes)
            if sb:
                self._cache_put(sb, KV_CACHE, out)
            out["cache"] = {"hit": False}
            return self._send(200, out)

        # ── seções novas (v86.89) ──
        if secao not in SECOES:
            return self._send(400, {"ok": False, "error": "secao inválida (use: comissoes, " + ", ".join(sorted(SECOES)) + ")"})

        kv_key = f"psmhub_fin_{secao}_{ano}" + (f"_{mes}" if secao == "viabilidade" else "")
        if sb and not nocache:
            hit = self._cache_get(sb, kv_key)
            if hit:
                return self._send(200, hit)

        out = {"ok": True, "secao": secao, "ano": ano, "_cached_at": agora.isoformat(),
               "dados": {}, "endpoints": {}}
        algum_ok = False
        for nome, tpl in SECOES[secao].items():
            path = tpl.format(ano=ano, mes=mes)
            try:
                out["dados"][nome] = hub.get(path)
                out["endpoints"][nome] = {"path": path, "status": "ok"}
                algum_ok = True
            except urllib.error.HTTPError as e:
                st = "sem_permissao" if e.code in (401, 403) else f"http_{e.code}"
                out["dados"][nome] = None
                out["endpoints"][nome] = {"path": path, "status": st}
            except Exception as e:
                out["dados"][nome] = None
                out["endpoints"][nome] = {"path": path, "status": "erro", "detalhe": str(e)[:120]}

        if not algum_ok:
            # nada veio — quase sempre é permissão do usuário de serviço no Hub
            todos_perm = all(v.get("status") == "sem_permissao" for v in out["endpoints"].values())
            out["ok"] = False
            out["sem_permissao"] = todos_perm
            out["error"] = ("O usuário de serviço integracao@ não tem acesso às páginas novas do Financeiro no Hub. "
                            "Abra o Hub → Configurações → permissões do usuário integracao@ e libere os menus do Financeiro."
                            if todos_perm else "nenhum endpoint do Hub respondeu — ver detalhes em endpoints")
            return self._send(200, out)

        if sb:
            self._cache_put(sb, kv_key, out)
        out["cache"] = {"hit": False}
        return self._send(200, out)
