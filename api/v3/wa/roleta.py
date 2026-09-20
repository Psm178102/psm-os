# -*- coding: utf-8 -*-
"""
GET/POST /api/v3/wa/roleta — a fila do WhatsApp da Vera. v88.9

GET (lvl>=2)      painel: meus leads, últimos do time, placar do dia.
                  lvl>=5 recebe também a config (filas, etapas do RD, SLA).
GET ?cron=1       varredura: distribui o que dormiu na fila e cobra o SLA.
                  Auth: Bearer CRON_SECRET (ou lvl>=7 na mão).

POST (lvl>=2)
  {action:"assumir",     lead_id}                  — o dono (ou lvl>=5) pega o lead
  {action:"classificar", lead_id, trilha}          — lead que chegou sem etiqueta
  {action:"reatribuir",  lead_id, user_id}         — lvl>=5
  {action:"simular",     texto}                    — testa a classificação, não grava
  {action:"config",      cfg}                      — lvl>=7 (o portão 'ativo' é do sócio)

Por que 'assumir' existe: com um número só, quem conversa é a recepção/IA — o
corretor não tem como "responder no WhatsApp dele" para provar que pegou. O
clique aqui é o sinal, e é dele que o SLA e o repique vivem.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, supabase_client, audit  # type: ignore
from _leads_lib import (CFG_DEFAULT, LABEL, TRILHAS, BRT, assumir, classificar,  # type: ignore
                        distribuir, get_cfg, kv_set, KV_CFG, log, varrer)

LEAD_COLS = ("id,wa_phone,nome,trilha,status,corretor_id,primeira_msg,rd_deal_id,"
             "distribuido_em,assumido_em,repiques,erro,created_at")


def _hoje_ini():
    return (datetime.now(BRT).replace(hour=0, minute=0, second=0, microsecond=0)
            .astimezone(timezone.utc).isoformat())


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    # ── GET ───────────────────────────────────────────────────────────────
    def do_GET(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        if q.get("cron"):
            hdr = (self.headers.get("Authorization") or "").replace("Bearer ", "").strip()
            segredo = os.environ.get("CRON_SECRET", "").strip()
            if not (segredo and hdr == segredo):
                try:
                    require_user(self, min_lvl=7)
                except AuthError as e:
                    return self._send(e.status, {"ok": False, "error": e.message})
            return self._send(200, {"ok": True, "varredura": varrer(sb)})

        try:
            u = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        lvl = u.get("lvl") or 0
        cfg = get_cfg(sb)

        try:
            meus = (sb.table("wa_leads").select(LEAD_COLS)
                    .eq("corretor_id", u.get("id")).in_("status", ["distribuido", "novo"])
                    .order("distribuido_em", desc=True).limit(50).execute().data or [])
        except Exception:
            meus = []
        try:
            ultimos = (sb.table("wa_leads").select(LEAD_COLS)
                       .gte("created_at", _hoje_ini())
                       .order("created_at", desc=True).limit(80).execute().data or [])
        except Exception:
            ultimos = []
        if lvl < 5:
            ultimos = [l for l in ultimos if l.get("corretor_id") == u.get("id")]

        placar = {"hoje": len(ultimos), "por_trilha": {}, "sem_dono": 0, "aguardando": 0}
        for l in ultimos:
            t = l.get("trilha") or "indefinido"
            placar["por_trilha"][t] = placar["por_trilha"].get(t, 0) + 1
            if not l.get("corretor_id") and l.get("status") != "duplicado":
                placar["sem_dono"] += 1
            if l.get("status") == "distribuido" and not l.get("assumido_em"):
                placar["aguardando"] += 1

        out = {"ok": True, "ativo": bool(cfg.get("ativo")), "meus": meus,
               "ultimos": ultimos, "placar": placar, "labels": LABEL}
        if lvl >= 5:
            out["cfg"] = cfg
            out["pode_editar"] = lvl >= 7
        return self._send(200, out)

    # ── POST ──────────────────────────────────────────────────────────────
    def do_POST(self):
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            u = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        lvl = u.get("lvl") or 0
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8") if ln else "{}")
            assert isinstance(body, dict)
        except Exception:
            return self._send(422, {"ok": False, "error": "JSON inválido"})
        acao = str(body.get("action") or "").strip()

        if acao == "simular":
            texto = str(body.get("texto") or "")
            t = classificar(texto)
            return self._send(200, {"ok": True, "trilha": t, "label": LABEL.get(t, t),
                                    "fila": (get_cfg(sb).get("trilhas") or {}).get(t, [])})

        if acao == "config":
            if lvl < 7:
                return self._send(403, {"ok": False, "error": "só o sócio muda a roleta"})
            nova = body.get("cfg")
            if not isinstance(nova, dict):
                return self._send(422, {"ok": False, "error": "cfg precisa ser objeto"})
            cfg = get_cfg(sb)
            antes = json.loads(json.dumps(cfg))
            for k, v in nova.items():
                if k not in CFG_DEFAULT:
                    continue
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k].update(v)
                else:
                    cfg[k] = v
            for t in list((cfg.get("trilhas") or {}).keys()):
                if t not in TRILHAS:
                    cfg["trilhas"].pop(t, None)
            kv_set(sb, KV_CFG, cfg)
            audit(self, u, "wa.roleta.config", target_type="shared_kv", target_id=KV_CFG,
                  before=antes, after=cfg, notes="config da roleta do WhatsApp")
            return self._send(200, {"ok": True, "cfg": cfg})

        lead_id = body.get("lead_id")
        if not lead_id:
            return self._send(422, {"ok": False, "error": "lead_id obrigatório"})
        try:
            rows = (sb.table("wa_leads").select("id,corretor_id,trilha,status")
                    .eq("id", lead_id).limit(1).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:150]})
        if not rows:
            return self._send(404, {"ok": False, "error": "lead não encontrado"})
        lead = rows[0]

        if acao == "assumir":
            if lead.get("corretor_id") and lead["corretor_id"] != u.get("id") and lvl < 5:
                return self._send(403, {"ok": False, "error": "esse lead é de outro corretor"})
            ok = assumir(sb, lead_id, u.get("id"))
            log(sb, ok, "assumido", (u.get("name") or u.get("email") or "")[:60], None, lead_id)
            audit(self, u, "wa.roleta.assumir", target_type="wa_lead", target_id=str(lead_id))
            return self._send(200 if ok else 500, {"ok": ok})

        if acao == "classificar":
            trilha = str(body.get("trilha") or "").strip()
            if trilha not in TRILHAS:
                return self._send(422, {"ok": False, "error": f"trilha inválida (use {', '.join(TRILHAS)})"})
            try:
                sb.table("wa_leads").update({"trilha": trilha}).eq("id", lead_id).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            r = distribuir(sb, lead_id)
            audit(self, u, "wa.roleta.classificar", target_type="wa_lead", target_id=str(lead_id),
                  notes=f"trilha={trilha}")
            return self._send(200, {"ok": True, "trilha": trilha, "distribuicao": r})

        if acao == "reatribuir":
            if lvl < 5:
                return self._send(403, {"ok": False, "error": "requer nível ≥ 5"})
            novo = body.get("user_id")
            if not novo:
                return self._send(422, {"ok": False, "error": "user_id obrigatório"})
            agora = datetime.now(timezone.utc).isoformat()
            try:
                sb.table("wa_leads").update({"corretor_id": novo, "status": "distribuido",
                                             "distribuido_em": agora, "assumido_em": None,
                                             "updated_at": agora}).eq("id", lead_id).execute()
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            log(sb, True, "reatribuido", f"por {u.get('email')}", None, lead_id)
            audit(self, u, "wa.roleta.reatribuir", target_type="wa_lead", target_id=str(lead_id),
                  before={"corretor_id": lead.get("corretor_id")}, after={"corretor_id": novo})
            return self._send(200, {"ok": True})

        return self._send(422, {"ok": False, "error": f"ação desconhecida: {acao}"})
