/* PSM-OS v2 — Inteligência Dashboard (Sprint 8.3) */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;

export async function pageIntelDash(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio (lvl 7+).</div>';
    return;
  }
  render();
  await load();
}

async function load() {
  try {
    const [conc, tend] = await Promise.all([
      api.request('/api/v3/concorrentes/list').catch(() => ({ concorrentes: [] })),
      api.request('/api/v3/tendencias/list').catch(() => ({ tendencias: [] })),
    ]);
    const concorrentes = conc.concorrentes || [];
    const tendencias = tend.tendencias || [];
    renderContent(concorrentes, tendencias);
  } catch (e) {
    document.getElementById('id-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function render() {
  _root.innerHTML = `
    <div class="card" style="background:#0f172a;color:#e2e8f0;padding:24px;min-height:80vh">
      <div class="flex" style="align-items:center;gap:14px;margin-bottom:20px">
        <span style="font-size:36px;color:#059669">🔍</span>
        <div>
          <h2 style="margin:0;color:#fff;font-size:24px">Inteligência Estratégica</h2>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Visão consolidada: concorrência, ads, benchmark, tendências</p>
        </div>
      </div>
      <div id="id-body"><div class="muted tiny"><span class="spinner"></span> Consolidando dados…</div></div>
    </div>
  `;
}

function renderContent(concorrentes, tendencias) {
  const totalConc = concorrentes.length;
  const tierA = concorrentes.filter(c => (c.tier || '').toUpperCase() === 'A').length;
  const totalAds = concorrentes.reduce((s, c) => s + (+c.anuncios_count || 0), 0);
  const tendAlta = tendencias.filter(t => t.direcao === 'alta').length;
  const tendBaixa = tendencias.filter(t => t.direcao === 'baixa').length;
  const altoImpacto = tendencias.filter(t => t.impacto === 'alto');

  // Top concorrentes por anúncios
  const topByAds = [...concorrentes].sort((a, b) => (+b.anuncios_count || 0) - (+a.anuncios_count || 0)).slice(0, 5);

  const body = document.getElementById('id-body');
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:24px">
      ${card('Concorrentes', totalConc, '#3b82f6', '🎯')}
      ${card('Tier A (premium)', tierA, '#f59e0b', '🏆')}
      ${card('Anúncios ativos', totalAds, '#22c55e', '📢')}
      ${card('Tendências altas', tendAlta, '#10b981', '📈')}
      ${card('Tendências baixas', tendBaixa, '#ef4444', '📉')}
      ${card('Alto impacto', altoImpacto.length, '#dc2626', '⚠️')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:18px">
        <h3 style="color:#fff;margin:0 0 12px;font-size:15px">🎯 Top 5 Anunciantes</h3>
        ${topByAds.length === 0 ? '<div class="muted tiny">Sem dados.</div>' :
          topByAds.map((c, i) => `
            <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155">
              <span style="color:#fff;font-weight:600">${i + 1}. ${esc(c.nome)}</span>
              <span style="color:${(+c.anuncios_count > 0 ? '#22c55e' : '#64748b')};font-weight:800">${c.anuncios_count || 0} anúncios</span>
            </div>
          `).join('')
        }
        <div class="mt-3 flex gap-2">
          <button class="btn btn-ghost btn-sm" onclick="location.hash='/intel-ads'">→ Ver tudo</button>
          <button class="btn btn-ghost btn-sm" onclick="location.hash='/benchmark'">→ Benchmark</button>
        </div>
      </div>

      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:18px">
        <h3 style="color:#fff;margin:0 0 12px;font-size:15px">⚠️ Tendências de Alto Impacto</h3>
        ${altoImpacto.length === 0 ? '<div class="muted tiny">Sem alertas críticos.</div>' :
          altoImpacto.slice(0, 5).map(t => `
            <div style="padding:10px;background:#0f172a;border-left:3px solid #ef4444;border-radius:6px;margin-bottom:8px">
              <div style="color:#fff;font-weight:700;font-size:13px">${t.direcao === 'alta' ? '📈' : t.direcao === 'baixa' ? '📉' : '➡️'} ${esc(t.titulo)}</div>
              <div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(t.categoria || '—')} · ${esc(t.descricao || '').substring(0, 80)}</div>
            </div>
          `).join('')
        }
        <button class="btn btn-ghost btn-sm mt-2" onclick="location.hash='/tendencias'">→ Ver tendências</button>
      </div>
    </div>

    <div class="mt-4" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:14px;font-weight:800;margin-bottom:6px">🔍 Sr. Intelligence</div>
      <div style="font-size:12px;opacity:.9;max-width:500px;margin:0 auto">Audita, analisa concorrentes e orienta sócios e diretores com dados. Em breve com IA dedicada.</div>
    </div>
  `;
}

function card(label, value, color, ico) {
  return `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;border-left:4px solid ${color}">
      <div style="color:#64748b;font-size:10px;text-transform:uppercase;font-weight:700;margin-bottom:6px">${ico} ${label}</div>
      <div style="color:${color};font-size:26px;font-weight:800">${value}</div>
    </div>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
