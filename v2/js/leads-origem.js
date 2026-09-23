/* ============================================================================
   📥 LEADS EM ANDAMENTO × ORIGEM × EQUIPE — bloco MÍNIMO de todo painel (v88.16)
   Pedido do Paulo (23/09/2026): "dentro de todo dashboard/painel de acompanhamento dos gestores e
   diretores precisamos ter clareza em tempo real, filtrando pelo mês atual e também filtro
   personalizado: quantos leads em andamento no funil do RD de cada equipe? quantos tráfego orgânico?
   carteira própria? indicação? networking? ESSE É O MÍNIMO."

   Lead em andamento = negociação do RD ainda aberta (nem ganha nem perdida) CRIADA no período.
   Origem = campo de origem da própria negociação no RD (mesma regra p/ MAP, Locação, Terceiros e
   Conquista), classificada pelo Dicionário §2. Fonte: /api/v3/metricas/resumo (_metricas_lib.py) —
   mesmo retrato de todas as telas; o filtro escolhido vale para todos os painéis da sessão.

   Uso:  montarLeadsOrigem(el, { team: 'map', titulo: '…' })   (team opcional: só aquela linha)
============================================================================ */
import { api } from './api.js';
import { auth } from './auth.js';

const CSS = `
.lo{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md,12px);padding:14px 16px;margin:0 0 14px}
.lo-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.lo-h h3{margin:0;font-size:16px;font-weight:900;letter-spacing:-.01em}
.lo-h .tiny{margin-left:auto}
.lo-f{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
.lo-f .select,.lo-f .input{width:auto;padding:4px 8px;font-size:12px}
.lo-t{overflow-x:auto;margin-top:10px}
.lo-t table{width:100%;border-collapse:collapse;font-size:13px}
.lo-t th,.lo-t td{padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border)}
.lo-t th:first-child,.lo-t td:first-child{text-align:left}
.lo-t th{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--ink-muted)}
.lo-t th.min{color:var(--ink,inherit)}
.lo-t td.min{font-weight:800}
.lo-t td.tot,.lo-t th.tot{font-weight:900}
.lo-t tr.tot td{font-weight:900;border-top:2px solid var(--border);border-bottom:0}
.lo-t tr.sub td{color:var(--ink-muted);font-size:12px}
.lo-av{margin-top:8px;font-size:12px}
`;
function css() {
  if (document.getElementById('lo-css')) return;
  const s = document.createElement('style'); s.id = 'lo-css'; s.textContent = CSS; document.head.appendChild(s);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = n => Number(n || 0).toLocaleString('pt-BR');

// As 4 origens pedidas pelo Paulo vêm primeiro; o resto aparece para o total bater com o RD.
const COLS = [
  { k: 'organico', l: 'Tráfego Orgânico', cats: ['organico_site'], min: true },
  { k: 'carteira', l: 'Carteira Própria', cats: ['carteira'], min: true },
  { k: 'indicacao', l: 'Indicação', cats: ['indicacao'], min: true },
  { k: 'networking', l: 'Networking', cats: ['networking'], min: true },
  { k: 'pago_psm', l: 'Lead · Tráfego Pago PSM', cats: ['trafego_pago_psm'], tip: 'Instagram/Facebook/Google Ads da PSM — inclui os sem origem no RD (Dicionário §2)' },
  { k: 'pago_cor', l: 'Lead · Tráfego Pago Corretor', cats: ['trafego_pago_corretor'], tip: 'anúncio pago do próprio corretor' },
  { k: 'outros', l: 'Outros', cats: ['reativacao', 'nao_classificada'], tip: 'Reativação/lista + origem ainda fora do Dicionário' },
];
const TEAMS = [['map', 'MAP'], ['locacao', 'LOCAÇÃO'], ['terceiros', 'TERCEIROS'], ['conquista', 'PSM CONQUISTA']];
const TEAM_LBL = Object.fromEntries(TEAMS);
const REFRESH_MS = 5 * 60 * 1000;

// filtro compartilhado entre os painéis da sessão (padrão: mês atual)
let _f = { preset: 'this_month', since: '', until: '' };

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function qs() {
  if (_f.preset === 'custom' && _f.since && _f.until) return `since=${_f.since}&until=${_f.until}`;
  return `preset=${_f.preset}`;
}
const soma = (por, cats) => cats.reduce((a, c) => a + ((por || {})[c] || 0), 0);

function linha(label, b, cls = '') {
  const por = b?.abertos_por_origem || {};
  return `<tr class="${cls}"><td>${label}</td>${COLS.map(c => `<td class="${c.min ? 'min' : ''}">${fN(soma(por, c.cats))}</td>`).join('')}<td class="tot">${fN(b?.abertos_periodo)}</td></tr>`;
}

function tabela(d, team) {
  const eq = d.equipes || {};
  const known = TEAMS.filter(([k]) => eq[k] && (!team || k === team));
  const extras = team ? [] : Object.keys(eq).filter(k => !TEAM_LBL[k] && (eq[k].abertos_periodo || 0) > 0);
  let rows = known.map(([k, l]) => linha(esc(l), eq[k])).join('')
    + extras.map(k => linha(esc(k === 'sem_equipe' ? 'Sem equipe' : k.toUpperCase()), eq[k], 'sub')).join('');
  if (!known.length && !extras.length) rows = `<tr><td colspan="${COLS.length + 2}" class="muted">Nenhuma equipe no seu escopo.</td></tr>`;
  let total = '';
  if (!team && d.empresa) {
    // empresa = equipes + sem corretor (dono não cadastrado no House) + quem saiu da PSM
    const somaEq = Object.values(eq).reduce((a, b) => a + (b.abertos_periodo || 0), 0);
    const resto = (d.empresa.abertos_periodo || 0) - somaEq;
    if (resto > 0) {
      const por = {};
      for (const c of Object.keys(d.empresa.abertos_por_origem || {})) {
        por[c] = (d.empresa.abertos_por_origem[c] || 0) - Object.values(eq).reduce((a, b) => a + ((b.abertos_por_origem || {})[c] || 0), 0);
      }
      rows += linha('Sem corretor no House / quem saiu', { abertos_periodo: resto, abertos_por_origem: por }, 'sub');
    }
    total = linha('TOTAL PSM', d.empresa, 'tot');
  }
  return `<div class="lo-t"><table>
    <thead><tr><th>Equipe</th>${COLS.map(c => `<th class="${c.min ? 'min' : ''}"${c.tip ? ` title="${esc(c.tip)}"` : ''}>${c.l}</th>`).join('')}<th class="tot">Total em andamento</th></tr></thead>
    <tbody>${rows}${total}</tbody></table></div>`;
}

function avisos(d, team) {
  const b = team ? (d.equipes || {})[team] : (d.empresa || Object.values(d.equipes || {}).reduce((a, x) => ({
    abertos_sem_origem: a.abertos_sem_origem + (x.abertos_sem_origem || 0),
    nc: a.nc + ((x.abertos_por_origem || {}).nao_classificada || 0) }), { abertos_sem_origem: 0, nc: 0 }));
  if (!b) return '';
  const so = b.abertos_sem_origem || 0;
  const nc = b.nc ?? ((b.abertos_por_origem || {}).nao_classificada || 0);
  const out = [];
  if (so) out.push(`⚠️ <b>${fN(so)}</b> lead(s) em andamento <b>sem origem preenchida no RD</b> — contados em Lead · Tráfego Pago PSM (Dicionário §2). Preencha a origem na negociação.`);
  if (nc) out.push(`⚠️ <b>${fN(nc)}</b> lead(s) com origem que ainda não está no Dicionário — estão em "Outros".`);
  return out.length ? `<div class="alert alert-warn lo-av">${out.join('<br>')}</div>` : '';
}

export async function montarLeadsOrigem(el, opts = {}) {
  if (!el) return;
  if ((auth.user()?.lvl || 0) < 5) { el.innerHTML = ''; return; }   // corretor não vê equipe (alçada §4)
  css();
  const team = opts.team || '';
  const titulo = opts.titulo || '📥 Em andamento no funil do RD — por equipe e origem';
  const hoje = ymd(new Date());
  const ini = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  async function load(fresh) {
    const body = el.querySelector('.lo-body');
    if (!body) return;
    try {
      const d = await api.request(`/api/v3/metricas/resumo?${qs()}${fresh ? '&fresh=1' : ''}`);
      if (!el.isConnected) return;
      const j = d.janela || {};
      const br = s => s ? s.split('-').reverse().join('/') : '';
      el.querySelector('.lo-per').innerHTML = `${br(j.since)} → ${br(j.until)}${d.dados_de_hhmm ? ` · dados de <b title="último sync do RD">${esc(d.dados_de_hhmm)}</b>` : ''}`;
      body.innerHTML = tabela(d, team) + avisos(d, team);
    } catch (e) {
      if (el.isConnected) body.innerHTML = `<div class="alert alert-err tiny">Não foi possível ler os leads do RD: ${esc(e.message)}</div>`;
    }
  }

  el.innerHTML = `<div class="lo">
    <div class="lo-h"><h3>${esc(titulo)}</h3><span class="tiny muted lo-per"></span></div>
    <div class="lo-f">
      <select class="select lo-preset">
        <option value="this_month">Mês atual</option><option value="last_month">Mês passado</option>
        <option value="last_30d">Últimos 30 dias</option><option value="last_90d">Últimos 90 dias</option>
        <option value="this_year">Ano atual</option><option value="custom">Personalizado…</option>
      </select>
      <input type="date" class="input lo-since" value="${_f.since || ini}" max="${hoje}">
      <input type="date" class="input lo-until" value="${_f.until || hoje}" max="${hoje}">
      <button class="btn btn-ghost btn-sm lo-apl">Aplicar</button>
      <button class="btn btn-ghost btn-sm lo-fresh" title="sincroniza o RD agora e recalcula">🔄</button>
    </div>
    <div class="lo-body"><div class="muted tiny"><span class="spinner"></span> Lendo o funil do RD…</div></div>
    <div class="tiny muted" style="margin-top:6px">Lead em andamento = negociação aberta no RD (nem ganha nem perdida) criada no período. Origem = campo de origem da negociação no RD. Atualiza sozinho a cada 5 min.</div>
  </div>`;

  const q = s => el.querySelector(s);
  const showDates = () => { const c = q('.lo-preset').value === 'custom'; q('.lo-since').style.display = q('.lo-until').style.display = q('.lo-apl').style.display = c ? '' : 'none'; };
  q('.lo-preset').value = _f.preset;
  showDates();
  q('.lo-preset').onchange = ev => { _f.preset = ev.target.value; showDates(); if (_f.preset !== 'custom') load(); };
  q('.lo-apl').onclick = () => {
    const s = q('.lo-since').value, u = q('.lo-until').value;
    if (!s || !u || s > u) { q('.lo-body').insertAdjacentHTML('afterbegin', '<div class="alert alert-warn tiny">Escolha a data inicial antes da final.</div>'); return; }
    Object.assign(_f, { preset: 'custom', since: s, until: u });
    load();
  };
  q('.lo-fresh').onclick = async () => { try { await api.request('/api/v3/crm/sync_if_stale?hours=0'); } catch (_) {} load(true); };

  await load();
  const t = setInterval(() => { if (!el.isConnected) return clearInterval(t); if (!document.hidden) load(); }, REFRESH_MS);
}
