"""
GET /api/v3/producao/painel — os 3 cards do Painel de Fiscalização prontos. v84.18

Devolve, por colaborador: contadores dia/semana/mês (split manhã/tarde), metas,
semáforo (esperado proporcional ao horário), pendências (docs/tickets Leire),
NPS + fila de promotores + visitas sem feedback (Mariane), placar do mês com
rampa (Guilherme). Também RODA as checagens de alerta com dedupe — é assim que
o "doc cruzou 48h" dispara no pulso seguinte, sem esperar o cron das 14h.

?visao=me → devolve só o card do próprio colaborador (visão individual).
POST action=set_cfg {cfg} (lvl>=7) → edita metas/comissões (merge no shared_kv).
Auth: GET lvl>=2 · POST lvl>=7.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
from _fisc_lib import (get_cfg, TIPOS_POR_COLAB, colaborador_do_user, agora_brt, janelas,  # type: ignore
                       eventos_periodo, contadores, esperado_agora, semaforo_pct,
                       mes_rampa, pendencias_abertas, checar_alertas, KV_CFG, _merge, _ts)


def _visitas_sem_nps(sb, eventos, cfg):
    """Visitas reais (deal_stage_events) nos funis MAP/Conquista/Locação nos
    últimos 14d sem nps_coletado com ref no deal. Defensivo: erro → zeros."""
    nps_refs = {e.get("ref_id") for e in eventos if e["tipo"] == "nps_coletado" and e.get("ref_id")}
    try:
        desde = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        rows = sb.table("deal_stage_events").select("deal_id,stage_name,pipeline_name,occurred_at") \
            .gte("occurred_at", desde).ilike("stage_name", "%visit%").limit(3000).execute().data or []
    except Exception:
        return {"total": 0, "atrasadas": 0}
    lim_h = ((cfg["colaboradores"].get("mariane") or {}).get("nps") or {}).get("visita_sem_nps_horas", 48)
    agora = datetime.now(timezone.utc)
    pend, atras = 0, 0
    vistos = set()
    for r in rows:
        pipe = (r.get("pipeline_name") or "").lower()
        if not any(k in pipe for k in ("map", "conquista", "loca")):
            continue
        did = str(r.get("deal_id"))
        if did in vistos or did in nps_refs:
            continue
        vistos.add(did)
        pend += 1
        try:
            occ = datetime.fromisoformat(str(r["occurred_at"]).replace("Z", "+00:00"))
            if (agora - occ).total_seconds() / 3600 > float(lim_h):
                atras += 1
        except Exception:
            pass
    return {"total": pend, "atrasadas": atras}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_POST(self):  # editor de metas (gestor)
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
            body = json.loads(raw or "{}")
            patch = body.get("cfg") or {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        novo = _merge(get_cfg(sb), patch)
        try:
            sb.table("shared_kv").upsert({"key": KV_CFG, "value": novo,
                                          "updated_at": datetime.now(timezone.utc).isoformat()},
                                         on_conflict="key").execute()
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        audit(self, actor, "producao.set_cfg", "kv", KV_CFG)
        return self._send(200, {"ok": True, "cfg": novo})

    def do_GET(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cfg = get_cfg(sb)
        now = agora_brt()
        _, _, mes_ini = janelas(now)
        # busca 45d pra trás: pega o mês inteiro + pendências de doc que cruzam o mês
        desde = (mes_ini - timedelta(days=15)).astimezone(timezone.utc).isoformat()
        eventos = eventos_periodo(sb, desde)
        cont = contadores(eventos, cfg, now)

        # alertas com dedupe — o pulso é quem pega o "cruzou 48h" no ato
        disparos = checar_alertas(sb, cfg, eventos, notify_all, enviar=True)

        cards = []
        for key, c in (cfg.get("colaboradores") or {}).items():
            ct = cont.get(key, {})
            card = {"key": key, "nome": c.get("nome") or key.title(),
                    "tipos": TIPOS_POR_COLAB.get(key, []),
                    "contadores": ct, "metas": c.get("metas") or {}, "alertas": []}
            if c.get("motor") == "mes_composto":  # Guilherme: placar do MÊS c/ rampa
                rampa = mes_rampa(c, now)
                metas_mes, feito_mes = {}, {}
                for frente, faixas in (c.get("metas_rampa") or {}).items():
                    metas_mes[frente] = float(faixas.get(rampa) or 0)
                    if frente.startswith(("video_", "art_")):
                        fmt, marca = frente.split("_", 1)
                        n = 0
                        for e in eventos:
                            if (e["colaborador"] == key and e["tipo"] == "conteudo_entregue"
                                    and (e.get("meta") or {}).get("formato") == fmt
                                    and (e.get("meta") or {}).get("marca") == marca):
                                t = _ts(e)
                                if t and t >= mes_ini:
                                    n += 1
                        feito_mes[frente] = n
                    else:
                        feito_mes[frente] = (ct.get(frente) or {}).get("mes", 0)
                pcts = [min(1.0, feito_mes[f] / m) for f, m in metas_mes.items() if m > 0]
                composto = (sum(pcts) / len(pcts)) if pcts else 0
                frac_mes = now.day / 30.0
                cor, pct = semaforo_pct(composto, frac_mes, cfg)
                card.update({"rampa": rampa, "placar_mes": {"metas": metas_mes, "feito": feito_mes},
                             "semaforo": cor, "pct": pct})
            else:  # Leire / Mariane: motor diário
                motor = c.get("motor")
                m = (c.get("metas") or {}).get(motor) or {}
                feito = ct.get(motor) or {}
                esperado = esperado_agora(m, cfg, now)
                alerta_ativo = False
                if key == "leire":
                    sla = c.get("sla_horas") or {}
                    docs = pendencias_abertas(eventos_colab(eventos, key), "doc_aberto", "doc_resolvido",
                                              float(sla.get("doc", 48)), now)
                    tickets = pendencias_abertas(eventos_colab(eventos, key), "ticket_locacao_aberto",
                                                 "ticket_locacao_respondido",
                                                 float(sla.get("ticket_locacao", 24)), now)
                    card["docs"] = docs
                    card["tickets"] = tickets
                    if any(d["estourado"] for d in docs):
                        card["alertas"].append("🔴 doc >48h")
                        alerta_ativo = True
                    if any(t["estourado"] for t in tickets):
                        card["alertas"].append("🔴 SLA locação >24h")
                        alerta_ativo = True
                if key == "mariane":
                    nps_cfg = c.get("nps") or {}
                    notas = [float(e.get("valor") or 0) for e in eventos
                             if e["colaborador"] == key and e["tipo"] == "nps_coletado"]
                    prom = sum(1 for n in notas if n >= float(nps_cfg.get("promotor_min", 9)))
                    detr = sum(1 for n in notas if n <= float(nps_cfg.get("detrator_max", 6)))
                    score = round(100 * (prom - detr) / len(notas)) if notas else None
                    abordados = {e.get("ref_id") for e in eventos
                                 if e["colaborador"] == key and e["tipo"] == "abordagem_indicacao" and e.get("ref_id")}
                    fila_prom = sum(1 for e in eventos
                                    if e["tipo"] == "nps_coletado" and float(e.get("valor") or 0) >= 9
                                    and (e.get("ref_id") not in abordados))
                    visitas = _visitas_sem_nps(sb, eventos, cfg)
                    card["nps"] = {"score": score, "n": len(notas), "meta_min": nps_cfg.get("score_min", 70),
                                   "detratores": detr, "fila_promotores": fila_prom,
                                   "visitas_sem_nps": visitas}
                    if visitas.get("atrasadas"):
                        card["alertas"].append(f"🔵 {visitas['atrasadas']} visita(s) >48h sem NPS")
                    if score is not None and score < float(nps_cfg.get("score_min", 70)):
                        card["alertas"].append("🟠 NPS abaixo da meta")
                cor, pct = semaforo_pct(float(feito.get("dia") or 0), esperado, cfg, alerta=alerta_ativo)
                card.update({"motor": motor, "motor_meta": m, "motor_feito": feito,
                             "esperado_agora": round(esperado, 1), "semaforo": cor, "pct": pct})
            cards.append(card)

        me = colaborador_do_user(cfg, user)
        gestor = (user.get("lvl") or 0) >= 7
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        if ("visao=me" in q or not gestor) and me:
            cards = [c for c in cards if c["key"] == me]
        elif not gestor and not me:
            return self._send(403, {"ok": False, "error": "painel restrito aos colaboradores e à gestão"})
        return self._send(200, {"ok": True, "cards": cards, "sou": me, "gestor": gestor,
                                "lembrete_reativacao": cfg.get("lembrete_reativacao") or [],
                                "agora_brt": now.isoformat(), "alertas_disparados": disparos})


def eventos_colab(eventos, key):
    return [e for e in eventos if e.get("colaborador") == key]
