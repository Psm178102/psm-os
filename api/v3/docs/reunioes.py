"""
GET/POST /api/v3/docs/reunioes — Formatos de Reunião da PSM (playbook editável). v77.82

Cada formato = método/cadência + objetivo + pauta (roteiro) + checklist + arquivos
editáveis (links do Google Drive/Docs). Guarda em shared_kv key 'reuniao_formatos'.
Vem com 4 formatos PADRÃO da PSM (Matinal, Semanal, Quinzenal, Fechamento mensal).

GET  (qualquer autenticado que alcança a aba): {ok, items[], seeded, can_edit}.
     Se o store estiver vazio, devolve os DEFAULTS (seeded:false) p/ pré-visualizar.
POST (lvl>=7 diretoria): action seed|upsert|delete|reorder. Audita.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "reuniao_formatos"

DEFAULTS = [
    {
        "id": "matinal", "emoji": "🌅", "nome": "Reunião Matinal",
        "cadencia": "3x por semana", "quando": "Segunda, Quarta e Sexta — 8h30 (em pé)",
        "duracao": "15 min", "participantes": "Equipe de vendas",
        "objetivo": "Energizar o time, alinhar o foco do dia e destravar negócios.",
        "pauta": "1) Número do dia (meta x realizado)\n2) Top 3 negócios quentes de cada corretor\n3) Travas: o que precisa de ajuda agora?\n4) Foco do dia — 1 prioridade por pessoa\n5) Grito de guerra / motivação",
        "checklist": ["Quadro de metas atualizado", "Cada corretor com seu Top 3 do dia", "Travas anotadas com responsável e prazo"],
        "arquivos": [],
    },
    {
        "id": "semanal", "emoji": "📅", "nome": "Reunião Semanal",
        "cadencia": "Semanal", "quando": "Toda segunda-feira — 9h",
        "duracao": "45–60 min", "participantes": "Equipe de vendas",
        "objetivo": "Revisar a semana anterior, planejar a semana e alinhar prioridades.",
        "pauta": "1) Resultados da semana (VGV, vendas, captações, visitas)\n2) Ranking e reconhecimento\n3) Pipeline: o que vai fechar esta semana\n4) Metas da semana por corretor\n5) Treinamento rápido / estudo de caso\n6) Avisos e combinados",
        "checklist": ["Relatório da semana pronto", "Ranking atualizado", "Metas individuais da semana definidas"],
        "arquivos": [],
    },
    {
        "id": "quinzenal", "emoji": "🗓️", "nome": "Reunião Quinzenal",
        "cadencia": "Quinzenal", "quando": "A cada 15 dias",
        "duracao": "60–90 min", "participantes": "Equipe de vendas + gestores",
        "objetivo": "Análise tática mais profunda com os gestores: funil, conversão e plano de ação.",
        "pauta": "1) Análise do funil (entradas, conversão por etapa, perdas e motivos)\n2) Desempenho por corretor x meta\n3) Captações e estoque de imóveis\n4) Marketing/tráfego: leads e CPL\n5) Plano de ação dos gestores p/ os próximos 15 dias\n6) Feedbacks / 1:1 rápidos",
        "checklist": ["Funil do período exportado", "Metas x realizado por corretor", "Plano de ação registrado com responsáveis"],
        "arquivos": [],
    },
    {
        "id": "fechamento", "emoji": "🏁", "nome": "Fechamento Mensal & Início de Mês",
        "cadencia": "Mensal", "quando": "Último dia útil (fechamento) + 1º dia útil (abertura)",
        "duracao": "90 min", "participantes": "Equipe + gestores + diretoria",
        "objetivo": "Fechar o mês com resultados e premiações; abrir o novo ciclo com metas e estratégia.",
        "pauta": "FECHAMENTO\n1) Resultado do mês (VGV, vendas, comissões, captações)\n2) Metas batidas x não batidas — por quê?\n3) Premiação e reconhecimento\n4) Aprendizados do mês\n\nINÍCIO DE MÊS\n5) Metas do novo mês (empresa, equipe, individual)\n6) Estratégia e foco do mês\n7) Campanhas / incentivos do mês\n8) Compromissos públicos do time",
        "checklist": ["Números do mês consolidados", "Premiações definidas", "Metas do novo mês lançadas", "Estratégia do mês comunicada"],
        "arquivos": [],
    },
]


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    items = (val or {}).get("items") if isinstance(val, dict) else None
    return items if isinstance(items, list) else []


def _write(sb, items):
    sb.table("shared_kv").upsert({
        "key": KV_KEY, "value": {"items": items},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key").execute()


def _clean(d):
    return {
        "nome": str(d.get("nome") or "").strip()[:120],
        "emoji": str(d.get("emoji") or "").strip()[:8],
        "cadencia": str(d.get("cadencia") or "").strip()[:60],
        "quando": str(d.get("quando") or "").strip()[:160],
        "duracao": str(d.get("duracao") or "").strip()[:60],
        "participantes": str(d.get("participantes") or "").strip()[:200],
        "objetivo": str(d.get("objetivo") or "").strip()[:600],
        "pauta": str(d.get("pauta") or "").strip()[:4000],
        "checklist": [str(x).strip()[:200] for x in (d.get("checklist") or []) if str(x).strip()][:40],
        "arquivos": [{"nome": str(a.get("nome") or "").strip()[:120], "url": str(a.get("url") or "").strip()[:1000]}
                     for a in (d.get("arquivos") or []) if isinstance(a, dict) and str(a.get("url") or "").strip()][:40],
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        items = _read(sb)
        seeded = bool(items)
        if not items:
            items = [dict(x) for x in DEFAULTS]
        return self._send(200, {"ok": True, "items": items, "seeded": seeded,
                                "can_edit": (user.get("lvl") or 0) >= 7})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        items = _read(sb)
        action = (body.get("action") or "").strip()

        if action == "seed":
            if not items:
                items = [dict(x) for x in DEFAULTS]
        elif action == "upsert":
            clean = _clean(body.get("item") or {})
            if not clean["nome"]:
                return self._send(400, {"ok": False, "error": "Nome é obrigatório"})
            iid = body.get("id")
            hit = next((it for it in items if it.get("id") == iid), None) if iid else None
            if hit:
                hit.update(clean)
                hit["updated_at"] = datetime.now(timezone.utc).isoformat(); hit["updated_by"] = actor.get("name")
            else:
                clean["id"] = iid or uuid.uuid4().hex[:12]
                clean["created_by"] = actor.get("name")
                items.append(clean)
        elif action == "delete":
            iid = body.get("id")
            items = [it for it in items if it.get("id") != iid]
        elif action == "reorder":
            order = body.get("order") or []
            pos = {iid: i for i, iid in enumerate(order)}
            items.sort(key=lambda it: pos.get(it.get("id"), 9999))
        else:
            return self._send(400, {"ok": False, "error": "ação inválida"})

        try:
            _write(sb, items)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, f"reunioes.{action}", target_type="shared_kv", target_id=KV_KEY)
        return self._send(200, {"ok": True, "items": items, "seeded": True})
