/* PSM-OS v2 — 🔁 Ritmo da Gestão (v88.97)
   Pedido do Paulo (28/09): "toda reunião tem que sair com tarefas, prazos e responsáveis, e o House tem
   que mapear a cadência, a rotina e as responsabilidades, alertando o máximo possível".
   Uma tela pra ver se o combinado está virando rotina:
     1. Por pessoa — abertas, vencidas, sem prazo, % no prazo (30d), rotina do mês, reuniões com ata,
        por onde o aviso chega (WhatsApp / celular) e último acesso.
     2. Vencidas — em que degrau da escada está cada uma (dono → gestor → sócios).
     3. Ritos — reuniões previstas pela cadência × reuniões com ata (30 dias).
     4. Rotinas — liga/desliga por papel (ligada = vira tarefa todo período) + configuração da escada.
   Motor: api/v3/_ritmo_lib.py (heartbeat de hora em hora). Dados: /api/v3/diretoria/ritmo_gestao. */
import { api } from '../api.js';

let _root = null;
let _d = null;
let _previa = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const COR = { ok: '#239a5b', warn: '#c7861a', bad: '#d64545', mute: '#8a8579' };
const fmt = iso => iso ? String(iso).substring(0, 10).split('-').reverse().join('/') : '—';
const pct = v => v == null ? '—' : `${v}%`;
const corPct = v => v == null ? COR.mute : v >= 80 ? COR.ok : v >= 50 ? COR.warn : COR.bad;
const chip = (txt, cor) => `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:600;background:${cor}1f;color:${cor};white-space:nowrap">${txt}</span>`;
const PAPEL = { isa: 'Isabella', kaue: 'Kauê', paulo: 'Paulo', map: 'Equipe MAP' };

export async function pageRitmoGestao(ctx, root) {
  _root = root;
  _root.innerHTML = '<div class="card"><div class="muted tiny"><span class="spinner"></span> Lendo a cadência…</div></div>';
  await load();
}

async function load() {
  try {
    _d = await api.request('/api/v3/diretoria/ritmo_gestao');
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function acessoTxt(iso) {
  if (!iso) return chip('sem acesso em 30d', COR.bad);
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return dias <= 0 ? chip('hoje', COR.ok) : dias <= 2 ? chip(`${dias}d atrás`, COR.ok) : chip(`${dias}d atrás`, dias <= 6 ? COR.warn : COR.bad);
}

function canais(p) {
  const out = [];
  if (p.whatsapp) out.push(chip('WhatsApp', COR.ok));
  if (p.push) out.push(chip('celular', COR.ok));
  return out.length ? out.join(' ') : chip('só dentro do House', COR.bad);
}

function render() {
  const d = _d;
  const nome = id => (d.usuarios.find(u => u.id === id) || {}).nome || id || '—';
  const semCanal = d.pessoas.filter(p => !p.whatsapp && !p.push);
  const venc = d.vencidas.length;
  const reunPrev = d.reunioes.reduce((a, r) => a + r.previstas, 0);
  const reunAta = d.reunioes.reduce((a, r) => a + r.com_ata, 0);
  const rotAtivas = d.rotinas.filter(r => r.ativa).length;

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🔁 Alertas & cobrança <span class="tiny muted" style="font-weight:400">(Ritmo da Gestão)</span></h2>
      <p class="card-sub">Se o combinado está virando rotina. Toda reunião sai com tarefa (dono + prazo), toda rotina ligada vira tarefa a cada período,
        e tarefa vencida sobe sozinha: <b>véspera → dono</b> · <b>+${d.config.escada.gestor} dias → gestor</b> · <b>+${d.config.escada.socios} dias → os dois sócios</b>.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px" class="mt-2">
        ${tile('Tarefas vencidas', venc, 'de todas as pessoas', venc ? COR.bad : COR.ok)}
        ${tile('Ritos com ata (30d)', reunPrev ? `${reunAta}/${reunPrev}` : '—', 'reuniões previstas pela cadência', corPct(reunPrev ? Math.round(reunAta / reunPrev * 100) : null))}
        ${tile('Rotinas ligadas', `${rotAtivas}/${d.rotinas.length}`, 'geram tarefa todo período', rotAtivas ? COR.ok : COR.warn)}
        ${tile('Sem aviso fora do House', semCanal.length, semCanal.length ? semCanal.map(p => p.nome.split(' ')[0]).join(', ') : 'todos recebem', semCanal.length ? COR.bad : COR.ok)}
      </div>
      ${semCanal.length ? `<div class="alert mt-2" style="background:${COR.bad}14;border:1px solid ${COR.bad}55;border-radius:10px;padding:10px 12px;font-size:13px">
        <b>O alarme só toca dentro do House para ${semCanal.length} pessoa(s).</b> Cada um cadastra o WhatsApp em <a href="#/">☀️ Meu dia</a> (e ativa as notificações no celular) —
        sem isso, quem não abre o sistema nunca recebe a cobrança.${d.wa_servidor ? '' : ' <b>E o servidor ainda está sem WhatsApp configurado (Evolution).</b>'}</div>` : ''}
    </div>

    <div class="card mt-3">
      <h3 class="card-title" style="font-size:16px">👥 Por pessoa</h3>
      <div style="overflow-x:auto"><table class="table" style="width:100%;min-width:880px;font-size:13px">
        <thead><tr><th>Pessoa</th><th>Gestor</th><th style="text-align:right">Abertas</th><th style="text-align:right">Vencidas</th><th style="text-align:right">Sem prazo</th>
          <th style="text-align:right">No prazo (30d)</th><th style="text-align:right">Rotina (mês)</th><th style="text-align:right">Ritos c/ ata</th><th>Aviso chega por</th><th>Último acesso</th></tr></thead>
        <tbody>${d.pessoas.map(p => `<tr>
          <td><b>${esc(p.nome)}</b><div class="tiny muted">${esc(p.role || '')}</div></td>
          <td class="tiny">${esc(nome(p.gestor))}</td>
          <td style="text-align:right">${p.abertas}</td>
          <td style="text-align:right;color:${p.vencidas ? COR.bad : 'inherit'};font-weight:${p.vencidas ? 700 : 400}">${p.vencidas}</td>
          <td style="text-align:right;color:${p.sem_prazo ? COR.warn : 'inherit'}">${p.sem_prazo}</td>
          <td style="text-align:right">${p.concluidas_30d ? chip(`${pct(p.pct_no_prazo)} de ${p.concluidas_30d}`, corPct(p.pct_no_prazo)) : '<span class="tiny muted">nada concluído</span>'}</td>
          <td style="text-align:right">${p.rotina_pct == null ? '<span class="tiny muted">sem rotina</span>' : chip(pct(p.rotina_pct), corPct(p.rotina_pct))}</td>
          <td style="text-align:right">${p.reun_previstas ? chip(`${p.reun_com_ata}/${p.reun_previstas}`, corPct(Math.round(p.reun_com_ata / p.reun_previstas * 100))) : '<span class="tiny muted">—</span>'}</td>
          <td>${canais(p)}</td>
          <td>${acessoTxt(p.ultimo_acesso)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny muted mt-1">"No prazo" = tarefas concluídas nos últimos 30 dias até a data combinada. "Ritos c/ ata" = reuniões da cadência em que a pessoa é dona × quantas têm ata.</p>
    </div>

    <div class="card mt-3">
      <h3 class="card-title" style="font-size:16px">⏰ Vencidas — onde cada uma está na escada</h3>
      ${d.vencidas.length ? `<div style="overflow-x:auto"><table class="table" style="width:100%;min-width:640px;font-size:13px">
        <thead><tr><th>Tarefa</th><th>Dono</th><th>Prazo</th><th style="text-align:right">Atraso</th><th>Já avisado</th></tr></thead>
        <tbody>${d.vencidas.map(v => `<tr>
          <td>${esc(v.titulo)}<div class="tiny muted">${esc(v.categoria || '')}</div></td>
          <td>${esc(v.dono_nome)}</td><td class="tiny">${fmt(v.prazo)}</td>
          <td style="text-align:right;font-weight:700;color:${v.dias >= d.config.escada.socios ? COR.bad : v.dias >= d.config.escada.gestor ? COR.warn : 'inherit'}">${v.dias}d</td>
          <td>${v.estagio === 'sócios' ? chip('sócios', COR.bad) : v.estagio === 'gestor' ? chip('gestor', COR.warn) : chip('dono', COR.mute)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="tiny muted">Nenhuma tarefa vencida. 🎉</div>'}
    </div>

    <div class="card mt-3">
      <h3 class="card-title" style="font-size:16px">📋 Ritos da cadência (30 dias)</h3>
      <p class="tiny muted" style="margin-top:-4px">Reunião prevista e sem ata no dia seguinte = aviso ao dono. Ao registrar em <a href="#/reunioes">Reuniões</a>, escolha o rito — é assim que o House sabe que ela aconteceu.</p>
      <div style="overflow-x:auto"><table class="table" style="width:100%;min-width:560px;font-size:13px">
        <thead><tr><th>Rito</th><th>Dono</th><th style="text-align:right">Previstas</th><th style="text-align:right">Com ata</th><th>Última ata</th></tr></thead>
        <tbody>${d.reunioes.map(r => `<tr><td>${esc(r.emoji || '📋')} ${esc(r.nome)}</td><td>${esc(nome(r.dono))}</td>
          <td style="text-align:right">${r.previstas}</td>
          <td style="text-align:right">${chip(`${r.com_ata}`, corPct(r.previstas ? Math.round(r.com_ata / r.previstas * 100) : null))}</td>
          <td class="tiny">${fmt(r.ultima_ata)}</td></tr>`).join('') || '<tr><td colspan="5" class="tiny muted">Nenhum rito previsto no período.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card mt-3">
      <h3 class="card-title" style="font-size:16px">🔁 Rotinas que viram tarefa</h3>
      <p class="tiny muted" style="margin-top:-4px">Ligada = cada item vira uma tarefa com prazo no fim do período (dia, semana, quinzena, mês, trimestre) e entra na escada.
        Diária não feita fecha como "não feita" no dia seguinte. Os itens de cada rotina se editam nas abas <a href="#/reunioes?tab=imoveis">🏠 Rotina · PSM Imóveis</a> e <a href="#/reunioes?tab=conquista">🎯 Rotina · PSM Conquista</a>.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px">
        ${d.rotinas.map(r => `<label style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start;cursor:${d.pode_editar ? 'pointer' : 'default'}">
          <input type="checkbox" data-rot="${esc(r.chave)}" ${r.ativa ? 'checked' : ''} ${d.pode_editar ? '' : 'disabled'} style="margin-top:3px">
          <span><b>${esc(PAPEL[r.papel] || r.quem)}</b> · ${esc(r.unidade)}<br>
            <span class="tiny muted">${r.itens} itens · aderência do mês ${pct(r.aderencia_mes)}</span></span></label>`).join('')}
      </div>
    </div>

    ${d.pode_editar ? configHTML(d, nome) : ''}

    <div class="card mt-3">
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost" id="cd-previa">👁 Prévia do que sai agora</button>
        ${d.pode_editar ? '<button class="btn btn-primary" id="cd-rodar">▶ Rodar agora</button>' : ''}
        <span class="tiny muted">O motor roda sozinho de hora em hora (7h–22h, seg–sáb). Cada aviso sai uma vez por degrau.</span>
      </div>
      <div id="cd-previa-box" class="mt-2">${_previa ? previaHTML(_previa, nome) : ''}</div>
    </div>`;
  wire();
}

function tile(lbl, val, sub, cor) {
  return `<div style="border:1px solid var(--border);border-radius:12px;padding:10px 12px">
    <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.04em">${esc(lbl)}</div>
    <div style="font-size:24px;font-weight:800;color:${cor};font-variant-numeric:tabular-nums">${esc(val)}</div>
    <div class="tiny muted">${esc(sub)}</div></div>`;
}

function configHTML(d, nome) {
  const c = d.config;
  const pessoas = d.pessoas;
  const av = c.avisos || {};
  const AV = [['vespera', 'Véspera do prazo → dono'], ['gestor', 'Atraso → gestor'], ['socios', 'Atraso longo → sócios'],
    ['reuniao_sem_ata', 'Rito sem ata → dono'], ['sem_prazo', 'Segunda: tarefas sem prazo → dono']];
  return `<div class="card mt-3">
    <h3 class="card-title" style="font-size:16px">⚙️ Escada e responsáveis</h3>
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end">
      <div><label class="tiny muted">Dias de atraso até avisar o gestor</label><input id="cd-eg" class="input" type="number" min="1" max="60" value="${c.escada.gestor}" style="width:120px"></div>
      <div><label class="tiny muted">Dias de atraso até avisar os sócios</label><input id="cd-es" class="input" type="number" min="1" max="60" value="${c.escada.socios}" style="width:120px"></div>
    </div>
    <div class="flex gap-2 mt-2" style="flex-wrap:wrap">${AV.map(([k, l]) => `<label class="tiny flex gap-1" style="align-items:center;border:1px solid var(--border);border-radius:8px;padding:5px 9px">
      <input type="checkbox" data-av="${k}" ${av[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    <div class="tiny muted mt-3" style="font-weight:600">Gestor de cada pessoa (quem recebe o atraso dela)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px" class="mt-1">
      ${pessoas.map(p => `<label class="tiny" style="display:flex;gap:6px;align-items:center"><span style="min-width:90px">${esc(p.nome.split(' ')[0])}</span>
        <select class="input" data-gestor="${esc(p.id)}" style="flex:1"><option value="">— ninguém —</option>
        ${d.usuarios.filter(u => u.id !== p.id).map(u => `<option value="${esc(u.id)}"${(c.gestores || {})[p.id] === u.id || (!(c.gestores || {})[p.id] && p.gestor === u.id) ? ' selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></label>`).join('')}
    </div>
    <div class="mt-2"><button class="btn btn-primary btn-sm" id="cd-salvar">💾 Salvar escada e gestores</button></div>
  </div>`;
}

function previaHTML(r, nome) {
  if (r.error) return `<div class="alert alert-err">${esc(r.error)}</div>`;
  const msgs = r.mensagens || {};
  const env = r.enviados;
  const rot = r.rotina || {};
  const linhas = env ? env.map(e => `<li><b>${esc(nome(e.para))}</b> — ${e.itens} aviso(s) · ${esc((e.canais || []).join(', ') || 'nenhum canal')}</li>`).join('')
    : Object.entries(msgs).map(([u, ls]) => `<li><b>${esc(nome(u))}</b><ul>${ls.map(l => `<li>${esc(l)}</li>`).join('')}</ul></li>`).join('');
  return `<div style="border:1px dashed var(--border);border-radius:10px;padding:10px 12px;font-size:13px">
    <div><b>${env ? 'Rodou agora' : 'Prévia (nada foi enviado)'}</b> · rotina: ${rot.criadas || 0} tarefa(s) ${env ? 'criadas' : 'a criar'}${rot.sincronizadas ? ` · ${rot.sincronizadas} sincronizada(s)` : ''}${rot.diarias_fechadas ? ` · ${rot.diarias_fechadas} diária(s) fechadas` : ''}</div>
    ${linhas ? `<ul style="margin:6px 0 0;padding-left:18px">${linhas}</ul>` : '<div class="tiny muted mt-1">Nenhum aviso novo agora — cada degrau sai uma vez só.</div>'}</div>`;
}

function wire() {
  const nome = id => (_d.usuarios.find(u => u.id === id) || {}).nome || id || '—';
  _root.querySelectorAll('[data-rot]').forEach(el => el.onchange = async () => {
    try {
      await api.request('/api/v3/diretoria/ritmo_gestao', { method: 'POST', body: { action: 'config', rotinas_ativas: { [el.dataset.rot]: el.checked } } });
      await load();
    } catch (e) { alert('Erro: ' + e.message); el.checked = !el.checked; }
  });
  const salvar = _root.querySelector('#cd-salvar');
  if (salvar) salvar.onclick = async () => {
    const gestores = {};
    _root.querySelectorAll('[data-gestor]').forEach(s => { gestores[s.dataset.gestor] = s.value || null; });
    const avisos = {};
    _root.querySelectorAll('[data-av]').forEach(c => { avisos[c.dataset.av] = c.checked; });
    salvar.disabled = true; salvar.textContent = '⏳ Salvando…';
    try {
      await api.request('/api/v3/diretoria/ritmo_gestao', { method: 'POST', body: {
        action: 'config', gestores, avisos,
        escada: { gestor: +_root.querySelector('#cd-eg').value, socios: +_root.querySelector('#cd-es').value } } });
      await load();
    } catch (e) { alert('Erro: ' + e.message); salvar.disabled = false; salvar.textContent = '💾 Salvar escada e gestores'; }
  };
  const prev = _root.querySelector('#cd-previa');
  if (prev) prev.onclick = async () => {
    prev.disabled = true; prev.textContent = '⏳ Calculando…';
    try { _previa = await api.request('/api/v3/tasks/ritmo_cron?dry=1'); } catch (e) { _previa = { error: e.message }; }
    _root.querySelector('#cd-previa-box').innerHTML = previaHTML(_previa, nome);
    prev.disabled = false; prev.textContent = '👁 Prévia do que sai agora';
  };
  const rodar = _root.querySelector('#cd-rodar');
  if (rodar) rodar.onclick = async () => {
    rodar.disabled = true; rodar.textContent = '⏳ Rodando…';
    try { _previa = await api.request('/api/v3/tasks/ritmo_cron?agora=1'); await load(); }
    catch (e) { alert('Erro: ' + e.message); rodar.disabled = false; rodar.textContent = '▶ Rodar agora'; }
  };
}
