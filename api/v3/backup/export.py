"""GET /api/v3/backup/export — dump JSON completo (Sócio only)

Exporta snapshot de TODAS tabelas críticas como JSON.
Útil pra backup manual, migração, debug.
Requer lvl>=7 (Sócio).

Tabelas: users, imoveis, lancamentos, locacoes, metas, deals, dir_tasks,
eventos, audit_log (últimos 1000), concorrentes, shared_kv, one_on_ones,
plantoes, notifications (não-lidas), tarefas, comentarios.

Limit 5000 rows por tabela.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


BACKUP_TABLES = [
    ("users", 5000, None),
    ("imoveis", 5000, None),
    ("lancamentos", 5000, None),
    ("locacoes", 5000, None),
    ("metas", 5000, None),
    ("deals", 5000, None),
    ("dir_tasks", 5000, None),
    ("eventos", 5000, None),
    ("audit_log", 1000, ("ts", "desc")),  # só últimos 1000 (mais recentes)
    ("concorrentes", 5000, None),
    ("shared_kv", 5000, None),
    ("one_on_ones", 5000, None),
    ("plantoes", 5000, None),
    ("notifications", 1000, ("created_at", "desc")),
    ("comments", 5000, None),
]


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(body, default=str).encode("utf-8"))

    def _send_dump(self, dump):
        body = json.dumps(dump, default=str, ensure_ascii=False, indent=2).encode("utf-8")
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="psm_os_backup_{ts}.json"')
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send_json(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb: return self._send_json(503, {"ok": False, "error": "backend"})

        dump = {
            "_meta": {
                "version": "v75.72",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "exported_by": {"id": actor.get("id"), "name": actor.get("name")},
                "source": "PSM-OS-v3",
            },
            "tables": {},
        }

        total_rows = 0
        errors = []
        for table, limit, order in BACKUP_TABLES:
            try:
                q = sb.table(table).select("*").limit(limit)
                if order:
                    col, dir_ = order
                    q = q.order(col, desc=(dir_ == "desc"))
                rows = q.execute().data or []
                dump["tables"][table] = rows
                total_rows += len(rows)
            except Exception as e:
                errors.append({"table": table, "error": str(e)[:200]})
                dump["tables"][table] = []

        dump["_meta"]["total_rows"] = total_rows
        dump["_meta"]["errors"] = errors

        audit(self, actor, "backup.export", target_type="system",
              notes=f"{total_rows} rows across {len(BACKUP_TABLES)} tables, {len(errors)} errors")
        self._send_dump(dump)
