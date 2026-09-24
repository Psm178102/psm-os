"""
/api/v3/propostas/dados — 📑 Proposta comercial (v88.34)

O corretor monta a proposta do cliente (até 4 opções) na tela #/proposta e gera o PDF.
Tudo que é dado de negócio fica aqui, no shared_kv (regra de ouro da ARQUITETURA-REGRAS):

  proposta_v1::<owner_id>::<id>   uma proposta (cliente, opções, premissas, URLs das imagens)
  proposta_cartao::<user_id>      cartão do corretor na última página (nome e sobrenome, WhatsApp, CRECI,
                                  foto, bio; e-mail = o do login). A proposta guarda uma cópia (p.cartao)
  proposta_modelos                biblioteca de empreendimentos do time (fachada, planta,
                                  mapa, fotos, destaques, fluxo padrão) — o corretor escolhe
                                  da lista em vez de redigitar

Imagens sobem para o bucket público 'propostas' (acao=upload) — o /upload_file geral é
só Líder+, e aqui quem monta é o corretor. Volume esperado: dezenas de propostas/mês;
se passar de alguns milhares, migrar para tabela própria.

GET  ?acao=listar[&todos=1]   minhas propostas (todos=1 → Líder+ vê as do time)
GET  ?acao=abrir&id=&owner=    proposta completa (dono ou Líder+)
GET  ?acao=cartao              meu cartão
GET  ?acao=modelos             biblioteca de empreendimentos
POST {acao:'salvar', proposta}            cria/atualiza (devolve id)
POST {acao:'excluir', id, owner}
POST {acao:'cartao', cartao}
POST {acao:'modelo_salvar', modelo}      cria/atualiza pelo id
POST {acao:'modelo_excluir', id}         autor ou Líder+
POST {acao:'upload', filename, content_b64}  → { url }
"""
import base64
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

PREFIXO = "proposta_v1::"
CARTAO = "proposta_cartao::"
MODELOS = "proposta_modelos"
BUCKET = "propostas"
LVL_TIME = 5            # Líder+ vê/edita propostas do time e apaga modelo de outro
MAX_BYTES = 4_300_000   # teto de corpo do Vercel (~4,5MB)
MAX_JSON = 900_000      # proposta é texto + URLs; 900KB = alguém colou imagem em base64
IMG_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
NOW = lambda: datetime.now(timezone.utc).isoformat()


def _val(v, default):
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return default
    return v if isinstance(v, type(default)) else default


def _read(sb, key, default):
    # leitura que FALHA levanta erro (nunca vira "vazio" e sobrescreve — lição do v86.66)
    rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
    return _val(rows[0]["value"], default) if rows else default


def _write(sb, key, val):
    sb.table("shared_kv").upsert({"key": key, "value": val, "updated_at": NOW()}, on_conflict="key").execute()


def _safe_id(s):
    return re.sub(r"[^A-Za-z0-9_-]", "", str(s or ""))[:40]


def _resumo(key, v, updated_at):
    v = _val(v, {})
    cli = v.get("cliente") or {}
    return {
        "id": v.get("id"), "owner": v.get("owner"), "owner_nome": v.get("owner_nome"),
        "cliente": cli.get("nome") or "", "data": cli.get("data") or "",
        "opcoes": [{"empreendimento": o.get("empreendimento") or "", "unidade": o.get("unidade") or "",
                    "preco": o.get("preco") or ""} for o in (v.get("opcoes") or [])[:4]],
        "updated_at": updated_at,
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

    # ───────────────────────── leitura ─────────────────────────
    def do_GET(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        acao = q.get("acao") or "listar"
        uid = str(actor["id"])
        time = (actor.get("lvl") or 0) >= LVL_TIME
        try:
            if acao == "listar":
                pref = PREFIXO if (q.get("todos") == "1" and time) else f"{PREFIXO}{uid}::"
                rows = (sb.table("shared_kv").select("key,value,updated_at").like("key", pref + "%")
                        .order("updated_at", desc=True).limit(300).execute().data or [])
                return self._send(200, {"ok": True, "propostas": [_resumo(r["key"], r["value"], r.get("updated_at")) for r in rows]})
            if acao == "abrir":
                owner = _safe_id(q.get("owner") or uid)
                if owner != uid and not time:
                    return self._send(403, {"ok": False, "error": "proposta de outro corretor"})
                v = _read(sb, f"{PREFIXO}{owner}::{_safe_id(q.get('id'))}", {})
                if not v:
                    return self._send(404, {"ok": False, "error": "proposta não encontrada"})
                return self._send(200, {"ok": True, "proposta": v})
            if acao == "cartao":
                return self._send(200, {"ok": True, "cartao": _read(sb, CARTAO + uid, {})})
            if acao == "modelos":
                return self._send(200, {"ok": True, "modelos": _read(sb, MODELOS, [])})
            return self._send(400, {"ok": False, "error": "ação desconhecida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})

    # ───────────────────────── escrita ─────────────────────────
    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        acao = body.get("acao")
        uid = str(actor["id"])
        time = (actor.get("lvl") or 0) >= LVL_TIME
        try:
            if acao == "upload":
                return self._upload(sb, actor, body)

            if acao == "salvar":
                p = body.get("proposta")
                if not isinstance(p, dict):
                    return self._send(400, {"ok": False, "error": "proposta vazia"})
                if len(json.dumps(p)) > MAX_JSON:
                    return self._send(413, {"ok": False, "error": "proposta grande demais — as imagens devem ser enviadas pelo botão de upload"})
                owner = _safe_id(p.get("owner") or uid)
                if owner != uid and not time:
                    return self._send(403, {"ok": False, "error": "proposta de outro corretor"})
                pid = _safe_id(p.get("id")) or ("pp_" + uuid.uuid4().hex[:12])
                p["id"], p["owner"] = pid, owner
                if owner == uid:
                    p["owner_nome"] = actor.get("name") or ""
                p["salvo_em"] = NOW()
                _write(sb, f"{PREFIXO}{owner}::{pid}", p)
                audit(self, actor, "proposta.salvar", target_type="proposta", target_id=pid,
                      notes=(p.get("cliente") or {}).get("nome"))
                return self._send(200, {"ok": True, "id": pid, "owner": owner})

            if acao == "excluir":
                owner = _safe_id(body.get("owner") or uid)
                if owner != uid and not time:
                    return self._send(403, {"ok": False, "error": "proposta de outro corretor"})
                pid = _safe_id(body.get("id"))
                sb.table("shared_kv").delete().eq("key", f"{PREFIXO}{owner}::{pid}").execute()
                audit(self, actor, "proposta.excluir", target_type="proposta", target_id=pid)
                return self._send(200, {"ok": True})

            if acao == "cartao":
                c = body.get("cartao") or {}
                keep = {k: str(c.get(k) or "")[:400] for k in ("nome", "cargo", "creci", "whats", "msg", "foto", "bio")}
                keep["email"] = actor.get("email") or ""   # sempre o e-mail do login, não editável
                _write(sb, CARTAO + uid, keep)
                return self._send(200, {"ok": True, "cartao": keep})

            if acao == "modelo_salvar":
                m = body.get("modelo")
                if not isinstance(m, dict) or not (m.get("empreendimento") or "").strip():
                    return self._send(400, {"ok": False, "error": "informe o nome do empreendimento"})
                if len(json.dumps(m)) > 200_000:
                    return self._send(413, {"ok": False, "error": "modelo grande demais — use o upload para as imagens"})
                lista = _read(sb, MODELOS, [])
                mid = _safe_id(m.get("id"))
                atual = next((x for x in lista if x.get("id") == mid), None) if mid else None
                if atual and atual.get("autor") != uid and not time:
                    return self._send(403, {"ok": False, "error": "só o autor ou um líder altera este modelo"})
                m["id"] = mid or ("em_" + uuid.uuid4().hex[:10])
                m["autor"] = (atual or {}).get("autor") or uid
                m["autor_nome"] = (atual or {}).get("autor_nome") or actor.get("name") or ""
                m["atualizado_em"] = NOW()
                lista = [x for x in lista if x.get("id") != m["id"]] + [m]
                lista.sort(key=lambda x: (x.get("empreendimento") or "").lower())
                _write(sb, MODELOS, lista)
                audit(self, actor, "proposta.modelo_salvar", target_type="proposta_modelo", target_id=m["id"],
                      notes=m.get("empreendimento"))
                return self._send(200, {"ok": True, "modelo": m})

            if acao == "modelo_excluir":
                mid = _safe_id(body.get("id"))
                lista = _read(sb, MODELOS, [])
                alvo = next((x for x in lista if x.get("id") == mid), None)
                if not alvo:
                    return self._send(404, {"ok": False, "error": "modelo não encontrado"})
                if alvo.get("autor") != uid and not time:
                    return self._send(403, {"ok": False, "error": "só o autor ou um líder exclui este modelo"})
                _write(sb, MODELOS, [x for x in lista if x.get("id") != mid])
                audit(self, actor, "proposta.modelo_excluir", target_type="proposta_modelo", target_id=mid,
                      before={"empreendimento": alvo.get("empreendimento")})
                return self._send(200, {"ok": True})

            return self._send(400, {"ok": False, "error": "ação desconhecida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})

    def _upload(self, sb, actor, body):
        name = re.sub(r"[^A-Za-z0-9._-]", "", (body.get("filename") or "imagem.jpg").replace(" ", "_"))[:80] or "imagem.jpg"
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in IMG_MIME:
            return self._send(400, {"ok": False, "error": "envie uma imagem (JPG, PNG ou WEBP)"})
        raw = body.get("content_b64") or ""
        if "," in raw and raw.strip().lower().startswith("data:"):
            raw = raw.split(",", 1)[1]
        try:
            data = base64.b64decode(raw)
        except Exception:
            return self._send(400, {"ok": False, "error": "conteúdo base64 inválido"})
        if not data:
            return self._send(400, {"ok": False, "error": "arquivo vazio"})
        if len(data) > MAX_BYTES:
            return self._send(413, {"ok": False, "error": "imagem acima de ~4MB"})
        try:
            sb.storage.create_bucket(BUCKET, options={"public": True})
        except Exception:
            pass
        now = datetime.now(timezone.utc)
        path = f"{now.strftime('%Y-%m')}/{actor['id']}/{now.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}_{name}"
        try:
            sb.storage.from_(BUCKET).upload(path, data, {"content-type": IMG_MIME[ext], "upsert": "true"})
            url = sb.storage.from_(BUCKET).get_public_url(path)
            if isinstance(url, str):
                url = url.rstrip("?")
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"upload falhou: {str(e)[:120]}"})
        return self._send(200, {"ok": True, "url": url, "size_bytes": len(data)})
