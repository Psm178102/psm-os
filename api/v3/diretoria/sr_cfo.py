"""
GET/POST /api/v3/diretoria/sr_cfo — 🧠 SR. CFO (agente financeiro da holding). v87.31

O Sr. CFO roda como agente Claude no PC Windows 24h (kit MIGRACAO-WINDOWS) e
publica aqui o que os SÓCIOS precisam ver: dossiês financeiros (fechamento,
auditoria, fluxo 13 semanas), radar de riscos 🔴🟡🔵, diário de decisões
(premissa → veredito em R$) e pendências aguardando o sócio.

Dossiês vivem no shared_kv 'diretoria_dossies' (o MESMO kv onde o agente CEO
já publica o Estado da União — esta página é a primeira a renderizá-lo);
o resto em kvs próprios: sr_cfo_radar · sr_cfo_diario · sr_cfo_pendencias.

GET  (lvl>=10) → { ok, dossies, radar, diario, pendencias }
     ?autor=CFO (default) · ?autor=todos devolve dossiês de todos os agentes
POST (lvl>=10 OU Bearer CRON_SECRET — via de ingest da rotina do Windows):
     action=publicar_dossie {id?, tipo, titulo, manchete, corpo_md, fontes?}
     action=set_radar {itens:[{nivel:'vermelho'|'amarelo'|'azul', titulo, detalhe, prazo?}]}
     action=add_diario {decisao, premissa, resultado_esperado, revisao_em?}
     action=classificar_diario {id, veredito:'acerto'|'erro'|'cedo', delta_reais?, licao?}
     action=add_pendencia {titulo, detalhe?} · action=resolver_pendencia {id}
Auth: SÓ sócio (lvl>=10). Nada daqui vai pra timeline/push broadcast.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all, lvl_of  # type: ignore

KV_DOSSIES = "diretoria_dossies"
KV_RADAR = "sr_cfo_radar"
KV_DIARIO = "sr_cfo_diario"
KV_PEND = "sr_cfo_pendencias"
MAX_DOSSIES = 40
NIVEIS = ("vermelho", "amarelo", "azul")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _kv_get(sb, key, default=None):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        return rows[0]["value"] if rows else default
    except Exception:
        return default


def _kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value,
                                  "updated_at": _now()}, on_conflict="key").execute()


def _notify_socios(sb, title, body, link="#/sr-cfo"):
    try:
        users = sb.table("users").select("id,role,status").execute().data or []
        alvo = [u["id"] for u in users if u.get("id") and (u.get("status") or "ativo") == "ativo"
                and lvl_of(u.get("role")) >= 10]
        if alvo:
            notify_all(alvo, "fiscalizacao", title, body=(body or "")[:400], link=link)
    except Exception:
        pass


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def _auth(self, allow_cron=False):
        """Sócio (lvl>=10). Com allow_cron, Bearer CRON_SECRET também passa (rotina do Windows)."""
        if allow_cron:
            auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
            cron = os.environ.get("CRON_SECRET", "").strip()
            if cron and auth_hdr == cron:
                return {"id": None, "nome": "Sr. CFO (rotina)", "cron": True}
        return require_user(self, min_lvl=10)

    def do_GET(self):
        try:
            self._auth()
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        autor = (q.get("autor", ["CFO"])[0] or "CFO").strip()
        dossies = (_kv_get(sb, KV_DOSSIES, {}) or {}).get("items", [])
        if autor.lower() != "todos":
            dossies = [d for d in dossies if (d.get("autor") or "").upper() == autor.upper()]
        return self._send(200, {
            "ok": True,
            "dossies": dossies[:20],
            "total_dossies": len(dossies),
            "radar": _kv_get(sb, KV_RADAR, {"itens": [], "atualizado_em": None}),
            "diario": (_kv_get(sb, KV_DIARIO, {}) or {}).get("items", []),
            "pendencias": (_kv_get(sb, KV_PEND, {}) or {}).get("items", []),
        })

    def do_POST(self):
        try:
            user = self._auth(allow_cron=True)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "json inválido"})
        action = (body.get("action") or "").strip()
        quem = user.get("nome") or "sócio"

        if action == "publicar_dossie":
            titulo = (body.get("titulo") or "").strip()
            corpo = (body.get("corpo_md") or "").strip()
            if not titulo or not corpo:
                return self._send(400, {"ok": False, "error": "titulo e corpo_md obrigatórios"})
            wrap = _kv_get(sb, KV_DOSSIES, {}) or {}
            items = wrap.get("items", [])
            did = (body.get("id") or f"cfo_{datetime.now(timezone.utc):%Y-%m-%d}_{uuid.uuid4().hex[:6]}").strip()
            novo = {"id": did, "tipo": (body.get("tipo") or "relatorio").strip(),
                    "titulo": titulo, "manchete": (body.get("manchete") or "").strip(),
                    "corpo_md": corpo, "autor": "CFO", "criado_em": _now(),
                    "fontes": body.get("fontes") or []}
            # mesmo id = atualiza no lugar (a rotina pode republicar o dossiê do dia)
            items = [novo] + [d for d in items if d.get("id") != did]
            _kv_set(sb, KV_DOSSIES, {**wrap, "items": items[:MAX_DOSSIES]})
            _notify_socios(sb, "🧠 Sr. CFO: novo dossiê", titulo)
            return self._send(200, {"ok": True, "id": did})

        if action == "set_radar":
            itens = body.get("itens")
            if not isinstance(itens, list):
                return self._send(400, {"ok": False, "error": "itens deve ser lista"})
            itens = [{"nivel": i.get("nivel") if i.get("nivel") in NIVEIS else "azul",
                      "titulo": (i.get("titulo") or "").strip(),
                      "detalhe": (i.get("detalhe") or "").strip(),
                      "prazo": (i.get("prazo") or "").strip()} for i in itens if i.get("titulo")]
            _kv_set(sb, KV_RADAR, {"itens": itens, "atualizado_em": _now(), "por": quem})
            quentes = [i for i in itens if i["nivel"] == "vermelho"]
            if quentes:
                _notify_socios(sb, "🔴 Sr. CFO: risco existencial no radar", quentes[0]["titulo"])
            return self._send(200, {"ok": True, "n": len(itens)})

        if action == "add_diario":
            decisao = (body.get("decisao") or "").strip()
            if not decisao:
                return self._send(400, {"ok": False, "error": "decisao obrigatória"})
            wrap = _kv_get(sb, KV_DIARIO, {}) or {}
            items = wrap.get("items", [])
            novo = {"id": uuid.uuid4().hex[:10], "decisao": decisao,
                    "premissa": (body.get("premissa") or "").strip(),
                    "resultado_esperado": (body.get("resultado_esperado") or "").strip(),
                    "revisao_em": (body.get("revisao_em") or "").strip(),
                    "criado_em": _now(), "veredito": None, "delta_reais": None, "licao": None}
            _kv_set(sb, KV_DIARIO, {"items": ([novo] + items)[:200]})
            return self._send(200, {"ok": True, "id": novo["id"]})

        if action == "classificar_diario":
            wrap = _kv_get(sb, KV_DIARIO, {}) or {}
            items = wrap.get("items", [])
            alvo = next((d for d in items if d.get("id") == body.get("id")), None)
            if not alvo:
                return self._send(404, {"ok": False, "error": "decisão não encontrada"})
            if body.get("veredito") in ("acerto", "erro", "cedo"):
                alvo["veredito"] = body["veredito"]
            if body.get("delta_reais") is not None:
                try:
                    alvo["delta_reais"] = float(body["delta_reais"])
                except (TypeError, ValueError):
                    pass
            if body.get("licao"):
                alvo["licao"] = str(body["licao"]).strip()
            alvo["classificado_em"] = _now()
            _kv_set(sb, KV_DIARIO, {"items": items})
            return self._send(200, {"ok": True})

        if action == "add_pendencia":
            titulo = (body.get("titulo") or "").strip()
            if not titulo:
                return self._send(400, {"ok": False, "error": "titulo obrigatório"})
            wrap = _kv_get(sb, KV_PEND, {}) or {}
            items = wrap.get("items", [])
            items = [{"id": uuid.uuid4().hex[:10], "titulo": titulo,
                      "detalhe": (body.get("detalhe") or "").strip(),
                      "criado_em": _now(), "resolvida": False}] + items
            _kv_set(sb, KV_PEND, {"items": items[:100]})
            return self._send(200, {"ok": True})

        if action == "resolver_pendencia":
            wrap = _kv_get(sb, KV_PEND, {}) or {}
            items = wrap.get("items", [])
            alvo = next((p for p in items if p.get("id") == body.get("id")), None)
            if not alvo:
                return self._send(404, {"ok": False, "error": "pendência não encontrada"})
            alvo["resolvida"] = True; alvo["resolvida_em"] = _now(); alvo["por"] = quem
            _kv_set(sb, KV_PEND, {"items": items})
            if user.get("id"):
                audit(self, user, "sr_cfo_pendencia_resolvida", target_type="shared_kv", target_id=KV_PEND)
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": f"action desconhecida: {action}"})
