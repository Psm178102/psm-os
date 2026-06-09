"""POST /api/v3/locacoes/import  { rows: [ {...} ], substituir?: bool }
Importa contratos de locação em lote (planilha/Kenlo exportado p/ CSV → linhas já parseadas).
Mapeia colunas conhecidas, normaliza valores BR (R$ 1.234,56), gera id, infere status.
Se substituir=true, apaga os importados antes (campaign tag 'import'). lvl>=7 (Diretor).
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, re, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

# mapa de cabeçalhos aceitos (lower, sem acento) → campo do banco
ALIASES = {
    "codigo": "codigo", "cod": "codigo", "ref": "codigo", "referencia": "codigo",
    "endereco": "endereco", "imovel": "endereco", "logradouro": "endereco", "endereco completo": "endereco",
    "bairro": "bairro", "cidade": "cidade",
    "proprietario": "proprietario_nome", "proprietario nome": "proprietario_nome", "locador": "proprietario_nome",
    "proprietario contato": "proprietario_contato", "contato proprietario": "proprietario_contato", "tel proprietario": "proprietario_contato",
    "inquilino": "inquilino_nome", "inquilino nome": "inquilino_nome", "locatario": "inquilino_nome",
    "inquilino contato": "inquilino_contato", "contato inquilino": "inquilino_contato", "tel inquilino": "inquilino_contato",
    "aluguel": "valor_aluguel", "valor aluguel": "valor_aluguel", "valor do aluguel": "valor_aluguel", "valor": "valor_aluguel",
    "condominio": "valor_condominio", "valor condominio": "valor_condominio",
    "iptu": "valor_iptu", "valor iptu": "valor_iptu",
    "taxa adm": "taxa_adm_pct", "taxa de administracao": "taxa_adm_pct", "adm": "taxa_adm_pct", "taxa administracao %": "taxa_adm_pct", "taxa adm %": "taxa_adm_pct",
    "vencimento": "dia_vencimento", "dia vencimento": "dia_vencimento", "dia": "dia_vencimento",
    "inicio": "data_inicio_contrato", "inicio contrato": "data_inicio_contrato", "data inicio": "data_inicio_contrato",
    "fim": "data_fim_contrato", "fim contrato": "data_fim_contrato", "vencimento contrato": "data_fim_contrato", "data fim": "data_fim_contrato", "termino": "data_fim_contrato",
    "status": "status", "situacao": "status", "observacoes": "observacoes", "obs": "observacoes",
}
NUM = {"valor_aluguel", "valor_condominio", "valor_iptu", "taxa_adm_pct"}


def _norm_key(k):
    k = (k or "").strip().lower()
    k = re.sub(r"[áàâã]", "a", k); k = re.sub(r"[éê]", "e", k); k = re.sub(r"[í]", "i", k)
    k = re.sub(r"[óôõ]", "o", k); k = re.sub(r"[ú]", "u", k); k = re.sub(r"[ç]", "c", k)
    return k.strip()


def _num_br(v):
    s = re.sub(r"[^\d,.-]", "", str(v or ""))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")     # 1.234,56 → 1234.56
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None


def _norm_date(v):
    s = (str(v or "")).strip()
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", s)   # dd/mm/aaaa → aaaa-mm-dd
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None


class handler(BaseHTTPRequestHandler):
    def _send(self, s, b):
        self.send_response(s); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(json.dumps(b, ensure_ascii=False, default=str).encode("utf-8"))

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=7)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        rows_in = body.get("rows") or []
        if not isinstance(rows_in, list) or not rows_in:
            return self._send(400, {"ok": False, "error": "envie rows:[...] (linhas da planilha)"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        out, ignorados = [], 0
        for raw in rows_in[:2000]:
            rec = {}
            for k, v in (raw or {}).items():
                campo = ALIASES.get(_norm_key(k))
                if not campo:
                    continue
                if campo in NUM:
                    rec[campo] = _num_br(v)
                elif campo in ("data_inicio_contrato", "data_fim_contrato"):
                    rec[campo] = _norm_date(v)
                elif campo == "dia_vencimento":
                    try:
                        rec[campo] = int(re.sub(r"\D", "", str(v))[:2] or 0) or None
                    except Exception:
                        rec[campo] = None
                else:
                    rec[campo] = (str(v).strip() or None) if v is not None else None
            if not rec.get("endereco") and not rec.get("inquilino_nome") and not rec.get("proprietario_nome"):
                ignorados += 1
                continue
            if not rec.get("endereco"):
                rec["endereco"] = rec.get("codigo") or rec.get("proprietario_nome") or "Imóvel"
            if not rec.get("status"):
                rec["status"] = "ocupado" if rec.get("inquilino_nome") else "disponivel"
            if rec.get("taxa_adm_pct") is None:
                rec["taxa_adm_pct"] = 10
            rec["id"] = "lo_" + uuid.uuid4().hex[:12]
            rec["criado_por"] = actor.get("id")
            out.append(rec)

        inserted = 0
        try:
            for i in range(0, len(out), 200):
                chunk = out[i:i + 200]
                sb.table("locacoes").insert(chunk).execute()
                inserted += len(chunk)
        except Exception as e:
            return self._send(500, {"ok": False, "error": str(e), "inserted": inserted})
        audit(self, actor, "locacao.import", target_type="locacao", after={"inserted": inserted})
        return self._send(200, {"ok": True, "inserted": inserted, "ignorados": ignorados, "recebidos": len(rows_in)})
