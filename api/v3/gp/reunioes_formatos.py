# -*- coding: utf-8 -*-
"""
/api/v3/gp/reunioes_formatos — 📋 Formatos de Reunião (rotina v2.3). v84.99

Regras universais: toda reunião tem DONO, PAUTA FIXA e PAINEL ABERTO; ata de 3
linhas no ato; pendência sem dono+prazo não existe; sem painel/pauta = cancelada.

GET  (logado)              → formatos + atas recentes + pendências abertas + carga semanal
POST {action:"ata", formato_id, decisoes, pendencias:[{txt,dono,prazo}]}  (lvl>=5)
POST {action:"baixar_pendencia", ata_id, idx}                             (lvl>=5)
POST {action:"set_formato", formato:{...}} · {action:"del_formato", id}   (lvl>=8)
GET  ?lembretes=1 (CRON_SECRET ou lvl>=7) → dispara lembretes por alçada dos
     formatos cujo horário está chegando (janela 30min; dedupe por dia em kv).
Dados: shared_kv reunioes_formatos {formatos:[...]} · reunioes_atas {atas:[...]}
       · reunioes_lembretes_state {formato_id: "YYYY-MM-DD"}.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, lvl_of  # type: ignore

BRT = timezone(timedelta(hours=-3))
KV_F, KV_A, KV_S = "reunioes_formatos", "reunioes_atas", "reunioes_lembretes_state"

# cadencia: semanal {dias:[0..4]} · quinzenal {dia, ref: data-âncora ISO} ·
# mensal_nth {nth:1, dia:3=quinta} · mensal_ultima {dia}
SEED_FORMATOS = [
    {"id": "placar_segunda", "emoji": "📊", "nome": "Placar de Segunda (Estratégia)", "dono": "Paulo",
     "participantes": ["paulo", "isa"], "cadencia": {"tipo": "semanal", "dias": [0]}, "hora": "08:00", "dur_min": 15,
     "painel": "#/estrategia", "painel_nome": "Real vs Plano (card Amortecedor)",
     "pauta": ["Amortecedor da semana", "Conquista vs R$625k/sem", "Próprio vs necessário", "Rafaela vs gates", "Decisões da semana"]},
    {"id": "daily_conquista", "emoji": "🏃", "nome": "Daily Comercial Conquista", "dono": "Kaue",
     "participantes": ["kaue"], "papeis": ["corretor_conquista"], "cadencia": {"tipo": "semanal", "dias": [0, 1, 2, 3, 4]}, "hora": "09:00", "dur_min": 15,
     "painel": "#/crm", "painel_nome": "Comercial/CRM",
     "pauta": ["Números de ontem", "Foco do dia (atividade, não só venda)", "Travas", "Ranking"]},
    {"id": "semanal_map", "emoji": "♟️", "nome": "Semanal Comercial MAP", "dono": "Paulo",
     "participantes": ["paulo", "isa", "rafaela"], "cadencia": {"tipo": "semanal", "dias": [0]}, "hora": "09:00", "dur_min": 30,
     "painel": "#/fiscalizacao", "painel_nome": "Pipeline MAP + card Rafaela",
     "pauta": ["Pipeline próprio negócio a negócio", "Fila da Ponte da semana", "Agendamentos Rafaela", "Follow-ups críticos"]},
    {"id": "semanal_financeiro", "emoji": "💰", "nome": "Semanal Financeiro", "dono": "Paulo",
     "participantes": ["paulo", "leire"], "cadencia": {"tipo": "semanal", "dias": [2]}, "hora": "17:00", "dur_min": 30,
     "painel": "#/estrategia", "painel_nome": "Radar de Recebíveis + contas",
     "pauta": ["Recebíveis D-3/travados (nota, assinatura)", "Contas a pagar 7 dias", "Caixa da semana", "Pendências do refi/crédito"]},
    {"id": "semanal_marketing", "emoji": "📣", "nome": "Semanal Marketing", "dono": "Isa",
     "participantes": ["isa"], "cadencia": {"tipo": "semanal", "dias": [1]}, "hora": "17:00", "dur_min": 30,
     "painel": "#/marketing", "painel_nome": "Semáforo de ads + leads LP",
     "pauta": ["ROAS por conta/frente", "CAC por faixa da LP", "Criativos da semana", "SLA de resposta a lead (5min)"]},
    {"id": "quinzenal_adm", "emoji": "🗂️", "nome": "Quinzenal ADM/Operações", "dono": "Isa",
     "participantes": ["isa", "leire", "mariane"], "cadencia": {"tipo": "quinzenal", "dia": 4, "ref": "2026-08-07"}, "hora": "16:00", "dur_min": 30,
     "painel": "#/fiscalizacao", "painel_nome": "Fiscalização",
     "pauta": ["SLAs de docs", "NPS/CS e indicações", "Reativação", "Processos travados"]},
    {"id": "quinzenal_diretoria", "emoji": "🏛️", "nome": "Quinzenal Diretoria", "dono": "Paulo",
     "participantes": ["paulo", "isa"], "obs": "Kaue na 1ª do mês", "cadencia": {"tipo": "quinzenal", "dia": 3, "ref": "2026-08-06"}, "hora": "17:00", "dur_min": 45,
     "painel": "#/estrategia", "painel_nome": "Checklist do plano v2.3",
     "pauta": ["Gates do mês", "Academy", "Pessoas (contratar/cortar/promover)", "Decisões estruturais (ponto, crédito, Line Imper)", "Riscos"]},
    {"id": "mensal_rh", "emoji": "👥", "nome": "Mensal RH & Gestão de Pessoas", "dono": "Paulo",
     "participantes": ["paulo", "isa", "kaue"], "cadencia": {"tipo": "mensal_nth", "nth": 1, "dia": 3}, "hora": "10:00", "dur_min": 60,
     "painel": "#/fiscalizacao", "painel_nome": "Fiscalização + ATS",
     "pauta": ["Metas individuais vs real (todos)", "Gates Rafaela 30/60/90", "Funil da Academy", "Feedbacks coletados pela Mariane", "Decisões de gente"]},
    {"id": "mensal_juridico", "emoji": "⚖️", "nome": "Mensal Jurídico", "dono": "Paulo",
     "participantes": ["paulo"], "obs": "contábil/advogado externos; ou sob demanda", "cadencia": {"tipo": "mensal_ultima", "dia": 2}, "hora": "16:00", "dur_min": 30,
     "painel": "#/juridico", "painel_nome": "Pendências jurídicas",
     "pauta": ["Contratos vigentes (Georgina — marco 1 ano em out)", "Contratos incorporadoras", "Distratos", "Garantia real Itaú", "Trabalhista"]},
    {"id": "mensal_geral", "emoji": "🏢", "nome": "Mensal Geral (todos juntos)", "dono": "Paulo",
     "participantes": ["paulo", "isa"], "papeis": ["*"], "cadencia": {"tipo": "mensal_nth", "nth": 1, "dia": 0}, "hora": "08:30", "dur_min": 45,
     "painel": "#/", "painel_nome": "Placar público do mês",
     "pauta": ["Resultado do mês vs meta (transparência)", "Reconhecimento (Conquista + MAP + apoio)", "Comunicados (transição Rafaela, Academy)", "Metas do mês que abre"]},
]


def _kv(sb, key, default):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        return (v, True) if isinstance(v, dict) else (default, True) if rows == [] or v is None else (default, True)
    except Exception:
        return default, False


def _kv_set(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _hoje_bate(f, now):
    """O formato acontece HOJE? (BRT)"""
    c = f.get("cadencia") or {}
    wd = now.weekday()
    t = c.get("tipo")
    if t == "semanal":
        return wd in (c.get("dias") or [])
    if t == "quinzenal":
        if wd != c.get("dia"):
            return False
        try:
            ref = datetime.fromisoformat(c.get("ref")).date()
            return ((now.date() - ref).days // 7) % 2 == 0
        except Exception:
            return False
    if t == "mensal_nth":
        return wd == c.get("dia") and (now.day - 1) // 7 + 1 == int(c.get("nth") or 1)
    if t == "mensal_ultima":
        import calendar
        return wd == c.get("dia") and now.day > calendar.monthrange(now.year, now.month)[1] - 7
    return False


def _resolver_ids(sb, f):
    """participantes (user_match por nome) + papeis → user ids, por alçada."""
    try:
        us = sb.table("users").select("id,name,role,status").execute().data or []
    except Exception:
        return []
    ativos = [u for u in us if (u.get("status") or "ativo") == "ativo"]
    ids = set()
    for m in (f.get("participantes") or []):
        for u in ativos:
            if m.lower() in (u.get("name") or "").lower():
                ids.add(u["id"])
    for p in (f.get("papeis") or []):
        for u in ativos:
            if p == "*" or (u.get("role") or "") == p:
                ids.add(u["id"])
    return list(ids)


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        if q.get("lembretes") == "1":
            auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
            cron = os.environ.get("CRON_SECRET", "").strip()
            if not (cron and auth_hdr == cron):
                try:
                    require_user(self, min_lvl=7)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            fkv, leu = _kv(sb, KV_F, {"formatos": SEED_FORMATOS})
            state, leu2 = _kv(sb, KV_S, {})
            if not (leu and leu2):
                return self._send(200, {"ok": False, "skip": "kv indisponível"})
            now = datetime.now(BRT)
            hoje = now.strftime("%Y-%m-%d")
            disparados = []
            for f in fkv.get("formatos") or []:
                if state.get(f["id"]) == hoje or not _hoje_bate(f, now):
                    continue
                try:
                    hh, mm = (f.get("hora") or "08:00").split(":")
                    alvo = now.replace(hour=int(hh), minute=int(mm), second=0)
                except Exception:
                    continue
                # janela: 30min antes até a hora marcada
                if not (alvo - timedelta(minutes=30) <= now <= alvo + timedelta(minutes=5)):
                    continue
                ids = _resolver_ids(sb, f)
                if ids:
                    notify(ids, "reuniao", f"{f.get('emoji', '📋')} {f['nome']} às {f.get('hora')} ({f.get('dur_min')}min)",
                           f"Dono: {f.get('dono')} · Painel: {f.get('painel_nome')} · Pauta: " + " · ".join((f.get("pauta") or [])[:3]) + "…",
                           link="#/rh-reunioes", target_type="reuniao", target_id=f["id"])
                state[f["id"]] = hoje
                disparados.append(f["id"])
            if disparados:
                _kv_set(sb, KV_S, state)
            return self._send(200, {"ok": True, "disparados": disparados})

        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        fkv, leu = _kv(sb, KV_F, None)
        if fkv is None or not (fkv.get("formatos")):
            fkv = {"formatos": json.loads(json.dumps(SEED_FORMATOS))}
            if leu:
                try:
                    _kv_set(sb, KV_F, fkv)
                except Exception:
                    pass
        akv, _ = _kv(sb, KV_A, {"atas": []})
        atas = (akv.get("atas") or [])[:120]
        pend = []
        for a in atas:
            for i, p in enumerate(a.get("pendencias") or []):
                if not p.get("feito"):
                    pend.append({"ata_id": a["id"], "idx": i, "formato_id": a.get("formato_id"),
                                 "txt": p.get("txt"), "dono": p.get("dono"), "prazo": p.get("prazo"),
                                 "reuniao_ts": a.get("ts")})
        return self._send(200, {"ok": True, "formatos": fkv.get("formatos"), "atas": atas[:40],
                                "pendencias_abertas": pend,
                                "pode_editar": (user.get("lvl") or 0) >= 8,
                                "pode_ata": (user.get("lvl") or 0) >= 5})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8") or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = body.get("action")
        now = datetime.now(timezone.utc)

        if action == "ata":
            akv, leu = _kv(sb, KV_A, {"atas": []})
            if not leu:
                return self._send(503, {"ok": False, "error": "kv indisponível — tente de novo"})
            pends = []
            for p in (body.get("pendencias") or [])[:20]:
                txt = str((p or {}).get("txt") or "").strip()[:300]
                dono = str((p or {}).get("dono") or "").strip()[:60]
                prazo = str((p or {}).get("prazo") or "").strip()[:10]
                if txt and not (dono and prazo):
                    return self._send(422, {"ok": False, "error": f"pendência sem dono+prazo não existe: '{txt[:40]}…'"})
                if txt:
                    pends.append({"txt": txt, "dono": dono, "prazo": prazo, "feito": False})
            ata = {"id": "ata_" + uuid.uuid4().hex[:10], "formato_id": str(body.get("formato_id") or "")[:60],
                   "ts": now.isoformat(), "por": user.get("name"),
                   "decisoes": str(body.get("decisoes") or "").strip()[:2000], "pendencias": pends}
            akv.setdefault("atas", []).insert(0, ata)
            akv["atas"] = akv["atas"][:300]
            _kv_set(sb, KV_A, akv)
            audit(self, user, "reuniao.ata", "shared_kv", KV_A, notes=f"{ata['formato_id']} · {len(pends)} pendência(s)")
            return self._send(200, {"ok": True, "ata": ata})

        if action == "baixar_pendencia":
            akv, leu = _kv(sb, KV_A, {"atas": []})
            if not leu:
                return self._send(503, {"ok": False, "error": "kv indisponível"})
            for a in akv.get("atas") or []:
                if a.get("id") == body.get("ata_id"):
                    try:
                        p = a["pendencias"][int(body.get("idx"))]
                        p["feito"] = {"por": user.get("name"), "ts": now.isoformat()}
                    except Exception:
                        return self._send(404, {"ok": False, "error": "pendência não encontrada"})
                    _kv_set(sb, KV_A, akv)
                    audit(self, user, "reuniao.pendencia_baixada", "shared_kv", KV_A, notes=str(p.get("txt"))[:80])
                    return self._send(200, {"ok": True})
            return self._send(404, {"ok": False, "error": "ata não encontrada"})

        if action in ("set_formato", "del_formato"):
            if (user.get("lvl") or 0) < 8:
                return self._send(403, {"ok": False, "error": "editar formatos é da diretoria (lvl>=8)"})
            fkv, leu = _kv(sb, KV_F, {"formatos": json.loads(json.dumps(SEED_FORMATOS))})
            if not leu:
                return self._send(503, {"ok": False, "error": "kv indisponível"})
            if action == "del_formato":
                fid = str(body.get("id") or "")
                fkv["formatos"] = [f for f in fkv.get("formatos") or [] if f.get("id") != fid]
            else:
                f = body.get("formato")
                if not isinstance(f, dict) or not f.get("nome"):
                    return self._send(422, {"ok": False, "error": "formato inválido"})
                f["id"] = str(f.get("id") or "fmt_" + uuid.uuid4().hex[:8])[:60]
                lst = fkv.setdefault("formatos", [])
                for i, x in enumerate(lst):
                    if x.get("id") == f["id"]:
                        lst[i] = f
                        break
                else:
                    lst.append(f)
            _kv_set(sb, KV_F, fkv)
            audit(self, user, "reuniao." + action, "shared_kv", KV_F)
            return self._send(200, {"ok": True, "formatos": fkv.get("formatos")})

        return self._send(400, {"ok": False, "error": "action inválida"})
