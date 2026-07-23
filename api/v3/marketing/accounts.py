# -*- coding: utf-8 -*-
"""
/api/v3/marketing/accounts — gestão das contas de anúncio Meta pela TELA. v84.87

Motivação: excluir/adicionar conta exigia mexer em env do Vercel + deploy
(caso real: conta "Kaue Bordini" sem permissão #200 poluindo o cockpit).

GET  (lvl>=5)  → lista resolvida: [{id, label, origem: env|extra, ativa}]
POST (lvl>=10) → {action:"excluir"|"reativar", id}
                 {action:"adicionar", id:"act_...", label:"..."}
Tokens NUNCA passam por aqui: conta extra usa o META_ACCESS_TOKEN do ambiente;
conta com token próprio continua sendo caso de env (documentado na tela).
Toda mudança: audit com before/after (lição v84.84 — sempre reversível).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
from _accounts_lib import KV_ACCOUNTS, overrides, _env_list  # type: ignore

RE_ACT = re.compile(r"^act_\d{6,20}$")


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def _lista(self, sb):
        ovr = overrides(sb)
        excl = set(ovr.get("excluidas") or [])
        ids = _env_list("META_AD_ACCOUNT_IDS")
        labels = _env_list("META_AD_ACCOUNT_LABELS")
        out = [{"id": i, "label": (labels[n] if n < len(labels) else i),
                "origem": "env", "ativa": i not in excl} for n, i in enumerate(ids)]
        vistos = {c["id"] for c in out}
        for e in (ovr.get("extras") or []):
            eid = (e or {}).get("id")
            if eid and eid not in vistos:
                out.append({"id": eid, "label": e.get("label") or eid,
                            "origem": "extra", "ativa": eid not in excl})
        return out

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        return self._send(200, {"ok": True, "contas": self._lista(sb)})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = body.get("action")
        cid = str(body.get("id") or "").strip()
        antes = overrides(sb)
        ovr = {"excluidas": list(antes.get("excluidas") or []),
               "extras": list(antes.get("extras") or [])}

        if action == "excluir":
            if not cid:
                return self._send(422, {"ok": False, "error": "id ausente"})
            era_extra = any((e or {}).get("id") == cid for e in ovr["extras"])
            if era_extra:
                ovr["extras"] = [e for e in ovr["extras"] if (e or {}).get("id") != cid]
            elif cid not in ovr["excluidas"]:
                ovr["excluidas"].append(cid)
        elif action == "reativar":
            ovr["excluidas"] = [x for x in ovr["excluidas"] if x != cid]
        elif action == "adicionar":
            label = str(body.get("label") or "").strip()[:80]
            if not RE_ACT.match(cid):
                return self._send(422, {"ok": False, "error": "id inválido — formato act_<números> (ex: act_1257110332475646)"})
            if not label:
                return self._send(422, {"ok": False, "error": "dê um nome pra conta (é o rótulo do chip no cockpit)"})
            ja = {c["id"] for c in self._lista(sb)}
            if cid in ja and cid not in ovr["excluidas"]:
                return self._send(422, {"ok": False, "error": "essa conta já está na lista"})
            ovr["excluidas"] = [x for x in ovr["excluidas"] if x != cid]
            if not any((e or {}).get("id") == cid for e in ovr["extras"]):
                ovr["extras"].append({"id": cid, "label": label})
        else:
            return self._send(400, {"ok": False, "error": "action inválida (excluir|reativar|adicionar)"})

        try:
            sb.table("shared_kv").upsert({"key": KV_ACCOUNTS, "value": ovr,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:150]})
        audit(self, user, "meta_accounts." + action, target_type="shared_kv", target_id=KV_ACCOUNTS,
              before=antes, after=ovr, notes=cid)
        return self._send(200, {"ok": True, "contas": self._lista(sb)})
