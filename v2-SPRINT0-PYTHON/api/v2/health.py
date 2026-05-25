"""
PSM-OS v2 — Health check endpoint
GET /api/v2/health

Sprint 0: prova de vida do backend Python.
Não toca em DB nem em nada externo. Só confirma:
  - Python runtime do Vercel funciona
  - Env vars críticas estão configuradas
  - Identifica versão pra debugging

URL final em produção: https://psm-os.vercel.app/api/v2/health
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys


V2_VERSION = "2.0.0-sprint0"
V2_NAME = "PSM-OS Python Backend"


def _env_status():
    """Retorna quais env vars estão configuradas (sem expor valores)."""
    required = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",  # service role, server-side only
    ]
    optional = [
        "SUPABASE_ANON_KEY",
        "NIBO_API_TOKEN",
        "NIBO_TOKEN_LOCACAO",
        "META_ACCESS_TOKEN",
        "META_AD_ACCOUNT_IDS",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
    ]
    return {
        "required": {k: bool(os.environ.get(k)) for k in required},
        "optional": {k: bool(os.environ.get(k)) for k in optional},
        "all_required_ok": all(os.environ.get(k) for k in required),
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = {
            "ok": True,
            "service": V2_NAME,
            "version": V2_VERSION,
            "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "platform": sys.platform,
            "env": _env_status(),
            "message": (
                "Sprint 0 alive. Sprint 1 (users CRUD) depende de SUPABASE_URL "
                "e SUPABASE_SERVICE_KEY estarem em 'env.required.all_required_ok=true'."
            ),
        }
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, indent=2, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
