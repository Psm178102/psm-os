"""
POST /api/v3/tasks/upsert
Body: { id?, titulo, descricao?, status?, prioridade?, categoria?,
        responsavel?, prazo?, inicio?, observacoes? }
Header: Authorization: Bearer <token>

- Sem id → cria nova (qualquer autenticado, criado_por = user logado)
- Com id existente:
  * Sócio (lvl>=10): pode atualizar QUALQUER campo de qualquer tarefa
  * Responsável da tarefa OU criador: pode atualizar status/observacoes/historico
  * Outros: 403

Adiciona entry no historico jsonb a cada update.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, notify_all  # type: ignore


def _safe_write(build, row):
    """Executa insert/update tolerante: se uma coluna não existe no banco
    (PGRST204), remove essa coluna e tenta de novo — nunca quebra o save inteiro.
    `build(r)` deve devolver a query pronta pra .execute() a partir do dict r."""
    r = dict(row)
    dropped = []
    for _ in range(15):
        try:
            return build(r).execute(), dropped
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                dropped.append(m.group(1))
                r.pop(m.group(1), None)
                continue
            raise
    return build(r).execute(), dropped


ALLOWED_STATUS = {"aberta", "em_andamento", "concluida", "cancelada", "atrasada"}
ALLOWED_PRIORIDADE = {"baixa", "media", "alta", "critica"}


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
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        task_id = (body.get("id") or "").strip() or None
        is_socio = (actor.get("lvl") or 0) >= 10

        # Update
        if task_id:
            try:
                cur = sb.table("dir_tasks").select("*").eq("id", task_id).limit(1).execute().data or []
                if not cur:
                    return self._send(404, {"ok": False, "error": "tarefa não encontrada"})
                cur = cur[0]
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"erro consulta: {e}"})

            # Permissão
            owner = cur.get("responsavel") == actor["id"] or cur.get("criado_por") == actor["id"]
            if not is_socio and not owner:
                return self._send(403, {"ok": False, "error": "apenas Sócio ou responsável/criador pode editar"})

            # Campos permitidos
            patch = {}
            allowed_keys = ["titulo", "descricao", "status", "prioridade", "categoria",
                            "responsavel", "prazo", "inicio", "observacoes"]
            if not is_socio:
                # Não-Sócio só pode mudar status/observacoes/categoria
                allowed_keys = ["status", "observacoes", "categoria"]
            for k in allowed_keys:
                if k in body and body[k] is not None:
                    patch[k] = body[k]

            if not patch:
                return self._send(400, {"ok": False, "error": "nada para atualizar"})

            # Validações
            if "status" in patch and patch["status"] not in ALLOWED_STATUS:
                return self._send(400, {"ok": False, "error": f"status inválido. Use: {sorted(ALLOWED_STATUS)}"})
            if "prioridade" in patch and patch["prioridade"] not in ALLOWED_PRIORIDADE:
                return self._send(400, {"ok": False, "error": f"prioridade inválida. Use: {sorted(ALLOWED_PRIORIDADE)}"})

            # Histórico
            history = cur.get("historico") or []
            if isinstance(history, str):
                try: history = json.loads(history)
                except: history = []
            event = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "actor_id": actor["id"],
                "actor_name": actor.get("name"),
                "action": "update",
                "changes": {k: {"from": cur.get(k), "to": v} for k, v in patch.items() if cur.get(k) != v},
            }
            if event["changes"]:
                history.append(event)
            patch["historico"] = history

            try:
                res, _dropped = _safe_write(lambda r: sb.table("dir_tasks").update(r).eq("id", task_id), patch)
                row = (res.data or [None])[0]
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"erro update: {e}"})

            # Audit
            audit(self, actor, "task.update", target_type="dir_task", target_id=task_id,
                  before={k: cur.get(k) for k in patch.keys() if k != "historico"},
                  after={k: v for k, v in patch.items() if k != "historico"})

            # Notify: se responsável mudou, avisa o novo. Se status mudou, avisa criador e resp atual.
            try:
                new_resp = patch.get("responsavel")
                if new_resp and new_resp != cur.get("responsavel") and new_resp != actor["id"]:
                    notify_all([new_resp], tipo="task.assigned",
                           title=f"📋 {actor.get('name')} te atribuiu uma tarefa",
                           body=cur.get("titulo") or "", link="#/tarefas",
                           target_type="task", target_id=task_id)
                if "status" in patch and patch["status"] != cur.get("status"):
                    targets = {cur.get("responsavel"), cur.get("criado_por")} - {actor["id"], None}
                    if targets:
                        notify_all(list(targets), tipo="task.status",
                               title=f"📋 Tarefa: {patch['status']}",
                               body=f"{cur.get('titulo')} · alterada por {actor.get('name')}",
                               link="#/tarefas", target_type="task", target_id=task_id)
            except Exception as e:
                print(f"[task] notify err: {e}")

            return self._send(200, {"ok": True, "task": row})

        # Create
        else:
            titulo = (body.get("titulo") or "").strip()
            if not titulo:
                return self._send(400, {"ok": False, "error": "titulo obrigatório"})
            status = (body.get("status") or "aberta").lower()
            prior  = (body.get("prioridade") or "media").lower()
            if status not in ALLOWED_STATUS:
                return self._send(400, {"ok": False, "error": "status inválido"})
            if prior not in ALLOWED_PRIORIDADE:
                return self._send(400, {"ok": False, "error": "prioridade inválida"})

            new_id = "t_" + uuid.uuid4().hex[:12]
            row = {
                "id":          new_id,
                "titulo":      titulo,
                "descricao":   body.get("descricao") or None,
                "status":      status,
                "prioridade":  prior,
                "categoria":   body.get("categoria") or None,
                "responsavel": body.get("responsavel") or None,
                "criado_por":  actor["id"],
                "criado_em":   int(time.time() * 1000),
                "inicio":      body.get("inicio") or None,
                "prazo":       body.get("prazo") or None,
                "observacoes": body.get("observacoes") or None,
                "historico":   [{
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "actor_id": actor["id"],
                    "actor_name": actor.get("name"),
                    "action": "create",
                }],
            }
            try:
                res, _dropped = _safe_write(lambda r: sb.table("dir_tasks").insert(r), row)
                inserted = (res.data or [row])[0]
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"erro insert: {e}"})

            audit(self, actor, "task.create", target_type="dir_task", target_id=new_id, after=row)

            # Notify responsável (se diferente do criador)
            try:
                resp = row.get("responsavel")
                if resp and resp != actor["id"]:
                    notify_all([resp], tipo="task.assigned",
                           title=f"📋 Nova tarefa de {actor.get('name')}",
                           body=titulo, link="#/tarefas",
                           target_type="task", target_id=new_id)
            except Exception as e:
                print(f"[task] notify err: {e}")

            return self._send(200, {"ok": True, "task": inserted, "created": True})
