"""
POST /api/v3/producao/eventos — LOG RÁPIDO da produção (1 clique = 1 evento). v84.18

Body: { tipo, colaborador?, valor?, ref_type?, ref_id?, meta?, action? }
- Colaborador (lvl<7) só loga PRA SI (resolvido pelo login; body.colaborador ignorado).
- Gestor (lvl>=7) pode logar pra qualquer colaborador da cfg.
- Whitelist de tipos por colaborador (TIPOS_POR_COLAB).
- Eventos são IMUTÁVEIS. Única exceção: action='undo' {id} apaga um evento do
  PRÓPRIO autor criado há menos de 90s (clique errado).
Especiais:
  contrato_locacao → também cria o contrato na CARTEIRA (tabela locacoes) e liga
    o evento a ele (ref). meta: {endereco, aluguel, taxa_adm_pct?, georgina?}
  nps_coletado valor<=detrator_max → notifica Mariane + gestão NA HORA (🟠)
  venda_atribuida_indicacao → calcula o prêmio pela faixa da cfg e devolve
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all, hoje_brt  # type: ignore
from _fisc_lib import (TIPOS_POR_COLAB, get_cfg, colaborador_do_user,  # type: ignore
                       user_ids_por_match, gestores_ids, premio_faixa)
from _prod_lib import CORRETOR_TIPOS, BLOCOS, email_local  # type: ignore  # v86.78


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization"); self.end_headers()

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

        # undo: só o próprio autor, só nos primeiros 90 segundos
        if (body.get("action") or "") == "undo":
            eid = str(body.get("id") or "")
            try:
                rows = sb.table("producao_eventos").select("id,ts,criado_por").eq("id", eid).limit(1).execute().data or []
                if not rows:
                    return self._send(404, {"ok": False, "error": "evento não encontrado"})
                ev = rows[0]
                idade = (datetime.now(timezone.utc)
                         - datetime.fromisoformat(str(ev["ts"]).replace("Z", "+00:00"))).total_seconds()
                if str(ev.get("criado_por")) != str(user.get("id")) or idade > 90:
                    return self._send(403, {"ok": False, "error": "undo só do próprio evento, em até 90s"})
                sb.table("producao_eventos").delete().eq("id", eid).execute()
                audit(self, user, "producao.undo", "producao_eventos", eid)
                return self._send(200, {"ok": True, "undone": eid})
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)[:200]})

        cfg = get_cfg(sb)
        lvl = user.get("lvl") or 0
        colab = colaborador_do_user(cfg, user)
        if lvl >= 7 and body.get("colaborador"):
            colab = str(body["colaborador"]).strip().lower()
        tipo = (body.get("tipo") or "").strip()
        # v86.78 (Produtividade Real, peça 1): CORRETORES logam a própria produção.
        # Quem não está na cfg da Fiscalização pode gravar os tipos de corretor PRA SI
        # (colaborador = parte local do e-mail). Bloco validado quando informado.
        if (not colab or colab not in TIPOS_POR_COLAB) and tipo in CORRETOR_TIPOS:
            colab = email_local(user.get("email")) or str(user.get("id"))
            _meta_b = body.get("meta") if isinstance(body.get("meta"), dict) else {}
            if _meta_b.get("bloco") and _meta_b["bloco"] not in BLOCOS:
                return self._send(400, {"ok": False, "error": f"bloco inválido (use um de: {', '.join(BLOCOS)})"})
        elif not colab or colab not in TIPOS_POR_COLAB:
            return self._send(403, {"ok": False, "error": "você não está entre os colaboradores do painel"})
        elif tipo not in TIPOS_POR_COLAB[colab] and tipo not in CORRETOR_TIPOS:
            return self._send(400, {"ok": False, "error": f"tipo '{tipo}' não vale pra {colab}"})

        meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
        valor = body.get("valor")
        ref_type, ref_id = body.get("ref_type"), body.get("ref_id")
        extra = {}

        # contrato de locação → nasce também na CARTEIRA (fonte única c/ o Dashboard Locação)
        if tipo == "contrato_locacao":
            aluguel = float(meta.get("aluguel") or valor or 0)
            if aluguel <= 0:
                return self._send(400, {"ok": False, "error": "informe o valor do 1º aluguel"})
            # v86.66: insert sem `id` violava NOT NULL (id text PK sem default) → o contrato
            # registrado na Fiscalização NUNCA entrava na carteira e o erro ficava escondido
            # em meta.carteira_erro. Mesmo formato do locacoes/upsert. Data em BRT, não UTC.
            import uuid as _uuid
            _ini = hoje_brt()  # v86.68: helper único (mesma conta BRT de antes)
            try:
                _meses = int(meta.get("prazo_meses") or 30)
            except Exception:
                _meses = 30
            _fim_m = (_ini.month - 1 + _meses) % 12 + 1
            _fim_y = _ini.year + (_ini.month - 1 + _meses) // 12
            row = {"id": "lo_" + _uuid.uuid4().hex[:12],
                   "endereco": (meta.get("endereco") or "")[:200] or None,
                   "valor_aluguel": aluguel,
                   "taxa_adm_pct": float(meta.get("taxa_adm_pct") or 10),
                   "status": "ocupado", "responsavel_id": user.get("id"),
                   "data_inicio_contrato": _ini.isoformat(),
                   "data_fim_contrato": _ini.replace(year=_fim_y, month=_fim_m, day=min(_ini.day, 28)).isoformat(),
                   "observacoes": ("Georgina (split 50/50 indicador+corretor). " if meta.get("georgina") else "")
                                  + "Registrado pelo Painel de Fiscalização."}
            try:
                ins = sb.table("locacoes").insert(row).execute().data or []
                if ins:
                    ref_type, ref_id = "locacao", str(ins[0].get("id"))
            except Exception as e:
                extra["carteira_erro"] = str(e)[:120]  # evento vale mesmo assim
            valor = aluguel
            com = cfg.get("comissao_locacao") or {}
            extra["comissao"] = (com.get("excecao_georgina") if meta.get("georgina") else
                                 {k: com.get(k) for k in ("corretor_pct", "captador_pct", "imob_pct", "recorrencia_pct")})

        # prêmio de indicação (venda ou locação) pela faixa configurada
        if tipo == "venda_atribuida_indicacao" and valor:
            extra["premio"] = premio_faixa(cfg.get("premio_indicacao_venda") or [], valor)
        if tipo == "nps_coletado":
            try:
                valor = max(0, min(10, float(valor)))
            except (TypeError, ValueError):
                return self._send(400, {"ok": False, "error": "nps_coletado exige nota 0–10 em valor"})

        ev = {"colaborador": colab, "tipo": tipo,
              "ref_type": ref_type, "ref_id": (str(ref_id)[:120] if ref_id else None),
              "valor": valor, "meta": {**meta, **extra} or None, "criado_por": str(user.get("id"))}
        try:
            ins = sb.table("producao_eventos").insert(ev).execute().data or []
            ev_id = ins[0].get("id") if ins else None
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e)[:200]})

        # 🟠 detrator: alerta IMEDIATO pra Mariane + gestão (não espera cron)
        try:
            det_max = ((cfg["colaboradores"].get("mariane") or {}).get("nps") or {}).get("detrator_max", 6)
            if tipo == "nps_coletado" and float(valor) <= float(det_max):
                mids = user_ids_por_match(sb, "mariane")
                notify_all(list(set(mids + gestores_ids(sb))), "fiscalizacao",
                           f"🟠 NPS detrator ({int(float(valor))})",
                           body="Cliente detrator — tratar em até 48h.", link="#/fiscalizacao")
        except Exception:
            pass

        audit(self, user, "producao." + tipo, "producao_eventos", ev_id,
              notes=f"colab={colab}" + (f" valor={valor}" if valor else ""))
        return self._send(200, {"ok": True, "id": ev_id, "colaborador": colab, "tipo": tipo,
                                **({"premio": extra.get("premio")} if "premio" in extra else {}),
                                **({"comissao": extra.get("comissao")} if "comissao" in extra else {})})
