"""
🦉 CONSELHO (v89.31) — atas da Mesa do Conselho.

A Mesa (v2/js/pages/conselho.js) leva uma pauta aos conselheiros de IA
(agents cons_* em api/v3/ia/chat.py), junta os pareceres e o Presidente da
Mesa fecha a ata. Este endpoint guarda as atas no shared_kv 'conselho_atas'
pra os sócios consultarem depois.

GET  → { ok, atas: [ {id, ts, por, pauta, rodadas:[{pergunta, pareceres{}, sintese}]} ] }
POST → action=save {ata:{id, pauta, rodadas[]}}   (mesmo id = atualiza a ata)
       action=del  {id}
Auth: SÓ sócio (lvl>=10) — os pareceres citam caixa, dívida e Plano de Resgate.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import require_user, AuthError, audit, supabase_client  # type: ignore

KV_ATAS = "conselho_atas"
CADEIRAS = {"jobs", "bezos", "hormozi", "altman", "buffett", "dalio"}
MAX_ATAS = 40
MAX_RODADAS = 6


def _read(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_ATAS).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else {}
    except Exception as _e_kv:
        # leitura do BANCO que falha aborta (nunca vira vazio e regrava o blob inteiro)
        if not isinstance(_e_kv, ValueError):
            raise RuntimeError("leitura do shared_kv falhou (" + str(_e_kv)[:80] + ") — nada foi gravado")
        return {}


def _write(sb, value):
    sb.table("shared_kv").upsert({
        "key": KV_ATAS, "value": value,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key").execute()


def _limpa(ata):
    """Aceita só o formato da Mesa e corta tamanho — o blob é compartilhado."""
    if not isinstance(ata, dict):
        return None
    aid = str(ata.get("id") or "")
    if not re.fullmatch(r"ata-\d{10,16}", aid):
        return None
    rodadas = []
    for r in (ata.get("rodadas") or [])[:MAX_RODADAS]:
        if not isinstance(r, dict):
            continue
        par = {k: str(v)[:4000] for k, v in (r.get("pareceres") or {}).items()
               if k in CADEIRAS and isinstance(v, str) and v.strip()}
        if not par:
            continue
        rodadas.append({"pergunta": str(r.get("pergunta") or "").strip()[:2000],
                        "pareceres": par, "sintese": str(r.get("sintese") or "")[:6000]})
    pauta = str(ata.get("pauta") or "").strip()[:2000]
    if not rodadas or not pauta:
        return None
    return {"id": aid, "pauta": pauta, "rodadas": rodadas}


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            atas = [a for a in (_read(sb).get("atas") or []) if isinstance(a, dict)]
        except Exception as e:
            return self._send(503, {"ok": False, "error": str(e)[:160]})
        atas.sort(key=lambda a: str(a.get("ts") or ""), reverse=True)
        return self._send(200, {"ok": True, "atas": atas})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        action = (body.get("action") or "").strip()
        try:
            atas = [a for a in (_read(sb).get("atas") or []) if isinstance(a, dict)]
        except Exception as e:
            return self._send(503, {"ok": False, "error": str(e)[:160]})

        if action == "save":
            ata = _limpa(body.get("ata"))
            if not ata:
                return self._send(400, {"ok": False, "error": "ata inválida"})
            antiga = next((a for a in atas if a.get("id") == ata["id"]), None)
            ata["ts"] = (antiga or {}).get("ts") or datetime.now(timezone.utc).isoformat()
            ata["por"] = (antiga or {}).get("por") or user.get("name")
            atas = [a for a in atas if a.get("id") != ata["id"]] + [ata]
            atas.sort(key=lambda a: str(a.get("ts") or ""))
            _write(sb, {"atas": atas[-MAX_ATAS:]})
            audit(self, user, "ia.conselho.save", target_type="shared_kv", target_id=KV_ATAS,
                  notes=f"{ata['id']} rodadas={len(ata['rodadas'])} {ata['pauta'][:60]}")
            return self._send(200, {"ok": True, "ata": ata})

        if action == "del":
            aid = str(body.get("id") or "")
            resto = [a for a in atas if a.get("id") != aid]
            if len(resto) == len(atas):
                return self._send(404, {"ok": False, "error": "ata não encontrada"})
            _write(sb, {"atas": resto})
            audit(self, user, "ia.conselho.del", target_type="shared_kv", target_id=KV_ATAS, notes=aid)
            return self._send(200, {"ok": True})

        return self._send(400, {"ok": False, "error": "action inválida (save|del)"})
