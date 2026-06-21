/* PSM-OS v2 — Oportunidades PSM (quadro) (Sprint 8.7) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _items = [];
let _editing = null;
let _formOpen = false;

const TIPOS = ['lead', 'imovel', 'parceria', 'investidor', 'outro'];
const TIPO_ICO = { lead: '🎯', imovel: '🏠', parceria: '🤝', investidor: '💼', outro: '📌' };
const STATUS_COLOR = { aberta: '#22c55e', pegou: '#3b82f6', fechada: '#8b5cf6', perdida: '#64748b' };

export async function pageOportunidades(ctx, root) {
  _root = root;
  render();
  await load();
}

async function load() {
  try {
    const r = await api.request('/api/v3/crm_extra/oportunidades');
    _items = r.oportunidades || [];
    renderList();
  } catch (e) {
    document.getElementById('op-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  const isLider = (auth.user()?.lvl || 0) >= 5;
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">💡 Quadro de Oportunidades PSM</h2>
          <p class="card-sub">Oportunidades publicadas pela diretoria pra equipe pegar — primeiro que pegar fica responsável</p>
        </div>
        ${isLider ? `<button class="btn btn-primary" id="op-new">${_formOpen ? '✕ Fechar' : '➕ Nova Oportunidade'}</button>` : ''}
      </div>
      ${_formOpen && isLider ? renderForm() : ''}
      <div id="op-body" class="mt-3"><div class="muted tiny"><span class="spinner"></span> Carregando…</div></div>
    </div>
  `;
  if (isLider) {
    document.getElementById('op-new').addEventListener('click', () => {
      _formOpen = !_formOpen;
      if (!_formOpen) _editing = null;
      render();
      renderList();
    });
    if (_formOpen) bindForm();
  }
}

function renderForm() {
  const ed = _editing || {};
  return `
    <div class="card mt-3" style="background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #6366f140;padding:18px;color:#fff">
      <div style="font-weight:800;margin-bottom:12px">${ed.id ? '✏️ Editar' : '➕ Nova'} Oportunidade</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">Título *</label>
          <input id="of-tit" class="input" placeholder="Ex: Investidor procura 3 lotes Damha" value="${esc(ed.titulo || '')}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">Descrição</label>
          <textarea id="of-desc" class="input" rows="3" style="background:#0f172a;color:#fff;border-color:#475569">${esc(ed.descricao || '')}</textarea>
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Tipo</label>
          <select id="of-tipo" class="select" style="background:#0f172a;color:#fff">
            ${TIPOS.map(t => `<option value="${t}" ${ed.tipo === t ? 'selected' : ''}>${TIPO_ICO[t]} ${t}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Valor estimado (R$)</label>
          <input id="of-valor" type="number" class="input" value="${ed.valor_est || ''}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Origem</label>
          <input id="of-origem" class="input" placeholder="Indicação Paulo, Instagram, evento..." value="${esc(ed.origem || '')}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Contato</label>
          <input id="of-contato" class="input" placeholder="WhatsApp ou email" value="${esc(ed.contato || '')}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">Prazo</label>
          <input id="of-prazo" type="date" class="input" value="${ed.prazo || ''}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div style="grid-column:1/-1;border-top:1px dashed #475569;margin-top:4px;padding-top:8px"></div>
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">🔗 Link do Kenlo (anúncio no site PSM)</label>
          <input id="of-kenlo" class="input" placeholder="https://...psm... ou link do Kenlo" value="${esc(ed.kenlo_link || '')}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">🖼 Imagem/Vídeo (cole o link — Drive, YouTube, foto do anúncio)</label>
          <input id="of-midia" class="input" placeholder="https://... (jpg/png/mp4/youtube)" value="${esc(ed.midia_url || '')}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div style="grid-column:1/-1">
          <label class="tiny" style="color:#94a3b8">📝 Condições comerciais</label>
          <textarea id="of-cond" class="input" rows="2" placeholder="Ex: entrada 20%, saldo em 36x, permuta aceita..." style="background:#0f172a;color:#fff;border-color:#475569">${esc(ed.condicoes || '')}</textarea>
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">💰 % de comissão</label>
          <input id="of-comissao" type="number" step="0.01" class="input" placeholder="Ex: 5" value="${ed.comissao_pct != null ? ed.comissao_pct : ''}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
        <div>
          <label class="tiny" style="color:#94a3b8">🏆 Prêmio</label>
          <input id="of-premio" class="input" placeholder="Ex: R$ 500 + bônus / viagem" value="${esc(ed.premio || '')}" style="background:#0f172a;color:#fff;border-color:#475569">
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary" id="of-save">${ed.id ? '💾 Salvar' : '➕ Publicar (notifica equipe)'}</button>
        ${ed.id ? '<button class="btn btn-ghost" id="of-cancel">Cancelar Edição</button>' : ''}
      </div>
    </div>
  `;
}

function bindForm() {
  document.getElementById('of-save').addEventListener('click', save);
  const c = document.getElementById('of-cancel');
  if (c) c.addEventListener('click', () => { _editing = null; render(); renderList(); });
}

async function save() {
  const payload = {
    id: _editing?.id,
    titulo: document.getElementById('of-tit').value.trim(),
    descricao: document.getElementById('of-desc').value.trim(),
    tipo: document.getElementById('of-tipo').value,
    valor_est: parseFloat(document.getElementById('of-valor').value) || null,
    origem: document.getElementById('of-origem').value.trim(),
    contato: document.getElementById('of-contato').value.trim(),
    prazo: document.getElementById('of-prazo').value || null,
    kenlo_link: document.getElementById('of-kenlo').value.trim(),
    midia_url: document.getElementById('of-midia').value.trim(),
    condicoes: document.getElementById('of-cond').value.trim(),
    comissao_pct: parseFloat(document.getElementById('of-comissao').value) || null,
    premio: document.getElementById('of-premio').value.trim(),
  };
  if (!payload.titulo) { alert('Título obrigatório'); return; }
  try {
    await api.request('/api/v3/crm_extra/oportunidades', { method: 'POST', body: payload });
    _editing = null;
    _formOpen = false;
    render();
    await load();
  } catch (e) { alert('Erro: ' + e.message); }
}

function renderList() {
  const body = document.getElementById('op-body');
  if (!body) return;
  if (_items.length === 0) {
    body.innerHTML = '<div class="muted tiny" style="text-align:center;padding:40px">Nenhuma oportunidade ainda.</div>';
    return;
  }
  const me = auth.user();
  const isLider = (me?.lvl || 0) >= 5;

  const abertas = _items.filter(o => o.status === 'aberta');
  const minhas = _items.filter(o => o.pegou_por === me?.id && o.status !== 'fechada' && o.status !== 'perdida');
  const fechadas = _items.filter(o => o.status === 'fechada' || o.status === 'perdida');

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;margin-bottom:14px">
      ${kpi('🟢 Abertas', abertas.length, '#22c55e')}
      ${kpi('🔵 Em Andamento', _items.filter(o => o.status === 'pegou').length, '#3b82f6')}
      ${kpi('🟣 Fechadas', _items.filter(o => o.status === 'fechada').length, '#8b5cf6')}
      ${kpi('⚫ Perdidas', _items.filter(o => o.status === 'perdida').length, '#64748b')}
    </div>

    ${abertas.length > 0 ? `
      <h3 style="color:#22c55e;font-size:14px;margin:14px 0 10px">🟢 Disponíveis pra Pegar</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;margin-bottom:18px">
        ${abertas.map(o => opCard(o, isLider, true)).join('')}
      </div>
    ` : ''}

    ${minhas.length > 0 ? `
      <h3 style="color:#3b82f6;font-size:14px;margin:14px 0 10px">📌 Minhas Oportunidades</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;margin-bottom:18px">
        ${minhas.map(o => opCard(o, isLider, false)).join('')}
      </div>
    ` : ''}

    ${fechadas.length > 0 ? `
      <h3 style="color:var(--muted);font-size:14px;margin:14px 0 10px">📋 Histórico</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
        ${fechadas.slice(0, 12).map(o => opCard(o, isLider, false)).join('')}
      </div>
    ` : ''}
  `;
  bindList();
}

function opCard(o, isLider, canPegar) {
  const cor = STATUS_COLOR[o.status] || '#64748b';
  return `
    <div style="background:var(--bg-3);border-left:4px solid ${cor};border-radius:10px;padding:14px">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="flex:1">
          <div style="font-weight:800">${TIPO_ICO[o.tipo] || '📌'} ${esc(o.titulo)}</div>
          <div class="tiny muted">${esc(o.origem || '—')}</div>
        </div>
        <span style="font-size:10px;padding:2px 8px;border-radius:99px;background:${cor}22;color:${cor};font-weight:800;text-transform:uppercase">${o.status}</span>
      </div>
      ${o.descricao ? `<div class="tiny" style="margin-bottom:8px;line-height:1.5">${esc(o.descricao)}</div>` : ''}
      ${o.midia_url ? opMidia(o.midia_url) : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--muted)">
        ${o.valor_est ? `<div>💰 R$ ${(+o.valor_est).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : '<div></div>'}
        ${o.prazo ? `<div>📅 ${o.prazo}</div>` : '<div></div>'}
        ${o.comissao_pct != null ? `<div>💵 Comissão: <b style="color:#16a34a">${(+o.comissao_pct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</b></div>` : ''}
        ${o.premio ? `<div>🏆 ${esc(o.premio)}</div>` : ''}
        ${o.contato ? `<div style="grid-column:1/-1">📞 ${esc(o.contato)}</div>` : ''}
      </div>
      ${o.condicoes ? `<div class="tiny" style="margin-top:6px;background:var(--bg-2);border-radius:6px;padding:6px;line-height:1.5">📝 <b>Condições:</b> ${esc(o.condicoes)}</div>` : ''}
      ${o.kenlo_link ? `<div class="mt-2"><a href="${esc(o.kenlo_link)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none">🔗 Ver anúncio no site PSM</a></div>` : ''}
      <div class="flex gap-2 mt-2">
        ${canPegar ? `<button class="btn btn-primary btn-sm" data-pegar="${o.id}">✋ Pegar</button>` : ''}
        ${isLider ? `<button class="btn btn-ghost btn-sm" data-edit="${o.id}">✏️</button><button class="btn btn-ghost btn-sm" data-del="${o.id}">🗑</button>` : ''}
      </div>
    </div>
  `;
}

function bindList() {
  document.querySelectorAll('[data-pegar]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Pegar essa oportunidade? Você ficará responsável.')) return;
    try {
      await api.request('/api/v3/crm_extra/oportunidades', { method: 'POST', body: { action: 'pegar', id: b.dataset.pegar } });
      await load();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    _editing = _items.find(x => x.id === b.dataset.edit);
    _formOpen = true;
    render();
    renderList();
  }));
  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remover oportunidade?')) return;
    try {
      await api.request('/api/v3/crm_extra/oportunidades?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      await load();
    } catch (e) { alert('Erro: ' + e.message); }
  }));
}

function opMidia(url) {
  const u = esc(url);
  if (/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(url))
    return `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="mídia" loading="lazy" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:8px"></a>`;
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  if (yt) return `<a href="${u}" target="_blank" rel="noopener" style="display:block;position:relative;margin-bottom:8px"><img src="https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px"><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:28px;text-shadow:0 2px 6px #000">▶️</span></a>`;
  return `<a href="${u}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none;margin-bottom:8px;display:inline-block">🎬 Abrir mídia</a>`;
}

function kpi(label, value, color) {
  return `<div style="background:var(--bg-3);border-left:4px solid ${color};padding:12px;border-radius:8px"><div class="tiny muted">${label}</div><div style="font-size:22px;font-weight:800;color:${color}">${value}</div></div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
