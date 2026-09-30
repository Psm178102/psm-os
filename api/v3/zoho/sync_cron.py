"""
GET /api/v3/zoho/sync_cron — cron: sincroniza TODOS os usuários conectados.
Agendado no vercel.json DE 1 EM 1 MINUTO (v89.9 — "tem que ser em tempo real").
Nos minutos :00 e :30 (ou com ?completo=1) faz a rodada COMPLETA (2 vias,
-7d…+60d, séries); nos outros, o modo rápido (só Zoho → House, janela curta,
não toca no banco se nada mudou). UM cron só de propósito: dois syncs
simultâneos inserindo o mesmo evento é a receita das duplicatas antigas.
Trava em shared_kv impede que uma rodada lenta se sobreponha à seguinte.
Best-effort por usuário: um erro em uma conexão não derruba as outras.
"""
from http.server import BaseHTTPRequestHandler
import os
import json, os, sys, time, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, notify_all  # type: ignore
from sync import sync_user, estender_series  # type: ignore
from _convite import processar_fila  # type: ignore


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        auth_hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
        cron = os.environ.get("CRON_SECRET", "").strip()
        if not (cron and auth_hdr == cron):   # v86.66: cron era público (qualquer GET disparava o sync)
            try:
                require_user(self, min_lvl=7)
            except AuthError as e:
                self.send_response(e.status); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": e.message}).encode()); return
        sb = supabase_client()
        if not sb:
            self.send_response(503); self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"backend"}'); return
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        minuto = datetime.now(timezone.utc).minute
        completo = (q.get("completo") or [""])[0] == "1" or minuto % 30 == 0
        TRAVA = "zoho_sync_trava"
        try:
            t = sb.table("shared_kv").select("value").eq("key", TRAVA).limit(1).execute().data or []
            desde = float(((t[0].get("value") or {}) if t else {}).get("ts") or 0)
            # rodada completa pode levar até ~2 min; a rápida, segundos
            if time.time() - desde < (150 if (t and t[0]["value"].get("completo")) else 55):
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(b'{"ok":true,"pulado":"rodada anterior ainda em curso"}'); return
            sb.table("shared_kv").upsert({"key": TRAVA, "value": {"ts": time.time(), "completo": completo}},
                                         on_conflict="key").execute()
        except Exception:
            pass
        out = {"ok": True, "modo": "completo" if completo else "rapido", "usuarios": 0, "por_user": {}}
        try:   # 📨 convite de integração enfileirado (botão em /integracoes ou fila manual)
            conv = processar_fila(sb, notify_all)
            if conv:
                out["convite"] = conv
        except Exception as e:
            out["convite"] = {"erro": str(e)[:120]}
        if completo:
            try:   # 🔁 séries semanais sempre com ~120 dias à frente no House
                out["series"] = estender_series(sb)
            except Exception as e:
                out["series"] = {"erro": str(e)[:120]}
        try:
            conns = sb.table("zoho_conexoes").select("*").limit(500).execute().data or []
        except Exception as e:
            conns = []
            out["erro_lista"] = str(e)[:150]
        for c in conns:
            uid = str(c.get("user_id"))
            try:
                out["por_user"][uid] = sync_user(sb, c, rapido=not completo)
            except Exception as e:
                out["por_user"][uid] = {"erro": str(e)[:120]}
            out["usuarios"] += 1
        try:   # solta a trava e deixa o carimbo da última rodada (prova de que o cron roda)
            sb.table("shared_kv").upsert({"key": TRAVA, "value": {
                "ts": 0, "ultima": datetime.now(timezone.utc).isoformat(), "modo": out["modo"],
                "mudou": sorted(u for u, r in out["por_user"].items() if not (r or {}).get("sem_mudanca"))}},
                on_conflict="key").execute()
        except Exception:
            pass
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8"); self.end_headers()
        self.wfile.write(json.dumps(out, ensure_ascii=False, default=str).encode("utf-8"))
