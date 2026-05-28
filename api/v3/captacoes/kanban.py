"""GET/POST/DELETE /api/v3/captacoes/kanban — Captações Kanban (modelo Notion PSM)

GET (lvl>=2): lista todas captações
POST (lvl>=2):
  upsert: cria/edita captação (qualquer corretor cadastra)
  move:   muda status (Kanban drag) → notifica responsável
DELETE ?id=X (lvl>=5)

Notificações:
- Ao atribuir responsável → notifica ele
- Ao marcar precisa_fotos/precisa_videos → notifica Guilherme (marketing)
- Ao mudar status pra edição → notifica marketing
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, notify_all  # type: ignore


def _find_user_id(sb, nome):
    """Acha user_id por nome (primeiro nome). Retorna None se não achar."""
    if not nome: return None
    try:
        n = nome.strip().lower()
        rows = sb.table("users").select("id,name").execute().data or []
        for r in rows:
            full = (r.get("name") or "").lower()
            if full == n or full.split(" ")[0] == n or n in full:
                return r["id"]
    except Exception:
        pass
    return None


def _marketing_ids(sb):
    """IDs de quem faz fotos/vídeos (role marketing ou nome Guilherme)."""
    try:
        rows = sb.table("users").select("id,name,role").execute().data or []
        ids = [r["id"] for r in rows if (r.get("role") == "marketing") or ("guilherme" in (r.get("name") or "").lower() or "gui" == (r.get("name") or "").lower().split(" ")[0])]
        return ids
    except Exception:
        return []


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("captacoes").select("*").order("updated_at", desc=True).limit(1000).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(200, {"ok": True, "captacoes": rows})

    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except: return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        action = body.get("action") or "upsert"

        if action == "move":
            cid = body.get("id"); status = body.get("status")
            if not cid or not status: return self._send(400, {"ok": False, "error": "id e status obrigatórios"})
            try:
                cur = sb.table("captacoes").select("*").eq("id", cid).limit(1).execute().data or []
                cur = cur[0] if cur else {}
                sb.table("captacoes").update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", cid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "captacao.move", target_type="captacoes", target_id=cid, notes=f"→ {status}")
            desc = f"{cur.get('condominio') or 'Imóvel'} — {cur.get('proprietario') or ''}"
            # SEMPRE notifica o responsável (todos os canais) em qualquer movimentação
            try:
                resp_id = _find_user_id(sb, cur.get("responsavel"))
                if resp_id and resp_id != actor.get("id"):
                    notify_all([resp_id], "captacao", f"🔄 Captação movida → {status.replace('_', ' ')}",
                               desc, link="#/captacoes", target_type="captacoes", target_id=cid)
            except Exception: pass
            # Notifica marketing quando vai pra edição/captação realizada
            if status in ("edicao_fotos", "edicao_videos", "captacao_realizada"):
                try:
                    ids = _marketing_ids(sb)
                    if ids:
                        notify_all(ids, "captacao", f"📸 Captação em {status.replace('_', ' ')}",
                                   desc, link="#/captacoes", target_type="captacoes", target_id=cid)
                except Exception: pass
            return self._send(200, {"ok": True})

        # upsert
        is_new = not body.get("id")
        cid = body.get("id") or f"cap_{int(datetime.now().timestamp()*1000)}"
        row = {
            "id": cid,
            "objetivo": body.get("objetivo") or "venda",
            "tipo_imovel": (body.get("tipo_imovel") or "").strip() or None,
            "condominio": (body.get("condominio") or "").strip() or None,
            "localizacao": (body.get("localizacao") or "").strip() or None,
            "responsavel": (body.get("responsavel") or "").strip() or None,
            "status": body.get("status") or "colher_dados",
            "situacao_imovel": (body.get("situacao_imovel") or "").strip() or None,
            "pendencia": (body.get("pendencia") or "").strip() or None,
            "termo_autorizacao": (body.get("termo_autorizacao") or "").strip() or None,
            "proprietario": (body.get("proprietario") or "").strip() or None,
            "contato": (body.get("contato") or "").strip() or None,
            "email": (body.get("email") or "").strip() or None,
            "valor_venda": body.get("valor_venda"),
            "valor_locacao": (body.get("valor_locacao") or "").strip() or None,
            "codigo_kenlo": (body.get("codigo_kenlo") or "").strip() or None,
            "descricao": (body.get("descricao") or "").strip() or None,
            "observacao": (body.get("observacao") or "").strip() or None,
            "data_agendamento": body.get("data_agendamento") or None,
            "data_inicial": body.get("data_inicial") or None,
            "data_final": body.get("data_final") or None,
            "precisa_fotos": bool(body.get("precisa_fotos")),
            "precisa_videos": bool(body.get("precisa_videos")),
            "precisa_avaliacao": bool(body.get("precisa_avaliacao")),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if is_new:
            row["criado_por"] = actor.get("id")

        try:
            r = sb.table("captacoes").upsert(row).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        audit(self, actor, "captacao.upsert", target_type="captacoes", target_id=cid,
              notes=f"{row.get('condominio') or ''} · {row['status']}")

        # Notificações
        try:
            # Responsável: notificado em TODOS os canais a cada cadastro/edição
            resp_id = _find_user_id(sb, row.get("responsavel"))
            if resp_id and resp_id != actor.get("id"):
                titulo = "🎯 Captação atribuída a você" if is_new else "✏️ Captação atualizada"
                notify_all([resp_id], "captacao", titulo,
                           f"{row.get('condominio') or 'Imóvel'} — {row.get('proprietario') or ''}",
                           link="#/captacoes", target_type="captacoes", target_id=cid)
            # Marketing se precisa fotos/vídeos
            if row.get("precisa_fotos") or row.get("precisa_videos"):
                mids = _marketing_ids(sb)
                if mids:
                    precisa = []
                    if row.get("precisa_fotos"): precisa.append("fotos")
                    if row.get("precisa_videos"): precisa.append("vídeos")
                    notify_all(mids, "captacao", f"📸 Captação precisa de {' + '.join(precisa)}",
                               f"{row.get('condominio') or 'Imóvel'} — {row.get('localizacao') or ''}",
                               link="#/captacoes", target_type="captacoes", target_id=cid)
        except Exception:
            pass

        return self._send(200, {"ok": True, "row": (r.data or [row])[0]})

    def do_DELETE(self):
        try: actor = require_user(self, min_lvl=5)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except: params = {}
        cid = params.get("id")
        if not cid: return self._send(400, {"ok": False, "error": "id obrigatório"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        try:
            sb.table("captacoes").delete().eq("id", cid).execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, actor, "captacao.delete", target_type="captacoes", target_id=cid)
        return self._send(200, {"ok": True})
