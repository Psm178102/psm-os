"""
GET/POST /api/v3/diretoria/ritmo_gestao — 🔁 Painel de Cadência (Motor: api/v3/_ritmo_lib.py). v88.97

GET  (lvl ≥ 7) → por pessoa: tarefas abertas/vencidas/sem prazo, % concluído no prazo (30 dias),
                  aderência da rotina no mês, reuniões previstas × com ata (30 dias), canais de aviso
                  (WhatsApp/celular) e último acesso; lista das vencidas com o estágio da escada;
                  catálogo das rotinas (liga/desliga) e a configuração.
POST (lvl ≥ 10) {action:"config", rotinas_ativas?, gestores?, escada?, avisos?} → grava cadencia_config.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
_V3 = os.path.dirname(_HERE)
if _V3 not in sys.path:
    sys.path.append(_V3)
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore
import _ritmo_lib as CAD  # type: ignore
import rotina as R  # type: ignore

FORA = ("tv", "comercial")


def _concluida_em(t):
    for h in reversed(t.get("historico") or []):
        if isinstance(h, dict) and (h.get("to") in ("concluida", "concluída") or h.get("action") == "conclude"):
            return CAD._d(CAD._brt_date(h.get("ts")))
    return CAD._d(CAD._brt_date(t.get("updated_at")))


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        hoje = CAD.hoje_brt()
        d30 = hoje - timedelta(days=30)
        cfg = CAD.config(sb)
        try:
            users = sb.table("users").select("id,name,role,status,whatsapp,is_service").execute().data or []
        except Exception:
            users = sb.table("users").select("id,name,role,status").execute().data or []
        ativos = {u["id"]: u for u in users if (u.get("status") or "ativo") == "ativo"
                  and u["id"] not in FORA and not u.get("is_service")}
        try:
            tarefas = (sb.table("dir_tasks").select("id,titulo,status,prazo,responsavel,categoria,historico,updated_at,created_at")
                       .or_(f"status.not.in.(concluida,cancelada),updated_at.gte.{d30.isoformat()}")
                       .limit(5000).execute().data or [])
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"tarefas: {e}"})
        try:
            push = {}
            for p in sb.table("push_subscriptions").select("user_id").limit(2000).execute().data or []:
                push[p["user_id"]] = push.get(p["user_id"], 0) + 1
        except Exception:
            push = {}
        try:
            acesso = {}
            for s in (sb.table("user_sessions").select("user_id,last_seen")
                      .gte("last_seen", (hoje - timedelta(days=30)).isoformat()).limit(5000).execute().data or []):
                if s.get("last_seen") and s["last_seen"] > acesso.get(s["user_id"], ""):
                    acesso[s["user_id"]] = s["last_seen"]
        except Exception:
            acesso = {}
        estado = (CAD._kv(sb, CAD.KV_ALERTAS, {}) or {}).get("tarefas") or {}

        pess = {}

        def P(uid):
            return pess.setdefault(uid, {"id": uid, "nome": (ativos.get(uid) or {}).get("name") or uid,
                                         "role": (ativos.get(uid) or {}).get("role"),
                                         "abertas": 0, "vencidas": 0, "sem_prazo": 0, "concluidas_30d": 0,
                                         "no_prazo_30d": 0, "rotina_pct": None, "reun_previstas": 0,
                                         "reun_com_ata": 0, "gestor": CAD.gestor_de(cfg, uid, ativos)})

        vencidas = []
        for t in tarefas:
            uid = t.get("responsavel")
            if uid not in ativos:
                continue
            st = (t.get("status") or "").lower()
            pz = CAD._d(t.get("prazo"))
            if st in ("concluida", "concluída"):
                ce = _concluida_em(t)
                if ce and ce >= d30:
                    p = P(uid)
                    p["concluidas_30d"] += 1
                    if pz and ce <= pz:
                        p["no_prazo_30d"] += 1
                continue
            if st in CAD.DONE:
                continue
            p = P(uid)
            p["abertas"] += 1
            if not pz:
                p["sem_prazo"] += 1
            elif pz < hoje:
                p["vencidas"] += 1
                est = estado.get(t["id"]) or []
                vencidas.append({"id": t["id"], "titulo": t.get("titulo"), "dono": uid, "dono_nome": p["nome"],
                                 "prazo": pz.isoformat(), "dias": (hoje - pz).days, "categoria": t.get("categoria"),
                                 "estagio": "sócios" if "socios" in est else "gestor" if "gestor" in est else "dono"})
        for uid in list(CAD.PAPEL_USERS.get("isa", [])) + ["paulo", "kbordini", "mariane"]:
            if uid in ativos:
                P(uid)

        # rotina: aderência do mês por papel
        rotinas = []
        for unidade, un in R.UNIDADES.items():
            checks = (CAD._kv(sb, un["kv"], {"checks": {}}) or {}).get("checks") or {}
            ad = R.aderencia(checks, hoje.replace(day=1), hoje, hoje, un)
            for q in un["quens"]:
                chave = f"{unidade}:{q}"
                n = len([t for t in un["tarefas"] if t["quem"] == q])
                rotinas.append({"chave": chave, "unidade": un["titulo"], "papel": q,
                                "quem": (un["papeis"].get(q) or {}).get("nome") or q, "itens": n,
                                "ativa": bool((cfg.get("rotinas_ativas") or {}).get(chave)),
                                "aderencia_mes": ad.get(q)})
                for uid in CAD.PAPEL_USERS.get(q, []):
                    if uid in ativos:
                        P(uid)["rotina_pct"] = ad.get(q)

        # reuniões previstas × com ata (30 dias)
        _todos = CAD.formatos(sb)
        fs = [f for f in _todos if not f.get("sem_ata")]   # v89.27: bloco sem ata não conta
        feitas = CAD.atas_por_formato_dia(sb, d30)
        reunioes = {}
        for f, d in CAD.reunioes_previstas(fs, d30, hoje - timedelta(days=1), _todos):
            dono = CAD.dono_formato(f)
            r = reunioes.setdefault(f.get("id"), {"id": f.get("id"), "nome": f.get("nome"), "emoji": f.get("emoji"),
                                                  "dono": dono, "previstas": 0, "com_ata": 0, "ultima_ata": None})
            r["previstas"] += 1
            if (f.get("id"), d.isoformat()) in feitas:
                r["com_ata"] += 1
                r["ultima_ata"] = d.isoformat()
            if dono in ativos:
                P(dono)["reun_previstas"] += 1
                if (f.get("id"), d.isoformat()) in feitas:
                    P(dono)["reun_com_ata"] += 1

        for p in pess.values():
            u = ativos.get(p["id"]) or {}
            p["whatsapp"] = bool(u.get("whatsapp"))
            p["push"] = push.get(p["id"], 0)
            p["ultimo_acesso"] = acesso.get(p["id"])
            p["pct_no_prazo"] = round(p["no_prazo_30d"] / p["concluidas_30d"] * 100) if p["concluidas_30d"] else None

        ordem = {"socio": 0, "gerente_conquista": 1, "backoffice": 2}
        pessoas = sorted(pess.values(), key=lambda p: (ordem.get(p["role"], 5), -p["vencidas"], p["nome"]))
        vencidas.sort(key=lambda v: -v["dias"])
        return self._send(200, {
            "ok": True, "hoje": hoje.isoformat(), "pessoas": pessoas, "vencidas": vencidas[:150],
            "rotinas": rotinas, "reunioes": sorted(reunioes.values(), key=lambda r: (r["com_ata"] - r["previstas"])),
            "config": cfg, "wa_servidor": CAD._wa_ok(),
            "usuarios": [{"id": u["id"], "nome": u.get("name")} for u in ativos.values()],
            "pode_editar": (user.get("lvl") or 0) >= 10,
        })

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        if body.get("action") != "config":
            return self._send(400, {"ok": False, "error": "action inválida"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        atual = CAD._kv(sb, CAD.KV_CONFIG, {})
        if atual is None:
            return self._send(503, {"ok": False, "error": "kv indisponível — tente de novo"})
        for k in ("rotinas_ativas", "gestores", "escada", "avisos"):
            v = body.get(k)
            if isinstance(v, dict):
                atual.setdefault(k, {}).update(v)
        esc = atual.get("escada") or {}
        for k in ("gestor", "socios"):
            if k in esc:
                try:
                    esc[k] = max(1, min(60, int(esc[k])))
                except Exception:
                    esc.pop(k, None)
        try:
            CAD._kv_set(sb, CAD.KV_CONFIG, atual)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})
        audit(self, user, "cadencia.config", target_type="shared_kv", target_id=CAD.KV_CONFIG,
              notes=json.dumps({k: body.get(k) for k in ("rotinas_ativas", "escada", "avisos") if body.get(k)}, ensure_ascii=False)[:300])
        return self._send(200, {"ok": True, "config": CAD.config(sb)})
