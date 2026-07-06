"""
GET /api/v3/locacoes/dash — DASHBOARD LOCAÇÃO (visão executiva só de locação). v84.17

Agrega numa chamada:
  carteira  → tabela locacoes (contratos administrados: status, aluguel, taxa adm,
              vencimentos 30/60/90 + próximos a vencer)
  estoque   → kenlo_imoveis com preco_locacao (anúncios p/ alugar no site)
  crm       → deals abertos em pipeline de locação (nome contém 'loca'), se existir

Auth: JWT lvl>=2.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


def _f(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _dias(ts):
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(str(ts).replace("Z", "+00:00"))).days
    except Exception:
        return None


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
        try:
            require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # ── carteira administrada ─────────────────────────────────────────
        try:
            rows = sb.table("locacoes").select("*").order("data_fim_contrato").limit(500).execute().data or []
        except Exception:
            rows = []
        hoje = date.today()
        t = hoje.isoformat()
        lim = {d: (hoje + timedelta(days=d)).isoformat() for d in (30, 60, 90)}
        ocup = [r for r in rows if (r.get("status") or "") == "ocupado"]
        aluguel = sum(_f(r.get("valor_aluguel")) for r in ocup)
        adm = sum(_f(r.get("valor_aluguel")) * _f(r.get("taxa_adm_pct")) / 100 for r in ocup)
        status_count = {}
        for r in rows:
            s = r.get("status") or "?"
            status_count[s] = status_count.get(s, 0) + 1
        vencendo = [
            {"endereco": (r.get("endereco") or r.get("imovel") or r.get("titulo") or "?"),
             "inquilino": r.get("inquilino") or "", "fim": r.get("data_fim_contrato"),
             "aluguel": _f(r.get("valor_aluguel")), "status": r.get("status")}
            for r in rows
            if r.get("data_fim_contrato") and t <= str(r.get("data_fim_contrato")) <= lim[90]
        ][:10]
        carteira = {
            "total": len(rows), "ocupadas": len(ocup),
            "status": status_count,
            "aluguel_mes": aluguel, "receita_adm_mes": adm,
            "taxa_adm_media": (sum(_f(r.get("taxa_adm_pct")) for r in ocup) / len(ocup)) if ocup else 0,
            "ticket_medio": (aluguel / len(ocup)) if ocup else 0,
            "vence_30": sum(1 for r in rows if r.get("data_fim_contrato") and t <= str(r["data_fim_contrato"]) <= lim[30]),
            "vence_60": sum(1 for r in rows if r.get("data_fim_contrato") and t <= str(r["data_fim_contrato"]) <= lim[60]),
            "vence_90": sum(1 for r in rows if r.get("data_fim_contrato") and t <= str(r["data_fim_contrato"]) <= lim[90]),
            "vencendo": vencendo,
        }

        # ── estoque p/ alugar (anúncios Kenlo) ───────────────────────────
        try:
            ims = sb.table("kenlo_imoveis").select(
                "property_code,titulo,bairro,tipo,preco_locacao,atualizado_kenlo,n_fotos"
            ).eq("ativo", True).gt("preco_locacao", 0).limit(2000).execute().data or []
        except Exception:
            ims = []
        por_bairro, por_tipo = {}, {}
        for i in ims:
            b = i.get("bairro") or "—"
            por_bairro[b] = por_bairro.get(b, 0) + 1
            tp = i.get("tipo") or "outro"
            por_tipo[tp] = por_tipo.get(tp, 0) + 1
        dias_list = [d for d in (_dias(i.get("atualizado_kenlo")) for i in ims) if d is not None]
        estoque = {
            "n": len(ims),
            "aluguel_anunciado_mes": sum(_f(i.get("preco_locacao")) for i in ims),
            "ticket_medio": (sum(_f(i.get("preco_locacao")) for i in ims) / len(ims)) if ims else 0,
            "por_bairro": sorted(por_bairro.items(), key=lambda x: -x[1])[:8],
            "por_tipo": sorted(por_tipo.items(), key=lambda x: -x[1])[:8],
            "dias_medio_sem_atualizar": (sum(dias_list) / len(dias_list)) if dias_list else None,
        }

        # ── funil CRM de locação (se houver pipeline com 'loca' no nome) ──
        crm = {"n": 0, "valor": 0.0}
        try:
            deals = sb.table("deals").select("id,amount,pipeline_name,stage_name") \
                .eq("status", "aberto").ilike("pipeline_name", "%loca%").limit(1000).execute().data or []
            crm = {"n": len(deals), "valor": sum(_f(d.get("amount")) for d in deals)}
        except Exception:
            pass

        return self._send(200, {"ok": True, "carteira": carteira, "estoque": estoque, "crm": crm})
