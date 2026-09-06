"""
GET/POST /api/v3/crm/retroativo_rd
  Auth: Authorization: Bearer <CRON_SECRET>  OU  ?key=<CRON_SECRET>  OU  JWT Sócio (lvl>=10)

RETROATIVO do RD CRM (decisão Paulo 06/set/2026): traz o HISTÓRICO de mudanças
de etapa (deal_stage_histories) de TODOS os deals pro banco do House — o RD só
expõe esse histórico no GET individual v1 (1 GET por deal), então capturamos
ANTES de qualquer cancelamento futuro do RD, senão a análise de funil morre
junto com a assinatura.

Como funciona (IDEMPOTENTE e retomável em lotes):
  - Cada chamada varre um lote de deals da tabela `deals` (keyset por id asc,
    cursor em shared_kv 'retroativo_rd_progresso').
  - Por deal: GET https://crm.rdstation.com/api/v1/deals/{id} → extrai
    deal_stage_histories → upsert em rd_stage_hist (unique deal_id+mudou_em+
    etapa_para, ignore duplicates) com etapa_de derivada da entrada anterior.
  - Rate limit RD (120 req/min): pacing >=0.55s entre requests + backoff em 429.
  - Orçamento de tempo (~250s, maxDuration 300 no vercel.json): para com folga
    e salva o cursor; chamadas repetidas continuam de onde parou.
  - Quando a varredura acaba: concluido=true no KV e na resposta.

Query/body opcionais:
  lote      int  máx de deals nesta chamada (default 400, teto 800)
  budget_s  int  orçamento de tempo em s (default 250, teto 280)
  status=1       só retorna o progresso, sem processar
  probe=<deal_id> retorna as chaves do GET individual daquele deal (debug de shape)
  reset=1        zera o cursor (recomeça do zero; dados já gravados ficam — dedup)

Resp: { ok, concluido, processados_agora, historias_agora, progresso:{...} }
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

RD_BASE = "https://crm.rdstation.com/api/v1"
KV_KEY = "retroativo_rd_progresso"
PACE_S = 0.55          # >=0.55s entre inícios de request → ~109 req/min (< 120)
LOTE_DEFAULT = 400
LOTE_MAX = 800
BUDGET_DEFAULT = 250
BUDGET_MAX = 280


# ─── helpers ────────────────────────────────────────────────────────────────

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.isoformat()
    except Exception:
        return None


def _kv_get(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


def _kv_set(sb, val):
    sb.table("shared_kv").upsert({
        "key": KV_KEY, "value": val, "updated_at": _now_iso(),
    }, on_conflict="key").execute()


def _fresh_progress():
    return {
        "ultima_pagina": 0,
        "ultimo_deal_id": "",
        "deals_processados": 0,
        "historias_gravadas": 0,
        "deals_sem_historico": 0,
        "deals_404": 0,
        "erros_total": 0,
        "ultimos_erros": [],
        "concluido": False,
        "iniciado_em": _now_iso(),
        "atualizado_em": _now_iso(),
    }


def _rd_get_deal(token, deal_id):
    url = RD_BASE + "/deals/" + urllib.parse.quote(str(deal_id)) + "?" + urllib.parse.urlencode({"token": token})
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "PSM-OS-v3/retroativo"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_histories(deal):
    """Lista de entradas de histórico do deal, tolerante a variações de nome."""
    if not isinstance(deal, dict):
        return None
    for k in ("deal_stage_histories", "deal_stage_history", "stage_histories", "deal_stages_history"):
        v = deal.get(k)
        if isinstance(v, list):
            return v
    return None


def _entry_stage(entry):
    """(stage_id, stage_name) de uma entrada de histórico."""
    ds = entry.get("deal_stage")
    if isinstance(ds, dict):
        return (str(ds.get("id")) if ds.get("id") is not None else None,
                ds.get("name") or ds.get("nickname") or None)
    sid = entry.get("deal_stage_id") or entry.get("stage_id")
    return (str(sid) if sid is not None else None,
            entry.get("name") or entry.get("stage_name") or None)


def _entry_when(entry):
    for k in ("created_at", "start_date", "date", "updated_at"):
        iso = _parse_iso(entry.get(k))
        if iso:
            return iso
    return None


def _rows_from_deal(deal_id, funil_fallback, deal):
    """Converte um deal individual do RD nas linhas de rd_stage_hist.
    Retorna (rows, teve_historico)."""
    hists = _extract_histories(deal)
    if not hists:
        return [], False
    pipe = deal.get("deal_pipeline") if isinstance(deal.get("deal_pipeline"), dict) else {}
    funil = (pipe.get("name") or funil_fallback or None)
    pipe_id = str(pipe.get("id")) if pipe.get("id") is not None else None
    parsed = []
    for e in hists:
        if not isinstance(e, dict):
            continue
        sid, sname = _entry_stage(e)
        when = _entry_when(e)
        if not when or not (sname or sid):
            continue
        parsed.append({"when": when, "sid": sid, "sname": sname or sid, "raw": e})
    parsed.sort(key=lambda x: x["when"])
    rows = []
    prev_name, prev_id = None, None
    for p in parsed:
        rows.append({
            "deal_id": str(deal_id),
            "pipeline_id": pipe_id,
            "funil": funil,
            "etapa_de": prev_name,
            "etapa_de_id": prev_id,
            "etapa_para": p["sname"],
            "etapa_para_id": p["sid"],
            "mudou_em": p["when"],
            "raw": p["raw"],
        })
        prev_name, prev_id = p["sname"], p["sid"]
    return rows, True


def _upsert_hist(sb, rows):
    if not rows:
        return 0
    try:
        sb.table("rd_stage_hist").upsert(
            rows, on_conflict="deal_id,mudou_em,etapa_para", ignore_duplicates=True
        ).execute()
        return len(rows)
    except Exception:
        ok = 0
        for r in rows:
            try:
                sb.table("rd_stage_hist").upsert(
                    [r], on_conflict="deal_id,mudou_em,etapa_para", ignore_duplicates=True
                ).execute()
                ok += 1
            except Exception:
                pass
        return ok


def _cron_ok(headers, path):
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        return False
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and auth[7:].strip() == secret:
        return True
    try:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))
        return q.get("key") == secret
    except Exception:
        return False


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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _run(self):
        q = {}
        try:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        except Exception:
            pass

        actor = None
        if not _cron_ok(self.headers, self.path):
            try:
                actor = require_user(self, min_lvl=10)  # Sócio
            except AuthError as e:
                return self._send(e.status, {"ok": False, "error": e.message})

        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend indisponível"})
        rd_token = os.environ.get("RD_API_TOKEN")
        if not rd_token:
            return self._send(503, {"ok": False, "error": "RD_API_TOKEN ausente"})

        # body opcional (POST)
        body = {}
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n:
                body = json.loads(self.rfile.read(n).decode("utf-8")) or {}
        except Exception:
            body = {}

        prog = _kv_get(sb) or _fresh_progress()

        # ── modos utilitários ──────────────────────────────────────────────
        if q.get("status"):
            return self._send(200, {"ok": True, "progresso": prog})

        if q.get("probe"):
            try:
                d = _rd_get_deal(rd_token, q["probe"])
                hists = _extract_histories(d)
                return self._send(200, {
                    "ok": True, "keys": sorted(list(d.keys())) if isinstance(d, dict) else None,
                    "historico_encontrado": bool(hists),
                    "historico_qtd": len(hists) if hists else 0,
                    "amostra": (hists or [None])[0],
                })
            except Exception as e:
                return self._send(502, {"ok": False, "error": f"probe: {e}"})

        if q.get("reset"):
            prog = _fresh_progress()
            _kv_set(sb, prog)
            audit(self, actor, "crm.retroativo_rd.reset", target_type="rd_stage_hist", target_id="*")
            return self._send(200, {"ok": True, "resetado": True, "progresso": prog})

        if prog.get("concluido"):
            return self._send(200, {"ok": True, "concluido": True,
                                    "processados_agora": 0, "historias_agora": 0,
                                    "progresso": prog})

        # ── parâmetros do lote ─────────────────────────────────────────────
        def _int(name, dflt, teto):
            try:
                v = int(body.get(name) or q.get(name) or dflt)
            except Exception:
                v = dflt
            return max(1, min(v, teto))

        lote = _int("lote", LOTE_DEFAULT, LOTE_MAX)
        budget = _int("budget_s", BUDGET_DEFAULT, BUDGET_MAX)

        t0 = time.time()
        cursor = str(prog.get("ultimo_deal_id") or "")

        try:
            sel = sb.table("deals").select("id,pipeline_name").order("id")
            if cursor:
                sel = sel.gt("id", cursor)
            deals = sel.limit(lote).execute().data or []
        except Exception as e:
            return self._send(502, {"ok": False, "error": f"deals: {e}", "progresso": prog})

        if not deals:
            prog["concluido"] = True
            prog["atualizado_em"] = _now_iso()
            _kv_set(sb, prog)
            audit(self, actor, "crm.retroativo_rd.concluido", target_type="rd_stage_hist", target_id="*",
                  notes=f"deals={prog.get('deals_processados')} historias={prog.get('historias_gravadas')}")
            return self._send(200, {"ok": True, "concluido": True,
                                    "processados_agora": 0, "historias_agora": 0,
                                    "progresso": prog})

        processados = 0
        historias = 0
        call_proc = 0
        call_hist = 0
        buffer_rows = []
        last_req = 0.0
        interrompido = None

        for d in deals:
            if time.time() - t0 > budget:
                interrompido = "orçamento de tempo"
                break
            did = d.get("id")
            if not did:
                continue

            # pacing pro rate limit do RD (120 req/min)
            wait = PACE_S - (time.time() - last_req)
            if wait > 0:
                time.sleep(wait)
            last_req = time.time()

            deal_full = None
            err = None
            for tentativa in (1, 2):
                try:
                    deal_full = _rd_get_deal(rd_token, did)
                    err = None
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        prog["deals_404"] = int(prog.get("deals_404") or 0) + 1
                        err = None
                        break
                    if e.code == 429 and tentativa == 1:
                        time.sleep(20)  # estourou rate limit → respira e tenta 1x
                        continue
                    err = f"{did}: HTTP {e.code}"
                    break
                except Exception as e:
                    if tentativa == 1:
                        time.sleep(1.5)
                        continue
                    err = f"{did}: {e}"
                    break

            if err:
                prog["erros_total"] = int(prog.get("erros_total") or 0) + 1
                ult = prog.get("ultimos_erros") or []
                ult.append(err)
                prog["ultimos_erros"] = ult[-10:]
            elif deal_full:
                rows, teve = _rows_from_deal(did, d.get("pipeline_name"), deal_full)
                if teve:
                    buffer_rows.extend(rows)
                else:
                    prog["deals_sem_historico"] = int(prog.get("deals_sem_historico") or 0) + 1
                    # diagnóstico de shape: guarda as chaves do 1º deal sem histórico
                    # (se TODO deal cair aqui, o nome do campo no GET v1 é outro)
                    if not prog.get("amostra_sem_historico"):
                        try:
                            prog["amostra_sem_historico"] = {
                                "deal_id": str(did),
                                "keys": sorted(list(deal_full.keys()))[:40],
                            }
                        except Exception:
                            pass

            processados += 1
            prog["ultimo_deal_id"] = str(did)

            if len(buffer_rows) >= 100:
                n = _upsert_hist(sb, buffer_rows)
                historias += n
                call_hist += n
                buffer_rows = []
                # checkpoint intermediário — retomável mesmo se a função morrer
                prog["deals_processados"] = int(prog.get("deals_processados") or 0) + processados
                prog["historias_gravadas"] = int(prog.get("historias_gravadas") or 0) + historias
                prog["atualizado_em"] = _now_iso()
                try:
                    _kv_set(sb, prog)
                except Exception:
                    pass
                call_proc += processados
                processados = 0
                historias = 0

        if buffer_rows:
            n = _upsert_hist(sb, buffer_rows)
            historias += n
            call_hist += n
        call_proc += processados

        prog["deals_processados"] = int(prog.get("deals_processados") or 0) + processados
        prog["historias_gravadas"] = int(prog.get("historias_gravadas") or 0) + historias
        prog["ultima_pagina"] = int(prog.get("ultima_pagina") or 0) + 1
        # fim da tabela sem interrupção e lote veio curto → acabou
        if interrompido is None and len(deals) < lote:
            prog["concluido"] = True
        prog["atualizado_em"] = _now_iso()
        _kv_set(sb, prog)

        dur = round(time.time() - t0, 1)
        audit(self, actor, "crm.retroativo_rd.lote", target_type="rd_stage_hist", target_id="*",
              notes=f"lote={len(deals)} dur={dur}s cursor={prog.get('ultimo_deal_id')}")

        return self._send(200, {
            "ok": True,
            "concluido": bool(prog.get("concluido")),
            "interrompido_por": interrompido,
            "processados_agora": call_proc,
            "historias_agora": call_hist,
            "lote_solicitado": lote,
            "duration_s": dur,
            "progresso": prog,
        })

    def do_GET(self):
        return self._run()

    def do_POST(self):
        return self._run()
