# -*- coding: utf-8 -*-
"""
POST /api/v3/marketing/campaign_action — pausar/retomar campanha Meta. v88.11

Body: {action: "pause"|"resume", campaign_id: "1202...", account_id: "act_..."}
Header: Authorization: Bearer <token>   (Líder lvl>=5, usuário ATIVO)

Por que existe: o POST ia direto no /api/meta-ads (Node), que aceitava QUALQUER
JWT válido — corretor lvl 2 ou usuário recém-desativado pausava campanha e mudava
orçamento na conta Meta, sem rastro. Agora: require_user (nível + ativo), repasse
interno com CRON_SECRET e audit_log de toda ação (quem, o quê, quando).
adjust_budget NÃO é exposto aqui (a tela não usa; mexer em verba fica no Meta).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit  # type: ignore

MIN_LVL = 5
RE_CAMP = re.compile(r"^\d{5,25}$")
RE_ACT = re.compile(r"^act_\d{5,25}$")


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=MIN_LVL)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        action = body.get("action")
        cid = str(body.get("campaign_id") or "").strip()
        acc = str(body.get("account_id") or "").strip()
        if action not in ("pause", "resume"):
            return self._send(400, {"ok": False, "error": "action inválida (pause|resume)"})
        if not RE_CAMP.match(cid):
            return self._send(422, {"ok": False, "error": "campaign_id inválido"})
        if acc and not RE_ACT.match(acc):
            return self._send(422, {"ok": False, "error": "account_id inválido"})

        cs = os.environ.get("CRON_SECRET", "").strip()
        if not cs:
            return self._send(503, {"ok": False, "error": "CRON_SECRET não configurado"})
        host = self.headers.get("Host") or "www.housepsm.com.br"
        req = urllib.request.Request(
            "https://" + host + "/api/meta-ads",
            data=json.dumps({"action": action, "campaign_id": cid, "account_id": acc}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + cs,
                     "User-Agent": "PSM-OS-v3/campaign-action"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                out = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode("utf-8") or "{}").get("error")
            except Exception:
                err = None
            audit(self, user, "meta_campaign." + action + ".falhou", target_type="meta_campaign",
                  target_id=cid, notes=(acc + " · " + str(err or e.code))[:300])
            return self._send(502, {"ok": False, "error": err or ("Meta HTTP " + str(e.code))})
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})

        audit(self, user, "meta_campaign." + action, target_type="meta_campaign", target_id=cid,
              after={"status": out.get("new_status")}, notes=acc or None)
        return self._send(200, {"ok": True, "action": action, "campaign_id": cid,
                                "new_status": out.get("new_status")})
