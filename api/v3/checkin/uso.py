"""
GET /api/v3/checkin/uso[?dias=30]
Header: Authorization: Bearer <token>   ·   SÓ SÓCIO (min_lvl=10)

🕵️ MAPA DE USO DO SISTEMA — quem realmente usa o House PSM.

Por pessoa e por login: quando entrou, quanto tempo ficou DE VERDADE e quando
fechou. Pedido do Paulo (17/09/2026): a aba Check-in / Check-out virou este
painel, ninguém executa tarefa nela e só sócio vê.

De onde vem cada número (fonte única: tabela `user_sessions`):
  · entrou  = created_at  → gravado por auth/login.py no login
  · sinal   = last_seen   → gravado pelo pulso (api/v3/pulse.py) enquanto a aba
                            está VISÍVEL; no máximo 1 gravação por 45s
  · ativo   = ativo_seg   → soma dos intervalos entre sinais; intervalo > 3min
                            (aba fechada/oculta) NÃO conta. É o tempo real de uso.
  · fechou  = ended_at (clicou Sair) OU last_seen (só fechou a aba)

⚠️ Tempo de permanência só existe para sessões a partir da v88.5. Login anterior
a isso aparece com a data/hora de entrada e "—" no tempo.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import re
import sys
import urllib.parse
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError  # type: ignore

DIAS_PADRAO = 30
DIAS_MAX = 180
ONLINE_SEG = 180        # sinal nos últimos 3 min = está com a tela aberta agora
MAX_SESSOES = 800       # teto de linhas devolvidas (o resto vira só agregado)
BRT = timedelta(hours=-3)

# Aceita o que o Postgres devolve ("2026-09-17 17:43:05.390816+00") em qualquer
# versão de Python — o fromisoformat só engole "+00" a partir do 3.11.
_TS = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?"
    r"\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})?$"
)


def _dt(v):
    """String do banco → datetime em UTC. None se não der pra ler."""
    m = _TS.match(str(v or "").strip())
    if not m:
        return None
    y, mo, d, h, mi, s, us, tz = m.groups()
    try:
        out = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s),
                       int((us or "0").ljust(6, "0")), tzinfo=timezone.utc)
    except Exception:
        return None
    if tz and tz != "Z":
        raw = tz[1:].replace(":", "")
        off = timedelta(hours=int(raw[:2]), minutes=int(raw[2:4] or 0))
        out = out - off if tz[0] == "+" else out + off
    return out


def _iso(d):
    return d.isoformat() if d else None


def _dia_brt(d):
    """Dia de Brasília (o sócio pensa em dia daqui, não em dia UTC)."""
    return (d + BRT).date().isoformat() if d else None


def _device(ua):
    """User-agent → rótulo curto. Não devolvemos o UA inteiro (egress à toa)."""
    u = (ua or "").lower()
    if not u:
        return "—"
    if "iphone" in u:
        so = "iPhone"
    elif "ipad" in u:
        so = "iPad"
    elif "android" in u:
        so = "Android"
    elif "windows" in u:
        so = "Windows"
    elif "mac os" in u or "macintosh" in u:
        so = "Mac"
    elif "linux" in u:
        so = "Linux"
    else:
        so = "?"
    if "edg/" in u:
        nav = "Edge"
    elif "opr/" in u or "opera" in u:
        nav = "Opera"
    elif "firefox" in u:
        nav = "Firefox"
    elif "chrome" in u or "crios" in u:
        nav = "Chrome"
    elif "safari" in u:
        nav = "Safari"
    else:
        nav = ""
    app = " · app" if ("capacitor" in u or "psm-os" in u) else ""
    return so + (" · " + nav if nav else "") + app


class handler(BaseHTTPRequestHandler):

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        # 🔒 fronteira dura: só nível 10 (hoje = paulo e isa, os dois sócios).
        try:
            require_user(self, min_lvl=10)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})

        try:
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            params = {}
        try:
            dias = max(1, min(DIAS_MAX, int(params.get("dias") or DIAS_PADRAO)))
        except Exception:
            dias = DIAS_PADRAO

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})

        agora = datetime.now(timezone.utc)
        desde = agora - timedelta(days=dias)

        try:
            rows = (sb.table("user_sessions")
                    .select("jti,user_id,created_at,last_seen,ativo_seg,beats,"
                            "ended_at,end_reason,expires_at,ip,user_agent")
                    .gte("created_at", desde.isoformat())
                    .order("created_at", desc=True)
                    .limit(3000).execute().data) or []
            pessoas_db = (sb.table("users")
                          .select("id,name,role,team,status,is_service,last_login_at")
                          .execute().data) or []
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)})

        quem = {str(u.get("id")): u for u in pessoas_db}

        agg = {}          # user_id -> acumulado
        sessoes = []      # linhas do histórico (as mais recentes)

        for r in rows:
            uid = str(r.get("user_id") or "")
            entrou = _dt(r.get("created_at"))
            if not uid or not entrou:
                continue
            visto = _dt(r.get("last_seen"))
            fim_exp = _dt(r.get("ended_at"))
            ativo = int(r.get("ativo_seg") or 0)
            beats = int(r.get("beats") or 0)
            # medida existe? (sessão anterior à v88.5 nunca emitiu sinal)
            medido = beats > 0 or ativo > 0 or bool(fim_exp)
            saiu = fim_exp or visto
            online = bool(not fim_exp and visto and (agora - visto).total_seconds() <= ONLINE_SEG)
            span = int((saiu - entrou).total_seconds()) if (saiu and saiu > entrou) else 0

            if fim_exp:
                motivo = "logout"
            elif online:
                motivo = "aberta"
            elif medido:
                motivo = "fechou"
            else:
                motivo = "sem_medida"

            a = agg.setdefault(uid, {
                "sessoes": 0, "ativo_seg": 0, "span_seg": 0, "medidas": 0,
                "primeiro": entrou, "ultimo": saiu or entrou,
                "online": False, "por_dia": {}, "logouts": 0,
            })
            a["sessoes"] += 1
            a["ativo_seg"] += ativo
            a["span_seg"] += span
            if medido:
                a["medidas"] += 1
            if fim_exp:
                a["logouts"] += 1
            if entrou < a["primeiro"]:
                a["primeiro"] = entrou
            if saiu and saiu > a["ultimo"]:
                a["ultimo"] = saiu
            if online:
                a["online"] = True
            dia = _dia_brt(entrou)
            if dia:
                a["por_dia"][dia] = a["por_dia"].get(dia, 0) + ativo

            if len(sessoes) < MAX_SESSOES:
                sessoes.append({
                    "id": str(r.get("jti") or "")[:8],
                    "user_id": uid,
                    "entrou": _iso(entrou),
                    "saiu": _iso(saiu),
                    "ativo_seg": ativo,
                    "span_seg": span,
                    "motivo": motivo,
                    "online": online,
                    "device": _device(r.get("user_agent")),
                    "ip": r.get("ip") or "",
                })

        pessoas = []
        for uid, a in agg.items():
            u = quem.get(uid) or {}
            pessoas.append({
                "user_id": uid,
                "name": u.get("name") or uid,
                "role": u.get("role") or "?",
                "team": u.get("team") or "",
                "status": u.get("status") or "ativo",
                "is_service": bool(u.get("is_service")),
                "sessoes": a["sessoes"],
                "medidas": a["medidas"],
                "logouts": a["logouts"],
                "ativo_seg": a["ativo_seg"],
                "span_seg": a["span_seg"],
                "media_seg": int(a["ativo_seg"] / a["medidas"]) if a["medidas"] else 0,
                "dias_ativos": len([d for d, v in a["por_dia"].items() if v > 0]) or 0,
                "dias_com_login": len(a["por_dia"]),
                "primeiro": _iso(a["primeiro"]),
                "ultimo": _iso(a["ultimo"]),
                "online": a["online"],
                "por_dia": a["por_dia"],
            })
        # quem usa mais primeiro; sem medida ainda, ordena por nº de logins
        pessoas.sort(key=lambda p: (p["ativo_seg"], p["sessoes"]), reverse=True)

        # 👻 Quem NÃO apareceu na janela — o outro lado da pergunta do Paulo
        fantasmas = []
        for u in pessoas_db:
            uid = str(u.get("id"))
            if uid in agg or u.get("is_service"):
                continue
            if str(u.get("status") or "ativo").strip().lower() != "ativo":
                continue
            fantasmas.append({
                "user_id": uid,
                "name": u.get("name") or uid,
                "role": u.get("role") or "?",
                "last_login_at": u.get("last_login_at"),
            })
        fantasmas.sort(key=lambda f: (f["last_login_at"] or ""), reverse=True)

        reais = [p for p in pessoas if not p["is_service"]]
        return self._send(200, {
            "ok": True,
            "dias": dias,
            "desde": _iso(desde),
            "agora": _iso(agora),
            "pessoas": pessoas,
            "sessoes": sessoes,
            "fantasmas": fantasmas,
            "totais": {
                "pessoas_com_uso": len(reais),
                "pessoas_sem_uso": len(fantasmas),
                "online_agora": len([p for p in reais if p["online"]]),
                "ativo_seg": sum(p["ativo_seg"] for p in reais),
                "sessoes": sum(p["sessoes"] for p in reais),
                "truncado": len(rows) >= 3000 or len(sessoes) >= MAX_SESSOES,
            },
        })
