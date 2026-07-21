/* PSM-OS v2 — Sr. Performance (Painel + Chat IA) (Sprint 8.8) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _messages = [];
let _busy = false;
let _data = null;

const KEY = 'psm_v2_sr_performance_chat';

export async function pageSrPerformance(ctx, root) {
  _root = root;
  try { _messages = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { _messages = []; }
  syncChat();   // verdade = backend, por usuário (v84.1)
  render();
  await load();
}

async function load() {
  try {
    const me = auth.user();
    const [atg, deals] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.request('/api/v3/crm/deals?limit=200').catch(() => ({ deals: [] })),
    ]);
    _data = { atg, deals: deals.deals || [], me };
    renderInsights();
  } catch (e) { /* silent */ }
}

function syncChat() {
  api.request('/api/v3/ia/chats?agent=sr_performance').then(r => {
    if (!r || !Array.isArray(r.messages)) return;
    if (r.messages.length >= _messages.length) { _messages = r.messages; render(); }
    else if (_messages.length) save();
  }).catch(() => {});
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(_messages.slice(-30))); } catch {}
  api.request('/api/v3/ia/chats', { method: 'POST', body: { agent: 'sr_performance', messages: _messages.slice(-30) } }).catch(() => {});
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div style="background:linear-gradient(135deg,#0b1f3a 0%,#1e3a5f 100%);color:#fff;padding:20px;border-radius:14px 14px 0 0;margin:-16px -16px 16px">
        <div class="flex" style="align-items:center;gap:14px">
          <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,var(--psm-navy),var(--psm-navy-2));display:flex;align-items:center;justify-content:center;font-size:28px">🎖️</div>
          <div>
            <div style="font-size:22px;font-weight:900;color:var(--psm-gold)">Sr. Performance</div>
            <div style="opacity:.85;font-size:13px">Mentor de Corretores · Treina do zero ao expert com dados reais do seu CRM</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px">
        <div>
          <div id="srp-insights"><div class="muted tiny"><span class="spinner"></span> Analisando seu desempenho…</div></div>
        </div>

        <div>
          <div style="background:var(--bg-3);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;flex-direction:column;height:520px">
            <div id="srp-msgs" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px">
              ${_messages.length === 0 ? `
                <div style="text-align:center;padding:30px;color:var(--muted)">
                  <div style="font-size:42px;margin-bottom:10px">🎖️</div>
                  <div>Pergunte sobre vendas, técnica, motivação, abordagem…</div>
                  <div class="tiny mt-2 muted">Exemplos:</div>
                  <div class="tiny" style="font-style:italic;margin:4px 0">"Como abordar um lead que sumiu há 2 semanas?"</div>
                  <div class="tiny" style="font-style:italic;margin:4px 0">"Quais são meus pontos fracos esse mês?"</div>
                  <div class="tiny" style="font-style:italic;margin:4px 0">"Como aumentar meu ticket médio?"</div>
                </div>
              ` : _messages.map(m => bubble(m)).join('')}
              ${_busy ? '<div class="muted tiny"><span class="spinner"></span> Sr. Performance pensando…</div>' : ''}
            </div>
            <div class="flex gap-2 mt-2" style="align-items:flex-end">
              <textarea id="srp-input" class="input" rows="2" placeholder="Pergunte sobre técnica de vendas e desempenho…" ${_busy ? 'disabled' : ''}></textarea>
              <button class="btn btn-primary" id="srp-send" ${_busy ? 'disabled' : ''}>${_busy ? '…' : 'Enviar'}</button>
              ${_messages.length > 0 ? '<button class="btn btn-ghost" id="srp-clear">🗑</button>' : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('srp-send').addEventListener('click', send);
  document.getElementById('srp-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  });
  const cb = document.getElementById('srp-clear');
  if (cb) cb.addEventListener('click', () => {
    if (confirm('Limpar conversa?')) { _messages = []; save(); render(); }
  });
  const msgs = document.getElementById('srp-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function renderInsights() {
  const wrap = document.getElementById('srp-insights');
  if (!wrap || !_data) return;
  const me = _data.me;
  const meu = (_data.atg.por_corretor || []).find(c => c.id === me?.id) || {};
  // deals do RD trazem o dono em d.user.email e valor em amount_total/amount_unique
  const myEmail = (me?.email || '').toLowerCase();
  const meusDeals = myEmail ? (_data.deals || []).filter(d => ((d.user && d.user.email) || '').toLowerCase() === myEmail) : [];
  const dealAmt = d => (+d.amount_total || +d.amount_unique || 0);
  const ganhos = meusDeals.filter(d => d.win);
  const perdas = meusDeals.filter(d => d.win === false);
  const conv = (ganhos.length + perdas.length) > 0 ? (ganhos.length / (ganhos.length + perdas.length) * 100) : 0;
  const vendasCount = (+meu.vendas || ganhos.length || 0);
  const ticketMedio = ganhos.length > 0 ? ganhos.reduce((s, d) => s + dealAmt(d), 0) / ganhos.length
    : (vendasCount > 0 ? (+meu.vgv_atingido || 0) / vendasCount : 0);
  const pct = meu.meta_vgv > 0 ? (meu.vgv_atingido / meu.meta_vgv * 100) : 0;
  const statusColor = pct >= 100 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';

  wrap.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,${statusColor}22,transparent);border:1px solid ${statusColor}40;padding:14px;margin-bottom:10px">
      <div style="font-weight:800;font-size:13px;margin-bottom:8px;color:var(--psm-gold)">🎯 Seu Desempenho</div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
        <div class="flex" style="justify-content:space-between"><span class="muted">VGV Mês:</span><b>R$ ${(+meu.vgv_atingido || 0).toLocaleString('pt-BR')}</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Meta Mês:</span><b>R$ ${(+meu.meta_vgv || 0).toLocaleString('pt-BR')}</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Atingimento:</span><b style="color:${statusColor}">${pct.toFixed(1)}%</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Vendas:</span><b>${vendasCount}</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Conversão:</span><b>${(ganhos.length + perdas.length) > 0 ? conv.toFixed(1) + '%' : '—'}</b></div>
        <div class="flex" style="justify-content:space-between"><span class="muted">Ticket Médio:</span><b>R$ ${Math.round(ticketMedio).toLocaleString('pt-BR')}</b></div>
      </div>
    </div>

    <div class="card" style="background:var(--bg-3);padding:14px">
      <div style="font-weight:800;font-size:13px;margin-bottom:8px;color:var(--psm-gold)">💡 Sugestões rápidas</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${[
          'Como melhorar minha conversão?',
          'Análise dos meus últimos 5 deals',
          'O que fazer pra bater a meta esse mês?',
          'Dicas de abordagem pro próximo lead',
        ].map(q => `<button class="btn btn-ghost btn-sm" data-sugg="${esc(q)}" style="text-align:left;font-size:11px">💬 ${esc(q)}</button>`).join('')}
      </div>
    </div>
  `;
  wrap.querySelectorAll('[data-sugg]').forEach(b => b.addEventListener('click', () => {
    document.getElementById('srp-input').value = b.dataset.sugg;
    document.getElementById('srp-input').focus();
  }));
}

function bubble(m) {
  const isUser = m.role === 'user';
  return `
    <div style="display:flex;${isUser ? 'justify-content:flex-end' : ''};gap:8px">
      ${!isUser ? '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--psm-navy),var(--psm-navy-2));color:var(--psm-cream);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:800">🎖️</div>' : ''}
      <div style="max-width:75%;background:${isUser ? 'var(--psm-navy)' : 'var(--bg-2)'};color:${isUser ? '#fff' : 'var(--tx)'};padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word">${esc(m.content)}</div>
      ${isUser ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--psm-navy);color:var(--psm-cream);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0">${esc((auth.user()?.ini || '?').toUpperCase())}</div>` : ''}
    </div>
  `;
}

async function send() {
  if (_busy) return;
  const inp = document.getElementById('srp-input');
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
      agent: 'sr_performance',
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
