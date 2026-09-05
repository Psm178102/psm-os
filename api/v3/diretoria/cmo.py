"""
GET  /api/v3/diretoria/cmo — relatórios do agente CMO (SÓ sócio, lvl>=10)
POST /api/v3/diretoria/cmo — registra relatório manualmente (sócio)
                              body: { tipo, texto, periodo? }

O agente CMO roda a rotina no PC Windows 24h (tarefas agendadas do app Claude)
e grava direto no shared_kv 'cmo_relatorios' via Supabase:
  { itens: [{ id, tipo: diario|semanal|mensal|trimestral, periodo, ts, texto,
              alerta: bool, gerado_por }] }
Este endpoint é a leitura oficial da aba Diretoria → CMO · Marketing.
Header: Authorization: Bearer <token>
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "cmo_relatorios"
ALLOWED_TIPO = {"diario", "semanal", "mensal", "trimestral"}
MAX_ITENS = 120


def _kv_get(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
    v = rows[0]["value"] if rows else {}
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            v = {}
    return v if isinstance(v, dict) else {}


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

    def do_GET(self):
        try:
            require_user(self, min_lvl=10)   # decisão do Paulo (04/set): SÓ sócio vê o CMO
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            sb = supabase_client()
            # v87.37: o cockpit mostra TODO o estado interno do CMO — relatórios,
            # Placar de Notas do Auditor, backlog ICE e Decision Log (4 chaves).
            extras = ["cmo_notas", "cmo_backlog", "cmo_decisoes", "cmo_depto_status"]
            rows = (sb.table("shared_kv").select("key,value")
                    .in_("key", [KV_KEY] + extras).execute().data or [])
            kv = {}
            for r in rows:
                v = r.get("value")
                if isinstance(v, str):
                    try:
                        v = json.loads(v)
                    except Exception:
                        v = {}
                kv[r.get("key")] = v if isinstance(v, dict) else {}

            def itens_de(key):
                out = [i for i in (kv.get(key, {}).get("itens") or []) if isinstance(i, dict)]
                out.sort(key=lambda i: str(i.get("ts") or ""), reverse=True)
                return out

            return self._send(200, {
                "ok": True,
                "relatorios": itens_de(KV_KEY),
                "notas": itens_de("cmo_notas"),
                "backlog": itens_de("cmo_backlog"),
                "decisoes": itens_de("cmo_decisoes"),
                # {slug: true} — sessões que criam agentes marcam aqui (SQL upsert),
                # e o cockpit acende a cadeira sem precisar de deploy.
                "depto_status": kv.get("cmo_depto_status", {}),
            })
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0) or 0)
            body = json.loads(raw or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        tipo = str(body.get("tipo") or "").strip().lower()
        texto = str(body.get("texto") or "").strip()
        if tipo not in ALLOWED_TIPO:
            return self._send(400, {"ok": False, "error": f"tipo deve ser um de {sorted(ALLOWED_TIPO)}"})
        if not texto or len(texto) > 40_000:
            return self._send(400, {"ok": False, "error": "texto obrigatório (máx 40k)"})
        try:
            sb = supabase_client()
            data = _kv_get(sb)
            itens = [i for i in (data.get("itens") or []) if isinstance(i, dict)]
            item = {
                "id": uuid.uuid4().hex[:12],
                "tipo": tipo,
                "periodo": str(body.get("periodo") or "").strip()[:40],
                "ts": datetime.now(timezone.utc).isoformat(),
                "texto": texto,
                "alerta": bool(body.get("alerta")),
                "gerado_por": actor.get("login") or actor.get("nome") or "manual",
            }
            itens.insert(0, item)
            itens.sort(key=lambda i: str(i.get("ts") or ""), reverse=True)
            sb.table("shared_kv").upsert({
                "key": KV_KEY,
                "value": {"itens": itens[:MAX_ITENS]},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            audit(self, actor, "cmo.relatorio_manual", target_type="cmo_relatorio", target_id=item["id"])
            return self._send(200, {"ok": True, "item": item})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
