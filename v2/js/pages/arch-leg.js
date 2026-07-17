/* PSM-OS v2 — Consultoria Arch Leg (RH › desenvolvimento humano). v84.81
   Ficha por PESSOA e por EQUIPE, preenchida pela Arch Leg (Marcos Anderson).
   Dado sensível: só sócio (lvl>=10) OU role consultor_arch_leg — trava no backend.
   v84.81: campos auto-cresc., seções organizadas, gestor de arquivos e rascunho
   automático (autosave local) pra nunca perder trabalho num reload. */
import { api } from '../api.js';
import { auth } from '../auth.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = s => (s || '').slice(0, 10).split('-').reverse().join('/');

const PERFIS = {
  aguia:   { nome: 'Águia',   emoji: '🦅', cor: '#2563eb', lema: 'Fazer Diferente' },
  gato:    { nome: 'Gato',    emoji: '🐱', cor: '#16a34a', lema: 'Fazer Junto' },
  tubarao: { nome: 'Tubarão', emoji: '🦈', cor: '#dc2626', lema: 'Fazer Rápido' },
  lobo:    { nome: 'Lobo',    emoji: '🐺', cor: '#7c3aed', lema: 'Fazer Certo' },
};

// tipos de material — ícone + rótulo; auto-detectado pela extensão/URL
const TIPOS = {
  pdf:    { ico: '📄', lbl: 'PDF' },
  word:   { ico: '📝', lbl: 'Word' },
  imagem: { ico: '🖼', lbl: 'Imagem' },
  planilha: { ico: '📊', lbl: 'Planilha' },
  pasta:  { ico: '📁', lbl: 'Pasta' },
  link:   { ico: '🔗', lbl: 'Link' },
};
function detectaTipo(url, nome) {
  const s = ((url || '') + ' ' + (nome || '')).toLowerCase();
  if (/\.pdf(\b|$|\?)/.test(s)) return 'pdf';
  if (/\.docx?(\b|$|\?)/.test(s)) return 'word';
  if (/\.(png|jpe?g|gif|webp|heic)(\b|$|\?)/.test(s)) return 'imagem';
  if (/\.(xlsx?|csv)(\b|$|\?)/.test(s) || /spreadsheets/.test(s)) return 'planilha';
  if (/drive\.google\.com\/drive\/folders|\/folders\//.test(s)) return 'pasta';
  if (/document\/d\//.test(s)) return 'word';
  return 'link';
}

// campos de texto da ficha, na ordem/sessões (id → getter no objeto ficha)
let _root = null, _users = [], _teams = [], _dossies = {}, _ehArchLeg = false, _ehSocio = false;
let _modo = 'user', _sel = '', _disc = null, _mats = [], _dirty = false, _saveTimer = null;

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
const draftKey = () => `psm.archleg.${_modo}:${_sel}`;

/* quantos dos campos-chave estão preenchidos (0..1) — indicador de completude */
function completude(f) {
  if (!f) return 0;
  const cr = f.crencas || {}, pl = f.plano || {};
  const campos = [f.nota, f.historia, f.pontos_fortes, f.pilar_familiar, f.traumas,
    cr.espiritual, cr.emocional, cr.profissional, pl.objetivo, f.ponto_atencao,
    (f.materiais || []).length ? 'x' : ''];
  const cheios = campos.filter(x => (x || '').toString().trim()).length;
  return cheios / campos.length;
}

function render() {
  const alvos = _modo === 'user'
    ? _users.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : _teams;
  const fichasModo = Object.keys(_dossies).filter(k => k.startsWith(_modo + ':'));

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">🧭 Consultoria Arch Leg</h2>
        <span class="tiny" style="background:#7c3aed18;color:#7c3aed;border-radius:20px;padding:2px 10px;font-weight:800">desenvolvimento humano</span>
        <span class="tiny muted" style="margin-left:auto">${fichasModo.length} ficha(s) de ${_modo === 'user' ? 'pessoa' : 'equipe'}</span>
      </div>
      <p class="card-sub">Ficha de acompanhamento por pessoa e por equipe. Conteúdo sigiloso — visível só à diretoria e à consultoria.</p>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        <button class="btn ${_modo === 'user' ? 'btn-primary' : 'btn-ghost'} btn-sm" id="al-modo-user">👤 Por pessoa</button>
        <button class="btn ${_modo === 'team' ? 'btn-primary' : 'btn-ghost'} btn-sm" id="al-modo-team">👥 Por equipe</button>
        <select class="select" id="al-sel" style="flex:1;min-width:230px;padding:8px 10px;font-size:14px">
          <option value="">${_modo === 'user' ? '— escolha a pessoa —' : '— escolha a equipe —'}</option>
          ${alvos.map(a => {
            const id = a.id, nome = _modo === 'user' ? (a.name || id) : nomeTeam(id);
            const f = _dossies[`${_modo}:${id}`];
            const badge = f ? (completude(f) >= 0.6 ? '🟢 ' : '🟡 ') : '';
            return `<option value="${esc(id)}"${_sel === id ? ' selected' : ''}>${badge}${esc(nome)}</option>`;
          }).join('')}
        </select>
      </div>
    </div>
    <div id="al-body" class="mt-2"></div>`;

  const $ = s => _root.querySelector(s);
  $('#al-modo-user').onclick = () => trocaModo('user');
  $('#al-modo-team').onclick = () => trocaModo('team');
  $('#al-sel').onchange = async e => { _sel = e.target.value; _disc = null; await onSelect(); };
  if (_sel) renderFicha();
}

function trocaModo(m) {
  if (_dirty && !confirm('Você tem alterações não salvas. Trocar mesmo assim?')) return;
  _modo = m; _sel = ''; _disc = null; _dirty = false; render();
}

async function onSelect() {
  _disc = null;
  if (_modo === 'user' && _sel) {
    try {
      const r = await api.request('/api/v3/profile/painel_extra?uid=' + encodeURIComponent(_sel));
      _disc = (r && (r.comportamental || (r.data && r.data.comportamental))) || null;
    } catch (_) { _disc = null; }
  }
  renderFicha();
}

/* ── DISC (puxado do teste do sistema) ─────────────────────────────────── */
function discHtml() {
  if (_modo !== 'user') return '';
  if (!_disc || !_disc.pct) {
    return `<div class="card" style="border-left:3px solid #94a3b8">
      <b class="tiny">🧬 Perfil DISC (teste do sistema)</b>
      <div class="tiny muted mt-1">Ainda sem teste comportamental (Águia/Gato/Tubarão/Lobo). Assim que a pessoa fizer em <b>Meu Painel → Desenvolvimento</b>, o resultado aparece aqui sozinho.</div></div>`;
  }
  const pct = _disc.pct || {};
  const ordem = ['aguia', 'gato', 'tubarao', 'lobo'].sort((a, b) => (pct[b] || 0) - (pct[a] || 0));
  const dom = PERFIS[_disc.dominante] || PERFIS[ordem[0]];
  return `<div class="card" style="border-left:3px solid ${dom.cor}">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b class="tiny">🧬 Perfil DISC</b>
      <span class="tiny muted">teste do sistema${_disc.data ? ' · ' + dataBR(_disc.data) : ''}</span>
    </div>
    <div style="font-size:16px;font-weight:800;color:${dom.cor};margin-top:6px">${dom.emoji} ${dom.nome} <span class="tiny" style="opacity:.7">— "${dom.lema}"</span></div>
    <div class="mt-2" style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;max-width:420px">
      ${ordem.map(k => { const p = pct[k] || 0; return `<div style="font-weight:700">${PERFIS[k].emoji} ${PERFIS[k].nome}</div>
        <div style="height:9px;background:var(--bg-3,#eef2f7);border-radius:5px;overflow:hidden"><i style="display:block;height:100%;width:${p}%;background:${PERFIS[k].cor}"></i></div>
        <div style="text-align:right;font-weight:800;color:${PERFIS[k].cor}">${p}%</div>`; }).join('')}
    </div>
  </div>`;
}

/* campo de texto GRANDE que cresce sozinho conforme digita */
function ta(id, label, val, ph, min) {
  return `<div style="margin-top:14px">
    <label class="tiny" style="font-weight:800;display:block;margin-bottom:5px;color:var(--ink)">${label}</label>
    <textarea class="input al-ta" id="${id}" placeholder="${esc(ph || '')}"
      style="width:100%;min-height:${(min || 4) * 24}px;line-height:1.5;font-size:14px;padding:10px 12px;resize:vertical;overflow:hidden">${esc(val || '')}</textarea></div>`;
}
function secao(titulo, dica, inner) {
  return `<div class="card mt-2">
    <div class="flex items-center" style="gap:8px"><b>${titulo}</b>${dica ? `<span class="tiny muted">${dica}</span>` : ''}</div>
    ${inner}</div>`;
}

function renderFicha() {
  const body = _root.querySelector('#al-body');
  if (!_sel) { body.innerHTML = '<div class="card"><div class="tiny muted">Escolha uma pessoa ou equipe acima pra abrir a ficha.</div></div>'; return; }
  const f = fichaDe() || {};
  const cr = f.crencas || {}, pl = f.plano || {};
  _mats = (f.materiais || []).slice();
  _dirty = false;
  const nome = _modo === 'user' ? nomeUser(_sel) : nomeTeam(_sel);
  const pctFill = Math.round(completude(f) * 100);

  // rascunho automático não salvo?
  let draftBanner = '';
  try {
    const raw = localStorage.getItem(draftKey());
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.body && JSON.stringify(d.body) !== JSON.stringify(bodyDeFicha(f))) {
        draftBanner = `<div class="card" style="background:#f59e0b12;border-left:3px solid #f59e0b">
          <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
            <b class="tiny">📝 Há um rascunho automático não salvo</b>
            <span class="tiny muted">de ${dataBR(d.ts)} ${(d.ts || '').slice(11, 16)}</span>
            <span style="margin-left:auto"></span>
            <button class="btn btn-primary btn-sm" id="al-draft-restore">Restaurar</button>
            <button class="btn btn-ghost btn-sm" id="al-draft-drop">Descartar</button>
          </div></div>`;
      }
    }
  } catch (_) {}

  body.innerHTML = `
    ${draftBanner}
    ${discHtml()}

    <div class="card mt-2">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <b style="font-size:15px">${_modo === 'user' ? '👤' : '👥'} ${esc(nome)}</b>
        <span class="tiny" style="background:var(--bg-3,#eef2f7);border-radius:20px;padding:2px 10px">📊 ${pctFill}% preenchida</span>
        ${f.atualizado_em ? `<span class="tiny muted">· editada ${dataBR(f.atualizado_em)}${f.atualizado_por_nome ? ' por ' + esc(f.atualizado_por_nome) : ''}</span>` : '<span class="tiny muted">· ficha nova</span>'}
      </div>
    </div>

    ${secao('📝 Visão geral', 'nota da consultoria + trajetória',
      ta('al-nota', '📝 Nota', f.nota, 'Observação geral, leitura da consultoria sobre a pessoa/equipe…', 4) +
      ta('al-historia', '📖 História', f.historia, 'Trajetória, contexto de vida e carreira, momentos que marcaram…', 6))}

    ${secao('💪 Forças & feridas', 'o que sustenta e o que precisa de cuidado',
      ta('al-fortes', '💪 Pontos fortes e habilidades', f.pontos_fortes, 'O que essa pessoa/equipe faz de melhor, talentos naturais…', 4) +
      ta('al-pilar', '🏛 Pilar familiar', f.pilar_familiar, 'Origem de traumas, dinâmica e história familiar…', 4) +
      ta('al-traumas', '🩹 Traumas', f.traumas, 'Traumas identificados e como se manifestam…', 4))}

    ${secao('🧠 Crenças limitantes', 'separadas por dimensão',
      ta('al-cr-esp', '🕊 Espiritual', cr.espiritual, 'Crenças limitantes espirituais…', 3) +
      ta('al-cr-emo', '❤️ Emocional', cr.emocional, 'Crenças limitantes emocionais…', 3) +
      ta('al-cr-pro', '💼 Profissional', cr.profissional, 'Crenças limitantes profissionais…', 3))}

    ${secao('🎯 Plano de progresso', 'onde quer chegar e até quando',
      ta('al-plano-obj', '🎯 Objetivo', pl.objetivo, 'Objetivo do desenvolvimento, marcos, o que buscamos…', 4) +
      `<div style="margin-top:14px"><label class="tiny" style="font-weight:800;display:block;margin-bottom:5px">🗓 Prazo</label>
        <input class="input al-fld" id="al-plano-prazo" value="${esc(pl.prazo || '')}" placeholder="ex.: 90 dias · dez/2026 · contínuo" style="max-width:260px;font-size:14px;padding:9px 12px"></div>`)}

    ${secao('⚠️ Ponto de atenção', 'gatilhos, alertas, o que observar', ta('al-atencao', '⚠️ Ponto de atenção', f.ponto_atencao, 'O que exige cuidado, gatilhos, sinais de alerta…', 4))}

    <div class="card mt-2">
      <div class="flex items-center" style="gap:8px"><b>📎 Materiais & arquivos</b>
        <span class="tiny muted">PDF · Word · imagens · pastas do Drive</span>
        <button class="btn btn-ghost btn-sm" id="al-mat-add" style="margin-left:auto">+ anexar</button>
      </div>
      <div id="al-mats" class="mt-2"></div>
    </div>

    <div id="al-savebar" style="position:sticky;bottom:0;z-index:5;margin-top:12px;padding:10px 12px;background:var(--bg-1,#fff);border:1px solid var(--bd,#e2e8f0);border-radius:12px;box-shadow:0 -4px 14px rgba(0,0,0,.06)">
      <div class="flex items-center" style="gap:10px;flex-wrap:wrap">
        <span class="tiny muted" id="al-status">Alterações salvam localmente enquanto você digita.</span>
        <span style="margin-left:auto"></span>
        ${f.atualizado_em ? '<button class="btn btn-ghost btn-sm" id="al-del" style="color:#dc2626">🗑 Apagar ficha</button>' : ''}
        <button class="btn btn-primary" id="al-save">💾 Salvar ficha</button>
      </div>
    </div>`;

  renderMats();
  const $ = s => body.querySelector(s);
  // auto-grow + autosave em todo campo
  body.querySelectorAll('.al-ta').forEach(t => { autoGrow(t); t.addEventListener('input', () => { autoGrow(t); marcaDirty(); }); });
  body.querySelectorAll('.al-fld').forEach(t => t.addEventListener('input', marcaDirty));
  $('#al-mat-add').onclick = () => { coletaMats(); _mats.push({ nome: '', url: '', tipo: 'link' }); renderMats(); marcaDirty(); };
  $('#al-save').onclick = salvar;
  if ($('#al-del')) $('#al-del').onclick = apagar;
  if ($('#al-draft-restore')) $('#al-draft-restore').onclick = restaurarDraft;
  if ($('#al-draft-drop')) $('#al-draft-drop').onclick = () => { localStorage.removeItem(draftKey()); renderFicha(); };
}

function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight, 60) + 'px'; }

/* ── materiais: tipo com ícone, abrir, reordenar, editar inline ─────────── */
function renderMats() {
  const box = _root.querySelector('#al-mats');
  if (!box) return;
  if (!_mats.length) { box.innerHTML = '<div class="tiny muted">Nenhum material. Clique em <b>+ anexar</b> e cole o link do arquivo ou pasta do Drive.</div>'; return; }
  box.innerHTML = _mats.map((m, i) => {
    const t = TIPOS[m.tipo] || TIPOS.link;
    return `<div class="flex gap-2" data-mat="${i}" style="flex-wrap:wrap;align-items:center;padding:7px 0;border-top:${i ? '1px solid var(--bd,#eef2f7)' : '0'}">
      <select class="input mat-tipo" style="width:120px;font-size:13px" title="tipo">
        ${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${m.tipo === k ? ' selected' : ''}>${v.ico} ${v.lbl}</option>`).join('')}
      </select>
      <input class="input mat-nome" value="${esc(m.nome || '')}" placeholder="Nome (ex.: Laudo DISC)" style="flex:1;min-width:140px">
      <input class="input mat-url" value="${esc(m.url || '')}" placeholder="Link do Google Drive" style="flex:2;min-width:200px">
      ${m.url ? `<a class="btn btn-ghost btn-sm" href="${esc(m.url)}" target="_blank" rel="noopener" title="abrir">↗</a>` : ''}
      <button class="btn btn-ghost btn-sm mat-up" data-i="${i}" title="subir" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn btn-ghost btn-sm mat-dn" data-i="${i}" title="descer" ${i === _mats.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn btn-ghost btn-sm mat-del" data-i="${i}" style="color:#dc2626" title="remover">✕</button>
    </div>`;
  }).join('');
  const mv = (from, to) => { coletaMats(); const x = _mats.splice(from, 1)[0]; _mats.splice(to, 0, x); renderMats(); marcaDirty(); };
  box.querySelectorAll('.mat-del').forEach(b => b.onclick = () => { coletaMats(); _mats.splice(+b.dataset.i, 1); renderMats(); marcaDirty(); });
  box.querySelectorAll('.mat-up').forEach(b => b.onclick = () => mv(+b.dataset.i, +b.dataset.i - 1));
  box.querySelectorAll('.mat-dn').forEach(b => b.onclick = () => mv(+b.dataset.i, +b.dataset.i + 1));
  // auto-detecta o tipo ao colar/editar a URL (só se o usuário não escolheu manualmente)
  box.querySelectorAll('[data-mat]').forEach(row => {
    const urlEl = row.querySelector('.mat-url'), tipoEl = row.querySelector('.mat-tipo');
    urlEl.addEventListener('input', () => { tipoEl.value = detectaTipo(urlEl.value, row.querySelector('.mat-nome').value); marcaDirty(); });
    row.querySelector('.mat-nome').addEventListener('input', marcaDirty);
    tipoEl.addEventListener('change', marcaDirty);
  });
}

function coletaMats() {
  const box = _root.querySelector('#al-mats');
  if (!box) return;
  _mats = [...box.querySelectorAll('[data-mat]')].map(row => ({
    nome: row.querySelector('.mat-nome').value.trim(),
    url: row.querySelector('.mat-url').value.trim(),
    tipo: row.querySelector('.mat-tipo').value || 'link',
  })).filter(m => m.url || m.nome);
}

/* ── coleta o formulário inteiro (usado por salvar E autosave) ──────────── */
function coletaBody() {
  const $ = s => _root.querySelector(s);
  coletaMats();
  const v = s => ($(s) ? $(s).value.trim() : '');
  return {
    nota: v('#al-nota'), historia: v('#al-historia'), pontos_fortes: v('#al-fortes'),
    pilar_familiar: v('#al-pilar'), traumas: v('#al-traumas'),
    crencas: { espiritual: v('#al-cr-esp'), emocional: v('#al-cr-emo'), profissional: v('#al-cr-pro') },
    plano: { objetivo: v('#al-plano-obj'), prazo: v('#al-plano-prazo') },
    ponto_atencao: v('#al-atencao'),
    materiais: _mats.filter(m => m.url),
  };
}
function bodyDeFicha(f) {
  f = f || {}; const cr = f.crencas || {}, pl = f.plano || {};
  return {
    nota: f.nota || '', historia: f.historia || '', pontos_fortes: f.pontos_fortes || '',
    pilar_familiar: f.pilar_familiar || '', traumas: f.traumas || '',
    crencas: { espiritual: cr.espiritual || '', emocional: cr.emocional || '', profissional: cr.profissional || '' },
    plano: { objetivo: pl.objetivo || '', prazo: pl.prazo || '' },
    ponto_atencao: f.ponto_atencao || '',
    materiais: (f.materiais || []).map(m => ({ nome: m.nome || '', url: m.url || '', tipo: m.tipo || 'link' })),
  };
}

/* ── autosave local (debounce) — protege contra reload/perda ────────────── */
function marcaDirty() {
  _dirty = true;
  const st = _root.querySelector('#al-status');
  if (st) st.textContent = '✍️ digitando…';
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ ts: new Date().toISOString(), body: coletaBody() }));
      const s = _root.querySelector('#al-status');
      if (s) s.textContent = '📝 rascunho salvo no navegador · não esqueça de Salvar ficha';
    } catch (_) {}
  }, 900);
}

function restaurarDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey()) || '{}');
    if (!d.body) return;
    const b = d.body, $ = s => _root.querySelector(s);
    const set = (s, val) => { if ($(s)) $(s).value = val || ''; };
    set('#al-nota', b.nota); set('#al-historia', b.historia); set('#al-fortes', b.pontos_fortes);
    set('#al-pilar', b.pilar_familiar); set('#al-traumas', b.traumas);
    set('#al-cr-esp', b.crencas?.espiritual); set('#al-cr-emo', b.crencas?.emocional); set('#al-cr-pro', b.crencas?.profissional);
    set('#al-plano-obj', b.plano?.objetivo); set('#al-plano-prazo', b.plano?.prazo);
    set('#al-atencao', b.ponto_atencao);
    _mats = (b.materiais || []).slice(); renderMats();
    _root.querySelectorAll('.al-ta').forEach(autoGrow);
    _dirty = true;
    const st = _root.querySelector('#al-status'); if (st) st.textContent = '↩︎ rascunho restaurado — revise e Salvar ficha';
    const banner = _root.querySelector('#al-draft-restore')?.closest('.card'); if (banner) banner.remove();
  } catch (_) {}
}

async function salvar() {
  const $ = s => _root.querySelector(s);
  const body = { action: 'upsert', alvo_tipo: _modo, alvo_id: _sel, ...coletaBody() };
  const btn = $('#al-save'); if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const r = await api.request('/api/v3/gp/arch_leg', { method: 'POST', body });
    _dossies[`${_modo}:${_sel}`] = r.ficha;
    localStorage.removeItem(draftKey());   // salvou no servidor → rascunho não é mais necessário
    _dirty = false;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    const st = _root.querySelector('#al-status'); if (st) st.textContent = '✅ ficha salva.';
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
    localStorage.removeItem(draftKey());
    _sel = ''; _dirty = false; render();
  } catch (e) { alert('❌ Não apagou: ' + (e.message || e)); }
}
