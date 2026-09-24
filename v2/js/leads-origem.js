/* ============================================================================
   📥 LEADS EM ANDAMENTO × ORIGEM × EQUIPE — bloco MÍNIMO de todo painel (v88.16)
   Pedido do Paulo (23/09/2026): "dentro de todo dashboard/painel de acompanhamento dos gestores e
   diretores precisamos ter clareza em tempo real, filtrando pelo mês atual e também filtro
   personalizado: quantos leads em andamento no funil do RD de cada equipe? quantos tráfego orgânico?
   carteira própria? indicação? networking? ESSE É O MÍNIMO."

   Lead em andamento = negociação do RD ainda aberta (nem ganha nem perdida) CRIADA no período.
   v88.34 (Paulo 23/09): "prospecção é a soma de todos" — visão padrão = TUDO que ENTROU no período
   (aberto, ganho ou perdido) por origem; a coluna final é a Prospecção total. "Em andamento" virou
   a segunda visão. Sem origem no RD vira cobrança com nome do corretor.
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

// visão: entradas = tudo que entrou no período (prospecção); abertos = só o que segue aberto no RD
const VISOES = {
  entradas: { por: 'por_origem', tot: 'interessados', so: 'entradas_sem_origem', totL: 'Prospecção (total)', l: 'Entraram no período' },
  abertos: { por: 'abertos_por_origem', tot: 'abertos_periodo', so: 'abertos_sem_origem', totL: 'Total em andamento', l: 'Em andamento agora' },
};
// filtro compartilhado entre os painéis da sessão (padrão: mês atual, visão entradas)
let _f = { preset: 'this_month', since: '', until: '', visao: 'entradas' };
const V = () => VISOES[_f.visao] || VISOES.entradas;

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function qs() {
  if (_f.preset === 'custom' && _f.since && _f.until) return `since=${_f.since}&until=${_f.until}`;
  return `preset=${_f.preset}`;
}
const soma = (por, cats) => cats.reduce((a, c) => a + ((por || {})[c] || 0), 0);

function linha(label, b, cls = '') {
  const v = V(), por = b?.[v.por] || {};
  return `<tr class="${cls}"><td>${label}</td>${COLS.map(c => `<td class="${c.min ? 'min' : ''}">${fN(soma(por, c.cats))}</td>`).join('')}<td class="tot">${fN(b?.[v.tot])}</td></tr>`;
}

function tabela(d, team) {
  const v = V(), eq = d.equipes || {};
  const known = TEAMS.filter(([k]) => eq[k] && (!team || k === team));
  const extras = team ? [] : Object.keys(eq).filter(k => !TEAM_LBL[k] && (eq[k][v.tot] || 0) > 0);
  let rows = known.map(([k, l]) => linha(esc(l), eq[k])).join('')
    + extras.map(k => linha(esc(k === 'sem_equipe' ? 'Sem equipe' : k.toUpperCase()), eq[k], 'sub')).join('');
  if (!known.length && !extras.length) rows = `<tr><td colspan="${COLS.length + 2}" class="muted">Nenhuma equipe no seu escopo.</td></tr>`;
  let total = '';
  if (!team && d.empresa) {
    // empresa = equipes + sem corretor (dono não cadastrado no House) + quem saiu da PSM
    const somaEq = Object.values(eq).reduce((a, b) => a + (b[v.tot] || 0), 0);
    const resto = (d.empresa[v.tot] || 0) - somaEq;
    if (resto > 0) {
      const por = {};
      for (const c of Object.keys(d.empresa[v.por] || {})) {
        por[c] = (d.empresa[v.por][c] || 0) - Object.values(eq).reduce((a, b) => a + ((b[v.por] || {})[c] || 0), 0);
      }
      rows += linha('Sem corretor no House / quem saiu', { [v.tot]: resto, [v.por]: por }, 'sub');
    }
    total = linha('TOTAL PSM', d.empresa, 'tot');
  }
  return `<div class="lo-t"><table>
    <thead><tr><th>Equipe</th>${COLS.map(c => `<th class="${c.min ? 'min' : ''}"${c.tip ? ` title="${esc(c.tip)}"` : ''}>${c.l}</th>`).join('')}<th class="tot">${v.totL}</th></tr></thead>
    <tbody>${rows}${total}</tbody></table></div>`;
}

function avisos(d, team) {
  const v = V();
  const b = team ? (d.equipes || {})[team] : (d.empresa || Object.values(d.equipes || {}).reduce((a, x) => ({
    so: a.so + (x[v.so] || 0), tot: a.tot + (x[v.tot] || 0),
    nc: a.nc + ((x[v.por] || {}).nao_classificada || 0) }), { so: 0, tot: 0, nc: 0 }));
  if (!b) return '';
  const so = b.so ?? (b[v.so] || 0);
  const tot = b.tot ?? (b[v.tot] || 0);
  const nc = b.nc ?? ((b[v.por] || {}).nao_classificada || 0);
  const out = [];
  if (so) {
    // cobrança com nome: quem tem negociação sem origem no período (pessoas já vêm recortadas pela alçada)
    const quem = Object.values(d.pessoas || {})
      .filter(p => (p[v.so] || 0) > 0 && (!team || p.team === team))
      .sort((a, c) => c[v.so] - a[v.so]).slice(0, 8)
      .map(p => `${esc(p.name || p.id)} (${fN(p[v.so])})`);
    const pct = tot ? ` — <b>${Math.round(so / tot * 100)}%</b> do total` : '';
    out.push(`⚠️ <b>${fN(so)}</b> lead(s) <b>sem "Origem do cliente" preenchida no RD</b>${pct}. Hoje contam em Lead · Tráfego Pago PSM (Dicionário §2), o que infla o pago. Preencha a origem na negociação.`
      + (quem.length ? `<br><span class="tiny">Quem precisa preencher: ${quem.join(' · ')}</span>` : ''));
  }
  if (nc) out.push(`⚠️ <b>${fN(nc)}</b> lead(s) com origem que ainda não está no Dicionário — estão em "Outros".`);
  return out.length ? `<div class="alert alert-warn lo-av">${out.join('<br>')}</div>` : '';
}

export async function montarLeadsOrigem(el, opts = {}) {
  if (!el) return;
  if ((auth.user()?.lvl || 0) < 5) { el.innerHTML = ''; return; }   // corretor não vê equipe (alçada §4)
  css();
  const team = opts.team || '';
  const titulo = opts.titulo || '📥 Leads do RD — por equipe e origem';
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
      <select class="select lo-visao" title="Entraram = tudo que foi criado no RD no período (aberto, ganho ou perdido). Em andamento = só o que ainda está aberto.">
        <option value="entradas">${VISOES.entradas.l}</option><option value="abertos">${VISOES.abertos.l}</option>
      </select>
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
    <div class="tiny muted" style="margin-top:6px">Entraram no período = toda negociação criada no RD no período (aberta, ganha ou perdida); a Prospecção é a soma de todas as origens. Em andamento = só as que seguem abertas. Origem = campo "Origem do cliente" da negociação no RD (vazio → campo Fonte). Atualiza sozinho a cada 5 min.</div>
  </div>`;

  const q = s => el.querySelector(s);
  const showDates = () => { const c = q('.lo-preset').value === 'custom'; q('.lo-since').style.display = q('.lo-until').style.display = q('.lo-apl').style.display = c ? '' : 'none'; };
  q('.lo-preset').value = _f.preset;
  q('.lo-visao').value = _f.visao;
  q('.lo-visao').onchange = ev => { _f.visao = ev.target.value; load(); };
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
