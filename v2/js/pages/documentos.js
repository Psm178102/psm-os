/* ============================================================================
   PSM-OS v2 — 📝 Gerar documento (proposta, contrato…)  v88.12
   ----------------------------------------------------------------------------
   Pedido do Paulo (23/09/2026): "o sistema autopreenche e gera a minuta em
   arquivo Word final, assim poderemos baixar e editar caso precise algo".

   Fluxo: escolhe o documento → puxa o NEGÓCIO do CRM (cliente, telefone,
   e-mail, empreendimento, unidade, valor, sinal, forma, comissão, corretor)
   → completa o que o CRM não tem (CPF, RG, estado civil, endereço…) →
   ⬇ baixa o .docx pronto, com logo e rodapé da imobiliária.

   • Nada do que é digitado (CPF/RG/endereço) é gravado no banco — vive só na
     tela até baixar. O audit_log registra só QUEM gerou QUAL modelo e negócio.
   • Campo em branco sai como "__________" no Word, pra completar à mão.
   • Os textos padrão estão em data/docs-modelos.js; o sócio edita na aba
     ⚙️ Modelos e a versão editada (shared_kv docs_gerador) passa por cima.
============================================================================ */
import { api, hojeISO } from '../api.js';
import { auth } from '../auth.js';
import { montarDocx, preencher, varsDoCorpo, carregarLogo, baixarBlob, numBR, VAZIO } from '../docx-psm.js';
import { MODELOS_PADRAO, EMPRESAS_PADRAO, PADROES_GERAIS, CAMPOS, PESSOA_CAMPOS, PESSOAS, CALCULADAS } from '../data/docs-modelos.js';
import { montarContexto, sugerirPagamento } from '../data/docs-contexto.js';

const API = '/api/v3/docs/gerador';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _root = null;
let _cfg = { modelos: {}, empresas: {}, padroes: {} };
let _canEdit = false;
let _aba = 'gerar';              // gerar | modelos
let _modeloId = 'proposta_cv';
let _empresaId = null;
let _v = {};                     // valores do formulário (só em memória)
let _pagAuto = true;             // cláusula 3ª ainda é a sugestão automática?
let _negocio = null;             // negócio do CRM escolhido
let _busca = { termo: '', lista: null, carregando: false, erro: '' };
let _edit = null;                // modelo em edição (aba ⚙️)

/* ─────────────── dados combinados (padrão + editado) ─────────────── */
function modelos() {
  const lista = MODELOS_PADRAO.map(m => ({ ...m, ...(_cfg.modelos[m.id] || {}), id: m.id, editado: !!_cfg.modelos[m.id] }));
  for (const [id, m] of Object.entries(_cfg.modelos || {})) if (m.novo && !lista.some(x => x.id === id)) lista.push({ ...m, id, editado: true });
  return lista;
}
const modelo = () => modelos().find(m => m.id === _modeloId) || modelos()[0];
function empresas() {
  const out = {};
  for (const [id, e] of Object.entries(EMPRESAS_PADRAO)) out[id] = { ...e, ...(_cfg.empresas[id] || {}) };
  for (const [id, e] of Object.entries(_cfg.empresas || {})) if (!out[id]) out[id] = { ...e };
  return out;
}
const padroes = () => ({ ...PADROES_GERAIS, ...(_cfg.padroes || {}) });

function valoresIniciais() {
  const u = auth.user() || {};
  const p = padroes();
  return {
    data_doc: hojeISO(), cidade_foro: p.cidade_foro, testemunha1: p.testemunha1, testemunha2: p.testemunha2,
    prazo_desistencia: '30', comissao_pct: '5',
    comissao_quando: 'imediatamente após o recebimento do valor descrito na cláusula 3ª, a',
    corretor_nome: u.name || '',
    c1_nacionalidade: 'brasileiro(a)', v1_nacionalidade: 'brasileiro(a)',
  };
}

/* ─────────────── quais campos o modelo pede ─────────────── */
const DEPENDE = {
  compradores_qualificacao: ['@c1', '@c2'], vendedores_qualificacao: ['@v1', '@v2'],
  valor_moeda: ['valor'], valor_extenso: ['valor'], valor_ato_extenso: ['valor_ato'],
  comissao_pct_extenso: ['comissao_pct'], comissao_valor_extenso: ['valor', 'comissao_pct'],
  data_extenso: ['data_doc'], data_doc_br: ['data_doc'], pagamento_detalhe: ['valor', 'valor_ato', 'forma_pagamento', 'pagamento_detalhe'],
  locadores_qualificacao: ['@v1', '@v2'], locatarios_qualificacao: ['@c1', '@c2'], fiadores_qualificacao: ['@f1', '@f2'],
  aluguel_extenso: ['aluguel'], data_inicio_br: ['data_inicio'], data_fim_br: ['data_fim'],
  garantia_maiuscula: ['garantia'], garantia_fianca: ['garantia'], garantia_seguro: ['garantia'], garantia_titulo: ['garantia'], garantia_caucao: ['garantia'],
  taxa_adm_pct_extenso: ['taxa_adm_pct'], data_visita_br: ['data_visita'],
};
const ORDEM_PESSOAS = ['c1', 'c2', 'v1', 'v2', 'f1', 'f2'];
const rotuloPessoa = (m, p) => (m.papeis && m.papeis[p]) || PESSOAS[p];
function camposDoModelo(m) {
  const pessoas = new Set(), campos = new Set();
  const add = k => {
    if (k.startsWith('@')) { pessoas.add(k.slice(1)); return; }
    const pm = k.match(/^(c1|c2|v1|v2|f1|f2)_/);
    if (pm) { pessoas.add(pm[1]); return; }
    if (k.startsWith('empresa_')) return;
    if (CAMPOS[k]) campos.add(k);
    else if (!CALCULADAS[k]) campos.add(k);   // variável nova criada no editor → vira campo texto
  };
  for (const k of varsDoCorpo(m.corpo)) (DEPENDE[k] || [k]).forEach(add);
  // cônjuge só faz sentido junto do titular
  if (pessoas.has('c2')) pessoas.add('c1');
  if (pessoas.has('v2')) pessoas.add('v1');
  if (pessoas.has('f2')) pessoas.add('f1');
  // quem vem do CRM aparece primeiro (na administração é o proprietário)
  const ordem = m.cliente === 'v1' ? ['v1', 'v2', 'c1', 'c2', 'f1', 'f2'] : ORDEM_PESSOAS;
  return { pessoas: ordem.filter(p => pessoas.has(p)), campos: [...campos] };
}

/* ─────────────── boot ─────────────── */
export async function pageDocumentos(ctx, root) {
  _root = root;
  _v = { ..._v, ...Object.fromEntries(Object.entries(valoresIniciais()).filter(([k]) => !(k in _v))) };
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando modelos…</div></div>';
  try {
    const r = await api.request(API + '?op=config');
    _cfg = r.cfg || _cfg; _canEdit = !!r.can_edit;
  } catch (e) {
    // sem config do banco ainda dá pra gerar com os modelos padrão
    console.warn('docs/gerador config', e);
  }
  if (!_empresaId) _empresaId = modelo().empresa || 'psm_negocios';
  aplicarPadroesModelo();
  render();
}

function render() {
  const m = modelo();
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title" style="margin:0">📝 Gerar documento</h2>
          <p class="card-sub" style="margin:4px 0 0">Escolha o documento, puxe o negócio do CRM e baixe o <b>Word já preenchido</b> — dá pra editar tudo no Word depois.</p>
        </div>
        ${_canEdit ? `<div class="flex gap-2">
          <button class="btn ${_aba === 'gerar' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-aba="gerar">📝 Gerar</button>
          <button class="btn ${_aba === 'modelos' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-aba="modelos">⚙️ Modelos e imobiliárias</button>
        </div>` : ''}
      </div>
    </div>
    <div id="doc-body">${_aba === 'modelos' && _canEdit ? htmlModelos() : htmlGerar(m)}</div>`;
  _root.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { _aba = b.dataset.aba; _edit = null; render(); });
  if (_aba === 'modelos' && _canEdit) bindModelos(); else bindGerar();
}

/* ─────────────── aba GERAR ─────────────── */
function htmlGerar(m) {
  const { pessoas, campos } = camposDoModelo(m);
  const emps = empresas();
  const grupos = {};
  for (const k of campos) { const g = (CAMPOS[k] || [k, 'Outros'])[1]; (grupos[g] = grupos[g] || []).push(k); }
  const ordem = ['Parte empresa', 'Locatário empresa', 'Visita', 'Imóvel', 'Atividade', 'Cessão', 'Locação', 'Garantia', 'Negócio', 'Comissão', 'Assinaturas', 'Outros'];
  return `
    <div class="card mt-3">
      <div class="tiny muted" style="font-weight:700;letter-spacing:.5px;text-transform:uppercase">1 · Documento</div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        ${modelos().map(x => `<button class="btn ${x.id === m.id ? 'btn-primary' : 'btn-ghost'}" data-modelo="${esc(x.id)}">${esc(x.titulo)}${x.editado ? ' <span class="tiny" title="texto editado pelo sócio">✎</span>' : ''}</button>`).join('')}
      </div>
      <div class="flex gap-2 mt-3" style="align-items:center;flex-wrap:wrap">
        <label class="tiny muted">Imobiliária que assina / intermedia</label>
        <select class="select" id="doc-empresa" style="max-width:420px">
          ${Object.entries(emps).map(([id, e]) => `<option value="${esc(id)}" ${id === _empresaId ? 'selected' : ''}>${esc(e.nome)} · CRECI ${esc(e.creci)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card mt-3">
      <div class="tiny muted" style="font-weight:700;letter-spacing:.5px;text-transform:uppercase">2 · Negócio do CRM <span style="font-weight:400;text-transform:none">(opcional — preenche cliente, imóvel e valores)</span></div>
      ${_negocio ? `
        <div class="flex gap-2 mt-2" style="align-items:center;flex-wrap:wrap;background:var(--bg-3);padding:10px 12px;border-radius:8px">
          <div style="flex:1;min-width:200px"><b>${esc(_negocio.nome)}</b>
            <div class="tiny muted">${esc(_negocio.funil)} · ${esc(_negocio.etapa)}${_negocio.corretor_nome ? ' · ' + esc(_negocio.corretor_nome) : ''}${_negocio.valor ? ' · R$ ' + Math.round(_negocio.valor).toLocaleString('pt-BR') : ''}</div></div>
          <button class="btn btn-ghost btn-sm" id="doc-neg-trocar">Trocar</button>
        </div>` : `
        <div class="flex gap-2 mt-2">
          <input class="input" id="doc-busca" placeholder="Buscar pelo nome do negócio / cliente…" value="${esc(_busca.termo)}" autocomplete="off" style="flex:1">
          <button class="btn btn-ghost" id="doc-buscar">🔎 Buscar</button>
        </div>
        <div id="doc-neg-lista" class="mt-2">${htmlListaNegocios()}</div>`}
    </div>

    <div class="card mt-3">
      <div class="tiny muted" style="font-weight:700;letter-spacing:.5px;text-transform:uppercase">3 · Dados do documento</div>
      <p class="tiny muted" style="margin:4px 0 0">O que ficar em branco sai como <code>${VAZIO}</code> no Word pra completar à mão. CPF, RG e endereço <b>não ficam gravados</b> no House.</p>
      ${pessoas.map(p => htmlPessoa(p, m)).join('')}
      ${ordem.filter(g => grupos[g]).map(g => `
        <div class="mt-3"><div style="font-weight:800;margin-bottom:6px">${({ 'Parte empresa': '🏢', 'Visita': '👀', 'Cessão': '📜', 'Locatário empresa': '🏢', 'Atividade': '🏪', 'Imóvel': '🏠', 'Locação': '🔑', 'Garantia': '🛡', 'Negócio': '💰', 'Comissão': '🤝', 'Assinaturas': '✍️' })[g] || '•'} ${esc(g)}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">${grupos[g].map(k => htmlCampo(k)).join('')}</div>
        </div>`).join('')}
    </div>

    <div class="card mt-3" style="position:sticky;bottom:8px;z-index:5">
      <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="doc-baixar">⬇ Baixar Word (.docx)</button>
        <button class="btn btn-ghost" id="doc-ver">👁 Conferir texto</button>
        <button class="btn btn-ghost" id="doc-limpar" title="Apaga os dados digitados desta tela">🧹 Limpar</button>
        <span id="doc-brancos" class="tiny muted"></span>
      </div>
      <div id="doc-preview"></div>
    </div>`;
}

function htmlListaNegocios() {
  if (_busca.carregando) return '<div class="tiny muted"><span class="spinner"></span> Buscando…</div>';
  if (_busca.erro) return `<div class="alert alert-err">${esc(_busca.erro)}</div>`;
  if (!_busca.lista) return '<div class="tiny muted">Busque um negócio — ou pule e preencha tudo à mão.</div>';
  if (!_busca.lista.length) return '<div class="tiny muted">Nenhum negócio encontrado com esse nome.</div>';
  return `<div style="display:grid;gap:6px;max-height:280px;overflow:auto">${_busca.lista.map((n, i) => `
    <button class="btn btn-ghost" data-neg="${i}" style="text-align:left;justify-content:flex-start;display:block;width:100%">
      <b>${esc(n.nome)}</b> <span class="tiny muted">· ${esc(n.funil)} · ${esc(n.etapa)}${n.ganho ? ' · 🏆 ganho' : ''}${n.corretor_nome ? ' · ' + esc(n.corretor_nome) : ''}${n.valor ? ' · R$ ' + Math.round(n.valor).toLocaleString('pt-BR') : ''}</span>
    </button>`).join('')}</div>`;
}

function htmlPessoa(p, m) {
  const aberto = (/1$/.test(p) && p !== 'f1') || PESSOA_CAMPOS.some(([k]) => (_v[`${p}_${k}`] || '').trim() && k !== 'nacionalidade');
  return `
    <details class="mt-3" ${aberto ? 'open' : ''} style="border:1px solid var(--bd);border-radius:8px;padding:8px 12px">
      <summary style="font-weight:800;cursor:pointer">${p.startsWith('c') ? '🙋' : p.startsWith('v') ? '🏡' : '🤝'} ${esc(rotuloPessoa(m, p))}${/2$/.test(p) || p === 'f1' ? ' <span class="tiny muted" style="font-weight:400">(deixe o nome vazio se não houver)</span>' : ''}</summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:8px">
        ${PESSOA_CAMPOS.filter(([k]) => !m.pessoaCampos || m.pessoaCampos.includes(k)).map(([k, rot, tipo]) => campoInput(`${p}_${k}`, rot, tipo)).join('')}
      </div>
    </details>`;
}

function htmlCampo(k) {
  const [rot, , tipo] = CAMPOS[k] || [k.replace(/_/g, ' '), 'Outros', 'text'];
  const extra = k === 'pagamento_detalhe'
    ? `<button class="btn btn-ghost btn-sm" id="doc-sugerir" type="button" style="margin-top:4px">↻ refazer pela forma de pagamento</button>` : '';
  const largo = tipo === 'area' || k === 'imovel_matriculas_texto' || k === 'comissao_quando';
  return `<div style="${largo ? 'grid-column:1/-1' : ''}">${campoInput(k, rot, tipo, true)}${extra}</div>`;
}

function campoInput(k, rot, tipo, semWrap) {
  const v = _v[k] ?? '';
  let el;
  if (tipo === 'area') el = `<textarea class="input" data-k="${k}" rows="${k === 'imovel_descricao' ? 6 : 4}">${esc(v)}</textarea>`;
  else if (tipo === 'data') el = `<input class="input" type="date" data-k="${k}" value="${esc(v)}">`;
  else if (String(tipo).startsWith('select:')) {
    const ops = tipo.slice(7).split(';');
    el = `<select class="select" data-k="${k}"><option value="">—</option>${ops.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}${v && !ops.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
  } else {
    const im = tipo === 'valor' || tipo === 'pct' ? ' inputmode="decimal"' : '';
    const ph = tipo === 'valor' ? ' placeholder="0,00"' : tipo === 'pct' ? ' placeholder="5"' : '';
    el = `<input class="input" data-k="${k}" value="${esc(v)}"${im}${ph} autocomplete="off">`;
  }
  const lab = `<label class="tiny muted">${esc(rot)}</label>`;
  return semWrap ? lab + el : `<div>${lab}${el}</div>`;
}

function bindGerar() {
  const $ = id => document.getElementById(id);
  _root.querySelectorAll('[data-modelo]').forEach(b => b.onclick = () => {
    _modeloId = b.dataset.modelo;
    _empresaId = modelo().empresa || _empresaId;
    aplicarPadroesModelo();
    render();
  });
  const emp = $('doc-empresa'); if (emp) emp.onchange = () => { _empresaId = emp.value; atualizarBrancos(); };
  // negócio
  const buscar = async () => {
    const inp = $('doc-busca'); _busca.termo = (inp?.value || '').trim();
    _busca.carregando = true; _busca.erro = ''; $('doc-neg-lista').innerHTML = htmlListaNegocios();
    try {
      const r = await api.request(`${API}?op=negocios&limit=30&q=${encodeURIComponent(_busca.termo)}`);
      _busca.lista = r.negocios || [];
    } catch (e) { _busca.erro = e.message; }
    _busca.carregando = false;
    const box = $('doc-neg-lista'); if (box) { box.innerHTML = htmlListaNegocios(); bindLista(); }
  };
  const bindLista = () => _root.querySelectorAll('[data-neg]').forEach(b => b.onclick = () => usarNegocio(_busca.lista[+b.dataset.neg]));
  if ($('doc-buscar')) $('doc-buscar').onclick = buscar;
  if ($('doc-busca')) $('doc-busca').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } };
  bindLista();
  if (!_negocio && !_busca.lista && !_busca.carregando) buscar();   // já mostra os mais recentes
  if ($('doc-neg-trocar')) $('doc-neg-trocar').onclick = () => { _negocio = null; render(); };

  // campos: atualiza o estado SEM re-render (não perde o foco)
  _root.querySelectorAll('[data-k]').forEach(el => {
    const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const k = el.dataset.k;
      _v[k] = el.value;
      if (k === 'pagamento_detalhe') _pagAuto = !el.value.trim();
      if (['valor', 'valor_ato', 'forma_pagamento'].includes(k)) refazerPagamento(false);
      atualizarBrancos();
    });
  });
  if ($('doc-sugerir')) $('doc-sugerir').onclick = () => refazerPagamento(true);
  if (!(_v.pagamento_detalhe || '').trim()) refazerPagamento(false);

  $('doc-baixar').onclick = baixar;
  $('doc-ver').onclick = () => {
    const box = $('doc-preview');
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const txt = textoFinal();
    box.innerHTML = `<div style="margin-top:12px;max-height:60vh;overflow:auto;background:#fff;color:#111;border:1px solid var(--bd);border-radius:8px;padding:18px 22px;font-family:Arial,sans-serif;font-size:13px;line-height:1.5">${previewHtml(txt)}</div>`;
  };
  $('doc-limpar').onclick = () => {
    if (!confirm('Apagar os dados digitados nesta tela?')) return;
    _v = valoresIniciais(); _auto = {}; _negocio = null; _pagAuto = true; aplicarPadroesModelo(); render();
  };
  atualizarBrancos();
}

/* Valores padrão do modelo (ex.: exclusividade = 6%). Só preenche campo vazio ou
   que ainda está com o padrão de outro modelo — nunca apaga o que a pessoa digitou. */
let _auto = {};
function aplicarPadroesModelo() {
  const pad = modelo().padrao || {};
  for (const [k, v] of Object.entries(_auto)) if (_v[k] === v && !(k in pad)) { _v[k] = valoresIniciais()[k] ?? ''; delete _auto[k]; }
  for (const [k, v] of Object.entries(pad)) {
    const atual = String(_v[k] ?? '').trim();
    const ini = String(valoresIniciais()[k] ?? '');
    if (!atual || atual === ini || _auto[k] === _v[k]) { _v[k] = v; _auto[k] = v; }
  }
}

function refazerPagamento(forcar) {
  if (!forcar && !_pagAuto) return;
  const s = sugerirPagamento(_v);
  _v.pagamento_detalhe = s; _pagAuto = true;
  const el = _root.querySelector('[data-k="pagamento_detalhe"]'); if (el) el.value = s;
}

function formaDoCrm(c) {
  const t = `${c.modalidade || ''} ${c.financiamento || ''}`.toLowerCase();
  if (t.includes('financ')) return 'Financiamento bancário';
  if (t.includes('consór') || t.includes('consor') || t.includes('carta')) return 'Carta de crédito/consórcio';
  if (t.includes('permuta')) return 'Permuta';
  if (t.includes('parcel')) return 'Parcelado';
  if (t.includes('vista') || t.includes('próprio') || t.includes('proprio')) return 'À vista';
  return '';
}

function usarNegocio(n) {
  if (!n) return;
  _negocio = n;
  const m = modelo();
  const c = n.campos || {}, ct = n.contato || {};
  const set = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') _v[k] = String(v).trim(); };
  const cli = m.cliente || 'c1';           // na administração o cliente do CRM é o proprietário
  set(`${cli}_nome`, ct.nome || n.nome);
  set(`${cli}_email`, ct.email);
  set(`${cli}_fone`, ct.fone);
  set('imovel_empreendimento', c.empreendimento);
  set('imovel_unidade', c.unidade);
  if (n.valor > 0) set(m.valorCampo || 'valor', n.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  const ato = numBR(c.valor_ato); if (ato > 0) set('valor_ato', ato.toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  set('forma_pagamento', formaDoCrm(c));
  const pct = numBR(c.comissao_pct); if (pct > 0 && pct < 30) set('comissao_pct', String(pct).replace('.', ','));
  set('corretor_nome', n.corretor_nome);
  if (_pagAuto) _v.pagamento_detalhe = sugerirPagamento(_v);
  render();
}

function contexto() {
  const emp = empresas()[_empresaId] || Object.values(empresas())[0];
  return { emp, ctx: montarContexto(_v, emp) };
}
function textoFinal() { return preencher(modelo().corpo, contexto().ctx); }

function atualizarBrancos() {
  const el = document.getElementById('doc-brancos'); if (!el) return;
  const n = (textoFinal().match(/__________/g) || []).length;
  el.innerHTML = n ? `✏️ <b>${n}</b> ${n === 1 ? 'campo sai' : 'campos saem'} em branco pra completar no Word` : '✅ tudo preenchido';
}

function previewHtml(txt) {
  return String(txt).split('\n').map(l => {
    const t = l.trimEnd();
    const b = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__________/g, '<span style="background:#fde68a">__________</span>');
    if (t.startsWith('[[ASSINATURAS]]')) return '<div style="display:flex;gap:30px;margin:26px 0 10px">' + t.slice(15).split('||').map(c => `<div style="flex:1;text-align:center;border-top:1px solid #333;padding-top:4px;font-size:12px">${c.split('|').map(b).join('<br>')}</div>`).join('') + '</div>';
    if (t === '---') return '<div style="height:8px"></div>';
    if (t.startsWith('## ')) return `<div style="font-weight:800;margin-top:10px">${b(t.slice(3))}</div>`;
    if (t.startsWith('# ')) return `<div style="font-weight:800;text-align:center;font-size:15px;margin-bottom:8px">${b(t.slice(2))}</div>`;
    if (!t.trim()) return '<div style="height:4px"></div>';
    return `<p style="margin:4px 0;text-align:justify">${b(t)}</p>`;
  }).join('');
}

async function baixar() {
  const btn = document.getElementById('doc-baixar');
  const m = modelo();
  const { emp, ctx } = contexto();
  btn.disabled = true; const txt0 = btn.textContent; btn.textContent = '⏳ Gerando…';
  try {
    const logo = await carregarLogo(emp.logo);
    const blob = montarDocx({
      corpo: preencher(m.corpo, ctx),
      logo: logo ? { bytes: logo, alturaCm: 0.9 } : null,
      rodape: [emp.endereco, [emp.fone, emp.email, emp.instagram].filter(Boolean).join(' · ')].filter(Boolean),
    });
    const quem = (_v.c1_nome || _negocio?.nome || '').trim();
    const d = (_v.data_doc || hojeISO()).split('-').reverse().join('-');
    baixarBlob(blob, [m.arquivo || m.titulo, quem, d].filter(Boolean).join(' - '));
    api.request(API, { method: 'POST', body: { op: 'gerou', modelo: m.id, negocio_id: _negocio?.id || null } }).catch(() => {});
  } catch (e) {
    alert('Não consegui gerar o Word: ' + e.message);
  } finally { btn.disabled = false; btn.textContent = txt0; }
}

/* ─────────────── aba ⚙️ MODELOS (sócio/diretor) ─────────────── */
function htmlModelos() {
  if (_edit) return htmlEditor();
  const emps = empresas(), pd = padroes();
  return `
    <div class="card mt-3">
      <div style="font-weight:800">📄 Modelos</div>
      <p class="tiny muted" style="margin:4px 0 8px">Edite o texto quando a advogada revisar uma cláusula. "Voltar ao padrão" desfaz a sua edição.</p>
      <div style="display:grid;gap:6px">
        ${modelos().map(m => `<div class="flex gap-2" style="align-items:center;flex-wrap:wrap;border:1px solid var(--bd);border-radius:8px;padding:8px 12px">
          <div style="flex:1;min-width:200px"><b>${esc(m.titulo)}</b> <span class="tiny muted">· ${esc(m.categoria || '')} · ${esc(emps[m.empresa]?.nome || '')}</span>
            ${m.editado ? `<div class="tiny" style="color:var(--psm-gold)">✎ editado${_cfg.modelos[m.id]?.atualizado_por ? ' por ' + esc(_cfg.modelos[m.id].atualizado_por) : ''}${_cfg.modelos[m.id]?.atualizado_em ? ' em ' + new Date(_cfg.modelos[m.id].atualizado_em).toLocaleDateString('pt-BR') : ''}</div>` : ''}</div>
          <button class="btn btn-ghost btn-sm" data-editar="${esc(m.id)}">✏️ Editar texto</button>
          ${m.editado ? `<button class="btn btn-ghost btn-sm" data-reset="${esc(m.id)}">${m.novo ? '🗑 Excluir' : '↺ Voltar ao padrão'}</button>` : ''}
        </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm mt-2" id="mod-novo">➕ Novo modelo</button>
    </div>

    <div class="card mt-3">
      <div style="font-weight:800">🏢 Imobiliárias</div>
      <p class="tiny muted" style="margin:4px 0 8px">Razão social, CNPJ, CRECI e dados bancários que entram nos documentos.</p>
      ${Object.entries(emps).map(([id, e]) => `
        <details style="border:1px solid var(--bd);border-radius:8px;padding:8px 12px;margin-bottom:8px">
          <summary style="cursor:pointer"><b>${esc(e.nome)}</b> <span class="tiny muted">· CNPJ ${esc(e.cnpj)} · CRECI ${esc(e.creci)}</span></summary>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px">
            ${[['nome', 'Razão social'], ['cnpj', 'CNPJ'], ['creci', 'CRECI'], ['representante', 'Representante legal (assina)'], ['banco', 'Dados bancários'], ['pix', 'PIX'], ['fone', 'Telefone'], ['email', 'E-mail'], ['instagram', 'Instagram'], ['endereco', 'Endereço (rodapé)']]
              .map(([k, r]) => `<div ${k === 'endereco' ? 'style="grid-column:1/-1"' : ''}><label class="tiny muted">${r}</label><input class="input" data-emp="${esc(id)}" data-ek="${k}" value="${esc(e[k] || '')}"></div>`).join('')}
          </div>
        </details>`).join('')}
      <div style="font-weight:800;margin-top:10px">✍️ Padrões</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:6px">
        ${[['testemunha1', '1ª testemunha'], ['testemunha2', '2ª testemunha'], ['cidade_foro', 'Foro (comarca)']].map(([k, r]) => `<div><label class="tiny muted">${r}</label><input class="input" data-pad="${k}" value="${esc(pd[k] || '')}"></div>`).join('')}
      </div>
      <button class="btn btn-primary mt-3" id="emp-salvar">💾 Salvar imobiliárias e padrões</button>
    </div>`;
}

function htmlEditor() {
  const e = _edit, emps = empresas();
  const vars = [
    ...Object.entries(CAMPOS).map(([k, [r]]) => [k, r]),
    ...Object.entries(PESSOAS).flatMap(([p]) => PESSOA_CAMPOS.map(([k, r]) => [`${p}_${k}`, `${rotuloPessoa(e, p)} · ${r}`])),
    ...Object.entries(CALCULADAS),
  ];
  return `
    <div class="card mt-3">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="font-weight:800">✏️ ${e.novo && !_cfg.modelos[e.id] ? 'Novo modelo' : 'Editar: ' + esc(e.titulo)}</div>
        <button class="btn btn-ghost btn-sm" id="ed-voltar">✕ Cancelar</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px">
        <div><label class="tiny muted">Nome do documento</label><input class="input" id="ed-titulo" value="${esc(e.titulo)}"></div>
        <div><label class="tiny muted">Categoria</label><input class="input" id="ed-cat" value="${esc(e.categoria || '')}"></div>
        <div><label class="tiny muted">Nome do arquivo baixado</label><input class="input" id="ed-arq" value="${esc(e.arquivo || e.titulo)}"></div>
        <div><label class="tiny muted">Imobiliária padrão</label><select class="select" id="ed-emp">${Object.entries(emps).map(([id, x]) => `<option value="${esc(id)}" ${id === e.empresa ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(220px,1fr);gap:12px;margin-top:10px">
        <div>
          <label class="tiny muted">Texto — <code># título</code> · <code>## seção</code> · <code>**negrito**</code> · <code>---</code> linha em branco · <code>{{campo}}</code> · <code>{{#campo}}…{{/campo}}</code> só se preenchido · <code>[[ASSINATURAS]]Nome|cargo||Outro|cargo</code></label>
          <textarea class="input" id="ed-corpo" rows="28" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${esc(e.corpo)}</textarea>
        </div>
        <div>
          <label class="tiny muted">Campos disponíveis (clique pra inserir)</label>
          <div style="max-height:560px;overflow:auto;border:1px solid var(--bd);border-radius:8px;padding:6px">
            ${vars.map(([k, r]) => `<div data-ins="${esc(k)}" style="cursor:pointer;padding:3px 4px;border-radius:4px;font-size:12px" title="${esc(r)}"><code>{{${esc(k)}}}</code> <span class="muted">${esc(r)}</span></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="flex gap-2 mt-3"><button class="btn btn-primary" id="ed-salvar">💾 Salvar modelo</button></div>
    </div>`;
}

function bindModelos() {
  const $ = id => document.getElementById(id);
  if (_edit) {
    $('ed-voltar').onclick = () => { _edit = null; render(); };
    const ta = $('ed-corpo');
    _root.querySelectorAll('[data-ins]').forEach(d => d.onclick = () => {
      const ins = `{{${d.dataset.ins}}}`, s = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd ?? s);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + ins.length;
    });
    $('ed-salvar').onclick = async () => {
      const m = { titulo: $('ed-titulo').value.trim(), categoria: $('ed-cat').value.trim(), arquivo: $('ed-arq').value.trim(), empresa: $('ed-emp').value, corpo: ta.value, novo: !!_edit.novo };
      if (!m.titulo || !m.corpo.trim()) { alert('Preencha o nome e o texto.'); return; }
      await salvar({ modelos: { [_edit.id]: m } });
      _edit = null; render();
    };
    return;
  }
  _root.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => { _edit = { ...modelos().find(m => m.id === b.dataset.editar) }; render(); });
  _root.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const m = modelos().find(x => x.id === b.dataset.reset);
    if (!confirm(m.novo ? `Excluir o modelo "${m.titulo}"?` : `Descartar a edição de "${m.titulo}" e voltar ao texto padrão?`)) return;
    await salvar({ modelos: { [m.id]: null } });
    if (_modeloId === m.id) _modeloId = MODELOS_PADRAO[0].id;
    render();
  });
  $('mod-novo').onclick = () => {
    _edit = { id: 'm' + Date.now().toString(36), titulo: '', categoria: '', arquivo: '', empresa: 'psm_negocios', novo: true,
      corpo: '# TÍTULO DO DOCUMENTO\n---\nEu, {{c1_nome}}, CPF {{c1_cpf}}, …\n---\n{{cidade_foro}}, {{data_extenso}}.\n[[ASSINATURAS]]{{c1_nome}}|CPF {{c1_cpf}}' };
    render();
  };
  $('emp-salvar').onclick = async () => {
    const emps = {};
    _root.querySelectorAll('[data-emp]').forEach(i => { (emps[i.dataset.emp] = emps[i.dataset.emp] || { logo: empresas()[i.dataset.emp]?.logo || '' })[i.dataset.ek] = i.value.trim(); });
    const pad = {}; _root.querySelectorAll('[data-pad]').forEach(i => { pad[i.dataset.pad] = i.value.trim(); });
    await salvar({ empresas: emps, padroes: pad });
    for (const k of ['testemunha1', 'testemunha2', 'cidade_foro']) if (pad[k]) _v[k] = pad[k];
    alert('✅ Salvo.');
  };
}

async function salvar(body) {
  try {
    const r = await api.request(API, { method: 'POST', body: { op: 'salvar', ...body } });
    _cfg = r.cfg || _cfg;
  } catch (e) { alert('Erro ao salvar: ' + e.message); throw e; }
}
