/* ============================================================================
   PSM-OS v2 — 📅 Agenda & Tarefas · alertas e conexões (v87.81)
   Tudo que liga a agenda ao mundo de fora, num cartão só:
     📲 notificações neste aparelho (Web Push) + teste
     ⏰ lembretes padrão (compromisso / tarefa com horário) + resumo das 8h
     📮 Zoho Calendar (2 vias, por usuário) — veio da antiga aba Agenda
     📆 assinatura pro Google Agenda / iPhone / Outlook (link .ics secreto)
     🚪 salas de reunião do escritório (Zoho → Recursos) — veio da antiga aba Agenda
============================================================================ */
import { api } from './api.js';
import { enablePush, pushSupported, pushPermission } from './push.js';
import { esc, toast, abrirModal } from './agenda-ui.js';

export const LEMBRETE_OPCOES = [
  [-1, 'Sem lembrete'], [0, 'Na hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'],
  [30, '30 min antes'], [60, '1 hora antes'], [120, '2 horas antes'], [1440, '1 dia antes'],
];
export const rotuloLembrete = m => (LEMBRETE_OPCOES.find(([v]) => v === Number(m)) || [null, `${m} min antes`])[1];

let _prefs = null;          // último GET /agenda/prefs
let _prefsP = null;
export function carregarPrefs(force) {
  if (!force && _prefsP) return _prefsP;
  _prefsP = api.request('/api/v3/agenda/prefs').then(r => { _prefs = r; return r; }).catch(() => { _prefsP = null; return _prefs; });
  return _prefsP;
}
export const prefsAtuais = () => _prefs;

/* ── Zoho: puxa em segundo plano quando a última sync é velha ─────────────── */
let _ultimaTentativaZoho = 0;
export async function sincronizarZohoSeVelho() {
  if (Date.now() - _ultimaTentativaZoho < 3 * 60 * 1000) return false;
  _ultimaTentativaZoho = Date.now();
  let st;
  try { st = await api.request('/api/v3/zoho/status'); } catch { return false; }
  if (!st || !st.configurado || !st.conectado) return false;
  const ult = st.last_sync_at ? new Date(st.last_sync_at).getTime() : 0;
  if (Date.now() - ult < 3 * 60 * 1000) return false;
  try {
    const r = await api.request('/api/v3/zoho/sync', { method: 'POST', body: {} });
    return ((r.criados_house || 0) + (r.atualizados_house || 0) + (r.apagados_house || 0)) > 0;
  } catch { return false; }
}

async function pushNesteAparelho() {
  if (!pushSupported()) return 'sem-suporte';
  const perm = pushPermission();
  if (perm === 'denied') return 'bloqueado';
  if (perm !== 'granted') return 'desligado';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'ligado' : 'desligado';
  } catch { return 'desligado'; }
}

const ehIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '');
const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

/** Cartão "Alertas e conexões". aoMudarAgenda() é chamado quando uma sync trouxe novidade. */
export async function montarConexoes(host, { aoMudarAgenda } = {}) {
  if (!host) return;
  host.innerHTML = `<h4>🔔 Alertas e conexões</h4><div class="at-muted" style="font-size:12px">Carregando…</div>`;
  const [prefs, zoho, push] = await Promise.all([
    carregarPrefs(true),
    api.request('/api/v3/zoho/status').catch(() => null),
    pushNesteAparelho(),
  ]);
  if (!host.isConnected) return;
  const p = (prefs && prefs.prefs) || { lembrete_evento_min: 30, lembrete_tarefa_min: 15, resumo_diario: true };
  const opts = sel => LEMBRETE_OPCOES.map(([v, l]) => `<option value="${v}"${Number(sel) === v ? ' selected' : ''}>${l}</option>`).join('');

  const pushLinha = {
    'ligado': `<small><span class="ok">● Ativadas neste aparelho</span>${prefs && prefs.push && prefs.push.inscricoes > 1 ? ` · ${prefs.push.inscricoes} aparelhos` : ''}</small>
               <div class="at-cx-bts"><button class="at-mini-b" data-cx="teste">Enviar teste</button></div>`,
    'desligado': `<small>Receba lembretes e convites mesmo com o House fechado.</small>
               <div class="at-cx-bts"><button class="btn btn-primary btn-sm" data-cx="push">Ativar notificações</button></div>`,
    'bloqueado': `<small><span class="err">● Bloqueadas</span> no navegador. Libere em Configurações do site → Notificações e recarregue.</small>`,
    'sem-suporte': ehIOS() && !standalone()
      ? `<small>No iPhone: toque em <b>Compartilhar → Adicionar à Tela de Início</b>, abra o House por esse ícone e ative aqui.</small>`
      : `<small>Este navegador não recebe notificações push. O sino do House continua avisando.</small>`,
  }[push];
  const pushSemServidor = prefs && prefs.push && prefs.push.configurado === false;

  let zohoLinha = '';
  if (zoho && zoho.configurado) {
    if (!zoho.conectado) {
      zohoLinha = `<small>Sincroniza nos dois sentidos: o que você marca aqui vai pro Zoho e o do Zoho aparece aqui.</small>
        <div class="at-cx-bts"><button class="btn btn-primary btn-sm" data-cx="zoho-conn">Conectar meu Zoho</button></div>`;
    } else {
      const r = zoho.last_sync_res || {};
      const quando = zoho.last_sync_at ? new Date(zoho.last_sync_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não';
      zohoLinha = `<small><span class="ok">● Conectado</span> ${esc(zoho.zoho_email || '')}<br>Última sincronização: ${esc(quando)}${r.puxados != null ? ` · ↓${r.puxados} ↑${r.enviados || 0}` : ''}</small>
        <div class="at-cx-bts"><button class="at-mini-b" data-cx="zoho-sync">🔄 Sincronizar agora</button><button class="at-mini-b" data-cx="zoho-off">Desconectar</button></div>`;
    }
  }

  const ics = prefs && prefs.ics_url;
  host.innerHTML = `<h4>🔔 Alertas e conexões</h4>
    <div class="at-cx-row"><div class="at-cx-ico">📲</div><div class="at-cx-t"><b>Notificações neste aparelho</b>
      ${pushSemServidor ? '<small>O envio de push ainda não foi ligado no servidor. O sino do House avisa normalmente.</small>' : pushLinha}</div></div>
    <div class="at-cx-row"><div class="at-cx-ico">⏰</div><div class="at-cx-t"><b>Lembretes</b>
      <small>Aviso no sino e no celular antes do horário.</small>
      <div class="at-cx-f">
        <span>Compromissos</span><select data-pref="lembrete_evento_min" aria-label="Lembrete de compromissos">${opts(p.lembrete_evento_min)}</select>
        <span>Tarefas com horário</span><select data-pref="lembrete_tarefa_min" aria-label="Lembrete de tarefas">${opts(p.lembrete_tarefa_min)}</select>
        <label style="grid-column:span 2;display:flex;gap:7px;align-items:center;cursor:pointer"><input type="checkbox" data-pref="resumo_diario" ${p.resumo_diario !== false ? 'checked' : ''}> Resumo do dia às 8h no celular</label>
      </div></div></div>
    ${zohoLinha ? `<div class="at-cx-row"><div class="at-cx-ico">📮</div><div class="at-cx-t"><b>Zoho Calendar</b>${zohoLinha}</div></div>` : ''}
    <div class="at-cx-row"><div class="at-cx-ico">📆</div><div class="at-cx-t"><b>Google Agenda · iPhone · Outlook</b>
      ${ics ? `<small>Seu link secreto de assinatura (atualiza sozinho). Não compartilhe.</small>
        <div class="at-cx-url"><input readonly value="${esc(ics)}" aria-label="Link de assinatura"><button class="at-mini-b" data-cx="ics-copiar">Copiar</button></div>
        <details class="at-help"><summary>Como assinar</summary><ol>
          <li><b>Google Agenda</b> (computador): Outras agendas → <b>+</b> → Do URL → cole o link.</li>
          <li><b>iPhone</b>: Ajustes → Calendário → Contas → Adicionar Conta → Outra → Adicionar Calendário Assinado.</li>
          <li><b>Outlook</b>: Adicionar calendário → Assinar da Web → cole o link.</li>
        </ol><div style="margin-top:6px">O Google atualiza a cada poucas horas; o iPhone deixa escolher. Pra mudanças na hora, use o Zoho.</div></details>
        <div class="at-cx-bts"><button class="at-mini-b" data-cx="ics-trocar">Gerar outro link</button><button class="at-mini-b" data-cx="ics-off">Desligar</button></div>`
      : `<small>Veja seus compromissos e tarefas do House no calendário do celular.</small>
        <div class="at-cx-bts"><button class="at-mini-b" data-cx="ics-gerar">Gerar link de assinatura</button></div>`}
    </div></div>`;

  host.querySelectorAll('[data-pref]').forEach(el => el.addEventListener('change', async () => {
    const k = el.dataset.pref;
    const v = el.type === 'checkbox' ? el.checked : Number(el.value);
    try {
      const r = await api.request('/api/v3/agenda/prefs', { method: 'POST', body: { prefs: { [k]: v } } });
      _prefs = r; _prefsP = Promise.resolve(r);
      toast('✅ Preferência salva');
    } catch (e) { toast('❌ Não salvou: ' + e.message); }
  }));

  const acoes = {
    push: async () => { if (await enablePush()) { toast('✅ Notificações ativadas neste aparelho'); montarConexoes(host, { aoMudarAgenda }); } },
    teste: async () => {
      try { await api.request('/api/v3/agenda/prefs', { method: 'POST', body: { action: 'teste' } }); toast('📨 Teste enviado. Deve chegar em alguns segundos.'); }
      catch (e) { toast('❌ ' + e.message); }
    },
    'zoho-conn': async () => {
      try { const r = await api.request('/api/v3/zoho/connect'); if (r.url) location.href = r.url; }
      catch (e) { toast('❌ Não consegui iniciar a conexão: ' + e.message); }
    },
    'zoho-sync': async b => {
      b.disabled = true; b.textContent = '⏳ Sincronizando…';
      try {
        const s = await api.request('/api/v3/zoho/sync', { method: 'POST', body: {} });
        toast(`🔄 Zoho: ↓ ${s.puxados || 0} recebidos (${s.criados_house || 0} novos) · ↑ ${s.enviados || 0} enviados`);
        if (aoMudarAgenda) aoMudarAgenda();
        montarConexoes(host, { aoMudarAgenda });
      } catch (e) { toast('❌ Sync: ' + e.message); b.disabled = false; b.textContent = '🔄 Sincronizar agora'; }
    },
    'zoho-off': async () => {
      if (!confirm('Desconectar seu Zoho? O que já foi sincronizado continua na agenda; mudanças novas param de ir e vir.')) return;
      try { await api.request('/api/v3/zoho/status', { method: 'POST', body: { action: 'disconnect' } }); montarConexoes(host, { aoMudarAgenda }); }
      catch (e) { toast('❌ ' + e.message); }
    },
    'ics-gerar': () => gerarIcs(host, aoMudarAgenda),
    'ics-trocar': () => { if (confirm('Gerar outro link? O link atual para de funcionar em todos os calendários onde foi colado.')) gerarIcs(host, aoMudarAgenda); },
    'ics-off': async () => {
      if (!confirm('Desligar o link? Os calendários assinados param de receber a sua agenda.')) return;
      try { await api.request('/api/v3/agenda/prefs', { method: 'POST', body: { action: 'ics_revogar' } }); montarConexoes(host, { aoMudarAgenda }); }
      catch (e) { toast('❌ ' + e.message); }
    },
    'ics-copiar': async () => {
      const inp = host.querySelector('.at-cx-url input');
      try { await navigator.clipboard.writeText(inp.value); toast('📋 Link copiado'); }
      catch { inp.select(); document.execCommand && document.execCommand('copy'); toast('📋 Link selecionado — copie com Ctrl/Cmd+C'); }
    },
  };
  host.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => acoes[b.dataset.cx] && acoes[b.dataset.cx](b)));
}

async function gerarIcs(host, aoMudarAgenda) {
  try {
    await api.request('/api/v3/agenda/prefs', { method: 'POST', body: { action: 'ics_gerar' } });
    await montarConexoes(host, { aoMudarAgenda });
    const d = host.querySelector('.at-help');
    if (d) d.open = true;
  } catch (e) { toast('❌ ' + e.message); }
}

/* ── 🚪 Salas de reunião (Zoho → Recursos → Localizações) ─────────────────
   Todo mundo vê o mapa do dia, mesmo quem não conectou o próprio Zoho: a sala é
   da empresa. RESERVAR exige a conexão da pessoa (senão nasce no nome errado). */
export async function montarSalas(host, dia, fmtData) {
  if (!host) return;
  host.innerHTML = `<h4>🚪 Salas de reunião</h4><div class="at-muted" style="font-size:12px">Consultando as salas…</div>`;
  let d;
  try { d = await api.request('/api/v3/zoho/salas?dia=' + dia); }
  catch { host.hidden = true; return; }
  if (!host.isConnected) return;
  if (!d.configurado) { host.hidden = true; return; }
  host.hidden = false;
  const titulo = `<h4>🚪 Salas · ${esc(fmtData(d.dia || dia))}</h4>`;
  if (d.sem_conexao) { host.innerHTML = titulo + `<div class="at-help">${esc(d.aviso || 'Conecte seu Zoho pra ver as salas.')}</div>`; return; }
  if (d.precisa_reconectar) {
    host.innerHTML = titulo + `<div class="at-help">Falta 1 passo: sua conexão do Zoho é anterior à permissão de <b>Recursos</b>. Desconecte e conecte de novo em "Alertas e conexões".</div>`;
    return;
  }
  if (d.erro_zoho || !(d.salas || []).length) {
    host.innerHTML = titulo + `<div class="at-help">${d.erro_zoho ? 'O Zoho recusou a consulta: ' + esc(d.erro_zoho) : 'Nenhuma sala cadastrada em Recursos → Localizações no Zoho.'}</div>`;
    return;
  }
  /* v84.68: o semáforo segue o ESTADO apurado no backend; "desconhecida" é cinza,
     nunca verde — o default "livre" mandava dois times pra mesma sala. */
  const E = s => ({
    ocupada: ['var(--err)', s.ate ? `ocupada até ${s.ate}` : 'ocupada'],
    livre: ['var(--ok)', s.proxima ? `livre até ${s.proxima}` : 'livre'],
    tem_reserva: ['var(--warn)', 'tem reserva'],
    sem_reserva: ['var(--ok)', 'dia livre'],
  }[s.estado] || ['var(--ink-muted)', 'não deu pra ler']);
  host.innerHTML = titulo + `<div class="at-list">${d.salas.map(s => {
    const [cor, txt] = E(s);
    const lista = (s.reservas || []).map(r => r.dia_todo ? 'dia todo' : `${r.inicio}–${r.fim}`).join(' · ');
    return `<div style="border:1px solid var(--border);border-left:3px solid ${cor};border-radius:9px;padding:8px 10px">
      <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap"><b style="font-size:12.5px">${esc(s.nome || 'Sala')}</b>
        <span style="font-size:11px;font-weight:800;color:${cor}">● ${esc(txt)}</span></div>
      <div class="at-help" style="margin-top:2px">${s.capacidade ? '👥 ' + esc(String(s.capacidade)) + ' lugares · ' : ''}${s.estado === 'desconhecida' ? 'Confirme no Zoho antes de ocupar.' : (lista ? '🕑 ' + esc(lista) : 'sem reservas')}</div>
      <button class="at-mini-b" style="margin-top:6px" data-sala="${esc(s.id)}" data-nome="${esc(s.nome || '')}">📌 Reservar</button>
    </div>`;
  }).join('')}</div>
  ${d.falta_permissao_horarios ? '<div class="at-help">🔑 Os horários das salas precisam de uma permissão nova: basta UMA pessoa reconectar o Zoho.</div>' : ''}
  ${!d.eu_conectado ? '<div class="at-help">Você está vendo pela conexão de um colega. Pra reservar, conecte seu Zoho.</div>' : ''}`;
  host.querySelectorAll('[data-sala]').forEach(b => b.onclick = () => reservarSala(host, b.dataset.sala, b.dataset.nome, d.dia || dia, fmtData));
}

function reservarSala(host, rid, nome, dia, fmtData) {
  const { el, fechar } = abrirModal({
    titulo: `📌 Reservar ${nome}`,
    corpo: `<div class="at-f">
      <label class="c2 keep">Dia<input type="date" id="rs-dia" value="${esc(dia)}"></label>
      <label class="c2 keep">Início<input type="time" id="rs-hi" value="09:00"></label>
      <label class="c2 keep">Término<input type="time" id="rs-hf" value="10:00"></label>
      <label class="c6">Assunto<input id="rs-tit" value="Reunião" maxlength="120"></label>
      <div class="c6 at-err" id="rs-err"></div></div>`,
    rodape: `<span class="at-sp"></span><button class="btn btn-ghost" data-x>Cancelar</button><button class="btn btn-primary" data-ok>Reservar</button>`,
    largura: 440,
  });
  el.querySelector('[data-x]').onclick = fechar;
  el.querySelector('[data-ok]').onclick = async ev => {
    const b = ev.currentTarget;
    const dia2 = el.querySelector('#rs-dia').value, hi = el.querySelector('#rs-hi').value, hf = el.querySelector('#rs-hf').value;
    if (!dia2 || !hi || !hf || hf <= hi) { el.querySelector('#rs-err').textContent = 'Confira o dia e os horários (o término vem depois do início).'; return; }
    b.disabled = true; b.textContent = 'Reservando…';
    try {
      await api.request('/api/v3/zoho/salas', { method: 'POST', body: { resource_id: rid, dia: dia2, hora_inicio: hi, hora_fim: hf, titulo: el.querySelector('#rs-tit').value || 'Reunião' } });
      fechar();
      toast(`✅ ${nome} reservada · ${fmtData(dia2)}, ${hi}–${hf}`);
      montarSalas(host, dia2, fmtData);
    } catch (e) {
      b.disabled = false; b.textContent = 'Reservar';
      el.querySelector('#rs-err').textContent = (e.data && e.data.precisa_conectar) ? 'Conecte seu Zoho primeiro — a sala é reservada no seu nome.' : 'Não consegui reservar: ' + (e.message || e);
    }
  };
}
