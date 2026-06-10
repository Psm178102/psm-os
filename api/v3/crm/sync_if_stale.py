"""GET /api/v3/crm/sync_if_stale[?hours=6]
Auto-cura do sync RD: se o último sync (max synced_at em deals) tiver mais de
N horas (default 6), roda um sync incremental (2 páginas × funil ≈ os deals
mais recentes) e retorna o resultado; senão responde {fresh:true} em ~0,1s.

Por quê: o cron do Vercel parou de disparar (limite do plano) e os dados do RD
ficaram 2 dias velhos sem ninguém perceber. Com isso, o PRÓPRIO USO do sistema
mantém o dado fresco — qualquer usuário logado (lvl>=0) pode chamar, porque a
ação é segura: só dispara um refresh idempotente quando está velho (upsert por
id; corrida dupla = trabalho repetido inofensivo). Chamado pelo main.js no boot.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time, urllib.parse, urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from sync import _rd_page, _deal_to_row, _list_pipelines  # type: ignore

PAGES_PER_PIPE = 2  # ~200×2×N funis dos deals mais recentes — cobre dias de atividade


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        try:
            thresh_h = max(1.0, float(q.get("hours") or 6))
        except Exception:
            thresh_h = 6.0

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        # idade do dado
        last = None
        try:
            rows = sb.table("deals").select("synced_at").order("synced_at", desc=True).limit(1).execute().data or []
            if rows and rows[0].get("synced_at"):
                last = datetime.fromisoformat(str(rows[0]["synced_at"]).replace("Z", "+00:00"))
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"synced_at: {e}"})
        now = datetime.now(timezone.utc)
        age_h = ((now - last).total_seconds() / 3600.0) if last else 9999.0
        if age_h < thresh_h:
            return self._send(200, {"ok": True, "fresh": True, "age_h": round(age_h, 2),
                                    "synced_at": last.isoformat() if last else None})

        token = os.environ.get("RD_API_TOKEN")
        if not token:
            return self._send(200, {"ok": False, "fresh": False, "age_h": round(age_h, 2),
                                    "error": "RD_API_TOKEN ausente"})

        # mini-sync (mesma mecânica do sync.py, enxuta)
        t0 = time.time()
        try:
            urows = sb.table("users").select("id,email").execute().data or []
            users_by_email = {(u.get("email") or "").lower(): u["id"] for u in urows if u.get("email")}
        except Exception:
            users_by_email = {}
        pipelines = _list_pipelines(sb, token) or [(None, None)]
        fetched = upserted = 0
        errors = []
        buf = []
        for pid, pname in pipelines:
            params = {"deal_pipeline_id": pid} if pid else {}
            for page in range(1, PAGES_PER_PIPE + 1):
                try:
                    data = _rd_page(token, params, page)
                except Exception as e:
                    errors.append(f"{pname or '-'} p{page}: {e}")
                    break
                deals = data.get("deals") or []
                if not deals:
                    break
                fetched += len(deals)
                try:
                    from _events_lib import record_changes  # type: ignore
                    record_changes(sb, deals, source="sync_auto")
                except Exception:
                    pass
                for d in deals:
                    if d.get("id"):
                        buf.append(_deal_to_row(d, users_by_email, pid, pname))
                if len(buf) >= 200:
                    try:
                        sb.table("deals").upsert(buf, on_conflict="id").execute()
                        upserted += len(buf)
                    except Exception as e:
                        errors.append(f"upsert: {e}")
                    buf = []
                if len(deals) < 200:
                    break
        if buf:
            try:
                sb.table("deals").upsert(buf, on_conflict="id").execute()
                upserted += len(buf)
            except Exception as e:
                errors.append(f"upsert final: {e}")
        try:
            audit(self, actor, "crm.sync_auto", target_type="deals", target_id="*",
                  notes=f"stale {age_h:.1f}h -> upserted={upserted} em {time.time()-t0:.1f}s")
        except Exception:
            pass
        return self._send(200, {"ok": len(errors) == 0, "fresh": False, "was_stale_h": round(age_h, 2),
                                "fetched": fetched, "upserted": upserted, "errors": errors,
                                "duration_s": round(time.time() - t0, 2),
                                "synced_at": datetime.now(timezone.utc).isoformat()})
