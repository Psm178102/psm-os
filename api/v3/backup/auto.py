# -*- coding: utf-8 -*-
"""
GET /api/v3/backup/auto — 🛟 backup automático INTERNO (v84.90).

Nasceu do incidente de 22-23/07: a config do kanban de indicação foi perdida e
NÃO havia um único backup no Drive (o backup Google nunca foi configurado —
exige OAuth do Paulo). Este aqui não depende de credencial de usuário:
snapshot completo (mesmas tabelas do export manual + as novas) → gzip →
Storage do próprio Supabase (bucket privado 'backups', service key) →
rotação de 30 dias. Agendado no heartbeat (24h).

GET            → roda o backup (Bearer CRON_SECRET ou sócio lvl>=10)
GET ?status=1  → lista os backups existentes (lvl>=7)
Camada externa (Drive) continua existindo como opcional — este é o chão.
"""
from http.server import BaseHTTPRequestHandler
import gzip
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

BUCKET = "backups"
RETENCAO_DIAS = 30

TABELAS = [
    ("users", 5000, None), ("imoveis", 5000, None), ("lancamentos", 5000, None),
    ("locacoes", 5000, None), ("metas", 5000, None), ("deals", 5000, None),
    ("dir_tasks", 5000, None), ("eventos", 5000, None),
    ("audit_log", 2000, ("ts", "desc")),
    ("concorrentes", 5000, None), ("shared_kv", 5000, None),
    ("one_on_ones", 5000, None), ("plantoes", 5000, None),
    ("notifications", 1000, ("created_at", "desc")), ("comments", 5000, None),
    # v84.90 — tabelas que nasceram depois do export original:
    ("captacoes", 5000, None), ("indicacao_kanban", 6000, None),
    ("reativacao_kanban", 6000, None), ("recebiveis", 2000, None),
    ("leads_lp", 5000, None), ("gp_talentos", 2000, None),
    # rh_registros e cs_clientes moram no shared_kv (já coberto acima)
    ("producao_eventos", 5000, ("ts", "desc")),
]


def _storage_req(method, path, data=None, headers=None, timeout=30):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    h = {"Authorization": f"Bearer {key}", "apikey": key}
    h.update(headers or {})
    req = urllib.request.Request(f"{url}/storage/v1{path}", data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def _coletar(sb):
    dump = {"_meta": {"exported_at": datetime.now(timezone.utc).isoformat(),
                      "source": "PSM-OS auto-backup v84.90"}, "tables": {}}
    total, erros = 0, []
    for table, limit, order in TABELAS:
        try:
            q = sb.table(table).select("*").limit(limit)
            if order:
                q = q.order(order[0], desc=(order[1] == "desc"))
            rows = q.execute().data or []
            dump["tables"][table] = rows
            total += len(rows)
        except Exception as e:
            erros.append({"table": table, "error": str(e)[:150]})
            dump["tables"][table] = []
    dump["_meta"]["total_rows"] = total
    dump["_meta"]["errors"] = erros
    return dump, total, erros


def _listar():
    body = json.dumps({"prefix": "", "limit": 200,
                       "sortBy": {"column": "name", "order": "desc"}}).encode()
    st, raw = _storage_req("POST", f"/object/list/{BUCKET}", data=body,
                           headers={"Content-Type": "application/json"})
    return json.loads(raw.decode() or "[]") if st == 200 else []


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

    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))

        if q.get("status") == "1":
            try:
                require_user(self, min_lvl=7)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
            try:
                arqs = _listar()
                return self._send(200, {"ok": True, "backups": [
                    {"nome": a.get("name"),
                     "bytes": ((a.get("metadata") or {}).get("size")),
                     "criado": a.get("created_at")} for a in arqs
                    if str(a.get("name") or "").startswith("psm_os_auto_")]})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:200]})

        actor = None
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):
            try:
                actor = require_user(self, min_lvl=10)
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        dump, total, erros = _coletar(sb)
        if total < 100:   # lição da semana: snapshot suspeito NÃO substitui nada
            return self._send(500, {"ok": False, "error": f"coleta suspeita ({total} linhas) — backup abortado", "erros": erros})
        raw = gzip.compress(json.dumps(dump, ensure_ascii=False, default=str).encode("utf-8"))
        nome = "psm_os_auto_" + datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M") + ".json.gz"
        try:
            st, _ = _storage_req("POST", f"/object/{BUCKET}/{nome}", data=raw,
                                 headers={"Content-Type": "application/gzip", "x-upsert": "true"},
                                 timeout=60)
            if st not in (200, 201):
                return self._send(502, {"ok": False, "error": f"upload storage: HTTP {st}"})
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"upload: {str(e)[:180]}"})

        # rotação: apaga automáticos com mais de RETENCAO_DIAS
        apagados = 0
        try:
            corte = (datetime.now(timezone.utc) - timedelta(days=RETENCAO_DIAS)).strftime("%Y-%m-%d")
            for a in _listar():
                n = str(a.get("name") or "")
                if n.startswith("psm_os_auto_") and n[12:22] < corte:
                    try:
                        _storage_req("DELETE", f"/object/{BUCKET}/{n}")
                        apagados += 1
                    except Exception:
                        pass
        except Exception:
            pass
        audit(self, actor, "backup.auto", target_type="storage", target_id=nome,
              notes=f"{total} linhas · {len(raw)} bytes gz · {len(erros)} erro(s) · rotacao -{apagados}")
        return self._send(200, {"ok": True, "arquivo": nome, "linhas": total,
                                "bytes_gz": len(raw), "erros": erros, "rotacao_apagados": apagados})
