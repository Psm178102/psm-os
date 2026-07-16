/* PSM-OS v2 — Consultoria Arch Leg (RH › desenvolvimento humano). v84.78
   Ficha por PESSOA e por EQUIPE, preenchida pela Arch Leg (Marcos Anderson).
   Dado sensível: só sócio (lvl>=10) OU role consultor_arch_leg — trava no backend. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// perfis do teste comportamental do sistema (Águia/Gato/Tubarão/Lobo = DISC)
const PERFIS = {
  aguia:   { nome: 'Águia',   emoji: '🦅', cor: '#2563eb', lema: 'Fazer Diferente' },
  gato:    { nome: 'Gato',    emoji: '🐱', cor: '#16a34a', lema: 'Fazer Junto' },
  tubarao: { nome: 'Tubarão', emoji: '🦈', cor: '#dc2626', lema: 'Fazer Rápido' },
  lobo:    { nome: 'Lobo',    emoji: '🐺', cor: '#7c3aed', lema: 'Fazer Certo' },
};

let _root = null, _users = [], _teams = [], _dossies = {}, _ehArchLeg = false, _ehSocio = false;
let _modo = 'user';         // 'user' | 'team'
let _sel = '';              // id do alvo selecionado
let _disc = null;           // resultado DISC do usuário selecionado (puxado ao vivo)
let _mats = [];             // materiais em edição

function podeVer() {
  const u = auth.user() || {};
  return (u.lvl || 0) >= 10 || (u.role || '').toLowerCase() === 'consultor_arch_leg';
}

export async function pageArchLeg(ctx, root) {
  _root = root;
  if (!podeVer()) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Área restrita: só sócios e a consultoria Arch Leg.</div>';
    return;
  }
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando consultoria…</div></div>';
  try {
    const [ul, tl, dz] = await Promise.all([
      api.request('/api/v3/users/list?all=1').catch(() => ({ users: [] })),
      api.request('/api/v3/settings/teams').catch(() => ({ teams: [] })),
      api.request('/api/v3/gp/arch_leg'),
    ]);
    _users = (ul.users || ul.items || []).filter(u => (u.status || 'ativo') === 'ativo');
    _teams = tl.teams || [];
    _dossies = dz.dossies || {};
    _ehArchLeg = !!dz.eh_arch_leg; _ehSocio = !!dz.eh_socio;
  } catch (e) {
    root.innerHTML = `<div class="alert alert-err">Não consegui carregar: ${esc(e.message || e)}</div>`;
    return;
  }
  render();
}

const nomeUser = id => (_users.find(u => u.id === id) || {}).name || id;
const nomeTeam = id => { const t = _teams.find(x => x.id === id) || {}; return (t.ico ? t.ico + ' ' : '') + (t.lbl || id); };
const fichaDe = () => _dossies[`${_modo}:${_sel}`] || null;

function render() {
  const alvos = _modo === 'user'
    ? _users.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : _teams;
  const preenchidos = new Set(Object.keys(_dossies).filter(k => k.startsWith(_modo + ':')).map(k => k.slice(_modo.length + 1)));

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🧭 Consultoria Arch Leg</h2>
        <span class="tiny" style="background:#7c3aed18;color:#7c3aed;border-radius:20px;padding:2px 10px;font-weight:800">desenvolvimento humano</span>
      </div>
      <p class="card-sub">Ficha de acompanhamento por pessoa e por equipe. Conteúdo sigiloso — visível só à diretoria e à consultoria.</p>

      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        <button class="btn ${_modo === 'user' ? 'btn-primary' : 'btn-ghost'} btn-sm" id="al-modo-user">👤 Por pessoa</button>
        <button class="btn ${_modo === 'team' ? 'btn-primary' : 'btn-ghost'} btn-sm" id="al-modo-team">👥 Por equipe</button>
        <select class="select" id="al-sel" style="flex:1;min-width:220px;padding:6px 10px">
          <option value="">${_modo === 'user' ? 'Escolha a pessoa…' : 'Escolha a equipe…'}</option>
          ${alvos.map(a => {
            const id = a.id, nome = _modo === 'user' ? (a.name || id) : nomeTeam(id);
            return `<option value="${esc(id)}"${_sel === id ? ' selected' : ''}>${preenchidos.has(id) ? '📋 ' : ''}${esc(nome)}</option>`;
          }).join('')}
        </select>
      </div>
    </div>
    <div id="al-body" class="mt-2"></div>`;

  const $ = s => _root.querySelector(s);
  $('#al-modo-user').onclick = () => { _modo = 'user'; _sel = ''; _disc = null; render(); };
  $('#al-modo-team').onclick = () => { _modo = 'team'; _sel = ''; _disc = null; render(); };
  $('#al-sel').onchange = async e => { _sel = e.target.value; _disc = null; await onSelect(); };

  if (_sel) renderFicha();
}

async function onSelect() {
  _disc = null;
  if (_modo === 'user' && _sel) {
    // puxa o DISC do teste do sistema (não guardamos cópia aqui)
    try {
      const r = await api.request('/api/v3/profile/painel_extra?uid=' + encodeURIComponent(_sel));
      _disc = (r && (r.comportamental || (r.data && r.data.comportamental))) || null;
    } catch (_) { _disc = null; }
  }
  renderFicha();
}

function discHtml() {
  if (_modo !== 'user') return '';
  if (!_disc || !_disc.pct) {
    return `<div class="card mt-2"><b class="tiny">🧬 Perfil DISC (teste do sistema)</b>
      <div class="tiny muted mt-1">Esta pessoa ainda não fez o teste comportamental (Águia/Gato/Tubarão/Lobo) no <b>Meu Painel → Desenvolvimento</b>. Assim que fizer, o resultado aparece aqui automaticamente.</div></div>`;
  }
  const pct = _disc.pct || {};
  const ordem = ['aguia', 'gato', 'tubarao', 'lobo'].sort((a, b) => (pct[b] || 0) - (pct[a] || 0));
  const dom = PERFIS[_disc.dominante] || PERFIS[ordem[0]];
  const data = (_disc.data || '').slice(0, 10).split('-').reverse().join('/');
  return `<div class="card mt-2" style="border-left:3px solid ${dom.cor}">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b class="tiny">🧬 Perfil DISC</b>
      <span class="tiny muted">gerado pelo teste do sistema${data ? ' · ' + data : ''}</span>
    </div>
    <div style="font-size:15px;font-weight:800;color:${dom.cor};margin-top:6px">${dom.emoji} ${dom.nome} <span class="tiny" style="opacity:.7">— "${dom.lema}"</span></div>
    <div class="mt-2" style="display:grid;grid-template-columns:auto 1fr auto;gap:5px 8px;align-items:center;max-width:360px">
      ${ordem.map(k => { const p = pct[k] || 0; return `<div style="font-weight:700">${PERFIS[k].emoji} ${PERFIS[k].nome}</div>
        <div style="height:8px;background:var(--bg-3,#eef2f7);border-radius:5px;overflow:hidden"><i style="display:block;height:100%;width:${p}%;background:${PERFIS[k].cor}"></i></div>
        <div style="text-align:right;font-weight:800;color:${PERFIS[k].cor}">${p}%</div>`; }).join('')}
    </div>
  </div>`;
}

function ta(id, label, val, ph, rows) {
  return `<div class="mt-2"><label class="tiny muted" style="font-weight:700;display:block;margin-bottom:3px">${label}</label>
    <textarea class="input" id="${id}" rows="${rows || 3}" placeholder="${esc(ph || '')}">${esc(val || '')}</textarea></div>`;
}

function renderFicha() {
  const body = _root.querySelector('#al-body');
  if (!_sel) { body.innerHTML = ''; return; }
  const f = fichaDe() || {};
  const cr = f.crencas || {}; const pl = f.plano || {};
  _mats = (f.materiais || []).slice();
  const nome = _modo === 'user' ? nomeUser(_sel) : nomeTeam(_sel);

  body.innerHTML = `
    ${discHtml()}
    <div class="card mt-2">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <b>${_modo === 'user' ? '👤' : '👥'} ${esc(nome)}</b>
        ${f.atualizado_em ? `<span class="tiny muted">última edição ${esc((f.atualizado_em || '').slice(0, 10).split('-').reverse().join('/'))}${f.atualizado_por_nome ? ' · ' + esc(f.atualizado_por_nome) : ''}</span>` : '<span class="tiny muted">ficha nova</span>'}
      </div>

      ${ta('al-nota', '📝 Nota', f.nota, 'Observação geral, avaliação da consultoria…', 3)}
      ${ta('al-historia', '📖 História', f.historia, 'Trajetória, contexto de vida e carreira…', 4)}
      ${ta('al-fortes', '💪 Pontos fortes e habilidades', f.pontos_fortes, 'O que essa pessoa/equipe faz de melhor…', 3)}
      ${ta('al-pilar', '🏛 Pilar familiar', f.pilar_familiar, 'Pontos de origem de traumas, problemas, dinâmica familiar…', 3)}
      ${ta('al-traumas', '🩹 Traumas', f.traumas, 'Traumas identificados…', 3)}

      <div class="mt-3" style="border-top:1px solid var(--bd,#eef2f7);padding-top:8px">
        <b class="tiny">🧠 Crenças limitantes</b>
        ${ta('al-cr-esp', '· Espiritual', cr.espiritual, 'Crenças limitantes espirituais…', 2)}
        ${ta('al-cr-emo', '· Emocional', cr.emocional, 'Crenças limitantes emocionais…', 2)}
        ${ta('al-cr-pro', '· Profissional', cr.profissional, 'Crenças limitantes profissionais…', 2)}
      </div>

      <div class="mt-3" style="border-top:1px solid var(--bd,#eef2f7);padding-top:8px">
        <b class="tiny">🎯 Plano de progresso</b>
        ${ta('al-plano-obj', '· Objetivo', pl.objetivo, 'Onde quer chegar…', 2)}
        <div class="mt-2"><label class="tiny muted" style="font-weight:700;display:block;margin-bottom:3px">· Prazo</label>
          <input class="input" id="al-plano-prazo" value="${esc(pl.prazo || '')}" placeholder="ex.: 90 dias, dez/2026…" style="max-width:220px"></div>
      </div>

      ${ta('al-atencao', '⚠️ Ponto de atenção', f.ponto_atencao, 'O que exige cuidado, gatilhos, alertas…', 3)}

      <div class="mt-3" style="border-top:1px solid var(--bd,#eef2f7);padding-top:8px">
        <div class="flex items-center" style="gap:8px">
          <b class="tiny">📎 Materiais (PDF · Word · imagens)</b>
          <button class="btn btn-ghost btn-sm" id="al-mat-add" style="margin-left:auto">+ adicionar link do Drive</button>
        </div>
        <div id="al-mats" class="mt-1"></div>
      </div>

      <div class="flex mt-3" style="gap:8px">
        ${f.atualizado_em ? '<button class="btn btn-ghost btn-sm" id="al-del" style="color:#dc2626">🗑 Apagar ficha</button>' : ''}
        <button class="btn btn-primary" id="al-save" style="margin-left:auto">💾 Salvar ficha</button>
      </div>
    </div>`;

  renderMats();
  const $ = s => body.querySelector(s);
  $('#al-mat-add').onclick = () => { coletaMats(); _mats.push({ nome: '', url: '' }); renderMats(); };
  $('#al-save').onclick = salvar;
  if ($('#al-del')) $('#al-del').onclick = apagar;
}

function renderMats() {
  const box = _root.querySelector('#al-mats');
  if (!box) return;
  box.innerHTML = _mats.length ? _mats.map((m, i) => `
    <div class="flex gap-2 mt-1" data-mat="${i}" style="flex-wrap:wrap;align-items:center">
      <input class="input mat-nome" value="${esc(m.nome || '')}" placeholder="Nome (ex.: Laudo DISC.pdf)" style="flex:1;min-width:150px">
      <input class="input mat-url" value="${esc(m.url || '')}" placeholder="Link do Google Drive" style="flex:2;min-width:200px">
      <button class="btn btn-ghost btn-sm mat-del" data-i="${i}" style="color:#dc2626">✕</button>
    </div>`).join('') : '<div class="tiny muted mt-1">Nenhum material anexado. Cole o link da pasta ou arquivo do Drive.</div>';
  box.querySelectorAll('.mat-del').forEach(b => b.onclick = () => { coletaMats(); _mats.splice(+b.dataset.i, 1); renderMats(); });
}

function coletaMats() {
  const box = _root.querySelector('#al-mats');
  if (!box) return;
  _mats = [...box.querySelectorAll('[data-mat]')].map(row => ({
    nome: row.querySelector('.mat-nome').value.trim(),
    url: row.querySelector('.mat-url').value.trim(),
  })).filter(m => m.url);
}

async function salvar() {
  coletaMats();
  const $ = s => _root.querySelector(s);
  const body = {
    action: 'upsert', alvo_tipo: _modo, alvo_id: _sel,
    nota: $('#al-nota').value.trim(),
    historia: $('#al-historia').value.trim(),
    pontos_fortes: $('#al-fortes').value.trim(),
    pilar_familiar: $('#al-pilar').value.trim(),
    traumas: $('#al-traumas').value.trim(),
    crencas: { espiritual: $('#al-cr-esp').value.trim(), emocional: $('#al-cr-emo').value.trim(), profissional: $('#al-cr-pro').value.trim() },
    plano: { objetivo: $('#al-plano-obj').value.trim(), prazo: $('#al-plano-prazo').value.trim() },
    ponto_atencao: $('#al-atencao').value.trim(),
    materiais: _mats,
  };
  const btn = $('#al-save'); if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const r = await api.request('/api/v3/gp/arch_leg', { method: 'POST', body });
    _dossies[`${_modo}:${_sel}`] = r.ficha;
    render();
    alert('✅ Ficha salva.');
  } catch (e) {
    alert('❌ Não salvou: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar ficha'; }
  }
}

async function apagar() {
  if (!confirm('Apagar a ficha de "' + (_modo === 'user' ? nomeUser(_sel) : nomeTeam(_sel)) + '"? Não dá pra desfazer.')) return;
  try {
    await api.request('/api/v3/gp/arch_leg', { method: 'POST', body: { action: 'delete', alvo_tipo: _modo, alvo_id: _sel } });
    delete _dossies[`${_modo}:${_sel}`];
    _sel = ''; render();
    alert('Ficha apagada.');
  } catch (e) { alert('❌ Não apagou: ' + (e.message || e)); }
}
