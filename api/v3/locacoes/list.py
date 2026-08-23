"""GET /api/v3/locacoes/list[?status=&responsavel_id=]"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, hoje_brt  # type: ignore

# carteira ATIVA = contrato vigente que gera receita de administração
ATIVOS_STATUS = ("ocupado", "em_atraso", "em_renovacao")


def _is_ativo(r, tISO):
    if (r.get("status") or "") not in ATIVOS_STATUS:
        return False
    fim = r.get("data_fim_contrato")
    return (not fim) or str(fim)[:10] >= tISO   # sem fim OU ainda não venceu


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()
    def do_GET(self):
        try: user = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows, page, size = [], 0, 1000
            while page < 20:   # range paginado (não trava em 500)
                qq = sb.table("locacoes").select("*").order("data_fim_contrato") \
                    .range(page * size, page * size + size - 1)
                if params.get("status"):         qq = qq.eq("status", params["status"])
                if params.get("responsavel_id"): qq = qq.eq("responsavel_id", params["responsavel_id"])
                chunk = qq.execute().data or []
                rows.extend(chunk)
                if len(chunk) < size:
                    break
                page += 1
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # Calcula KPIs
        from datetime import timedelta
        today = hoje_brt()
        tISO = today.isoformat()
        in30 = (today + timedelta(days=30)).isoformat()
        in60 = (today + timedelta(days=60)).isoformat()
        in90 = (today + timedelta(days=90)).isoformat()
        ativos = [r for r in rows if _is_ativo(r, tISO)]     # carteira que gera receita
        ocup = [r for r in rows if (r.get("status") or "") == "ocupado"]
        # vencimentos/renovações só de contratos ATIVOS (contrato disponível/vencido não conta)
        def vence_em(lim):
            return sum(1 for r in ativos
                       if r.get("data_fim_contrato") and tISO <= str(r["data_fim_contrato"])[:10] <= lim)
        receita_aluguel = sum(float(r.get("valor_aluguel") or 0) for r in ativos)
        receita_adm = sum(float(r.get("valor_aluguel") or 0) * float(r.get("taxa_adm_pct") or 0) / 100 for r in ativos)
        total = len(rows)
        kpis = {
            "total":        total,
            "disponiveis":  sum(1 for r in rows if (r.get("status") or "") == "disponivel"),
            "ativos":       len(ativos),
            "ocupadas":     len(ocup),
            "em_atraso":    sum(1 for r in rows if (r.get("status") or "") == "em_atraso"),
            "ocupacao_pct": round(len(ativos) / total * 100, 2) if total else 0,
            "vence_30d":    vence_em(in30),
            "vence_60d":    vence_em(in60),
            "vence_90d":    vence_em(in90),
            "receita_potencial": receita_aluguel,
            "receita_aluguel":   receita_aluguel,
            "receita_adm":       round(receita_adm, 2),
            "taxa_adm_media":    round(sum(float(r.get("taxa_adm_pct") or 0) for r in ativos) / len(ativos), 2) if ativos else 0,
            "ticket_adm_medio":  round(receita_adm / len(ativos), 2) if ativos else 0,
        }
        return self._send(200, {"ok": True, "count": total, "locacoes": rows, "kpis": kpis})
