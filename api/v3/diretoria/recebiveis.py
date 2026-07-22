"""
GET/POST /api/v3/diretoria/recebiveis — 💰 Radar de Recebíveis + Esteira Pós-Venda. v84.83

Crise de liquidez 21/07/2026: dos R$47k previstos pra 24/07, só R$17k confirmados —
~R$30k travados em burocracia INVISÍVEL (nota não solicitada, contrato sem assinar).
O problema não é venda, é visibilidade do que trava cada comissão.

Sem Nibo por ora (upgrade caro; o bloqueio mora no DEAL, não na contabilidade).
Registro manual no ato + estrutura plugável: campo nibo_id nullable — a conciliação
automática entra ali quando o plano do Nibo subir (mesmo padrão do gancho NIBO=0
das Métricas de Viabilidade).

ESTEIRA (marco_atual): ganho → dossie_correspondente → credito_aprovado →
contrato_assinado → nota_solicitada → comissao_liberada → recebido.
Lado CLIENTE (dossiê, crédito, assinatura) = corretor do deal.
Lado INCORPORADORA (nota, liberação) = financeiro.

ACESSO: painel completo = sócio/diretor (lvl>=8) e financeiro/backoffice (operam
os itens). Corretor (lvl>=2) vê SÓ os seus (dono_cobranca ou corretor_id) — é o
card "seus negócios travados" do painel dele. Escopo travado AQUI, no backend.

CRON (?cron=1 + Bearer CRON_SECRET, via heartbeat a cada 2h):
  _sync_wins  — deal win no CRM → rascunho de recebível (dedupe por deal_ref;
                valor EDITÁVEL nasce vazio pro Paulo/financeiro preencher).
  _alertas    — D-3 com bloqueio → dono+diretoria · D+1 sem recebido → diretoria ·
                14d parado no mesmo marco → dono+diretoria · sem data/dono/valor →
                financeiro. Dedupe diário em shared_kv.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid
from datetime import datetime, timezone, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all, lvl_of, frente_of  # type: ignore

MARCOS = ("ganho", "dossie_correspondente", "credito_aprovado", "contrato_assinado",
          "nota_solicitada", "comissao_liberada", "recebido")
STATUS = ("previsto", "travado", "confirmado", "recebido", "perdido")
BLOQUEIOS = ("nenhum", "nota_fiscal", "assinatura_financiamento", "liberacao_incorporadora", "outro")
FRENTES = ("conquista", "map", "terceiros", "locacao")
PREMIO_TIPOS = ("produto", "percentual", "valor")
KV_ALERTAS = "recebiveis_alertas_enviados"


def _now():
    return datetime.now(timezone.utc)


def _hoje():
    return (_now() - timedelta(hours=3)).date()   # data BRT


def _txt(v, n=400):
    return (str(v or "").strip()[:n] or None)


def _num(v):
    try:
        return float(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _pode_tudo(user):
    return (user.get("lvl") or 0) >= 8 or (user.get("role") or "").lower() in ("financeiro", "backoffice")


def _financeiro_ids(sb):
    try:
        us = sb.table("users").select("id,role,status").limit(300).execute().data or []
        return [str(u["id"]) for u in us if (u.get("status") or "ativo") == "ativo"
                and (u.get("role") or "").lower() in ("financeiro", "backoffice")]
    except Exception:
        return []


def _diretoria_ids(sb):
    try:
        us = sb.table("users").select("id,role,status").limit(300).execute().data or []
        return [str(u["id"]) for u in us if (u.get("status") or "ativo") == "ativo"
                and (lvl_of(u.get("role")) or 0) >= 8]
    except Exception:
        return []


def _hist(r, user, tipo, de, para):
    h = r.get("historico") or []
    if not isinstance(h, list):
        h = []
    h.append({"ts": _now().isoformat(), "por": user.get("id"), "por_nome": user.get("name"),
              "tipo": tipo, "de": de, "para": para})
    return h[-80:]


def _notify(sb, user, r, titulo, corpo):
    """Envolvidos (dono, corretor) + diretoria — nunca broadcast. Nunca o autor."""
    try:
        alvos = {r.get("dono_cobranca"), r.get("corretor_id"), *_diretoria_ids(sb)}
        alvos.discard(None); alvos.discard(str(user.get("id")))
        if alvos:
            notify_all(list(alvos), tipo="recebivel", title=titulo, body=corpo,
                       link="#/estrategia?tab=recebiveis", target_type="recebiveis", target_id=r.get("id"))
    except Exception as e:
        print(f"[recebiveis] notify err: {e}")


def _premiacao(raw, antiga):
    if not isinstance(raw, dict):
        return antiga
    tipo = (raw.get("tipo") or "").strip().lower()
    if tipo and tipo not in PREMIO_TIPOS:
        tipo = "valor"
    return {"tipo": tipo or (antiga or {}).get("tipo"),
            "valor": _num(raw.get("valor")) if "valor" in raw else (antiga or {}).get("valor"),
            "detalhe": _txt(raw.get("detalhe"), 300) if "detalhe" in raw else (antiga or {}).get("detalhe")}


# ── CRON: deal ganho → rascunho ──────────────────────────────────────────────
def _sync_wins(sb):
    desde = (_now() - timedelta(days=45)).isoformat()
    try:
        deals = sb.table("deals").select("id,name,amount,closed_at,pipeline_name,user_id") \
            .eq("win", True).gte("closed_at", desde).limit(500).execute().data or []
    except Exception:
        return {"criados": 0, "erro": "deals indisponível"}
    try:
        tem = {str(r.get("deal_ref")) for r in
               (sb.table("recebiveis").select("deal_ref").not_.is_("deal_ref", "null")
                .limit(2000).execute().data or [])}
    except Exception:
        return {"criados": 0, "erro": "recebiveis indisponível (rode a migração)"}
    criados = 0
    for d in deals:
        did = str(d.get("id") or "")
        if not did or did in tem:
            continue
        fr = frente_of(d.get("pipeline_name"))
        if fr not in FRENTES:
            fr = "conquista"
        row = {"id": "rc_" + uuid.uuid4().hex[:10], "deal_ref": did,
               "descricao": (d.get("name") or "Deal ganho")[:200],
               "frente": fr, "valor_bruto": _num(d.get("amount")),
               "valor_liquido_estimado": None,   # EDITÁVEL — o Paulo/financeiro preenche
               "status": "previsto", "marco_atual": "ganho",
               "corretor_id": d.get("user_id"),
               "notas": "Criado automático do deal ganho no CRM — completar valor, data e pagador.",
               "historico": [{"ts": _now().isoformat(), "por": "sistema", "tipo": "criacao",
                              "de": None, "para": "previsto (deal win)"}]}
        try:
            sb.table("recebiveis").insert(row).execute()
            criados += 1
        except Exception:
            pass
    return {"criados": criados, "wins_vistos": len(deals)}


# ── CRON: alertas (dedupe diário em shared_kv) ───────────────────────────────
def _alertas(sb):
    try:
        rows = sb.table("recebiveis").select("*").limit(1000).execute().data or []
    except Exception:
        return {"erro": "recebiveis indisponível"}
    try:
        kv = sb.table("shared_kv").select("value").eq("key", KV_ALERTAS).limit(1).execute().data or []
        enviados = kv[0]["value"] if kv and isinstance(kv[0].get("value"), dict) else {}
    except Exception:
        enviados = {}
    hoje = _hoje(); hoje_s = hoje.isoformat()
    fin = _financeiro_ids(sb); dirs = _diretoria_ids(sb)
    n = 0

    def manda(chave, alvos, titulo, corpo, rid):
        nonlocal n
        k = f"{chave}:{hoje_s}"
        if enviados.get(k):
            return
        alvos = [a for a in set(alvos) if a]
        if not alvos:
            return
        try:
            notify_all(alvos, tipo="recebivel", title=titulo, body=corpo,
                       link="#/estrategia?tab=recebiveis", target_type="recebiveis", target_id=rid)
            enviados[k] = True; n += 1
        except Exception:
            pass

    for r in rows:
        if r.get("status") in ("recebido", "perdido"):
            continue
        rid = r["id"]; val = r.get("valor_liquido_estimado") or r.get("valor_bruto") or 0
        val_s = f"R$ {float(val):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if val else "valor a definir"
        dp = None
        try:
            dp = date.fromisoformat(str(r.get("data_prevista"))[:10]) if r.get("data_prevista") else None
        except Exception:
            pass
        # 🔴 D-3 com bloqueio ativo → dono + diretoria
        if dp and (r.get("bloqueio") or "nenhum") != "nenhum" and 0 <= (dp - hoje).days <= 3:
            manda(f"d3:{rid}", [r.get("dono_cobranca")] + dirs,
                  "🔴 Recebível a 3 dias COM BLOQUEIO",
                  f"{r.get('descricao')} · {val_s} · bloqueio: {r.get('bloqueio')} · prevê {dp.strftime('%d/%m')}", rid)
        # 🔴 D+1 sem recebido → diretoria
        if dp and (hoje - dp).days >= 1:
            manda(f"d1:{rid}", dirs, "🔴 Recebível VENCIDO sem baixa",
                  f"{r.get('descricao')} · {val_s} · previa {dp.strftime('%d/%m')} e não foi marcado recebido", rid)
        # 🔴 14 dias parado no mesmo marco → dono + diretoria
        ult = None
        for h in reversed(r.get("historico") or []):
            if h.get("tipo") in ("marco", "criacao"):
                ult = h.get("ts"); break
        try:
            parado = (_now() - datetime.fromisoformat(str(ult).replace("Z", "+00:00"))).days if ult else 0
        except Exception:
            parado = 0
        if parado >= 14:
            manda(f"parado:{rid}", [r.get("dono_cobranca"), r.get("corretor_id")] + dirs,
                  "🔴 Recebível PARADO há 14+ dias no mesmo marco",
                  f"{r.get('descricao')} · {val_s} · marco: {r.get('marco_atual')} há {parado}d", rid)
        # 🟡 incompleto → financeiro
        faltas = [x for x, ok in (("data", dp), ("dono", r.get("dono_cobranca")),
                                  ("valor", r.get("valor_liquido_estimado"))) if not ok]
        if faltas:
            manda(f"inc:{rid}", fin, "🟡 Recebível incompleto",
                  f"{r.get('descricao')} — falta: {', '.join(faltas)}", rid)

    try:
        sb.table("shared_kv").upsert({"key": KV_ALERTAS,
                                      "value": {k: v for k, v in enviados.items() if hoje_s in k},
                                      "updated_at": _now().isoformat()}, on_conflict="key").execute()
    except Exception:
        pass
    return {"alertas": n}


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

    def do_GET(self):
        # modo CRON (heartbeat): sync wins + alertas
        if "cron=1" in (self.path or ""):
            sec = os.environ.get("CRON_SECRET", "")
            auth = self.headers.get("Authorization") or ""
            if not sec or auth != f"Bearer {sec}":
                return self._send(401, {"ok": False, "error": "CRON_SECRET"})
            sb = supabase_client()
            if not sb:
                return self._send(503, {"ok": False})
            return self._send(200, {"ok": True, "sync": _sync_wins(sb), "alertas": _alertas(sb)})

        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            rows = sb.table("recebiveis").select("*").order("data_prevista").limit(1000).execute().data or []
        except Exception as e:
            msg = str(e)
            if "recebiveis" in msg or "42P01" in msg:
                return self._send(200, {"ok": True, "itens": [], "migracao_pendente": True})
            return self._send(502, {"ok": False, "error": msg[:200]})
        uid = str(user.get("id"))
        completo = _pode_tudo(user)
        if not completo:
            rows = [r for r in rows if uid in (str(r.get("dono_cobranca") or ""), str(r.get("corretor_id") or ""))]
        # KPIs (sobre o escopo visível)
        hoje = _hoje()
        def val(r): return float(r.get("valor_liquido_estimado") or 0)
        ativos = [r for r in rows if r.get("status") not in ("recebido", "perdido")]
        conf7 = sum(val(r) for r in ativos if r.get("status") == "confirmado" and r.get("data_prevista")
                    and 0 <= (date.fromisoformat(str(r["data_prevista"])[:10]) - hoje).days <= 7)
        travado = {}
        for r in ativos:
            if r.get("status") == "travado" or (r.get("bloqueio") or "nenhum") != "nenhum":
                travado[r.get("bloqueio") or "outro"] = travado.get(r.get("bloqueio") or "outro", 0) + val(r)
        mes = hoje.strftime("%Y-%m")
        prev_mes = sum(val(r) for r in ativos if str(r.get("data_prevista") or "").startswith(mes))
        receb_mes = sum(val(r) for r in rows if r.get("status") == "recebido"
                        and str(r.get("data_prevista") or "").startswith(mes))
        return self._send(200, {"ok": True, "itens": rows, "completo": completo, "eu": uid,
                                "kpis": {"confirmado_7d": conf7, "travado": travado,
                                         "travado_total": sum(travado.values()),
                                         "previsto_mes": prev_mes, "recebido_mes": receb_mes}})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") if n else "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        action = (body.get("action") or "upsert").strip()
        uid = str(user.get("id"))

        def carrega(rid):
            rows = sb.table("recebiveis").select("*").eq("id", str(rid)).limit(1).execute().data or []
            return rows[0] if rows else None

        def pode_mexer(r):
            return _pode_tudo(user) or uid in (str(r.get("dono_cobranca") or ""), str(r.get("corretor_id") or ""))

        try:
            if action == "upsert":
                if not _pode_tudo(user):
                    return self._send(403, {"ok": False, "error": "criar/editar é da diretoria e do financeiro"})
                rid = _txt(body.get("id"), 40)
                antigo = carrega(rid) if rid else None
                # EDIÇÃO É PATCH: campo não enviado não é tocado
                campos = {}
                for k, fn in (("descricao", lambda v: _txt(v, 200)), ("frente", lambda v: v if v in FRENTES else None),
                              ("valor_bruto", _num), ("valor_liquido_estimado", _num),
                              ("data_prevista", lambda v: _txt(v, 10)), ("dono_cobranca", lambda v: _txt(v, 60)),
                              ("corretor_id", lambda v: _txt(v, 60)), ("pagador", lambda v: _txt(v, 200)),
                              ("notas", lambda v: _txt(v, 2000)), ("deal_ref", lambda v: _txt(v, 60))):
                    if k in body:
                        campos[k] = fn(body.get(k))
                if "premiacao" in body:
                    campos["premiacao"] = _premiacao(body.get("premiacao"), (antigo or {}).get("premiacao"))
                campos["atualizado_em"] = _now().isoformat()
                if antigo:
                    campos["historico"] = _hist(antigo, user, "edicao", None, "campos: " + ",".join(campos.keys()))
                    sb.table("recebiveis").update(campos).eq("id", antigo["id"]).execute()
                    rid = antigo["id"]
                else:
                    if not campos.get("descricao"):
                        return self._send(400, {"ok": False, "error": "descrição obrigatória"})
                    campos.update({"id": "rc_" + uuid.uuid4().hex[:10], "status": "previsto",
                                   "marco_atual": "ganho",
                                   "historico": [{"ts": _now().isoformat(), "por": uid, "por_nome": user.get("name"),
                                                  "tipo": "criacao", "de": None, "para": "previsto"}]})
                    sb.table("recebiveis").insert(campos).execute()
                    rid = campos["id"]
                audit(self, user, "recebivel.upsert", "recebiveis", rid, notes=campos.get("descricao"))
                return self._send(200, {"ok": True, "id": rid})

            # ações de 1 clique — dono/corretor/financeiro/diretoria do item
            r = carrega(body.get("id"))
            if not r:
                return self._send(404, {"ok": False, "error": "recebível não encontrado"})
            if not pode_mexer(r):
                return self._send(403, {"ok": False, "error": "sem alçada neste recebível"})

            if action == "marco":
                novo = str(body.get("marco") or "")
                if novo not in MARCOS:
                    return self._send(400, {"ok": False, "error": "marco inválido"})
                patch = {"marco_atual": novo, "atualizado_em": _now().isoformat(),
                         "historico": _hist(r, user, "marco", r.get("marco_atual"), novo)}
                # avançar marco destrava (nota solicitada resolve bloqueio de nota etc.)
                if novo in ("nota_solicitada", "comissao_liberada") and r.get("bloqueio") in ("nota_fiscal", "liberacao_incorporadora"):
                    patch["bloqueio"] = "nenhum"; patch["status"] = "confirmado" if r.get("status") == "travado" else r.get("status")
                if novo in ("contrato_assinado",) and r.get("bloqueio") == "assinatura_financiamento":
                    patch["bloqueio"] = "nenhum"; patch["status"] = "confirmado" if r.get("status") == "travado" else r.get("status")
                if novo == "recebido":
                    patch["status"] = "recebido"
                sb.table("recebiveis").update(patch).eq("id", r["id"]).execute()
                audit(self, user, "recebivel.marco", "recebiveis", r["id"], notes=f"{r.get('marco_atual')}→{novo}")
                _notify(sb, user, r, f"📍 {r.get('descricao')[:60]}", f"marco: {novo.replace('_',' ')}")
                return self._send(200, {"ok": True})

            if action == "bloqueio":
                bq = str(body.get("bloqueio") or "outro")
                if bq not in BLOQUEIOS:
                    bq = "outro"
                patch = {"bloqueio": bq, "bloqueio_obs": _txt(body.get("obs"), 300),
                         "status": "travado" if bq != "nenhum" else "previsto",
                         "atualizado_em": _now().isoformat(),
                         "historico": _hist(r, user, "bloqueio", r.get("bloqueio"), bq)}
                sb.table("recebiveis").update(patch).eq("id", r["id"]).execute()
                audit(self, user, "recebivel.bloqueio", "recebiveis", r["id"], notes=bq)
                if bq != "nenhum":
                    _notify(sb, user, r, f"⛔ TRAVOU: {r.get('descricao')[:60]}", f"bloqueio: {bq.replace('_',' ')}")
                return self._send(200, {"ok": True})

            if action == "status":
                st = str(body.get("status") or "")
                if st not in STATUS:
                    return self._send(400, {"ok": False, "error": "status inválido"})
                patch = {"status": st, "atualizado_em": _now().isoformat(),
                         "historico": _hist(r, user, "status", r.get("status"), st)}
                if st == "recebido":
                    patch["marco_atual"] = "recebido"; patch["bloqueio"] = "nenhum"
                sb.table("recebiveis").update(patch).eq("id", r["id"]).execute()
                audit(self, user, "recebivel.status", "recebiveis", r["id"], notes=st)
                if st in ("recebido", "perdido"):
                    _notify(sb, user, r, ("✅ RECEBIDO: " if st == "recebido" else "❌ PERDIDO: ") + r.get("descricao")[:60],
                            f"por {user.get('name')}")
                return self._send(200, {"ok": True})

            if action == "delete":
                if (user.get("lvl") or 0) < 8:
                    return self._send(403, {"ok": False, "error": "apagar é do sócio"})
                sb.table("recebiveis").delete().eq("id", r["id"]).execute()
                audit(self, user, "recebivel.delete", "recebiveis", r["id"], notes=r.get("descricao"))
                return self._send(200, {"ok": True})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
