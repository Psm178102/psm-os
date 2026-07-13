"""
GET/POST /api/v3/diretoria/plano_resgate — PLANO ESTRATÉGICO DE RESGATE & VIRADA. v84.19

O plano consolidado em 11/07/2026 (2ªq jul → dez/2026) vive EDITÁVEL no shared_kv
'plano_resgate_2026' (seed abaixo = versão 1.0 aprovada pelo Paulo). A tela em
Diretoria → Estratégia mostra: 📜 plano (seções editáveis), ✅ checklist de
cumprimento (ações + gate por mês, persistido), 📊 real vs plano (deals win do
mês por frente via Central de Frentes + locação + fiscalização).

GET  (lvl>=7) → { ok, plano, real }
POST (lvl>=7) → action=set_secao {id, corpo} · action=toggle {chave}
                action=set_mes {id, campo, valor} · action=reset_seed
Auth: SÓ diretoria (lvl>=7).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, frente_of  # type: ignore

KV_KEY = "plano_resgate_2026"
BRT = timezone(timedelta(hours=-3))

SEED = {
    "titulo": "PSM HOLDING · Plano Estratégico de Resgate & Virada",
    "periodo": "2ª quinzena de Julho → Dezembro 2026",
    "versao": "1.0 — consolidado em 11/jul/2026. Revisar contra o real toda semana.",
    "secoes": [
        {"id": "tese", "titulo": "1. A tese da holding", "corpo":
         "Não somos 4 imobiliárias — somos **4 motores econômicos sobre um único ativo: o relacionamento + o dado** (House PSM). "
         "O cliente atravessa os nichos ao longo da vida: compra o 1º imóvel na Conquista → vira investidor no MAP → permuta na Terceiros → coloca pra render na Locação. "
         "**O moat é capturar o ciclo de vida inteiro (LTV), não maximizar cada venda.**\n\n"
         "**Princípio-mestre do dono:** pró-labore deve vir do RESULTADO DAS EQUIPES, nunca de venda própria. "
         "Venda própria é PONTE (emergência), não fundação. Paulo e Isa vendem agora para não precisarem vender depois."},
        {"id": "diagnostico", "titulo": "2. Diagnóstico (jul/2026)", "corpo":
         "- Entrada líquida: ~R$45–48k/mês (pós comissões e impostos)\n"
         "- Custo fixo (nut): ~R$59k/mês → **déficit ~R$12–23k/mês, tapado pelo bolso pessoal do Paulo**\n"
         "- Runway pessoal: 1–2 meses. Nada atrasado (e nada PODE atrasar — é a reputação)\n"
         "- Estrutura = 40% do custo (salão de 24 lugares com ~9 pessoas; mudança inviável: multa + custo)\n"
         "- Software majoritariamente sunk (RD anual no cartão)\n"
         "- Time: Conquista com Isa (diretora) + Kaue (gerente) + 7→9 corretores; MAP/Terceiros/Locação sem corretor dedicado\n\n"
         "**Conclusão: o resgate vem 100% do lado da receita — VGV próprio (rápido) + equipes (estrutural).**"},
        {"id": "unidades", "titulo": "3. Unidades econômicas (as regras do jogo)", "corpo":
         "| Motor | Comissão | Margem p/ empresa |\n|---|---|---|\n"
         "| Conquista (equipe) | 4% − 1,5% corretor − 0,25% Kaue − ~9,5% imposto | **1,85% do VGV** |\n"
         "| VGV próprio Paulo/Isa (MAP/Terceiros) | 4% − imposto | **3,6% do VGV** (o dobro) |\n\n"
         "- **REGRA DO 4%:** todo planejamento a 4%. Incorporadoras que pagam 5% + prêmios (R$500–1.000) entram como BÔNUS, nunca como meta.\n"
         "- **Placar mede VGV VENDIDO/CONTRATADO** (momento em que a comissão nasce). Nunca \"escritura\".\n"
         "- Break-even operacional: **R$70k de contribuição/mês** (nut + ads, pró-labore zero)\n"
         "- Break-even pleno (com pró-labore R$30k): **R$100k de contribuição/mês**\n"
         "- Tradução: ~R$3,8M de VGV Conquista OU R$2,5M atual + ~R$650k de VGV próprio\n\n"
         "**GESTÃO EM 3 BALDES (sempre separados):** ① Conquista (centro de lucro, com ROAS de ads) · ② Holding (custos compartilhados) · ③ VGV próprio (linha de ponte, temporária)"},
        {"id": "arco", "titulo": "4. O arco — 3 tempos", "corpo":
         "**T1 · Jul–Ago — PONTE PRÓPRIA:** Paulo/Isa fecham a carteira de 1.200 quentes. Marco 01 = R$0,4–0,5M de VGV próprio em ≤30 dias. Estanca o buraco, devolve o bolso do Paulo.\n"
         "**T2 · Set–Out — ESCALA AS EQUIPES:** colchão de 1 mês formado financia a 2ª equipe Conquista (+5–7) nas mesas vazias. Quita FGI 180.\n"
         "**T3 · Nov–Dez — EQUIPES PAGAM:** Conquista chega a ~R$5,3–5,6M. Pró-labore parcial em nov (R$15k), cheio em dez (R$30k) — 100% das equipes. Venda própria vira bônus."},
        {"id": "nichos", "titulo": "6. Os 4 nichos", "corpo":
         "**CONQUISTA (MCMV) — motor de volume**\n"
         "- Funil: canais → LP → Sol (IA qualifica) → RD CRM → corretor (só recebe lead quente/agendado)\n"
         "- Canais AGORA: reativação base 4k MCMV · orgânico (TikTok/Stories/YouTube/OLX/Marketplace) · Meta ads → LP · ativo em rede (QR/A4/influencer local) · ações locais (stand/obras/faculdades/cidades vizinhas: Mirassol, Bady, Cedral, Guapiaçu) · parcerias com incorporadoras que co-financiam · indicação premiada\n"
         "- Canais FASE 2: grandes empresas, mercados, eventos, condomínios · Futuro: nicho Terreno + Construção (MCMV)\n\n"
         "**MAP / PSM IMÓVEIS (médio/alto) — ponte agora, equipe na Fase 2**\n"
         "- Agora: Paulo/Isa vendem da base 5–6k MAP reativada + indicações + carteira\n"
         "- Fase 2 (2027): \"Jogada B\" — escada de condições dosada por bolso (entrada 3–5x, parcela baixa, balões anuais) + filtro anti-distrato + Clube de Investidores\n"
         "- Benchmark: concorrente enxuto fez R$100M/6m com ~8 corretores via condição agressiva + método. Copiamos o motor; adicionamos qualificação e LTV.\n\n"
         "**TERCEIROS (usados/permutas) — motor de caixa rápido**\n"
         "- Base: carteira Paulo (1.200 qualificados) + captações via Leire→Gui + parceiros off-market (Diego, Westing) + indicação premiada\n"
         "- Jul–Out: espinha do caixa. Nov+: vira oportunista\n\n"
         "**LOCAÇÃO — conversão de bandeira (ATIVA leve desde agosto)**\n"
         "- Taxa adm 10%/mês · entrada = 100% do 1º aluguel (40% corretor / 10% captador / 50% imob)\n"
         "- **GEORGINA BUSINESS** (salas ~R$3.500; escritório fica dentro): entrada 50% indicador + 50% corretor; imob só recorrência (R$350/sala)\n"
         "- **PLATZ BY TARRAF** (studios 27m² R$1.800–2.000 · 35m² R$2.400 · 2dorm 58m²): entregue jul/2026 — **JANELA DE AGOSTO: investidor mobília e decide quem administra. Não perder.**\n"
         "- **NAU VIVENDAS** (2dorm R$2.200–2.400 · 3dorm R$2.800): conversão de bandeira metódica no Q4\n"
         "- Meta dez/2026: ~25–30 contratos → ~R$6k/mês recorrente + entradas\n"
         "- Ariane (mãe): futuro rosto da Locação, começando pelo Georgina (Fase 2, no timing dela)"},
        {"id": "comissoes", "titulo": "7. Comissões & indicação premiada", "corpo":
         "**Indicação premiada VENDA** (Mariane roda o funil, Isabella atende):\n"
         "até 300k = R$500 · 300–450k = R$800 · 450–600k = R$1.000 · 600–900k = R$1.800 · 900k–1M = R$2.500 · 1M+ = personalizável\n\n"
         "**Indicação premiada LOCAÇÃO** (indicar proprietário que coloca pra administrar):\n"
         "aluguel até R$2.000 = R$150 · R$2.000–3.000 = R$250 · R$3.000+ = R$400\n\n"
         "**Comissão de locação:** 1º aluguel 100% → corretor 40% / captador 10% / imob 50% + recorrência 10%/mês (exceção Georgina acima)\n\n"
         "*(espelhado na config do Painel de Fiscalização — fonte única pros cálculos)*"},
        {"id": "apoio", "titulo": "8. Time de apoio — metas", "corpo":
         "**LEIRE — Reativação + Captação + Docs + Locação** *(fluxo condicional SEMPRE, mensagens curtas — nunca bloco de texto)*: "
         "reativação MAP 1-a-1 manhã 25 · tarde 15 · dia 40 · semana 200 · mês ~880 · captação targeted tarde 15/dia → 3–5 captações/sem · docs 100% ≤48h · comms locação ≤24h\n\n"
         "**MARIANE — CS + Indicação Premiada** *(flow personalizado: reconecta → entrega valor → pede específico)*: "
         "abordagens base MAP (promotores primeiro) manhã 25 · tarde 20 · dia 45 · semana 225 · mês ~990 · ~40% resposta → 45–50 qualificadas/mês → 2–5 vendas · NPS 100% das visitas (MAP/Conquista/Locação), média ≥70, detrator ≤48h\n\n"
         "**GUILHERME — transição marketing → corretor de locação** *(R$1.500 + comissão; manhã conteúdo / tarde locação+captação)*: "
         "contratos M1 1 · M2 1 · M3 2 · M6 4–5 · captações M1 2 → final 5–6 · conteúdo decresce (vídeos 8/4 → 4/2 · arts 12/6 → 6/4). "
         "**Se a produção não vier em 60–90 dias: corte.**\n\n"
         "→ Acompanhamento AO VIVO no 👁 Painel de Fiscalização (registro no ato, semáforo, alertas)."},
        {"id": "ads", "titulo": "9. Ads — gatilhos", "corpo":
         "Regra-mãe: **ads segue a capacidade e o ROAS, nunca a esperança.**\n"
         "- ▲ SOBE: só com (1) capacidade nova produzindo E (2) ROAS mês anterior ≥ piso\n"
         "- ⏸ SEGURA: 2ª equipe em onboarding (out) → congela até a 1ª venda dela\n"
         "- ▼ CORTA: ROAS abaixo do piso 1 mês = segura · 2 meses = corta e revê criativo/oferta\n"
         "- Piso: contribuição ≥ 2× o spend · ad ≤ ~0,4% do VGV gerado\n"
         "- Trilha: Jul 10,5k → Ago/Set 12,5–14k → Out 14k (SEGURA) → Nov 20k → Dez 24k\n"
         "- Por nicho: Conquista R$7–8k/equipe · MAP 2k→3,5k (segura até break-even) · Terceiros ~1k · Locação 0→500\n"
         "- Prioridade no aperto: Conquista > MAP > Locação > Terceiros"},
        {"id": "divida", "titulo": "10. Dívida — ordem de ataque", "corpo":
         "- FGI = 1,99%/mês (~26,7% a.a.) — o inimigo. PRONAMP = 0,99%/mês — dinheiro barato, NUNCA quitar cedo.\n"
         "- AGORA: **alongamento** dos FGI (não carência pura). Alívio ~R$2,5k/mês, custo zero.\n"
         "- PRONAMP novo (~R$40–50k): **NA RESERVA, não sacar.** Gatilho: mês sem VGV próprio + reserva pessoal em ~1 mês — ou na hora se algo fosse atrasar.\n"
         "- Com colchão firme (out): quitar **FGI 180** (R$31.751,81 → mata ~R$880/mês) · depois **FGI 152** (R$232.847,44 → ~R$5,5k/mês) só com sobra real.\n"
         "- Regra de ouro: NUNCA usar caixa de sobrevivência pra quitar dívida. Quitação só acima do colchão."},
        {"id": "regras", "titulo": "11. Regras de ouro (colar na parede)", "corpo":
         "1. **Venda própria é ponte, não fundação**\n2. **Nada atrasado, nunca** — se fosse atrasar, saca o PRONAMP na hora\n"
         "3. **Tudo a 4%** — 5% e prêmios são bônus, jamais meta\n4. **Ads segue capacidade + ROAS** — nunca a esperança\n"
         "5. **3 baldes sempre separados**\n6. **Mix é lucro** — qual incorporadora a equipe empurra é decisão de margem\n"
         "7. **Registro no ato** — número digitado no fim do dia é ficção\n8. **Cada gate compra o direito do próximo mês**\n"
         "9. **Placar em VGV vendido** — comissão nasce na venda\n10. **Toda venda entra no funil da holding** — LTV sempre"},
    ],
    "meses": [
        {"id": "2026-07", "nome": "Jul 2ªq", "conquista": 2500000, "proprio": 450000, "trilha_fin": -6300,
         "acoes": ["Alongar FGI no banco", "Montar 3 baldes + ROAS", "Segmentar 1.200 e base MAP",
                   "Contratar +2 corretores (7→9)", "Sala de máquinas no ar", "Agenda Paulo 5–8 reuniões/sem"],
         "gate": "R$0,4–0,5M próprio vendido (ou 2+ propostas quentes)"},
        {"id": "2026-08", "nome": "Agosto", "conquista": 2750000, "proprio": 900000, "trilha_fin": 16100,
         "acoes": ["Sprint de fechamento (foco Terceiros/permuta)", "Placar semanal",
                   "Reativação da base antes de ads", "Devolver R$15k ao Paulo", "Janela Platz: captar administração dos studios"],
         "gate": "Break-even cruzado + bolso devolvido"},
        {"id": "2026-09", "nome": "Setembro", "conquista": 3250000, "proprio": 900000, "trilha_fin": 23800,
         "acoes": ["Formar colchão de 1 mês (~R$60k)", "Abrir recrutamento 2ª equipe", "Playbook onboarding 30-60-90"],
         "gate": "Colchão firme + 2ª equipe contratada"},
        {"id": "2026-10", "nome": "Outubro", "conquista": 3500000, "proprio": 700000, "trilha_fin": 22200,
         "acoes": ["Onboarding 2ª equipe", "QUITAR FGI 180 (R$31,7k)", "Gestão de mix (5%/prêmio como bônus)", "Ads SEGURA até 1ª venda da 2ª equipe"],
         "gate": "2ª equipe vendendo + FGI 180 morto"},
        {"id": "2026-11", "nome": "Novembro", "conquista": 4300000, "proprio": 500000, "trilha_fin": 8800,
         "acoes": ["2ª equipe plena", "Pró-labore parcial R$15k (das equipes)"],
         "gate": "Equipes cobrindo o pró c/ folga"},
        {"id": "2026-12", "nome": "Dezembro", "conquista": 5300000, "proprio": 0, "trilha_fin": 1100,
         "acoes": ["Pró-labore cheio R$30k das equipes", "Azul estrutural", "Planejar Fase 2 (times MAP/Locação 2027)"],
         "gate": "→ Fase 2: montar times MAP/Locação"},
    ],
    "constantes": {"margem_conquista_pct": 1.85, "margem_proprio_pct": 3.6,
                   "breakeven_operacional": 70000, "breakeven_pleno": 100000,
                   "locacao_meta_dez": 27},
    "checklist": {},
}


def _kv_get(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        v = rows[0]["value"] if rows else None
        if isinstance(v, str):
            v = json.loads(v)
        return v
    except Exception:
        return None


def _kv_set(sb, plano):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": plano,
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


def _real(sb, plano):
    """Dados REAIS do sistema pro mês corrente: VGV win por frente, locação, fiscalização."""
    now = datetime.now(BRT)
    mes_ini_brt = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    mes_ini = mes_ini_brt.astimezone(timezone.utc).isoformat()
    out = {"mes_id": now.strftime("%Y-%m"), "vgv": {}, "n_vendas": {}, "contribuicao": 0.0,
           "locacao": {}, "fiscalizacao": {}}
    # VGV vendido (win) do mês por frente — mesmo critério do Metas/Atingimento
    try:
        dd = sb.table("deals").select("amount,closed_at,pipeline_name").eq("win", True) \
            .gte("closed_at", mes_ini).limit(5000).execute().data or []
        for d in dd:
            fr = frente_of(d.get("pipeline_name"))
            try:
                v = float(d.get("amount") or 0)
            except (TypeError, ValueError):
                v = 0.0
            out["vgv"][fr] = out["vgv"].get(fr, 0) + v
            out["n_vendas"][fr] = out["n_vendas"].get(fr, 0) + 1
    except Exception:
        pass
    c = (plano.get("constantes") or {})
    vgv_conq = out["vgv"].get("conquista", 0)
    vgv_proprio = out["vgv"].get("map", 0) + out["vgv"].get("terceiros", 0)
    out["contribuicao"] = round(vgv_conq * float(c.get("margem_conquista_pct", 1.85)) / 100
                                + vgv_proprio * float(c.get("margem_proprio_pct", 3.6)) / 100, 2)
    # Locação: contratos na carteira + fechados no mês (eventos do painel)
    try:
        rows = sb.table("locacoes").select("id,status").limit(1000).execute().data or []
        out["locacao"]["carteira"] = len(rows)
        out["locacao"]["ocupadas"] = sum(1 for r in rows if (r.get("status") or "") == "ocupado")
    except Exception:
        pass
    try:
        evs = sb.table("producao_eventos").select("id,tipo,colaborador,ts").gte("ts", mes_ini) \
            .limit(10000).execute().data or []
        out["locacao"]["contratos_mes"] = sum(1 for e in evs if e.get("tipo") == "contrato_locacao")
        fisc = {}
        for e in evs:
            fisc.setdefault(e.get("colaborador") or "?", {}).setdefault(e.get("tipo") or "?", 0)
            fisc[e["colaborador"]][e["tipo"]] += 1
        out["fiscalizacao"] = fisc
    except Exception:
        pass
    return out


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
            require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        plano = _kv_get(sb)
        if plano is None:
            plano = json.loads(json.dumps(SEED))
            try:
                _kv_set(sb, plano)
            except Exception:
                pass
        briefing = None
        try:
            rows = sb.table("shared_kv").select("value").eq("key", "plano_briefing").limit(1).execute().data or []
            briefing = rows[0]["value"] if rows else None
            if isinstance(briefing, str):
                briefing = json.loads(briefing)
        except Exception:
            pass
        return self._send(200, {"ok": True, "plano": plano, "real": _real(sb, plano), "briefing": briefing})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
            body = json.loads(raw or "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        plano = _kv_get(sb) or json.loads(json.dumps(SEED))
        action = (body.get("action") or "").strip()

        if action == "set_secao":
            sid = str(body.get("id") or "")
            for s in plano.get("secoes", []):
                if s["id"] == sid:
                    s["corpo"] = str(body.get("corpo") or "")[:12000]
                    break
            else:
                return self._send(404, {"ok": False, "error": "seção não encontrada"})
        elif action == "toggle":
            chave = str(body.get("chave") or "")[:120]
            if not chave:
                return self._send(400, {"ok": False, "error": "chave obrigatória"})
            ck = plano.setdefault("checklist", {})
            if chave in ck:
                ck.pop(chave)
            else:
                ck[chave] = {"por": actor.get("name") or actor.get("id"),
                             "ts": datetime.now(timezone.utc).isoformat()}
        elif action == "set_mes":
            mid = str(body.get("id") or "")
            campo = str(body.get("campo") or "")
            if campo not in ("conquista", "proprio", "gate", "nome", "trilha_fin"):
                return self._send(400, {"ok": False, "error": "campo inválido"})
            for m in plano.get("meses", []):
                if m["id"] == mid:
                    m[campo] = body.get("valor")
                    break
            else:
                return self._send(404, {"ok": False, "error": "mês não encontrado"})
        elif action == "reset_seed":
            plano = json.loads(json.dumps(SEED))
        else:
            return self._send(400, {"ok": False, "error": "action inválida"})

        try:
            _kv_set(sb, plano)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})
        audit(self, actor, "plano_resgate." + action, "kv", KV_KEY)
        return self._send(200, {"ok": True, "plano": plano})
