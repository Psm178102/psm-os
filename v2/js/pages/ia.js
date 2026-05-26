/* ============================================================================
   PSM-OS v2 — IAs (Vera, Sol, Sr. Performance, Sr. Gerência)
   Sprint 7.20
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

const AGENTS = [
  { id: 'vera',          name: 'Vera',          ico: '💜', color: '#8b5cf6', tagline: 'Vendas e estratégia comercial' },
  { id: 'sol',           name: 'Sol',           ico: '☀️', color: '#f59e0b', tagline: 'Marketing e copywriting' },
  { id: 'sr_performance',name: 'Sr. Performance',ico: '🤖', color: '#3b82f6', tagline: 'Analytics e mídia' },
  { id: 'sr_gerencia',   name: 'Sr. Gerência',  ico: '👔', color: '#0f172a', tagline: 'Liderança e gestão' },
];

const STORAGE_KEY = (id) => `psm_v2_ia_chat_${id}`;

let _root = null;
let _agent = 'vera';
let _messages = [];   // [{role, content}]
let _busy = false;

export async function pageIA(ctx, root) {
  _root = root;
  _agent = (ctx?.query?.agent) || _agent;
  loadMessages();
  render();
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(_agent));
    _messages = raw ? JSON.parse(raw) : [];
  } catch { _messages = []; }
}

function saveMessages() {
  try { localStorage.setItem(STORAGE_KEY(_agent), JSON.stringify(_messages.slice(-30))); } catch {}
}

function render() {
  const agent = AGENTS.find(a => a.id === _agent) || AGENTS[0];

  _root.innerHTML = `
    <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 130px);min-height:520px">
      <h2 class="card-title">🤖 Assistentes IA PSM</h2>

      <!-- Tabs agents -->
      <div class="flex gap-1" style="margin-bottom:10px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        ${AGENTS.map(a => agentTab(a)).join('')}
      </div>

      <!-- Header do agent atual -->
      <div style="background:linear-gradient(135deg, ${agent.color}22, transparent);border-left:3px solid ${agent.color};border-radius:var(--r-sm);padding:10px 14px;margin-bottom:10px">
        <div style="font-size:16px;font-weight:800;color:${agent.color}">${agent.ico} ${escapeHtml(agent.name)}</div>
        <div class="tiny muted">${escapeHtml(agent.tagline)}</div>
      </div>

      <!-- Mensagens -->
      <div id="ia-msgs" style="flex:1;overflow-y:auto;padding:8px;background:var(--bg-3);border-radius:var(--r-sm);margin-bottom:10px;display:flex;flex-direction:column;gap:8px">
        ${_messages.length === 0 ? `
          <div class="muted text-center" style="padding:30px">
            <div style="font-size:32px;margin-bottom:8px">${agent.ico}</div>
            <div>Comece uma conversa com <b>${escapeHtml(agent.name)}</b>.</div>
            <div class="tiny muted mt-2">${escapeHtml(agent.tagline)}</div>
          </div>
        ` : _messages.map(m => msgBubble(m, agent)).join('')}
        ${_busy ? `<div class="muted tiny"><span class="spinner"></span> ${escapeHtml(agent.name)} pensando…</div>` : ''}
      </div>

      <!-- Input -->
      <div class="flex gap-2" style="align-items:flex-end">
        <textarea id="ia-input" class="input" rows="2" placeholder="Pergunte algo pra ${escapeHtml(agent.name)}..." ${_busy ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" id="ia-send" ${_busy ? 'disabled' : ''} style="height:fit-content">${_busy ? '…' : 'Enviar'}</button>
        ${_messages.length > 0 ? `<button class="btn btn-ghost" id="ia-clear" title="Limpar conversa">🗑</button>` : ''}
      </div>
    </div>
  `;

  document.querySelectorAll('[data-agent]').forEach(b => b.addEventListener('click', () => {
    _agent = b.dataset.agent;
    loadMessages();
    render();
  }));
  document.getElementById('ia-send').addEventListener('click', send);
  document.getElementById('ia-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  });
  const cb = document.getElementById('ia-clear');
  if (cb) cb.addEventListener('click', () => {
    if (confirm('Limpar essa conversa?')) {
      _messages = [];
      saveMessages();
      render();
    }
  });

  // Scroll bottom
  const msgs = document.getElementById('ia-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function agentTab(a) {
  const active = _agent === a.id;
  return `
    <button data-agent="${a.id}" class="btn" style="border-radius:var(--r-sm) var(--r-sm) 0 0;background:${active ? a.color : 'transparent'};color:${active ? '#fff' : 'var(--ink-muted)'};border-bottom:none;font-weight:700">
      ${a.ico} ${escapeHtml(a.name)}
    </button>
  `;
}

function msgBubble(m, agent) {
  const isUser = m.role === 'user';
  return `
    <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};gap:8px">
      ${!isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:${agent.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${agent.ico}</div>` : ''}
      <div style="max-width:75%;background:${isUser ? 'var(--psm-navy)' : 'var(--bg-2)'};color:${isUser ? '#fff' : 'var(--ink)'};padding:10px 14px;border-radius:var(--r-md);font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word">${escapeHtml(m.content)}</div>
      ${isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--psm-gold);color:var(--psm-navy);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">${escapeHtml((auth.user()?.ini || '?').toUpperCase())}</div>` : ''}
    </div>
  `;
}

async function send() {
  if (_busy) return;
  const input = document.getElementById('ia-input');
  const text = (input.value || '').trim();
  if (!text) return;
  _messages.push({ role: 'user', content: text });
  saveMessages();
  input.value = '';
  _busy = true;
  render();
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: _agent,
      messages: _messages.slice(-20),  // últimas 20 msgs de contexto
    } });
    _messages.push({ role: 'assistant', content: r.reply || '(sem resposta)' });
    saveMessages();
  } catch (e) {
    _messages.push({ role: 'assistant', content: '⚠ Erro: ' + (e.message || 'falha desconhecida') });
  } finally {
    _busy = false;
    render();
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
