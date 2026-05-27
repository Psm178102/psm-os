/* PSM-OS v2 — Canal Anônimo (Sprint 8.0) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _tab = 'enviar';
let _messages = [];

export async function pageCanal(ctx, root) {
  _root = root;
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 7;
  // Não-sócio só vê enviar
  if (!isSocio && _tab !== 'enviar') _tab = 'enviar';
  render(isSocio);
}

function render(isSocio) {
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔒 Canal Anônimo</h2>
      <p class="card-sub">Canal direto e confidencial com a diretoria</p>

      ${isSocio ? `
        <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
          <button class="btn ${_tab === 'enviar' ? 'btn-primary' : 'btn-ghost'}" data-tab="enviar">✍️ Enviar</button>
          <button class="btn ${_tab === 'painel' ? 'btn-primary' : 'btn-ghost'}" data-tab="painel">📥 Painel da Diretoria <span id="unread-badge"></span></button>
        </div>
      ` : ''}

      <div id="canal-body" class="mt-4"></div>
    </div>
  `;
  if (isSocio) {
    _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      _tab = b.dataset.tab;
      render(isSocio);
    }));
  }
  if (_tab === 'enviar') renderEnviar();
  else if (_tab === 'painel' && isSocio) renderPainel();
}

function renderEnviar() {
  const body = document.getElementById('canal-body');
  body.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;padding:24px;border:1px solid #334155">
        <p style="color:#94a3b8;font-size:13px;margin-bottom:16px">
          Sua mensagem será enviada diretamente para os diretores <b style="color:#f8fafc">Paulo</b> e <b style="color:#f8fafc">Isabella</b>.
          Você pode se identificar ou enviar anonimamente.
        </p>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#e2e8f0;margin-bottom:14px">
          <input type="checkbox" id="ca-id" style="width:18px;height:18px">
          <span>Desejo me identificar</span>
        </label>
        <div id="ca-nome-wrap" style="display:none;margin-bottom:14px">
          <input type="text" id="ca-nome" placeholder="Seu nome (opcional)" class="input" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <label class="tiny" style="color:#a5b4fc;font-weight:700;display:block;margin-bottom:6px">✍️ Sua mensagem</label>
        <textarea id="ca-msg" rows="6" class="input" style="background:#0f172a;color:#fff;border-color:#475569" placeholder="Escreva sua mensagem aqui..."></textarea>
        <label class="tiny" style="color:#a5b4fc;font-weight:700;display:block;margin:14px 0 6px">📎 Anexar arquivo (foto/doc — máx 2MB)</label>
        <input type="file" id="ca-file" accept="image/*,.pdf,.doc,.docx" style="font-size:12px;color:#94a3b8">
        <button class="btn btn-primary" id="ca-send" style="width:100%;margin-top:16px;padding:14px;font-size:15px">🚀 Enviar Mensagem</button>
      </div>
      <div id="ca-status" class="mt-2"></div>
    </div>
  `;
  document.getElementById('ca-id').addEventListener('change', e => {
    document.getElementById('ca-nome-wrap').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('ca-send').addEventListener('click', sendMsg);
}

async function sendMsg() {
  const msg = document.getElementById('ca-msg').value.trim();
  const status = document.getElementById('ca-status');
  if (!msg) { status.innerHTML = '<div class="alert alert-err">⚠️ Escreva uma mensagem.</div>'; return; }
  const id = document.getElementById('ca-id').checked;
  const nome = id ? document.getElementById('ca-nome').value.trim() : '';
  const file = document.getElementById('ca-file').files[0] || null;
  const btn = document.getElementById('ca-send');
  btn.disabled = true; btn.textContent = 'Enviando...';
  status.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Enviando…</div>';

  try {
    const payload = { msg, identificar: id, nome };
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        status.innerHTML = '<div class="alert alert-warn">⚠️ Arquivo maior que 2MB — mensagem enviada SEM anexo.</div>';
      } else {
        const data = await readAsDataURL(file);
        payload.anexo = data;
        payload.anexo_name = file.name;
        payload.anexo_type = file.type;
      }
    }
    const r = await api.request('/api/v3/canal/send', { method: 'POST', body: payload });
    status.innerHTML = '<div class="alert alert-ok">✅ Mensagem enviada com sucesso! Os diretores serão notificados.</div>';
    document.getElementById('ca-msg').value = '';
    document.getElementById('ca-file').value = '';
  } catch (e) {
    status.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Enviar Mensagem';
  }
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = () => rej(new Error('Erro ao ler arquivo'));
    r.readAsDataURL(file);
  });
}

async function renderPainel() {
  const body = document.getElementById('canal-body');
  body.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando mensagens…</div>';
  try {
    const r = await api.request('/api/v3/canal/list');
    _messages = r.messages || [];
    const unread = r.unread || 0;
    const badge = document.getElementById('unread-badge');
    if (badge) badge.innerHTML = unread > 0 ? ` <span style="background:#ef4444;color:#fff;font-size:10px;padding:1px 6px;border-radius:99px;margin-left:4px;font-weight:800">${unread}</span>` : '';
    renderMessages();
  } catch (e) {
    body.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  }
}

function renderMessages() {
  const body = document.getElementById('canal-body');
  if (_messages.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:60px"><div style="font-size:48px">📭</div><div class="muted mt-2">Nenhuma mensagem recebida ainda.</div></div>';
    return;
  }
  body.innerHTML = `
    <div class="flex gap-2 mb-3" style="flex-wrap:wrap;align-items:center">
      <div style="flex:1;font-weight:700">📨 ${_messages.length} mensagens (${_messages.filter(m => !m.lido).length} não lidas)</div>
      <button class="btn btn-ghost btn-sm" id="mark-all">✅ Marcar todas lidas</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${_messages.map(renderMsgCard).join('')}
    </div>
  `;
  document.getElementById('mark-all').addEventListener('click', async () => {
    try {
      await api.request('/api/v3/canal/mark_read', { method: 'POST', body: { all: true } });
      _messages.forEach(m => m.lido = true);
      renderMessages();
    } catch (e) { alert('Erro: ' + e.message); }
  });
  body.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', async () => {
    const id = +b.dataset.mark;
    try {
      await api.request('/api/v3/canal/mark_read', { method: 'POST', body: { id } });
      const m = _messages.find(x => x.id === id); if (m) m.lido = true;
      renderMessages();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function renderMsgCard(m) {
  const isAnon = m.de === 'Anônimo';
  const bg = m.lido ? 'var(--bg-3)' : 'rgba(99, 102, 241, 0.1)';
  const border = m.lido ? 'var(--bd)' : '#6366f1';
  const dt = new Date(m.ts).toLocaleString('pt-BR');
  return `
    <div style="background:${bg};border:1px solid ${border};border-radius:12px;padding:14px">
      <div class="flex gap-2" style="align-items:flex-start;margin-bottom:10px">
        <div style="width:36px;height:36px;border-radius:8px;background:${isAnon ? '#475569' : '#6366f1'};display:flex;align-items:center;justify-content:center;font-size:16px">${isAnon ? '🔒' : '👤'}</div>
        <div style="flex:1">
          <div style="font-weight:700;color:${isAnon ? 'var(--muted)' : 'var(--psm-gold)'}">${escapeHtml(m.de)}</div>
          <div class="tiny muted">📅 ${dt}</div>
        </div>
        ${!m.lido ? `<button class="btn btn-ghost btn-sm" data-mark="${m.id}">Marcar lida</button>` : '<span class="tiny muted">✅ Lida</span>'}
      </div>
      <div style="background:var(--bg-2);padding:12px;border-radius:8px;white-space:pre-wrap;line-height:1.5">${escapeHtml(m.msg)}</div>
      ${m.anexo ? renderAnexo(m) : ''}
    </div>
  `;
}

function renderAnexo(m) {
  if (m.anexo_data && m.anexo_type && m.anexo_type.startsWith('image/')) {
    return `<div class="mt-2"><div class="tiny muted">📎 ${escapeHtml(m.anexo)}</div><img src="${m.anexo_data}" style="max-width:100%;max-height:400px;border-radius:8px;margin-top:6px;cursor:zoom-in" onclick="window.open(this.src,'_blank')"></div>`;
  }
  if (m.anexo_data) {
    return `<div class="mt-2"><a href="${m.anexo_data}" download="${escapeHtml(m.anexo)}" class="btn btn-ghost btn-sm">⬇ Baixar ${escapeHtml(m.anexo)}</a></div>`;
  }
  return `<div class="tiny muted mt-2">📎 ${escapeHtml(m.anexo)}</div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
