/* PSM-OS v2 — 📥 Leads LP Conquista (teste de CRM paralelo ao RD) — v84.86
   A landing psmconquista.com.br manda cada lead em DUPLO DESTINO (RD + House).
   Aqui: fila de atendimento com speed-to-lead (✋ Atendi 1-clique), lista de
   nutrição (ATE_2250), e o painel de PARIDADE que decide a migração de CRM. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;
let _filtros = { status: '', faixa: '', camp: '', nutricao: false, dias: 7 };
let _tick = null;
let _busy = false;

const ST_LABEL = {
  novo: '🆕 Novo', em_atendimento: '📞 Em atendimento', agendado: '📅 Agendado',
  descartado: '🗑 Descartado', nutricao: '🌱 Nutrição',
};
const ST_COR = {
  novo: '#dc2626', em_atendimento: '#2563eb', agendado: '#16a34a',
  descartado: '#64748b', nutricao: '#a16207',
};

export async function pageLeadsLp(ctx, root) {
  _root = root;
  await load();
}

function lvl() { return auth.user()?.lvl || 0; }

async function load() {
  if (!_root) return;
  if (!_data) _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando leads da LP…</div></div>';
  const qs = new URLSearchParams({ dias: String(_filtros.dias) });
  if (_filtros.status) qs.set('status', _filtros.status);
  if (_filtros.faixa) qs.set('faixa', _filtros.faixa);
  if (_filtros.camp) qs.set('camp', _filtros.camp);
  if (_filtros.nutricao) qs.set('nutricao', '1');
  if (lvl() >= 7) { qs.set('paridade', '1'); qs.set('config', '1'); }
  try {
    _data = await api.request('/api/v3/leads/lp?' + qs.toString());
  } catch (e) {
    _root.innerHTML = `<div class="card"><b>⚠️ Não carregou.</b> <span class="muted tiny">${e?.message || e}</span>
      <div class="tiny muted" style="margin-top:6px">Se a migração ainda não rodou no Supabase, a tabela leads_lp não existe — rode a migração e recarregue.</div></div>`;
    return;
  }
  render();
}

function tempoVivo(iso) {
  try {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}min`;
    if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    return `${Math.floor(s / 86400)}d`;
  } catch (_) { return '—'; }
}

function respMin(l) {
  if (!l.ts_primeira_resposta) return null;
  try { return Math.round((new Date(l.ts_primeira_resposta) - new Date(l.ts_recebido)) / 6000) / 10; }
  catch (_) { return null; }
}

function render() {
  if (!_root || !_data) return;
  const k = _data.kpis || {};
  const gestor = lvl() >= 7;
  const semResp = k.sem_resposta_agora || 0;

  const kpisHTML = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">Leads hoje</div>
        <div style="font-size:26px;font-weight:800">${k.hoje ?? 0}</div>
        <div class="tiny muted">${k.nutricao_hoje ? `+${k.nutricao_hoje} nutrição` : '&nbsp;'}</div></div>
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">Tempo médio 1ª resposta</div>
        <div style="font-size:26px;font-weight:800">${k.medio_resp_min != null ? k.medio_resp_min + 'min' : '—'}</div>
        <div class="tiny muted">meta ≤ ${k.sla_min}min</div></div>
      <div class="card" style="margin:0;text-align:center"><div class="tiny muted">% dentro do SLA</div>
        <div style="font-size:26px;font-weight:800;color:${(k.pct_sla ?? 100) >= 80 ? 'var(--ok,#16a34a)' : '#dc2626'}">${k.pct_sla != null ? k.pct_sla + '%' : '—'}</div>
        <div class="tiny muted">hoje</div></div>
      <div class="card" style="margin:0;text-align:center;${semResp ? 'border:1px solid #dc2626;animation:lpPulse 1.2s infinite' : ''}">
        <div class="tiny muted">Sem resposta AGORA</div>
        <div style="font-size:26px;font-weight:800;color:${semResp ? '#dc2626' : 'inherit'}">${semResp}</div>
        <div class="tiny ${semResp ? '' : 'muted'}" style="${semResp ? 'color:#dc2626;font-weight:700' : ''}">${semResp ? 'CHAMA JÁ' : 'tudo respondido'}</div></div>
    </div>
    <style>@keyframes lpPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}50%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}</style>`;

  const filtrosHTML = `
    <div class="flex items-center gap-2" style="flex-wrap:wrap;margin-bottom:10px">
      <select id="lp-f-status" class="input" style="width:auto">
        <option value="">Todos os status</option>
        ${Object.entries(ST_LABEL).filter(([s]) => s !== 'nutricao').map(([s, l]) =>
          `<option value="${s}" ${_filtros.status === s ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select id="lp-f-faixa" class="input" style="width:auto">
        <option value="">Todas as faixas</option>
        ${(_data.faixas || []).map(f => `<option value="${f}" ${_filtros.faixa === f ? 'selected' : ''}>${f}</option>`).join('')}
      </select>
      <select id="lp-f-camp" class="input" style="width:auto">
        <option value="">Todas as campanhas</option>
        ${(_data.campanhas || []).map(c => `<option value="${c}" ${_filtros.camp === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <select id="lp-f-dias" class="input" style="width:auto">
        ${[3, 7, 14, 30].map(d => `<option value="${d}" ${_filtros.dias === d ? 'selected' : ''}>${d} dias</option>`).join('')}
      </select>
      <label class="flex items-center gap-1 tiny" style="cursor:pointer">
        <input type="checkbox" id="lp-f-nutr" ${_filtros.nutricao ? 'checked' : ''}> 🌱 Só nutrição (${_data.nutricao_janela || 0})
      </label>
      <span class="tiny muted" style="margin-left:auto">${_data.comercial_agora ? '🟢 horário comercial' : '🌙 fora do comercial'}</span>
    </div>`;

  const leads = _data.leads || [];
  const linhas = leads.map(l => {
    const rm = respMin(l);
    const camp = (l.utms || {}).utm_campaign || l.origem || '—';
    const pend = l.status_atendimento === 'novo' && !l.nutricao;
    return `
    <tr style="${pend ? 'background:rgba(220,38,38,.06)' : ''}">
      <td><span class="lp-timer tiny ${pend ? '' : 'muted'}" data-ts="${l.ts_recebido}"
            style="${pend ? 'color:#dc2626;font-weight:800' : ''}">${tempoVivo(l.ts_recebido)}</span></td>
      <td><b>${(l.nome || '?')}</b>${l.email ? `<div class="tiny muted">${l.email}</div>` : ''}</td>
      <td><span style="background:var(--psm-navy,#1e2650);color:#fffbea;border-radius:6px;padding:2px 8px;font-weight:700;font-size:12px;white-space:nowrap">${l.faixa_label || l.faixa_renda || '—'}</span></td>
      <td class="tiny muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${camp}</td>
      <td><span class="tiny" style="color:${ST_COR[l.status_atendimento] || 'inherit'};font-weight:700">${ST_LABEL[l.status_atendimento] || l.status_atendimento}</span>
        ${l.atendido_por_nome ? `<div class="tiny muted">${l.atendido_por_nome}${rm != null ? ` · ${rm}min` : ''}</div>` : ''}</td>
      <td style="white-space:nowrap">
        <a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${l.whatsapp}?text=${encodeURIComponent(`Olá ${(l.nome || '').split(' ')[0]}! Aqui é da PSM Conquista — recebemos o seu cadastro. Posso te ajudar a encontrar o seu imóvel?`)}"
           data-atendi-tb="${l.id}">💬 WhatsApp</a>
        ${!l.ts_primeira_resposta && !l.nutricao ? `<button class="btn btn-primary btn-sm" data-atendi="${l.id}">✋ Atendi</button>` : ''}
        <select class="input tiny" data-status="${l.id}" style="width:auto;padding:2px 4px">
          ${Object.entries(ST_LABEL).map(([s, lb]) => `<option value="${s}" ${l.status_atendimento === s ? 'selected' : ''}>${lb}</option>`).join('')}
        </select>
      </td>
    </tr>`;
  }).join('');

  let paridadeHTML = '';
  if (gestor && _data.paridade) {
    const m = _data.paridade.madura_48h || {};
    const r = _data.paridade.recente_48h || {};
    const pc = _data.por_campanha || {};
    paridadeHTML = `
    <div class="card" style="margin-top:14px">
      <div class="flex items-center gap-2" style="justify-content:space-between;flex-wrap:wrap">
        <b>🎯 Paridade RD × House (decide a migração de CRM — meta ≥99% por 30 dias)</b>
        <button class="btn btn-sm" id="lp-recon">🔄 Reconciliar agora</button>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
        <div class="card" style="margin:0;background:var(--bg-3)">
          <div class="tiny muted">Janela MADURA (+48h — sync RD já passou)</div>
          <div style="font-size:22px;font-weight:800">${m.pct != null ? m.pct + '%' : '—'}</div>
          <div class="tiny muted">${m.casados ?? 0}/${m.total ?? 0} casados com o RD</div>
        </div>
        <div class="card" style="margin:0;background:var(--bg-3)">
          <div class="tiny muted">Últimas 48h (casamento ainda em curso)</div>
          <div style="font-size:22px;font-weight:800">${r.casados ?? 0}/${r.total ?? 0}</div>
          <div class="tiny muted">o sync RD roda 1×/dia — normal casar amanhã</div>
        </div>
      </div>
      ${(m.sem_rd || []).length ? `<details style="margin-top:8px"><summary class="tiny" style="cursor:pointer;color:#dc2626;font-weight:700">⚠️ ${m.sem_rd.length} leads maduros SEM par no RD (falha da LP→RD?)</summary>
        <ul class="tiny muted" style="margin:6px 0 0 16px">${m.sem_rd.map(x => `<li>${x.nome} · ${x.whatsapp} · ${new Date(x.ts).toLocaleString('pt-BR')}</li>`).join('')}</ul></details>` : ''}
      <div class="tiny muted" style="margin-top:8px">${_data.paridade.nota || ''}</div>
      ${Object.keys(pc).length ? `<div style="margin-top:10px"><b class="tiny">Leads por campanha (janela ${_filtros.dias}d)</b>
        <table class="tiny" style="width:100%;margin-top:4px"><tr class="muted"><th style="text-align:left">Campanha</th><th>Leads</th><th>Agendados</th></tr>
        ${Object.entries(pc).sort((a, b) => b[1].total - a[1].total).map(([c, v]) =>
          `<tr><td>${c}</td><td style="text-align:center">${v.total}</td><td style="text-align:center">${v.agendados}</td></tr>`).join('')}
        </table><div class="tiny muted" style="margin-top:4px">💰 custo por lead qualificado: cruzamento com o Meta entra na evolução do semáforo de ads (fase 2)</div></div>` : ''}
    </div>`;
  }

  const configHTML = (lvl() >= 10 && _data.config) ? `
    <div class="card" style="margin-top:14px">
      <details><summary style="cursor:pointer;font-weight:700">⚙️ Config — roteio, SLA e horário</summary>
        <div id="lp-cfg-box" style="margin-top:10px">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
            <div><b class="tiny">📥 Atendentes (recebem o push do lead novo)</b>
              <div class="tiny muted">vazio = gerentes Conquista</div>
              <div style="max-height:160px;overflow:auto;margin-top:4px">${(_data.users_mini || []).map(u =>
                `<label class="flex items-center gap-1 tiny" style="cursor:pointer"><input type="checkbox" data-cfg-atend="${u.id}"
                  ${(_data.config.atendentes || []).includes(u.id) ? 'checked' : ''}> ${u.name} <span class="muted">(${u.role})</span></label>`).join('')}</div></div>
            <div><b class="tiny">🚨 Gestores (recebem o alerta de SLA)</b>
              <div class="tiny muted">vazio = gerentes + sócios</div>
              <div style="max-height:160px;overflow:auto;margin-top:4px">${(_data.users_mini || []).map(u =>
                `<label class="flex items-center gap-1 tiny" style="cursor:pointer"><input type="checkbox" data-cfg-gest="${u.id}"
                  ${(_data.config.gestores || []).includes(u.id) ? 'checked' : ''}> ${u.name} <span class="muted">(${u.role})</span></label>`).join('')}</div></div>
          </div>
          <div class="flex items-center gap-2" style="margin-top:10px;flex-wrap:wrap">
            <label class="tiny">SLA (min) <input type="number" id="lp-cfg-sla" class="input" style="width:64px" value="${_data.config.sla_min}"></label>
            <label class="tiny">Alerta gestor (min) <input type="number" id="lp-cfg-alerta" class="input" style="width:64px" value="${_data.config.alerta_min}"></label>
            <label class="tiny">Comercial <input id="lp-cfg-ini" class="input" style="width:70px" value="${(_data.config.horario || {}).ini || '08:30'}"> às
              <input id="lp-cfg-fim" class="input" style="width:70px" value="${(_data.config.horario || {}).fim || '18:30'}"></label>
            <button class="btn btn-primary btn-sm" id="lp-cfg-save">💾 Salvar config</button>
          </div>
        </div>
      </details>
    </div>` : '';

  _root.innerHTML = `
    ${kpisHTML}
    ${filtrosHTML}
    <div class="card" style="margin:0;overflow-x:auto">
      ${leads.length ? `<table style="width:100%;border-collapse:collapse" class="lp-tabela">
        <tr class="tiny muted"><th style="text-align:left">⏱</th><th style="text-align:left">Lead</th>
          <th style="text-align:left">Faixa de renda</th><th style="text-align:left">Campanha</th>
          <th style="text-align:left">Status</th><th style="text-align:left">Ação</th></tr>
        ${linhas}</table>`
      : `<div class="muted" style="padding:16px;text-align:center">Nenhum lead ${_filtros.nutricao ? 'em nutrição' : ''} na janela de ${_filtros.dias} dias.<div class="tiny" style="margin-top:4px">Assim que a LP começar a enviar, eles aparecem aqui em tempo real.</div></div>`}
    </div>
    ${paridadeHTML}
    ${configHTML}`;

  wire();
  startTick();
}

function wire() {
  ['status', 'faixa', 'camp'].forEach(k => {
    const el = _root.querySelector('#lp-f-' + k);
    el && (el.onchange = () => { _filtros[k] = el.value; load(); });
  });
  const dd = _root.querySelector('#lp-f-dias');
  dd && (dd.onchange = () => { _filtros.dias = parseInt(dd.value, 10) || 7; load(); });
  const nt = _root.querySelector('#lp-f-nutr');
  nt && (nt.onchange = () => { _filtros.nutricao = nt.checked; load(); });

  _root.querySelectorAll('[data-atendi]').forEach(b => b.onclick = async () => {
    if (_busy) return; _busy = true; b.disabled = true; b.textContent = '…';
    try { await api.request('/api/v3/leads/lp', { method: 'POST', body: { action: 'atender', id: b.dataset.atendi } }); }
    catch (e) { alert('Falhou: ' + (e?.message || e)); }
    _busy = false; load();
  });
  // clicar no WhatsApp também marca atendido (o gesto real de atender É abrir o zap)
  _root.querySelectorAll('[data-atendi-tb]').forEach(a => a.addEventListener('click', () => {
    api.request('/api/v3/leads/lp', { method: 'POST', body: { action: 'atender', id: a.dataset.atendiTb } })
      .then(() => setTimeout(load, 800)).catch(() => {});
  }));
  _root.querySelectorAll('[data-status]').forEach(s => s.onchange = async () => {
    try { await api.request('/api/v3/leads/lp', { method: 'POST', body: { action: 'status', id: s.dataset.status, status: s.value } }); }
    catch (e) { alert('Falhou: ' + (e?.message || e)); }
    load();
  });
  const rec = _root.querySelector('#lp-recon');
  rec && (rec.onclick = async () => {
    rec.disabled = true; rec.textContent = '🔄 Reconciliando…';
    try {
      const r = await api.request('/api/v3/leads/lp', { method: 'POST', body: { action: 'reconciliar' } });
      alert(`Reconciliação: ${r?.resultado?.casados ?? 0} casados de ${r?.resultado?.pendentes ?? 0} pendentes.`);
    } catch (e) { alert('Falhou: ' + (e?.message || e)); }
    load();
  });
  const cs = _root.querySelector('#lp-cfg-save');
  cs && (cs.onclick = async () => {
    const atend = [..._root.querySelectorAll('[data-cfg-atend]:checked')].map(c => c.dataset.cfgAtend);
    const gest = [..._root.querySelectorAll('[data-cfg-gest]:checked')].map(c => c.dataset.cfgGest);
    const cfg = {
      atendentes: atend, gestores: gest,
      sla_min: parseInt(_root.querySelector('#lp-cfg-sla').value, 10) || 5,
      alerta_min: parseInt(_root.querySelector('#lp-cfg-alerta').value, 10) || 15,
      horario: { ini: _root.querySelector('#lp-cfg-ini').value || '08:30',
                 fim: _root.querySelector('#lp-cfg-fim').value || '18:30', dias: [0, 1, 2, 3, 4] },
    };
    cs.disabled = true;
    try { await api.request('/api/v3/leads/lp', { method: 'POST', body: { action: 'config', config: cfg } }); alert('✅ Config salva.'); }
    catch (e) { alert('Falhou: ' + (e?.message || e)); }
    load();
  });
}

function startTick() {
  clearInterval(_tick);
  _tick = setInterval(() => {
    if (!_root || !document.body.contains(_root)) { clearInterval(_tick); return; }
    _root.querySelectorAll('.lp-timer').forEach(el => { el.textContent = tempoVivo(el.dataset.ts); });
  }, 1000);
}
