/* PSM-OS v2 — War Room (estratégico, Sócio only) (Sprint 8.5) */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';

let _root = null;
let _data = null;
let _analysis = '';
let _analyzing = false;

export async function pageWarRoom(ctx, root) {
  _root = root;
  router.onCleanup(() => { if (window._wrClockInt) { clearInterval(window._wrClockInt); window._wrClockInt = null; } });
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>';
    return;
  }
  render();
  await load();
}

async function load() {
  try {
    const [atg, users] = await Promise.all([
      api.request('/api/v3/metas/atingimento').catch(() => ({})),
      api.listUsers().catch(() => ({ users: [] })),
    ]);
    _data = { atingimento: atg, users: users.users || [] };
    renderContent();
  } catch (e) {
    document.getElementById('wr-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,#0a0f1c 0%,#1a0b2e 50%,#0f172a 100%);color:#fff;padding:0;overflow:hidden;border-radius:14px">
      <div style="padding:20px 24px;border-bottom:1px solid #334155;background:rgba(220,38,38,.15)">
        <div class="flex" style="align-items:center;gap:14px">
          <span style="font-size:40px">⚔️</span>
          <div>
            <h2 style="margin:0;font-size:24px;font-weight:900;color:#fbbf24">WAR ROOM PSM</h2>
            <p style="margin:4px 0 0;color:#cbd5e1;font-size:13px">Sala de Comando Estratégico — Sócios PSM Imóveis</p>
          </div>
          <div style="flex:1"></div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#94a3b8">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
            <div style="font-size:18px;font-weight:800;color:#fbbf24" id="wr-clock">${new Date().toLocaleTimeString('pt-BR')}</div>
          </div>
        </div>
      </div>
      <div id="wr-body" style="padding:24px"><div class="muted tiny"><span class="spinner"></span> Carregando inteligência de campo…</div></div>
    </div>
  `;
  // Live clock
  if (window._wrClockInt) clearInterval(window._wrClockInt);
  window._wrClockInt = setInterval(() => {
    const el = document.getElementById('wr-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
  }, 1000);
}

function renderContent() {
  const body = document.getElementById('wr-body');
  const equipes = aggregateByEquipe(_data.atingimento, _data.users);
  const totals = {
    vendas: equipes.reduce((s, e) => s + e.vendas, 0),
    vgv: equipes.reduce((s, e) => s + e.vgv, 0),
    meta: equipes.reduce((s, e) => s + e.meta, 0),
    corretores: equipes.reduce((s, e) => s + e.corretores.length, 0),
  };
  const pct = totals.meta > 0 ? (totals.vgv / totals.meta * 100).toFixed(1) : '0';

  body.innerHTML = `
    <!-- Comando geral -->
    <div style="background:rgba(15,23,42,.7);border:1px solid #fbbf2440;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="font-size:11px;font-weight:800;color:#fbbf24;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px">⚡ STATUS DE COMANDO — MÊS ATUAL</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px">
        ${cmdKpi('Corretores em Campo', totals.corretores, '#3b82f6')}
        ${cmdKpi('Vendas Realizadas', totals.vendas, '#22c55e')}
        ${cmdKpi('VGV Atingido', fmtKM(totals.vgv), '#fbbf24')}
        ${cmdKpi('Meta Total', fmtKM(totals.meta), '#cbd5e1')}
        ${cmdKpi('% Cumprimento', pct + '%', pct >= 100 ? '#22c55e' : pct >= 70 ? '#fbbf24' : '#ef4444')}
      </div>
    </div>

    <!-- Batalha por equipes -->
    <div style="font-size:12px;font-weight:800;color:#fbbf24;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px">🎯 BATALHA POR EQUIPE</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;margin-bottom:24px">
      ${equipes.map(e => equipeCard(e)).join('')}
    </div>

    <!-- Análise IA -->
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #6366f140;border-radius:12px;padding:18px">
      <div class="flex" style="align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <div style="font-size:11px;font-weight:800;color:#a5b4fc;text-transform:uppercase;letter-spacing:2px">🤖 ANÁLISE TÁTICA — Sr. Intelligence</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">Análise automática via IA dos dados de batalha do mês</div>
        </div>
        <button class="btn btn-primary" id="wr-analyze" ${_analyzing ? 'disabled' : ''} style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">${_analyzing ? '⏳ Analisando…' : '🧠 Gerar Análise'}</button>
      </div>
      <div id="wr-analysis" style="background:#0a0f1c;border-radius:8px;padding:14px;min-height:80px;color:#cbd5e1;font-size:13px;line-height:1.6;white-space:pre-wrap">
        ${_analysis ? esc(_analysis) : '<div style="color:#64748b;text-align:center;padding:20px">Clique em "Gerar Análise" pra Sr. Intelligence avaliar o desempenho das equipes e sugerir ações.</div>'}
      </div>
    </div>
  `;
  document.getElementById('wr-analyze').addEventListener('click', analyze);
}

function aggregateByEquipe(atg, users) {
  const cores = { MAP: '#6366f1', Conquista: '#f59e0b', Terceiros: '#a855f7', Lancamentos: '#10b981', Locacao: '#06b6d4' };
  const eqs = {};
  const corretorAtg = (atg.por_corretor || []).reduce((m, x) => { m[x.id] = x; return m; }, {});
  users.filter(u => (u.role === 'corretor' || u.role === 'lider') && u.status !== 'inativo').forEach(u => {
    const fr = u.team || u.frente || 'Sem Equipe';
    if (!eqs[fr]) eqs[fr] = { nome: fr, color: cores[fr] || '#64748b', vendas: 0, vgv: 0, meta: 0, corretores: [] };
    const a = corretorAtg[u.id] || {};
    const vgv = +a.vgv_atingido || 0;
    const meta = +a.meta_vgv || 0;
    const vendas = +a.vendas || 0;
    eqs[fr].vendas += vendas;
    eqs[fr].vgv += vgv;
    eqs[fr].meta += meta;
    eqs[fr].corretores.push({ nome: u.name, vgv, meta, vendas });
  });
  return Object.values(eqs).sort((a, b) => b.vgv - a.vgv);
}

function equipeCard(e) {
  const pct = e.meta > 0 ? (e.vgv / e.meta * 100) : 0;
  const status = pct >= 100 ? 'BATEU' : pct >= 70 ? 'NO ATAQUE' : pct >= 40 ? 'EM BATALHA' : 'PRECISA REFORÇO';
  const statusColor = pct >= 100 ? '#22c55e' : pct >= 70 ? '#fbbf24' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const top3 = [...e.corretores].sort((a, b) => b.vgv - a.vgv).slice(0, 3);
  return `
    <div style="background:rgba(15,23,42,.8);border:1px solid ${e.color}40;border-left:4px solid ${e.color};border-radius:10px;padding:16px">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-weight:900;color:${e.color};font-size:16px">⚔️ ${esc(e.nome)}</div>
          <div style="font-size:11px;color:#94a3b8">${e.corretores.length} corretor${e.corretores.length !== 1 ? 'es' : ''}</div>
        </div>
        <span style="background:${statusColor}30;color:${statusColor};padding:3px 10px;border-radius:4px;font-size:10px;font-weight:800">${status}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div style="background:#0a0f1c;padding:8px;border-radius:6px"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase">VGV</div><div style="font-weight:800;color:#fbbf24">${fmtKM(e.vgv)}</div></div>
        <div style="background:#0a0f1c;padding:8px;border-radius:6px"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase">Meta</div><div style="font-weight:800">${fmtKM(e.meta)}</div></div>
        <div style="background:#0a0f1c;padding:8px;border-radius:6px"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase">Vendas</div><div style="font-weight:800;color:#22c55e">${e.vendas}</div></div>
        <div style="background:#0a0f1c;padding:8px;border-radius:6px"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase">%</div><div style="font-weight:800;color:${statusColor}">${pct.toFixed(0)}%</div></div>
      </div>
      <!-- Barra de progresso -->
      <div style="background:#0a0f1c;height:6px;border-radius:3px;overflow:hidden;margin-bottom:8px">
        <div style="background:${statusColor};height:100%;width:${Math.min(100, pct).toFixed(0)}%;transition:width .4s"></div>
      </div>
      <!-- Top 3 da equipe -->
      <div style="font-size:10px;color:#94a3b8;font-weight:700;margin-bottom:4px;text-transform:uppercase">🏆 Destaques</div>
      ${top3.map((c, i) => `
        <div class="flex" style="justify-content:space-between;padding:3px 0;font-size:11px">
          <span>${['🥇','🥈','🥉'][i]} ${esc(c.nome)}</span>
          <span style="color:${e.color};font-weight:700">${fmtKM(c.vgv)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

async function analyze() {
  if (_analyzing) return;
  _analyzing = true;
  document.getElementById('wr-analyze').disabled = true;
  document.getElementById('wr-analyze').textContent = '⏳ Analisando…';
  document.getElementById('wr-analysis').innerHTML = '<div style="color:#64748b;text-align:center;padding:20px"><span class="spinner"></span> Sr. Intelligence analisando dados…</div>';

  const equipes = aggregateByEquipe(_data.atingimento, _data.users);
  const briefing = equipes.map(e => {
    const pct = e.meta > 0 ? (e.vgv / e.meta * 100).toFixed(1) : '0';
    return `${e.nome}: ${e.vendas} vendas, VGV R$ ${e.vgv.toLocaleString('pt-BR')}, meta R$ ${e.meta.toLocaleString('pt-BR')} (${pct}%), ${e.corretores.length} corretores`;
  }).join('\n');

  const prompt = `Você é Sr. Intelligence, conselheiro estratégico dos sócios da PSM Imóveis (Rio Preto/SP). Analise os dados de batalha do mês:

${briefing}

Entregue em até 250 palavras:
1. **DIAGNÓSTICO**: qual equipe está bem, qual precisa de atenção
2. **TOP 3 ALERTAS** táticos (problemas críticos)
3. **TOP 3 AÇÕES** que os sócios devem tomar essa semana
4. **VEREDICTO**: estamos no rumo certo do mês?

Tom direto, estratégico, sem rodeios. Use **negrito** para destacar.`;

  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: {
      agent: 'sr_gerencia',
      messages: [{ role: 'user', content: prompt }],
    }});
    _analysis = r.reply || '(IA não retornou resposta)';
  } catch (e) {
    _analysis = '⚠ Erro: ' + (e.message || 'falha');
  } finally {
    _analyzing = false;
    document.getElementById('wr-analysis').innerHTML = esc(_analysis).replace(/\*\*(.+?)\*\*/g, '<b style="color:#fbbf24">$1</b>');
    document.getElementById('wr-analyze').disabled = false;
    document.getElementById('wr-analyze').textContent = '🔁 Gerar Nova Análise';
  }
}

function cmdKpi(label, value, color) {
  return `
    <div style="background:rgba(15,23,42,.5);border:1px solid #334155;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;font-weight:700">${label}</div>
      <div style="font-size:22px;font-weight:900;color:${color};margin-top:4px">${value}</div>
    </div>
  `;
}

function fmtKM(n) {
  if (n >= 1_000_000) return 'R$ ' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(0) + 'k';
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
