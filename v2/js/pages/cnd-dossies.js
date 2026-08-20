/* PSM-OS v2 — 📁 Dossiês de CNDs (v86.56) · aba da tela CNDs (Jurídico)
   Três categorias: VENDA · LOCAÇÃO · INTERNO. Interno (v86.56) é a due
   diligence de quem vai ENTRAR na empresa: o dossiê nasce do candidato que já
   está no pipeline de Recrutamento (etapas Avaliação interna / Due Diligence),
   puxando nome, CPF, contato e cargo da ficha dele — nada é redigitado — e o
   andamento das certidões volta pra ficha do candidato.
   Histórico do módulo (v84.67):
   VENDA ou LOCAÇÃO, com N partes (Comprador/Locatário · Vendedor/Locador ·
   Fiador), cada uma PF ou PJ — PJ com sócios representantes, e cada sócio gera
   o pacote completo de CND. Cônjuge por pessoa.
   Fluxo: sócio/corretor cadastra → atribui à Leire ou Mariane → elas emitem,
   marcam status (aguardando/emitida/não emitida/bloqueada), o resultado
   (POSITIVA/NEGATIVA) e anexam a pasta do Drive. Tudo notifica os envolvidos.
   Backend: /api/v3/juridico/dossies */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _host = null, _d = null, _busy = false, _sel = null, _form = null;
let _fTipo = '';        // filtro da lista: '' | venda | locacao | interno
let _talentos = null;   // candidatos do ATS (carregados sob demanda)
let _abrirId = null;    // deep link #/cnds?dossie=<id>

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hojeStr = () => new Date().toISOString().substring(0, 10);

/* status da EMISSÃO (o caminho até ter o papel na mão) */
const ST_CERT = {
  aguardando:  ['⏳ Aguardando', '#a16207'],
  emitida:     ['✅ Emitida', '#16a34a'],
  nao_emitida: ['⚪ Não emitida', '#64748b'],
  bloqueada:   ['🚫 Bloqueada', '#dc2626'],
};
/* resultado da certidão emitida (o que ela DIZ) — é o que decide o negócio */
const RES_CERT = {
  negativa: ['🟢 NEGATIVA (nada consta)', '#16a34a'],
  positiva: ['🔴 POSITIVA (tem débito)', '#dc2626'],
};
/* os 3 tipos que a PSM aceita (v84.70) */
const GARANTIAS = {
  fiador: 'Fiador', seguro: 'Seguro-fiança', capitalizacao: 'Título de capitalização',
};
const ST_GARANTIA = {
  nao_definida: ['⚪ Não definida', '#64748b'],
  em_analise:   ['🔎 Em análise', '#a16207'],
  pendente_doc: ['📄 PENDENTE DOC', '#7c3aed'],
  aprovada:     ['✅ APROVADA', '#16a34a'],
  reprovada:    ['❌ REPROVADA', '#dc2626'],
};
const PAPEIS_VENDA = { comprador: 'Comprador', vendedor: 'Vendedor' };
const PAPEIS_LOC = { locatario: 'Locatário', locador: 'Locador', fiador: 'Fiador' };
const PAPEIS_INT = { candidato: 'Candidato' };
/* as 3 categorias do módulo — rótulo e cor num lugar só (v86.56) */
const TIPOS = {
  venda:   { lbl: '🏠 Venda', cor: '#2563eb' },
  locacao: { lbl: '🔑 Locação', cor: '#0891b2' },
  interno: { lbl: '🧑‍💼 Interno', cor: '#b45309' },
};
const tipoDe = t => TIPOS[t] || TIPOS.venda;
const chipTipo = t => { const x = tipoDe(t); return `<span class="tiny" style="background:${x.cor}20;color:${x.cor};border-radius:20px;padding:1px 9px;font-weight:800">${x.lbl}</span>`; };
const ECIV = ['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'];
const ECIV_LBL = { solteiro: 'Solteiro(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)', viuvo: 'Viúvo(a)', uniao_estavel: 'União estável' };
const CASADO = ['casado', 'uniao_estavel'];

export async function dossiesAba(host, opts) {
  _host = host;
  // #/cnds?dossie=<id> — usado pelo botão "abrir dossiê" da ficha do candidato
  if (opts && opts.dossie) { _abrirId = String(opts.dossie); _form = null; }
  await reload();
}

async function reload() {
  if (!_host) return;
  _host.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando dossiês…</div></div>';
  try {
    _d = await api.request('/api/v3/juridico/dossies');
  } catch (e) {
    _host.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  if (_abrirId) {
    const alvo = (_d.dossies || []).find(x => String(x.id) === _abrirId);
    _abrirId = null;
    if (alvo) { _sel = alvo; render(); return; }
  }
  if (_sel) _sel = (_d.dossies || []).find(x => x.id === _sel.id) || null;
  render();
}

async function post(body, okMsg) {
  if (_busy) return null;
  _busy = true;
  let r = null;
  try {
    r = await api.request('/api/v3/juridico/dossies', { method: 'POST', body });
    if (okMsg) alert(okMsg);
  } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  _busy = false;
  return r;
}

const userName = id => ((_d.users || []).find(u => u.id === id) || {}).name || '—';
const vencida = c => c.validade && String(c.validade).substring(0, 10) < hojeStr() && c.status === 'emitida';
const papeisDe = t => (t === 'locacao' ? PAPEIS_LOC : t === 'interno' ? PAPEIS_INT : PAPEIS_VENDA);
const podeInterno = () => (auth.user()?.lvl || 0) >= 5 || ['backoffice'].includes(auth.user()?.role);

function progresso(d) {
  const cs = d.certidoes || [];
  return {
    total: cs.length,
    emitidas: cs.filter(c => c.status === 'emitida').length,
    bloqueadas: cs.filter(c => c.status === 'bloqueada').length,
    positivas: cs.filter(c => c.resultado === 'positiva').length,
    vencidas: cs.filter(vencida).length,
  };
}

/* ── lista ───────────────────────────────────────────────────────────────── */
function render() {
  if (_form) return renderForm();
  if (_sel) return renderDossie();
  const todos = _d.dossies || [];
  const list = _fTipo ? todos.filter(d => (d.tipo_negocio || 'venda') === _fTipo) : todos;
  const conta = t => todos.filter(d => (d.tipo_negocio || 'venda') === t).length;
  _host.innerHTML = `
    <div class="card" style="padding:10px 12px">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0;font-size:16px">📁 Dossiês de CND</h2>
        <span class="tiny muted">venda · locação · interno — você vê os casos em que está envolvido</span>
        <span style="margin-left:auto"></span>
        ${podeInterno() ? '<button class="btn btn-sm" id="cd-cand" style="background:#b4530915;color:#b45309;font-weight:700">🧑‍💼 Do candidato (R&S)</button>' : ''}
        <button class="btn btn-primary btn-sm" id="cd-novo">➕ Novo dossiê</button>
        <button class="btn btn-ghost btn-sm" id="cd-reload">↻</button>
      </div>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${!_fTipo ? 'btn-primary' : 'btn-ghost'}" data-ft="">Todos (${todos.length})</button>
        ${Object.keys(TIPOS).map(t => `<button class="btn btn-sm ${_fTipo === t ? 'btn-primary' : 'btn-ghost'}" data-ft="${t}">${TIPOS[t].lbl} (${conta(t)})</button>`).join('')}
      </div>
    </div>
    ${!list.length ? `<div class="card mt-2 muted" style="text-align:center;padding:26px">${todos.length ? 'Nenhum dossiê nesta categoria.' : 'Nenhum dossiê ainda. Clique em <b>Novo dossiê</b>.'}</div>`
      : list.map(d => {
        const p = progresso(d);
        const g = d.garantia || {};
        const [gl, gc] = ST_GARANTIA[g.status || 'nao_definida'];
        return `<div class="card mt-2 cd-item" data-id="${esc(d.id)}" style="cursor:pointer;padding:12px 14px">
          <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
            ${chipTipo(d.tipo_negocio)}
            <b>${esc(d.titulo)}</b>
            <span class="tiny muted">${(d.partes || []).length} parte(s)</span>
            ${d.responsavel_id ? `<span class="tiny" style="background:var(--bg-3);border-radius:20px;padding:1px 9px">👤 ${esc(userName(d.responsavel_id))}</span>` : '<span class="tiny" style="color:#a16207;font-weight:700">⚠️ sem responsável</span>'}
            ${d.tipo_negocio === 'locacao' ? `<span class="tiny" style="color:${gc};font-weight:700">${gl}</span>` : ''}
            <span style="margin-left:auto" class="tiny">
              <b>${p.emitidas}/${p.total}</b> emitidas
              ${p.positivas ? ` · <b style="color:#dc2626">${p.positivas} POSITIVA(S)</b>` : ''}
              ${p.bloqueadas ? ` · <b style="color:#dc2626">${p.bloqueadas} bloqueada(s)</b>` : ''}
              ${p.vencidas ? ` · <b style="color:#a16207">${p.vencidas} vencida(s)</b>` : ''}
            </span>
          </div>
          <div style="height:6px;background:var(--bd,#eef2f7);border-radius:20px;overflow:hidden;margin-top:6px">
            <div style="height:100%;width:${p.total ? (p.emitidas / p.total) * 100 : 0}%;background:${p.positivas ? '#dc2626' : '#16a34a'};border-radius:20px"></div>
          </div>
        </div>`;
      }).join('')}`;
  _host.querySelector('#cd-novo').onclick = () => { _form = 'novo'; render(); };
  _host.querySelector('#cd-reload').onclick = reload;
  const bc = _host.querySelector('#cd-cand');
  if (bc) bc.onclick = abrirPickerCandidato;
  _host.querySelectorAll('[data-ft]').forEach(b => b.onclick = () => { _fTipo = b.dataset.ft; render(); });
  _host.querySelectorAll('.cd-item').forEach(el => el.onclick = () => {
    _sel = (_d.dossies || []).find(x => x.id === el.dataset.id); render();
  });
}

/* ── INTERNO: abrir dossiê direto do candidato do R&S (v86.56) ───────────── */
/* O pulo do gato do pedido do Paulo: o candidato JÁ existe no pipeline com
   nome, CPF, contato e cargo preenchidos na Due Diligence. Aqui a gente só
   escolhe quem é — o backend cria o dossiê com esses dados e devolve o
   checklist. Se o candidato já tiver dossiê, abre o que existe. */
async function abrirPickerCandidato() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow:auto';
  ov.innerHTML = '<div class="card" style="max-width:620px;width:100%;margin:auto"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando candidatos do Recrutamento…</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  let dd = [];
  try {
    const r = await api.request('/api/v3/juridico/dossies?talentos=1');
    _talentos = r.talentos || [];
    dd = r.etapas_dd || [];
  } catch (e) {
    ov.innerHTML = `<div class="card" style="max-width:620px;width:100%;margin:auto"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  let q = '', soDD = true;
  const draw = () => {
    const busca = q.trim().toLowerCase();
    const list = (_talentos || []).filter(t => {
      if (soDD && dd.length && !dd.includes(t.etapa || '')) return false;
      if (!busca) return true;
      return [t.nome, t.cargo, t.funcao, t.vaga, t.cpf, t.setor].some(v => String(v || '').toLowerCase().includes(busca));
    });
    ov.innerHTML = `<div class="card" style="max-width:620px;width:100%;margin:auto">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h3 class="card-title" style="margin:0">🧑‍💼 Dossiê interno — escolher candidato</h3>
        <button class="btn btn-ghost btn-sm" id="pk-x" style="margin-left:auto">✕</button>
      </div>
      <p class="tiny muted" style="margin:4px 0 8px">Os dados vêm da ficha do Recrutamento (nome, CPF, contato, cargo). Nada é digitado de novo — e o andamento das CNDs volta pra ficha dele.</p>
      <input class="input" id="pk-q" placeholder="🔎 Buscar candidato…" value="${esc(q)}">
      <label class="tiny muted" style="display:block;margin-top:6px"><input type="checkbox" id="pk-dd"${soDD ? ' checked' : ''}> mostrar só quem está em ${dd.map(esc).join(' · ') || 'avaliação'}</label>
      <div class="mt-2" style="max-height:52vh;overflow:auto">
        ${list.length ? list.map(t => `<div class="flex items-center pk-row" data-id="${esc(t.id)}" style="gap:8px;border-top:1px solid var(--bd,#eef2f7);padding:7px 2px;cursor:pointer">
          <div style="flex:1;min-width:0">
            <b style="font-size:13px">${esc(t.nome || '(sem nome)')}</b>
            <div class="tiny muted">${esc(t.cargo || t.funcao || t.vaga || '—')}${t.setor ? ' · ' + esc(t.setor) : ''}${t.cpf ? ' · CPF ' + esc(t.cpf) : ' · <b style="color:#a16207">sem CPF na ficha</b>'}</div>
          </div>
          <span class="tiny" style="background:var(--bg-3);border-radius:20px;padding:1px 9px">${esc(t.etapa || 'Triagem')}</span>
          ${t.dossie_id ? '<span class="tiny" style="color:#16a34a;font-weight:700">📁 já tem dossiê</span>' : '<span class="btn btn-primary btn-sm">➕ criar</span>'}
        </div>`).join('') : '<div class="tiny muted" style="padding:14px;text-align:center">Nenhum candidato encontrado.</div>'}
      </div>
    </div>`;
    ov.querySelector('#pk-x').onclick = () => ov.remove();
    const inp = ov.querySelector('#pk-q');
    inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; draw(); const n = ov.querySelector('#pk-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} };
    ov.querySelector('#pk-dd').onchange = e => { soDD = e.target.checked; draw(); };
    ov.querySelectorAll('.pk-row').forEach(el => el.onclick = async () => {
      ov.remove();
      await criarDoTalento(el.dataset.id);
    });
  };
  draw();
}

async function criarDoTalento(talentoId) {
  const r = await post({ action: 'from_talento', talento_id: talentoId },
    null);
  if (!r) return;
  alert(r.ja_existia ? '📁 Este candidato já tinha dossiê — abrindo o que existe.'
    : `✅ Dossiê interno criado com ${(r.certidoes || []).length} certidão(ões) no checklist.`);
  _abrirId = String(r.id);
  await reload();
}

/* ── formulário: N partes, PF/PJ, sócios, cônjuge ────────────────────────── */
let _fp = [];   // partes em edição

function pfCampos(p, pref) {
  const casado = CASADO.includes(p.estado_civil || '');
  return `
    <div class="flex" style="gap:6px;flex-wrap:wrap">
      <input class="input ${pref}nome" placeholder="Nome completo *" value="${esc(p.nome || '')}" style="flex:2;min-width:180px">
      <input class="input ${pref}cpf" placeholder="CPF" value="${esc(p.cpf || '')}" style="flex:1;min-width:120px">
      <input class="input ${pref}rg" placeholder="RG" value="${esc(p.rg || '')}" style="flex:1;min-width:100px">
    </div>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input ${pref}mae" placeholder="Nome da mãe" value="${esc(p.mae || '')}" style="flex:1;min-width:150px">
      <input class="input ${pref}pai" placeholder="Nome do pai" value="${esc(p.pai || '')}" style="flex:1;min-width:150px">
      <input class="input ${pref}nascimento" type="date" value="${esc(p.nascimento || '')}" style="width:145px">
    </div>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input ${pref}naturalidade" placeholder="Naturalidade" value="${esc(p.naturalidade || '')}" style="flex:1;min-width:130px">
      <select class="input ${pref}estado_civil" style="width:145px">
        <option value="">Estado civil</option>
        ${ECIV.map(e => `<option value="${e}"${p.estado_civil === e ? ' selected' : ''}>${ECIV_LBL[e]}</option>`).join('')}
      </select>
      <input class="input ${pref}profissao" placeholder="Profissão" value="${esc(p.profissao || '')}" style="flex:1;min-width:120px">
    </div>
    <input class="input ${pref}endereco mt-1" placeholder="Endereço completo" value="${esc(p.endereco || '')}" style="width:100%">
    <div class="mt-1" style="background:${casado ? '#2563eb0d' : 'transparent'};border-radius:8px;padding:${casado ? '7px' : '0'}">
      ${casado ? '<div class="tiny" style="font-weight:700;color:#2563eb">💍 Cônjuge — casado/união estável gera CND do cônjuge também</div>' : ''}
      <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
        <input class="input ${pref}conjuge_nome" placeholder="Nome do cônjuge" value="${esc(p.conjuge_nome || '')}" style="flex:2;min-width:160px">
        <input class="input ${pref}conjuge_cpf" placeholder="CPF do cônjuge" value="${esc(p.conjuge_cpf || '')}" style="flex:1;min-width:120px">
        <input class="input ${pref}conjuge_rg" placeholder="RG" value="${esc(p.conjuge_rg || '')}" style="flex:1;min-width:90px">
      </div>
    </div>`;
}

function parteHtml(p, i, tipoNeg) {
  const pj = p.tipo === 'pj';
  return `<div class="card" style="margin:0 0 8px;padding:11px 13px;border-left:3px solid ${pj ? '#7c3aed' : '#2563eb'}" data-parte="${i}" data-pid="${esc(p.id || '')}">
    <div class="flex items-center" style="gap:6px;flex-wrap:wrap">
      <select class="input fp-papel" style="width:135px;font-weight:700">
        ${Object.entries(papeisDe(tipoNeg)).map(([k, v]) => `<option value="${k}"${p.papel === k ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
      <select class="input fp-tipo" style="width:105px">
        <option value="pf"${!pj ? ' selected' : ''}>👤 Pessoa física</option>
        <option value="pj"${pj ? ' selected' : ''}>🏢 Pessoa jurídica</option>
      </select>
      <button class="btn btn-ghost btn-sm fp-del" type="button" style="color:#dc2626;margin-left:auto;padding:1px 8px">× remover</button>
    </div>
    <div class="mt-2">
      ${pj ? `
        <div class="flex" style="gap:6px;flex-wrap:wrap">
          <input class="input fp-razao_social" placeholder="Razão social *" value="${esc(p.razao_social || '')}" style="flex:2;min-width:190px">
          <input class="input fp-cnpj" placeholder="CNPJ" value="${esc(p.cnpj || '')}" style="flex:1;min-width:140px">
          <input class="input fp-inscricao_estadual" placeholder="Inscr. estadual" value="${esc(p.inscricao_estadual || '')}" style="flex:1;min-width:120px">
        </div>
        <input class="input fp-endereco mt-1" placeholder="Endereço da empresa" value="${esc(p.endereco || '')}" style="width:100%">
        <div class="mt-2" style="background:#7c3aed0d;border-radius:8px;padding:8px">
          <div class="flex items-center" style="gap:6px">
            <b class="tiny" style="color:#7c3aed">👥 Sócios representantes</b>
            <span class="tiny muted">cada sócio gera o pacote completo de CND (banco e cartório exigem)</span>
            <button class="btn btn-ghost btn-sm fp-socio-add" type="button" style="margin-left:auto;padding:1px 8px">+ sócio</button>
          </div>
          <div class="fp-socios mt-1">
            ${(p.socios || []).map((s, j) => `<div class="card" style="margin:0 0 6px;padding:8px 10px;background:var(--bg-2)" data-socio="${j}" data-sid="${esc(s.id || '')}">
              <div class="flex items-center" style="gap:6px"><b class="tiny">Sócio ${j + 1}</b>
                <button class="btn btn-ghost btn-sm fp-socio-del" type="button" style="color:#dc2626;margin-left:auto;padding:0 7px">×</button>
              </div>
              ${pfCampos(s, 'fs-')}
            </div>`).join('') || '<div class="tiny muted">Nenhum sócio ainda.</div>'}
          </div>
        </div>` : pfCampos(p, 'fp-')}
    </div>
  </div>`;
}

function renderForm() {
  const ehNovo = _form === 'novo' || !(_form && _form.id);
  const d = _form === 'novo' ? { tipo_negocio: 'venda', partes: [], imovel: {} } : _form;
  if (_form === 'novo' && !_fp.length) _fp = [{ papel: 'comprador', tipo: 'pf' }];
  else if (_form !== 'novo' && !_fp.length) _fp = JSON.parse(JSON.stringify(d.partes || []));
  const tn = d.tipo_negocio || 'venda';
  const interno = tn === 'interno';
  const im = d.imovel || {};
  /* v84.70: este filtro sempre dependeu de role/lvl, mas o backend mandava só
     id+name — TODO usuário falhava e o seletor de responsável abria VAZIO
     (era impossível atribuir a Leire/Mariane). O backend agora manda
     role/lvl/ativo. Inativo não entra em dropdown nenhum, mas segue na lista
     pra resolver nome em dossiê antigo. Se um dossiê antigo tiver responsável
     que hoje é inativo, ele entra no seletor só daquele dossiê (senão o
     selected apontaria pra uma opção que não existe e o save o derrubaria). */
  const ativos = (_d.users || []).filter(u => u.ativo !== false);
  const eqs = ativos.filter(u => ['secretaria_vendas', 'backoffice'].includes(u.role) || (u.lvl || 0) >= 5);
  if (d.responsavel_id && !eqs.some(u => u.id === d.responsavel_id)) {
    const atual = (_d.users || []).find(u => u.id === d.responsavel_id);
    if (atual) eqs.push(atual);
  }
  const corretores = ativos.slice();
  if (d.corretor_id && !corretores.some(u => u.id === d.corretor_id)) {
    const atual = (_d.users || []).find(u => u.id === d.corretor_id);
    if (atual) corretores.push(atual);
  }

  _host.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h3 class="card-title" style="margin:0">${ehNovo ? '➕ Novo dossiê' : '✏️ Editar dossiê'}</h3>
        <button class="btn btn-ghost btn-sm" id="cf-volta" style="margin-left:auto">← voltar</button>
      </div>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        <input class="input" id="cf-titulo" placeholder="${interno ? 'Título do caso * (ex: Interno — Maria Silva (Corretora))' : 'Título do caso * (ex: Apto 302 — Ed. Vista Alegre)'}" value="${esc(d.titulo || '')}" style="flex:2;min-width:230px">
        <select class="input" id="cf-tipo" style="width:150px">
          ${Object.keys(TIPOS).map(t => `<option value="${t}"${tn === t ? ' selected' : ''}${t === 'interno' && !podeInterno() ? ' disabled' : ''}>${TIPOS[t].lbl}</option>`).join('')}
        </select>
      </div>
      ${interno ? `<div class="mt-1" style="background:#b453090d;border:1px solid #b4530933;border-radius:8px;padding:8px">
        <div class="tiny" style="font-weight:700;color:#b45309">🧑‍💼 Dossiê interno — candidato à contratação</div>
        <div class="tiny muted" style="margin-top:2px">${d.talento_id ? 'Vinculado à ficha do Recrutamento — o andamento das CNDs aparece lá automaticamente.' : 'Sem vínculo com o pipeline. Para não redigitar dados, prefira <b>🧑‍💼 Do candidato (R&S)</b> na lista de dossiês.'}</div>
        <input class="input mt-1" id="cf-cargo" placeholder="Cargo / vaga (contendo «corretor» adiciona a consulta CRECI)" value="${esc(d.cargo || '')}" style="width:100%">
      </div>` : ''}
      <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
        <select class="input" id="cf-resp" style="flex:1;min-width:190px">
          <option value="">👤 Responsável pela emissão…</option>
          ${eqs.map(u => `<option value="${esc(u.id)}"${d.responsavel_id === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
        ${interno ? '' : `<select class="input" id="cf-corretor" style="flex:1;min-width:190px">
          <option value="">🤝 Corretor do caso…</option>
          ${corretores.map(u => `<option value="${esc(u.id)}"${d.corretor_id === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>`}
      </div>
      <input class="input mt-1" id="cf-drive" placeholder="🔗 Link da pasta no Google Drive (opcional)" value="${esc(d.drive_url || '')}" style="width:100%">

      <div class="flex items-center mt-3" style="gap:6px">
        <b class="tiny">👥 Partes do negócio</b>
        <span class="tiny muted">quantas precisar — cada uma gera o próprio checklist</span>
        <button class="btn btn-ghost btn-sm" id="cf-add-parte" type="button" style="margin-left:auto">+ adicionar parte</button>
      </div>
      <div id="cf-partes" class="mt-1">${_fp.map((p, i) => parteHtml(p, i, tn)).join('')}</div>

      ${interno ? '' : `
      <b class="tiny mt-3" style="display:block">🏠 Imóvel</b>
      <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
        <input class="input" id="cf-im-end" placeholder="Endereço do imóvel" value="${esc(im.endereco || '')}" style="flex:2;min-width:200px">
        <input class="input" id="cf-im-mat" placeholder="Matrícula" value="${esc(im.matricula || '')}" style="flex:1;min-width:110px">
        <input class="input" id="cf-im-cart" placeholder="Cartório" value="${esc(im.cartorio || '')}" style="flex:1;min-width:110px">
      </div>
      <div class="flex mt-1" style="gap:6px;flex-wrap:wrap;align-items:center">
        <input class="input" id="cf-im-insc" placeholder="Inscrição municipal" value="${esc(im.inscricao_municipal || '')}" style="flex:1;min-width:150px">
        <input class="input" id="cf-im-cid" placeholder="Cidade" value="${esc(im.cidade || 'São José do Rio Preto')}" style="flex:1;min-width:130px">
        <label class="tiny"><input type="checkbox" id="cf-im-cond"${im.condominio ? ' checked' : ''}> em condomínio (gera quitação)</label>
      </div>`}
      <textarea class="input mt-2" id="cf-obs" rows="2" placeholder="Observações do caso">${esc(d.obs || '')}</textarea>
      <div class="flex mt-2" style="gap:8px">
        <button class="btn btn-primary" id="cf-save" style="margin-left:auto">💾 Salvar e gerar checklist</button>
      </div>
      <div class="tiny muted mt-1" style="text-align:right">${interno ? 'Checklist do interno: federal, CNDT, cível/criminal TJSP, TRF3, antecedentes (PF + SSP-SP), protestos — e CRECI quando a vaga é de corretor.' : 'A matrícula atualizada fica de fora do checklist — tem custo.'}</div>
    </div>`;

  const $ = s => _host.querySelector(s);
  $('#cf-volta').onclick = () => { _form = null; _fp = []; render(); };
  /* v86.56: trocar o tipo mexe no FORMULÁRIO INTEIRO (imóvel só existe em
     venda/locação, cargo só no interno), então re-renderiza tudo preservando
     o que já foi digitado — antes só as partes eram redesenhadas. */
  $('#cf-tipo').onchange = () => {
    const tnNovo = $('#cf-tipo').value;
    coletarPartes();
    _fp.forEach(p => { if (!papeisDe(tnNovo)[p.papel]) p.papel = Object.keys(papeisDe(tnNovo))[0]; });
    _form = { ...(typeof _form === 'object' ? _form : {}), ...rascunhoTopo(), tipo_negocio: tnNovo };
    render();
  };
  $('#cf-add-parte').onclick = () => { coletarPartes(); _fp.push({ papel: Object.keys(papeisDe($('#cf-tipo').value))[0], tipo: 'pf' }); renderFormKeep($('#cf-tipo').value); };
  wireParteBtns();
  $('#cf-save').onclick = salvar;
}

/* o que está digitado no topo do form agora (sobrevive à troca de tipo) */
function rascunhoTopo() {
  const $ = s => _host.querySelector(s);
  const g = s => ($(s) ? String($(s).value || '').trim() : '');
  return {
    titulo: g('#cf-titulo'),
    responsavel_id: g('#cf-resp') || null,
    corretor_id: g('#cf-corretor') || null,
    drive_url: g('#cf-drive') || null,
    cargo: g('#cf-cargo') || null,
    obs: g('#cf-obs'),
    imovel: {
      endereco: g('#cf-im-end'), matricula: g('#cf-im-mat'), cartorio: g('#cf-im-cart'),
      inscricao_municipal: g('#cf-im-insc'), cidade: g('#cf-im-cid'),
      condominio: !!($('#cf-im-cond') && $('#cf-im-cond').checked),
    },
  };
}

/* re-render das partes preservando o topo do formulário */
function renderFormKeep(tn) {
  const box = _host.querySelector('#cf-partes');
  if (!box) return render();
  box.innerHTML = _fp.map((p, i) => parteHtml(p, i, tn)).join('');
  wireParteBtns();
}

function wireParteBtns() {
  _host.querySelectorAll('[data-parte]').forEach(el => {
    const i = Number(el.dataset.parte);
    el.querySelector('.fp-del').onclick = () => { coletarPartes(); _fp.splice(i, 1); renderFormKeep(_host.querySelector('#cf-tipo').value); };
    el.querySelector('.fp-tipo').onchange = e => { coletarPartes(); _fp[i].tipo = e.target.value; renderFormKeep(_host.querySelector('#cf-tipo').value); };
    const add = el.querySelector('.fp-socio-add');
    if (add) add.onclick = () => { coletarPartes(); _fp[i].socios = (_fp[i].socios || []).concat([{}]); renderFormKeep(_host.querySelector('#cf-tipo').value); };
    el.querySelectorAll('.fp-socio-del').forEach((b, j) => b.onclick = () => {
      coletarPartes(); _fp[i].socios.splice(j, 1); renderFormKeep(_host.querySelector('#cf-tipo').value);
    });
    // marcar casado revela o destaque do cônjuge na hora
    const ec = el.querySelector('.fp-estado_civil');
    if (ec) ec.onchange = () => { coletarPartes(); renderFormKeep(_host.querySelector('#cf-tipo').value); };
  });
}

const val = (el, cls) => { const i = el.querySelector('.' + cls); return i ? i.value.trim() : ''; };

function coletarPartes() {
  const novo = [];
  _host.querySelectorAll('[data-parte]').forEach(el => {
    const tipo = val(el, 'fp-tipo') || 'pf';
    /* v84.74: o ID da parte VIAJA JUNTO (data-pid/data-sid). Sem ele, cada
       save de edição fazia o backend gerar ids novos — e o checklist casa o
       andamento por (id da parte, tipo): ids novos = NADA casa = TODO o
       trabalho de emissão volta pra "aguardando" em silêncio. Foi assim que a
       Leire perdeu as CNDs do Irmãos Curti ao só trocar o responsável. */
    const p = { papel: val(el, 'fp-papel'), tipo };
    if (el.dataset.pid) p.id = el.dataset.pid;
    if (tipo === 'pj') {
      ['razao_social', 'cnpj', 'inscricao_estadual', 'endereco'].forEach(k => p[k] = val(el, 'fp-' + k));
      p.socios = [...el.querySelectorAll('[data-socio]')].map(se => {
        const s = {};
        if (se.dataset.sid) s.id = se.dataset.sid;
        ['nome', 'cpf', 'rg', 'mae', 'pai', 'nascimento', 'naturalidade', 'estado_civil', 'profissao', 'endereco',
         'conjuge_nome', 'conjuge_cpf', 'conjuge_rg'].forEach(k => s[k] = val(se, 'fs-' + k));
        return s;
      }).filter(s => s.nome || s.cpf);
    } else {
      ['nome', 'cpf', 'rg', 'mae', 'pai', 'nascimento', 'naturalidade', 'estado_civil', 'profissao', 'endereco',
       'conjuge_nome', 'conjuge_cpf', 'conjuge_rg'].forEach(k => p[k] = val(el, 'fp-' + k));
    }
    novo.push(p);
  });
  _fp = novo;
  return novo;
}

async function salvar() {
  const $ = s => _host.querySelector(s);
  const titulo = $('#cf-titulo').value.trim();
  if (!titulo) { alert('❌ Dê um título ao caso.'); return; }
  const partes = coletarPartes().filter(p => (p.tipo === 'pj' ? (p.razao_social || p.cnpj) : (p.nome || p.cpf)));
  if (!partes.length) { alert('❌ Cadastre ao menos uma parte com nome ou documento.'); return; }
  const topo = rascunhoTopo();
  const tn = $('#cf-tipo').value;
  const body = {
    action: 'upsert',
    id: (_form === 'novo' || !_form.id) ? undefined : _form.id,
    titulo, tipo_negocio: tn,
    responsavel_id: topo.responsavel_id,
    corretor_id: tn === 'interno' ? null : topo.corretor_id,
    drive_url: topo.drive_url,
    cargo: tn === 'interno' ? topo.cargo : null,
    partes,
    imovel: tn === 'interno' ? null : topo.imovel,   // interno não tem imóvel
    obs: topo.obs,
  };
  const r = await post(body, '💾 Dossiê salvo — checklist gerado.');
  if (r) { _form = null; _fp = []; _sel = { id: r.id || (r.dossie && r.dossie.id) || (_form && _form.id) }; await reload(); }
}

/* ── dossiê aberto: garantia + checklist ─────────────────────────────────── */
function renderDossie() {
  const d = _sel;
  const p = progresso(d);
  const g = d.garantia || {};
  const grupos = {};
  (d.certidoes || []).forEach(c => { (grupos[c.rotulo] = grupos[c.rotulo] || []).push(c); });
  const podeEditar = (auth.user()?.lvl || 0) >= 7 || ['backoffice'].includes(auth.user()?.role)
    || [d.criado_por, d.responsavel_id].includes(auth.user()?.id);

  _host.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="cv-volta">← dossiês</button>
        <b>${esc(d.titulo)}</b>
        ${chipTipo(d.tipo_negocio)}
        <span class="tiny muted">👤 ${esc(userName(d.responsavel_id))} emite${d.tipo_negocio === 'interno' ? (d.cargo ? ' · 💼 ' + esc(d.cargo) : '') : ' · 🤝 ' + esc(userName(d.corretor_id))}</span>
        <span style="margin-left:auto"></span>
        ${d.talento_id ? `<a class="btn btn-ghost btn-sm" href="#/talentos?id=${encodeURIComponent(d.talento_id)}" title="Abrir a ficha no Recrutamento">🌟 Ficha do candidato</a>` : ''}
        ${d.drive_url ? `<a class="btn btn-ghost btn-sm" href="${esc(d.drive_url)}" target="_blank" rel="noopener">📂 Pasta no Drive</a>` : ''}
        ${podeEditar ? '<button class="btn btn-ghost btn-sm" id="cv-edit">✏️ Editar</button>' : ''}
      </div>
      <div class="flex mt-2" style="gap:10px;flex-wrap:wrap">
        <span class="tiny"><b>${p.emitidas}/${p.total}</b> emitidas</span>
        ${p.positivas ? `<span class="tiny" style="color:#dc2626;font-weight:800">🔴 ${p.positivas} POSITIVA(S) — tem débito</span>` : ''}
        ${p.bloqueadas ? `<span class="tiny" style="color:#dc2626;font-weight:700">🚫 ${p.bloqueadas} bloqueada(s)</span>` : ''}
        ${p.vencidas ? `<span class="tiny" style="color:#a16207;font-weight:700">⏰ ${p.vencidas} vencida(s)</span>` : ''}
      </div>
    </div>

    ${d.tipo_negocio === 'locacao' ? htmlGarantia(g, podeEditar) : ''}

    ${Object.entries(grupos).map(([rot, cs]) => `<div class="card mt-2">
      <b class="tiny">${esc(rot)}</b>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">
        ${cs.map(c => `<tr style="border-top:1px solid var(--bd,#eef2f7)" data-cert="${esc(c.alvo)}|${esc(c.tipo)}">
          <td style="padding:6px 4px;width:38%">
            <a href="${esc(c.link)}" target="_blank" rel="noopener" style="font-weight:600">${esc(c.nome)} ↗</a>
            ${vencida(c) ? '<div class="tiny" style="color:#a16207;font-weight:700">⏰ VENCIDA</div>' : ''}
          </td>
          <td style="width:130px">
            <select class="input cc-status" style="padding:1px 5px;font-size:11px;width:100%" ${!podeEditar ? 'disabled' : ''}>
              ${Object.entries(ST_CERT).map(([k, [l]]) => `<option value="${k}"${(c.status || 'aguardando') === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </td>
          <td style="width:150px">
            <select class="input cc-res" style="padding:1px 5px;font-size:11px;width:100%" ${!podeEditar || c.status !== 'emitida' ? 'disabled' : ''}>
              <option value="">— resultado —</option>
              ${Object.entries(RES_CERT).map(([k, [l]]) => `<option value="${k}"${c.resultado === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </td>
          <td style="width:120px"><input class="input cc-val" type="date" value="${esc(c.validade || '')}" style="padding:1px 5px;font-size:11px" ${!podeEditar ? 'disabled' : ''}></td>
          <td><input class="input cc-arq" placeholder="link do PDF" value="${esc(c.arquivo_url || '')}" style="padding:1px 5px;font-size:11px;width:100%" ${!podeEditar ? 'disabled' : ''}></td>
        </tr>`).join('')}
      </table>
    </div>`).join('')}`;

  const $ = s => _host.querySelector(s);
  $('#cv-volta').onclick = () => { _sel = null; render(); };
  if ($('#cv-edit')) $('#cv-edit').onclick = () => { _form = d; _fp = []; render(); };
  if (podeEditar) wireCerts(d);
  if (podeEditar && d.tipo_negocio === 'locacao') wireGarantia(d);
}

function htmlGarantia(g, ed) {
  const [gl, gc] = ST_GARANTIA[g.status || 'nao_definida'];
  return `<div class="card mt-2" style="border-left:3px solid ${gc}">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b class="tiny">🛡 Garantia da locação</b>
      <span class="tiny" style="color:${gc};font-weight:800">${gl}</span>
      ${g.decidido_por ? `<span class="tiny muted">por ${esc(userName(g.decidido_por))} em ${esc(String(g.decidido_em || '').substring(0, 10).split('-').reverse().join('/'))}</span>` : ''}
    </div>
    <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
      <select class="input" id="gr-tipo" style="width:185px" ${!ed ? 'disabled' : ''}>
        <option value="">Tipo de garantia…</option>
        ${Object.entries(GARANTIAS).map(([k, v]) => `<option value="${k}"${g.tipo === k ? ' selected' : ''}>${v}</option>`).join('')}
      </select>
      <input class="input" id="gr-det" placeholder="Detalhe (seguradora + apólice, nº do título, qual fiador…)" value="${esc(g.detalhe || '')}" style="flex:1;min-width:220px" ${!ed ? 'disabled' : ''}>
      <input class="input" id="gr-val" placeholder="Valor" value="${esc(g.valor || '')}" style="width:120px" ${!ed ? 'disabled' : ''}>
    </div>
    ${g.tipo === 'fiador' ? '<div class="tiny mt-1" style="color:#2563eb">💡 Fiador: cadastre-o como <b>parte com papel Fiador</b> — aí ele entra no checklist e as CNDs dele são cobradas.</div>' : ''}
    <textarea class="input mt-1" id="gr-obs" rows="2" placeholder="Parecer da análise" ${!ed ? 'disabled' : ''}>${esc(g.obs || '')}</textarea>
    ${ed ? `<div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="gr-save">💾 Salvar garantia</button>
      <span style="margin-left:auto"></span>
      <button class="btn btn-ghost btn-sm" id="gr-doc" style="color:#7c3aed">📄 Pendente doc</button>
      <button class="btn btn-ghost btn-sm" id="gr-rep" style="color:#dc2626">❌ Reprovar</button>
      <button class="btn btn-primary btn-sm" id="gr-apr">✅ Aprovar garantia</button>
    </div>` : ''}
  </div>`;
}

function wireGarantia(d) {
  const $ = s => _host.querySelector(s);
  const corpo = st => ({
    action: 'set_garantia', id: d.id,
    garantia: { tipo: $('#gr-tipo').value, detalhe: $('#gr-det').value.trim(), valor: $('#gr-val').value.trim(), obs: $('#gr-obs').value.trim(), ...(st ? { status: st } : {}) },
  });
  if ($('#gr-save')) $('#gr-save').onclick = async () => { if (await post(corpo(null), '💾 Garantia salva.')) reload(); };
  if ($('#gr-doc')) $('#gr-doc').onclick = async () => {
    if (!$('#gr-tipo').value) { alert('❌ Escolha o tipo de garantia antes de marcar pendência de doc.'); return; }
    if (await post(corpo('pendente_doc'), '📄 Garantia marcada como pendente de documentação — o caso foi avisado.')) reload();
  };
  if ($('#gr-apr')) $('#gr-apr').onclick = async () => {
    if (!$('#gr-tipo').value) { alert('❌ Escolha o tipo de garantia antes de aprovar.'); return; }
    if (!confirm('Aprovar a garantia deste contrato?')) return;
    if (await post(corpo('aprovada'), '✅ Garantia aprovada — todos foram avisados.')) reload();
  };
  if ($('#gr-rep')) $('#gr-rep').onclick = async () => {
    if (!confirm('Reprovar a garantia deste contrato?')) return;
    if (await post(corpo('reprovada'), '❌ Garantia reprovada — todos foram avisados.')) reload();
  };
}

function wireCerts(d) {
  _host.querySelectorAll('[data-cert]').forEach(tr => {
    const [alvo, tipo] = tr.dataset.cert.split('|');
    const enviar = async () => {
      const st = tr.querySelector('.cc-status').value;
      const patch = {
        action: 'set_cert', id: d.id, alvo, tipo,
        cstatus: st,   // o backend lê 'cstatus' (não 'status') — mandar errado salvaria NADA, em silêncio
        // resultado só existe em certidão emitida — se voltou atrás, limpa
        resultado: st === 'emitida' ? (tr.querySelector('.cc-res').value || null) : null,
        validade: tr.querySelector('.cc-val').value || null,
        arquivo_url: tr.querySelector('.cc-arq').value.trim() || null,
      };
      const r = await post(patch);
      if (r) reload();
    };
    tr.querySelector('.cc-status').onchange = enviar;
    tr.querySelector('.cc-res').onchange = enviar;
    tr.querySelector('.cc-val').onchange = enviar;
    tr.querySelector('.cc-arq').onblur = e => { if (e.target.value.trim() !== (e.target.defaultValue || '')) enviar(); };
  });
}
