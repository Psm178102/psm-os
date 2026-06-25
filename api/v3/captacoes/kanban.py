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
import json, os, re, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify, notify_all  # type: ignore

# ── Etapas do Kanban (devem casar EXATAMENTE com as colunas do front) ─────────
# Blindagem v81.59: garante que TODA captação tenha um status válido. Sem isso,
# um status que não bate com nenhuma coluna (ex.: "publicada" vindo do RD, ou
# "colher_dados" legado) some do kanban — o card vira órfão (invisível).
VALID_ETAPAS = {
    "a_fazer", "agendar_prop", "agendado", "pausado", "captacao_realizada",
    "edicao_fotos", "edicao_videos", "aprovacao", "formulario_kenlo",
    "subir_kenlo", "agendar_mlabs", "refazer", "concluido",
}
# Apelidos de estágios externos (RD / builds antigos) → etapa válida.
ETAPA_ALIASES = {
    "publicada": "concluido", "publicado": "concluido", "anunciada": "concluido",
    "anunciado": "concluido", "no_ar": "concluido", "no ar": "concluido",
    "finalizada": "concluido", "finalizado": "concluido", "concluída": "concluido",
    "concluida": "concluido", "em_revisao": "aprovacao", "revisao": "aprovacao",
    "colher_dados": "a_fazer", "colher dados": "a_fazer",
}


def _norm_etapa(s):
    """Devolve SEMPRE uma etapa válida do kanban (nenhum card fica órfão).
    Conhecida → ela mesma; apelido → mapeada; desconhecida → 'a_fazer'
    (reaparece no início do funil, nunca some). v81.59"""
    k = (s or "").strip().lower()
    if k in VALID_ETAPAS:
        return k
    return ETAPA_ALIASES.get(k, "a_fazer")


def _safe_upsert(sb, table, row):
    """Upsert tolerante: se uma coluna não existir no banco (migração ainda não
    rodada → PGRST204), remove essa coluna e tenta de novo, em vez de quebrar o
    save inteiro. Os campos sem coluna simplesmente não persistem até rodar o SQL."""
    r = dict(row)
    dropped = []
    for _ in range(15):
        try:
            return sb.table(table).upsert(r).execute(), dropped
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                dropped.append(m.group(1))
                r.pop(m.group(1), None)
                continue
            raise
    return sb.table(table).upsert(r).execute(), dropped


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


def _all_active_ids(sb, exclude=None):
    """IDs de TODOS os usuários ativos (sino notifica a equipe inteira em qualquer
    alteração de captação). Exclui quem disparou a ação pra não notificar a si mesmo."""
    try:
        rows = sb.table("users").select("id,status").execute().data or []
        out = [r["id"] for r in rows if r.get("id") and (r.get("status") or "ativo") != "inativo"]
        if exclude:
            out = [i for i in out if i != exclude]
        return out
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
        # v81.59: blinda a exibição — qualquer status órfão cai numa coluna válida
        for r in rows:
            r["status"] = _norm_etapa(r.get("status"))
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
            cid = body.get("id"); raw_status = (body.get("status") or "").strip()
            if not cid or not raw_status: return self._send(400, {"ok": False, "error": "id e status obrigatórios"})
            status = _norm_etapa(raw_status)   # v81.59: nunca grava etapa inválida
            try:
                cur = sb.table("captacoes").select("*").eq("id", cid).limit(1).execute().data or []
                cur = cur[0] if cur else {}
                now_iso = datetime.now(timezone.utc).isoformat()
                sb.table("captacoes").update({"status": status, "updated_at": now_iso}).eq("id", cid).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            # carimba a entrada na etapa só quando a etapa REALMENTE muda — best-effort
            # (base do "X dias parado nesta etapa" no cartão; coluna stage_changed_at
            #  pode não existir até rodar o SQL, então não pode quebrar o move — v77.48)
            if (cur.get("status") or "") != status:
                try: sb.table("captacoes").update({"stage_changed_at": now_iso}).eq("id", cid).execute()
                except Exception: pass
            audit(self, actor, "captacao.move", target_type="captacoes", target_id=cid, notes=f"→ {status}")
            desc = f"{cur.get('condominio') or 'Imóvel'} — {cur.get('proprietario') or ''}"
            # SEMPRE notifica o responsável (todos os canais) em qualquer movimentação
            try:
                resp_id = cur.get("responsavel_id") or _find_user_id(sb, cur.get("responsavel"))
                if resp_id and resp_id != actor.get("id"):
                    notify_all([resp_id], "captacao", f"🔄 Captação movida → {status.replace('_', ' ')}",
                               desc, link="#/captacoes", target_type="captacoes", target_id=cid)
            except Exception: pass
            # Sino pra TODOS os ativos (in-app; push fica só pro responsável acima)
            try:
                notify(_all_active_ids(sb, exclude=actor.get("id")), "captacao",
                       f"🔄 Captação movida → {status.replace('_', ' ')}", desc,
                       link="#/captacoes", target_type="captacoes", target_id=cid)
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
            "nome_imovel": (body.get("nome_imovel") or "").strip() or None,
            "tipo_imovel": (body.get("tipo_imovel") or "").strip() or None,
            "condominio": (body.get("condominio") or "").strip() or None,
            "endereco": (body.get("endereco") or "").strip() or None,
            "bairro": (body.get("bairro") or "").strip() or None,
            "quadra": (body.get("quadra") or "").strip() or None,
            "lote": (body.get("lote") or "").strip() or None,
            "bloco": (body.get("bloco") or "").strip() or None,
            "unidade": (body.get("unidade") or "").strip() or None,
            "localizacao": (body.get("localizacao") or "").strip() or None,
            "responsavel": (body.get("responsavel") or "").strip() or None,
            "responsavel_id": (body.get("responsavel_id") or "").strip() or None,
            "status": _norm_etapa(body.get("status") or "a_fazer"),   # v81.59: sempre etapa válida
            "situacao_imovel": (body.get("situacao_imovel") or "").strip() or None,
            "local_chaves": (body.get("local_chaves") or "").strip() or None,
            "pendencia": (body.get("pendencia") or "").strip() or None,
            "termo_autorizacao": (body.get("termo_autorizacao") or "").strip() or None,
            "proprietario": (body.get("proprietario") or "").strip() or None,
            "contato": (body.get("contato") or "").strip() or None,
            "email": (body.get("email") or "").strip() or None,
            "valor_venda": body.get("valor_venda"),
            "valor_locacao": (str(body.get("valor_locacao")).strip() if body.get("valor_locacao") not in (None, "") else None),
            "valor_condominio": body.get("valor_condominio"),
            "valor_iptu": body.get("valor_iptu"),
            "taxa_adm_tipo": (body.get("taxa_adm_tipo") or "").strip() or None,
            "taxa_adm_valor": body.get("taxa_adm_valor"),
            "link_fotos": (body.get("link_fotos") or "").strip() or None,
            "link_videos": (body.get("link_videos") or "").strip() or None,
            "codigo_kenlo": (body.get("codigo_kenlo") or "").strip() or None,
            "descricao": (body.get("descricao") or "").strip() or None,
            "observacao": (body.get("observacao") or "").strip() or None,
            "data_agendamento": body.get("data_agendamento") or None,
            "hora_inicio": (body.get("hora_inicio") or "").strip() or None,
            "hora_fim": (body.get("hora_fim") or "").strip() or None,
            "link_autorizacao": (body.get("link_autorizacao") or "").strip() or None,
            "data_inicial": body.get("data_inicial") or None,
            "data_final": body.get("data_final") or None,
            "data_inicio": body.get("data_inicio") or None,    # demanda: início / entrega / post v81.35
            "data_entrega": body.get("data_entrega") or None,
            "data_post": body.get("data_post") or None,
            "precisa_fotos": bool(body.get("precisa_fotos")),
            "precisa_videos": bool(body.get("precisa_videos")),
            "precisa_avaliacao": bool(body.get("precisa_avaliacao")),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if is_new:
            row["criado_por"] = actor.get("id")
            row["stage_changed_at"] = row["updated_at"]  # entrou na etapa agora (v77.48)

        try:
            r, dropped = _safe_upsert(sb, "captacoes", row)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        if dropped:
            print(f"[captacoes] colunas ausentes ignoradas (rode sprint9_16/9_17): {dropped}")

        audit(self, actor, "captacao.upsert", target_type="captacoes", target_id=cid,
              notes=f"{row.get('condominio') or ''} · {row['status']}")

        # Notificações
        try:
            # Responsável: notificado em TODOS os canais a cada cadastro/edição
            resp_id = row.get("responsavel_id") or _find_user_id(sb, row.get("responsavel"))
            if resp_id and resp_id != actor.get("id"):
                titulo = "🎯 Captação atribuída a você" if is_new else "✏️ Captação atualizada"
                notify_all([resp_id], "captacao", titulo,
                           f"{row.get('condominio') or 'Imóvel'} — {row.get('proprietario') or ''}",
                           link="#/captacoes", target_type="captacoes", target_id=cid)
            # Sino pra TODOS os ativos (in-app) a cada cadastro/edição
            _tt = "🎯 Nova captação" if is_new else "✏️ Captação atualizada"
            notify(_all_active_ids(sb, exclude=actor.get("id")), "captacao", _tt,
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

        return self._send(200, {"ok": True, "row": (r.data or [row])[0], "dropped": dropped})

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
