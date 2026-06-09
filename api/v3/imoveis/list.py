"""GET /api/v3/imoveis/list[?status=&captador_id=&origem=]"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


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
        f_status, f_origem, f_capt = params.get("status"), params.get("origem"), params.get("captador_id")
        try:
            q = sb.table("imoveis").select("*").order("valor", desc=True).limit(500)
            if f_status: q = q.eq("status", f_status)
            if f_capt:   q = q.eq("captador_id", f_capt)
            if f_origem: q = q.eq("origem", f_origem)
            rows = q.execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # 🔗 Mescla CAPTAÇÕES já captadas como imóveis do inventário — sem duplicar tabela,
        # sempre em sync com o kanban de Captações. Etapas pós-captação = imóvel disponível.
        CAPTURED = {"colher_dados", "edicao_fotos", "subir_kenlo", "agendar_mlabs", "concluido"}
        cap_rows = []
        try:
            cps = sb.table("captacoes").select(
                "id,nome_imovel,condominio,tipo_imovel,objetivo,status,endereco,bairro,"
                "valor_venda,valor_locacao,link_fotos,link_videos,codigo_kenlo,proprietario,"
                "contato,responsavel,responsavel_id,descricao,updated_at"
            ).in_("status", list(CAPTURED)).execute().data or []
            codigos_manuais = {(r.get("codigo") or "").strip() for r in rows if r.get("codigo")}
            for c in cps:
                kenlo = (c.get("codigo_kenlo") or "").strip()
                if kenlo and kenlo in codigos_manuais:
                    continue  # já existe como imóvel manual — não duplica
                nome = c.get("nome_imovel") or c.get("condominio") or "Imóvel captado"
                cap_rows.append({
                    "id": "cap_" + str(c.get("id")), "codigo": kenlo or nome, "titulo": nome,
                    "status": "disponivel", "origem": "terceiros", "fonte": "captacao",
                    "etapa_captacao": c.get("status"), "tipo": c.get("tipo_imovel"),
                    "objetivo": c.get("objetivo"),
                    "valor": c.get("valor_venda") or c.get("valor_locacao") or 0,
                    "endereco": c.get("endereco"), "bairro": c.get("bairro"),
                    "condominio": c.get("condominio"), "link_fotos": c.get("link_fotos"),
                    "link_videos": c.get("link_videos"), "proprietario": c.get("proprietario"),
                    "contato": c.get("contato"), "captador_id": c.get("responsavel_id"),
                    "captador": c.get("responsavel"), "descricao": c.get("descricao"),
                    "updated_at": c.get("updated_at"),
                })
            if f_status: cap_rows = [r for r in cap_rows if r["status"] == f_status]
            if f_origem: cap_rows = [r for r in cap_rows if r["origem"] == f_origem]
            if f_capt:   cap_rows = [r for r in cap_rows if str(r.get("captador_id")) == str(f_capt)]
        except Exception:
            cap_rows = []  # captações indisponíveis → segue só com imóveis manuais

        rows = rows + cap_rows
        kpis = {
            "total": len(rows),
            "disponiveis": sum(1 for r in rows if (r.get("status") or "") == "disponivel"),
            "valor_total": sum(float(r.get("valor") or 0) for r in rows if (r.get("status") or "") == "disponivel"),
            "proprios": sum(1 for r in rows if (r.get("origem") or "") == "proprio"),
            "terceiros": sum(1 for r in rows if (r.get("origem") or "") == "terceiros"),
            "de_captacao": sum(1 for r in rows if r.get("fonte") == "captacao"),
        }
        return self._send(200, {"ok": True, "count": len(rows), "imoveis": rows, "kpis": kpis})
