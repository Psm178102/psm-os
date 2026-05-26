"""GET /api/v3/export/csv?table=users|imoveis|lancamentos|locacoes|metas|comissoes|deals|tasks|eventos

Exporta tabela do Postgres como CSV. Requer Líder (lvl>=5).
Whitelist de tabelas permitidas.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, csv, io, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore


ALLOWED_TABLES = {
    "users": "id,name,email,role,team,status,created_at",
    "imoveis": "id,codigo,tipo,endereco,bairro,valor,area_m2,dormitorios,vagas,status,origem,captador_id,created_at",
    "lancamentos": "id,nome,construtora,data_lancamento,etapa,comissao_pct,vgv_total,unidades_total,unidades_vendidas,status,responsavel_id",
    "locacoes": "id,endereco,bairro,proprietario_nome,inquilino_nome,valor_aluguel,status,data_fim_contrato,responsavel_id",
    "metas": "corretor_id,ano,mes,meta_vgv,meta_vendas,observacoes",
    "deals": "id,name,amount,win,closed_at,pipeline_name,stage_name,user_email,user_id",
    "dir_tasks": "id,titulo,status,prioridade,responsavel,prazo,categoria",
    "eventos": "id,tipo,titulo,data,hora_inicio,corretor_id,status,local",
    "audit_log": "ts,actor_name,action,target_type,target_id,notes",
    "concorrentes": "id,nome,segmento,anuncios_count,link",
}


class handler(BaseHTTPRequestHandler):

    def _send_csv(self, table, rows, columns):
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="psm_{table}_{__import__("datetime").datetime.now().strftime("%Y%m%d")}.csv"')
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        out = io.StringIO()
        w = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
        cols = [c.strip() for c in columns.split(",")]
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])
        self.wfile.write(out.getvalue().encode("utf-8"))

    def _send_json(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send_json(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}

        table = (params.get("table") or "").strip()
        if table not in ALLOWED_TABLES:
            return self._send_json(400, {
                "ok": False,
                "error": f"table inválida. Permitidas: {sorted(ALLOWED_TABLES.keys())}"
            })

        sb = supabase_client()
        if not sb: return self._send_json(503, {"ok": False, "error": "backend"})

        try:
            rows = sb.table(table).select("*").limit(5000).execute().data or []
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})

        audit(self, actor, "export.csv", target_type="table", target_id=table, notes=f"{len(rows)} rows")
        self._send_csv(table, rows, ALLOWED_TABLES[table])
