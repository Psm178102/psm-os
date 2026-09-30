/* ============================================================================
   PSM-OS v2 — 📮 Portão do Zoho (v89.2)
   Pedido do Paulo (30/09): TODOS os logins integrados ao Zoho Calendar.
   A API do Zoho é por usuário (cada um autoriza a própria agenda) — então o
   caminho é não deixar ninguém "esquecer de clicar": logo após o login, quem
   ainda não conectou vê uma tela cheia com UM botão (Conectar). Depois do
   consentimento o Zoho volta pro House e a tela nunca mais aparece.

   Adiar: "Lembrar amanhã" (24h, no aparelho) só até PRAZO. Depois, obrigatório.
   Nunca tranca ninguém por falha nossa: status com erro / Zoho não configurado
   / conta de serviço → não mostra nada.
============================================================================ */
import { api } from './api.js';

const PRAZO = '2026-10-06';          // primeiro 1:1 fixo de terça
const KEY = 'psm_zoho_adiado_ate';

const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

export async function portaoZoho(user) {
  if (!user || user.is_service) return;
  let st;
  try { st = await api.request('/api/v3/zoho/status'); } catch { return; }
  if (!st || st.ok === false || !st.configurado || st.conectado || st.servico) return;

  const podeAdiar = hojeISO() < PRAZO;
  if (podeAdiar) {
    try { if (Date.now() < Number(localStorage.getItem(KEY) || 0)) return; } catch (_) {}
  }

  const el = document.createElement('div');
  el.id = 'zoho-gate';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,12,20,.82);backdrop-filter:blur(4px)';
  const prazoBR = PRAZO.split('-').reverse().join('/');
  el.innerHTML = `
    <div style="max-width:420px;width:100%;background:var(--surface,#fff);color:var(--ink,#111);border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit">
      <div style="font-size:34px;line-height:1">📮</div>
      <h2 style="margin:10px 0 6px;font-size:20px">Conecte sua agenda Zoho</h2>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.5;opacity:.85">
        Todos os logins do House agora ficam integrados ao Zoho Calendar: 1:1, visitas,
        plantões e reuniões aparecem nos dois lados, sozinhos. Leva menos de 1 minuto —
        é só entrar com seu e-mail <b>@imobiliariapsm.com.br</b> e clicar em <b>Aceitar</b>.
      </p>
      <button id="zg-conectar" style="width:100%;padding:13px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Conectar agora</button>
      ${podeAdiar
        ? `<button id="zg-adiar" style="width:100%;margin-top:8px;padding:10px;border:0;background:none;color:inherit;opacity:.65;font-size:13px;cursor:pointer">Lembrar amanhã (obrigatório a partir de ${prazoBR})</button>`
        : `<p style="margin:10px 0 0;font-size:12px;opacity:.6;text-align:center">Obrigatório para usar o House. Problema com a conta Zoho? Fale com o Paulo.</p>`}
      <p id="zg-erro" style="display:none;margin:10px 0 0;font-size:13px;color:#d64545"></p>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('#zg-conectar').addEventListener('click', async ev => {
    ev.currentTarget.disabled = true;
    ev.currentTarget.textContent = 'Abrindo o Zoho…';
    try {
      const r = await api.request('/api/v3/zoho/connect');
      if (r && r.url) { location.href = r.url; return; }
      throw new Error((r && r.error) || 'sem link');
    } catch (e) {
      const erro = el.querySelector('#zg-erro');
      erro.textContent = 'Não consegui abrir o Zoho agora (' + (e.message || e) + '). Tente de novo.';
      erro.style.display = 'block';
      ev.currentTarget.disabled = false;
      ev.currentTarget.textContent = 'Conectar agora';
    }
  });
  el.querySelector('#zg-adiar')?.addEventListener('click', () => {
    try { localStorage.setItem(KEY, String(Date.now() + 24 * 3600e3)); } catch (_) {}
    el.remove();
  });
}
