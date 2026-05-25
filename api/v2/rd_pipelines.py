"""
PSM-OS v2 — RD CRM Pipelines & Stages mapping
GET /api/v2/rd_pipelines

Retorna o mapeamento canônico (rd_pipeline_id → frente PSM) e os stages com
seus PSM stage keys + weights. É a fonte da verdade que substitui o `FUNIS`
hardcoded no index.html.

Estrutura da resposta:
{
  "ok": true,
  "pipelines": [
    {"id": "67f59ac754f7370025fb76b5", "name": "FUNIL MAP", "frente": "lancamento", "excluded": false, "active": true},
    ...
  ],
  "stages_by_pipeline": {
    "67f59ac754f7370025fb76b5": [
      {"id": "67f59b265d902c00273edd71", "name": "...", "position": 0, "psm_stage_key": "carteira", "weight": 0.03},
      ...
    ],
    ...
  },
  "frente_by_pipeline": {
    "67f59ac754f7370025fb76b5": "lancamento",
    "69f506fcc2da3b00135d05a5": "conquista",
    ...
  },
  "excluded_pipelines": ["6424d7d6e3dad50023b71987", "642593f1d4645f001fd6fa2a"]
}

Cache 5min em memória (Vercel Lambda warm).
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import time


_CACHE = {"data": None, "ts": 0}
CACHE_TTL_SEC = 300  # 5 min


def _supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
        return create_client(url, key)
    except Exception as e:
        print(f"[v2/rd_pipelines] erro criar cliente: {e}")
        return None


# Pesos padrão por psm_stage_key (probabilidade de fechar deal)
DEFAULT_WEIGHTS = {
    "carteira":     0.03,
    "precisa_im":   0.08,
    "novo_atend":   0.05,
    "tent_contato": 0.08,
    "contato_qual": 0.18,
    "contato_4p":   0.18,
    "precisa_ag":   0.22,
    "agendamento":  0.25,
    "vis_agend":    0.32,
    "vis_real":     0.48,
    "quente":       0.62,
    "analise_doc":  0.58,
    "garantia":     0.70,
    "proposta":     0.78,
    "contrato":     0.94,
    "onboarding":   1.00,
}


def _build_payload(sb):
    """Monta a estrutura completa a partir do Postgres."""
    pipelines_res = sb.table("rd_pipelines").select("*").order("name").execute()
    stages_res = sb.table("rd_stages").select("*").order("pipeline_id").order("position").execute()

    pipelines = pipelines_res.data or []
    stages = stages_res.data or []

    stages_by_pipeline = {}
    for s in stages:
        pid = s.get("pipeline_id")
        if not pid:
            continue
        if pid not in stages_by_pipeline:
            stages_by_pipeline[pid] = []
        # Se weight não estiver no banco, usa default por psm_stage_key
        w = s.get("weight")
        if w is None:
            w = DEFAULT_WEIGHTS.get(s.get("psm_stage_key") or "tent_contato", 0.10)
        else:
            w = float(w)
        stages_by_pipeline[pid].append({
            "id": s["id"],
            "name": s.get("name", ""),
            "position": s.get("position", 0),
            "psm_stage_key": s.get("psm_stage_key", "tent_contato"),
            "weight": w,
            "active": s.get("active", True),
        })

    frente_by_pipeline = {}
    excluded_pipelines = []
    for p in pipelines:
        if p.get("excluded"):
            excluded_pipelines.append(p["id"])
        elif p.get("frente"):
            frente_by_pipeline[p["id"]] = p["frente"]

    return {
        "ok": True,
        "pipelines": pipelines,
        "stages_by_pipeline": stages_by_pipeline,
        "frente_by_pipeline": frente_by_pipeline,
        "excluded_pipelines": excluded_pipelines,
        "fetched_at": int(time.time()),
        "cached": False,
    }


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=60")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.end_headers()

    def do_GET(self):
        # Permite ?nocache=1 pra forçar refresh
        nocache = "nocache=1" in (self.path or "")
        now = time.time()
        if not nocache and _CACHE["data"] and (now - _CACHE["ts"]) < CACHE_TTL_SEC:
            cached = dict(_CACHE["data"])
            cached["cached"] = True
            cached["cache_age_sec"] = int(now - _CACHE["ts"])
            return self._send_json(200, cached)

        sb = _supabase_client()
        if not sb:
            return self._send_json(503, {
                "ok": False,
                "error": "Supabase nao configurado",
                "hint": "SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar nas env vars do Vercel",
            })

        try:
            payload = _build_payload(sb)
            _CACHE["data"] = payload
            _CACHE["ts"] = now
            return self._send_json(200, payload)
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": str(e)})
