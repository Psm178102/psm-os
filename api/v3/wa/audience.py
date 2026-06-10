"""GET /api/v3/wa/audience?segment=parados|perdidos|ganhos&dias=30
Segmenta clientes do RD pra campanha de WhatsApp (v77.32: 3 máquinas de growth):
  • parados  (default) — oportunidades ABERTAS (win null) sem atividade há +N dias.
  • perdidos — WIN-BACK: negócios PERDIDOS nos últimos N dias (default 90), com o
               motivo da perda no item (pra régua de recuperação por motivo).
  • ganhos   — INDICAÇÃO/NPS: clientes que COMPRARAM nos últimos N dias (default 180).
Todos: com telefone, sem opt-out, dedup por telefone.
Retorna { ok, segment, dias, com_telefone, audiencia:[{deal_id,nome,phone,stage,dias_parado,amount,motivo?}] }
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
        segment = (q.get("segment") or "parados").rstrip("0123456789")  # 'parados30' → 'parados'
        if segment not in ("parados", "perdidos", "ganhos"):
            segment = "parados"
        default_dias = {"parados": 30, "perdidos": 90, "ganhos": 180}[segment]
        try:
            dias = max(1, int(q.get("dias") or default_dias))
        except Exception:
            dias = default_dias
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cutoff = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
        now = datetime.now(timezone.utc)

        cols = "id,name,amount,stage_name,updated_at_rd,created_at_rd,closed_at,rd_raw,user_email"
        rows = []
        page = 0
        try:
            while True:
                base = sb.table("deals").select(cols)
                if segment == "perdidos":
                    # WIN-BACK: perdidos DENTRO da janela (recentes o bastante pra reabordar)
                    qq = base.eq("win", False).gte("closed_at", cutoff).order("closed_at", desc=True)
                elif segment == "ganhos":
                    # INDICAÇÃO/NPS: compraram dentro da janela
                    qq = base.eq("win", True).gte("closed_at", cutoff).order("closed_at", desc=True)
                else:
                    # PARADOS: abertos sem atividade desde o cutoff
                    qq = base.is_("win", "null").lt("updated_at_rd", cutoff).order("updated_at_rd", desc=True)
                chunk = qq.range(page * 1000, page * 1000 + 999).execute().data or []
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
            ts = (d.get("closed_at") if segment in ("perdidos", "ganhos") else None) \
                or d.get("updated_at_rd") or d.get("created_at_rd") or ""
            dias_parado = None
            try:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                dias_parado = (now - dt).days
            except Exception:
                pass
            item = {
                "deal_id": d.get("id"),
                "nome": name_from_rd(d.get("rd_raw"), d.get("name") or ""),
                "phone": phone,
                "stage": d.get("stage_name"),
                "dias_parado": dias_parado,
                "amount": d.get("amount"),
            }
            if segment == "perdidos":
                lr = (d.get("rd_raw") or {}).get("deal_lost_reason") or {}
                item["motivo"] = (lr.get("name") if isinstance(lr, dict) else str(lr)) or "Não informado"
            aud.append(item)

        if segment == "parados":
            aud.sort(key=lambda x: (x.get("dias_parado") or 0), reverse=True)
        else:
            aud.sort(key=lambda x: (x.get("dias_parado") if x.get("dias_parado") is not None else 9999))  # mais recente primeiro
        return self._send(200, {
            "ok": True, "segment": segment, "dias": dias,
            "abertos_parados": len(rows), "com_telefone": len(aud),
            "optouts": len(optouts), "audiencia": aud,
        })
