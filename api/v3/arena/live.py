"""GET /api/v3/arena/live — feed de eventos PSM (últimos 50, ordenado por ts desc)"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()
    def do_GET(self):
        try: user = require_user(self, min_lvl=0)
        except AuthError as e: return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb: return self._send(503, {"ok": False, "error": "backend"})
        now = datetime.now(timezone.utc)
        since = (now - timedelta(days=7)).isoformat()
        events = []
        # 1. Vendas RD (deals win=true closed last 7d)
        try:
            d = sb.table("deals").select("id,name,amount,closed_at,user_id,user_email,stage_name") \
                .eq("win", True).gte("closed_at", since).order("closed_at", desc=True).limit(20).execute().data or []
            for x in d:
                events.append({
                    "type": "venda", "ico": "🏆", "color": "#16a34a",
                    "ts": x["closed_at"], "title": "VENDA fechada",
                    "subtitle": f"R$ {float(x.get('amount') or 0):,.0f} · {x.get('name') or 'sem nome'}",
                    "actor_id": x.get("user_id"), "meta": x.get("stage_name"),
                })
        except Exception as e: print(f"[arena] deals err: {e}")
        # 2. Eventos (próximos 7d)
        try:
            today = now.date().isoformat()
            in7   = (now.date() + timedelta(days=7)).isoformat()
            ev = sb.table("eventos").select("id,tipo,titulo,data,hora_inicio,corretor_id") \
                .gte("data", today).lte("data", in7).order("data").limit(20).execute().data or []
            for x in ev:
                ico_map = {"plantao":"🛡","reuniao":"💼","visita":"🏠","tarefa":"✅","evento":"🎉"}
                events.append({
                    "type": "evento", "ico": ico_map.get(x.get("tipo"), "📅"), "color": "#2563eb",
                    "ts": (x.get("data") or "") + "T" + (x.get("hora_inicio") or "12:00:00"),
                    "title": x.get("titulo"), "subtitle": x.get("tipo"),
                    "actor_id": x.get("corretor_id"), "meta": x.get("data"),
                })
        except Exception as e: print(f"[arena] eventos err: {e}")
        # 3. Recados ativos
        try:
            now_iso = now.isoformat()
            rec = sb.table("recados").select("id,texto,autor_id,prioridade,data_inicio") \
                .or_(f"data_fim.is.null,data_fim.gte.{now_iso}") \
                .gte("data_inicio", since) \
                .order("data_inicio", desc=True).limit(15).execute().data or []
            for x in rec:
                p = x.get("prioridade") or "info"
                events.append({
                    "type": "recado", "ico": ("🔴" if p=="critica" else "⚠️" if p=="alerta" else "📢"),
                    "color": ("#dc2626" if p=="critica" else "#d97706" if p=="alerta" else "#2563eb"),
                    "ts": x.get("data_inicio"), "title": "RECADO " + p.upper(),
                    "subtitle": (x.get("texto") or "")[:140], "actor_id": x.get("autor_id"),
                })
        except Exception as e: print(f"[arena] recados err: {e}")
        # 4. Tarefas concluídas recentes
        try:
            tk = sb.table("dir_tasks").select("id,titulo,status,responsavel,updated_at") \
                .eq("status", "concluida").gte("updated_at", since) \
                .order("updated_at", desc=True).limit(10).execute().data or []
            for x in tk:
                events.append({
                    "type": "task", "ico": "✅", "color": "#16a34a",
                    "ts": x.get("updated_at"), "title": "TAREFA concluída",
                    "subtitle": x.get("titulo"), "actor_id": x.get("responsavel"),
                })
        except Exception as e: print(f"[arena] tasks err: {e}")
        # 5. Audit login_ok (atividade do time)
        try:
            au = sb.table("audit_log").select("actor_id,actor_name,ts").eq("action", "auth.login_ok") \
                .gte("ts", since).order("ts", desc=True).limit(15).execute().data or []
            for x in au:
                events.append({
                    "type": "login", "ico": "🔓", "color": "var(--ink-muted)",
                    "ts": x.get("ts"), "title": f"{x.get('actor_name') or 'user'} entrou",
                    "subtitle": "", "actor_id": x.get("actor_id"),
                })
        except Exception as e: print(f"[arena] audit err: {e}")
        # Enrich actors
        actor_ids = list({e.get("actor_id") for e in events if e.get("actor_id")})
        actors = {}
        if actor_ids:
            try:
                u = sb.table("users").select("id,name,ini,color").in_("id", actor_ids).execute().data or []
                actors = {x["id"]: x for x in u}
            except Exception: pass
        for e in events:
            e["actor"] = actors.get(e.get("actor_id"))
        # Sort by ts desc
        events.sort(key=lambda x: x.get("ts") or "", reverse=True)
        events = events[:50]
        return self._send(200, {"ok": True, "count": len(events), "events": events, "since": since, "fetched_at": now.isoformat()})
