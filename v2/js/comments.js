/* ============================================================================
   PSM-OS v2 — Comentários reutilizável
   Sprint 7.15
   Uso: import { mountComments } from '../comments.js';
        mountComments(rootEl, { target_type: 'task', target_id: 't_xxx' });
============================================================================ */
import { api } from './api.js';
import { auth } from './auth.js';

export async function mountComments(root, opts) {
  if (!root) return;
  const { target_type, target_id } = opts;
  if (!target_type || !target_id) {
    root.innerHTML = '<div class="muted tiny">target inválido</div>';
    return;
  }
  root.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando comentários…</div>';

  let comments = [];
  try {
    const r = await api.request('/api/v3/comments/list?target_type=' + encodeURIComponent(target_type) + '&target_id=' + encodeURIComponent(target_id));
    comments = r.comments || [];
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err tiny">${escapeHtml(e.message)}</div>`;
    return;
  }

  render(root, comments, target_type, target_id);
}

function render(root, comments, target_type, target_id) {
  const me = auth.user();
  root.innerHTML = `
    <div style="display:grid;gap:6px;max-height:340px;overflow-y:auto;padding-right:4px;margin-bottom:8px">
      ${comments.length === 0 ? '<div class="muted tiny text-center" style="padding:14px">Sem comentários ainda.</div>' :
        comments.map(c => commentRow(c, me?.id)).join('')
      }
    </div>
    <div class="flex gap-2" style="align-items:flex-start">
      <textarea id="cmt-new" class="input" rows="2" placeholder="Escreva um comentário… (use @id_usuario pra mencionar)"></textarea>
      <button class="btn btn-primary" id="cmt-send" style="height:fit-content">Enviar</button>
    </div>
  `;

  root.querySelectorAll('[data-cmt-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Apagar comentário?')) return;
    try {
      await api.request('/api/v3/comments/upsert', { method: 'POST', body: { id: b.dataset.cmtDel, _delete: true } });
      await mountComments(root, { target_type, target_id });
    } catch (e) { alert('Erro: ' + e.message); }
  }));

  root.querySelector('#cmt-send').addEventListener('click', async () => {
    const txt = root.querySelector('#cmt-new').value.trim();
    if (!txt) return;
    try {
      await api.request('/api/v3/comments/upsert', { method: 'POST', body: { target_type, target_id, texto: txt } });
      await mountComments(root, { target_type, target_id });
    } catch (e) { alert('Erro: ' + e.message); }
  });
}

function commentRow(c, myId) {
  const au = c.autor || {};
  const ini = escapeHtml((au.ini || (au.name || '?').substring(0, 2)).toUpperCase());
  const canDel = au.id === myId;
  const ts = new Date(c.created_at).toLocaleString('pt-BR');
  return `
    <div style="display:grid;grid-template-columns:30px 1fr auto;gap:8px;padding:8px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12.5px">
      <div style="width:26px;height:26px;border-radius:4px;background:${au.color || '#64748b'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px">${ini}</div>
      <div style="min-width:0">
        <div style="font-weight:700">${escapeHtml(au.name || 'sistema')} <span class="tiny muted" style="font-weight:400">· ${ts}</span></div>
        <div style="margin-top:2px;white-space:pre-wrap;word-wrap:break-word">${linkifyMentions(escapeHtml(c.texto))}</div>
      </div>
      ${canDel ? `<button class="btn btn-ghost tiny" data-cmt-del="${c.id}" style="padding:3px 6px">🗑</button>` : '<span></span>'}
    </div>
  `;
}

function linkifyMentions(s) {
  return s.replace(/@([a-z0-9_\-]+)/gi, '<span style="background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:3px;font-weight:600">@$1</span>');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
