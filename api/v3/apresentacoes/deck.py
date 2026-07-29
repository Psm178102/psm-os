# -*- coding: utf-8 -*-
"""
/api/v3/apresentacoes/deck — 🎬 Apresentações PSM por marca (v84.92).

Pedido do Paulo (23/07): aba no menu Início onde TODO colaborador assiste as
apresentações institucionais DENTRO do sistema (sem download), separadas por
marca: PSM CONQUISTA · PSM ASSESSORIA IMOBILIÁRIA · PSM LOCAÇÕES.
Só sócio anexa/substitui.

Como funciona: no upload, o navegador do sócio converte o PDF em imagens de
slide (pdf.js) e manda 1 a 1 pra cá — o PDF NUNCA é servido; o visualizador só
recebe URLs assinadas (1h) das imagens no Storage privado 'apresentacoes'.

GET  (logado)          → meta das 3 marcas (nome, n_slides, atualizado)
GET  ?marca=conquista  → URLs assinadas dos slides da marca
POST (lvl>=10) {action:"slide", marca, pasta, idx, jpeg}  → sobe 1 slide
POST (lvl>=10) {action:"publicar", marca, pasta, nome, n_slides} → ativa o deck
Config em shared_kv 'apresentacoes_cfg' = {marca: {pasta, nome, n_slides, ts, por}}.
"""
from http.server import BaseHTTPRequestHandler
import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

BUCKET = "apresentacoes"
KV_CFG = "apresentacoes_cfg"
MARCAS = ("conquista", "assessoria", "locacoes")
MAX_SLIDES = 80
RE_PASTA = re.compile(r"^[0-9]{8}_[0-9]{6}$")


def _storage(method, path, data=None, headers=None, timeout=45):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    h = {"Authorization": f"Bearer {key}", "apikey": key}
    h.update(headers or {})
    req = urllib.request.Request(f"{url}/storage/v1{path}", data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def _kv(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_CFG).limit(1).execute().data or []
        v = rows[0]["value"] if rows else {}
        return (v if isinstance(v, dict) else {}), True
    except Exception:
        return {}, False


def _kv_set(sb, value):
    sb.table("shared_kv").upsert({"key": KV_CFG, "value": value,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _sign(caminho, expira_s=3600):
    body = json.dumps({"expiresIn": expira_s}).encode()
    st, raw = _storage("POST", f"/object/sign/{BUCKET}/{caminho}", data=body,
                       headers={"Content-Type": "application/json"})
    if st != 200:
        return None
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    signed = (json.loads(raw.decode()) or {}).get("signedURL") or ""
    return f"{url}/storage/v1{signed}" if signed else None


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

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cfg, leu = _kv(sb)
        if not leu:
            return self._send(503, {"ok": False, "error": "config indisponível — tente de novo"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        marca = q.get("marca")

        if not marca:
            meta = {m: ({"nome": cfg[m].get("nome"), "n_slides": cfg[m].get("n_slides"),
                         "ts": cfg[m].get("ts")} if cfg.get(m) else None) for m in MARCAS}
            return self._send(200, {"ok": True, "marcas": meta,
                                    "pode_anexar": (user.get("lvl") or 0) >= 10})

        if marca not in MARCAS:
            return self._send(422, {"ok": False, "error": "marca inválida"})
        d = cfg.get(marca)
        if not d:
            return self._send(200, {"ok": True, "slides": [], "nome": None})
        pasta, n = d.get("pasta"), int(d.get("n_slides") or 0)
        slides = []
        for i in range(n):
            u = _sign(f"{marca}/{pasta}/s{i:03d}.jpg")
            if u:
                slides.append(u)
        return self._send(200, {"ok": True, "nome": d.get("nome"), "ts": d.get("ts"),
                                "slides": slides})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)   # anexar é SÓ sócio (regra do Paulo)
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
        marca = str(body.get("marca") or "")
        if marca not in MARCAS:
            return self._send(422, {"ok": False, "error": "marca inválida"})

        if action == "slide":
            pasta = str(body.get("pasta") or "")
            if not RE_PASTA.match(pasta):
                return self._send(422, {"ok": False, "error": "pasta inválida (use AAAAMMDD_HHMMSS)"})
            try:
                idx = int(body.get("idx"))
                assert 0 <= idx < MAX_SLIDES
            except Exception:
                return self._send(422, {"ok": False, "error": f"idx inválido (0..{MAX_SLIDES - 1})"})
            jpeg = str(body.get("jpeg") or "")
            if jpeg.startswith("data:"):
                jpeg = jpeg.split(",", 1)[-1]
            try:
                raw = base64.b64decode(jpeg)
                assert 1000 < len(raw) < 3_500_000
            except Exception:
                return self._send(422, {"ok": False, "error": "imagem inválida (1KB–3.5MB)"})
            try:
                st, _ = _storage("POST", f"/object/{BUCKET}/{marca}/{pasta}/s{idx:03d}.jpg",
                                 data=raw, headers={"Content-Type": "image/jpeg", "x-upsert": "true"})
                if st not in (200, 201):
                    return self._send(502, {"ok": False, "error": f"storage HTTP {st}"})
            except Exception as e:
                return self._send(502, {"ok": False, "error": str(e)[:150]})
            return self._send(200, {"ok": True, "idx": idx})

        if action == "publicar":
            pasta = str(body.get("pasta") or "")
            if not RE_PASTA.match(pasta):
                return self._send(422, {"ok": False, "error": "pasta inválida"})
            try:
                n = int(body.get("n_slides"))
                assert 1 <= n <= MAX_SLIDES
            except Exception:
                return self._send(422, {"ok": False, "error": "n_slides inválido"})
            # confere que os slides realmente subiram antes de apontar a marca
            for i in (0, n - 1):
                if not _sign(f"{marca}/{pasta}/s{i:03d}.jpg", 60):
                    return self._send(422, {"ok": False, "error": f"slide {i} não encontrado no storage — upload incompleto, publique de novo"})
            cfg, leu = _kv(sb)
            if not leu:   # lição v84.88: leitura falhou → NÃO regrava por cima
                return self._send(503, {"ok": False, "error": "config indisponível — tente de novo"})
            antes = dict(cfg)
            cfg[marca] = {"pasta": pasta, "nome": str(body.get("nome") or "")[:120] or None,
                          "n_slides": n, "ts": datetime.now(timezone.utc).isoformat(),
                          "por": user.get("name")}
            try:
                _kv_set(sb, cfg)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:150]})
            audit(self, user, "apresentacao.publicar", target_type="shared_kv", target_id=KV_CFG,
                  before=antes, after=cfg, notes=f"{marca}: {n} slides")
            return self._send(200, {"ok": True, "marca": marca, "n_slides": n})

        return self._send(400, {"ok": False, "error": "action inválida (slide|publicar)"})
