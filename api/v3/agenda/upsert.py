"""
POST /api/v3/agenda/upsert
Body: { id?, tipo, titulo, descricao?, data, hora_inicio?, hora_fim?, all_day?,
        corretor_id?, participantes?[], local?, cor?, status?, lembrete_min? }
Header: Authorization: Bearer <token>

Cria ou atualiza evento. Todos podem criar.
Update: apenas Sócio/Gerente OU criador OU corretor_id do evento.

v87.81 — avisos (sino + push), sempre só pra quem é afetado (regra de alçada):
  • convidado NOVO recebe o convite na hora (antes ele só descobria abrindo a Agenda);
  • quem vira responsável por um compromisso criado por outra pessoa é avisado;
  • mudou data/horário/local ou cancelou → avisa responsável e convidados que aceitaram.
lembrete_min: minutos antes do horário (-1 = sem lembrete; null = padrão de cada um).
Escrita tolerante: se a coluna lembrete_min ainda não existir no banco, o save segue sem ela.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
from _zoho_push import push_evento  # type: ignore


def _marcar_pendentes(row, criador):
    """Convidado NOVO nasce 'pendente' — ele decide se entra na agenda dele.
    Criador e responsável NÃO entram: é trabalho deles, não convite.
    Quem já estava no evento mantém o aceite que tinha (não re-convida ninguém
    a cada edição)."""
    parts = row.get("participantes") or []
    if not isinstance(parts, list):
        return row
    aceites = dict(row.get("aceites") or {})
    dono = {criador, row.get("corretor_id"), row.get("owner_id")}
    for p in parts:
        if p in dono or not p:
            aceites.pop(p, None)      # dono nunca fica pendente
        elif p not in aceites:
            aceites[p] = "pendente"   # convidado novo
    for p in list(aceites.keys()):
        if p not in parts:
            aceites.pop(p, None)      # saiu do evento, some a marca
    row["aceites"] = aceites
    return row


def _push_zoho(sb, ev, antes):
    """Espelha no Zoho na hora. O evento vai pro calendário do DONO (criador ou
    corretor responsável). Best-effort: se o Zoho falhar, o evento já está salvo
    no House e o cron de 2 min reconcilia — o save do usuário nunca quebra."""
    try:
        dono = ev.get("owner_id") or ev.get("corretor_id") or ev.get("criado_por")
        if not dono:
            return {}
        patch = push_evento(sb, ev, dono)
        if patch:
            sb.table("eventos").update({**patch, "owner_id": dono}).eq("id", ev["id"]).execute()
        return patch
    except Exception:
        return {}


def _safe_write(build, row):
    """insert/update tolerante a coluna ausente (PGRST204): tira a coluna e tenta
    de novo. Mesmo padrão do tasks/upsert."""
    r = dict(row)
    for _ in range(8):
        try:
            return build(r).execute()
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                r.pop(m.group(1), None)
                continue
            raise
    return build(r).execute()


def _quando(ev):
    d = str(ev.get("data") or "")[:10]
    dd = "/".join(reversed(d.split("-"))) if d else ""
    hi = str(ev.get("hora_inicio") or "")[:5]
    return f"{dd} {hi}".strip() if hi else f"{dd} · dia todo"


def _avisar(uids, actor, tipo, title, ev):
    alvo = [u for u in set(uids or []) if u and u != actor.get("id")]
    if not alvo:
        return
    try:
        corpo = f"{ev.get('titulo') or 'Compromisso'} · {_quando(ev)}"
        if ev.get("local"):
            corpo += f" · {ev.get('local')}"
        link = "#/?convites=1" if tipo == "evento.convite" else f"#/?item=evento:{ev.get('id')}"
        notify_all(alvo, tipo=tipo, title=title, body=corpo, link=link,
                   target_type="evento", target_id=ev.get("id"))
    except Exception as e:
        print(f"[agenda] notify err: {e}")


def _aceitos(ev):
    """Responsável + convidados que não estão pendentes nem recusaram."""
    ac = ev.get("aceites") or {}
    out = {ev.get("corretor_id")}
    for p in (ev.get("participantes") or []):
        if ac.get(p) not in ("pendente", "recusado"):
            out.add(p)
    return out - {None, ""}


def _lembrete_ok(v):
    if v is None or v == "":
        return True
    try:
        return -1 <= int(v) <= 10080
    except Exception:
        return False


ALLOWED_TIPO = {"plantao", "reuniao", "visita", "tarefa", "evento", "outro"}
ALLOWED_STATUS = {"agendado", "confirmado", "cancelado", "realizado"}


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        evento_id = (body.get("id") or "").strip() or None
        is_socio_gerente = (actor.get("lvl") or 0) >= 7

        # Validate
        tipo = (body.get("tipo") or "evento").strip().lower()
        if tipo not in ALLOWED_TIPO:
            return self._send(400, {"ok": False, "error": f"tipo inválido. Use: {sorted(ALLOWED_TIPO)}"})
        status = (body.get("status") or "agendado").strip().lower()
        if status not in ALLOWED_STATUS:
            return self._send(400, {"ok": False, "error": f"status inválido"})
        titulo = (body.get("titulo") or "").strip()
        if not titulo and not evento_id:
            return self._send(400, {"ok": False, "error": "titulo obrigatório"})
        if not body.get("data") and not evento_id:
            return self._send(400, {"ok": False, "error": "data obrigatória (YYYY-MM-DD)"})
        if not _lembrete_ok(body.get("lembrete_min")):
            return self._send(400, {"ok": False, "error": "lembrete inválido"})

        # Update
        if evento_id:
            try:
                cur = sb.table("eventos").select("*").eq("id", evento_id).limit(1).execute().data or []
                if not cur:
                    return self._send(404, {"ok": False, "error": "evento não encontrado"})
                cur = cur[0]
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})

            owner = cur.get("criado_por") == actor["id"] or cur.get("corretor_id") == actor["id"]
            if not is_socio_gerente and not owner:
                return self._send(403, {"ok": False, "error": "apenas Sócio/Gerente ou dono pode editar"})

            patch = {}
            for k in ("tipo", "titulo", "descricao", "data", "hora_inicio", "hora_fim",
                      "all_day", "corretor_id", "participantes", "local", "cor", "status", "lembrete_min"):
                if k in body:
                    patch[k] = body[k]
            if "titulo" in patch and not str(patch["titulo"] or "").strip():
                return self._send(400, {"ok": False, "error": "titulo não pode ficar vazio"})
            if "data" in patch and not patch["data"]:
                return self._send(400, {"ok": False, "error": "data obrigatória (YYYY-MM-DD)"})
            for k in ("descricao", "hora_inicio", "hora_fim", "corretor_id", "local", "cor", "lembrete_min"):
                if k in patch and patch[k] == "":
                    patch[k] = None
            if patch.get("lembrete_min") is not None:
                patch["lembrete_min"] = int(patch["lembrete_min"])

            if "participantes" in patch:   # mexeu na lista → recalcula convites
                base = {**cur, **patch}
                patch["aceites"] = _marcar_pendentes(base, cur.get("criado_por") or actor["id"])["aceites"]
            try:
                _safe_write(lambda r: sb.table("eventos").update(r).eq("id", evento_id), patch)
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"update: {e}"})

            audit(self, actor, "evento.update", target_type="evento", target_id=evento_id,
                  before={k: cur.get(k) for k in patch.keys()}, after=patch)

            novo = {**cur, **patch, "id": evento_id}
            # 📨 convidados novos (pendentes que não estavam pendentes antes)
            antes_ac = cur.get("aceites") or {}
            antes_parts = set(cur.get("participantes") or [])
            novos_conv = [p for p, m in (novo.get("aceites") or {}).items()
                          if m == "pendente" and (p not in antes_parts or antes_ac.get(p) != "pendente")]
            _avisar(novos_conv, actor, "evento.convite", f"📨 {actor.get('name')} te convidou", novo)
            # 👤 responsável novo
            if patch.get("corretor_id") and patch.get("corretor_id") != cur.get("corretor_id"):
                _avisar([patch["corretor_id"]], actor, "evento.atribuido",
                        f"📅 {actor.get('name')} marcou na sua agenda", novo)
            # 🔁 mudou quando/onde, ou cancelou → quem já contava com o compromisso
            mudou = any(str(novo.get(k) or "") != str(cur.get(k) or "") for k in ("data", "hora_inicio", "hora_fim", "local"))
            cancelou = novo.get("status") == "cancelado" and cur.get("status") != "cancelado"
            if mudou or cancelou:
                ja_avisados = set(novos_conv) | ({patch.get("corretor_id")} if patch.get("corretor_id") != cur.get("corretor_id") else set())
                alvo = (_aceitos(cur) | _aceitos(novo)) - ja_avisados
                if cancelou:
                    _avisar(alvo, actor, "evento.alterado", "❌ Compromisso cancelado", novo)
                else:
                    _avisar(alvo, actor, "evento.alterado", "🔁 Compromisso alterado", novo)

            # espelha no Zoho NA HORA (edição inclusa) — best-effort
            zres = _push_zoho(sb, novo, cur)
            return self._send(200, {"ok": True, "id": evento_id, "updated": True, "zoho": zres})

        # Create
        new_id = "ev_" + uuid.uuid4().hex[:12]
        row = {
            "id": new_id,
            "tipo": tipo,
            "titulo": titulo,
            "descricao": body.get("descricao") or None,
            "data": body["data"],
            "hora_inicio": body.get("hora_inicio") or None,
            "hora_fim": body.get("hora_fim") or None,
            "all_day": bool(body.get("all_day")),
            "corretor_id": body.get("corretor_id") or None,
            "participantes": body.get("participantes") or [],
            "local": body.get("local") or None,
            "cor": body.get("cor") or None,
            "status": status,
            "criado_por": actor["id"],
            "lembrete_min": (int(body["lembrete_min"]) if body.get("lembrete_min") not in (None, "") else None),
        }
        row = _marcar_pendentes(row, actor["id"])
        try:
            res = _safe_write(lambda r: sb.table("eventos").insert(r), row)
            inserted = (res.data or [row])[0]
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"insert: {e}"})

        audit(self, actor, "evento.create", target_type="evento", target_id=new_id, after=row)
        _avisar([p for p, m in (row.get("aceites") or {}).items() if m == "pendente"], actor,
                "evento.convite", f"📨 {actor.get('name')} te convidou", row)
        if row.get("corretor_id"):
            _avisar([row["corretor_id"]], actor, "evento.atribuido",
                    f"📅 {actor.get('name')} marcou na sua agenda", row)
        zres = _push_zoho(sb, row, None)
        return self._send(200, {"ok": True, "evento": {**inserted, **zres}, "created": True, "zoho": zres})
