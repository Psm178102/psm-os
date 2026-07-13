/* PSM-OS v2 — ⭐ Avaliações & Feedbacks de CLIENTES (v84.29) · Mariane
   Kanban de NPS pós-visita (funis MAP/Conquista/Terceiros/Locação, automático
   do RD) + fluxos de mensagem POR ORIGEM. Nota 0–10 em todo card; ≥9 →
   Ciclo realizado + card na Indicação Premiada; ≤6 → Nota baixa + gestão
   notificada. Menções a gerente/corretor/sócios com sino+push.
   (Não confundir com avaliacoes.js = avaliação de desempenho de RH.)
   Backend: /api/v3/producao/avaliacoes */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _host = null, _d = null, _busy = false, _aba = 'kanban', _fOrigem = '', _busca = '', _showMax = {}, _editFluxo = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORIGENS = {
  map: ['🏘 MAP', '#2563eb'], conquista: ['🚀 Conquista', '#d97706'],
  terceiros: ['🤝 Terceiros', '#7c3aed'], locacoes: ['🔑 Locação', '#0891b2'],
  manual: ['✍️ Manual', '#64748b'],
};
const MOTIVOS = ['duplicado', 'não quis avaliar', 'não responde'];
const notaCor = n => n >= 9 ? '#16a34a' : n >= 7 ? '#d97706' : '#dc2626';
const hojeStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const amanhaStr = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const prazoStatus = c => { // 'atrasada' | 'hoje' | 'amanha' | null
  const t = c.tarefa || {};
  if (!t.data) return null;
  const d = String(t.data).substring(0, 10);
  return d < hojeStr() ? 'atrasada' : d === hojeStr() ? 'hoje' : d === amanhaStr() ? 'amanha' : null;
};
const PRAZO_UI = {
  atrasada: ['#dc2626', '⏰ ATRASADO'],
  hoje: ['#d97706', '📅 VENCE HOJE'],
  amanha: ['#eab308', '⚠️ VENCE AMANHÃ'],
};

export async function pageAvaliacoesNps(ctx, root) { _host = root; await reload(); }

async function reload() {
  if (!_host) return;
  _host.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando avaliações…</div></div>';
  try {
    _d = await api.request('/api/v3/producao/avaliacoes');
  } catch (e) {
    _host.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div>
      <div class="tiny muted mt-1">Se for a 1ª vez: a tabela "avaliacoes_kanban" precisa da migração no Supabase.</div></div>`;
    return;
  }
  render();
}

async function post(body, okMsg) {
  if (_busy) return null;
  _busy = true;
  let r = null;
  try {
    r = await api.request('/api/v3/producao/avaliacoes', { method: 'POST', body });
    if (okMsg) alert(okMsg);
  } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  _busy = false;
  return r;
}

function tagInfo(id) {
  return (_d.cfg.etiquetas || []).find(t => t.id === id) || { id, nome: id, cor: '#64748b' };
}

function corretorNome(c) {
  const em = (c.corretor_email || '').toLowerCase();
  if (!em) return null;
  const u = (_d.users || []).find(x => (x.email || '') === em);
  return u ? u.name : em.split('@')[0];
}

/* ── cards ───────────────────────────────────────────────────────────────── */
function cardHtml(c) {
  const [oLbl, oCor] = ORIGENS[c.origem] || ORIGENS.manual;
  const fone = (c.contato || '').replace(/\D/g, '');
  const fs = prazoStatus(c);
  const [pc, pl] = PRAZO_UI[fs] || [];
  const borda = fs ? `border:2px solid ${pc};background:${pc}0d` : 'border:1px solid var(--bd,#e2e8f0)';
  return `<div class="av-card" draggable="true" data-id="${esc(c.id)}"
    style="background:var(--bg-2);${borda};border-radius:10px;padding:8px 10px;margin-bottom:6px;cursor:grab">
    ${fs ? `<div class="tiny" style="font-weight:900;color:${pc};margin-bottom:2px">${pl}${c.tarefa?.titulo ? ' · ' + esc(c.tarefa.titulo.replace(/^[^ ]+ /, '')) : ''}</div>` : ''}
    <div class="flex items-center" style="gap:6px">
      ${c.nota != null ? `<span style="background:${notaCor(c.nota)};color:#fff;font-weight:900;border-radius:8px;padding:0 7px;font-size:13px">${Number(c.nota) % 1 ? c.nota : Math.round(c.nota)}</span>` : ''}
      <b style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nome)}</b>
      ${fone ? `<a class="tiny" href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener" title="Abrir WhatsApp" onclick="event.stopPropagation()">💬</a>` : ''}
    </div>
    <div class="flex" style="gap:4px;flex-wrap:wrap;margin-top:3px">
      <span class="tiny" style="background:${oCor}1a;color:${oCor};padding:0 7px;border-radius:999px;font-weight:700">${oLbl}</span>
      ${(c.etiquetas || []).map(t => { const i = tagInfo(t); return `<span class="tiny" style="background:${i.cor}1a;color:${i.cor};padding:0 7px;border-radius:999px;font-weight:700">${esc(i.nome)}</span>`; }).join('')}
      ${c.indicacao_criada ? '<span class="tiny" title="Promotor — card criado na Indicação Premiada">🎁</span>' : ''}
      ${(c.mencoes || []).length ? `<span class="tiny" title="Menções feitas">👀 ${(c.mencoes || []).length}</span>` : ''}
    </div>
    ${corretorNome(c) ? `<div class="tiny" style="margin-top:2px;font-weight:700">👔 ${esc(corretorNome(c))} <span class="muted" style="font-weight:400">(corretor no RD)</span></div>` : ''}
    ${c.feedback ? `<div class="tiny" style="margin-top:2px;max-height:30px;overflow:hidden;font-style:italic">"${esc(c.feedback)}"</div>` : ''}
    ${c.tarefa?.data ? `<div class="tiny" style="margin-top:2px;color:#2563eb;font-weight:700">📅 ${esc(String(c.tarefa.data).split('-').reverse().join('/'))}${c.tarefa.hora_ini ? ' ' + esc(c.tarefa.hora_ini) : ''}</div>` : ''}
    ${c.descarte_motivo ? `<div class="tiny muted" style="margin-top:2px">🗑 ${esc(c.descarte_motivo)}</div>` : ''}
    ${c.visita_em ? `<div class="tiny muted" style="margin-top:2px">👣 visita ${esc(String(c.visita_em).substring(0, 10).split('-').reverse().join('/'))}</div>` : ''}
  </div>`;
}

function render() {
  const fluxosAba = _aba === 'fluxos';
  const cfg = _d.cfg || { colunas: [], etiquetas: [] };
  let cards = _d.cards || [];
  if (_fOrigem) cards = cards.filter(c => c.origem === _fOrigem);
  if (_busca) { const q = _busca.toLowerCase(); cards = cards.filter(c => (c.nome || '').toLowerCase().includes(q) || (c.contato || '').includes(q)); }
  const porCol = {};
  cards.forEach(c => { (porCol[c.coluna] = porCol[c.coluna] || []).push(c); });
  const peso = c => ({ atrasada: 0, hoje: 1, amanha: 2 }[prazoStatus(c)] ?? 3);
  Object.values(porCol).forEach(l => l.sort((a, b) => peso(a) - peso(b)));

  _host.innerHTML = `
    <div class="card" style="padding:10px 12px">
      <div class="flex items-center" style="gap:6px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0;font-size:16px">⭐ Avaliações & Feedbacks</h2>
        <span class="tiny muted">pós-visita · nota 0–10 · ≥9 vira Indicação Premiada · ≤6 aciona a gestão</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-sm ${!fluxosAba ? 'btn-primary' : 'btn-ghost'}" id="av-aba-k">📋 Kanban</button>
        <button class="btn btn-sm ${fluxosAba ? 'btn-primary' : 'btn-ghost'}" id="av-aba-f">💬 Fluxos por origem</button>
        <button class="btn btn-ghost btn-sm" id="av-reload">↻</button>
      </div>
      ${fluxosAba ? '' : `<div class="flex items-center mt-2" style="gap:6px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="av-sync" title="Puxa do RD as visitas realizadas dos 4 funis">🔄 Sincronizar visitas</button>
        <button class="btn btn-ghost btn-sm" id="av-novo">➕ Card manual</button>
        <input class="input" id="av-busca" placeholder="🔎 nome ou fone" value="${esc(_busca)}" style="width:150px;padding:4px 9px">
        <span style="margin-left:auto"></span>
        ${['', ...Object.keys(ORIGENS)].map(o => `<button class="btn btn-sm ${_fOrigem === o ? 'btn-primary' : 'btn-ghost'} av-fo" data-o="${o}" style="padding:2px 8px;font-size:11px">${o ? ORIGENS[o][0] : 'Todas'} (${o ? (_d.cards || []).filter(c => c.origem === o).length : (_d.cards || []).length})</button>`).join('')}
        ${_d.can_cfg ? '<button class="btn btn-ghost btn-sm" id="av-cfg" title="Criar/excluir/renomear colunas, cores, etiquetas e janela de visitas">⚙️ Personalizar</button>' : ''}
      </div>`}
    </div>
    ${fluxosAba ? htmlFluxos() : `
    ${(() => {
      const cs = (_d.cards || []).filter(c => c.coluna !== 'descarte');
      const comNota = cs.filter(c => c.nota != null);
      const prom = comNota.filter(c => c.nota >= 9).length;
      const neut = comNota.filter(c => c.nota >= 7 && c.nota < 9).length;
      const detr = comNota.filter(c => c.nota <= 6).length;
      const nps = comNota.length ? Math.round((prom - detr) / comNota.length * 100) : null;
      const media = comNota.length ? (comNota.reduce((s, c) => s + Number(c.nota), 0) / comNota.length).toFixed(1) : '—';
      const cob = cs.length ? Math.round(comNota.length / cs.length * 100) : 0;
      const mini = (l, v, cor) => `<div style="flex:1;min-width:105px;background:var(--bg-2);border-radius:10px;padding:6px 10px;border-left:3px solid ${cor}"><div class="tiny muted">${l}</div><div style="font-weight:900;font-size:16px">${v}</div></div>`;
      return `<div class="flex mt-2" style="gap:8px;flex-wrap:wrap">
        ${mini('📊 NPS', nps === null ? '—' : nps, nps === null ? '#64748b' : nps >= 50 ? '#16a34a' : nps >= 0 ? '#d97706' : '#dc2626')}
        ${mini('⭐ Nota média', media, '#2563eb')}
        ${mini('🌟 Promotores (9–10)', prom, '#16a34a')}
        ${mini('😐 Neutros (7–8)', neut, '#d97706')}
        ${mini('🔴 Detratores (0–6)', detr, '#dc2626')}
        ${mini('📋 Cobertura', cob + '%', cob >= 80 ? '#16a34a' : '#d97706')}
      </div>`;
    })()}
    <div class="mt-2" style="display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:8px">
      ${(cfg.colunas || []).map(col => {
        const lista = porCol[col.id] || [];
        const max = _showMax[col.id] || 40;
        return `<div class="av-col" data-col="${esc(col.id)}"
          style="flex:0 0 268px;background:var(--bg-3);border-radius:12px;padding:8px;border-top:3px solid ${esc(col.cor)}">
          <div class="flex items-center" style="gap:6px;padding:0 2px 6px">
            <b class="tiny">${esc(col.emoji)} ${esc(col.nome)}</b>
            <span class="tiny muted" style="margin-left:auto;font-weight:800">${lista.length}</span>
          </div>
          <div style="max-height:62vh;overflow-y:auto">
            ${lista.slice(0, max).map(cardHtml).join('') || '<div class="tiny muted" style="text-align:center;padding:14px 0">vazio</div>'}
            ${lista.length > max ? `<button class="btn btn-ghost btn-sm av-mais" data-col="${esc(col.id)}" style="width:100%">↓ mostrar +40 (${lista.length - max} restantes)</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`}`;
  fluxosAba ? wireFluxos() : wireKanban();
  _host.querySelector('#av-reload').onclick = reload;
  _host.querySelector('#av-aba-k').onclick = () => { _aba = 'kanban'; _editFluxo = null; render(); };
  _host.querySelector('#av-aba-f').onclick = () => { _aba = 'fluxos'; render(); };
}

function wireKanban() {
  const $ = s => _host.querySelector(s);
  $('#av-sync').onclick = async () => {
    $('#av-sync').disabled = true; $('#av-sync').textContent = '⏳ Sincronizando…';
    const r = await post({ action: 'sincronizar' });
    if (r) alert(`🔄 Sincronizado: ${r.criadas} card(s) novo(s)\n🏘 MAP: ${r.por_origem.map} · 🚀 Conquista: ${r.por_origem.conquista} · 🤝 Terceiros: ${r.por_origem.terceiros} · 🔑 Locação: ${r.por_origem.locacoes}`);
    reload();
  };
  $('#av-novo').onclick = async () => {
    const nome = prompt('Nome do cliente:');
    if (!nome) return;
    const fone = prompt('Telefone (só números, opcional):') || '';
    await post({ action: 'novo', nome, contato: fone });
    reload();
  };
  $('#av-busca').oninput = e => { _busca = e.target.value; render(); };
  _host.querySelectorAll('.av-fo').forEach(b => b.onclick = () => { _fOrigem = b.dataset.o; render(); });
  _host.querySelectorAll('.av-mais').forEach(b => b.onclick = () => { _showMax[b.dataset.col] = (_showMax[b.dataset.col] || 40) + 40; render(); });
  if ($('#av-cfg')) $('#av-cfg').onclick = abrirCfg;

  _host.querySelectorAll('.av-card').forEach(el => {
    el.onclick = () => abrirCard(el.dataset.id);
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; };
  });
  _host.querySelectorAll('.av-col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.style.outline = '2px dashed #2563eb'; };
    col.ondragleave = () => { col.style.outline = ''; };
    col.ondrop = async e => {
      e.preventDefault(); col.style.outline = '';
      const id = e.dataTransfer.getData('text/plain');
      const c = (_d.cards || []).find(x => x.id === id);
      const destino = col.dataset.col;
      if (!c || c.coluna === destino) return;
      let motivo = null;
      if (destino === 'descarte') {
        motivo = await pedirMotivo();
        if (motivo === null) return;
      }
      const r = await post({ action: 'mover', id, coluna: destino, motivo });
      if (r) {
        c.coluna = destino;
        c.descarte_motivo = destino === 'descarte' ? motivo : null;
        c.tarefa = r.followup ? { data: r.followup, titulo: '🔁 Follow-up automático', auto: true } : (c.tarefa?.auto ? null : c.tarefa);
        render();
      }
    };
  });
}

function pedirMotivo() {
  return new Promise(resolve => {
    const ov = overlay(`
      <h3 class="card-title" style="margin:0">🗑 Motivo do descarte</h3>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        ${MOTIVOS.map(m => `<button class="btn btn-ghost btn-sm av-mot" data-m="${esc(m)}">${esc(m)}</button>`).join('')}
      </div>
      <div class="flex mt-2" style="gap:6px">
        <input class="input" id="av-mot-outro" placeholder="Outro motivo (escreva)" style="flex:1">
        <button class="btn btn-primary btn-sm" id="av-mot-ok">OK</button>
      </div>
      <div class="flex mt-2" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" id="av-mot-x">Cancelar</button></div>`);
    ov.querySelectorAll('.av-mot').forEach(b => b.onclick = () => { ov.remove(); resolve(b.dataset.m); });
    ov.querySelector('#av-mot-ok').onclick = () => {
      const t = ov.querySelector('#av-mot-outro').value.trim();
      if (!t) { alert('Escreva o motivo ou escolha um botão.'); return; }
      ov.remove(); resolve('outro: ' + t);
    };
    ov.querySelector('#av-mot-x').onclick = () => { ov.remove(); resolve(null); };
  });
}

function overlay(inner) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  ov.innerHTML = `<div class="card" style="max-width:580px;width:100%;background:var(--bg-2);margin:auto">${inner}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}

/* ── modal do card ───────────────────────────────────────────────────────── */
function abrirCard(id) {
  const c = (_d.cards || []).find(x => x.id === id);
  if (!c) return;
  const lvl = auth.user()?.lvl || 0;
  const [oLbl] = ORIGENS[c.origem] || ORIGENS.manual;
  const users = _d.users || [];
  const corretor = users.find(u => u.email && u.email === (c.corretor_email || ''));
  const chipU = u => {
    const marca = corretor && u.id === corretor.id ? ' 🏷 corretor deste cliente' : '';
    return `<label class="tiny flex gap-1" style="align-items:center"><input type="checkbox" class="mn-u" value="${esc(u.id)}"${marca ? ' checked' : ''}> ${esc(u.name)}${marca}</label>`;
  };
  const ov = overlay(`
    <div class="flex items-center" style="gap:8px">
      ${c.nota != null ? `<span style="background:${notaCor(c.nota)};color:#fff;font-weight:900;border-radius:8px;padding:2px 10px;font-size:16px">${Number(c.nota) % 1 ? c.nota : Math.round(c.nota)}</span>` : ''}
      <h3 class="card-title" style="margin:0;flex:1">${esc(c.nome)}</h3>
      <span class="tiny muted">${oLbl}</span>
      <button class="btn btn-ghost btn-sm" id="av-x">✕</button>
    </div>
    ${corretorNome(c) ? `<div class="tiny mt-1" style="background:#2563eb12;border-radius:8px;padding:6px 10px;font-weight:700">👔 Corretor responsável (RD CRM): ${esc(corretorNome(c))}${c.corretor_email ? ` <span class="muted" style="font-weight:400">· ${esc(c.corretor_email)}</span>` : ''}</div>` : '<div class="tiny muted mt-1">👔 Sem corretor vinculado no RD (card manual)</div>'}
    <div style="background:${c.nota != null ? notaCor(c.nota) : '#64748b'}12;border-radius:10px;padding:10px;margin-top:8px">
      <label class="tiny muted" style="font-weight:800">⭐ Nota (0–10) + feedback ${c.nota != null ? '— já coletada, pode corrigir' : ''}</label>
      <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:4px;align-items:flex-start">
        <input class="input" id="av-nota" type="number" min="0" max="10" step="1" value="${c.nota ?? ''}" placeholder="0–10" style="width:80px;font-weight:900;font-size:16px">
        <textarea class="input" id="av-fb" rows="2" placeholder="O que o cliente disse (feedback)" style="flex:1;min-width:220px;resize:vertical">${esc(c.feedback || '')}</textarea>
        <button class="btn btn-primary btn-sm" id="av-notaok" title="≥9 → Ciclo realizado + Indicação Premiada · ≤6 → Nota baixa + gestão avisada">⭐ Registrar nota</button>
      </div>
    </div>
    <div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:10px">
      <label class="tiny muted" style="font-weight:800">👀 Mencionar (gerente, corretor, sócios) — eles recebem sino + push</label>
      <div style="max-height:110px;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:4px">
        ${users.map(chipU).join('') || '<span class="tiny muted">sem usuários</span>'}
      </div>
      <button class="btn btn-ghost btn-sm mt-1" id="av-mencionar">📣 Enviar menção</button>
      ${(c.mencoes || []).length ? `<div class="tiny muted mt-1">Últimas: ${(c.mencoes || []).slice(-3).map(m => esc(m.nome_por || '?') + ' (' + String(m.ts || '').substring(0, 10) + ')').join(' · ')}</div>` : ''}
    </div>
    <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="av-nome" value="${esc(c.nome)}" style="flex:2;min-width:160px" placeholder="Nome">
      <input class="input" id="av-fone" value="${esc(c.contato || '')}" style="flex:1;min-width:130px" placeholder="Telefone">
      ${(c.contato || '').replace(/\D/g, '') ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/55${esc((c.contato || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
    </div>
    <div class="mt-2"><label class="tiny muted">🏷 Etiquetas</label>
      <div class="flex" style="gap:5px;flex-wrap:wrap;margin-top:3px">
        ${(_d.cfg.etiquetas || []).map(t => { const on = (c.etiquetas || []).includes(t.id); return `<button class="btn btn-sm av-tag" data-t="${esc(t.id)}" style="padding:2px 10px;font-size:11px;border-radius:999px;${on ? `background:${t.cor};color:#fff;font-weight:800` : `background:${t.cor}1a;color:${t.cor}`}">${esc(t.nome)}</button>`; }).join('')}
      </div></div>
    <div class="mt-2" style="background:#7c3aed12;border-radius:10px;padding:8px 10px">
      <div class="flex items-center" style="gap:6px">
        <label class="tiny muted" style="font-weight:800">🧠 Mensagem personalizada por IA <span style="font-weight:400">(usa origem, nota e feedback do card)</span></label>
        <button class="btn btn-ghost btn-sm" id="av-ia" style="margin-left:auto;padding:2px 10px;font-size:11px">✨ Gerar</button>
      </div>
      <div id="av-ia-out" style="display:none;margin-top:5px">
        <textarea class="input" id="av-ia-txt" rows="3" style="resize:vertical"></textarea>
        <button class="btn btn-ghost btn-sm mt-1" id="av-ia-copy">📋 Copiar</button>
      </div>
    </div>
    <div class="mt-2"><label class="tiny muted">📝 Observações</label>
      <textarea class="input" id="av-obs" rows="2" style="resize:vertical">${esc(c.obs || '')}</textarea></div>
    <div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:8px 10px">
      <label class="tiny muted">📅 Tarefa (vai pra Agenda)${c.tarefa?.data ? ` — atual: ${esc(String(c.tarefa.data).split('-').reverse().join('/'))}` : ''}</label>
      <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:3px">
        <input class="input" id="av-tdata" type="date" value="${esc(c.tarefa?.data || '')}" style="flex:1;min-width:130px">
        <input class="input" id="av-tini" type="time" value="${esc(c.tarefa?.hora_ini || '')}" style="width:100px">
        <input class="input" id="av-tfim" type="time" value="${esc(c.tarefa?.hora_fim || '')}" style="width:100px">
        <button class="btn btn-ghost btn-sm" id="av-tarefa">📅 Agendar</button>
      </div>
    </div>
    <div class="flex mt-3" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
      ${lvl >= 7 ? '<button class="btn btn-ghost btn-sm" id="av-del" style="color:#dc2626;margin-right:auto">🗑 Excluir card</button>' : ''}
      <button class="btn btn-primary btn-sm" id="av-save">💾 Salvar</button>
    </div>`);
  const tags = new Set(c.etiquetas || []);
  ov.querySelectorAll('.av-tag').forEach(b => b.onclick = () => {
    const t = b.dataset.t, info = tagInfo(t);
    if (tags.has(t)) { tags.delete(t); b.style.cssText += `;background:${info.cor}1a;color:${info.cor};font-weight:400`; }
    else { tags.add(t); b.style.cssText += `;background:${info.cor};color:#fff;font-weight:800`; }
  });
  ov.querySelector('#av-x').onclick = () => ov.remove();
  ov.querySelector('#av-ia').onclick = async () => {
    const b = ov.querySelector('#av-ia');
    b.disabled = true; b.textContent = '⏳ Gerando…';
    const r = await post({ action: 'sugerir_msg', id: c.id });
    b.disabled = false; b.textContent = '✨ Gerar outra';
    if (r && r.msg) { ov.querySelector('#av-ia-out').style.display = ''; ov.querySelector('#av-ia-txt').value = r.msg; }
  };
  ov.querySelector('#av-ia-copy').onclick = async () => {
    const t = ov.querySelector('#av-ia-txt').value;
    try { await navigator.clipboard.writeText(t); } catch (_) { prompt('Copie a mensagem:', t); return; }
    const b = ov.querySelector('#av-ia-copy'); b.textContent = '✅ Copiado'; setTimeout(() => { b.textContent = '📋 Copiar'; }, 1400);
  };
  ov.querySelector('#av-notaok').onclick = async () => {
    const n = ov.querySelector('#av-nota').value;
    if (n === '') { alert('Informe a nota de 0 a 10.'); return; }
    const r = await post({ action: 'nota', id: c.id, nota: Number(n), feedback: ov.querySelector('#av-fb').value.trim() });
    if (r) {
      const m = Number(n) >= 9 ? '✅ Ciclo realizado!' + (r.indicacao ? ' 🎁 Cliente entrou no Kanban da Indicação Premiada como promotor.' : '')
        : Number(n) <= 6 ? '🔴 Nota baixa — gestão notificada na hora. Card em "Nota baixa" pra tratamento.'
        : '⭐ Nota registrada — card em "Nota + Feedback".';
      alert(m); ov.remove(); reload();
    }
  };
  ov.querySelector('#av-mencionar').onclick = async () => {
    const ids = [...ov.querySelectorAll('.mn-u:checked')].map(x => x.value);
    if (!ids.length) { alert('Marque ao menos 1 pessoa.'); return; }
    const r = await post({ action: 'mencionar', id: c.id, user_ids: ids }, `📣 ${ids.length} pessoa(s) notificada(s).`);
    if (r) { ov.remove(); reload(); }
  };
  ov.querySelector('#av-save').onclick = async () => {
    const g = s => ov.querySelector(s).value.trim();
    const r = await post({ action: 'editar', id: c.id, nome: g('#av-nome'), contato: g('#av-fone'),
                           obs: g('#av-obs'), etiquetas: [...tags] });
    if (r) { ov.remove(); reload(); }
  };
  ov.querySelector('#av-tarefa').onclick = async () => {
    const data = ov.querySelector('#av-tdata').value;
    if (!data) { alert('Escolha a data.'); return; }
    const r = await post({ action: 'tarefa', id: c.id, data,
                           hora_ini: ov.querySelector('#av-tini').value, hora_fim: ov.querySelector('#av-tfim').value },
                         '📅 Tarefa criada na Agenda.');
    if (r) { ov.remove(); reload(); }
  };
  const del = ov.querySelector('#av-del');
  if (del) del.onclick = async () => {
    if (!confirm('Excluir este card de vez? (pro dia a dia, prefira o descarte)')) return;
    const r = await post({ action: 'excluir', id: c.id });
    if (r) { ov.remove(); reload(); }
  };
}

/* ── fluxos por origem (mesma metodologia da Indicação Premiada) ─────────── */
function fluxoCard(f) {
  if (_editFluxo === f.id) return fluxoEditor(f);
  const passo = (p, i) => `
    <div style="border-top:1px solid var(--bd,#eef2f7);padding:8px 0 6px">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <b class="tiny">${i + 1}. ${esc(p.titulo || 'Mensagem')}</b>
        ${p.envio ? `<span class="tiny" style="background:#2563eb1a;color:#2563eb;padding:1px 8px;border-radius:999px">⏱ ${esc(p.envio)}</span>` : ''}
        <button class="btn btn-ghost btn-sm avf-copy" data-fluxo="${esc(f.id)}" data-passo="${i}" style="margin-left:auto;padding:2px 9px;font-size:11px">📋 Copiar</button>
      </div>
      <div class="tiny" style="white-space:pre-wrap;background:var(--bg-3);border-radius:8px;padding:7px 9px;margin-top:4px">${esc(p.texto)}</div>
    </div>`;
  return `<div class="card" style="margin:0 0 10px;padding:12px 14px">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>${esc(f.emoji || '💬')} ${esc(f.nome)}</b>
      ${_d.can_cfg ? `<button class="btn btn-ghost btn-sm avf-edit" data-id="${esc(f.id)}" style="margin-left:auto;padding:2px 9px;font-size:11px">✏️ Editar</button>` : ''}
    </div>
    ${f.quando_usar ? `<div class="tiny muted" style="margin-top:2px">🎯 ${esc(f.quando_usar)}</div>` : ''}
    <div class="mt-1">${(f.passos || []).map(passo).join('')}</div>
  </div>`;
}

function fluxoEditor(f) {
  const novo = f.id === '__novo__';
  const passoEd = p => `
    <div style="border-top:1px dashed var(--bd,#e2e8f0);padding:8px 0" data-passo-ed>
      <div class="flex" style="gap:6px;flex-wrap:wrap">
        <input class="input pe-titulo" value="${esc(p.titulo || '')}" placeholder="Título do passo" style="flex:2;min-width:160px;padding:4px 8px">
        <input class="input pe-envio" value="${esc(p.envio || '')}" placeholder="Quando enviar" style="flex:1;min-width:150px;padding:4px 8px">
        <button class="btn btn-ghost btn-sm pe-del" type="button" style="color:#dc2626;padding:1px 8px">×</button>
      </div>
      <textarea class="input pe-texto" rows="2" style="margin-top:4px;resize:vertical" placeholder="Mensagem (use {nome})">${esc(p.texto || '')}</textarea>
    </div>`;
  return `<div class="card" style="margin:0 0 10px;padding:12px 14px;border:1px solid #2563eb55" id="avf-editor">
    <b class="tiny">${novo ? '➕ Novo fluxo' : '✏️ Editando fluxo'}</b>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input fe-emoji" value="${esc(f.emoji || '💬')}" style="width:58px;padding:4px 8px">
      <input class="input fe-nome" value="${esc(f.nome || '')}" placeholder="Nome do fluxo (ex.: MAP pós-visita)" style="flex:2;min-width:180px;padding:4px 8px">
    </div>
    <input class="input fe-quando mt-1" value="${esc(f.quando_usar || '')}" placeholder="Quando usar este fluxo" style="width:100%;padding:4px 8px">
    <div id="fe-passos" class="mt-1">${(f.passos || []).map(passoEd).join('')}</div>
    <button class="btn btn-ghost btn-sm" id="fe-add" type="button">+ passo</button>
    <div class="flex gap-2 mt-2" style="justify-content:flex-end">
      ${!novo ? '<button class="btn btn-ghost btn-sm" id="fe-del" type="button" style="color:#dc2626;margin-right:auto">🗑 Excluir fluxo</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="fe-cancel" type="button">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="fe-save" type="button">💾 Salvar fluxos</button>
    </div>
  </div>`;
}

function htmlFluxos() {
  const fluxos = _d.fluxos || [];
  return `<div class="mt-2">
    <div class="tiny" style="background:#d977061a;color:#a16207;border-radius:10px;padding:8px 10px;font-weight:700">
      💡 Colete a nota em até 48h da visita. UMA mensagem por vez — e nota baixa se responde NA HORA, não amanhã.
    </div>
    ${_d.can_cfg ? '<div class="flex mt-2" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" id="avf-novo">➕ Novo fluxo</button></div>' : ''}
    <div class="mt-2">
      ${_editFluxo === '__novo__' ? fluxoEditor({ id: '__novo__', emoji: '💬', nome: '', quando_usar: '', passos: [{ titulo: '', envio: '', texto: '' }] }) : ''}
      ${fluxos.map(fluxoCard).join('') || '<div class="card muted">Nenhum fluxo ainda.</div>'}
    </div>
  </div>`;
}

function wireFluxos() {
  _host.querySelectorAll('.avf-copy').forEach(b => b.onclick = async () => {
    const f = (_d.fluxos || []).find(x => x.id === b.dataset.fluxo);
    const p = f?.passos?.[Number(b.dataset.passo)];
    if (!p) return;
    try { await navigator.clipboard.writeText(p.texto); } catch (_) { prompt('Copie a mensagem:', p.texto); return; }
    const old = b.textContent; b.textContent = '✅ Copiado'; setTimeout(() => { b.textContent = old; }, 1400);
  });
  _host.querySelectorAll('.avf-edit').forEach(b => b.onclick = () => { _editFluxo = b.dataset.id; render(); });
  const novo = _host.querySelector('#avf-novo');
  if (novo) novo.onclick = () => { _editFluxo = '__novo__'; render(); };

  const ed = _host.querySelector('#avf-editor');
  if (!ed) return;
  ed.querySelector('#fe-add').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = `<div style="border-top:1px dashed var(--bd,#e2e8f0);padding:8px 0" data-passo-ed>
      <div class="flex" style="gap:6px;flex-wrap:wrap">
        <input class="input pe-titulo" placeholder="Título do passo" style="flex:2;min-width:160px;padding:4px 8px">
        <input class="input pe-envio" placeholder="Quando enviar" style="flex:1;min-width:150px;padding:4px 8px">
        <button class="btn btn-ghost btn-sm pe-del" type="button" style="color:#dc2626;padding:1px 8px">×</button>
      </div>
      <textarea class="input pe-texto" rows="2" style="margin-top:4px;resize:vertical" placeholder="Mensagem (use {nome})"></textarea>
    </div>`;
    ed.querySelector('#fe-passos').appendChild(d.firstElementChild);
  };
  ed.addEventListener('click', e => {
    if (e.target.classList?.contains('pe-del')) e.target.closest('[data-passo-ed]')?.remove();
  });
  ed.querySelector('#fe-cancel').onclick = () => { _editFluxo = null; render(); };
  const salvar = removerId => {
    const fluxos = (_d.fluxos || []).map(f => ({ ...f, passos: (f.passos || []).map(p => ({ ...p })) }));
    let novoF = null;
    if (!removerId) {
      const passos = [...ed.querySelectorAll('[data-passo-ed]')].map(r => ({
        titulo: r.querySelector('.pe-titulo').value.trim(),
        envio: r.querySelector('.pe-envio').value.trim(),
        texto: r.querySelector('.pe-texto').value.trim(),
      })).filter(p => p.texto);
      novoF = { id: _editFluxo === '__novo__' ? '' : _editFluxo,
                emoji: ed.querySelector('.fe-emoji').value.trim() || '💬',
                nome: ed.querySelector('.fe-nome').value.trim(),
                quando_usar: ed.querySelector('.fe-quando').value.trim(), passos };
      if (!novoF.nome || !passos.length) { alert('Dê um nome ao fluxo e preencha ao menos 1 mensagem.'); return; }
    }
    let final;
    if (removerId) final = fluxos.filter(f => f.id !== removerId);
    else if (_editFluxo === '__novo__') final = [novoF, ...fluxos];
    else final = fluxos.map(f => f.id === _editFluxo ? novoF : f);
    if (!final.length) { alert('Deixe ao menos 1 fluxo.'); return; }
    _editFluxo = null;
    post({ action: 'set_fluxos', fluxos: final }, '💬 Fluxos salvos.').then(() => reload());
  };
  ed.querySelector('#fe-save').onclick = () => salvar(null);
  const del = ed.querySelector('#fe-del');
  if (del) del.onclick = () => { if (confirm('Excluir este fluxo inteiro?')) salvar(_editFluxo); };
}

/* ── editor do quadro ────────────────────────────────────────────────────── */
function abrirCfg() {
  const cfg = _d.cfg;
  const FIXAS = ['origens', 'descarte', 'nota_baixa', 'ciclo_realizado'];
  const colRow = c => `<div class="flex" style="gap:5px;margin-top:4px;align-items:center" data-cfgcol="${esc(c.id)}">
    <span style="display:flex;flex-direction:column">
      <button class="btn btn-ghost cg-up" type="button" title="Mover pra cima" style="padding:0 5px;font-size:9px;line-height:1.3">▲</button>
      <button class="btn btn-ghost cg-dn" type="button" title="Mover pra baixo" style="padding:0 5px;font-size:9px;line-height:1.3">▼</button>
    </span>
    <input class="input cg-emoji" value="${esc(c.emoji)}" style="width:52px;padding:3px 7px">
    <input class="input cg-nome" value="${esc(c.nome)}" style="flex:1;padding:3px 8px">
    <input class="input cg-cor" type="color" value="${esc(c.cor)}" style="width:44px;padding:1px">
    <label class="tiny muted" title="Follow-up automático: mover um card PRA esta coluna cria tarefa (em N dias) pra quem moveu — 0 = não cria" style="display:flex;align-items:center;gap:2px">🔁<input class="input cg-fup" type="number" min="0" max="60" value="${c.followup_dias ?? 0}" style="width:50px;padding:3px 5px">d</label>
    ${!FIXAS.includes(c.id) ? '<button class="btn btn-ghost btn-sm cg-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>' : '<span style="width:30px" class="tiny muted" title="coluna estrutural (as automações da nota usam)">🔒</span>'}
  </div>`;
  const tagRow = t => `<div class="flex" style="gap:5px;margin-top:4px" data-cfgtag="${esc(t.id)}">
    <input class="input tg-nome" value="${esc(t.nome)}" style="flex:1;padding:3px 8px">
    <input class="input tg-cor" type="color" value="${esc(t.cor)}" style="width:44px;padding:1px">
    <button class="btn btn-ghost btn-sm tg-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>
  </div>`;
  const ov = overlay(`
    <div class="flex items-center"><h3 class="card-title" style="margin:0;flex:1">⚙️ Editar quadro</h3><button class="btn btn-ghost btn-sm" id="cg-x">✕</button></div>
    <div class="tiny mt-2" style="font-weight:800">Colunas <span class="muted" style="font-weight:400">(🔒 estruturais ficam — as automações da nota usam)</span></div>
    <div id="cg-cols">${(cfg.colunas || []).map(colRow).join('')}</div>
    <button class="btn btn-ghost btn-sm mt-1" id="cg-addcol" type="button">+ coluna</button>
    <div class="tiny mt-2" style="font-weight:800">Etiquetas</div>
    <div id="cg-tags">${(cfg.etiquetas || []).map(tagRow).join('')}</div>
    <button class="btn btn-ghost btn-sm mt-1" id="cg-addtag" type="button">+ etiqueta</button>
    <div class="tiny mt-2" style="font-weight:800">🔄 Sincronização</div>
    <label class="tiny" style="display:block;margin-top:4px">Janela de visitas: últimos <input class="input" id="cg-janela" type="number" min="7" max="365" value="${cfg.janela_dias ?? 60}" style="width:70px;padding:2px 6px"> dias</label>
    <div class="flex mt-3" style="gap:6px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="cg-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="cg-save">💾 Salvar quadro</button>
    </div>`);
  const wireDel = () => ov.querySelectorAll('.cg-del, .tg-del').forEach(b => b.onclick = () => b.parentElement.remove());
  const wireMove = () => ov.querySelectorAll('.cg-up, .cg-dn').forEach(b => b.onclick = () => {
    const row = b.closest('[data-cfgcol]');
    if (b.classList.contains('cg-up')) row.previousElementSibling?.before(row);
    else row.nextElementSibling?.after(row);
  });
  wireDel(); wireMove();
  ov.querySelector('#cg-addcol').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = colRow({ id: '', emoji: '📌', nome: '', cor: '#64748b' });
    ov.querySelector('#cg-cols').appendChild(d.firstElementChild); wireDel(); wireMove();
  };
  ov.querySelector('#cg-addtag').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = tagRow({ id: '', nome: '', cor: '#64748b' });
    ov.querySelector('#cg-tags').appendChild(d.firstElementChild); wireDel();
  };
  ov.querySelector('#cg-x').onclick = () => ov.remove();
  ov.querySelector('#cg-cancel').onclick = () => ov.remove();
  ov.querySelector('#cg-save').onclick = async () => {
    const colunas = [...ov.querySelectorAll('[data-cfgcol]')].map(r => ({
      id: r.dataset.cfgcol, emoji: r.querySelector('.cg-emoji').value.trim(),
      nome: r.querySelector('.cg-nome').value.trim(), cor: r.querySelector('.cg-cor').value,
      followup_dias: Number(r.querySelector('.cg-fup')?.value) || 0,
    })).filter(c => c.nome);
    const etiquetas = [...ov.querySelectorAll('[data-cfgtag]')].map(r => ({
      id: r.dataset.cfgtag, nome: r.querySelector('.tg-nome').value.trim(), cor: r.querySelector('.tg-cor').value,
    })).filter(t => t.nome);
    const r = await post({ action: 'set_cfg', colunas, etiquetas,
                           janela_dias: Number(ov.querySelector('#cg-janela').value) || 60 }, '⚙️ Quadro atualizado.');
    if (r) { ov.remove(); reload(); }
  };
}
