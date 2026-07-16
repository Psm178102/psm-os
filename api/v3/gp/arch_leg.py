"""
GET/POST /api/v3/gp/arch_leg — Consultoria Arch Leg (desenvolvimento humano). v84.78

Fichas de acompanhamento que a consultoria Arch Leg (Marcos Anderson) preenche
POR PESSOA e POR EQUIPE: nota, história, DISC (puxado do teste do sistema, não
guardado aqui), pontos fortes, pilar familiar, traumas, crenças limitantes
(espiritual/emocional/profissional), plano de progresso (objetivo+prazo), ponto
de atenção e materiais (links do Drive).

Guardado em shared_kv key 'arch_leg_dossies' = { "user:<id>": {ficha}, "team:<id>": {ficha} }.

DADO SENSÍVEL (traumas, pilar familiar, crenças pessoais). A trava vale AQUI, no
backend — não só no menu:
  VÊ E EDITA = sócio/diretor (lvl>=10) OU quem é da Arch Leg (role consultor_arch_leg).
Ninguém mais lê, nem por API. O DISC individual é lido à parte (profile/painel_extra,
que já é gated lvl>=5) — não é copiado pra cá, pra não duplicar dado comportamental.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "arch_leg_dossies"
ARCH_LEG_ROLES = ("consultor_arch_leg",)   # papéis da consultoria Arch Leg
MAX_STR = 6000
MAX_MAT = 60


def _now():
    return datetime.now(timezone.utc).isoformat()


def _pode(user):
    """A fronteira de segurança REAL. Sócio/diretor (lvl>=10) OU Arch Leg.
    Nenhum outro papel — nem gerente, nem RH, nem backoffice — toca nestes dados."""
    lvl = user.get("lvl") or 0
    role = (user.get("role") or "").lower()
    return lvl >= 10 or role in ARCH_LEG_ROLES


def _txt(v, n=MAX_STR):
    return (str(v or "").strip()[:n] or None)


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    return val if isinstance(val, dict) else {}


def _write(sb, val):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": val, "updated_at": _now()},
                                 on_conflict="key").execute()


def _chave(tipo, aid):
    tipo = "team" if str(tipo) == "team" else "user"
    aid = str(aid or "").strip()[:80]
    return f"{tipo}:{aid}" if aid else None


def _limpa_ficha(raw, antiga, user):
    """Monta a ficha a partir do que o front mandou, preservando o que não veio
    (edição é PATCH — a lição do incidente da Leire vale aqui também)."""
    a = antiga or {}
    def campo(k, dflt=None):
        return _txt(raw[k]) if k in raw else (a.get(k) if a.get(k) is not None else dflt)

    cr_in = raw.get("crencas") if isinstance(raw.get("crencas"), dict) else None
    cr_old = a.get("crencas") if isinstance(a.get("crencas"), dict) else {}
    crencas = {
        "espiritual": _txt(cr_in.get("espiritual")) if cr_in and "espiritual" in cr_in else cr_old.get("espiritual"),
        "emocional":  _txt(cr_in.get("emocional"))  if cr_in and "emocional"  in cr_in else cr_old.get("emocional"),
        "profissional": _txt(cr_in.get("profissional")) if cr_in and "profissional" in cr_in else cr_old.get("profissional"),
    }
    pl_in = raw.get("plano") if isinstance(raw.get("plano"), dict) else None
    pl_old = a.get("plano") if isinstance(a.get("plano"), dict) else {}
    plano = {
        "objetivo": _txt(pl_in.get("objetivo")) if pl_in and "objetivo" in pl_in else pl_old.get("objetivo"),
        "prazo":    _txt(pl_in.get("prazo"), 120) if pl_in and "prazo" in pl_in else pl_old.get("prazo"),
    }
    if isinstance(raw.get("materiais"), list):
        materiais = []
        for m in raw["materiais"][:MAX_MAT]:
            if not isinstance(m, dict):
                continue
            url = _txt(m.get("url"), 800)
            if not url:
                continue
            materiais.append({"nome": _txt(m.get("nome"), 200) or url, "url": url,
                              "tipo": _txt(m.get("tipo"), 20) or "link"})
    else:
        materiais = a.get("materiais") or []

    return {
        "nota": campo("nota"),
        "historia": campo("historia"),
        "pontos_fortes": campo("pontos_fortes"),
        "pilar_familiar": campo("pilar_familiar"),
        "traumas": campo("traumas"),
        "crencas": crencas,
        "plano": plano,
        "ponto_atencao": campo("ponto_atencao"),
        "materiais": materiais,
        "atualizado_por": user.get("id"),
        "atualizado_por_nome": user.get("name"),
        "atualizado_em": _now(),
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
        if not _pode(user):
            return self._send(403, {"ok": False, "error": "Área restrita: só sócios e a consultoria Arch Leg."})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        dossies = _read(sb)
        return self._send(200, {"ok": True, "dossies": dossies,
                                "eh_arch_leg": (user.get("role") or "").lower() in ARCH_LEG_ROLES,
                                "eh_socio": (user.get("lvl") or 0) >= 10})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        if not _pode(user):
            return self._send(403, {"ok": False, "error": "Área restrita: só sócios e a consultoria Arch Leg."})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n else "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = (body.get("action") or "upsert").strip()
        chave = _chave(body.get("alvo_tipo"), body.get("alvo_id"))
        if not chave:
            return self._send(400, {"ok": False, "error": "alvo_tipo (user|team) + alvo_id obrigatórios"})

        dossies = _read(sb)
        if action == "delete":
            existia = dossies.pop(chave, None) is not None
            _write(sb, dossies)
            audit(self, user, "arch_leg.delete", "shared_kv", chave)
            return self._send(200, {"ok": True, "removido": existia})

        ficha = _limpa_ficha(body, dossies.get(chave), user)
        dossies[chave] = ficha
        _write(sb, dossies)
        audit(self, user, "arch_leg.upsert", "shared_kv", chave,
              notes=f"{chave} por {user.get('name')}")
        return self._send(200, {"ok": True, "chave": chave, "ficha": ficha})
