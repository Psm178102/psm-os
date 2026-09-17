/* ============================================================================
   ☀️ MEU DIA — o que você precisa saber e fazer hoje (v87.93)
   Pedido do Paulo (17/09/2026): "seria incrível se fosse passado para o corretor os avisos, recados,
   compromissos, o que ele precisa fazer no dia!"

   A MESMA mensagem que chega às 7h no sino, no celular e no WhatsApp aparece aqui no topo da
   Agenda & Tarefas. Embaixo, os canais: a pessoa ativa o celular e cadastra o WhatsApp dela.
   Fonte: /api/v3/agenda/meu_dia (api/v3/_meudia_lib.py).
============================================================================ */
import { api } from './api.js';
import { enablePush, pushSupported, pushPermission } from './push.js';

const CSS = `
.md{padding:14px 16px}
.md-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.md-h h3{margin:0;font-size:16px;font-weight:900}
.md-sub{font-size:12px;color:var(--ink-muted)}
.md-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px}
.md-sec{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;min-width:0}
.md-sec h4{margin:0 0 6px;font-size:12.5px;font-weight:800;letter-spacing:.01em}
.md-it{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:5px 0;border-top:1px dashed var(--border);font-size:13px;line-height:1.4}
.md-it:first-of-type{border-top:0}
.md-it .h{font-variant-numeric:tabular-nums;font-weight:800;color:var(--ink-muted);min-width:38px}
.md-it a{color:inherit;text-decoration:none}.md-it a:hover{text-decoration:underline}
.md-it.critico .t{color:var(--err,#dc2626);font-weight:700}
.md-vazio{font-size:12.5px;color:var(--ink-muted)}
.md-canais{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:12.5px}
.md-canal{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.md-canal input[type=tel]{width:150px;padding:4px 8px;font-size:12.5px}
.md-ok{color:var(--ok,#16a34a);font-weight:800}.md-no{color:var(--warn,#d97706);font-weight:800}
`;
function css() {
  if (document.getElementById('md-css')) return;
  const s = document.createElement('style'); s.id = 'md-css'; s.textContent = CSS; document.head.appendChild(s);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VAZIO = { agenda: 'Nenhum compromisso marcado.', fazer: 'Nada pendente. 👏', recados: 'Sem recados novos.', mes: 'Sem meta cadastrada no mês.' };

export async function montarMeuDia(el, { pessoa } = {}) {
  if (!el) return;
  css();
  el.innerHTML = `<div class="md"><div class="md-h"><h3>☀️ Meu dia</h3><span class="md-sub"><span class="spinner"></span> montando seu dia…</span></div></div>`;
  let d;
  try {
    d = await api.request('/api/v3/agenda/meu_dia' + (pessoa ? '?pessoa=' + encodeURIComponent(pessoa) : ''));
  } catch (e) {
    el.innerHTML = `<div class="md"><div class="md-h"><h3>☀️ Meu dia</h3></div><div class="md-vazio" style="margin-top:6px">Não consegui montar o seu dia agora: ${esc(e.message || e)}</div></div>`;
    return;
  }
  render(el, d, !pessoa);
}

function render(el, d, proprio) {
  const r = d.resumo || {};
  const sec = s => `<div class="md-sec"><h4>${esc(s.titulo)}${s.itens.length > 1 ? ` <span class="md-sub">${s.itens.length}</span>` : ''}</h4>
    ${s.itens.length ? s.itens.slice(0, 8).map(i => `<div class="md-it ${i.nivel === 'critico' ? 'critico' : ''}" ${i.detalhe ? `title="${esc(i.detalhe)}"` : ''}>
        <span class="h">${esc(i.hora || '•')}</span><span class="t">${i.link ? `<a href="${esc(i.link)}">${esc(i.texto)}</a>` : esc(i.texto)}</span></div>`).join('')
      : `<div class="md-vazio">${VAZIO[s.id] || '—'}</div>`}</div>`;
  const c = d.canais || {};
  let celular = '';
  if (proprio) {
    if (c.push_inscricoes > 0) celular = '<span class="md-ok">● celular ativo</span>';
    else if (!pushSupported()) celular = '<span class="md-no">● celular: abra o House pelo ícone na tela inicial para ativar</span>';
    else if (pushPermission() === 'denied') celular = '<span class="md-no">● celular bloqueado no navegador</span>';
    else celular = '<button class="btn btn-primary btn-sm" data-md="push">📲 Receber no celular</button>';
  }
  const whats = proprio ? `<span class="md-canal">💬 WhatsApp
      <input type="tel" id="md-wa" inputmode="tel" placeholder="17 99123-4567" value="${esc(c.whatsapp_numero ? c.whatsapp_numero.replace(/^55/, '') : '')}" aria-label="Seu WhatsApp">
      <label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" id="md-wa-on" ${c.whatsapp_ligado ? 'checked' : ''}> receber</label>
      <button class="btn btn-ghost btn-sm" data-md="wa-salvar">Salvar</button>
      ${c.whatsapp_servidor ? '' : '<span class="md-sub">(o envio pelo WhatsApp do House ainda não foi ligado; seu número fica salvo)</span>'}</span>` : '';
  el.innerHTML = `<div class="md">
    <div class="md-h"><h3>☀️ ${proprio ? 'Meu dia' : 'Dia de ' + esc((d.pessoa?.name || '').split(' ')[0])}</h3>
      <span class="md-sub">${r.compromissos || 0} compromisso(s) · ${r.acoes || 0} ação(ões)${r.urgentes ? ` · <b style="color:var(--err,#dc2626)">${r.urgentes} urgente(s)</b>` : ''} · ${r.recados || 0} recado(s)</span></div>
    <div class="md-grid">${(d.secoes || []).map(sec).join('')}</div>
    ${proprio ? `<div class="md-canais"><b>Chega todo dia às 7h:</b> <span class="md-ok">● sino do House</span> ${celular} ${whats}
      <button class="btn btn-ghost btn-sm" data-md="teste" title="manda agora pra você, em todos os canais ligados">Enviar agora pra mim</button></div>` : ''}
  </div>`;
  el.querySelector('[data-md="push"]')?.addEventListener('click', async ev => {
    ev.currentTarget.disabled = true;
    if (await enablePush()) montarMeuDia(el); else ev.currentTarget.disabled = false;
  });
  el.querySelector('[data-md="wa-salvar"]')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      await api.request('/api/v3/agenda/meu_dia', { method: 'POST', body: { action: 'whatsapp', numero: el.querySelector('#md-wa').value } });
      await api.request('/api/v3/agenda/meu_dia', { method: 'POST', body: { action: 'canal', whatsapp: el.querySelector('#md-wa-on').checked } });
      b.textContent = '✓ salvo';
    } catch (e) { b.disabled = false; b.textContent = '⚠️ ' + (e.message || 'erro'); }
  });
  el.querySelector('[data-md="teste"]')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'enviando…';
    try {
      const x = await api.request('/api/v3/agenda/meu_dia', { method: 'POST', body: { action: 'teste' } });
      b.textContent = '✓ enviado: ' + (x.canais || []).join(', ');
    } catch (e) { b.disabled = false; b.textContent = '⚠️ ' + (e.message || 'erro'); }
  });
}
