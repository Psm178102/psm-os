"""
/api/v3/oo/forecast_corretor — Peça 5 da Produtividade Real (v86.78).

FORECAST DECLARADO pelo corretor, toda segunda antes da Reunião Semanal:
3 números do mês — comprometido / provável / pipeline. Histórico VERSIONADO
(nunca sobrescreve; cada declaração é uma versão com timestamp).

kv: forecast:<email_local>:<YYYY-MM> = {"versoes":[{comprometido,provavel,pipeline,ts,semana}],
                                        "vendas_real": null}   ← preenchido no Fecho do Mês
GET  ?mes=YYYY-MM[&corretor=]  → corretor vê o próprio; lvl>=5 vê qualquer um / todos.
POST {comprometido, provavel, pipeline[, mes]} → declara PRA SI (lvl>=2).
POST {action:"fechar_mes", mes, corretor, vendas_real} (lvl>=5) → sela o real p/ acurácia.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "producao"))
from _prod_lib import email_local  # type: ignore


def _key(corretor, mes):
    return f"forecast:{corretor}:{mes}"


def _load(sb, key):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", key).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def _save(sb, key, value):
    sb.table("shared_kv").upsert({"key": key, "value": value,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        mes = q.get("mes") or datetime.now(timezone.utc).strftime("%Y-%m")
        lvl = user.get("lvl") or 0
        eu = email_local(user.get("email"))
        alvo = q.get("corretor") or eu
        if lvl < 5 and alvo != eu:
            return self._send(403, {"ok": False, "error": "só o próprio forecast"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        if lvl >= 5 and q.get("todos") == "1":
            try:
                rows = (sb.table("shared_kv").select("key,value")
                        .like("key", f"forecast:%:{mes}").execute().data or [])
                out = {}
                for r in rows:
                    v = r["value"] if not isinstance(r["value"], str) else json.loads(r["value"])
                    out[r["key"].split(":")[1]] = v
                return self._send(200, {"ok": True, "mes": mes, "forecasts": out})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:200]})
        return self._send(200, {"ok": True, "mes": mes, "corretor": alvo,
                                "forecast": _load(sb, _key(alvo, mes))})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8") or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        lvl = user.get("lvl") or 0
        now = datetime.now(timezone.utc)
        mes = str(body.get("mes") or now.strftime("%Y-%m"))[:7]

        if body.get("action") == "fechar_mes":
            if lvl < 5:
                return self._send(403, {"ok": False, "error": "fechar mês é do gestor (lvl>=5)"})
            corretor = email_local(body.get("corretor")) or str(body.get("corretor") or "").lower()
            if not corretor:
                return self._send(400, {"ok": False, "error": "corretor obrigatório"})
            key = _key(corretor, mes)
            v = _load(sb, key) or {"versoes": []}
            try:
                v["vendas_real"] = float(body.get("vendas_real"))
            except (TypeError, ValueError):
                return self._send(400, {"ok": False, "error": "vendas_real numérico obrigatório"})
            ult = (v.get("versoes") or [{}])[-1]
            prometido = float(ult.get("comprometido") or 0) + float(ult.get("provavel") or 0)
            v["acuracia"] = round(min(v["vendas_real"], prometido) / prometido, 3) if prometido > 0 else None
            try:
                _save(sb, key, v)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:200]})
            audit(self, user, "forecast.fechar_mes", "shared_kv", key,
                  notes=f"real={v['vendas_real']} acc={v.get('acuracia')}")
            return self._send(200, {"ok": True, "corretor": corretor, "mes": mes,
                                    "acuracia": v.get("acuracia")})

        # declaração do próprio corretor (versão nova, nunca sobrescreve)
        eu = email_local(user.get("email"))
        if not eu:
            return self._send(400, {"ok": False, "error": "usuário sem e-mail"})
        try:
            versao = {"comprometido": max(0, int(body.get("comprometido") or 0)),
                      "provavel": max(0, int(body.get("provavel") or 0)),
                      "pipeline": max(0, int(body.get("pipeline") or 0)),
                      "ts": now.isoformat(), "semana": now.isocalendar()[1]}
        except (TypeError, ValueError):
            return self._send(400, {"ok": False, "error": "comprometido/provavel/pipeline inteiros"})
        key = _key(eu, mes)
        v = _load(sb, key) or {"versoes": [], "vendas_real": None}
        v.setdefault("versoes", []).append(versao)
        try:
            _save(sb, key, v)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        audit(self, user, "forecast.declarar", "shared_kv", key,
              notes=f"{versao['comprometido']}/{versao['provavel']}/{versao['pipeline']}")
        return self._send(200, {"ok": True, "mes": mes, "versao": versao,
                                "total_versoes": len(v["versoes"])})
