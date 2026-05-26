/* PSM-OS v2 — Relatórios Print/PDF (Sprint 7.27) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = {};
let _currentReport = null;

const REPORTS = [
  { id: 'vendas_mes',     lbl: '📊 Vendas do Mês',          desc: 'Deals fechados (won) + ranking' },
  { id: 'ranking_geral',  lbl: '🏆 Ranking Geral',          desc: 'Top 20 corretores por VGV' },
  { id: 'captacoes',      lbl: '📥 Captações Período',      desc: 'Imóveis captados (últimos 90d)' },
  { id: 'metas_status',   lbl: '🎯 Metas vs Atingido',      desc: 'Cobertura mensal por corretor' },
  { id: 'plantoes_mes',   lbl: '🛡 Plantões do Mês',         desc: 'Escala completa' },
  { id: 'usuarios_lista', lbl: '👥 Usuários Cadastrados',   desc: 'Lista oficial PSM' },
];

export async function pageRelatorios(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder (lvl 5+).</div>';
    return;
  }
  renderHub();
}

function renderHub() {
  _root.innerHTML = `
    <div class="card no-print">
      <h2 class="card-title">🖨 Relatórios Imprimíveis</h2>
      <p class="card-sub">Templates pre-formatados pra imprimir/exportar PDF. Use Cmd+P (Mac) ou Ctrl+P (Win) pra gerar PDF.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;margin-top:8px">
        ${REPORTS.map(r => `
          <button class="btn btn-ghost" data-report="${r.id}" style="display:flex;align-items:center;gap:8px;justify-content:flex-start;padding:14px 16px;text-align:left">
            <div style="flex:1">
              <div style="font-weight:700;font-size:13px">${r.lbl}</div>
              <div class="tiny muted">${r.desc}</div>
            </div>
            <span>📄</span>
          </button>
        `).join('')}
      </div>
    </div>
    <div id="report-out"></div>
  `;
  _root.querySelectorAll('[data-report]').forEach(b => b.addEventListener('click', () => loadReport(b.dataset.report)));
  injectPrintCSS();
}

async function loadReport(id) {
  _currentReport = id;
  const out = document.getElementById('report-out');
  out.innerHTML = '<div class="card no-print"><div class="muted"><span class="spinner"></span> Carregando…</div></div>';
  try {
    if (id === 'vendas_mes') await loadVendasMes(out);
    else if (id === 'ranking_geral') await loadRankingGeral(out);
    else if (id === 'captacoes') await loadCaptacoes(out);
    else if (id === 'metas_status') await loadMetasStatus(out);
    else if (id === 'plantoes_mes') await loadPlantoesMes(out);
    else if (id === 'usuarios_lista') await loadUsuariosLista(out);
  } catch (e) {
    out.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  }
}

function reportHeader(title, sub) {
  const now = new Date().toLocaleString('pt-BR');
  const me = auth.user();
  return `
    <div class="print-header" style="border-bottom:2px solid #0b1f3a;padding-bottom:12px;margin-bottom:18px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:28px;font-weight:900;color:#0b1f3a">PSM IMÓVEIS</div>
        <div style="flex:1;text-align:right;font-size:11px;color:#666">
          <div>📅 ${now}</div>
          <div>👤 Gerado por: ${escapeHtml(me?.name || '—')}</div>
        </div>
      </div>
      <h1 style="font-size:22px;margin:8px 0 2px;color:#0b1f3a">${escapeHtml(title)}</h1>
      <div style="font-size:12px;color:#666">${escapeHtml(sub)}</div>
    </div>
  `;
}

function reportFooter() {
  return `
    <div class="print-footer" style="margin-top:30px;border-top:1px solid #ddd;padding-top:10px;font-size:10px;color:#999;text-align:center">
      PSM-OS v75.72 · Confidencial · Uso interno PSM Imóveis · São José do Rio Preto/SP
    </div>
    <div class="no-print mt-4" style="text-align:center">
      <button class="btn btn-primary" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
    </div>
  `;
}

async function loadVendasMes(out) {
  const r = await api.request('/api/v3/metas/atingimento');
  const deals = r.deals_won || [];
  const total = deals.reduce((s,d)=>s+(+d.amount||0),0);

  out.innerHTML = `
    <div class="card print-area">
      ${reportHeader('Vendas do Mês', `${deals.length} vendas · R$ ${formatBR(total)}`)}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#0b1f3a;color:#fff">
            <th style="padding:8px;text-align:left">Corretor</th>
            <th style="padding:8px;text-align:left">Imóvel</th>
            <th style="padding:8px;text-align:right">Valor</th>
            <th style="padding:8px;text-align:center">Data</th>
          </tr>
        </thead>
        <tbody>
          ${deals.map((d,i)=>`
            <tr style="background:${i%2?'#f8fafc':'#fff'};border-bottom:1px solid #eee">
              <td style="padding:6px 8px">${escapeHtml(d.user_email || d.user_name || '—')}</td>
              <td style="padding:6px 8px">${escapeHtml((d.name||'').substring(0,60))}</td>
              <td style="padding:6px 8px;text-align:right;font-weight:700">R$ ${formatBR(+d.amount||0)}</td>
              <td style="padding:6px 8px;text-align:center">${escapeHtml((d.closed_at||'').slice(0,10))}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#0b1f3a;color:#fff;font-weight:800">
            <td colspan="2" style="padding:8px">TOTAL</td>
            <td style="padding:8px;text-align:right">R$ ${formatBR(total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      ${reportFooter()}
    </div>
  `;
}

async function loadRankingGeral(out) {
  const r = await api.request('/api/v3/ranking/list?period=mes_atual');
  const items = (r.ranking || []).slice(0, 20);
  out.innerHTML = `
    <div class="card print-area">
      ${reportHeader('Ranking Geral', `Top 20 — ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`)}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#0b1f3a;color:#fff">
            <th style="padding:8px;text-align:center;width:50px">#</th>
            <th style="padding:8px;text-align:left">Corretor</th>
            <th style="padding:8px;text-align:left">Equipe</th>
            <th style="padding:8px;text-align:right">VGV</th>
            <th style="padding:8px;text-align:center">Vendas</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((u,i)=>`
            <tr style="background:${i%2?'#f8fafc':'#fff'};border-bottom:1px solid #eee">
              <td style="padding:6px 8px;text-align:center;font-weight:800">${i<3?['🥇','🥈','🥉'][i]:(i+1)}</td>
              <td style="padding:6px 8px;font-weight:700">${escapeHtml(u.name || '—')}</td>
              <td style="padding:6px 8px">${escapeHtml(u.team || u.frente || '—')}</td>
              <td style="padding:6px 8px;text-align:right">R$ ${formatBR(+u.vgv||0)}</td>
              <td style="padding:6px 8px;text-align:center">${u.deals || 0}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${reportFooter()}
    </div>
  `;
}

async function loadCaptacoes(out) {
  const r = await api.request('/api/v3/captacoes/list?days=90');
  const items = (r.ranking || []).slice(0, 30);
  out.innerHTML = `
    <div class="card print-area">
      ${reportHeader('Captações últimos 90 dias', `${items.length} captadores ativos`)}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#0b1f3a;color:#fff">
            <th style="padding:8px;text-align:center;width:50px">#</th>
            <th style="padding:8px;text-align:left">Captador</th>
            <th style="padding:8px;text-align:center">Imóveis</th>
            <th style="padding:8px;text-align:right">Valor total</th>
            <th style="padding:8px;text-align:center">Disponíveis</th>
            <th style="padding:8px;text-align:center">Vendidos</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((u,i)=>`
            <tr style="background:${i%2?'#f8fafc':'#fff'};border-bottom:1px solid #eee">
              <td style="padding:6px 8px;text-align:center;font-weight:800">${i+1}</td>
              <td style="padding:6px 8px;font-weight:700">${escapeHtml(u.captador_name || '—')}</td>
              <td style="padding:6px 8px;text-align:center">${u.count || 0}</td>
              <td style="padding:6px 8px;text-align:right">R$ ${formatBR(+u.valor_total||0)}</td>
              <td style="padding:6px 8px;text-align:center;color:#16a34a">${u.disponiveis || 0}</td>
              <td style="padding:6px 8px;text-align:center;color:#0ea5e9">${u.vendidos || 0}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${reportFooter()}
    </div>
  `;
}

async function loadMetasStatus(out) {
  const r = await api.request('/api/v3/metas/atingimento');
  const items = r.por_corretor || [];
  out.innerHTML = `
    <div class="card print-area">
      ${reportHeader('Metas vs Atingido', `${items.length} corretores · ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`)}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#0b1f3a;color:#fff">
            <th style="padding:8px;text-align:left">Corretor</th>
            <th style="padding:8px;text-align:right">Meta VGV</th>
            <th style="padding:8px;text-align:right">Atingido</th>
            <th style="padding:8px;text-align:center">%</th>
            <th style="padding:8px;text-align:center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((u,i)=>{
            const pct = u.meta_vgv ? (u.vgv_atingido/u.meta_vgv*100) : 0;
            const status = pct>=100?'✅':pct>=80?'⚠️':pct>=50?'🟡':'🔴';
            return `
            <tr style="background:${i%2?'#f8fafc':'#fff'};border-bottom:1px solid #eee">
              <td style="padding:6px 8px;font-weight:700">${escapeHtml(u.name || '—')}</td>
              <td style="padding:6px 8px;text-align:right">R$ ${formatBR(+u.meta_vgv||0)}</td>
              <td style="padding:6px 8px;text-align:right">R$ ${formatBR(+u.vgv_atingido||0)}</td>
              <td style="padding:6px 8px;text-align:center;font-weight:800">${pct.toFixed(0)}%</td>
              <td style="padding:6px 8px;text-align:center">${status}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${reportFooter()}
    </div>
  `;
}

async function loadPlantoesMes(out) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10);
  const r = await api.request(`/api/v3/plantoes/list?start=${start}&end=${end}`);
  const items = r.plantoes || [];
  items.sort((a,b)=> (a.data||'').localeCompare(b.data||''));
  out.innerHTML = `
    <div class="card print-area">
      ${reportHeader('Plantões do Mês', `${items.length} escalas · ${now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`)}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#0b1f3a;color:#fff">
            <th style="padding:8px;text-align:center">Data</th>
            <th style="padding:8px;text-align:center">Período</th>
            <th style="padding:8px;text-align:left">Corretor</th>
            <th style="padding:8px;text-align:center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((p,i)=>`
            <tr style="background:${i%2?'#f8fafc':'#fff'};border-bottom:1px solid #eee">
              <td style="padding:6px 8px;text-align:center">${escapeHtml(p.data || '')}</td>
              <td style="padding:6px 8px;text-align:center">${escapeHtml(p.periodo || '')}</td>
              <td style="padding:6px 8px;font-weight:700">${escapeHtml(p.corretor_name || '—')}</td>
              <td style="padding:6px 8px;text-align:center">${escapeHtml(p.status || 'escalado')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${reportFooter()}
    </div>
  `;
}

async function loadUsuariosLista(out) {
  const r = await api.listUsers();
  const items = (r.users || []).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  out.innerHTML = `
    <div class="card print-area">
      ${reportHeader('Usuários PSM', `${items.length} cadastros ativos`)}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:#0b1f3a;color:#fff">
            <th style="padding:6px;text-align:left">Nome</th>
            <th style="padding:6px;text-align:left">Email</th>
            <th style="padding:6px;text-align:left">Papel</th>
            <th style="padding:6px;text-align:left">Equipe</th>
            <th style="padding:6px;text-align:center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((u,i)=>`
            <tr style="background:${i%2?'#f8fafc':'#fff'};border-bottom:1px solid #eee">
              <td style="padding:5px 6px;font-weight:700">${escapeHtml(u.name || '—')}</td>
              <td style="padding:5px 6px">${escapeHtml(u.email || '—')}</td>
              <td style="padding:5px 6px">${escapeHtml(u.role || '—')}</td>
              <td style="padding:5px 6px">${escapeHtml(u.team || u.frente || '—')}</td>
              <td style="padding:5px 6px;text-align:center">${u.status || 'ativo'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${reportFooter()}
    </div>
  `;
}

function injectPrintCSS() {
  if (document.getElementById('psm-print-css')) return;
  const style = document.createElement('style');
  style.id = 'psm-print-css';
  style.textContent = `
    @media print {
      body { background: #fff !important; color: #000 !important; }
      .app-sidebar, .app-header, .no-print { display: none !important; }
      .app-main { padding: 0 !important; margin: 0 !important; }
      .print-area { box-shadow: none !important; background: #fff !important; color: #000 !important; padding: 0 !important; }
      .print-area h1, .print-area h2, .print-area h3 { color: #0b1f3a !important; }
      .print-area table { page-break-inside: auto; }
      .print-area tr { page-break-inside: avoid; page-break-after: auto; }
      @page { margin: 1.2cm; }
    }
  `;
  document.head.appendChild(style);
}

function formatBR(n) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
