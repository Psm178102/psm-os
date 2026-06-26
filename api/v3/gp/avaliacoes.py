"""GET/POST /api/v3/gp/avaliacoes — Avaliações & Feedbacks (gestão de desempenho). v81.90

Módulo completo:
- CONFIG (shared_kv 'aval_config'): modelo de competências por cargo + ciclos + escala.
- AVALIAÇÕES (tabela gp_avaliacoes): auto / gestor / 360° (par/subordinado), scorecard de
  competências com peso → nota_final, 9-box (desempenho×potencial), calibração.
- FEEDBACK contínuo & KUDOS (tabela gp_feedbacks): elogio / melhoria / 1:1 / reconhecimento.
- PDI: gera registro no Plano de Crescimento (rh_registros 'plano') a partir de uma avaliação.

GET (lvl>=2): { ok, config, avaliacoes, feedbacks, me }.
  Escopo: lvl>=5 (gestão) vê tudo; demais veem só as próprias (avaliado/avaliador) + kudos públicos.

POST (action):
  - 'config'        (lvl>=5):  merge competencias/ciclos/escala.
  - 'save'          (lvl>=2):  upsert avaliação (avaliador = actor); calcula nota_final.
  - 'calibrar'      (lvl>=7):  define nota_calibrada de uma avaliação.
  - 'delete'        (dono/lvl>=7): remove avaliação.
  - 'feedback'      (lvl>=2):  adiciona feedback/kudos.
  - 'feedback_del'  (autor/lvl>=7): remove feedback.
  - 'gerar_pdi'     (lvl>=5):  cria entrada no Plano de Crescimento a partir da avaliação.
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore

CFG_KEY = "aval_config"
NOW = lambda: datetime.now(timezone.utc).isoformat()


def _safe_write(build, row):
    """insert/update tolerante: dropa coluna inexistente (PGRST204) e tenta de novo."""
    r = dict(row); dropped = []
    for _ in range(20):
        try:
            return build(r).execute(), dropped
        except Exception as e:
            m = re.search(r"Could not find the '([^']+)' column", str(e))
            if m and m.group(1) in r:
                dropped.append(m.group(1)); r.pop(m.group(1), None); continue
            raise
    return build(r).execute(), dropped


def _read_cfg(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", CFG_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else {}
        if isinstance(val, str):
            val = json.loads(val)
    except Exception:
        val = {}
    if not isinstance(val, dict):
        val = {}
    val.setdefault("competencias", {})   # { cargo: [ {id, nome, peso} ] }
    val.setdefault("ciclos", [])         # [ {id, nome, tipo, inicio, fim, status, formatos[], escala} ]
    val.setdefault("escala", 5)
    return val


def _write_cfg(sb, val):
    sb.table("shared_kv").upsert({"key": CFG_KEY, "value": val, "updated_at": NOW()},
                                 on_conflict="key").execute()


def _nota_final(notas, comps, escala):
    """média ponderada das competências (na escala). notas={comp_id: valor}."""
    tot_p = 0.0; tot = 0.0
    for c in (comps or []):
        cid = c.get("id"); peso = float(c.get("peso") or 1)
        v = notas.get(cid) if isinstance(notas, dict) else None
        try:
            v = float(v)
        except Exception:
            continue
        tot += v * peso; tot_p += peso
    if tot_p <= 0:
        return None
    return round(tot / tot_p, 2)


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    # ─────────────────────────── GET ───────────────────────────
    def do_GET(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        cfg = _read_cfg(sb)
        uid = actor.get("id"); lvl = actor.get("lvl") or 0
        try:
            avs = sb.table("gp_avaliacoes").select("*").order("criado_em", desc=True).limit(2000).execute().data or []
        except Exception:
            avs = []
        try:
            fbs = sb.table("gp_feedbacks").select("*").order("criado_em", desc=True).limit(1000).execute().data or []
        except Exception:
            fbs = []
        if lvl < 5:   # não-gestão: só o que é meu + kudos públicos
            avs = [a for a in avs if a.get("avaliado_id") == uid or a.get("avaliador_id") == uid]
            fbs = [f for f in fbs if f.get("para_id") == uid or f.get("de_id") == uid or f.get("publico")]
        return self._send(200, {"ok": True, "config": cfg, "avaliacoes": avs, "feedbacks": fbs,
                                "me": {"id": uid, "role": actor.get("role"), "lvl": lvl, "name": actor.get("name")}})

    # ─────────────────────────── POST ───────────────────────────
    def do_POST(self):
        try: actor = require_user(self, min_lvl=2)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        lvl = actor.get("lvl") or 0
        action = (body.get("action") or "").strip()

        # ── CONFIG (competências/ciclos/escala) ──
        if action == "config":
            if lvl < 5: return self._send(403, {"ok": False, "error": "só gestão (lvl≥5)"})
            cfg = _read_cfg(sb)
            if isinstance(body.get("competencias"), dict):
                cfg["competencias"] = body["competencias"]
            if isinstance(body.get("ciclos"), list):
                cfg["ciclos"] = body["ciclos"]
            if body.get("escala"):
                try: cfg["escala"] = max(2, min(10, int(body["escala"])))
                except Exception: pass
            try: _write_cfg(sb, cfg)
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "aval.config", target_type="shared_kv", target_id=CFG_KEY)
            return self._send(200, {"ok": True, "config": cfg})

        # ── SALVAR AVALIAÇÃO ──
        if action == "save":
            cfg = _read_cfg(sb)
            avaliado = (body.get("avaliado_id") or "").strip()
            if not avaliado: return self._send(400, {"ok": False, "error": "avaliado_id obrigatório"})
            cargo = (body.get("cargo") or "").strip()
            comps = cfg["competencias"].get(cargo) or cfg["competencias"].get("__geral__") or []
            notas = body.get("notas") if isinstance(body.get("notas"), dict) else {}
            nf = _nota_final(notas, comps, cfg.get("escala", 5))
            def _i(k):
                try: return int(body.get(k))
                except Exception: return None
            row = {
                "id": body.get("id") or f"av_{int(datetime.now().timestamp()*1000)}",
                "ciclo_id": (body.get("ciclo_id") or "").strip() or None,
                "avaliado_id": avaliado,
                "avaliador_id": actor.get("id"),
                "tipo": (body.get("tipo") or "gestor").strip()[:20],   # auto|gestor|par|subordinado
                "cargo": cargo or None,
                "notas": notas,
                "nota_final": nf,
                "desempenho": _i("desempenho"),   # 9-box X (1-3)
                "potencial": _i("potencial"),     # 9-box Y (1-3)
                "comentario": (body.get("comentario") or "").strip()[:4000] or None,
                "pontos_fortes": (body.get("pontos_fortes") or "").strip()[:4000] or None,
                "a_desenvolver": (body.get("a_desenvolver") or "").strip()[:4000] or None,
                "status": (body.get("status") or "rascunho").strip()[:20],
                "updated_at": NOW(),
            }
            existing = None
            if body.get("id"):
                try:
                    ex = sb.table("gp_avaliacoes").select("avaliador_id,nota_calibrada,criado_em").eq("id", body["id"]).limit(1).execute().data or []
                    existing = ex[0] if ex else None
                except Exception:
                    existing = None
            if existing and existing.get("avaliador_id") not in (actor.get("id"),) and lvl < 7:
                return self._send(403, {"ok": False, "error": "só o avaliador ou gestão edita"})
            if not existing:
                row["criado_em"] = NOW()
            try:
                if existing:
                    res, _d = _safe_write(lambda r: sb.table("gp_avaliacoes").update(r).eq("id", row["id"]), row)
                else:
                    res, _d = _safe_write(lambda r: sb.table("gp_avaliacoes").insert(r), row)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "aval.save", target_type="gp_avaliacoes", target_id=row["id"], notes=row["tipo"])
            # notifica o avaliado quando ENVIADA por outra pessoa
            if row["status"] == "enviado" and avaliado != actor.get("id"):
                try:
                    notify_all([avaliado], tipo="aval.recebida",
                               title=f"⭐ {actor.get('name')} registrou uma avaliação sua",
                               body=row.get("comentario") or "", link="#/rh-avaliacoes",
                               target_type="avaliacao", target_id=row["id"])
                except Exception:
                    pass
            return self._send(200, {"ok": True, "row": (res.data or [row])[0]})

        # ── CALIBRAR (gestão sênior ajusta a nota) ──
        if action == "calibrar":
            if lvl < 7: return self._send(403, {"ok": False, "error": "só gestão sênior (lvl≥7)"})
            aid = (body.get("id") or "").strip()
            try: nc = float(body.get("nota_calibrada"))
            except Exception: nc = None
            if not aid: return self._send(400, {"ok": False, "error": "id obrigatório"})
            try:
                _safe_write(lambda r: sb.table("gp_avaliacoes").update(r).eq("id", aid),
                            {"nota_calibrada": nc, "calibrado_por": actor.get("id"), "updated_at": NOW()})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "aval.calibrar", target_type="gp_avaliacoes", target_id=aid)
            return self._send(200, {"ok": True})

        # ── DELETE avaliação ──
        if action == "delete":
            aid = (body.get("id") or "").strip()
            if not aid: return self._send(400, {"ok": False, "error": "id"})
            try:
                ex = sb.table("gp_avaliacoes").select("avaliador_id").eq("id", aid).limit(1).execute().data or []
            except Exception:
                ex = []
            if ex and ex[0].get("avaliador_id") != actor.get("id") and lvl < 7:
                return self._send(403, {"ok": False, "error": "sem permissão"})
            try: sb.table("gp_avaliacoes").delete().eq("id", aid).execute()
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "aval.delete", target_type="gp_avaliacoes", target_id=aid)
            return self._send(200, {"ok": True})

        # ── FEEDBACK contínuo / KUDOS ──
        if action == "feedback":
            para = (body.get("para_id") or "").strip()
            texto = (body.get("texto") or "").strip()
            if not para or not texto:
                return self._send(400, {"ok": False, "error": "para_id e texto"})
            row = {
                "id": f"fb_{int(datetime.now().timestamp()*1000)}",
                "para_id": para, "de_id": actor.get("id"),
                "tipo": (body.get("tipo") or "elogio").strip()[:20],   # elogio|melhoria|1a1|reconhecimento
                "texto": texto[:3000],
                "publico": bool(body.get("publico")),
                "ciclo_id": (body.get("ciclo_id") or "").strip() or None,
                "criado_em": NOW(),
            }
            try:
                res, _d = _safe_write(lambda r: sb.table("gp_feedbacks").insert(r), row)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            if para != actor.get("id"):
                try:
                    notify_all([para], tipo="feedback.novo",
                               title=f"💬 {actor.get('name')} te deixou um feedback",
                               body=texto[:120], link="#/rh-avaliacoes",
                               target_type="feedback", target_id=row["id"])
                except Exception:
                    pass
            audit(self, actor, "aval.feedback", target_type="gp_feedbacks", target_id=row["id"], notes=row["tipo"])
            return self._send(200, {"ok": True, "row": (res.data or [row])[0]})

        if action == "feedback_del":
            fid = (body.get("id") or "").strip()
            if not fid: return self._send(400, {"ok": False, "error": "id"})
            try:
                ex = sb.table("gp_feedbacks").select("de_id").eq("id", fid).limit(1).execute().data or []
            except Exception:
                ex = []
            if ex and ex[0].get("de_id") != actor.get("id") and lvl < 7:
                return self._send(403, {"ok": False, "error": "sem permissão"})
            try: sb.table("gp_feedbacks").delete().eq("id", fid).execute()
            except Exception as e: return self._send(500, {"ok": False, "error": str(e)})
            return self._send(200, {"ok": True})

        # ── GERAR PDI (Plano de Crescimento) ──
        if action == "gerar_pdi":
            if lvl < 5: return self._send(403, {"ok": False, "error": "só gestão (lvl≥5)"})
            pessoa = (body.get("pessoa") or "").strip()
            competencias = (body.get("a_desenvolver") or "").strip()
            rec = {
                "id": f"reg_{int(datetime.now().timestamp()*1000)}",
                "pessoa": pessoa or "—",
                "competencias": competencias or None,
                "status": "Em andamento",
                "obs": "Gerado a partir de uma avaliação de desempenho.",
                "criado_em": NOW(),
            }
            try:
                cur = sb.table("shared_kv").select("value").eq("key", "rh_registros").limit(1).execute().data or []
                val = cur[0]["value"] if cur else {}
                if isinstance(val, str): val = json.loads(val)
                if not isinstance(val, dict): val = {}
                val.setdefault("plano", [])
                val["plano"].insert(0, rec)
                sb.table("shared_kv").upsert({"key": "rh_registros", "value": val, "updated_at": NOW()},
                                             on_conflict="key").execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "aval.gerar_pdi", target_type="shared_kv", target_id="rh_registros", notes=pessoa[:60])
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": "action inválida"})
