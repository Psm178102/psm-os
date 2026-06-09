"""GET /api/v3/wa/audience?segment=parados30&dias=30
Segmenta clientes do RD pra campanha de WhatsApp. Hoje: 'parados30' = oportunidades
ABERTAS (win is null) sem atividade há +N dias, com telefone, sem opt-out, sem dup.
Retorna { ok, segment, dias, total, com_telefone, audiencia:[{deal_id,nome,phone,stage,dias_parado,amount}] }
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore
from _wa_lib import phone_from_rd, name_from_rd  # type: ignore


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        try:
            require_user(self, min_lvl=5)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        try:
            dias = max(1, int(q.get("dias") or 30))
        except Exception:
            dias = 30
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cutoff = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
        now = datetime.now(timezone.utc)

        # Oportunidades ABERTAS (win is null) sem atividade desde 'cutoff' — pagina.
        rows = []
        page = 0
        try:
            while True:
                chunk = sb.table("deals").select("id,name,amount,stage_name,updated_at_rd,created_at_rd,rd_raw,user_email") \
                    .is_("win", "null").lt("updated_at_rd", cutoff) \
                    .order("updated_at_rd", desc=True).range(page * 1000, page * 1000 + 999).execute().data or []
                rows.extend(chunk)
                if len(chunk) < 1000 or page >= 20:
                    break
                page += 1
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        # opt-outs
        optouts = set()
        try:
            for o in (sb.table("wa_optout").select("phone").execute().data or []):
                optouts.add(o.get("phone"))
        except Exception:
            pass

        seen = set()
        aud = []
        for d in rows:
            phone = phone_from_rd(d.get("rd_raw"))
            if not phone or phone in seen or phone in optouts:
                continue
            seen.add(phone)
            ts = d.get("updated_at_rd") or d.get("created_at_rd") or ""
            dias_parado = None
            try:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                dias_parado = (now - dt).days
            except Exception:
                pass
            aud.append({
                "deal_id": d.get("id"),
                "nome": name_from_rd(d.get("rd_raw"), d.get("name") or ""),
                "phone": phone,
                "stage": d.get("stage_name"),
                "dias_parado": dias_parado,
                "amount": d.get("amount"),
            })

        aud.sort(key=lambda x: (x.get("dias_parado") or 0), reverse=True)
        return self._send(200, {
            "ok": True, "segment": "parados" + str(dias), "dias": dias,
            "abertos_parados": len(rows), "com_telefone": len(aud),
            "optouts": len(optouts), "audiencia": aud,
        })
