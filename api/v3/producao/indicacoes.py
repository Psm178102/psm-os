"""
GET/POST /api/v3/producao/indicacoes — INDICAÇÃO PREMIADA (Mariane). v84.22

O funil da indicação como entidade própria, do registro ao prêmio pago:
  nova → qualificada → no_crm (vinculada a um deal do RD) → vendida →
  premio_aprovado → premio_pago   (ou perdida)

Interligações (nada duplicado):
- PRÊMIO pela faixa de VGV da fiscalizacao_cfg (premio_indicacao_venda /
  premio_indicacao_locacao) — mesma fonte do Painel de Fiscalização.
- RD CRM: vincular ao deal (tabela deals); "conferir vendas" varre os deals
  vinculados — win=true processa a venda SOZINHO (valor = amount do RD).
- FISCALIZAÇÃO: qualificada → evento indicacao_qualificada; vendida → evento
  venda_atribuida_indicacao (valor + prêmio) — contadores da Mariane andam sós.
- NPS: action=puxar_promotores transforma notas ≥9 sem indicação em fichas
  novas (origem nps_promotor).
- ALÇADA: venda processada → notify gestão "💰 prêmio a pagar". Aprovar/pagar
  prêmio = lvl>=7 (dinheiro é decisão de gestor).

Auth: GET/POST lvl>=2 (Mariane pra cima; matriz decide quem vê a aba).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, uuid, urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
from _fisc_lib import get_cfg, premio_faixa, gestores_ids, colaborador_do_user, _kv, _kv_set, KV_CFG  # type: ignore

STATUS = ("nova", "qualificada", "no_crm", "vendida", "premio_aprovado", "premio_pago", "perdida")
CAMPOS = ("tipo", "origem", "indicador_nome", "indicador_contato", "indicado_nome",
          "indicado_contato", "obs", "valor_negocio", "deal_id")

# ── Fluxos de abordagem WhatsApp (editáveis; seed segue a regra anti-textão:
#    UMA mensagem curta por passo, espera a resposta antes do próximo) ────────
FLUXOS_KEY = "indicacao_fluxos"
DEFAULT_FLUXOS = [
    {"id": "frio_base", "emoji": "🧊", "nome": "Base fria — Funil MAP (buscou e esfriou)",
     "quando_usar": "Público: família ou investidor que procurou terreno, lote ou casa e a conversa morreu há meses. Objetivo: REABRIR com contexto do que ele buscava (está no card do RD) — indicação só no 3º passo, se o clima deixar.",
     "passos": [
         {"titulo": "Quebra-gelo com contexto", "envio": "manhã (9h–11h), dia útil",
          "texto": "Oi {nome}, tudo bem? Aqui é a Mariane, da PSM 😊 Você chegou a olhar uns imóveis com a gente um tempo atrás — como estão as coisas por aí?"},
         {"titulo": "Respondeu: entender o momento", "envio": "logo após a resposta",
          "texto": "Que bom te ouvir! Me conta: o plano do imóvel ainda tá de pé ou ficou pra depois? Sem compromisso, é só pra eu saber como te ajudar 😉"},
         {"titulo": "Plantar a indicação", "envio": "na mesma conversa, se o clima estiver bom",
          "texto": "Ah, e uma novidade: a PSM agora paga prêmio em dinheiro pra quem indica 💰 Se algum amigo ou parente estiver atrás de terreno ou casa, me apresenta que o prêmio é seu. Lembrou de alguém?"},
         {"titulo": "Follow-up sem resposta", "envio": "3 dias depois — só UMA vez",
          "texto": "Oi {nome}! Vi que ficou corrido aí 😊 Quando der, me dá um alô — tenho uma novidade boa pra te contar."},
     ]},
    {"id": "morno_pos_visita", "emoji": "🤝", "nome": "Visitou há pouco (morno)",
     "quando_usar": "Público: cliente com visita recente, ainda decidindo. A relação está viva — primeiro SERVE (tira dúvida, ajuda), depois planta a indicação. Nunca pareça que só quer o contato.",
     "passos": [
         {"titulo": "Presença + ajuda", "envio": "2–3 dias após a visita",
          "texto": "Oi {nome}! Ficou alguma dúvida daquele imóvel que você visitou? Posso pedir mais fotos, condições, o que precisar 😊"},
         {"titulo": "Plantar a indicação", "envio": "após a resposta, se o clima estiver bom",
          "texto": "E olha: enquanto você decide, se souber de alguém também procurando imóvel, me avisa — a PSM paga prêmio em dinheiro por indicação que vira negócio 💰"},
     ]},
    {"id": "nps_promotor", "emoji": "⭐", "nome": "Promotor NPS (deu 9–10)",
     "quando_usar": "Público: acabou de elogiar a PSM na pesquisa — o momento MAIS quente que existe. Convite direto, no mesmo dia da nota, sem rodeio.",
     "passos": [
         {"titulo": "Agradecer a nota", "envio": "no mesmo dia da nota",
          "texto": "{nome}, sua nota fez o nosso dia aqui! 🥰 Obrigada de verdade pela confiança."},
         {"titulo": "Convite direto", "envio": "na sequência",
          "texto": "Já que você curtiu a experiência: conhece alguém querendo comprar ou alugar? Indicação sua que virar negócio te dá prêmio em DINHEIRO — de R$ 500 a R$ 2.500 na venda 💰 Lembrou de alguém?"},
         {"titulo": "Fechar o combinado", "envio": "se topar",
          "texto": "Fechado! Me manda o nome e o zap da pessoa que eu cuido de tudo com o maior carinho — e te aviso em cada etapa 😉"},
     ]},
    {"id": "pos_venda", "emoji": "🏆", "nome": "Comprou com a PSM (pós-venda)",
     "quando_usar": "Público: proprietário realizado — fechou negócio nos últimos 12 meses. O círculo dele (família, vizinhos do loteamento, colegas) costuma estar no MESMO momento de vida.",
     "passos": [
         {"titulo": "Presença de pós-venda", "envio": "dia útil, manhã",
          "texto": "{nome}! Aqui é a Mariane, da PSM 😊 E aí, como estão os planos com o imóvel novo? Já saiu projeto, mudança, obra?"},
         {"titulo": "Convite \"família PSM\"", "envio": "na mesma conversa",
          "texto": "Você agora é da família PSM 🏡 E quase sempre quem compra conhece alguém no mesmo momento — vizinho de lote, parente, colega. Indicação sua vale prêmio em dinheiro aqui. Quem você conhece nessa fase?"},
         {"titulo": "Fechar o combinado", "envio": "se topar",
          "texto": "Show! Me passa o nome e o zap que eu assumo daqui — e te conto cada avanço até o prêmio cair pra você 😉"},
     ]},
    {"id": "locacao_inquilino", "emoji": "🔑", "nome": "Locação — INQUILINO",
     "quando_usar": "Público: quem ALUGOU com a PSM. O círculo dele (colegas de trabalho, amigos mudando de cidade) vive procurando aluguel — ciclo rápido, prêmio de R$ 150 a R$ 400 por contrato fechado.",
     "passos": [
         {"titulo": "Presença + cuidado", "envio": "horário comercial",
          "texto": "Oi {nome}, tudo bem? Mariane da PSM 😊 Tá tudo certo com o imóvel e o contrato? Qualquer coisa eu resolvo por aqui."},
         {"titulo": "Indicação de quem procura aluguel", "envio": "após resposta positiva",
          "texto": "Aproveitando: conhece alguém procurando um lugar pra alugar? Colega de trabalho, amigo chegando na cidade... Sua indicação fechando contrato te dá prêmio em dinheiro 💰"},
     ]},
    {"id": "locacao_proprietario", "emoji": "🏘", "nome": "Locação — PROPRIETÁRIO",
     "quando_usar": "Público: dono de imóvel na carteira (perfil investidor). Ele conhece OUTROS proprietários — indicar um dono que traga imóvel pra administração vale prêmio e cresce a carteira da PSM.",
     "passos": [
         {"titulo": "Presença de dono", "envio": "horário comercial",
          "texto": "Oi {nome}, tudo bem? Mariane da PSM 😊 Passando pra saber se está tudo certo com o seu imóvel e os repasses. Precisa de algo?"},
         {"titulo": "Indicação de outro proprietário", "envio": "após resposta positiva",
          "texto": "Uma coisa: você conhece outro proprietário com imóvel parado ou mal administrado? Se ele vier pra PSM pela sua indicação, você ganha prêmio em dinheiro 💰 E ele ganha o imóvel rendendo sem dor de cabeça."},
         {"titulo": "Inquilino também vale", "envio": "na mesma conversa",
          "texto": "E se souber de alguém procurando pra alugar, também vale prêmio — quanto mais rápido a gente aluga, melhor pra todo mundo 😉"},
     ]},
]


def _fluxos_load(sb):
    v = _kv(sb, FLUXOS_KEY)
    fx = v.get("fluxos") if isinstance(v, dict) else None
    if fx:
        return fx
    _kv_set(sb, FLUXOS_KEY, {"fluxos": DEFAULT_FLUXOS})
    return json.loads(json.dumps(DEFAULT_FLUXOS))


def _valida_faixas(fx):
    """[[teto, prêmio], …] com tetos estritamente crescentes. None se inválido."""
    try:
        out = [[float(p[0]), float(p[1])] for p in fx]
    except (TypeError, ValueError, IndexError):
        return None
    if not out or any(t <= 0 or pr < 0 for t, pr in out):
        return None
    if any(out[i][0] >= out[i + 1][0] for i in range(len(out) - 1)):
        return None
    return out


def _now():
    return datetime.now(timezone.utc).isoformat()


def _faixas(cfg, tipo):
    return cfg.get("premio_indicacao_locacao" if tipo == "locacao" else "premio_indicacao_venda") or []


def _log_evento(sb, tipo_ev, ind, user, valor=None, extra=None):
    """Espelha o marco no producao_eventos (fiscalização da Mariane). Best-effort."""
    try:
        sb.table("producao_eventos").insert({
            "colaborador": "mariane", "tipo": tipo_ev,
            "ref_type": "indicacao", "ref_id": str(ind.get("id")),
            "valor": valor, "meta": {"rotulo": (ind.get("indicador_nome") or "")[:80], **(extra or {})},
            "criado_por": str(user.get("id"))}).execute()
    except Exception:
        pass


def _processar_venda(sb, cfg, ind, user, valor):
    """Venda confirmada: calcula prêmio pela faixa, grava, loga e avisa a gestão."""
    premio = premio_faixa(_faixas(cfg, ind.get("tipo") or "venda"), valor)
    upd = {"status": "vendida", "valor_negocio": valor, "premio": premio, "atualizado_em": _now()}
    sb.table("indicacoes").update(upd).eq("id", ind["id"]).execute()
    _log_evento(sb, "venda_atribuida_indicacao", ind, user, valor=valor, extra={"premio": premio})
    try:
        corpo = (f"Indicação de {ind.get('indicador_nome')}: negócio de R$ {float(valor):,.2f} fechado. "
                 + (f"Prêmio pela faixa: R$ {premio:,.2f}." if premio is not None
                    else "Acima da última faixa — prêmio PERSONALIZÁVEL (definir)."))
        notify_all(gestores_ids(sb), "fiscalizacao", "💰 Indicação virou venda — prêmio a pagar",
                   body=corpo[:300], link="#/cs-indicacoes")
    except Exception:
        pass
    return premio


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
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cfg = get_cfg(sb)
        try:
            rows = sb.table("indicacoes").select("*").order("criado_em", desc=True).limit(1000).execute().data or []
        except Exception as e:
            return self._send(502, {"ok": False, "error": str(e)[:200]})
        # enriquece com o deal do RD (nome/valor/situação) num lote só
        ids = [r["deal_id"] for r in rows if r.get("deal_id")]
        deals = {}
        if ids:
            try:
                dd = sb.table("deals").select("id,name,amount,win,stage_name").in_("id", ids[:200]).execute().data or []
                deals = {str(d["id"]): d for d in dd}
            except Exception:
                pass
        for r in rows:
            d = deals.get(str(r.get("deal_id") or ""))
            if d:
                r["deal"] = {"nome": d.get("name"), "valor": d.get("amount"),
                             "win": d.get("win"), "estagio": d.get("stage_name")}
        kpis = {s: sum(1 for r in rows if r.get("status") == s) for s in STATUS}
        kpis["premio_a_pagar"] = sum(float(r.get("premio") or 0) for r in rows
                                     if r.get("status") in ("vendida", "premio_aprovado"))
        kpis["premio_pago"] = sum(float(r.get("premio") or 0) for r in rows if r.get("status") == "premio_pago")
        return self._send(200, {"ok": True, "itens": rows, "kpis": kpis,
                                "faixas_venda": cfg.get("premio_indicacao_venda") or [],
                                "faixas_locacao": cfg.get("premio_indicacao_locacao") or [],
                                "fluxos": _fluxos_load(sb),
                                "can_edit": (user.get("lvl") or 0) >= 7})

    def do_POST(self):
        try:
            user = require_user(self, min_lvl=2)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
            body = json.loads(raw or "{}")
            if isinstance(body, str):
                body = json.loads(body or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        cfg = get_cfg(sb)
        action = (body.get("action") or "upsert").strip()
        lvl = user.get("lvl") or 0

        def carregar(iid):
            rows = sb.table("indicacoes").select("*").eq("id", str(iid)).limit(1).execute().data or []
            return rows[0] if rows else None

        try:
            if action == "upsert":
                dados = {k: body.get(k) for k in CAMPOS if k in body}
                if dados.get("tipo") not in (None, "venda", "locacao"):
                    return self._send(400, {"ok": False, "error": "tipo = venda | locacao"})
                dados = {k: (str(v)[:300] if isinstance(v, str) else v) for k, v in dados.items()}
                dados["atualizado_em"] = _now()
                if body.get("id"):
                    sb.table("indicacoes").update(dados).eq("id", str(body["id"])).execute()
                    iid = str(body["id"])
                else:
                    if not (dados.get("indicador_nome") or "").strip():
                        return self._send(400, {"ok": False, "error": "indicador_nome obrigatório"})
                    dados["criado_por"] = str(user.get("id"))
                    ins = sb.table("indicacoes").insert(dados).execute().data or []
                    iid = str(ins[0]["id"]) if ins else None
                audit(self, user, "indicacao.upsert", "indicacoes", iid)
                return self._send(200, {"ok": True, "id": iid})

            if action == "status":
                ind = carregar(body.get("id"))
                if not ind:
                    return self._send(404, {"ok": False, "error": "indicação não encontrada"})
                novo = (body.get("status") or "").strip()
                if novo not in STATUS:
                    return self._send(400, {"ok": False, "error": f"status inválido ({'/'.join(STATUS)})"})
                if novo in ("premio_aprovado", "premio_pago") and lvl < 7:
                    return self._send(403, {"ok": False, "error": "aprovar/pagar prêmio é da gestão (lvl>=7)"})
                if novo == "vendida":
                    valor = body.get("valor") or ind.get("valor_negocio") or (ind.get("deal") or {}).get("valor")
                    try:
                        valor = float(valor)
                    except (TypeError, ValueError):
                        return self._send(400, {"ok": False, "error": "informe o valor do negócio (VGV/aluguel)"})
                    premio = _processar_venda(sb, cfg, ind, user, valor)
                    audit(self, user, "indicacao.vendida", "indicacoes", str(ind["id"]),
                          notes=f"valor={valor} premio={premio}")
                    return self._send(200, {"ok": True, "premio": premio})
                upd = {"status": novo, "atualizado_em": _now()}
                if novo == "premio_pago":
                    upd["premio_pago_em"] = _now()
                sb.table("indicacoes").update(upd).eq("id", str(ind["id"])).execute()
                if novo == "qualificada":
                    _log_evento(sb, "indicacao_qualificada", ind, user)
                audit(self, user, "indicacao.status", "indicacoes", str(ind["id"]), notes=novo)
                return self._send(200, {"ok": True})

            if action == "vincular":
                ind = carregar(body.get("id"))
                did = str(body.get("deal_id") or "").strip()
                if not ind or not did:
                    return self._send(400, {"ok": False, "error": "id e deal_id obrigatórios"})
                dd = sb.table("deals").select("id,name,amount,win").eq("id", did).limit(1).execute().data or []
                if not dd:
                    return self._send(404, {"ok": False, "error": "negócio não encontrado no CRM"})
                d = dd[0]
                sb.table("indicacoes").update({"deal_id": did, "status": "no_crm",
                                               "valor_negocio": d.get("amount"),
                                               "atualizado_em": _now()}).eq("id", str(ind["id"])).execute()
                audit(self, user, "indicacao.vincular", "indicacoes", str(ind["id"]), notes=did)
                if d.get("win") is True:  # já estava ganho no RD → processa na hora
                    ind["id"] = ind["id"]
                    premio = _processar_venda(sb, cfg, ind, user, float(d.get("amount") or 0))
                    return self._send(200, {"ok": True, "vendida": True, "premio": premio})
                return self._send(200, {"ok": True})

            if action == "conferir_vendas":
                rows = sb.table("indicacoes").select("*").in_("status", ["no_crm", "qualificada"]) \
                    .not_.is_("deal_id", "null").limit(300).execute().data or []
                processadas = []
                if rows:
                    ids = [r["deal_id"] for r in rows]
                    dd = sb.table("deals").select("id,amount,win").in_("id", ids).execute().data or []
                    ganhos = {str(d["id"]): d for d in dd if d.get("win") is True}
                    for r in rows:
                        g = ganhos.get(str(r.get("deal_id")))
                        if g:
                            premio = _processar_venda(sb, cfg, r, user, float(g.get("amount") or 0))
                            processadas.append({"id": r["id"], "premio": premio})
                audit(self, user, "indicacao.conferir_vendas", "indicacoes", None,
                      notes=f"{len(processadas)} processada(s)")
                return self._send(200, {"ok": True, "processadas": processadas})

            if action == "puxar_promotores":
                desde = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
                evs = sb.table("producao_eventos").select("ref_id,valor,meta,ts") \
                    .eq("tipo", "nps_coletado").gte("valor", 9).gte("ts", desde).limit(500).execute().data or []
                ja = {(r.get("obs") or "") for r in
                      (sb.table("indicacoes").select("obs").eq("origem", "nps_promotor")
                       .limit(1000).execute().data or [])}
                criadas = 0
                for e in evs:
                    ref = (e.get("ref_id") or (e.get("meta") or {}).get("rotulo") or "").strip()
                    if not ref:
                        continue
                    marca = f"NPS promotor: {ref}"
                    if any(marca in o for o in ja):
                        continue
                    sb.table("indicacoes").insert({
                        "tipo": "venda", "origem": "nps_promotor", "status": "nova",
                        "indicador_nome": ref[:120],
                        "obs": f"{marca} (nota {int(float(e.get('valor') or 0))}) — completar contato e abordar",
                        "criado_por": str(user.get("id"))}).execute()
                    ja.add(marca)
                    criadas += 1
                audit(self, user, "indicacao.puxar_promotores", "indicacoes", None, notes=f"{criadas} criada(s)")
                return self._send(200, {"ok": True, "criadas": criadas})

            if action == "set_faixas":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "editar faixas de prêmio é da gestão (lvl>=7)"})
                fv = _valida_faixas(body.get("faixas_venda") or [])
                fl = _valida_faixas(body.get("faixas_locacao") or [])
                if fv is None or fl is None:
                    return self._send(400, {"ok": False, "error": "faixas inválidas: pares [teto, prêmio] com tetos crescentes e prêmio >= 0"})
                saved = _kv(sb, KV_CFG)
                saved["premio_indicacao_venda"] = fv
                saved["premio_indicacao_locacao"] = fl
                _kv_set(sb, KV_CFG, saved)
                audit(self, user, "indicacao.set_faixas", "shared_kv", KV_CFG,
                      notes=f"venda={fv} locacao={fl}")
                return self._send(200, {"ok": True, "faixas_venda": fv, "faixas_locacao": fl})

            if action == "set_fluxos":
                if lvl < 7:
                    return self._send(403, {"ok": False, "error": "editar fluxos é da gestão (lvl>=7)"})
                out = []
                for f in (body.get("fluxos") or [])[:20]:
                    if not isinstance(f, dict):
                        continue
                    passos = []
                    for p in (f.get("passos") or [])[:15]:
                        if not isinstance(p, dict) or not str(p.get("texto") or "").strip():
                            continue
                        passos.append({"titulo": str(p.get("titulo") or "").strip()[:120],
                                       "envio": str(p.get("envio") or "").strip()[:120],
                                       "texto": str(p.get("texto")).strip()[:1500]})
                    nome = str(f.get("nome") or "").strip()
                    if not nome or not passos:
                        continue
                    out.append({"id": (str(f.get("id") or "").strip() or "fx_" + uuid.uuid4().hex[:8]),
                                "emoji": (str(f.get("emoji") or "💬").strip()[:8] or "💬"),
                                "nome": nome[:80],
                                "quando_usar": str(f.get("quando_usar") or "").strip()[:300],
                                "passos": passos})
                if not out:
                    return self._send(400, {"ok": False, "error": "nenhum fluxo válido (cada fluxo precisa de nome e ao menos 1 passo com texto)"})
                _kv_set(sb, FLUXOS_KEY, {"fluxos": out})
                audit(self, user, "indicacao.set_fluxos", "shared_kv", FLUXOS_KEY, notes=f"{len(out)} fluxo(s)")
                return self._send(200, {"ok": True, "fluxos": out})

            return self._send(400, {"ok": False, "error": "action inválida"})
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
