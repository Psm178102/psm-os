/* PSM-OS v2 — 💰 Radar de Recebíveis (aba da Estratégia). v84.83
   Visibilidade do que trava cada comissão: esteira pós-venda, bloqueios,
   botões de 1 clique e alertas. Volume pequeno (20–40/mês) → lista simples. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const dBR = s => (s || '').slice(0, 10).split('-').reverse().join('/');

const MARCOS = ['ganho', 'dossie_correspondente', 'credito_aprovado', 'contrato_assinado', 'nota_solicitada', 'comissao_liberada', 'recebido'];
const MARCO_LBL = { ganho: '🏁 Ganho', dossie_correspondente: '📂 Dossiê', credito_aprovado: '🏦 Crédito', contrato_assinado: '✍️ Assinado', nota_solicitada: '🧾 Nota', comissao_liberada: '💸 Liberada', recebido: '✅ Recebido' };
const BLOQ_LBL = { nenhum: '—', nota_fiscal: '🧾 Nota fiscal', assinatura_financiamento: '✍️ Assinatura financ.', liberacao_incorporadora: '🏗 Liberação incorp.', outro: '⚠️ Outro' };
const ST_COR = { previsto: '#64748b', travado: '#dc2626', confirmado: '#16a34a', recebido: '#0891b2', perdido: '#94a3b8' };
const FRENTES = ['conquista', 'map', 'terceiros', 'locacao'];

let _c = null, _d = null, _users = [], _edit = null;

export async function renderRecebiveis(container) {
  _c = container;
  _c.innerHTML = '<div class="card"><span class="spinner"></span> Carregando radar…</div>';
  try {
    const [r, ul] = await Promise.all([
      api.request('/api/v3/diretoria/recebiveis'),
      api.request('/api/v3/users/list').catch(() => ({ users: [] })),
    ]);
    _d = r; _users = ul.users || [];
  } catch (e) {
    _c.innerHTML = `<div class="alert alert-err">Erro: ${esc(e.message || e)}</div>`;
    return;
  }
  draw();
}

const nome = id => (_users.find(u => u.id === id) || {}).name || (id || '—');
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

function diasAte(r) {
  if (!r.data_prevista) return null;
  return Math.round((new Date(r.data_prevista + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5);
}

function draw() {
  if (_d.migracao_pendente) {
    _c.innerHTML = '<div class="alert alert-warn">⏳ Rode <code>db_migrations_recebiveis_v84_83.sql</code> no Supabase pra ativar o radar.</div>';
    return;
  }
  const k = _d.kpis || {};
  const itens = (_d.itens || []).filter(r => r.status !== 'perdido');
  const ativos = itens.filter(r => r.status !== 'recebido');
  const recebidos = itens.filter(r => r.status === 'recebido');
  const travBreak = Object.entries(k.travado || {}).map(([b, v]) => `${BLOQ_LBL[b] || b} ${brl(v)}`).join(' · ');

  const kpi = (lbl, val, cor, sub) => `<div style="flex:1;min-width:190px;background:${cor}12;border-left:4px solid ${cor};border-radius:10px;padding:12px 14px">
    <div class="tiny muted" style="font-weight:700">${lbl}</div>
    <div style="font-size:22px;font-weight:800;color:${cor}">${val}</div>
    ${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;

  _c.innerHTML = `
    <div class="flex" style="gap:10px;flex-wrap:wrap">
      ${kpi('✅ Confirmado · próximos 7 dias', brl(k.confirmado_7d), '#16a34a')}
      ${kpi('⛔ Travado', brl(k.travado_total), '#dc2626', travBreak || 'nenhum bloqueio')}
      ${kpi('📅 Previsto no mês', brl(k.previsto_mes), '#2563eb', `recebido: ${brl(k.recebido_mes)}`)}
    </div>
    <div class="card mt-2">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <b>💰 Recebíveis</b><span class="tiny muted">${ativos.length} ativo(s) · deal ganho no CRM entra sozinho</span>
        ${_d.completo ? '<button class="btn btn-primary btn-sm" id="rc-novo" style="margin-left:auto">+ novo recebível</button>' : ''}
      </div>
      <div id="rc-lista" class="mt-2">${ativos.map(linha).join('') || '<div class="tiny muted">Nenhum recebível ativo.</div>'}</div>
      ${recebidos.length ? `<details class="mt-2"><summary class="tiny muted" style="cursor:pointer">✅ Recebidos (${recebidos.length})</summary>${recebidos.map(linha).join('')}</details>` : ''}
    </div>
    <div id="rc-editor"></div>`;

  if (_c.querySelector('#rc-novo')) _c.querySelector('#rc-novo').onclick = () => abrirEditor(null);
  wire();
}

function linha(r) {
  const dd = diasAte(r);
  const vencido = dd !== null && dd < 0 && r.status !== 'recebido';
  const cor = vencido ? '#dc2626' : (ST_COR[r.status] || '#64748b');
  const mi = MARCOS.indexOf(r.marco_atual || 'ganho');
  const esteira = MARCOS.map((m, i) => `<span title="${MARCO_LBL[m]}" style="width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:2px;background:${i <= mi ? '#16a34a' : 'var(--border-2,#dacfa9)'}"></span>`).join('');
  const prem = r.premiacao && (r.premiacao.detalhe || r.premiacao.valor)
    ? `<span class="tiny" style="background:#7c3aed18;color:#7c3aed;border-radius:12px;padding:1px 8px">🎁 ${r.premiacao.tipo === 'percentual' ? (r.premiacao.valor || 0) + '%' : r.premiacao.tipo === 'valor' ? brl(r.premiacao.valor) : esc(r.premiacao.detalhe || 'produto')}</span>` : '';
  return `<div data-rc="${esc(r.id)}" style="border-left:4px solid ${cor};background:${vencido ? '#dc262608' : 'var(--bg-2,#fff)'};border-radius:10px;padding:10px 12px;margin-top:8px">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b style="font-size:14px">${esc(r.descricao)}</b>
      <span class="tiny" style="color:${ST_COR[r.status]};font-weight:800">● ${r.status}</span>
      ${(r.bloqueio || 'nenhum') !== 'nenhum' ? `<span class="tiny" style="background:#dc262615;color:#dc2626;border-radius:12px;padding:1px 9px;font-weight:800">⛔ ${BLOQ_LBL[r.bloqueio] || r.bloqueio}${r.bloqueio_obs ? ' · ' + esc(r.bloqueio_obs) : ''}</span>` : ''}
      ${prem}
      <span style="margin-left:auto;font-weight:800;color:${cor}">${r.valor_liquido_estimado != null ? brl(r.valor_liquido_estimado) : '💬 valor a definir'}</span>
    </div>
    <div class="flex items-center tiny muted" style="gap:10px;flex-wrap:wrap;margin-top:4px">
      <span>${esteira} ${MARCO_LBL[r.marco_atual] || r.marco_atual}</span>
      <span>🏢 ${esc(r.pagador || '—')}</span>
      <span>🏷 ${esc(r.frente)}</span>
      <span>👤 ${esc(nome(r.dono_cobranca))}</span>
      ${r.corretor_id ? `<span>🤝 ${esc(nome(r.corretor_id))}</span>` : ''}
      <span style="font-weight:700;color:${vencido ? '#dc2626' : 'inherit'}">${r.data_prevista ? '📅 ' + dBR(r.data_prevista) + (dd !== null ? (dd >= 0 ? ` (em ${dd}d)` : ` (⚠️ há ${-dd}d)`) : '') : '📅 sem data'}</span>
    </div>
    ${r.status !== 'recebido' ? `<div class="flex" style="gap:5px;flex-wrap:wrap;margin-top:7px">
      <button class="btn btn-ghost btn-sm rc-a" data-a="marco" data-v="nota_solicitada">🧾 nota solicitada</button>
      <button class="btn btn-ghost btn-sm rc-a" data-a="marco" data-v="contrato_assinado">✍️ assinatura ok</button>
      <button class="btn btn-ghost btn-sm rc-a" data-a="status" data-v="confirmado" style="color:#16a34a">✅ confirmado</button>
      <button class="btn btn-ghost btn-sm rc-a" data-a="status" data-v="recebido" style="color:#0891b2;font-weight:800">💰 recebido</button>
      <button class="btn btn-ghost btn-sm rc-a" data-a="travar" style="color:#dc2626">⛔ travou…</button>
      ${_d.completo ? `<button class="btn btn-ghost btn-sm rc-a" data-a="editar" style="margin-left:auto">✏️</button>` : ''}
    </div>` : ''}
  </div>`;
}

function wire() {
  _c.querySelectorAll('.rc-a').forEach(b => b.onclick = async () => {
    const id = b.closest('[data-rc]').dataset.rc;
    const a = b.dataset.a;
    if (a === 'editar') { abrirEditor((_d.itens || []).find(x => x.id === id)); return; }
    if (a === 'travar') {
      const opts = 'nota_fiscal | assinatura_financiamento | liberacao_incorporadora | outro';
      const bq = prompt('Qual o bloqueio?\n' + opts, 'nota_fiscal');
      if (!bq) return;
      const obs = prompt('Detalhe do bloqueio (opcional):') || '';
      await chama({ action: 'bloqueio', id, bloqueio: bq.trim(), obs });
      return;
    }
    await chama({ action: a, id, [a === 'marco' ? 'marco' : 'status']: b.dataset.v });
  });
}

async function chama(body) {
  try {
    await api.request('/api/v3/diretoria/recebiveis', { method: 'POST', body });
    await renderRecebiveis(_c);
  } catch (e) { alert('❌ ' + (e.message || e)); }
}

function abrirEditor(r) {
  _edit = r;
  const box = _c.querySelector('#rc-editor');
  const f = r || {}; const p = f.premiacao || {};
  const userOpts = sel => ['<option value="">—</option>', ..._users.filter(u => (u.status || 'ativo') === 'ativo')
    .map(u => `<option value="${esc(u.id)}"${sel === u.id ? ' selected' : ''}>${esc(u.name)}</option>`)].join('');
  box.innerHTML = `<div class="card mt-2" style="border-left:4px solid var(--psm-navy,#1e2650)">
    <b>${r ? '✏️ Editar' : '➕ Novo'} recebível</b>
    <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="rc-desc" placeholder="Descrição *" value="${esc(f.descricao || '')}" style="flex:2;min-width:220px">
      <select class="input" id="rc-frente" style="width:130px">${FRENTES.map(x => `<option${f.frente === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <input class="input" id="rc-pagador" placeholder="Pagador / incorporadora" value="${esc(f.pagador || '')}" style="flex:1;min-width:160px">
    </div>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <label class="tiny muted">VGV bruto<input class="input" id="rc-bruto" type="number" step="0.01" value="${f.valor_bruto ?? ''}" style="width:130px"></label>
      <label class="tiny muted">💰 Comissão (R$) — o valor que VOCÊ define<input class="input" id="rc-liq" type="number" step="0.01" value="${f.valor_liquido_estimado ?? ''}" style="width:160px"></label>
      <label class="tiny muted">Data prevista<input class="input" id="rc-data" type="date" value="${esc((f.data_prevista || '').slice(0, 10))}" style="width:150px"></label>
      <label class="tiny muted">Dono da cobrança<select class="input" id="rc-dono" style="min-width:150px">${userOpts(f.dono_cobranca)}</select></label>
      <label class="tiny muted">Corretor<select class="input" id="rc-corr" style="min-width:150px">${userOpts(f.corretor_id)}</select></label>
    </div>
    <div class="mt-2" style="background:#7c3aed0d;border-radius:8px;padding:8px 10px">
      <b class="tiny">🎁 Premiação (personalizável)</b>
      <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
        <select class="input" id="rc-prem-tipo" style="width:130px">
          <option value="">sem prêmio</option>
          <option value="valor"${p.tipo === 'valor' ? ' selected' : ''}>💵 Valor fixo</option>
          <option value="percentual"${p.tipo === 'percentual' ? ' selected' : ''}>％ Percentual</option>
          <option value="produto"${p.tipo === 'produto' ? ' selected' : ''}>🎁 Produto</option>
        </select>
        <input class="input" id="rc-prem-valor" type="number" step="0.01" placeholder="valor / %" value="${p.valor ?? ''}" style="width:120px">
        <input class="input" id="rc-prem-det" placeholder="detalhe (ex.: iPhone, viagem, 0,5% do VGV…)" value="${esc(p.detalhe || '')}" style="flex:1;min-width:180px">
      </div>
    </div>
    <textarea class="input mt-2" id="rc-notas" rows="2" placeholder="Notas">${esc(f.notas || '')}</textarea>
    <div class="flex mt-2" style="gap:8px">
      ${r && (auth.user()?.lvl || 0) >= 8 ? '<button class="btn btn-ghost btn-sm" id="rc-del" style="color:#dc2626">🗑 Apagar</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="rc-cancel" style="margin-left:auto">Cancelar</button>
      <button class="btn btn-primary" id="rc-save">💾 Salvar</button>
    </div>
  </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const $ = s => box.querySelector(s);
  $('#rc-cancel').onclick = () => { box.innerHTML = ''; };
  if ($('#rc-del')) $('#rc-del').onclick = async () => {
    if (!confirm('Apagar este recebível?')) return;
    await chama({ action: 'delete', id: r.id });
  };
  $('#rc-save').onclick = async () => {
    const body = {
      action: 'upsert', id: r ? r.id : undefined,
      descricao: $('#rc-desc').value.trim(), frente: $('#rc-frente').value,
      pagador: $('#rc-pagador').value.trim(),
      valor_bruto: $('#rc-bruto').value || null,
      valor_liquido_estimado: $('#rc-liq').value || null,
      data_prevista: $('#rc-data').value || null,
      dono_cobranca: $('#rc-dono').value || null, corretor_id: $('#rc-corr').value || null,
      notas: $('#rc-notas').value.trim(),
      premiacao: { tipo: $('#rc-prem-tipo').value || null, valor: $('#rc-prem-valor').value || null, detalhe: $('#rc-prem-det').value.trim() },
    };
    if (!body.descricao) { alert('Descrição obrigatória.'); return; }
    await chama(body);
  };
}
