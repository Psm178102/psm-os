/* PSM-OS v2 — 📋 Kanban de Abordagem (v84.25) · aba da Indicação Premiada
   Cards automáticos do RD CRM (3 bases) + drag&drop, etiquetas, obs, objetivo,
   valores, tarefa com hora (vira evento na Agenda), descarte com motivo e
   "🎁 virou indicação" (cria a ficha no funil). Backend: producao/indicacao_kanban */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _host = null, _d = null, _busy = false, _fBase = '', _busca = '', _showMax = {}, _fHoje = false;

const hojeStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const filaStatus = c => { // 'atrasada' | 'hoje' | null
  const t = c.tarefa || {};
  if (!t.auto || !t.data) return null;
  return String(t.data) < hojeStr() ? 'atrasada' : String(t.data) === hojeStr() ? 'hoje' : null;
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BASES = {
  fechou_12m: ['🏆 Fechou 12m', '#16a34a'], visita_60d: ['👣 Visita 60d', '#d97706'],
  carteira_map: ['🗂 Carteira MAP', '#2563eb'], manual: ['✍️ Manual', '#64748b'],
};
const OBJ = { venda: '🏠 Venda', captacao: '📷 Captação', locacao: '🔑 Locação' };
const MOTIVOS = ['duplicado', 'não quis indicar', 'não responde'];

export async function kanbanAba(host) { _host = host; await reload(); }

async function reload() {
  if (!_host) return;
  _host.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando o quadro…</div></div>';
  try {
    _d = await api.request('/api/v3/producao/indicacao_kanban');
  } catch (e) {
    _host.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div>
      <div class="tiny muted mt-1">Se for a 1ª vez: a tabela "indicacao_kanban" precisa da migração no Supabase.</div></div>`;
    return;
  }
  render();
}

async function post(body, okMsg) {
  if (_busy) return null;
  _busy = true;
  let r = null;
  try {
    r = await api.request('/api/v3/producao/indicacao_kanban', { method: 'POST', body });
    if (okMsg) alert(okMsg);
  } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  _busy = false;
  return r;
}

function tagInfo(id) {
  return (_d.cfg.etiquetas || []).find(t => t.id === id) || { id, nome: id, cor: '#64748b' };
}

function cardHtml(c) {
  const [bLbl, bCor] = BASES[c.base] || BASES.manual;
  const fone = (c.contato || '').replace(/\D/g, '');
  const fs = filaStatus(c);
  const borda = fs === 'atrasada' ? 'border:2px solid #dc2626' : fs === 'hoje' ? 'border:2px solid #2563eb' : 'border:1px solid var(--bd,#e2e8f0)';
  return `<div class="ik-card" draggable="true" data-id="${esc(c.id)}"
    style="background:var(--bg-2);${borda};border-radius:10px;padding:8px 10px;margin-bottom:6px;cursor:grab">
    ${fs ? `<div class="tiny" style="font-weight:900;color:${fs === 'atrasada' ? '#dc2626' : '#2563eb'};margin-bottom:2px">${fs === 'atrasada' ? '⏰ ATRASADA' : '📅 FILA DE HOJE'}${c.tarefa?.titulo ? ' · ' + esc(c.tarefa.titulo.replace(/^[^ ]+ /, '')) : ''}</div>` : ''}
    <div class="flex items-center" style="gap:6px">
      <b style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nome)}</b>
      ${fone ? `<a class="tiny" href="https://wa.me/55${esc(fone)}" target="_blank" rel="noopener" title="Abrir WhatsApp" onclick="event.stopPropagation()">💬</a>` : ''}
    </div>
    <div class="flex" style="gap:4px;flex-wrap:wrap;margin-top:3px">
      <span class="tiny" style="background:${bCor}1a;color:${bCor};padding:0 7px;border-radius:999px;font-weight:700">${bLbl}</span>
      ${(c.etiquetas || []).map(t => { const i = tagInfo(t); return `<span class="tiny" style="background:${i.cor}1a;color:${i.cor};padding:0 7px;border-radius:999px;font-weight:700">${esc(i.nome)}</span>`; }).join('')}
      ${c.objetivo ? `<span class="tiny" style="padding:0 4px">${OBJ[c.objetivo] || esc(c.objetivo)}</span>` : ''}
    </div>
    ${c.valor_indicacao || c.premio ? `<div class="tiny" style="margin-top:2px;color:#d97706;font-weight:700">${c.valor_indicacao ? '💼 ' + brl(c.valor_indicacao) : ''}${c.valor_indicacao && c.premio ? ' · ' : ''}${c.premio ? '🎁 ' + brl(c.premio) : ''}</div>` : ''}
    ${c.tarefa?.data ? `<div class="tiny" style="margin-top:2px;color:#2563eb;font-weight:700">📅 ${esc(String(c.tarefa.data).split('-').reverse().join('/'))}${c.tarefa.hora_ini ? ' ' + esc(c.tarefa.hora_ini) : ''}${c.tarefa.hora_fim ? '–' + esc(c.tarefa.hora_fim) : ''}</div>` : ''}
    ${c.descarte_motivo ? `<div class="tiny muted" style="margin-top:2px">🗑 ${esc(c.descarte_motivo)}</div>` : ''}
    ${c.obs ? `<div class="tiny muted" style="margin-top:2px;max-height:30px;overflow:hidden">${esc(c.obs)}</div>` : ''}
    <div class="tiny muted" style="margin-top:2px">➕ ${esc(String(c.criado_em || '').substring(0, 10).split('-').reverse().join('/'))}</div>
  </div>`;
}

function render() {
  const cfg = _d.cfg || { colunas: [], etiquetas: [] };
  let cards = _d.cards || [];
  const nFila = cards.filter(filaStatus).length;
  if (_fHoje) cards = cards.filter(filaStatus);
  if (_fBase) cards = cards.filter(c => c.base === _fBase);
  if (_busca) { const q = _busca.toLowerCase(); cards = cards.filter(c => (c.nome || '').toLowerCase().includes(q) || (c.contato || '').includes(q)); }
  const porCol = {};
  cards.forEach(c => { (porCol[c.coluna] = porCol[c.coluna] || []).push(c); });
  const peso = c => filaStatus(c) === 'atrasada' ? 0 : filaStatus(c) === 'hoje' ? 1 : 2;
  Object.values(porCol).forEach(l => l.sort((a, b) => peso(a) - peso(b)));

  _host.innerHTML = `
    <div class="card" style="padding:10px 12px">
      <div class="flex items-center" style="gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${_fHoje ? 'btn-primary' : 'btn-ghost'}" id="ik-hoje" style="font-weight:800" title="Só os cards da fila do dia (cadência automática)">📅 Fila de hoje (${nFila})</button>
        <button class="btn btn-ghost btn-sm" id="ik-gerar" title="Monta a fila do dia agora (o cron faz isso sozinho às 9h)">▶️ Gerar fila</button>
        <button class="btn btn-ghost btn-sm" id="ik-sync" title="Puxa do RD: Carteira MAP + visitas 60d + fechados 12m">🔄 Sincronizar bases</button>
        <button class="btn btn-ghost btn-sm" id="ik-novo">➕ Card manual</button>
        <input class="input" id="ik-busca" placeholder="🔎 nome ou fone" value="${esc(_busca)}" style="width:150px;padding:4px 9px">
        <span style="margin-left:auto"></span>
        ${['', ...Object.keys(BASES)].map(b => `<button class="btn btn-sm ${_fBase === b ? 'btn-primary' : 'btn-ghost'} ik-fb" data-b="${b}" style="padding:2px 8px;font-size:11px">${b ? BASES[b][0] : 'Todas'} (${b ? (_d.cards || []).filter(c => c.base === b).length : (_d.cards || []).length})</button>`).join('')}
        ${_d.can_cfg ? '<button class="btn btn-ghost btn-sm" id="ik-cfg" title="Editar colunas, etiquetas e cadência">⚙️</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="ik-reload">↻</button>
      </div>
    </div>
    <div class="mt-2" style="display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:8px">
      ${(cfg.colunas || []).map(col => {
        const lista = porCol[col.id] || [];
        const max = _showMax[col.id] || 40;
        return `<div class="ik-col" data-col="${esc(col.id)}"
          style="flex:0 0 268px;background:var(--bg-3);border-radius:12px;padding:8px;border-top:3px solid ${esc(col.cor)}">
          <div class="flex items-center" style="gap:6px;padding:0 2px 6px">
            <b class="tiny">${esc(col.emoji)} ${esc(col.nome)}</b>
            <span class="tiny muted" style="margin-left:auto;font-weight:800">${lista.length}</span>
          </div>
          <div style="max-height:62vh;overflow-y:auto">
            ${lista.slice(0, max).map(cardHtml).join('') || '<div class="tiny muted" style="text-align:center;padding:14px 0">vazio</div>'}
            ${lista.length > max ? `<button class="btn btn-ghost btn-sm ik-mais" data-col="${esc(col.id)}" style="width:100%">↓ mostrar +40 (${lista.length - max} restantes)</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  wire();
}

function wire() {
  const $ = s => _host.querySelector(s);
  $('#ik-reload').onclick = reload;
  $('#ik-hoje').onclick = () => { _fHoje = !_fHoje; render(); };
  $('#ik-gerar').onclick = async () => {
    const r = await post({ action: 'gerar_fila', force: true });
    if (r && r.ok !== false) alert(`📋 Fila do dia: ${r.total ?? 0} contato(s)\n⏰ ${r.atrasadas || 0} atrasada(s) · 🔁 ${r.followups || 0} follow-up(s) · 🤝 ${r.cobrancas || 0} cobrança(s) · 📞 ${r.novas || 0} nova(s)`);
    else if (r) alert('Cadência desligada na config (⚙️).');
    reload();
  };
  $('#ik-sync').onclick = async () => {
    $('#ik-sync').disabled = true; $('#ik-sync').textContent = '⏳ Sincronizando…';
    const r = await post({ action: 'sincronizar' });
    if (r) alert(`🔄 Sincronizado: ${r.criadas} card(s) novo(s)\n🏆 Fechou 12m: ${r.por_base.fechou_12m} · 👣 Visita 60d: ${r.por_base.visita_60d} · 🗂 Carteira MAP: ${r.por_base.carteira_map}`);
    reload();
  };
  $('#ik-novo').onclick = async () => {
    const nome = prompt('Nome do contato:');
    if (!nome) return;
    const fone = prompt('Telefone (só números, opcional):') || '';
    await post({ action: 'novo', nome, contato: fone });
    reload();
  };
  $('#ik-busca').oninput = e => { _busca = e.target.value; render(); };
  _host.querySelectorAll('.ik-fb').forEach(b => b.onclick = () => { _fBase = b.dataset.b; render(); });
  _host.querySelectorAll('.ik-mais').forEach(b => b.onclick = () => { _showMax[b.dataset.col] = (_showMax[b.dataset.col] || 40) + 40; render(); });
  if ($('#ik-cfg')) $('#ik-cfg').onclick = abrirCfg;

  // clicar no card = detalhes; drag & drop entre colunas
  _host.querySelectorAll('.ik-card').forEach(el => {
    el.onclick = () => abrirCard(el.dataset.id);
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; };
  });
  _host.querySelectorAll('.ik-col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.style.outline = '2px dashed #2563eb'; };
    col.ondragleave = () => { col.style.outline = ''; };
    col.ondrop = async e => {
      e.preventDefault(); col.style.outline = '';
      const id = e.dataTransfer.getData('text/plain');
      const c = (_d.cards || []).find(x => x.id === id);
      const destino = col.dataset.col;
      if (!c || c.coluna === destino) return;
      let motivo = null;
      if (destino === 'descartado') {
        motivo = await pedirMotivo();
        if (motivo === null) return; // cancelou
      }
      const r = await post({ action: 'mover', id, coluna: destino, motivo });
      if (r) {
        c.coluna = destino;
        c.descarte_motivo = destino === 'descartado' ? motivo : null;
        render();
      }
    };
  });
}

/* ── descarte com motivo ─────────────────────────────────────────────────── */
function pedirMotivo() {
  return new Promise(resolve => {
    const ov = overlay(`
      <h3 class="card-title" style="margin:0">🗑 Motivo do descarte</h3>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        ${MOTIVOS.map(m => `<button class="btn btn-ghost btn-sm ik-mot" data-m="${esc(m)}">${esc(m)}</button>`).join('')}
      </div>
      <div class="flex mt-2" style="gap:6px">
        <input class="input" id="ik-mot-outro" placeholder="Outro motivo (escreva)" style="flex:1">
        <button class="btn btn-primary btn-sm" id="ik-mot-ok">OK</button>
      </div>
      <div class="flex mt-2" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" id="ik-mot-x">Cancelar</button></div>`);
    ov.querySelectorAll('.ik-mot').forEach(b => b.onclick = () => { ov.remove(); resolve(b.dataset.m); });
    ov.querySelector('#ik-mot-ok').onclick = () => {
      const t = ov.querySelector('#ik-mot-outro').value.trim();
      if (!t) { alert('Escreva o motivo ou escolha um botão.'); return; }
      ov.remove(); resolve('outro: ' + t);
    };
    ov.querySelector('#ik-mot-x').onclick = () => { ov.remove(); resolve(null); };
  });
}

/* ── modal do card ───────────────────────────────────────────────────────── */
function overlay(inner) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  ov.innerHTML = `<div class="card" style="max-width:560px;width:100%;background:var(--bg-2);margin:auto">${inner}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}

function abrirCard(id) {
  const c = (_d.cards || []).find(x => x.id === id);
  if (!c) return;
  const lvl = auth.user()?.lvl || 0;
  const [bLbl] = BASES[c.base] || BASES.manual;
  const ov = overlay(`
    <div class="flex items-center" style="gap:8px">
      <h3 class="card-title" style="margin:0;flex:1">${esc(c.nome)}</h3>
      <span class="tiny muted">${bLbl}</span>
      <button class="btn btn-ghost btn-sm" id="ck-x">✕</button>
    </div>
    <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="ck-nome" value="${esc(c.nome)}" style="flex:2;min-width:160px" placeholder="Nome">
      <input class="input" id="ck-fone" value="${esc(c.contato || '')}" style="flex:1;min-width:130px" placeholder="Telefone">
      ${(c.contato || '').replace(/\D/g, '') ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/55${esc((c.contato || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
    </div>
    <div class="mt-2"><label class="tiny muted">🏷 Etiquetas (clique pra ligar/desligar)</label>
      <div class="flex" style="gap:5px;flex-wrap:wrap;margin-top:3px">
        ${(_d.cfg.etiquetas || []).map(t => { const on = (c.etiquetas || []).includes(t.id); return `<button class="btn btn-sm ck-tag" data-t="${esc(t.id)}" style="padding:2px 10px;font-size:11px;border-radius:999px;${on ? `background:${t.cor};color:#fff;font-weight:800` : `background:${t.cor}1a;color:${t.cor}`}">${esc(t.nome)}</button>`; }).join('')}
      </div></div>
    <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
      <select class="input" id="ck-obj" style="flex:1;min-width:130px">
        <option value="">🎯 Objetivo…</option>
        ${Object.entries(OBJ).map(([k, v]) => `<option value="${k}"${c.objetivo === k ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
      <input class="input" id="ck-valor" type="number" value="${c.valor_indicacao ?? ''}" placeholder="Valor da indicação (R$)" style="flex:1;min-width:150px" title="VGV / aluguel esperado do negócio indicado">
      <input class="input" id="ck-premio" type="number" value="${c.premio ?? ''}" placeholder="Prêmio (R$)" style="flex:1;min-width:110px">
    </div>
    <div class="mt-2"><label class="tiny muted">📝 Observações</label>
      <textarea class="input" id="ck-obs" rows="3" style="resize:vertical">${esc(c.obs || '')}</textarea></div>
    <div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:8px 10px">
      <label class="tiny muted">📅 Tarefa (vai pra Agenda)${c.tarefa?.data ? ` — atual: ${esc(String(c.tarefa.data).split('-').reverse().join('/'))} ${esc(c.tarefa.hora_ini || '')}${c.tarefa.hora_fim ? '–' + esc(c.tarefa.hora_fim) : ''}` : ''}</label>
      <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:3px">
        <input class="input" id="ck-tdata" type="date" value="${esc(c.tarefa?.data || '')}" style="flex:1;min-width:130px">
        <input class="input" id="ck-tini" type="time" value="${esc(c.tarefa?.hora_ini || '')}" style="width:100px" title="Hora inicial">
        <input class="input" id="ck-tfim" type="time" value="${esc(c.tarefa?.hora_fim || '')}" style="width:100px" title="Hora final">
        <button class="btn btn-ghost btn-sm" id="ck-tarefa">📅 Agendar</button>
      </div>
    </div>
    <div class="flex mt-3" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
      ${lvl >= 7 ? '<button class="btn btn-ghost btn-sm" id="ck-del" style="color:#dc2626;margin-right:auto">🗑 Excluir card</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="ck-indicou" style="color:#16a34a;font-weight:800">🎁 Registrou indicação</button>
      <button class="btn btn-primary btn-sm" id="ck-save">💾 Salvar</button>
    </div>`);
  const tags = new Set(c.etiquetas || []);
  ov.querySelectorAll('.ck-tag').forEach(b => b.onclick = () => {
    const t = b.dataset.t, info = tagInfo(t);
    if (tags.has(t)) { tags.delete(t); b.style.cssText += `;background:${info.cor}1a;color:${info.cor};font-weight:400`; }
    else { tags.add(t); b.style.cssText += `;background:${info.cor};color:#fff;font-weight:800`; }
  });
  ov.querySelector('#ck-x').onclick = () => ov.remove();
  ov.querySelector('#ck-save').onclick = async () => {
    const g = s => ov.querySelector(s).value.trim();
    const r = await post({ action: 'editar', id: c.id, nome: g('#ck-nome'), contato: g('#ck-fone'),
                           obs: g('#ck-obs'), objetivo: g('#ck-obj') || null,
                           valor_indicacao: g('#ck-valor') || null, premio: g('#ck-premio') || null,
                           etiquetas: [...tags] });
    if (r) { ov.remove(); reload(); }
  };
  ov.querySelector('#ck-tarefa').onclick = async () => {
    const data = ov.querySelector('#ck-tdata').value;
    if (!data) { alert('Escolha a data.'); return; }
    const r = await post({ action: 'tarefa', id: c.id, data,
                           hora_ini: ov.querySelector('#ck-tini').value, hora_fim: ov.querySelector('#ck-tfim').value },
                         '📅 Tarefa criada na Agenda.');
    if (r) { ov.remove(); reload(); }
  };
  ov.querySelector('#ck-indicou').onclick = async () => {
    const nome = prompt(`${c.nome} indicou quem? (nome do indicado)`);
    if (nome === null) return;
    const fone = prompt('Telefone do indicado (opcional):') || '';
    const tipo = confirm('É indicação de VENDA? (OK = venda / Cancelar = locação)') ? 'venda' : 'locacao';
    const r = await post({ action: 'virar_indicacao', id: c.id, indicado_nome: nome, indicado_contato: fone, tipo },
                         '🎁 Indicação criada no funil! Card movido pra "Indicou".');
    if (r) { ov.remove(); reload(); }
  };
  const del = ov.querySelector('#ck-del');
  if (del) del.onclick = async () => {
    if (!confirm('Excluir este card de vez? (pro dia a dia, prefira o descarte)')) return;
    const r = await post({ action: 'excluir', id: c.id });
    if (r) { ov.remove(); reload(); }
  };
}

/* ── editor do quadro (colunas + etiquetas, lvl>=7) ──────────────────────── */
function abrirCfg() {
  const cfg = _d.cfg;
  const colRow = c => `<div class="flex" style="gap:5px;margin-top:4px" data-cfgcol="${esc(c.id)}">
    <input class="input cg-emoji" value="${esc(c.emoji)}" style="width:52px;padding:3px 7px">
    <input class="input cg-nome" value="${esc(c.nome)}" style="flex:1;padding:3px 8px">
    <input class="input cg-cor" type="color" value="${esc(c.cor)}" style="width:44px;padding:1px">
    ${!['a_abordar', 'descartado'].includes(c.id) ? '<button class="btn btn-ghost btn-sm cg-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>' : '<span style="width:30px" class="tiny muted" title="coluna estrutural">🔒</span>'}
  </div>`;
  const tagRow = t => `<div class="flex" style="gap:5px;margin-top:4px" data-cfgtag="${esc(t.id)}">
    <input class="input tg-nome" value="${esc(t.nome)}" style="flex:1;padding:3px 8px">
    <input class="input tg-cor" type="color" value="${esc(t.cor)}" style="width:44px;padding:1px">
    <button class="btn btn-ghost btn-sm tg-del" type="button" style="color:#dc2626;padding:1px 7px">×</button>
  </div>`;
  const cad = cfg.cadencia || {};
  const ov = overlay(`
    <div class="flex items-center"><h3 class="card-title" style="margin:0;flex:1">⚙️ Editar quadro</h3><button class="btn btn-ghost btn-sm" id="cg-x">✕</button></div>
    <div class="tiny mt-2" style="font-weight:800">Colunas <span class="muted" style="font-weight:400">(🔒 A abordar e Descartado ficam sempre)</span></div>
    <div id="cg-cols">${(cfg.colunas || []).map(colRow).join('')}</div>
    <button class="btn btn-ghost btn-sm mt-1" id="cg-addcol" type="button">+ coluna</button>
    <div class="tiny mt-2" style="font-weight:800">Etiquetas</div>
    <div id="cg-tags">${(cfg.etiquetas || []).map(tagRow).join('')}</div>
    <button class="btn btn-ghost btn-sm mt-1" id="cg-addtag" type="button">+ etiqueta</button>
    <div class="tiny mt-2" style="font-weight:800">📅 Cadência diária <span class="muted" style="font-weight:400">(cron 9h seg–sex: monta a fila e notifica a responsável)</span></div>
    <div class="flex mt-1" style="gap:8px;flex-wrap:wrap;align-items:center;background:var(--bg-3);border-radius:10px;padding:8px 10px">
      <label class="tiny flex gap-1" style="align-items:center;font-weight:700"><input type="checkbox" id="cd-ativa" ${cad.ativa !== false ? 'checked' : ''}> Ativa</label>
      <label class="tiny">Lote/dia <input class="input" id="cd-lote" type="number" min="1" max="500" value="${cad.lote_dia ?? 45}" style="width:70px;padding:2px 6px"></label>
      <label class="tiny">Follow-up após <input class="input" id="cd-fu" type="number" min="1" max="30" value="${cad.followup_dias ?? 3}" style="width:56px;padding:2px 6px"> dias</label>
      <label class="tiny">Cobrar "topou" após <input class="input" id="cd-tp" type="number" min="1" max="30" value="${cad.topou_dias ?? 2}" style="width:56px;padding:2px 6px"> dias</label>
    </div>
    <div class="flex mt-3" style="gap:6px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="cg-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="cg-save">💾 Salvar quadro</button>
    </div>`);
  const wireDel = () => ov.querySelectorAll('.cg-del, .tg-del').forEach(b => b.onclick = () => b.parentElement.remove());
  wireDel();
  ov.querySelector('#cg-addcol').onclick = () => {
    const d = document.createElement('div');
    d.innerHTML = colRow({ id: '', emoji: '📌', nome: '', cor: '#64748b' });
    ov.querySelector('#cg-cols').appendChild(d.firstElementChild); wireDel();
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
    })).filter(c => c.nome);
    const etiquetas = [...ov.querySelectorAll('[data-cfgtag]')].map(r => ({
      id: r.dataset.cfgtag, nome: r.querySelector('.tg-nome').value.trim(), cor: r.querySelector('.tg-cor').value,
    })).filter(t => t.nome);
    const cadencia = {
      ativa: ov.querySelector('#cd-ativa').checked,
      lote_dia: Number(ov.querySelector('#cd-lote').value) || 45,
      followup_dias: Number(ov.querySelector('#cd-fu').value) || 3,
      topou_dias: Number(ov.querySelector('#cd-tp').value) || 2,
    };
    const r = await post({ action: 'set_cfg', colunas, etiquetas, cadencia }, '⚙️ Quadro atualizado.');
    if (r) { ov.remove(); reload(); }
  };
}
