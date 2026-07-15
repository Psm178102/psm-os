"""
GET/POST /api/v3/reunioes/atas — Registro de reuniões (atas) + combinados + tipos. v81.36

Resolve 3 dores: (1) perder histórico → tabela reunioes_atas filtrável; (2) combinados
não cumpridos → cada combinado pode "virar tarefa" real (dir_tasks) cobrada/notificada;
(3) prazos de rotina → próxima reunião/recorrência cria evento na Agenda (eventos).

GET  (qualquer autenticado): { ok, atas[], tipos[], can_edit }
     Diretoria (lvl>=7) vê TODAS; os demais veem só onde participam OU são responsáveis
     por algum combinado ("cada área vê a sua").
POST (lvl>=7 diretoria): action upsert | delete | vira_tarefa | set_tipos.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore

TIPOS_KEY = "reuniao_tipos"
TIPOS_DEFAULT = [
    {"id": "estrategia",     "label": "Estratégia",            "emoji": "🎯", "cor": "#4f46e5"},
    {"id": "financeiro",     "label": "Financeiro / Contábil", "emoji": "💰", "cor": "#16a34a"},
    {"id": "administrativo", "label": "Administrativo",        "emoji": "🗂️", "cor": "#64748b"},
    {"id": "sec_vendas",     "label": "Secretaria de Vendas",  "emoji": "📞", "cor": "#0ea5e9"},
    {"id": "conquista",      "label": "Conquista",             "emoji": "🏠", "cor": "#f59e0b"},
    {"id": "map",            "label": "MAP",                   "emoji": "🗺️", "cor": "#a855f7"},
    {"id": "terceiros",      "label": "Terceiros",             "emoji": "🤝", "cor": "#0d9488"},
    {"id": "locacao",        "label": "Locação",               "emoji": "🔑", "cor": "#a16207"},
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read_tipos(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", TIPOS_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else None
        if isinstance(val, str):
            val = json.loads(val)
        if isinstance(val, list) and val:
            return val
    except Exception:
        pass
    return [dict(x) for x in TIPOS_DEFAULT]


def _write_tipos(sb, tipos):
    sb.table("shared_kv").upsert(
        {"key": TIPOS_KEY, "value": tipos, "updated_at": _now()}, on_conflict="key"
    ).execute()


def _norm_combinados(lst):
    out = []
    for c in (lst or []):
        if not isinstance(c, dict):
            continue
        texto = str(c.get("texto") or "").strip()
        if not texto:
            continue
        out.append({
            "id": str(c.get("id") or uuid.uuid4().hex[:8]),
            "texto": texto[:500],
            "responsavel_id": (str(c.get("responsavel_id") or "").strip() or None),
            "responsavel_nome": (str(c.get("responsavel_nome") or "").strip()[:120] or None),
            "prazo": (c.get("prazo") or None),
            "feito": bool(c.get("feito")),
            "task_id": (c.get("task_id") or None),
        })
    return out[:60]


def _norm_anexos(lst):
    out = []
    for a in (lst or []):
        if not isinstance(a, dict):
            continue
        url = str(a.get("url") or "").strip()
        if not url:
            continue
        out.append({"nome": (str(a.get("nome") or "").strip()[:120] or url), "url": url[:1000]})
    return out[:30]


def _ata_row(body):
    parts = body.get("participantes")
    return {
        "tipo": str(body.get("tipo") or "estrategia").strip()[:40],
        "titulo": (str(body.get("titulo") or "").strip()[:200] or None),
        "data": body.get("data") or None,
        "hora_inicio": body.get("hora_inicio") or None,
        "hora_fim": body.get("hora_fim") or None,
        "participantes": parts if isinstance(parts, list) else [],
        "confidencial": bool(body.get("confidencial")),
        "pauta": (str(body.get("pauta") or "").strip()[:8000] or None),
        "notas": (str(body.get("notas") or "").strip()[:8000] or None),
        "combinados": _norm_combinados(body.get("combinados")),
        "anexos": _norm_anexos(body.get("anexos")),
        "status": (str(body.get("status") or "realizada").strip()[:20]),
        "recorrencia": (str(body.get("recorrencia") or "nenhuma").strip()[:20]),
        "proxima_data": body.get("proxima_data") or None,
        "formato_id": (body.get("formato_id") or None),
        "updated_at": _now(),
    }


def _sync_evento(sb, actor, row, evento_id):
    """Cria/atualiza o evento da PRÓXIMA reunião na Agenda (eventos). Best-effort:
    se não há proxima_data, remove o evento vinculado. Nunca quebra o save da ata."""
    prox = row.get("proxima_data")
    if not prox or row.get("confidencial"):
        if evento_id:
            try:
                sb.table("eventos").delete().eq("id", evento_id).execute()
            except Exception:
                pass
        return None
    ev = {
        "tipo": "reuniao",
        "titulo": ("Reunião — " + (row.get("titulo") or row.get("tipo") or ""))[:160],
        "descricao": ((row.get("pauta") or "")[:500] or None),
        "data": str(prox)[:10],
        "hora_inicio": row.get("hora_inicio") or None,
        "hora_fim": row.get("hora_fim") or None,
        "all_day": not bool(row.get("hora_inicio")),
        "participantes": row.get("participantes") or [],
        "status": "agendado",
    }
    try:
        if evento_id:
            sb.table("eventos").update(ev).eq("id", evento_id).execute()
            return evento_id
        ev["id"] = "evrn_" + uuid.uuid4().hex[:10]
        sb.table("eventos").insert(ev).execute()
        return ev["id"]
    except Exception:
        return evento_id


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("reunioes_atas").select("*").order("data", desc=True).limit(1000).execute().data or []
        except Exception:
            rows = []
        lvl = user.get("lvl") or 0
        uid = user.get("id")
        if lvl < 7:
            # participante vê sempre; responsável por combinado só vê se a reunião NÃO for confidencial
            # (o combinado dele chega via "virar tarefa" sem expor a ata inteira)
            rows = [r for r in rows
                    if uid in (r.get("participantes") or [])
                    or (not r.get("confidencial")
                        and any(c.get("responsavel_id") == uid for c in (r.get("combinados") or [])))]
        else:
            # 🔒 confidencial: nem gestor fora da lista vê — só participantes e o criador
            rows = [r for r in rows
                    if not r.get("confidencial")
                    or uid in (r.get("participantes") or [])
                    or r.get("criado_por") == uid]
        return self._send(200, {"ok": True, "atas": rows, "tipos": _read_tipos(sb), "can_edit": lvl >= 7})

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

        action = (body.get("action") or "upsert").strip()
        now = _now()

        # ── catálogo de tipos (personalizável) ──
        if action == "set_tipos":
            tipos = []
            for t in (body.get("tipos") or []):
                if not isinstance(t, dict):
                    continue
                label = str(t.get("label") or "").strip()
                if not label:
                    continue
                tipos.append({
                    "id": (str(t.get("id") or "").strip() or uuid.uuid4().hex[:8]),
                    "label": label[:60],
                    "emoji": (str(t.get("emoji") or "📋").strip()[:8] or "📋"),
                    "cor": (str(t.get("cor") or "#64748b").strip()[:16] or "#64748b"),
                })
            if not tipos:
                return self._send(400, {"ok": False, "error": "informe ao menos 1 tipo"})
            try:
                _write_tipos(sb, tipos)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "reunioes.set_tipos", target_type="shared_kv", target_id=TIPOS_KEY)
            return self._send(200, {"ok": True, "tipos": tipos})

        # ── excluir ata (+ evento vinculado) ──
        if action == "delete":
            aid = (body.get("id") or "").strip()
            if not aid:
                return self._send(400, {"ok": False, "error": "id obrigatório"})
            try:
                cur = sb.table("reunioes_atas").select("evento_id").eq("id", aid).limit(1).execute().data or []
                if cur and cur[0].get("evento_id"):
                    try:
                        sb.table("eventos").delete().eq("id", cur[0]["evento_id"]).execute()
                    except Exception:
                        pass
                sb.table("reunioes_atas").delete().eq("id", aid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "reunioes.ata_delete", target_type="reunioes_atas", target_id=aid)
            return self._send(200, {"ok": True, "id": aid})

        # ── combinado → tarefa real (dir_tasks) + notifica ──
        if action == "vira_tarefa":
            aid = (body.get("id") or "").strip()
            cid = (body.get("combinado_id") or "").strip()
            rows = sb.table("reunioes_atas").select("*").eq("id", aid).limit(1).execute().data or []
            if not rows:
                return self._send(404, {"ok": False, "error": "reunião não encontrada"})
            ata = rows[0]
            combinados = ata.get("combinados") or []
            comb = next((c for c in combinados if c.get("id") == cid), None)
            if not comb:
                return self._send(404, {"ok": False, "error": "combinado não encontrado"})
            if comb.get("task_id"):
                return self._send(200, {"ok": True, "task_id": comb["task_id"], "ja_existia": True})
            tipo_label = (body.get("tipo_label") or ata.get("tipo") or "Reunião")
            tid = "t_" + uuid.uuid4().hex[:12]
            task = {
                "id": tid,
                "titulo": str(comb.get("texto") or "Combinado")[:200],
                "descricao": ("Combinado da reunião: " + (ata.get("titulo") or tipo_label) +
                              (" (" + str(ata.get("data"))[:10] + ")" if ata.get("data") else "")),
                "status": "aberta",
                "prioridade": "media",
                "categoria": ("Reunião · " + str(tipo_label))[:80],
                "responsavel": comb.get("responsavel_id") or None,
                "criado_por": actor["id"],
                "criado_em": int(datetime.now(timezone.utc).timestamp() * 1000),
                "prazo": comb.get("prazo") or None,
                "historico": [{"ts": now, "actor_id": actor["id"], "actor_name": actor.get("name"), "action": "create"}],
            }
            try:
                sb.table("dir_tasks").insert(task).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"tarefa: {e}"})
            comb["task_id"] = tid
            try:
                sb.table("reunioes_atas").update({"combinados": combinados, "updated_at": now}).eq("id", aid).execute()
            except Exception:
                pass
            resp = comb.get("responsavel_id")
            if resp and resp != actor["id"]:
                try:
                    notify_all([resp], tipo="task.assign", title="📋 Novo combinado pra você",
                               body=str(comb.get("texto") or "")[:140], link="#/tarefas",
                               target_type="dir_tasks", target_id=tid)
                except Exception:
                    pass
            audit(self, actor, "reunioes.vira_tarefa", target_type="dir_tasks", target_id=tid)
            return self._send(200, {"ok": True, "task_id": tid})

        # ── upsert da ata (+ sincroniza evento da próxima reunião) ──
        aid = (body.get("id") or "").strip() or None
        row = _ata_row(body)
        aviso = None
        try:
            if aid:
                cur = sb.table("reunioes_atas").select("*").eq("id", aid).limit(1).execute().data or []
                atual = cur[0] if cur else {}
                # EDIÇÃO É PATCH, não reconstrução (v84.75): o _ata_row inventa
                # default pra tudo que o body não trouxe — e o toggle de
                # "combinado feito" re-POSTava a ata SEM 'confidencial', então
                # bool(None) zerava o sigilo e a reunião confidencial vazava pra
                # gestão inteira (e ainda era publicada na Agenda pelo
                # _sync_evento). Campo que o cliente não mandou não é tocado.
                row = {k: v for k, v in row.items() if k in body or k == "updated_at"}
                # o _sync_evento decide sigilo/publicação — tem que enxergar o
                # estado COMPLETO (atual + patch), nunca só o patch
                visao = {**atual, **row}
                evento_id = atual.get("evento_id") or (body.get("evento_id") or None)
                row["evento_id"] = _sync_evento(sb, actor, visao, evento_id)
            else:
                aid = "rn_" + uuid.uuid4().hex[:12]
                row["evento_id"] = _sync_evento(sb, actor, row, None)
                row.update({"id": aid, "criado_por": actor["id"], "created_at": now})
            try:
                if body.get("id"):
                    sb.table("reunioes_atas").update(row).eq("id", aid).execute()
                else:
                    sb.table("reunioes_atas").insert(row).execute()
            except Exception:
                # coluna 'confidencial' ainda não migrada: salva sem ela, mas AVISA (nunca finge sigilo)
                if "confidencial" not in row:
                    raise
                row2 = {k: v for k, v in row.items() if k != "confidencial"}
                if body.get("id"):
                    sb.table("reunioes_atas").update(row2).eq("id", aid).execute()
                else:
                    sb.table("reunioes_atas").insert(row2).execute()
                if row.get("confidencial"):
                    aviso = "⚠️ Salvo, mas SEM sigilo: o banco ainda não tem a coluna 'confidencial' (migração pendente). Essa reunião está visível pela regra normal."
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "reunioes.ata_upsert", target_type="reunioes_atas", target_id=aid)
        return self._send(200, {"ok": True, "id": aid, "evento_id": row.get("evento_id"), "aviso": aviso})
