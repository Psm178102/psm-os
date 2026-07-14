"""
GET /api/v3/zoho/callback — o Zoho redireciona pra cá após o consentimento.
Troca o code por refresh_token, guarda a conexão do usuário (state assinado
diz QUAL usuário é) e devolve um HTML que leva de volta pra Agenda.
Esta URL precisa estar cadastrada como Redirect URI no Zoho API Console.
"""
from http.server import BaseHTTPRequestHandler
import os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth_lib import supabase_client  # type: ignore
import _zoho_lib as z  # type: ignore


def _page(titulo, msg, ok=True):
    cor = "#16a34a" if ok else "#dc2626"
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{titulo}</title></head>
<body style="font-family:system-ui,Segoe UI,Arial;background:#0f172a;color:#e2e8f0;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:420px;padding:24px">
<div style="font-size:44px">{'✅' if ok else '⚠️'}</div>
<h2 style="color:{cor};margin:10px 0">{titulo}</h2>
<p style="opacity:.8">{msg}</p>
<a href="{z._HOME}" style="display:inline-block;margin-top:14px;background:#2563eb;color:#fff;
text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:700">Voltar pra Agenda</a>
<script>setTimeout(function(){{location.href="{z._HOME}"}},2500)</script>
</div></body></html>"""


class handler(BaseHTTPRequestHandler):
    def _html(self, s, body):
        self.send_response(s); self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def do_GET(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        err = (qs.get("error") or [None])[0]
        if err:
            return self._html(400, _page("Conexão cancelada", f"O Zoho retornou: {err}", ok=False))
        code = (qs.get("code") or [None])[0]
        state = (qs.get("state") or [None])[0]
        uid = z.verify_state(state or "")
        if not code or not uid:
            return self._html(400, _page("Link inválido ou expirado", "Tente conectar de novo pela Agenda.", ok=False))
        try:
            tok = z.exchange_code(code)
        except Exception as e:
            return self._html(502, _page("Falha ao conectar", f"Erro na troca com o Zoho: {str(e)[:160]}", ok=False))
        refresh = tok.get("refresh_token")
        if not refresh:
            return self._html(502, _page("Sem permissão offline", "O Zoho não devolveu refresh_token. Reautorize marcando acesso permanente.", ok=False))
        access = tok.get("access_token")
        api_domain = tok.get("api_domain")
        cal_uid, _ = (None, None)
        email = None
        try:
            cal_uid, _ = z.default_calendar_uid(access)
            email = z.account_email(access)
        except Exception:
            pass
        sb = supabase_client()
        if not sb:
            return self._html(503, _page("Backend indisponível", "Tente de novo em instantes.", ok=False))
        try:
            sb.table("zoho_conexoes").upsert({
                "user_id": str(uid), "refresh_token": refresh, "api_domain": api_domain,
                "calendar_uid": cal_uid, "zoho_email": email,
                "conectado_em": z.now_iso(), "atualizado_em": z.now_iso()},
                on_conflict="user_id").execute()
        except Exception as e:
            return self._html(500, _page("Não salvou a conexão", str(e)[:160], ok=False))
        return self._html(200, _page("Zoho conectado! 🎉",
                                     "Sua agenda vai sincronizar nos dois sentidos. Voltando pra Agenda…"))
