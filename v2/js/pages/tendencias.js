/* PSM-OS v2 — Tendências de Mercado (Sprint 8.3) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _tab = 'painel';
let _items = [];

const DIRECAO_ICO = { alta: '📈', estavel: '➡️', baixa: '📉' };
const IMPACTO_COLOR = { alto: '#ef4444', medio: '#f59e0b', baixo: '#22c55e' };
const CATEGORIAS = ['Mercado', 'Digital', 'Preços', 'Comportamento', 'Tecnologia', 'Geral'];

export async function pageTendencias(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/tendencias/list');
    _items = r.tendencias || [];
    renderTab();
  } catch (e) {
    document.getElementById('tend-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card" style="background:#0f172a;color:#e2e8f0;padding:20px">
      <div class="flex" style="align-items:center;gap:14px;margin-bottom:16px">
        <span style="font-size:36px;color:#d4af37">📈</span>
        <div>
          <h2 style="margin:0;font-size:22px;color:#fff">Tendências de Mercado</h2>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Identifique, registre e acompanhe tendências do mercado imobiliário</p>
        </div>
      </div>
      <div class="flex gap-2" style="border-bottom:2px solid #334155;padding-bottom:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn ${_tab === 'painel' ? 'btn-primary' : 'btn-ghost'}" data-tab="painel">📊 Painel</button>
        <button class="btn ${_tab === 'registro' ? 'btn-primary' : 'btn-ghost'}" data-tab="registro">➕ Registrar</button>
        <button class="btn ${_tab === 'historico' ? 'btn-primary' : 'btn-ghost'}" data-tab="historico">📋 Histórico</button>
      </div>
      <div id="tend-body"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    _tab = b.dataset.tab;
    render();
    renderTab();
  }));
}

function renderTab() {
  if (_tab === 'painel') return renderPainel();
  if (_tab === 'registro') return renderRegistro();
  if (_tab === 'historico') return renderHistorico();
}

function renderPainel() {
  const body = document.getElementById('tend-body');
  const cat = {};
  _items.forEach(t => { const c = t.categoria || 'Geral'; if (!cat[c]) cat[c] = []; cat[c].push(t); });
  const alta = _items.filter(t => t.direcao === 'alta').length;
  const baixa = _items.filter(t => t.direcao === 'baixa').length;
  const estavel = _items.filter(t => t.direcao === 'estavel').length;

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:20px">
      ${kpi('Em Alta', alta, 'linear-gradient(135deg,#22c55e,#16a34a)')}
      ${kpi('Estável', estavel, 'linear-gradient(135deg,#f59e0b,#d97706)')}
      ${kpi('Em Baixa', baixa, 'linear-gradient(135deg,#ef4444,#dc2626)')}
      ${kpi('Total', _items.length, 'linear-gradient(135deg,#3b82f6,#2563eb)')}
    </div>
    ${Object.keys(cat).length === 0 ?
      '<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:40px;text-align:center;color:#64748b">Nenhuma tendência registrada. Use a aba Registrar.</div>' :
      Object.keys(cat).sort().map(c => `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:18px;margin-bottom:14px">
          <h3 style="color:#d4af37;font-size:14px;font-weight:800;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px">${esc(c)}</h3>
          <div style="display:grid;gap:8px">
            ${cat[c].map(t => `
              <div style="display:flex;align-items:flex-start;gap:12px;padding:12px;background:#0f172a;border:1px solid #334155;border-radius:8px">
                <span style="font-size:22px">${DIRECAO_ICO[t.direcao] || '➡️'}</span>
                <div style="flex:1">
                  <div style="color:#fff;font-weight:700;margin-bottom:4px">${esc(t.titulo)}</div>
                  <div style="color:#94a3b8;font-size:12px">${esc(t.descricao || '')}</div>
                </div>
                <span style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${IMPACTO_COLOR[t.impacto] || '#64748b'};color:#fff">${esc(t.impacto || '—')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
  `;
}

function renderRegistro() {
  const isLider = (auth.user()?.lvl || 0) >= 5;
  if (!isLider) {
    document.getElementById('tend-body').innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+) pra registrar tendências.</div>';
    return;
  }
  document.getElementById('tend-body').innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;max-width:640px">
      <h3 style="color:#fff;margin:0 0 16px;font-size:16px">Registrar Nova Tendência</h3>
      <div style="display:grid;gap:12px">
        <div>
          <label style="color:#d4af37;font-size:11px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Título</label>
          <input id="td-titulo" class="input" placeholder="Ex: Aumento na busca por studios">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="color:#d4af37;font-size:11px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Categoria</label>
            <select id="td-cat" class="select">
              ${CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="color:#d4af37;font-size:11px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Direção</label>
            <select id="td-dir" class="select">
              <option value="alta">📈 Em Alta</option>
              <option value="estavel" selected>➡️ Estável</option>
              <option value="baixa">📉 Em Baixa</option>
            </select>
          </div>
        </div>
        <div>
          <label style="color:#d4af37;font-size:11px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Impacto</label>
          <select id="td-imp" class="select">
            <option value="alto">Alto</option>
            <option value="medio" selected>Médio</option>
            <option value="baixo">Baixo</option>
          </select>
        </div>
        <div>
          <label style="color:#d4af37;font-size:11px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Descrição</label>
          <textarea id="td-desc" class="input" rows="3"></textarea>
        </div>
      </div>
      <button class="btn btn-primary mt-3" id="td-save" style="width:100%;background:#d4af37;color:#0a1628">💾 Salvar Tendência</button>
      <div id="td-msg" class="mt-2"></div>
    </div>
  `;
  document.getElementById('td-save').addEventListener('click', saveTendencia);
}

async function saveTendencia() {
  const payload = {
    titulo: document.getElementById('td-titulo').value.trim(),
    categoria: document.getElementById('td-cat').value,
    direcao: document.getElementById('td-dir').value,
    impacto: document.getElementById('td-imp').value,
    descricao: document.getElementById('td-desc').value.trim(),
  };
  if (!payload.titulo) {
    document.getElementById('td-msg').innerHTML = '<div class="alert alert-err">Título obrigatório</div>';
    return;
  }
  try {
    await api.request('/api/v3/tendencias/list', { method: 'POST', body: payload });
    document.getElementById('td-msg').innerHTML = '<div class="alert alert-ok">✅ Tendência registrada!</div>';
    await load();
    setTimeout(() => { _tab = 'painel'; render(); renderTab(); }, 800);
  } catch (e) {
    document.getElementById('td-msg').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function renderHistorico() {
  const body = document.getElementById('tend-body');
  const isLider = (auth.user()?.lvl || 0) >= 5;
  body.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:18px;overflow-x:auto">
      <h3 style="color:#fff;margin:0 0 14px">Histórico (${_items.length})</h3>
      ${_items.length === 0 ? '<div style="color:#64748b">Nenhuma tendência.</div>' : `
        <table style="width:100%;border-collapse:collapse;min-width:700px;font-size:13px">
          <thead><tr style="border-bottom:2px solid #334155;background:#0f172a">
            <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px;text-transform:uppercase">Data</th>
            <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px;text-transform:uppercase">Título</th>
            <th style="padding:10px;text-align:left;color:#d4af37;font-size:11px;text-transform:uppercase">Cat.</th>
            <th style="padding:10px;text-align:center;color:#d4af37;font-size:11px;text-transform:uppercase">Dir.</th>
            <th style="padding:10px;text-align:center;color:#d4af37;font-size:11px;text-transform:uppercase">Impacto</th>
            ${isLider ? '<th></th>' : ''}
          </tr></thead>
          <tbody>
            ${_items.map(t => `
              <tr style="border-bottom:1px solid #334155">
                <td style="padding:10px;color:#94a3b8">${esc(t.data || '—')}</td>
                <td style="padding:10px;color:#fff;font-weight:600">${esc(t.titulo)}</td>
                <td style="padding:10px;color:#94a3b8">${esc(t.categoria || '—')}</td>
                <td style="padding:10px;text-align:center;font-size:18px">${DIRECAO_ICO[t.direcao] || '➡️'}</td>
                <td style="padding:10px;text-align:center"><span style="padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${IMPACTO_COLOR[t.impacto] || '#64748b'};color:#fff">${esc(t.impacto || '—')}</span></td>
                ${isLider ? `<td style="padding:10px;text-align:center"><button class="btn btn-ghost btn-sm" data-del="${t.id}" style="color:#ef4444">🗑</button></td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
  if (isLider) {
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remover tendência?')) return;
      try {
        await api.request('/api/v3/tendencias/list?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        await load();
      } catch (e) { alert('Erro: ' + e.message); }
    }));
  }
}

function kpi(label, value, gradient) {
  return `
    <div style="background:${gradient};border-radius:12px;padding:18px;text-align:center;color:#fff">
      <div style="font-size:28px;font-weight:800;margin-bottom:4px">${value}</div>
      <div style="font-size:12px;opacity:.9">${label}</div>
    </div>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
