"""GET/POST /api/v3/profile — Meu Painel: perfil de desenvolvimento + metas (v77.50).
Para TODOS os usuários (corretor, marketing, adm, financeiro…).

GET  ?user_id=<id>   → { ok, user, profile, feedbacks:[...], can_edit }
                       (sem user_id = o próprio; ver de outro exige lvl≥5)
POST { user_id?, data_inicio, contrato_url, perfil_comportamental,
       meta_produtividade, meta_resultado, metas_pessoais, pontos_atencao, rotina }
                       → salva (próprio sempre; de outro exige lvl≥5)
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, lvl_of  # type: ignore

def _pode_gerir(sb, actor, target_id):
    """v88.52: quem pode ver/editar dados de gestão (perfil, 1:1) de outra pessoa.
    Sócio (lvl 10) → todos. Própria pessoa → sim. Gestor (lvl ≥ 5) → só alguém da PRÓPRIA equipe
    com nível MENOR que o dele. Antes qualquer lvl 5 lia/editava perfil e 1:1 de qualquer um,
    inclusive de sócios e de outras equipes."""
    lvl = actor.get("lvl") or 0
    if not target_id or target_id == actor.get("id") or lvl >= 10:
        return True
    if lvl < 5:
        return False
    try:
        r = sb.table("users").select("team,role").eq("id", target_id).limit(1).execute().data or []
    except Exception:
        return False
    if not r:
        return False
    alvo = r[0]
    mesma_equipe = (alvo.get("team") or "").strip().lower() == (actor.get("team") or "").strip().lower()
    return mesma_equipe and lvl_of(alvo.get("role")) < lvl


FIELDS = ["data_inicio", "contrato_url", "perfil_comportamental",
          "meta_produtividade", "meta_resultado", "metas_pessoais",
          "pontos_atencao", "rotina"]


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
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        target = (q.get("user_id") or "").strip() or actor.get("id")
        is_self = target == actor.get("id")
        is_mgr = (actor.get("lvl") or 0) >= 5
        if not is_self and not is_mgr:
            return self._send(403, {"ok": False, "error": "requer nível ≥ 5 p/ ver outro usuário"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if not is_self and not _pode_gerir(sb, actor, target):
            return self._send(403, {"ok": False, "error": "só a própria equipe (e abaixo do seu nível)"})
        # usuário alvo
        try:
            urows = sb.table("users").select("id,name,email,role,team,color,ini,status,last_login_at").eq("id", target).limit(1).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if not urows:
            return self._send(404, {"ok": False, "error": "usuário não encontrado"})
        user = urows[0]
        # perfil
        prof = {}
        try:
            prows = sb.table("user_profile").select("*").eq("user_id", target).limit(1).execute().data or []
            prof = prows[0] if prows else {}
        except Exception as e:
            # tabela ainda não criada → não quebra o painel
            return self._send(200, {"ok": True, "user": user, "profile": {}, "feedbacks": [],
                                    "can_edit": is_self or is_mgr, "pending": "rode supabase/sprint_user_profile.sql"})
        # feedbacks do One-on-One
        feedbacks = []
        try:
            oo = (sb.table("one_on_ones").select("id,data,observacoes,acoes,lider_id,proxima_data")
                  .eq("corretor_id", target).order("data", desc=True).limit(20).execute().data or [])
            lider_ids = list({r.get("lider_id") for r in oo if r.get("lider_id")})
            names = {}
            if lider_ids:
                lr = sb.table("users").select("id,name").in_("id", lider_ids).execute().data or []
                names = {u["id"]: u.get("name") for u in lr}
            for r in oo:
                r["lider_nome"] = names.get(r.get("lider_id"), "")
                feedbacks.append(r)
        except Exception:
            feedbacks = []
        return self._send(200, {"ok": True, "user": user, "profile": prof,
                                "feedbacks": feedbacks, "can_edit": is_self or is_mgr})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        target = (body.get("user_id") or "").strip() or actor.get("id")
        is_self = target == actor.get("id")
        is_mgr = (actor.get("lvl") or 0) >= 5
        if not is_self and not is_mgr:
            return self._send(403, {"ok": False, "error": "requer nível ≥ 5 p/ editar outro usuário"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if not is_self and not _pode_gerir(sb, actor, target):
            return self._send(403, {"ok": False, "error": "só a própria equipe (e abaixo do seu nível)"})
        row = {"user_id": target, "updated_at": datetime.now(timezone.utc).isoformat(),
               "updated_by": actor.get("id")}
        for k in FIELDS:
            if k in body:
                v = body.get(k)
                if isinstance(v, str):
                    v = v.strip() or None
                row[k] = v
        try:
            sb.table("user_profile").upsert(row).execute()
            audit(self, actor, "profile.save", target_type="user_profile", target_id=target)
            return self._send(200, {"ok": True})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e), "pending": "rode supabase/sprint_user_profile.sql"})
