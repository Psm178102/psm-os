/* PSM-OS v2 — 📲 Leads do WhatsApp (roleta da Vera) — v88.9
   Quatro tipos de lead caem no mesmo número: a trilha vem da frase de origem, a
   roleta dá o dono e o card nasce no RD. Aqui o corretor ✋ ASSUME — com número
   único ele não tem como provar pelo WhatsApp que pegou, e é esse clique que
   para o SLA. Sócio liga/desliga o portão e monta as filas no fim da página. */
import { api } from '../api.js';
import { auth } from '../auth.js';

// v88.45: nome do perfil e 1ª mensagem vêm de QUALQUER pessoa que escreve no WhatsApp — XSS armazenado.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _root = null;
let _data = null;
let _busy = false;
let _tick = null;

const TRILHA_COR = {
  comprar: '#1d4ed8', captacao: '#b45309', locacao: '#0f766e',
  conquista: '#15803d', indefinido: '#64748b',
};
const ST_LABEL = {
  novo: '🕐 Na fila', distribuido: '🔔 Aguardando assumir', assumido: '✅ Assumido',
  duplicado: '♻️ Já era cliente', descartado: '🗑 Descartado',
};

export async function pageWaLeads(ctx, root) {
  _root = root;
  _data = null;
  await load();
}

function lvl() { return auth.user()?.lvl || 0; }
function meuId() { return auth.user()?.id; }

async function load() {
  if (!_root) return;
  if (!_data) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando a fila do WhatsApp…</div></div>';
  try {
    _data = await api.request('/api/v3/wa/roleta');
  } catch (e) {
    _root.innerHTML = `<div class="card"><b>⚠️ Não carregou.</b> <span class="muted tiny">${e?.message || e}</span>
      <div class="tiny muted" style="margin-top:6px">Se a migração ainda não rodou no Supabase, a tabela wa_leads não existe — rode <code>supabase/sprint_wa_leads_roleta.sql</code> e recarregue.</div></div>`;
    return;
  }
  render();
}

function tempo(iso) {
  if (!iso) return '—';
  try {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}min`;
    if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    return `${Math.floor(s / 86400)}d`;
  } catch (_) { return '—'; }
}

function pill(trilha, labels) {
  const c = TRILHA_COR[trilha] || '#64748b';
  return `<span class="tiny" style="background:${c}1a;color:${c};border:1px solid ${c}55;border-radius:999px;padding:1px 8px;white-space:nowrap">${esc((labels || {})[trilha] || trilha)}</span>`;
}

function linhaLead(l, labels, comAcao) {
  const espera = l.assumido_em ? null : (l.distribuido_em || l.created_at);
  const atraso = espera && (Date.now() - new Date(espera).getTime()) / 60000 > (_data?.cfg?.sla_min || 15);
  return `<tr style="border-top:1px solid var(--line,#e5e7eb)">
    <td style="padding:8px 6px;white-space:nowrap">
      <span class="wa-timer tiny ${atraso ? '' : 'muted'}" data-ts="${esc(espera || l.created_at)}"
        style="${atraso ? 'color:#dc2626;font-weight:700' : ''}">${tempo(espera || l.created_at)}</span></td>
    <td style="padding:8px 6px">
      <div style="font-weight:600">${esc(l.nome || 'Sem nome no perfil')}</div>
      <div class="tiny muted">“${esc((l.primeira_msg || '').slice(0, 70))}”</div></td>
    <td style="padding:8px 6px">${pill(l.trilha, labels)}</td>
    <td style="padding:8px 6px" class="tiny">${ST_LABEL[l.status] || esc(l.status)}${l.erro ? `<div class="tiny" style="color:#b45309">⚠ ${esc(String(l.erro).slice(0, 60))}</div>` : ''}</td>
    <td style="padding:8px 6px;white-space:nowrap">
      <a class="btn btn-sm" href="https://wa.me/${esc(String(l.wa_phone || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">💬 Abrir</a>
      ${comAcao && !l.assumido_em ? `<button class="btn btn-primary btn-sm" data-assumir="${esc(l.id)}">✋ Assumi</button>` : ''}
      ${l.trilha === 'indefinido' ? `<select class="input input-sm" data-classificar="${esc(l.id)}" style="width:130px">
          <option value="">Classificar…</option>
          ${Object.keys(TRILHA_COR).filter(t => t !== 'indefinido').map(t =>
            `<option value="${t}">${(labels || {})[t] || t}</option>`).join('')}
        </select>` : ''}
      ${lvl() >= 5 && _data.users_mini ? `<select class="input input-sm" data-reatribuir="${esc(l.id)}" style="width:130px">
          <option value="">Passar para…</option>
          ${_data.users_mini.map(u => `<option value="${u.id}" ${u.id === l.corretor_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>` : ''}
    </td></tr>`;
}

function render() {
  if (!_root || !_data) return;
  const labels = _data.labels || {};
  const p = _data.placar || {};
  const cfg = _data.cfg || {};
  const socio = !!_data.pode_editar;

  const aviso = _data.ativo ? '' : `<div class="card" style="margin:0 0 12px;border-left:4px solid #b45309">
      <b>🌓 Modo sombra.</b> <span class="muted">A porteira está registrando os leads e a classificação, mas não distribui e não cria card no RD.</span>
      ${socio ? '<div class="tiny muted" style="margin-top:4px">Para ligar de verdade, use o botão no fim da página.</div>' : ''}
    </div>`;

  const kpis = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px">
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">Leads hoje</div>
        <div style="font-size:26px;font-weight:800">${p.hoje ?? 0}</div></div>
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">Aguardando assumir</div>
        <div style="font-size:26px;font-weight:800;color:${(p.aguardando || 0) ? '#dc2626' : 'inherit'}">${p.aguardando ?? 0}</div>
        <div class="tiny muted">meta ≤ ${cfg.sla_min || 15}min</div></div>
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">Sem dono</div>
        <div style="font-size:26px;font-weight:800;color:${(p.sem_dono || 0) ? '#b45309' : 'inherit'}">${p.sem_dono ?? 0}</div>
        <div class="tiny muted">fila vazia na trilha</div></div>
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">Por trilha</div>
        <div class="tiny" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;justify-content:center">
          ${Object.entries(p.por_trilha || {}).map(([t, n]) => `${pill(t, labels)}<b>${n}</b>`).join(' ') || '<span class="muted">—</span>'}</div></div>
    </div>`;

  const meus = _data.meus || [];
  const meusHTML = `<div class="card" style="margin:0 0 12px">
      <b>✋ Meus leads</b> <span class="tiny muted">— o clique em “Assumi” é o que para o cronômetro</span>
      ${meus.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;margin-top:8px">
        ${meus.map(l => linhaLead(l, labels, true)).join('')}</table></div>`
      : '<div class="muted tiny" style="padding:12px 0">Nada na sua fila agora.</div>'}
    </div>`;

  const ultimos = _data.ultimos || [];
  const timeHTML = `<div class="card" style="margin:0 0 12px">
      <b>📋 Hoje</b> <span class="tiny muted">${lvl() >= 5 ? '— todo o time' : '— seus leads'}</span>
      ${ultimos.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;margin-top:8px">
        ${ultimos.map(l => linhaLead(l, labels, l.corretor_id === meuId() || lvl() >= 5)).join('')}</table></div>`
      : '<div class="muted tiny" style="padding:12px 0">Nenhuma mensagem nova hoje.</div>'}
    </div>`;

  const users = _data.users_mini || [];
  const filas = socio ? `<details class="card" style="margin:0">
      <summary style="cursor:pointer"><b>⚙️ Roleta — filas e portão</b> <span class="tiny muted">(só sócio)</span></summary>
      <div style="margin-top:10px">
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          ${Object.keys(TRILHA_COR).filter(t => t !== 'indefinido').map(t => `<div>
            <b class="tiny">${labels[t] || t}</b>
            <div class="tiny muted">etapa RD: ${(cfg.rd_stage || {})[t] ? '✅ configurada' : '⚠️ falta o id'}</div>
            <div style="max-height:150px;overflow:auto;margin-top:4px">${users.map(u =>
              `<label class="flex items-center gap-1 tiny" style="cursor:pointer"><input type="checkbox" data-fila="${t}" value="${u.id}"
                ${((cfg.trilhas || {})[t] || []).includes(u.id) ? 'checked' : ''}> ${esc(u.name)}
                <span class="muted">(${esc(u.team || u.role)})</span></label>`).join('')}</div></div>`).join('')}
        </div>
        <div class="flex items-center gap-2" style="margin-top:12px;flex-wrap:wrap">
          <label class="tiny">Modo
            <select id="wa-modo" class="input input-sm">
              <option value="carga" ${cfg.modo === 'carga' ? 'selected' : ''}>Menor carga do dia</option>
              <option value="rodizio" ${cfg.modo === 'rodizio' ? 'selected' : ''}>Rodízio</option>
            </select></label>
          <label class="tiny">SLA (min) <input type="number" id="wa-sla" class="input" style="width:64px" value="${cfg.sla_min ?? 15}"></label>
          <label class="tiny flex items-center gap-1"><input type="checkbox" id="wa-repique" ${cfg.repique_auto ? 'checked' : ''}> Repicar para o próximo</label>
          <button class="btn btn-sm" id="wa-salvar">💾 Salvar</button>
          <button class="btn ${_data.ativo ? '' : 'btn-primary'} btn-sm" id="wa-portao">${_data.ativo ? '⏸ Voltar para sombra' : '▶️ Ligar a roleta'}</button>
        </div>
        <div class="tiny muted" style="margin-top:8px">Fila vazia numa trilha = o lead cai para gerentes e sócios. Cliente com negócio aberto no RD nunca entra na roleta: avisa o dono.</div>
      </div>
    </details>` : '';

  _root.innerHTML = aviso + kpis + meusHTML + timeHTML + filas;
  wire();
  startTick();
}

function wire() {
  _root.querySelectorAll('[data-assumir]').forEach(b => b.onclick = async () => {
    if (_busy) return; _busy = true; b.disabled = true; b.textContent = '…';
    try { await api.request('/api/v3/wa/roleta', { method: 'POST', body: { action: 'assumir', lead_id: Number(b.dataset.assumir) } }); }
    catch (e) { alert('Falhou: ' + (e?.message || e)); }
    _busy = false; load();
  });
  _root.querySelectorAll('[data-classificar]').forEach(s => s.onchange = async () => {
    if (!s.value) return;
    try { await api.request('/api/v3/wa/roleta', { method: 'POST', body: { action: 'classificar', lead_id: Number(s.dataset.classificar), trilha: s.value } }); }
    catch (e) { alert('Falhou: ' + (e?.message || e)); }
    load();
  });
  _root.querySelectorAll('[data-reatribuir]').forEach(s => s.onchange = async () => {
    if (!s.value) return;
    try { await api.request('/api/v3/wa/roleta', { method: 'POST', body: { action: 'reatribuir', lead_id: Number(s.dataset.reatribuir), user_id: s.value } }); }
    catch (e) { alert('Falhou: ' + (e?.message || e)); }
    load();
  });

  const salvar = _root.querySelector('#wa-salvar');
  salvar && (salvar.onclick = () => enviarCfg({}));
  const portao = _root.querySelector('#wa-portao');
  portao && (portao.onclick = () => {
    const ligando = !_data.ativo;
    if (ligando && !confirm('Ligar a roleta? A partir de agora cada mensagem nova vira card no RD com dono e notificação.')) return;
    enviarCfg({ ativo: ligando });
  });
}

async function enviarCfg(extra) {
  const trilhas = {};
  _root.querySelectorAll('[data-fila]').forEach(c => {
    (trilhas[c.dataset.fila] = trilhas[c.dataset.fila] || []);
    if (c.checked) trilhas[c.dataset.fila].push(c.value);
  });
  const cfg = {
    trilhas,
    modo: _root.querySelector('#wa-modo')?.value || 'carga',
    sla_min: parseInt(_root.querySelector('#wa-sla')?.value, 10) || 15,
    repique_auto: !!_root.querySelector('#wa-repique')?.checked,
    ...extra,
  };
  try {
    await api.request('/api/v3/wa/roleta', { method: 'POST', body: { action: 'config', cfg } });
    _data = null;
  } catch (e) { alert('Falhou: ' + (e?.message || e)); }
  load();
}

function startTick() {
  clearInterval(_tick);
  _tick = setInterval(() => {
    if (!_root || !document.body.contains(_root)) { clearInterval(_tick); return; }
    _root.querySelectorAll('.wa-timer').forEach(el => { el.textContent = tempo(el.dataset.ts); });
  }, 1000);
}
