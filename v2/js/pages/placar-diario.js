/* PSM-OS v2 — 📊 Placar do dia (time M.A.P) — v89.40
   O corretor lança os números do dia; a semana aparece contra o padrão do time.
   A gestão (lvl ≥ 5) vê a semana de cada corretor e o resumo do time.
   Backend: /api/v3/oo/placar (um registro por pessoa). */
import { api } from '../api.js';
import { auth } from '../auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// campo → [rótulo curto, padrão da semana por corretor]
const CAMPOS = [
  ['lig_relac', 'Ligações de relacionamento', 50], ['conversas', 'Conversas reais', 20], ['agendamentos', 'Agendamentos', 10],
  ['visitas', 'Visitas', 6], ['propostas', 'Propostas', 2], ['abord_digital', 'Abordagens digitais', 50],
  ['indicacoes', 'Indicações pedidas', 12], ['videos', 'Vídeos', 3], ['captacoes', 'Captações', 1], ['encontros', 'Encontros', 2],
];
const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const segDe = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const mais = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

let _root = null, _seg = segDe(new Date()), _cid = null, _d = null, _time = null, _gestor = false, _msg = '';

export async function pagePlacarDiario(ctx, root) {
  _root = root; _cid = _cid || auth.user()?.id; _msg = '';
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando o placar…</div></div>';
  const qs = `since=${ymd(_seg)}&until=${ymd(mais(_seg, 5))}`;
  try {
    _d = await api.request(`/api/v3/oo/placar?${qs}&corretor_id=${encodeURIComponent(_cid)}`);
    _gestor = !!_d.gestor;
    _time = _gestor ? (await api.request(`/api/v3/oo/placar?${qs}&time=map`)).time : null;
  } catch (e) { _root.innerHTML = `<div class="alert alert-err">Não consegui carregar o placar: ${esc(e.message)}</div>`; return; }
  render();
}

const cor = (v, meta) => v >= meta ? 'var(--ok)' : v >= meta * 0.7 ? 'var(--warn, #b45309)' : 'var(--err)';
const soma = (dias, c) => Object.values(dias || {}).reduce((a, d) => a + (Number(d[c]) || 0), 0);

function render() {
  const hoje = ymd(new Date());
  const dias = _d.dias || {};
  const meu = String(_cid) === String(auth.user()?.id);
  const nomeSel = (_time || []).find(u => String(u.id) === String(_cid))?.name || '';
  const linhas = DIAS.map((nome, i) => {
    const dt = mais(_seg, i), k = ymd(dt), v = dias[k] || {}, futuro = k > hoje;
    return `<tr data-dia="${k}" style="border-top:1px solid var(--border);${k === hoje ? 'background:var(--bg-3)' : ''}">
      <td style="padding:6px 8px;font-weight:700;white-space:nowrap">${nome} <span class="tiny muted">${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}</span>${k === hoje ? ' <span class="tiny" style="background:var(--accent);color:var(--on-accent);border-radius:999px;padding:0 7px">hoje</span>' : ''}</td>
      ${CAMPOS.map(([c]) => `<td style="padding:4px"><input class="input" type="number" min="0" max="500" inputmode="numeric" data-c="${c}" value="${v[c] ?? ''}" ${futuro ? 'disabled' : ''} style="width:64px;text-align:center"></td>`).join('')}
      <td style="padding:4px;white-space:nowrap">${futuro ? '' : `<button class="btn btn-ghost btn-sm" data-salvar="${k}">💾 Salvar</button>`}${v.ts ? ' <span class="tiny muted" title="lançado">✓</span>' : ''}</td></tr>`;
  }).join('');
  const total = `<tr style="border-top:2px solid var(--border-2,var(--border));font-weight:800"><td style="padding:6px 8px">Semana</td>
    ${CAMPOS.map(([c, , meta]) => { const s = soma(dias, c); return `<td style="padding:6px;text-align:center;color:${cor(s, meta)}">${s}</td>`; }).join('')}<td></td></tr>
    <tr class="tiny muted"><td style="padding:4px 8px">Padrão da semana</td>${CAMPOS.map(([, , meta]) => `<td style="padding:4px;text-align:center">${meta}</td>`).join('')}<td></td></tr>`;
  const time = _time ? `<div class="card mt-3"><h3 class="card-title" style="font-size:15px">👥 A semana do time M.A.P</h3>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:820px">
      <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">Corretor</th>${CAMPOS.map(([, l]) => `<th style="padding:6px 4px;font-size:11px">${esc(l)}</th>`).join('')}<th style="padding:6px">Dias lançados</th></tr></thead>
      <tbody>${_time.map(u => `<tr style="border-top:1px solid var(--border)"><td style="padding:6px 8px;font-weight:700"><a href="#" data-ver="${esc(u.id)}">${esc(u.name || u.id)}</a></td>
        ${CAMPOS.map(([c, , meta]) => { const s = soma(u.dias, c); return `<td style="padding:6px;text-align:center;font-weight:700;color:${cor(s, meta)}">${s}</td>`; }).join('')}
        <td style="padding:6px;text-align:center">${Object.keys(u.dias || {}).length}/6</td></tr>`).join('') || '<tr><td colspan="12" class="tiny muted" style="padding:10px">Nenhum corretor ativo no time.</td></tr>'}
        <tr class="tiny muted"><td style="padding:4px 8px">Padrão por corretor</td>${CAMPOS.map(([, , meta]) => `<td style="padding:4px;text-align:center">${meta}</td>`).join('')}<td></td></tr>
      </tbody></table></div></div>` : '';
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><h2 class="card-title" style="margin:0">📊 Placar do dia${meu ? '' : ' · ' + esc(nomeSel)}</h2>
          <p class="card-sub" style="margin:2px 0 0">Lance os números no fim de cada dia. A linha da semana mostra onde você está contra o padrão do time.</p></div>
        <div class="flex gap-1" style="align-items:center">
          <button class="btn btn-ghost btn-sm" id="pl-ant">◀</button>
          <b style="font-size:13px">Semana de ${String(_seg.getDate()).padStart(2, '0')}/${String(_seg.getMonth() + 1).padStart(2, '0')}</b>
          <button class="btn btn-ghost btn-sm" id="pl-prox">▶</button>
          ${!meu ? '<button class="btn btn-ghost btn-sm" id="pl-meu">Voltar ao meu</button>' : ''}
        </div></div>
      <div id="pl-msg" class="tiny" style="min-height:14px;margin:4px 0;color:${_msg[0] === '⚠' ? 'var(--err)' : 'var(--ok)'}">${esc(_msg)}</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:900px">
        <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">Dia</th>${CAMPOS.map(([, l]) => `<th style="padding:6px 4px;font-size:11px;line-height:1.2">${esc(l)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${linhas}${total}</tbody></table></div>
      <div class="tiny muted mt-2">Verde: no padrão · amarelo: a partir de 70% · vermelho: abaixo. A rotina de cada hora está no <a href="#/scripts?nicho=map&ver=rotina">Playbook da Venda → A rotina</a>.</div>
    </div>${time}`;

  const $ = id => _root.querySelector('#' + id);
  $('pl-ant').onclick = () => { _seg = mais(_seg, -7); load(); };
  $('pl-prox').onclick = () => { _seg = mais(_seg, 7); load(); };
  if ($('pl-meu')) $('pl-meu').onclick = () => { _cid = auth.user()?.id; load(); };
  _root.querySelectorAll('[data-ver]').forEach(a => a.onclick = (ev) => { ev.preventDefault(); _cid = a.dataset.ver; load(); });
  _root.querySelectorAll('[data-salvar]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'); const valores = {};
    tr.querySelectorAll('[data-c]').forEach(i => { if (i.value !== '') valores[i.dataset.c] = Number(i.value); });
    b.disabled = true; b.textContent = '⏳';
    try {
      await api.request('/api/v3/oo/placar', { method: 'POST', body: { data: b.dataset.salvar, valores, corretor_id: _cid } });
      _msg = '✅ Dia ' + b.dataset.salvar.split('-').reverse().slice(0, 2).join('/') + ' salvo.';
    } catch (e) { _msg = '⚠ ' + (e.message || 'não salvou'); }
    await load();
  });
}
