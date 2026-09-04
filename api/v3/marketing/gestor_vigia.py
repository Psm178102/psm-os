# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/marketing/gestor_vigia — 🕵️ Vigia de Concorrência (v87.12)

Pedido do sócio (03/set): "quero que o agente me avise quando alguma atitude,
estratégia ou insight surgir após monitorar 24h os concorrentes".

O Vigia roda sozinho (heartbeat 2h + cron diário, dedupe por janela de 6h) e
analisa as últimas 24h com IA:
  - base viva de concorrentes (tabela concorrentes: 46 players, tier/segmento/bio)
  - mudanças na base nas últimas 24h (novos players, edições)
  - achados do Radar Incorporadoras na timeline (bônus, tabelas, comissões,
    campanhas — movimento REAL do mercado nas últimas 24h)
  - snapshots da Ad Library quando existirem
  - nossa própria posição (cache Meta 7d)

SÓ NOTIFICA quando a IA identifica algo ACIONÁVEL (alerta=true) — sem ruído
diário. O insight vira item tipo 'vigia' em gt_relatorios (aparece no Painel e
na aba 📜 Relatórios do Gestor de Tráfego) + sino/push pros sócios.

GET  ?cron=1        → roda se a janela de 6h virou (Bearer CRON_SECRET ou lvl>=7)
GET                 → { ok, last_run, insights } (lvl>=5)
POST {action:rodar} → força rodada agora (SÓ sócio lvl>=10)
Estado em shared_kv gt_vigia.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import json
import os
import sys
import urllib.parse
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import (require_user, AuthError, audit, supabase_client,  # type: ignore
                       lvl_of, notify, send_web_push)
from gestor import kv_get, kv_set  # type: ignore
from gestor_relatorio import _ia, KV_RELATORIOS  # type: ignore
from _meta_cache_lib import build_cache_key, read_cache  # type: ignore

KV_VIGIA = "gt_vigia"


def _slot(now):
    """Janela de 6h: 4 rodadas/dia no máximo (heartbeat chama a cada 2h)."""
    return f"{now.date().isoformat()}:{now.hour // 6}"


def _contexto(sb):
    parts = []
    agora = datetime.now(timezone.utc)
    h24 = (agora - timedelta(hours=24)).isoformat()

    # 1) Base viva de concorrentes
    try:
        cc = (sb.table("concorrentes")
              .select("nome,segmento,tier,tipo,seguidores,posts,bio,anuncios_count,ultima_atualizacao")
              .order("tier").limit(120).execute().data or [])
        if cc:
            parts.append("BASE DE CONCORRENTES MONITORADOS ({}):\n".format(len(cc)) + "\n".join(
                f"- [{c.get('tier')}] {c.get('nome')} ({c.get('segmento')}, {c.get('tipo')}): "
                f"{c.get('seguidores') or '?'} seg · {c.get('posts') or '?'} posts · "
                f"{c.get('anuncios_count') or 0} anúncios ativos"
                + (f" · bio: {str(c.get('bio'))[:90]}" if c.get('bio') else "")
                for c in cc))
            novos = [c for c in cc if str(c.get("ultima_atualizacao") or "") > h24]
            if novos:
                parts.append("MUDANÇAS NA BASE NAS ÚLTIMAS 24H:\n" + "\n".join(
                    f"- {c.get('nome')} ({c.get('segmento')}, tier {c.get('tier')})" for c in novos))
    except Exception:
        pass

    # 2) Radar Incorporadoras / timeline — o mercado se mexendo nas últimas 24h
    try:
        box = kv_get(sb, "timeline_recados", {})
        items = (box or {}).get("items") or []
        rec = [i for i in items if str(i.get("criado_em") or "") > h24]
        if rec:
            parts.append("MOVIMENTOS DO MERCADO NAS ÚLTIMAS 24H (Radar Incorporadoras/timeline):\n" + "\n".join(
                f"- [{i.get('autor')}] {str(i.get('texto'))[:220]}" for i in rec[:25]))
    except Exception:
        pass

    # 3) Snapshots Ad Library (quando o radar de anúncios estiver alimentado)
    try:
        snaps = (sb.table("ad_library_snapshots")
                 .select("concorrente,ads_count,nivel_invest,captured_at")
                 .gte("captured_at", h24).order("captured_at", desc=True).limit(30).execute().data or [])
        if snaps:
            parts.append("AD LIBRARY (snapshots 24h):\n" + "\n".join(
                f"- {s.get('concorrente')}: {s.get('ads_count')} anúncios · invest {s.get('nivel_invest')}"
                for s in snaps))
    except Exception:
        pass

    # 4) Nossa posição (contexto pra comparação)
    try:
        payload, _a, _s = read_cache(sb, build_cache_key("last_7d", "", ""), 10 ** 9)
        tot = ((payload or {}).get("totals") or {}).get("cur") or {}
        spend, res = float(tot.get("spend") or 0), int(tot.get("results") or 0)
        parts.append(f"NOSSA POSIÇÃO (7d): gasto R$ {spend:,.0f} · {res} leads"
                     + (" · ⚠️ CONTA CONQUISTA PAUSADA (sem entrega)" if spend == 0 else ""))
    except Exception:
        pass

    return "\n\n".join(parts)[:16000]


def _rodar(sb, forcado=False, actor_name="vigia"):
    now = datetime.now(timezone.utc)
    estado = kv_get(sb, KV_VIGIA, {})
    if not forcado and estado.get("last_slot") == _slot(now):
        return {"ok": True, "rodou": False, "motivo": "janela de 6h ainda não virou"}

    ctx = _contexto(sb)
    prompt = (
        "Você é o Sr. Gestor de Tráfego da PSM (São José do Rio Preto) em MODO VIGIA DE "
        "CONCORRÊNCIA. Analise APENAS as últimas 24h dos dados abaixo e decida se há "
        "algo ACIONÁVEL pros sócios: atitude nova de concorrente, estratégia detectável "
        "(padrão de oferta/copy/hook/formato), movimento de incorporadora que afeta nosso "
        "tráfego (bônus, tabela, comissão, campanha), janela de oportunidade ou ameaça. "
        "Seja EXIGENTE: rotina não é alerta — só avise se um sócio deveria PARAR e agir. "
        "Responda APENAS com JSON válido, sem markdown, neste formato: "
        '{"alerta": true|false, "titulo": "máx 70 chars", '
        '"insight": "análise interpretada em até 120 palavras, com o PORQUÊ", '
        '"acoes": ["1 a 3 ações concretas"]}'
        "\nSe nada relevante: {\"alerta\": false}.\n\n═══ DADOS (últimas 24h) ═══\n\n" + (ctx or "(sem dados)")
    )
    texto, provider, err = _ia(prompt)
    resultado = None
    if texto:
        try:
            limpo = texto.strip()
            if limpo.startswith("```"):
                limpo = limpo.strip("`").replace("json", "", 1).strip()
            resultado = json.loads(limpo)
        except Exception:
            resultado = None

    registro = {"ts": now.isoformat(), "slot": _slot(now), "forcado": forcado,
                "provider": provider, "erro": err,
                "alerta": bool(resultado and resultado.get("alerta"))}
    insights = estado.get("insights") or []

    if resultado and resultado.get("alerta"):
        titulo = str(resultado.get("titulo") or "Movimento de concorrência detectado")[:100]
        insight = str(resultado.get("insight") or "")[:2000]
        acoes = [str(a)[:200] for a in (resultado.get("acoes") or [])][:3]
        item_txt = ("🕵️ VIGIA DE CONCORRÊNCIA — " + titulo + "\n\n" + insight
                    + ("\n\n⚡ AÇÕES:\n" + "\n".join(f"• {a}" for a in acoes) if acoes else ""))
        insights.insert(0, {"ts": now.isoformat(), "titulo": titulo, "insight": insight, "acoes": acoes})
        # entra no fluxo de relatórios (Painel + aba 📜)
        try:
            box = kv_get(sb, KV_RELATORIOS, {"itens": []})
            itens = box.get("itens") or []
            itens.insert(0, {"id": "gtv_" + uuid.uuid4().hex[:10], "tipo": "vigia",
                             "periodo": "vigia:" + now.strftime("%Y-%m-%d %H:%M"),
                             "ts": now.isoformat(), "texto": item_txt,
                             "provider": provider, "gerado_por": actor_name})
            kv_set(sb, KV_RELATORIOS, {"itens": itens[:60]})
        except Exception:
            pass
        # sino + push pros sócios
        try:
            us = sb.table("users").select("id,role,status").execute().data or []
            socios = [u["id"] for u in us
                      if (u.get("status") or "ativo") == "ativo" and lvl_of((u.get("role") or "").lower()) >= 10]
            notify(socios, "gt_vigia", "🕵️ Vigia: " + titulo, body=insight[:180],
                   link="#/gestor-trafego?tab=relatorios", target_type="gt_vigia")
            send_web_push(socios, "🕵️ Vigia: " + titulo, body=insight[:180],
                          link="#/gestor-trafego?tab=relatorios", tag="gt_vigia")
        except Exception:
            pass

    kv_set(sb, KV_VIGIA, {"last_slot": _slot(now), "last_run": registro,
                          "insights": insights[:40]})
    return {"ok": True, "rodou": True, **registro}


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _cron_ok(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        secret = os.environ.get("CRON_SECRET") or ""
        return bool(secret) and tok == secret

    def do_GET(self):
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        if params.get("cron"):
            if not self._cron_ok():
                try:
                    require_user(self, min_lvl=7)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            return self._send(200, _rodar(sb))
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        estado = kv_get(sb, KV_VIGIA, {})
        return self._send(200, {"ok": True, "last_run": estado.get("last_run"),
                                "insights": (estado.get("insights") or [])[:20]})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        out = _rodar(sb, forcado=True, actor_name=actor.get("name") or "sócio")
        audit(self, actor, "gestor_trafego.vigia_manual", target_type="gt_vigia",
              notes=f"alerta={out.get('alerta')}")
        return self._send(200, out)
