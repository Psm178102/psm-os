"""
GET/POST /api/v3/marketing/leads_webhook
Webhook de Lead Ads do Meta (campo `leadgen`) — captura cada lead em TEMPO REAL,
independente do RD: pega ad_id/campaign/form e o FORMATO do criativo (vídeo/
carrossel/imagem), grava em meta_leads e tenta casar com o deal por telefone/email.

GET  = verificação do webhook (hub.mode/hub.verify_token/hub.challenge → challenge).
POST = recebe leadgen → busca o lead no Graph → resolve criativo → grava → match.

Env (Vercel):
  META_WEBHOOK_VERIFY_TOKEN  → string que você escolhe e repete no setup do Meta
  META_LEADS_TOKEN           → token de página/system-user com leads_retrieval+ads_read
                               (fallback: META_ACCESS_TOKEN, já usado no cockpit)
  META_APP_SECRET            → (opcional) valida a assinatura X-Hub-Signature-256
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import hmac
import hashlib
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore

GRAPH = "https://graph.facebook.com/v21.0"


def _token():
    return os.environ.get("META_LEADS_TOKEN") or os.environ.get("META_ACCESS_TOKEN")


def _graph(path, fields):
    tok = _token()
    if not tok:
        return None, "META_LEADS_TOKEN/META_ACCESS_TOKEN ausente"
    url = f"{GRAPH}/{urllib.parse.quote(str(path))}?fields={urllib.parse.quote(fields)}&access_token={urllib.parse.quote(tok)}"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PSM-OS/leads"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)


def _digits(s):
    d = re.sub(r"\D", "", str(s or ""))
    return d[-11:] if len(d) > 11 else d  # normaliza p/ DDD+numero (BR)


def _creative_type(creative):
    """Classifica o formato do criativo a partir do objeto creative do Graph."""
    if not isinstance(creative, dict):
        return "unknown"
    if creative.get("video_id"):
        return "video"
    spec = creative.get("object_story_spec") or {}
    link = spec.get("link_data") or {}
    if link.get("child_attachments"):           # carrossel = múltiplos cards
        return "carousel"
    if spec.get("video_data") or link.get("video_id"):
        return "video"
    ot = (creative.get("object_type") or "").upper()
    if ot == "VIDEO":
        return "video"
    if ot in ("PHOTO", "SHARE", "STATUS"):
        return "image"
    if link.get("picture") or link.get("image_hash"):
        return "image"
    return "unknown"


def _resolve_creative(sb, ad_id):
    """ad_id → (creative_type, ad_name, campaign_id, campaign_name), com cache."""
    if not ad_id:
        return "unknown", None, None, None
    try:
        cached = sb.table("meta_creatives").select("*").eq("ad_id", ad_id).limit(1).execute().data or []
        if cached:
            c = cached[0]
            return c.get("creative_type") or "unknown", c.get("ad_name"), c.get("campaign_id"), c.get("campaign_name")
    except Exception:
        pass
    data, err = _graph(ad_id, "name,campaign{id,name},creative{object_type,video_id,object_story_spec}")
    if err or not data:
        return "unknown", None, None, None
    ct = _creative_type(data.get("creative") or {})
    camp = data.get("campaign") or {}
    row = {"ad_id": ad_id, "creative_type": ct, "ad_name": data.get("name"),
           "campaign_id": camp.get("id"), "campaign_name": camp.get("name"),
           "refreshed_at": datetime.now(timezone.utc).isoformat()}
    try:
        sb.table("meta_creatives").upsert(row, on_conflict="ad_id").execute()
    except Exception:
        pass
    return ct, data.get("name"), camp.get("id"), camp.get("name")


def _match_deal(sb, phone, email):
    """Casa o lead com um deal do RD por telefone (últimos dígitos) ou email."""
    try:
        if phone:
            rows = (sb.table("deals").select("id,rd_raw,created_at_rd")
                    .ilike("rd_raw", f"%{phone}%").order("created_at_rd", desc=True)
                    .limit(1).execute().data or [])
            if rows:
                return rows[0]["id"]
        if email:
            rows = (sb.table("deals").select("id")
                    .ilike("rd_raw", f"%{email}%").order("created_at_rd", desc=True)
                    .limit(1).execute().data or [])
            if rows:
                return rows[0]["id"]
    except Exception:
        pass
    return None


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body, raw=False):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8" if raw else "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body.encode("utf-8") if raw else json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_GET(self):
        # Verificação do webhook (handshake do Meta)
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            q = {}
        mode = q.get("hub.mode")
        token = q.get("hub.verify_token")
        challenge = q.get("hub.challenge")
        verify = os.environ.get("META_WEBHOOK_VERIFY_TOKEN")
        if mode == "subscribe" and verify and token == verify:
            return self._send(200, challenge or "", raw=True)
        if not mode:  # healthcheck
            return self._send(200, {"ok": True, "service": "meta_leads_webhook"})
        return self._send(403, {"ok": False, "error": "verify_token inválido"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        # Assinatura (opcional, se META_APP_SECRET configurado)
        secret = os.environ.get("META_APP_SECRET")
        if secret:
            sig = self.headers.get("X-Hub-Signature-256") or ""
            expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                return self._send(401, {"ok": False, "error": "assinatura inválida"})
        try:
            body = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            body = {}

        sb = supabase_client()
        if not sb:
            return self._send(200, {"ok": True, "skip": "backend"})  # 200 evita retry infinito

        captured = 0
        errors = []
        for entry in (body.get("entry") or []):
            for ch in (entry.get("changes") or []):
                if ch.get("field") != "leadgen":
                    continue
                val = ch.get("value") or {}
                lid = val.get("leadgen_id") or val.get("lead_id")
                if not lid:
                    continue
                try:
                    captured += self._process_lead(sb, lid, val)
                except Exception as e:
                    errors.append(str(e))
        return self._send(200, {"ok": True, "captured": captured, "errors": errors})

    def _process_lead(self, sb, leadgen_id, val):
        # Busca o lead autoritativo no Graph (campos + ad/campaign/form)
        data, err = _graph(leadgen_id, "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data")
        data = data or {}
        ad_id = data.get("ad_id") or val.get("ad_id")
        # Extrai nome/telefone/email do field_data
        name = phone = email = None
        for f in (data.get("field_data") or []):
            key = (f.get("name") or "").lower()
            vals = f.get("values") or []
            v = vals[0] if vals else None
            if not v:
                continue
            if "phone" in key or "telefone" in key or "celular" in key:
                phone = _digits(v)
            elif "email" in key or "e-mail" in key:
                email = str(v).strip().lower()
            elif key in ("full_name", "name", "nome", "first_name") and not name:
                name = str(v).strip()
        ctype, ad_name, camp_id, camp_name = _resolve_creative(sb, ad_id)
        matched = _match_deal(sb, phone, email)
        row = {
            "leadgen_id": str(leadgen_id),
            "form_id": data.get("form_id") or val.get("form_id"),
            "ad_id": ad_id, "adset_id": data.get("adset_id"),
            "campaign_id": data.get("campaign_id") or camp_id,
            "ad_name": ad_name, "campaign_name": camp_name,
            "creative_type": ctype,
            "full_name": name, "phone": phone, "email": email,
            "created_time": data.get("created_time") or val.get("created_time"),
            "matched_deal_id": matched,
            "matched_at": datetime.now(timezone.utc).isoformat() if matched else None,
            "raw": data or val,
        }
        sb.table("meta_leads").upsert(row, on_conflict="leadgen_id").execute()
        return 1
