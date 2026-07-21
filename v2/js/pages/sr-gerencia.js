/* PSM-OS v2 — Sr. Gerência (Painel + Chat IA) (Sprint 8.8) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _messages = [];
let _busy = false;
let _data = null;

const KEY = 'psm_v2_sr_gerencia_chat';

export async function pageSrGerencia(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  try { _messages = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { _messages = []; }
  syncChat('sr_gerencia');   // verdade = backend, por usuário (v84.1)
  render();
  await load();
}

async function load() {
  try {
    const [atg, deals, audit] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/crm/deals?limit=200').catch(() => ({ deals: [] })),
      api.request('/api/v3/audit/list?limit=20').catch(() => ({ entries: [] })),
    ]);
    _data = { atg, deals: deals.deals || [], audit: audit.entries || [] };
    renderInsights();
  } catch (e) { /* silent */ }
}

function syncChat(agent) {
  api.request('/api/v3/ia/chats?agent=' + agent).then(r => {
    if (!r || !Array.isArray(r.messages)) return;
    if (r.messages.length >= _messages.length) { _messages = r.messages; render(); }
    else if (_messages.length) save();   // local mais novo → sobe (migração 1x)
  }).catch(() => {});
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(_messages.slice(-30))); } catch {}
  api.request('/api/v3/ia/chats', { method: 'POST', body: { agent: 'sr_gerencia', messages: _messages.slice(-30) } }).catch(() => {});
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div style="background:linear-gradient(135deg,#0891b2 0%,#0e7490 100%);color:#fff;padding:20px;border-radius:14px 14px 0 0;margin:-16px -16px 16px">
        <div class="flex" style="align-items:center;gap:14px">
          <div style="width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:28px">👔</div>
          <div>
            <div style="font-size:22px;font-weight:900">Sr. Gerência</div>
            <div style="opacity:.85;font-size:13px">Conselheiro de Gestão Operacional · Treina líderes e organiza operação</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px">
        <div>
          <div id="srg-insights"><div class="muted tiny"><span class="spinner"></span> Coletando insights…</div></div>
        </div>

        <div>
          <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;flex-direction:column;height:520px">
            <div id="srg-msgs" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px">
              ${_messages.length === 0 ? `
                <div style="text-align:center;padding:30px;color:var(--muted)">
                  <div style="font-size:42px;margin-bottom:10px">👔</div>
                  <div>Pergunte sobre gestão, processos, equipe, conflitos…</div>
                  <div class="tiny mt-2 muted">Exemplos:</div>
                  <div class="tiny" style="font-style:italic;margin:4px 0">"Como melhorar o ritmo da equipe MAP?"</div>
                  <div class="tiny" style="font-style:italic;margin:4px 0">"Tenho 3 corretores com queda. Como abordar?"</div>
                  <div class="tiny" style="font-style:italic;margin:4px 0">"Sugira agenda de reuniões da semana"</div>
                </div>
              ` : _messages.map(m => bubble(m)).join('')}
              ${_busy ? '<div class="muted tiny"><span class="spinner"></span> Sr. Gerência pensando…</div>' : ''}
            </div>
            <div class="flex gap-2 mt-2" style="align-items:flex-end">
              <textarea id="srg-input" class="input" rows="2" placeholder="Pergunte sobre gestão e operação…" ${_busy ? 'disabled' : ''}></textarea>
              <button class="btn btn-primary" id="srg-send" ${_busy ? 'disabled' : ''}>${_busy ? '…' : 'Enviar'}</button>
              ${_messages.length > 0 ? '<button class="btn btn-ghost" id="srg-clear">🗑</button>' : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('srg-send').addEventListener('click', send);
  document.getElementById('srg-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  });
  const cb = document.getElementById('srg-clear');
  if (cb) cb.addEventListener('click', () => {
    if (confirm('Limpar conversa?')) { _messages = []; save(); render(); }
  });
  const msgs = document.getElementById('srg-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function renderInsights() {
  const wrap = document.getElementById('srg-insights');
  if (!wrap || !_data) return;
  const corretores = _data.atg.por_corretor || [];
  const baixos = corretores.filter(c => (c.vgv_atingido / Math.max(c.meta_vgv, 1)) < 0.5);
  const fechados = (_data.deals || []).filter(d => d.win);
  const auditos = (_data.audit || []).slice(0, 5);

  wrap.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:12px;margin-bottom:10px">
      <div style="font-weight:800;font-size:13px;margin-bottom:8px;color:#0891b2">📊 Status Operacional</div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        <div class="flex" style="justify-content:space-between"><span class="muted">Corretores ativos:</span><b>${corretores.length}</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Vendas no mês:</span><b style="color:#22c55e">${fechados.length}</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Sub-50% meta:</span><b style="color:#ef4444">${baixos.length}</b></div>
      </div>
    </div>

    ${baixos.length > 0 ? `
      <div class="card" style="background:rgba(239,68,68,.1);border:1px solid #ef444440;padding:12px;margin-bottom:10px">
        <div style="font-weight:800;font-size:12px;margin-bottom:6px;color:#ef4444">⚠️ Alertas</div>
        <div style="font-size:11px;line-height:1.6">
          ${baixos.slice(0, 3).map(c => `<div>• ${esc(c.name)}: ${(c.vgv_atingido / Math.max(c.meta_vgv, 1) * 100).toFixed(0)}%</div>`).join('')}
          ${baixos.length > 3 ? `<div class="muted">+ ${baixos.length - 3} corretores…</div>` : ''}
        </div>
      </div>
    ` : ''}

    <div class="card" style="background:var(--bg-3);padding:12px">
      <div style="font-weight:800;font-size:13px;margin-bottom:8px;color:#0891b2">🕒 Última Atividade</div>
      ${auditos.length === 0 ? '<div class="muted tiny">—</div>' : auditos.map(a => `
        <div class="tiny" style="padding:4px 0;border-bottom:1px solid var(--bd)">
          <b>${esc(a.actor_name || '?')}</b> · ${esc(a.action)}
          <div class="muted" style="font-size:10px">${new Date(a.ts).toLocaleString('pt-BR')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function bubble(m) {
  const isUser = m.role === 'user';
  return `
    <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};gap:8px">
      ${!isUser ? '<div style="width:32px;height:32px;border-radius:50%;background:#0891b2;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">👔</div>' : ''}
      <div style="max-width:75%;background:${isUser ? 'var(--psm-navy)' : 'var(--bg-2)'};color:${isUser ? '#fff' : 'var(--tx)'};padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word">${esc(m.content)}</div>
      ${isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--psm-navy);color:var(--psm-cream);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">${esc((auth.user()?.ini || '?').toUpperCase())}</div>` : ''}
    </div>
  `;
}

async function send() {
  if (_busy) return;
  const inp = document.getElementById('srg-input');
  const text = (inp.value || '').trim();
  if (!text) return;
  _messages.push({ role: 'user', content: text });
  save();
  inp.value = '';
  _busy = true;
  render();
  renderInsights();
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: 'sr_gerencia',
      messages: _messages.slice(-20),
    }});
    _messages.push({ role: 'assistant', content: r.reply || '(sem resposta)' });
    save();
  } catch (e) {
    _messages.push({ role: 'assistant', content: '⚠ Erro: ' + (e.message || 'falha') });
  } finally {
    _busy = false;
    render();
    renderInsights();
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
