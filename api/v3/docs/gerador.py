"""
GET/POST /api/v3/docs/gerador — Gerador de Documentos (proposta, contrato…) v88.12

O Word é montado NO NAVEGADOR (v2/js/docx-psm.js). Este endpoint só:
  • busca o NEGÓCIO do CRM pra auto-preencher (tabela deals, espelho do RD),
    com a MESMA regra de visibilidade do /crm/deals: sócio/diretor (lvl>=7) vê
    tudo, gerente/líder vê a equipe, corretor vê só os próprios;
  • guarda as versões EDITADAS dos modelos e os dados das imobiliárias
    (shared_kv 'docs_gerador' — os textos padrão vivem no front);
  • registra no audit_log QUEM gerou QUAL documento de QUAL negócio (sem copiar
    CPF/RG — os dados pessoais digitados não são gravados no banco).

GET  ?op=config                      (lvl>=2) → {ok, cfg, can_edit}
GET  ?op=negocios[&q=nome][&limit=]  (lvl>=2) → {ok, negocios[], escopo}
POST {op:'salvar', modelos?, empresas?, padroes?}  (lvl>=7) → {ok, cfg}
POST {op:'gerou', modelo, negocio_id?}             (lvl>=2) → {ok}
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qsl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "docs_gerador"
EDIT_LVL = 7
MAX_CORPO = 120_000
MAX_MODELOS = 40


def _read_cfg(sb):
    rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
    v = (rows[0].get("value") if rows else None) or {}
    return {"modelos": v.get("modelos") or {}, "empresas": v.get("empresas") or {}, "padroes": v.get("padroes") or {}}


def _cf(raw, *palavras):
    """Valor do 1º campo personalizado do RD cujo rótulo contém TODAS as palavras."""
    for f in (raw.get("deal_custom_fields") or []):
        lab = ((f.get("custom_field") or {}).get("label") or "").lower()
        if all(p in lab for p in palavras):
            v = f.get("value")
            if isinstance(v, list):
                v = ", ".join(str(x) for x in v if x)
            v = (str(v).strip() if v is not None else "")
            if v:
                return v
    return ""


def _negocio(d, nomes):
    raw = d.get("rd_raw") or {}
    contatos = raw.get("contacts") or []
    ct = contatos[0] if contatos else {}
    emails = ct.get("emails") or []
    phones = ct.get("phones") or []
    produtos = raw.get("deal_products") or []
    return {
        "id": d.get("id"),
        "nome": d.get("name") or "",
        "valor": float(d.get("amount") or 0),
        "etapa": d.get("stage_name") or "",
        "funil": d.get("pipeline_name") or "",
        "ganho": d.get("win"),
        "atualizado": d.get("updated_at_rd"),
        "corretor_email": d.get("user_email") or "",
        "corretor_nome": nomes.get((d.get("user_email") or "").lower(), ""),
        "contato": {
            "nome": ct.get("name") or "",
            "email": (emails[0].get("email") if emails else "") or "",
            "fone": (phones[0].get("phone") if phones else "") or "",
        },
        "campos": {
            "empreendimento": _cf(raw, "empreendimento", "vendido") or _cf(raw, "empreendimento", "pasta")
                              or (produtos[0].get("name") if produtos else "") or "",
            "unidade": _cf(raw, "unidade"),
            "valor_ato": _cf(raw, "valor do ato"),
            "modalidade": _cf(raw, "modalidade"),
            "financiamento": _cf(raw, "financiamento ou recursos"),
            "comissao_pct": _cf(raw, "porcentagem", "comiss"),
            "data_contrato": _cf(raw, "data da ass"),
        },
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        q = dict(parse_qsl(urlparse(self.path).query))
        op = (q.get("op") or "config").strip()
        if op == "config":
            try:
                cfg = _read_cfg(sb)
            except Exception as e:
                return self._send(500, {"ok": False, "error": f"leitura falhou: {e}"})
            return self._send(200, {"ok": True, "cfg": cfg, "can_edit": (user.get("lvl") or 0) >= EDIT_LVL})
        if op == "negocios":
            return self._negocios(sb, user, q)
        return self._send(400, {"ok": False, "error": "op inválida"})

    def _negocios(self, sb, user, q):
        termo = (q.get("q") or "").strip()[:80]
        try:
            limit = max(1, min(60, int(q.get("limit") or 30)))
        except ValueError:
            limit = 30
        lvl = user.get("lvl") or 0
        role = (user.get("role") or "").lower()
        try:
            us = sb.table("users").select("name,email,team").execute().data or []
        except Exception:
            us = []
        nomes = {(u.get("email") or "").lower(): u.get("name") or "" for u in us if u.get("email")}
        qry = sb.table("deals").select("id,name,amount,win,stage_name,pipeline_name,user_email,updated_at_rd,rd_raw")
        if lvl >= 7:
            escopo = "global"
        elif role.startswith("gerente") or role.startswith("lider"):
            team = (user.get("team") or "").lower()
            emails = [(u.get("email") or "").lower() for u in us
                      if u.get("email") and team and (u.get("team") or "").lower() == team]
            my = (user.get("email") or "").lower()
            if my and my not in emails:
                emails.append(my)
            if not emails:
                return self._send(200, {"ok": True, "negocios": [], "escopo": "team_vazio"})
            qry = qry.in_("user_email", emails)
            escopo = "equipe"
        else:
            my = (user.get("email") or "").lower()
            if not my:
                return self._send(200, {"ok": True, "negocios": [], "escopo": "sem_email"})
            qry = qry.eq("user_email", my)   # e-mails já são minúsculos no banco
            escopo = "proprios"
        if termo:
            qry = qry.ilike("name", f"%{termo.replace('%', '').replace(',', ' ')}%")
        try:
            rows = qry.order("updated_at_rd", desc=True).limit(limit).execute().data or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"busca falhou: {e}"})
        return self._send(200, {"ok": True, "negocios": [_negocio(d, nomes) for d in rows], "escopo": escopo})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
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
        op = (body.get("op") or "").strip()

        if op == "gerou":
            audit(self, user, "docs.gerar", target_type="deal", target_id=str(body.get("negocio_id") or "")[:60] or None,
                  notes=f"modelo={str(body.get('modelo') or '')[:60]}")
            return self._send(200, {"ok": True})

        if op != "salvar":
            return self._send(400, {"ok": False, "error": "op inválida"})
        if (user.get("lvl") or 0) < EDIT_LVL:
            return self._send(403, {"ok": False, "error": "só sócio/diretor edita modelos"})
        try:
            antes = _read_cfg(sb)       # leitura falhou ≠ não existe: aborta em vez de gravar por cima
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"leitura falhou: {e}"})
        novo = json.loads(json.dumps(antes))
        agora = datetime.now(timezone.utc).isoformat()

        if isinstance(body.get("modelos"), dict):
            for mid, m in body["modelos"].items():
                mid = str(mid)[:60]
                if m is None:                       # voltar ao padrão
                    novo["modelos"].pop(mid, None)
                    continue
                if not isinstance(m, dict):
                    continue
                corpo = str(m.get("corpo") or "")
                if len(corpo) > MAX_CORPO:
                    return self._send(400, {"ok": False, "error": f"modelo {mid} grande demais"})
                novo["modelos"][mid] = {
                    "titulo": str(m.get("titulo") or "")[:120],
                    "categoria": str(m.get("categoria") or "")[:60],
                    "empresa": str(m.get("empresa") or "")[:40],
                    "arquivo": str(m.get("arquivo") or "")[:100],
                    "corpo": corpo,
                    "novo": bool(m.get("novo")),
                    "atualizado_em": agora,
                    "atualizado_por": user.get("name") or user.get("id"),
                }
            if len(novo["modelos"]) > MAX_MODELOS:
                return self._send(400, {"ok": False, "error": "modelos demais"})
        if isinstance(body.get("empresas"), dict):
            for eid, e in body["empresas"].items():
                eid = str(eid)[:40]
                if e is None:
                    novo["empresas"].pop(eid, None)
                elif isinstance(e, dict):
                    novo["empresas"][eid] = {k: str(v or "")[:300] for k, v in e.items()
                                             if k in ("nome", "cnpj", "creci", "banco", "pix", "fone", "email", "endereco", "instagram", "logo")}
        if isinstance(body.get("padroes"), dict):
            novo["padroes"] = {str(k)[:40]: str(v or "")[:200] for k, v in body["padroes"].items()}

        try:
            sb.table("shared_kv").upsert({"key": KV_KEY, "value": novo, "updated_at": agora}, on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"gravação falhou: {e}"})
        audit(self, user, "docs.modelos_salvar", target_type="shared_kv", target_id=KV_KEY,
              before={"modelos": list(antes["modelos"].keys())}, after={"modelos": list(novo["modelos"].keys())})
        return self._send(200, {"ok": True, "cfg": novo})
