"""
GET/POST /api/v3/settings/funcoes_tarefas — FUNÇÕES E TAREFAS por cargo/login. v81.86

Checklist de funções/atribuições que o SÓCIO preenche por CARGO (papel) e por LOGIN
(usuário). Cada pessoa vê o seu checklist em Meu Perfil → "Funções e Tarefas" e pode
marcar como feito (o estado de marcação é por usuário).

shared_kv key 'funcoes_tarefas' = {
  "byRole":  { "<papel>":  [ {"id","txt"} ] },   # itens por cargo
  "byUser":  { "<userId>": [ {"id","txt"} ] },   # itens específicos do login
  "checked": { "<userId>": { "<itemId>": true } }# o que cada um marcou
}

GET (qualquer autenticado):
  - sócio (lvl>=10): { ok, is_socio:true, byRole, byUser, checked }   (pro editor)
  - demais: { ok, is_socio:false, items:[itens do cargo + do login], checked:{...do user} }
POST (qualquer autenticado) — action:
  - 'set_role' (lvl>=10): { role, items:[{id?,txt}] }   → define itens do cargo
  - 'set_user' (lvl>=10): { userId, items:[{id?,txt}] } → define itens do login
  - 'toggle'   (qualquer): { itemId, done }              → marca/desmarca no PRÓPRIO checklist
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "funcoes_tarefas"
VALID_ROLES = {"socio", "diretor", "gerente", "lider", "backoffice", "financeiro", "marketing",
               "corretor", "corretor_conquista", "corretor_map", "corretor_locacao", "corretor_terceiros", "gerente_conquista", "gerente_map", "gerente_locacao", "gerente_terceiros", "secretaria_vendas"}
MAX_ITEMS = 120
MAX_TXT = 300


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
    val.setdefault("byRole", {})
    val.setdefault("byUser", {})
    val.setdefault("checked", {})
    val.setdefault("cargo", {})    # { role: {funcoes, objetivos, tarefas} } — conteúdo didático por cargo (sócio). v81.95
    val.setdefault("perfil", {})   # { uid: {bio, foto} } — bio + foto de perfil (cada login). v81.95
    return val


def _write(sb, val):
    sb.table("shared_kv").upsert({
        "key": KV_KEY, "value": val,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key").execute()


def _clean_items(items):
    out = []
    for it in (items or []):
        if not isinstance(it, dict):
            continue
        txt = (it.get("txt") or "").strip()[:MAX_TXT]
        if not txt:
            continue
        iid = (str(it.get("id") or "")).strip()[:40] or f"ft_{len(out)}_{abs(hash(txt)) % 100000}"
        out.append({"id": iid, "txt": txt})
        if len(out) >= MAX_ITEMS:
            break
    return out


def _role_ok(r):
    """Aceita papel fixo (VALID_ROLES), '*' ou papel CUSTOM em formato slug
    (minúsculo, [a-z0-9_], começa com letra) — assim categorias novas funcionam
    sem precisar editar este arquivo. v81.91"""
    if not isinstance(r, str):
        return False
    r = r.strip()
    if r == "*" or r in VALID_ROLES:
        return True
    return (2 <= len(r) <= 41 and r == r.lower() and r[0].isalpha()
            and r.replace("_", "").isalnum())


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
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        val = _read(sb)
        # ?user_id=X → checklist de UM usuário (pro Meu Painel). Gestão (lvl>=5) ou o próprio. v81.92
        import urllib.parse
        try:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        except Exception:
            qs = {}
        target = (qs.get("user_id", [""])[0] or "").strip()
        if target and ((actor.get("lvl") or 0) >= 5 or target == actor.get("id")):
            trole = ""
            try:
                tr = sb.table("users").select("role").eq("id", target).limit(1).execute().data or []
                trole = (tr[0].get("role") if tr else "") or ""
            except Exception:
                trole = ""
            items = list(val["byRole"].get(trole, [])) + list(val["byUser"].get(target, []))
            return self._send(200, {"ok": True, "is_socio": False, "for_user": target,
                                    "items": items, "checked": val["checked"].get(target, {})})
        if (actor.get("lvl") or 0) >= 10:
            return self._send(200, {"ok": True, "is_socio": True,
                                    "byRole": val["byRole"], "byUser": val["byUser"], "checked": val["checked"],
                                    "cargo": val["cargo"], "perfil": val["perfil"]})
        uid = actor.get("id"); role = actor.get("role")
        items = list(val["byRole"].get(role, [])) + list(val["byUser"].get(uid, []))
        return self._send(200, {"ok": True, "is_socio": False,
                                "items": items, "checked": val["checked"].get(uid, {}),
                                "cargo": val["cargo"], "perfil": val["perfil"]})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
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

        action = (body.get("action") or "").strip()
        lvl = actor.get("lvl") or 0
        val = _read(sb)

        if action == "set_role":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "só sócio"})
            role = (body.get("role") or "").strip()
            if not _role_ok(role):
                return self._send(400, {"ok": False, "error": "papel inválido"})
            val["byRole"][role] = _clean_items(body.get("items"))
            audit(self, actor, "funcoes.set_role", target_type="shared_kv", target_id=role)

        elif action == "set_user":
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "só sócio"})
            uid = (body.get("userId") or "").strip()
            if not uid:
                return self._send(400, {"ok": False, "error": "userId obrigatório"})
            val["byUser"][uid] = _clean_items(body.get("items"))
            audit(self, actor, "funcoes.set_user", target_type="shared_kv", target_id=uid)

        elif action == "toggle":
            iid = (str(body.get("itemId") or "")).strip()[:40]
            if not iid:
                return self._send(400, {"ok": False, "error": "itemId obrigatório"})
            uid = actor.get("id")
            val["checked"].setdefault(uid, {})
            if body.get("done"):
                val["checked"][uid][iid] = True
            else:
                val["checked"][uid].pop(iid, None)

        elif action == "set_cargo":   # conteúdo didático do cargo (sócio). v81.95
            if lvl < 10:
                return self._send(403, {"ok": False, "error": "só sócio"})
            role = (body.get("role") or "").strip()
            if not _role_ok(role):
                return self._send(400, {"ok": False, "error": "papel inválido"})
            val["cargo"][role] = {
                "funcoes": (body.get("funcoes") or "").strip()[:4000],
                "objetivos": (body.get("objetivos") or "").strip()[:4000],
                "tarefas": (body.get("tarefas") or "").strip()[:4000],
            }
            audit(self, actor, "funcoes.set_cargo", target_type="shared_kv", target_id=role)

        elif action == "set_perfil":   # bio + foto do PRÓPRIO usuário. v81.95
            uid = actor.get("id")
            cur = val["perfil"].get(uid) or {}
            if "bio" in body:
                cur["bio"] = (body.get("bio") or "").strip()[:1500]
            if "foto" in body:
                foto = body.get("foto") or ""
                # aceita dataURL de imagem pequena (redimensionada no front) — teto de segurança ~400KB
                if isinstance(foto, str) and (foto == "" or (foto.startswith("data:image/") and len(foto) <= 400000)):
                    cur["foto"] = foto
            val["perfil"][uid] = cur
            audit(self, actor, "funcoes.set_perfil", target_type="shared_kv", target_id=uid)

        else:
            return self._send(400, {"ok": False, "error": "action inválida"})

        try:
            _write(sb, val)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True})
