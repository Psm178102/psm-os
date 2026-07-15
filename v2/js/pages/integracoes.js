/* PSM-OS v2 — Integrações Externas (Sprint 7.26) */
import { api, tokenStore } from '../api.js';
import { auth } from '../auth.js';

const EXPORTS = [
  { id: 'users',        lbl: '👥 Usuários',        desc: '24 cadastrados' },
  { id: 'imoveis',      lbl: '🏘 Imóveis',          desc: 'Tabela PSM completa' },
  { id: 'lancamentos',  lbl: '🏗 Lançamentos',     desc: 'Obras + construtoras + VGV' },
  { id: 'locacoes',     lbl: '🔑 Locações',         desc: 'Aluguéis + contratos' },
  { id: 'metas',        lbl: '🎯 Metas',            desc: 'Mensal por corretor' },
  { id: 'deals',        lbl: '💰 Deals RD',         desc: 'Sincronizados do RD CRM' },
  { id: 'dir_tasks',    lbl: '📋 Tarefas Diretoria',desc: '' },
  { id: 'eventos',      lbl: '📅 Eventos / Agenda', desc: '' },
  { id: 'audit_log',    lbl: '📜 Audit Log',        desc: 'Trilha de auditoria' },
  { id: 'concorrentes', lbl: '🎯 Concorrentes',     desc: 'Radar' },
];

let _root = null;

export async function pageIntegracoes(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 5) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Líder.</div>'; return; }
  render();
  loadZohoEquipe();
}

/* ── 📅 Zoho Calendar · adesão da equipe ─────────────────────────────────
   Cada pessoa conecta a PRÓPRIA agenda pelo botão na Agenda (é lá que todo
   mundo enxerga — /integracoes é só do grupo 'sistema', que a equipe não tem).
   Aqui a direção vê QUEM ficou de fora, pra poder cobrar. */
async function loadZohoEquipe() {
  const host = document.getElementById('zoho-equipe');
  if (!host) return;
  if ((auth.user()?.lvl || 0) < 7) { host.innerHTML = ''; return; }
  host.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Consultando adesão…</div>';
  let d;
  try { d = await api.request('/api/v3/zoho/equipe'); }
  catch (e) { host.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message || e)}</div>`; return; }

  if (!d.configurado) {
    host.innerHTML = `<div class="alert alert-warn"><b>⚠️ Zoho ainda não configurado.</b>
      <div class="tiny mt-1">Faltam <code>ZOHO_CLIENT_ID</code> / <code>ZOHO_CLIENT_SECRET</code> nas variáveis do Vercel. Sem isso ninguém consegue conectar.</div></div>`;
    return;
  }
  const pend = (d.equipe || []).filter(u => !u.conectado);
  const erro = (d.equipe || []).filter(u => u.conectado && !u.saudavel);
  const pctv = d.total ? Math.round((d.conectados / d.total) * 100) : 0;

  host.innerHTML = `
    <div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <div><div class="tiny muted">Adesão da equipe</div><div style="font-weight:900;font-size:22px">${d.conectados}/${d.total} <span class="tiny muted">(${pctv}%)</span></div></div>
      ${erro.length ? `<div style="background:#f59e0b18;border-radius:10px;padding:6px 12px;border-left:3px solid #f59e0b"><div class="tiny muted">Conectados com problema</div><div style="font-weight:800">${erro.length}</div></div>` : ''}
      <span class="tiny muted" style="margin-left:auto">DC <b>${escapeHtml(d.dc)}</b> · redirect <code style="font-size:10px">${escapeHtml(d.redirect_uri)}</code></span>
    </div>
    <div style="height:8px;background:var(--bd,#eef2f7);border-radius:20px;overflow:hidden;margin:8px 0">
      <div style="height:100%;width:${pctv}%;background:${pctv === 100 ? '#16a34a' : '#2563eb'};border-radius:20px"></div>
    </div>
    ${pend.length ? `<div class="tiny" style="background:#2563eb10;padding:8px 10px;border-radius:8px;border-left:3px solid #2563eb">
      <b>Ainda não conectaram (${pend.length}):</b> ${pend.map(u => escapeHtml(u.nome || u.email)).join(' · ')}
      <div class="muted mt-1">Peça pra abrirem a <b>Agenda</b> e clicarem em “🔗 Conectar meu Zoho”. Cada um autoriza a própria conta — ninguém conecta pelo outro.</div>
    </div>` : '<div class="alert alert-ok tiny">🎉 Todo mundo conectado.</div>'}
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Pessoa</th><th>Conta Zoho</th><th style="text-align:right">Última sync</th><th style="text-align:right">Status</th></tr>
      ${(d.equipe || []).map(u => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px 8px">${escapeHtml(u.nome || '—')}<div class="tiny muted">${escapeHtml(u.papel || '')}</div></td>
        <td class="tiny">${escapeHtml(u.zoho_email || '—')}</td>
        <td style="text-align:right" class="tiny">${u.min_desde_sync == null ? '—' : (u.min_desde_sync < 60 ? u.min_desde_sync + ' min' : Math.round(u.min_desde_sync / 60) + ' h')}</td>
        <td style="text-align:right">${u.conectado
          ? (u.saudavel ? '<span class="tiny" style="color:#16a34a;font-weight:700">✅ ok</span>'
                        : `<span class="tiny" style="color:#f59e0b;font-weight:700">⚠️ ${u.erros ? u.erros + ' erro(s)' : 'sem sync'}</span>`)
          : '<span class="tiny muted">— não conectou</span>'}</td>
      </tr>`).join('')}
    </table>`;
}

function render() {
  const me = auth.user();
  const isSocio = (me?.lvl || 0) >= 7;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔌 Integrações Externas</h2>
      <p class="card-sub">Webhooks, importações, exportação CSV.</p>

      ${isSocio ? `
        <h3 class="card-title mt-4">📅 Zoho Calendar · agenda da equipe</h3>
        <p class="tiny muted">Cada pessoa conecta a <b>própria</b> conta pelo botão “🔗 Conectar meu Zoho” na <b>Agenda</b> — é lá porque todo mundo enxerga a Agenda, e esta tela aqui só o sócio vê. Abaixo, quem já aderiu.</p>
        <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px"><div id="zoho-equipe"></div></div>
      ` : ''}

      <h3 class="card-title mt-4">🔔 Webhook de Alertas (Zapier / Make / n8n)</h3>
      <p class="tiny muted">Dispara webhook configurado em Configurações → Comunicação → webhook_url. Ideal pra notificações WhatsApp/Slack via Zapier.</p>
      <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px">
        <div class="field"><label>Título da mensagem *</label><input id="wh-title" class="input" placeholder="Ex: Venda fechada!" value="Teste de webhook PSM-OS"></div>
        <div class="field"><label>Corpo</label><textarea id="wh-body" class="input" rows="2">Mensagem de teste do PSM-OS v2.</textarea></div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <select id="wh-sev" class="select"><option value="info">ℹ️ Info</option><option value="alert">⚠️ Alerta</option><option value="critical">🔴 Crítica</option></select>
          <button class="btn btn-primary" id="wh-send" style="margin-left:auto">📤 Enviar webhook</button>
        </div>
        <div id="wh-msg" class="mt-2"></div>
      </div>

      ${isSocio ? `
        <h3 class="card-title mt-4">🏢 Kenlo Imob (Import imóveis terceiros) <span style="font-size:11px;font-weight:700;background:#fef3c7;color:#b45309;padding:1px 7px;border-radius:999px;vertical-align:middle">em breve</span></h3>
        <p class="tiny muted">Importará imóveis do painel Kenlo → tabela imóveis (origem='terceiros'). Integração ainda não implementada — depende da liberação da API Kenlo (KENLO_API_TOKEN).</p>
        <div class="card" style="background:var(--bg-3);margin:8px 0;padding:14px">
          <button class="btn btn-primary" id="kenlo-sync" disabled title="Em breve — integração Kenlo não implementada" style="opacity:0.5;cursor:not-allowed">⚡ Disparar sync (em breve)</button>
          <div id="kenlo-msg" class="mt-2"></div>
        </div>
      ` : ''}

      <h3 class="card-title mt-4">📊 Exportar CSV (Excel/Sheets)</h3>
      <p class="tiny muted">Baixe qualquer tabela em CSV (compatível com Excel/Sheets). Até 5000 linhas por arquivo.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;margin-top:8px">
        ${EXPORTS.map(e => `
          <button class="btn btn-ghost" data-export="${e.id}" style="display:flex;align-items:center;gap:8px;justify-content:flex-start;padding:12px 16px;text-align:left">
            <div style="flex:1">
              <div style="font-weight:700;font-size:13px">${e.lbl}</div>
              <div class="tiny muted">${e.desc}</div>
            </div>
            <span>⬇</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('wh-send').addEventListener('click', testWebhook);
  const kSync = document.getElementById('kenlo-sync');
  if (kSync) kSync.addEventListener('click', kenloSync);
  document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => downloadCSV(b.dataset.export)));
}

async function testWebhook() {
  const btn = document.getElementById('wh-send');
  const msg = document.getElementById('wh-msg');
  btn.disabled = true;
  msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Enviando…</div>';
  try {
    const r = await api.request('/api/v3/webhooks/send', { method: 'POST', body: {
      title: document.getElementById('wh-title').value.trim(),
      body: document.getElementById('wh-body').value.trim(),
      severity: document.getElementById('wh-sev').value,
    } });
    msg.innerHTML = `<div class="alert alert-ok">✅ Webhook enviado · HTTP ${r.status}</div>`;
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-err">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

async function kenloSync() {
  const btn = document.getElementById('kenlo-sync');
  const msg = document.getElementById('kenlo-msg');
  btn.disabled = true;
  msg.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Sincronizando…</div>';
  try {
    const r = await api.request('/api/v3/kenlo/sync', { method: 'POST', body: {} });
    msg.innerHTML = `<div class="alert alert-ok">✅ ${escapeHtml(JSON.stringify(r))}</div>`;
  } catch (e) {
    // 503/501 esperados se não tem token — mostrar instruções
    msg.innerHTML = `<div class="alert alert-warn"><b>${escapeHtml(e.message)}</b><br><span class="tiny">${(e.data?.instructions || []).map(i => '<br>' + escapeHtml(i)).join('') || ''}</span></div>`;
  } finally {
    btn.disabled = false;
  }
}

async function downloadCSV(table) {
  // Browser não passa header Authorization em link direto, então usar fetch + blob
  try {
    const tok = tokenStore.get();
    const resp = await fetch('/api/v3/export/csv?table=' + encodeURIComponent(table), {
      headers: { 'Authorization': 'Bearer ' + tok },
    });
    if (!resp.ok) {
      alert('Erro: HTTP ' + resp.status);
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psm_${table}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  } catch (e) {
    alert('Erro download: ' + e.message);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
