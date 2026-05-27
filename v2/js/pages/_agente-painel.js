/* PSM-OS v2 — Painel Agente compartilhado (Sprint 8.2)
   Usado por agente-vera.js e agente-sol.js — 4 abas: Chat, Conversas, Config, Setup */
import { api } from '../api.js';
import { auth } from '../auth.js';

const TABS = [
  { id: 'chat',   lbl: '💬 Testar Chat' },
  { id: 'convs',  lbl: '📋 Conversas' },
  { id: 'config', lbl: '⚙️ Configuração' },
  { id: 'setup',  lbl: '🔧 Setup WhatsApp/IG' },
];

let _state = { agent: null, root: null, tab: 'chat', messages: [], busy: false };

const STORAGE = id => `psm_v2_agente_${id}_chat`;

export async function renderAgentePainel(root, agent, ctx) {
  _state.agent = agent;
  _state.root = root;
  _state.tab = (ctx?.query?.tab) || 'chat';
  loadMsgs();
  render();
}

function loadMsgs() {
  try {
    const raw = localStorage.getItem(STORAGE(_state.agent.id));
    _state.messages = raw ? JSON.parse(raw) : [];
  } catch { _state.messages = []; }
}
function saveMsgs() {
  try { localStorage.setItem(STORAGE(_state.agent.id), JSON.stringify(_state.messages.slice(-30))); } catch {}
}

function render() {
  const a = _state.agent;
  _state.root.innerHTML = `
    <div class="card">
      <div style="background:linear-gradient(135deg, ${a.color}33 0%, transparent 100%);border-left:4px solid ${a.color};padding:18px 22px;margin:-16px -16px 16px;border-radius:14px 14px 0 0">
        <div class="flex" style="align-items:center;gap:14px">
          <div style="width:56px;height:56px;border-radius:14px;background:${a.color}44;display:flex;align-items:center;justify-content:center;font-size:28px">${a.ico}</div>
          <div>
            <div style="font-size:22px;font-weight:900;color:${a.color}">${esc(a.name)}</div>
            <div class="tiny muted">${esc(a.line)} · ${esc(a.desc)}</div>
          </div>
        </div>
      </div>

      <div class="flex gap-2" style="flex-wrap:wrap;border-bottom:1px solid var(--bd);padding-bottom:8px;margin-bottom:14px">
        ${TABS.map(t => `<button class="btn ${_state.tab === t.id ? 'btn-primary' : 'btn-ghost'}" data-tab="${t.id}">${t.lbl}</button>`).join('')}
      </div>

      <div id="ag-body"></div>
    </div>
  `;
  _state.root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    _state.tab = b.dataset.tab;
    render();
  }));
  if (_state.tab === 'chat')   renderChat();
  if (_state.tab === 'convs')  renderConvs();
  if (_state.tab === 'config') renderConfig();
  if (_state.tab === 'setup')  renderSetup();
}

function renderChat() {
  const a = _state.agent;
  const body = document.getElementById('ag-body');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;height:520px">
      <div style="background:${a.color}11;border-radius:10px;padding:12px 14px;margin-bottom:10px">
        <div style="font-weight:800;color:${a.color};font-size:12px;margin-bottom:4px">⚡ Capacidades</div>
        <ul style="margin:0;padding-left:20px;font-size:11px;line-height:1.6;color:var(--muted)">
          ${a.capacidades.map(c => `<li>${esc(c)}</li>`).join('')}
        </ul>
      </div>

      <div id="ag-msgs" style="flex:1;overflow-y:auto;padding:10px;background:var(--bg-3);border-radius:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px">
        ${_state.messages.length === 0 ? `
          <div style="text-align:center;padding:30px;color:var(--muted)">
            <div style="font-size:36px;margin-bottom:8px">${a.ico}</div>
            <div>Teste como ${esc(a.name)} responde nas conversas reais.</div>
            <div style="margin-top:14px;font-size:11px">Exemplos de tom:</div>
            ${a.exemplos.map(e => `<div style="font-size:11px;font-style:italic;margin:4px 0;opacity:.7">"${esc(e)}"</div>`).join('')}
          </div>
        ` : _state.messages.map(m => msgBubble(m, a)).join('')}
        ${_state.busy ? `<div class="muted tiny"><span class="spinner"></span> ${esc(a.name)} pensando…</div>` : ''}
      </div>

      <div class="flex gap-2" style="align-items:flex-end">
        <textarea id="ag-input" class="input" rows="2" placeholder="Pergunte algo pra ${esc(a.name)}..." ${_state.busy ? 'disabled' : ''}></textarea>
        <button class="btn btn-primary" id="ag-send" ${_state.busy ? 'disabled' : ''}>${_state.busy ? '…' : 'Enviar'}</button>
        ${_state.messages.length > 0 ? '<button class="btn btn-ghost" id="ag-clear" title="Limpar">🗑</button>' : ''}
      </div>
    </div>
  `;
  document.getElementById('ag-send').addEventListener('click', send);
  document.getElementById('ag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  });
  const cb = document.getElementById('ag-clear');
  if (cb) cb.addEventListener('click', () => {
    if (confirm('Limpar conversa?')) { _state.messages = []; saveMsgs(); render(); }
  });
  const msgs = document.getElementById('ag-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function msgBubble(m, a) {
  const isUser = m.role === 'user';
  return `
    <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};gap:8px">
      ${!isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:${a.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${a.ico}</div>` : ''}
      <div style="max-width:75%;background:${isUser ? 'var(--psm-navy)' : 'var(--bg-2)'};color:${isUser ? '#fff' : 'var(--tx)'};padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word">${esc(m.content)}</div>
      ${isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--psm-gold);color:var(--psm-navy);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">${esc((auth.user()?.ini || '?').toUpperCase())}</div>` : ''}
    </div>
  `;
}

async function send() {
  if (_state.busy) return;
  const inp = document.getElementById('ag-input');
  const text = (inp.value || '').trim();
  if (!text) return;
  _state.messages.push({ role: 'user', content: text });
  saveMsgs();
  inp.value = '';
  _state.busy = true;
  renderChat();
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: _state.agent.id,
      messages: _state.messages.slice(-20),
    }});
    _state.messages.push({ role: 'assistant', content: r.reply || '(sem resposta)' });
    saveMsgs();
  } catch (e) {
    _state.messages.push({ role: 'assistant', content: '⚠ Erro: ' + (e.message || 'falha') });
  } finally {
    _state.busy = false;
    renderChat();
  }
}

function renderConvs() {
  const body = document.getElementById('ag-body');
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:30px;text-align:center">
      <div style="font-size:48px;margin-bottom:10px">📋</div>
      <div style="font-weight:800;margin-bottom:6px">Painel de Conversas</div>
      <div class="muted tiny mb-3">
        Em breve: logs de todas as conversas reais que ${esc(_state.agent.name)} teve com leads via WhatsApp e Instagram.
        <br>Dependerá da integração com Evolution API + Meta Graph API estar ativa.
      </div>
      <div class="tiny" style="background:var(--bg-2);padding:10px;border-radius:6px;display:inline-block">
        🔧 Pré-requisito: configurar ${esc(_state.agent.name)} na aba Setup
      </div>
    </div>
  `;
}

function renderConfig() {
  const body = document.getElementById('ag-body');
  const a = _state.agent;
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:18px">
      <div style="font-weight:800;margin-bottom:8px">⚙️ Configuração de ${esc(a.name)}</div>
      <p class="tiny muted">Personalidade, tom, regras de qualificação e templates de resposta. (Sócio only)</p>

      <div class="mt-3">
        <label class="tiny" style="color:var(--muted);font-weight:700">Persona</label>
        <textarea id="cf-persona" class="input" rows="3" placeholder="Ex: Vera é assistente da PSM Imóveis. Tom: profissional, gentil, direta. Foco: qualificar leads e direcionar pra corretor.">Você é ${esc(a.name)}, agente IA da PSM (${esc(a.line)}). ${esc(a.desc)}</textarea>
      </div>

      <div class="mt-3">
        <label class="tiny" style="color:var(--muted);font-weight:700">Regras de qualificação</label>
        <textarea id="cf-regras" class="input" rows="3" placeholder="Ex: Qualificar com: orçamento, prazo, perfil de imóvel...">1. Apresente-se como ${esc(a.name)}
2. Pergunte intenção (morar/investir)
3. Pergunte orçamento, bairro, quartos
4. Sugira imóveis do estoque
5. Direcione pro corretor quando qualificado</textarea>
      </div>

      <div class="mt-3">
        <label class="tiny" style="color:var(--muted);font-weight:700">Horário de atendimento</label>
        <input id="cf-horario" class="input" value="24/7" placeholder="Ex: 08:00-22:00 Seg-Sab">
      </div>

      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" disabled title="Persistência em breve">💾 Salvar (em breve)</button>
        <button class="btn btn-ghost" disabled title="Em breve">↺ Restaurar padrão</button>
      </div>

      <div class="alert alert-warn mt-3 tiny">
        ⚠️ Configuração persistente do agente está aguardando endpoint backend. Hoje a Vera/Sol respondem via prompt padrão do /api/v3/ia/chat.
      </div>
    </div>
  `;
}

function renderSetup() {
  const body = document.getElementById('ag-body');
  const a = _state.agent;
  body.innerHTML = `
    <div class="card" style="background:var(--bg-3);padding:18px">
      <div style="font-weight:800;margin-bottom:10px">🔧 Setup ${esc(a.name)} — WhatsApp + Instagram</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="background:var(--bg-2);padding:14px;border-radius:10px;border-left:4px solid #22c55e">
          <div style="font-weight:800;color:#22c55e">📱 WhatsApp Business</div>
          <div class="tiny muted mt-2">Via Evolution API:</div>
          <ol class="tiny mt-1" style="padding-left:20px;line-height:1.7">
            <li>Provisionar instância Evolution na VPS PSM</li>
            <li>Conectar número WhatsApp Business (escanear QR)</li>
            <li>Configurar webhook → /api/v3/agentes/${a.id}/webhook</li>
            <li>Adicionar EVOLUTION_API_TOKEN nas env vars Vercel</li>
            <li>Ativar agente nesta tela</li>
          </ol>
        </div>

        <div style="background:var(--bg-2);padding:14px;border-radius:10px;border-left:4px solid #e1306c">
          <div style="font-weight:800;color:#e1306c">📸 Instagram DM</div>
          <div class="tiny muted mt-2">Via Meta Graph API:</div>
          <ol class="tiny mt-1" style="padding-left:20px;line-height:1.7">
            <li>App Meta com permissão instagram_manage_messages</li>
            <li>Página Facebook vinculada ao Instagram Business</li>
            <li>Token de longa duração + webhook subscription</li>
            <li>Adicionar META_APP_TOKEN nas env vars Vercel</li>
            <li>Ativar agente nesta tela</li>
          </ol>
        </div>
      </div>

      <div class="alert alert-warn mt-3 tiny">
        ⚠️ Setup completo (webhooks + dispatchers) pendente. Hoje ${esc(a.name)} só responde via chat interno (aba "Testar Chat"). Quando os tokens forem adicionados nas env vars e os webhooks configurados, ${esc(a.name)} passará a atender 24/7 via WhatsApp/IG automaticamente.
      </div>

      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" disabled>📱 Ativar WhatsApp (em breve)</button>
        <button class="btn btn-primary" disabled>📸 Ativar Instagram (em breve)</button>
      </div>
    </div>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
