"""
_psmhub_lib.py — login + GET compartilhados pra ponte com o psmhub.com.br. v77.77

Usado por hub.py (KPIs/esteira/funil) e reconcile.py (reconciliação corretor-a-corretor).
Credenciais SÓ em ENV (PSMHUB_EMAIL/PSMHUB_PASSWORD), nunca no código. Token cacheado
em memória da instância quente (re-loga em 401/403 ou após TTL).
"""
import json, os, time, urllib.request, urllib.error

BASE = (os.environ.get("PSMHUB_BASE") or "https://psmhub.com.br").rstrip("/")
_tok = {"value": None, "at": 0}
TTL = 45 * 60  # re-loga a cada 45min por segurança


def configured():
    return bool(os.environ.get("PSMHUB_EMAIL") and os.environ.get("PSMHUB_PASSWORD"))


def login():
    email = os.environ.get("PSMHUB_EMAIL")
    pw = os.environ.get("PSMHUB_PASSWORD")
    if not email or not pw:
        raise RuntimeError("PSMHUB_EMAIL/PSMHUB_PASSWORD não configurados no Vercel")
    body = json.dumps({"email": email, "password": pw}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/api/auth/login", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          "User-Agent": "PSM-OS/psmhub-bridge"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    tok = data.get("token") or data.get("access_token") or data.get("accessToken") or data.get("jwt")
    if not tok:
        raise RuntimeError("login psmhub não retornou token")
    _tok["value"] = tok
    _tok["at"] = time.time()
    return tok


def token(force=False):
    if force or not _tok["value"] or (time.time() - _tok["at"]) > TTL:
        return login()
    return _tok["value"]


def get(path, retry=True):
    tok = token()
    req = urllib.request.Request(f"{BASE}{path}",
                                 headers={"Authorization": f"Bearer {tok}", "Accept": "application/json",
                                          "User-Agent": "PSM-OS/psmhub-bridge"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and retry:   # token velho → re-loga uma vez
            token(force=True)
            return get(path, retry=False)
        raise
