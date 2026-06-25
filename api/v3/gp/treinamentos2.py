"""
GET/POST /api/v3/gp/treinamentos2 — Treinamentos (LMS interno). v81.57

Versão profissional do módulo de Treinamentos: catálogo rico + matrícula e
progresso por pessoa + materiais. Guardado em shared_kv key 'gp_treinamentos2'
(flexível, sem migração; a tabela antiga gp_treinamentos era rígida).

<treino> = { id, titulo, descricao, tipo, setor, equipe, modalidade,
  carga_horaria, obrigatorio(bool), instrutor, data_inicio, prazo, trilha,
  status, materiais:[{tipo,titulo,url}], participantes:[{user_id,nome,status,nota,concluido_em}],
  created_at, updated_at }

GET (lvl>=5): { ok, treinos:[...], usuarios:[{id,name,team,role}] }  — usuarios p/ matrícula.
POST (lvl>=5): {action:'upsert', treino:{...}} | {action:'delete', id}.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "gp_treinamentos2"
TIPOS = ("tecnico", "comportamental", "comercial", "lideranca", "integracao")
MODALIDADES = ("presencial", "online", "gravado")
STATUS_TREINO = ("planejado", "ativo", "concluido", "arquivado")
STATUS_PART = ("nao_iniciado", "em_andamento", "concluido")
MAX_TREINOS = 1000
MAX_STR = 4000


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    if not isinstance(val, dict):
        val = {}
    if not isinstance(val.get("treinos"), list):
        val["treinos"] = []
    return val


def _write(sb, val):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": val, "updated_at": _now()}, on_conflict="key").execute()


def _s(v, n=MAX_STR):
    return str(v)[:n] if v not in (None, "") else None


def _usuarios(sb):
    try:
        rows = sb.table("users").select("id,name,team,role,status").order("name").execute().data or []
    except Exception:
        return []
    out = []
    for u in rows:
        st = (u.get("status") or "ativo").lower()
        if st in ("inativo", "desligado", "inactive", "off"):
            continue
        out.append({"id": u.get("id"), "name": u.get("name"), "team": u.get("team"), "role": u.get("role")})
    return out


def _clean_treino(raw):
    if not isinstance(raw, dict):
        return None
    titulo = (raw.get("titulo") or "").strip()
    if not titulo:
        return None
    mats = []
    for m in (raw.get("materiais") or [])[:30]:
        if isinstance(m, dict) and (m.get("url") or m.get("titulo")):
            mats.append({"tipo": _s(m.get("tipo"), 20) or "link", "titulo": _s(m.get("titulo"), 160) or "", "url": _s(m.get("url"), 600) or ""})
    parts = []
    seen = set()
    for p in (raw.get("participantes") or [])[:500]:
        if not isinstance(p, dict):
            continue
        uid = _s(p.get("user_id"), 80)
        if not uid or uid in seen:
            continue
        seen.add(uid)
        stt = p.get("status") if p.get("status") in STATUS_PART else "nao_iniciado"
        nota = p.get("nota")
        try:
            nota = round(float(nota), 1) if nota not in (None, "") else None
        except Exception:
            nota = None
        parts.append({"user_id": uid, "nome": _s(p.get("nome"), 120) or uid,
                      "status": stt, "nota": nota, "concluido_em": _s(p.get("concluido_em"), 30)})
    return {
        "titulo": titulo[:240],
        "descricao": _s(raw.get("descricao")),
        "tipo": raw.get("tipo") if raw.get("tipo") in TIPOS else "tecnico",
        "setor": _s(raw.get("setor"), 80),
        "equipe": _s(raw.get("equipe"), 80),
        "modalidade": raw.get("modalidade") if raw.get("modalidade") in MODALIDADES else None,
        "carga_horaria": _s(raw.get("carga_horaria"), 30),
        "obrigatorio": bool(raw.get("obrigatorio")),
        "instrutor": _s(raw.get("instrutor"), 120),
        "data_inicio": _s(raw.get("data_inicio"), 30),
        "prazo": _s(raw.get("prazo"), 30),
        "trilha": _s(raw.get("trilha"), 120),
        "status": raw.get("status") if raw.get("status") in STATUS_TREINO else "ativo",
        "materiais": mats,
        "participantes": parts,
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
        try: require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        val = _read(sb)
        return self._send(200, {"ok": True, "treinos": val["treinos"], "usuarios": _usuarios(sb)})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})

        action = body.get("action") or "upsert"
        val = _read(sb)
        lst = val["treinos"]

        if action == "delete":
            tid = body.get("id")
            val["treinos"] = [t for t in lst if t.get("id") != tid]
            try: _write(sb, val)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "gp.treino2_delete", target_type="shared_kv", target_id=str(tid))
            return self._send(200, {"ok": True, "deleted": tid})

        treino = _clean_treino(body.get("treino") if isinstance(body.get("treino"), dict) else {})
        if not treino:
            return self._send(400, {"ok": False, "error": "título obrigatório"})
        tid = (body.get("treino") or {}).get("id")
        if tid:
            found = False
            for i, t in enumerate(lst):
                if t.get("id") == tid:
                    treino.update({"id": tid, "created_at": t.get("created_at") or _now(), "updated_at": _now()})
                    lst[i] = treino; found = True; break
            if not found:
                tid = None
        if not tid:
            if len(lst) >= MAX_TREINOS:
                return self._send(400, {"ok": False, "error": "limite atingido"})
            tid = "trn_" + uuid.uuid4().hex[:12]
            treino.update({"id": tid, "created_at": _now(), "updated_at": _now()})
            lst.append(treino)
        val["treinos"] = lst
        try: _write(sb, val)
        except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "gp.treino2_upsert", target_type="shared_kv", target_id=tid, notes=treino["titulo"][:80])
        return self._send(200, {"ok": True, "id": tid, "treino": treino})
