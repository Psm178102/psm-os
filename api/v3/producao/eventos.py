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
from _auth_lib import supabase_client, require_user, AuthError, audit, notify_all  # type: ignore
from _fisc_lib import (TIPOS_POR_COLAB, get_cfg, colaborador_do_user,  # type: ignore
                       user_ids_por_match, gestores_ids, premio_faixa)


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
        if not colab or colab not in TIPOS_POR_COLAB:
            return self._send(403, {"ok": False, "error": "você não está entre os colaboradores do painel"})
        tipo = (body.get("tipo") or "").strip()
        if tipo not in TIPOS_POR_COLAB[colab]:
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
            row = {"endereco": (meta.get("endereco") or "")[:200] or None,
                   "valor_aluguel": aluguel,
                   "taxa_adm_pct": float(meta.get("taxa_adm_pct") or 10),
                   "status": "ocupado", "responsavel_id": user.get("id"),
                   "data_inicio_contrato": datetime.now(timezone.utc).date().isoformat(),
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
