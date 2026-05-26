"""POST /api/v3/backup/restore — restaura dump JSON (Sócio only)

Body: { tables: { users: [...], imoveis: [...], ... }, _meta?: {...},
        options?: { mode: "upsert"|"insert" (default upsert),
                    tables: ["users","imoveis"] (whitelist opcional) } }

Faz upsert table-by-table das tabelas presentes no dump. AUDIT pesado.
Não deleta nada — restore é aditivo. Pra wipe+restore, manualmente.
Requer lvl>=7 (Sócio).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


# Whitelist de tabelas restauráveis (segurança)
ALLOWED_TABLES = {
    "users", "imoveis", "lancamentos", "locacoes", "metas", "deals",
    "dir_tasks", "eventos", "concorrentes", "shared_kv", "one_on_ones",
    "plantoes", "tarefas", "comentarios",
    # audit_log e notifications NÃO restauráveis (append-only)
}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):
        try: actor = require_user(self, min_lvl=7)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        tables = body.get("tables") or {}
        if not isinstance(tables, dict) or not tables:
            return self._send(400, {"ok": False, "error": "campo 'tables' obrigatório (objeto não-vazio)"})

        opts = body.get("options") or {}
        mode = opts.get("mode") or "upsert"
        if mode not in ("upsert", "insert"):
            return self._send(400, {"ok": False, "error": "options.mode deve ser 'upsert' ou 'insert'"})

        whitelist = set(opts.get("tables") or [])

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        report = {"ok": True, "tables": {}, "total_rows": 0, "skipped_tables": []}
        for table, rows in tables.items():
            if table not in ALLOWED_TABLES:
                report["skipped_tables"].append({"table": table, "reason": "não permitida"})
                continue
            if whitelist and table not in whitelist:
                report["skipped_tables"].append({"table": table, "reason": "fora da whitelist"})
                continue
            if not isinstance(rows, list) or not rows:
                report["tables"][table] = {"rows": 0, "skipped": "vazio"}
                continue
            try:
                if mode == "upsert":
                    # batch em chunks de 100 pra evitar timeout
                    inserted = 0
                    for i in range(0, len(rows), 100):
                        chunk = rows[i:i+100]
                        r = sb.table(table).upsert(chunk).execute()
                        inserted += len(r.data or chunk)
                    report["tables"][table] = {"rows": inserted, "mode": "upsert"}
                else:
                    inserted = 0
                    for i in range(0, len(rows), 100):
                        chunk = rows[i:i+100]
                        r = sb.table(table).insert(chunk).execute()
                        inserted += len(r.data or chunk)
                    report["tables"][table] = {"rows": inserted, "mode": "insert"}
                report["total_rows"] += inserted
            except Exception as e:
                report["tables"][table] = {"error": str(e)[:300]}
                report["ok"] = False

        audit(self, actor, "backup.restore", target_type="system",
              notes=f"mode={mode} total_rows={report['total_rows']} tables={list(report['tables'].keys())}",
              after={"report": report})

        return self._send(200 if report["ok"] else 207, report)
