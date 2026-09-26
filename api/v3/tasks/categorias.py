"""
GET/POST /api/v3/tasks/categorias — lista de CATEGORIAS das tarefas, editável. v88.43

Antes a categoria era texto livre e a sugestão vinha das tarefas que já existiam —
não dava pra corrigir, renomear nem apagar uma categoria. Agora a lista mora no
shared_kv (key 'tarefas_categorias', value {"lista": [...]}).

GET                                   (qualquer logado) → { ok, lista, pode_editar }
    Lista ainda não configurada → setores padrão do Checklist + categorias já usadas.
POST { acao:'adicionar', nome }       (qualquer logado) → acrescenta 1 categoria
POST { acao:'salvar', lista, renomear? } (lvl>=7)       → grava a lista inteira;
    renomear = {"antigo": "novo"} também troca o nome nas tarefas que já usam.
    Remover da lista NÃO apaga a categoria das tarefas antigas.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client, require_user, AuthError, audit  # type: ignore

KV_KEY = "tarefas_categorias"
MAX_ITENS = 80
MAX_LEN = 60
LVL_EDITAR = 7
# Setores padrão do ✅ Checklist da Diretoria (v88.41) — ponto de partida da lista.
PADRAO = ["Presidência", "Comercial", "Marketing", "Financeiro", "Pessoas & RH",
          "Operações & Backoffice", "Jurídico", "Locação", "Tecnologia & Sistema",
          "Morimatsu & Associados"]


def _limpa(lista):
    out, vistos = [], set()
    for x in lista if isinstance(lista, list) else []:
        n = " ".join(str(x or "").split())[:MAX_LEN]
        if n and n.lower() not in vistos:
            vistos.add(n.lower())
            out.append(n)
    return out[:MAX_ITENS]


def _ler(sb):
    try:
        rows = sb.table("shared_kv").select("value").eq("key", KV_KEY).limit(1).execute().data or []
        val = rows[0]["value"] if rows else None
        if isinstance(val, str):
            val = json.loads(val)
        if isinstance(val, dict) and isinstance(val.get("lista"), list):
            return _limpa(val["lista"]), True
    except Exception as e:
        _e_kv = e
        # v88.46: leitura do BANCO que falha aborta (nunca vira vazio e regrava o blob inteiro)
        if not isinstance(_e_kv, ValueError):
            raise RuntimeError("leitura do shared_kv falhou (" + str(_e_kv)[:80] + ") — nada foi gravado")
        print(f"[categorias] ler: {e}")
    return [], False


def _usadas(sb):
    try:
        rows = sb.table("dir_tasks").select("categoria").not_.is_("categoria", "null").limit(3000).execute().data or []
        usadas = sorted(_limpa([r.get("categoria") for r in rows]), key=str.lower)
    except Exception:
        usadas = []
    return _limpa(PADRAO + [u for u in usadas if u != "Locações"])


def _gravar(sb, lista):
    sb.table("shared_kv").upsert({"key": KV_KEY, "value": {"lista": lista},
                                  "updated_at": datetime.now(timezone.utc).isoformat()},
                                 on_conflict="key").execute()


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
            user = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})
        lista, existe = _ler(sb)
        if not existe:
            lista = _usadas(sb)
        return self._send(200, {"ok": True, "lista": lista, "configurada": existe,
                                "pode_editar": (user.get("lvl") or 0) >= LVL_EDITAR})

    def do_POST(self):
        try:
            actor = require_user(self, min_lvl=0)
        except AuthError as e:
            return self._send(e.status, {"ok": False, "error": e.message})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 30_000:
                return self._send(413, {"ok": False, "error": "payload grande demais"})
            body = json.loads(self.rfile.read(length).decode("utf-8") if length > 0 else "{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        sb = supabase_client()
        if not sb:
            return self._send(503, {"ok": False, "error": "backend"})

        acao = (body.get("acao") or "").strip()
        atual, existe = _ler(sb)
        if not existe:
            atual = _usadas(sb)

        if acao == "adicionar":
            nome = (_limpa([body.get("nome")]) or [None])[0]
            if not nome:
                return self._send(400, {"ok": False, "error": "nome vazio"})
            if nome.lower() not in {x.lower() for x in atual}:
                if len(atual) >= MAX_ITENS:
                    return self._send(400, {"ok": False, "error": f"máximo de {MAX_ITENS} categorias"})
                atual.append(nome)
            try:
                _gravar(sb, atual)
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            return self._send(200, {"ok": True, "lista": atual})

        if acao == "salvar":
            if (actor.get("lvl") or 0) < LVL_EDITAR:
                return self._send(403, {"ok": False, "error": "Só a gestão edita a lista de categorias."})
            nova = _limpa(body.get("lista"))
            ren = body.get("renomear") if isinstance(body.get("renomear"), dict) else {}
            trocadas = 0
            try:
                _gravar(sb, nova)
                for antigo, novo in list(ren.items())[:MAX_ITENS]:
                    antigo = str(antigo or "").strip()
                    novo = " ".join(str(novo or "").split())[:MAX_LEN]
                    if not antigo or not novo or antigo == novo:
                        continue
                    res = sb.table("dir_tasks").update({"categoria": novo}).eq("categoria", antigo).execute()
                    trocadas += len(res.data or [])
            except Exception as e:
                return self._send(500, {"ok": False, "error": str(e)})
            audit(self, actor, "tarefas_categorias.update", target_type="shared_kv", target_id=KV_KEY,
                  before={"lista": atual}, after={"lista": nova, "renomear": ren})
            return self._send(200, {"ok": True, "lista": nova, "tarefas_atualizadas": trocadas})

        return self._send(400, {"ok": False, "error": "acao inválida (adicionar | salvar)"})
