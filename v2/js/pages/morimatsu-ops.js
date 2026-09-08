/* PSM-OS v2 — 🏯 Morimatsu & Associados · ABAS OPERACIONAIS  v87.52
   ----------------------------------------------------------------------------
   💼 Investidores (kanban + ficha + linha do tempo + nutrição)
   🏠 Imóveis (garimpo → análise de custo total / lance máximo → certame)
   🔁 Operações (arrematação → honorários → pós-arrematação → destino → saída)
   📅 Agenda (tarefas / próximos contatos)
   📜 Geração de contrato e 🧾 recibo preenchidos (janela de impressão / PDF)
   Casca, store e helpers em morimatsu.js. Tudo cria / edita / exclui no banco
   (/api/v3/morimatsu/state, item a item).
============================================================================ */
import { ativarDrag } from '../kanban-drag.js';
import { gerarMinuta, minutaPorSlug, minutas, contexto, preencher, imprimirDoc, baixarDocx } from './morimatsu-minutas.js';
import {
  S, COR, COLUNAS, OBJETIVO, PAGAMENTO, FAIXA, CAPITAL, DISP, MODAL, RAIO, ORIGEM,
  scoreDe, porta2, alertaCapital, esc, uid, num, brl, dtBR, hojeISO, autorNome, cfg, feeExito,
  invPorId, imvPorId, upsert, remover, setCol, abrirModal, fecharModal, campo, select, input, mini, render, irPara, ctxQuery,
} from './morimatsu.js';

/* ── dicionários ── */
export const IMV_STATUS = [
  { id: 'garimpado',  nome: 'Garimpado',     emoji: '🔎', cor: '#64748b' },
  { id: 'analise',    nome: 'Em análise',    emoji: '📑', cor: '#f59e0b' },
  { id: 'aprovado',   nome: 'Aprovado p/ lance', emoji: '✅', cor: '#16a34a' },
  { id: 'certame',    nome: 'Em certame',    emoji: '🔨', cor: '#ef4444' },
  { id: 'arrematado', nome: 'Arrematado',    emoji: '🏁', cor: '#9C7A3C' },   // dourado literal: import circular (TDZ) proíbe COR aqui
  { id: 'perdido',    nome: 'Perdido',       emoji: '❌', cor: '#334155' },
  { id: 'descartado', nome: 'Descartado',    emoji: '🗑', cor: '#334155' },
];
const IMV_TIPO = { apartamento: 'Apartamento', casa: 'Casa', terreno: 'Terreno', comercial: 'Sala/Loja', barracao: 'Barracão', rural: 'Sítio/Chácara', outro: 'Outro' };
const RISCO = { baixo: '🟢 Baixo', medio: '🟡 Médio', alto: '🔴 Alto' };
const TIPO_ATV = { tarefa: '☑️ Tarefa', contato: '📞 Contato', whatsapp: '💬 WhatsApp', reuniao: '🤝 Reunião', visita: '🏠 Visita', nota: '📝 Nota', email: '✉️ E-mail' };
const CHECK_POS = [['pagamento', 'Pagamento do lance (24–48h)'], ['carta', 'Carta de arrematação / contrato'], ['itbi', 'ITBI pago'], ['registro', 'Registro na matrícula'], ['desocupacao', 'Desocupação / imissão'], ['chaves', 'Chaves entregues']];
const DESTINO = { indef: 'A decidir (mesa de ciclo)', flip: '🏘 Flip — revenda pela PSM', renda: '🔑 Renda — locação PSM (adm 10%/mês)' };
const OP_STATUS = { pos: 'Pós-arrematação', destino: 'Em destino (venda/locação)', concluida: 'Concluída' };

let _busca = '', _fImv = 'ativos', _fAg = 'abertas';

/* ═══════════════════════════ 💼 INVESTIDORES ═══════════════════════════ */
export function renderInvestidores() {
  const inv = S.investidores.filter(c => !_busca || (c.nome + ' ' + (c.cidade || '') + ' ' + (c.fone || '') + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(_busca.toLowerCase()));
  const porCol = {}; inv.forEach(c => { (porCol[c.coluna || 'pre'] = porCol[c.coluna || 'pre'] || []).push(c); });
  const qual = inv.filter(c => scoreDe(c) >= 70 && c.coluna !== 'fora').length;
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div><h2 class="card-title" style="margin:0">💼 Funil do investidor</h2><div class="card-sub" style="margin:0">Arraste entre etapas. Clique no card pra abrir a ficha completa (dados, linha do tempo, imóveis, operações).</div></div>
        <span style="flex:1"></span>
        <input class="input" id="ma-busca" placeholder="🔍 nome, cidade, fone, tag" value="${esc(_busca)}" style="max-width:220px">
        <button class="btn btn-primary" id="ma-novo-inv">＋ Novo investidor</button>
      </div>
      <div class="ma-minis" style="margin:10px 0 0">
        ${mini('📥 Na esteira', inv.filter(c => c.coluna !== 'fora').length, '', '#64748b')}
        ${mini('✅ Qualificados (score ≥ 70)', qual, '', '#16a34a')}
        ${mini('🏁 Arrematados / carteira', inv.filter(c => ['arrematado', 'carteira'].includes(c.coluna)).length, '', COR.dourado)}
        ${mini('🚪 Porta 2 → Conquista', inv.filter(porta2).length, '', '#0ea5e9')}
        ${mini('⏰ Sem próximo passo', inv.filter(c => c.coluna !== 'fora' && !S.atividades.some(a => !a.feito && a.investidor_id === c.id)).length, 'agende na ficha', '#ef4444')}
      </div>
    </div>
    <div class="ma-kanban" id="ma-kanban">
      ${COLUNAS.map(col => {
        const lista = (porCol[col.id] || []).slice().sort((a, b) => scoreDe(b) - scoreDe(a));
        return `<div class="ma-col" data-col="${col.id}" style="border-top-color:${col.cor}">
          <div class="ma-col-h"><b>${col.emoji} ${esc(col.nome)}</b><span class="muted">${lista.length}</span></div>
          <div class="tiny muted" style="padding:0 4px 6px">${esc(col.hint)}</div>
          <div class="ma-col-b">${lista.map(cardInv).join('') || '<div class="tiny muted" style="text-align:center;padding:14px 0">vazio</div>'}</div>
        </div>`;
      }).join('')}
    </div>`;
}
function cardInv(c) {
  const s = scoreDe(c), cor = s >= 70 ? '#16a34a' : s >= 40 ? '#d97706' : '#64748b';
  const prox = S.atividades.filter(a => !a.feito && a.investidor_id === c.id && a.quando).sort((a, b) => a.quando.localeCompare(b.quando))[0];
  const atras = prox && prox.quando.slice(0, 10) < hojeISO();
  return `<div class="ma-card" data-id="${esc(c.id)}">
    <div class="flex items-center gap-2"><b style="flex:1">${esc(c.nome)}</b><span class="ma-score" style="background:${cor}">${s}</span></div>
    <div class="tiny muted">${esc([OBJETIVO[c.objetivo], FAIXA[c.faixa], c.cidade].filter(Boolean).join(' · '))}</div>
    <div class="ma-tags">
      ${prox ? `<span class="ma-tag" style="background:${atras ? '#ef4444' : '#0ea5e9'}">${atras ? '⏰' : '📅'} ${dtBR(prox.quando)}</span>` : '<span class="ma-tag" style="background:#64748b">sem próximo passo</span>'}
      ${porta2(c) ? '<span class="ma-tag" style="background:#0ea5e9">🚪 Porta 2</span>' : ''}
      ${c.caixa ? '<span class="ma-tag" style="background:#ef4444">🔴 vínculo CAIXA</span>' : ''}
      ${alertaCapital(c) ? '<span class="ma-tag" style="background:#d97706">🟡 capital &lt; faixa</span>' : ''}
      ${(c.tags || []).map(t => `<span class="ma-tag" style="background:${COR.verde}">${esc(t)}</span>`).join('')}
    </div>
  </div>`;
}
const waLink = fone => fone ? `https://wa.me/55${String(fone).replace(/\D/g, '')}` : '';

export function abrirInvestidor(c, aba) {
  c = c || { id: null, coluna: 'pre' };
  aba = aba || (c.id ? 'timeline' : 'ficha');
  const novo = !c.id;
  const tabs = novo ? [['ficha', '📋 Ficha']] : [['timeline', '🕒 Linha do tempo'], ['ficha', '📋 Ficha'], ['imoveis', '🏠 Imóveis'], ['operacoes', '🔁 Operações']];
  const titulo = novo ? '＋ Novo investidor' : `<span style="font-family:Georgia,serif">${esc(c.nome)}</span> <span class="ma-score" style="background:${scoreDe(c) >= 70 ? '#16a34a' : scoreDe(c) >= 40 ? '#d97706' : '#64748b'}">${scoreDe(c)}</span> <span class="tiny muted">${esc(COLUNAS.find(k => k.id === (c.coluna || 'pre'))?.nome || '')}</span>`;
  const html = `
    ${novo ? '' : `<div class="flex gap-2" style="flex-wrap:wrap">
      ${c.fone ? `<a class="btn btn-ghost" href="${waLink(c.fone)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      <button class="btn btn-ghost" id="d-tarefa">📅 Agendar próximo passo</button>
      <button class="btn btn-ghost" id="d-contrato">📜 Gerar contrato</button>
      <button class="btn btn-ghost" id="d-imovel">🏠 Vincular imóvel</button>
      <button class="btn btn-danger" id="d-del" style="margin-left:auto">🗑 Excluir</button>
    </div>`}
    <div class="ma-drawer-tabs">${tabs.map(([id, l]) => `<button class="btn ${id === aba ? 'btn-primary' : 'btn-ghost'} d-tab" data-tab="${id}" style="font-size:12px;padding:5px 10px">${l}</button>`).join('')}</div>
    <div id="d-body">${{ ficha: fichaInv, timeline: timelineInv, imoveis: imoveisInv, operacoes: operacoesInv }[aba](c)}</div>`;
  abrirModal(titulo, html, box => {
    box.querySelectorAll('.d-tab').forEach(b => b.onclick = () => abrirInvestidor(c, b.dataset.tab));
    if (!novo) {
      box.querySelector('#d-tarefa').onclick = () => editarAtividade(null, { investidor_id: c.id, tipo: 'contato' }, () => abrirInvestidor(invPorId(c.id), 'timeline'));
      box.querySelector('#d-contrato').onclick = () => gerarContrato(c);
      box.querySelector('#d-imovel').onclick = () => vincularImovel(c);
      box.querySelector('#d-del').onclick = async () => {
        if (!confirm(`Excluir ${c.nome}? As atividades dele também somem. Não tem volta.`)) return;
        fecharModal();
        for (const a of S.atividades.filter(a => a.investidor_id === c.id)) await remover('atividades', a.id);
        await remover('investidores', c.id);
      };
    }
    wireFichaInv(box, c);
    wireTimeline(box, () => abrirInvestidor(invPorId(c.id), 'timeline'));
    box.querySelectorAll('[data-abrir-imv]').forEach(b => b.onclick = () => abrirImovel(imvPorId(b.dataset.abrirImv)));
    box.querySelectorAll('[data-abrir-op]').forEach(b => b.onclick = () => abrirOperacao(S.operacoes.find(o => o.id === b.dataset.abrirOp)));
  }, 860);
}
function fichaInv(c) {
  const selMulti = (name, map, val) => `<select class="input" name="${name}" multiple size="4">${Object.entries(map).map(([k, v]) => `<option value="${k}" ${(val || []).includes(k) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  return `<form class="ma-form" id="f-inv">
    ${campo('Nome completo *', input('nome', c.nome, 'text', 'required'))}
    ${campo('WhatsApp (com DDD)', input('fone', c.fone))}
    ${campo('E-mail', input('email', c.email, 'email'))}
    ${campo('CPF / CNPJ (pro contrato)', input('documento', c.documento))}
    ${campo('Endereço completo (pro contrato)', input('endereco', c.endereco), true)}
    ${campo('Cidade onde mora', input('cidade', c.cidade))}
    ${campo('Pessoa', select('pj', { pf: 'Pessoa física', pj: 'Pessoa jurídica', pfemp: 'Empresa, compra em nome PF' }, c.pj))}
    ${campo('Objetivo (roteio)', select('objetivo', OBJETIVO, c.objetivo))}
    ${campo('Como pretende pagar', select('pagamento', PAGAMENTO, c.pagamento))}
    ${campo('Faixa de valor do imóvel', select('faixa', FAIXA, c.faixa))}
    ${campo('Capital disponível (lance + custas)', select('capital', CAPITAL, c.capital))}
    ${campo('Disponibilidade do recurso', select('disp', DISP, c.disp))}
    ${campo('Modalidades (ctrl/cmd p/ várias)', selMulti('modalidades', MODAL, c.modalidades))}
    ${campo('Região de interesse', `<select class="input" name="regiao"><option value="">—</option>${RAIO.map(r => `<option ${c.regiao === r ? 'selected' : ''}>${r}</option>`).join('')}<option value="Outra" ${c.regiao === 'Outra' ? 'selected' : ''}>Outra (fora do raio)</option></select>`)}
    ${campo('Ocupação aceita', select('ocupacao', { 'Preferência por desocupado': 'Preferência por desocupado', 'Aceito ocupado': 'Aceito ocupado', 'Indiferente': 'Indiferente' }, c.ocupacao))}
    ${campo('Como conheceu', select('origem', Object.fromEntries(ORIGEM.map(o => [o, o])), c.origem))}
    ${campo('Etapa', `<select class="input" name="coluna">${COLUNAS.map(k => `<option value="${k.id}" ${(c.coluna || 'pre') === k.id ? 'selected' : ''}>${k.emoji} ${esc(k.nome)}</option>`).join('')}</select>`)}
    ${campo('Vínculo CAIXA (empregado ou parente)', select('caixa', { '1': 'Sim — trava leilões CAIXA' }, c.caixa ? '1' : ''))}
    ${campo('Responsável', input('responsavel', c.responsavel || autorNome()))}
    ${campo('Tags (vírgula)', input('tags', (c.tags || []).join(', ')))}
    ${campo('Observações', `<textarea class="input" name="obs" rows="3">${esc(c.obs || '')}</textarea>`, true)}
    <div class="flex gap-2" style="grid-column:1/-1;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit">💾 Salvar</button>
      <button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button>
      <span class="tiny muted">Score: 25 faixa foco · 15 região · 10 modalidade · 30 capital ≥ faixa · 20 recurso ≤ 30d · Porta 2 = uso próprio + financiamento + ≤ 400k</span>
    </div></form>`;
}
function wireFichaInv(box, c) {
  const form = box.querySelector('#f-inv'); if (!form) return;
  box.querySelector('#f-cancel').onclick = fecharModal;
  form.onsubmit = async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    const it = { ...c };
    ['nome', 'fone', 'email', 'documento', 'endereco', 'cidade', 'pj', 'objetivo', 'pagamento', 'faixa', 'capital', 'disp', 'regiao', 'ocupacao', 'origem', 'coluna', 'responsavel', 'obs'].forEach(k => { it[k] = String(fd.get(k) || '').trim(); });
    it.modalidades = fd.getAll('modalidades'); it.caixa = !!fd.get('caixa');
    it.tags = String(fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!it.nome) return;
    const agora = new Date().toISOString();
    if (!it.id) { it.id = uid('inv'); it.criado_em = agora; it.hist = [{ em: agora, o: 'criado', por: autorNome() }]; }
    else if (c.coluna !== it.coluna) it.hist = [...(c.hist || []), { em: agora, o: 'etapa:' + it.coluna, por: autorNome() }];
    it.score = scoreDe(it); it.porta = porta2(it) ? 2 : 1;
    fecharModal(); await upsert('investidores', it);
    if (!c.id) abrirInvestidor(invPorId(it.id), 'timeline');
  };
}
function timelineInv(c) {
  const atv = S.atividades.filter(a => a.investidor_id === c.id);
  return `
    <div class="ma-minis">${mini('Objetivo', OBJETIVO[c.objetivo] || '—', PAGAMENTO[c.pagamento] || '')}${mini('Faixa · capital', `${FAIXA[c.faixa] || '—'}`, `${CAPITAL[c.capital] || ''} · ${DISP[c.disp] || ''}`)}${mini('Contato', esc(c.fone || '—'), esc([c.email, c.cidade].filter(Boolean).join(' · ')))}${mini('Origem', esc(c.origem || '—'), `resp. ${esc(c.responsavel || '')}`)}</div>
    ${c.obs ? `<div class="tiny" style="margin-bottom:8px"><b>Obs:</b> ${esc(c.obs)}</div>` : ''}
    ${porta2(c) ? '<div class="alert alert-warn" style="font-size:12.5px">🚪 Roteio Porta 2: moradia MCMV — encaminhar pra PSM Conquista. A marca Morimatsu não fala com comprador MCMV.</div>' : ''}
    ${c.caixa ? '<div class="alert alert-err" style="font-size:12.5px">🔴 Vínculo com a CAIXA declarado — leilões CAIXA bloqueados até avaliação do sócio.</div>' : ''}
    ${timelineHtml(atv, { investidor_id: c.id })}`;
}
function timelineHtml(atv, defaults) {
  const hoje = hojeISO();
  const abertas = atv.filter(a => !a.feito).sort((a, b) => (a.quando || '9').localeCompare(b.quando || '9'));
  const feitas = atv.filter(a => a.feito).sort((a, b) => (b.feito_em || '').localeCompare(a.feito_em || ''));
  const li = a => `<div class="ma-tl ${a.feito ? 'feito' : ''} ${!a.feito && a.quando && a.quando.slice(0, 10) < hoje ? 'atrasada' : ''}" data-atv="${esc(a.id)}">
    <span class="ma-tl-ico">${(TIPO_ATV[a.tipo] || '📝').slice(0, 2)}</span>
    <div style="flex:1"><div>${esc(a.texto)}</div><div class="tiny muted">${a.quando ? '📅 ' + dtBR(a.quando) + (a.quando.length > 10 ? ' ' + a.quando.slice(11, 16) : '') + ' · ' : ''}${esc((TIPO_ATV[a.tipo] || '').slice(3))} · ${esc(a.autor || '')}${a.feito ? ' · ✓ ' + dtBR(a.feito_em) : ''}${defaults.investidor_id ? '' : (invPorId(a.investidor_id) ? ' · ' + esc(invPorId(a.investidor_id).nome) : '')}${a.imovel_id && imvPorId(a.imovel_id) ? ' · 🏠 ' + esc(imvPorId(a.imovel_id).titulo) : ''}</div></div>
    <div class="flex gap-2">${a.feito ? '' : `<button class="btn btn-ghost t-done" data-id="${esc(a.id)}" title="concluir" style="font-size:11px;padding:2px 6px">✓</button>`}<button class="btn btn-ghost t-edit" data-id="${esc(a.id)}" style="font-size:11px;padding:2px 6px">✏️</button><button class="btn btn-ghost t-del" data-id="${esc(a.id)}" style="font-size:11px;padding:2px 6px">🗑</button></div>
  </div>`;
  return `<div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
      <input class="input" id="t-rapido" placeholder="Registrar rápido: o que aconteceu / próximo passo…" style="flex:1;min-width:220px">
      <select class="input" id="t-tipo" style="max-width:150px">${Object.entries(TIPO_ATV).map(([k, v]) => `<option value="${k}" ${k === 'contato' ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input class="input" id="t-quando" type="date" style="max-width:150px" title="data do próximo passo (vazio = registro do que já aconteceu)">
      <button class="btn btn-primary" id="t-add">＋</button>
    </div>
    <div class="tiny muted" style="margin-top:4px">Com data = tarefa/próximo contato (aparece na Agenda). Sem data = registro já feito.</div>
    <div class="ma-timeline">
      ${abertas.length ? '<div class="ma-sec">Próximos passos</div>' + abertas.map(li).join('') : ''}
      ${feitas.length ? '<div class="ma-sec">Histórico</div>' + feitas.slice(0, 60).map(li).join('') : ''}
      ${!atv.length ? '<div class="tiny muted">Nenhum registro ainda. Anote o primeiro contato ou agende o diagnóstico.</div>' : ''}
    </div>
    <div id="t-defaults" data-json="${esc(JSON.stringify(defaults))}" hidden></div>`;
}
function wireTimeline(box, refresh) {
  const add = box.querySelector('#t-add'); if (!add) return;
  const defaults = JSON.parse(box.querySelector('#t-defaults')?.dataset.json || '{}');
  const salvarRapido = async () => {
    const texto = box.querySelector('#t-rapido').value.trim(); if (!texto) return;
    const quando = box.querySelector('#t-quando').value;
    const a = { id: uid('atv'), ...defaults, tipo: box.querySelector('#t-tipo').value, texto, quando: quando || null, feito: !quando, feito_em: quando ? null : new Date().toISOString(), autor: autorNome(), criado_em: new Date().toISOString() };
    await upsert('atividades', a); refresh();
  };
  add.onclick = salvarRapido;
  box.querySelector('#t-rapido').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); salvarRapido(); } };
  box.querySelectorAll('.t-done').forEach(b => b.onclick = async () => { const a = S.atividades.find(x => x.id === b.dataset.id); if (!a) return; await upsert('atividades', { ...a, feito: true, feito_em: new Date().toISOString() }); refresh(); });
  box.querySelectorAll('.t-edit').forEach(b => b.onclick = () => editarAtividade(S.atividades.find(x => x.id === b.dataset.id), null, refresh));
  box.querySelectorAll('.t-del').forEach(b => b.onclick = async () => { if (!confirm('Excluir este registro?')) return; await remover('atividades', b.dataset.id); refresh(); });
}
function imoveisInv(c) {
  const lista = S.imoveis.filter(i => i.investidor_id === c.id);
  return `<div class="ma-list">${lista.map(liImovel).join('') || '<div class="tiny muted">Nenhum imóvel vinculado. Use "🏠 Vincular imóvel" acima ou crie no Garimpo.</div>'}</div>`;
}
function operacoesInv(c) {
  const lista = S.operacoes.filter(o => o.investidor_id === c.id);
  return `<div class="ma-list">${lista.map(liOperacao).join('') || '<div class="tiny muted">Nenhuma operação. Nasce quando um imóvel dele é marcado como arrematado.</div>'}</div>`;
}
function vincularImovel(c) {
  const livres = S.imoveis.filter(i => !i.investidor_id || i.investidor_id === c.id);
  abrirModal(`🏠 Vincular imóvel a ${esc(c.nome)}`, `<div class="ma-form">
    ${campo('Imóvel garimpado', `<select class="input" id="v-imv"><option value="">—</option>${livres.map(i => `<option value="${esc(i.id)}" ${i.investidor_id === c.id ? 'selected' : ''}>${esc(i.titulo)} · ${esc(i.cidade || '')} · ${brl(i.lance_min)}</option>`).join('')}</select>`, true)}
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" id="v-ok">💾 Vincular</button><button class="btn btn-ghost" id="v-novo">＋ Cadastrar imóvel novo pra ele</button></div></div>`, box => {
    box.querySelector('#v-ok').onclick = async () => { const i = imvPorId(box.querySelector('#v-imv').value); if (!i) return; fecharModal(); await upsert('imoveis', { ...i, investidor_id: c.id }); abrirInvestidor(invPorId(c.id), 'imoveis'); };
    box.querySelector('#v-novo').onclick = () => abrirImovel({ id: null, status: 'garimpado', investidor_id: c.id });
  });
}

/* ═══════════════════════════ 🏠 IMÓVEIS (garimpo + análise) ═══════════════════════════ */
export function renderImoveis() {
  const todos = S.imoveis;
  const lista = todos.filter(i => _fImv === 'todos' ? true : _fImv === 'ativos' ? !['perdido', 'descartado', 'arrematado'].includes(i.status) : i.status === _fImv)
    .filter(i => !_busca || (i.titulo + ' ' + (i.cidade || '') + ' ' + (i.bairro || '') + ' ' + (i.matricula || '')).toLowerCase().includes(_busca.toLowerCase()))
    .sort((a, b) => (a.data_certame || '9').localeCompare(b.data_certame || '9'));
  const hoje = hojeISO();
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div><h2 class="card-title" style="margin:0">🏠 Garimpo e análise</h2><div class="card-sub" style="margin:0">Retomados Caixa e leilões: cadastre, analise (custo total, lance máximo), vincule ao investidor e leve ao certame. Arrematou → vira operação.</div></div>
        <span style="flex:1"></span>
        <input class="input" id="ma-busca" placeholder="🔍 endereço, cidade, matrícula" value="${esc(_busca)}" style="max-width:220px">
        <button class="btn btn-primary" id="ma-novo-imv">＋ Novo imóvel</button>
      </div>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        ${[['ativos', '🟢 Ativos'], ['todos', 'Todos'], ...IMV_STATUS.map(s => [s.id, `${s.emoji} ${s.nome}`])].map(([id, l]) => `<button class="btn ${_fImv === id ? 'btn-primary' : 'btn-ghost'} f-imv" data-f="${id}" style="font-size:11.5px;padding:4px 9px">${l} <span class="muted">${id === 'ativos' ? todos.filter(i => !['perdido', 'descartado', 'arrematado'].includes(i.status)).length : id === 'todos' ? todos.length : todos.filter(i => i.status === id).length}</span></button>`).join('')}
      </div>
      <div class="ma-minis" style="margin:10px 0 0">
        ${mini('🔨 Certames nos próximos 15 dias', todos.filter(i => ['aprovado', 'certame'].includes(i.status) && i.data_certame >= hoje && i.data_certame <= new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)).length, '', '#ef4444')}
        ${mini('📑 Em análise', todos.filter(i => i.status === 'analise').length, `${brl(todos.filter(i => i.status === 'analise').length * cfg().fee.analise)} em análises`, '#f59e0b')}
        ${mini('✅ Aprovados p/ lance', todos.filter(i => i.status === 'aprovado').length, '', '#16a34a')}
        ${mini('🏁 Arrematados', todos.filter(i => i.status === 'arrematado').length, '', COR.dourado)}
      </div>
    </div>
    <div class="ma-list">${lista.map(liImovel).join('') || '<div class="card tiny muted">Nenhum imóvel nesse filtro. Cadastre o primeiro garimpo do portal da Caixa.</div>'}</div>`;
}
function liImovel(i) {
  const st = IMV_STATUS.find(s => s.id === i.status) || IMV_STATUS[0];
  const an = analise(i);
  const inv = invPorId(i.investidor_id);
  const hoje = hojeISO();
  return `<div class="ma-li" data-abrir-imv="${esc(i.id)}">
    <div>
      <div class="flex items-center gap-2" style="flex-wrap:wrap"><b>${esc(i.titulo)}</b><span class="ma-status" style="background:${st.cor}">${st.emoji} ${esc(st.nome)}</span>${i.data_certame ? `<span class="ma-tag" style="background:${i.data_certame < hoje ? '#64748b' : '#ef4444'}">🔨 ${dtBR(i.data_certame)}</span>` : ''}${i.ocupado ? '<span class="ma-tag" style="background:#d97706">ocupado</span>' : ''}${i.aceita_fin ? '<span class="ma-tag" style="background:#0ea5e9">financiável · Porta 2</span>' : ''}${i.analise?.risco ? `<span class="ma-tag" style="background:#334155">${RISCO[i.analise.risco]}</span>` : ''}</div>
      <div class="tiny muted">${esc([IMV_TIPO[i.tipo], i.bairro, i.cidade, MODAL[i.modalidade], i.credor].filter(Boolean).join(' · '))}${i.matricula ? ' · matr. ' + esc(i.matricula) : ''}</div>
      <div class="tiny" style="margin-top:3px">Avaliação ${brl(i.avaliacao)} · lance mín. ${brl(i.lance_min)}${an.lance_max ? ` · <b>lance máx. ${brl(an.lance_max)}</b>` : ''}${an.desconto ? ` · desconto ${an.desconto}%` : ''}${inv ? ` · 💼 ${esc(inv.nome)}` : ' · <span class="muted">sem investidor</span>'}</div>
    </div>
    <div class="tiny muted" style="text-align:right">${an.lance_base ? `custo total<br><b>${brl(an.custo_total)}</b>` : ''}</div>
  </div>`;
}
/* ═══════════ 🧮 MOTOR DE VIABILIDADE v2 (v87.57) ═══════════
   Reescrito depois da auditoria da planilha da GM (08/set). O que mudou em
   relação ao motor anterior desta tela:
     · preço de saída é % do valor de MERCADO (antes o lucro vinha de uma
       revenda 35% acima do mercado — era a premissa que fabricava o resultado)
     · custo de oportunidade FORA dos custos (não é desembolso; inflava o ROI)
     · ITBI sobre a MAIOR base entre venal de referência e lance
     · fee da Morimatsu dentro do custo do investidor (piso incluído)
     · taxa de ocupação da Caixa enquanto o imóvel estiver ocupado
     · IR sobre o ganho de capital correto (venda − custo de aquisição), PF ou PJ
     · break-even = investimento ÷ (1 − corretagem); no equilíbrio não há IR
     · prazo = desocupação + reforma + comercialização (a ocupação puxa o prazo)
     · TIR mensal comparada com a TMA mensal — o ROI anualizado virou referência
   Cada imóvel é calculado nas DUAS ROTAS (ocupado × desocupado) e em três
   cenários econômicos. A conta decide, não a estratégia. */

export const VIAB_DEFAULT = {
  fator_venda: 97,      // % do valor de mercado que se consegue na revenda rápida
  regime: 'PF',         // PF = 15% sobre o ganho · PJ = carga sobre a receita
  fee_no_custo: true,   // o fee da assessoria entra no custo do investidor
  taxa_ocup_mes: 0.5,   // % ao mês sobre a avaliação, enquanto ocupado (Caixa)
  margem_alvo: 20,      // % sobre o investimento — base do lance máximo
  tma_aa: 15,           // % ao ano
  itbi: 2, registro: 1.5, escritura: 1, leiloeiro: 5, banco: 2, plataforma: 3,
  ir_pf: 15, carga_pj: 5.93,
  iptu_ano: 2400, cond_mes: 600, util_mes: 150, seguro_ano: 800, manut_mes: 200,
};
export const viab = () => ({ ...VIAB_DEFAULT, ...(S.config?.viab || {}) });
export const posseMes = () => { const v = viab(); return v.iptu_ano / 12 + v.cond_mes + v.util_mes + v.seguro_ano / 12 + v.manut_mes; };
export const tmaMes = () => Math.pow(1 + viab().tma_aa / 100, 1 / 12) - 1;
const ehLeilao = i => ['extra', 'judicial'].includes(i.modalidade);
const canalPct = i => { const v = viab(); return i.modalidade === 'direta' ? v.banco / 100 : i.modalidade === 'online' ? v.plataforma / 100 : 0; };

/* Parâmetros do imóvel, com os padrões de quem ainda não preencheu */
function par(i, o) {
  const v = viab(), A = { ...(i.analise || {}) };
  const aval = num(i.avaliacao) || num(i.lance_min) || 0;
  const desoc = (o.desocupado != null) ? o.desocupado : !i.ocupado;
  const m_oc = desoc ? 0 : (A.m_ocup != null ? num(A.m_ocup) : 3);
  return {
    v, A, aval, desoc, m_oc,
    merc: num(A.mercado) || aval,
    venal: num(A.venal) || aval,
    L: num(o.lance != null ? o.lance : (A.lance_base || i.lance_min)),
    m_ref: A.m_reforma != null ? num(A.m_reforma) : 2,
    m_ven: A.m_venda != null ? num(A.m_venda) : 3,
    reforma: (num(A.reforma) || 0) * (o.multRef || 1),
    mobilia: num(A.mobilia) || 0,
    dd: A.dd != null ? num(A.dd) : 1500,
    advogado: desoc ? 0 : (A.advogado != null ? num(A.advogado) : 8000),
    debitos: num(A.debitos) || num(i.debitos_cond) || 0,
    fator: (o.fator != null ? o.fator : (num(A.fator_venda) || v.fator_venda)) / 100,
  };
}

export function motor(i, o) {
  o = o || {};
  const P = par(i, o), v = P.v, f = cfg().fee;
  const L = P.L;
  const prazo = Math.max(1, P.m_oc + P.m_ref + P.m_ven + (o.extra || 0));
  const feeEntra = v.fee_no_custo !== false;
  const c = {
    lance: L,
    leiloeiro: ehLeilao(i) ? L * v.leiloeiro / 100 : 0,
    canal: L * canalPct(i),
    escritura: ehLeilao(i) ? 0 : L * v.escritura / 100,
    itbi: Math.max(P.venal, L) * v.itbi / 100,
    registro: L * v.registro / 100,
    fee: (feeEntra && L > 0) ? Math.max(L * f.exito_pct / 100, num(f.piso)) + num(f.analise) + num(f.certame) : 0,
    dd: P.dd,
    advogado: P.advogado,
    ocupacao: P.desoc ? 0 : P.aval * v.taxa_ocup_mes / 100 * P.m_oc,
    debitos: P.debitos,
    reforma: P.reforma,
    mobilia: P.mobilia,
    posse: posseMes() * prazo,
  };
  const inv = Object.values(c).reduce((s, x) => s + x, 0);
  const venda = P.merc * P.fator;
  const corret = venda * f.comissao_pct / 100;
  const cf = c.lance + c.leiloeiro + c.itbi + c.registro + c.escritura + c.reforma + c.mobilia;
  const ganho = Math.max(0, venda - cf);
  const imposto = v.regime === 'PJ' ? venda * v.carga_pj / 100 : ganho * v.ir_pf / 100;
  const lucro = venda - corret - imposto - inv;
  const roi = inv ? lucro / inv : 0;
  const tir = roi <= -1 ? -1 : Math.pow(1 + roi, 1 / prazo) - 1;
  const tm = tmaMes();
  const feeGrupo = L > 0 ? Math.max(L * f.exito_pct / 100, num(f.piso)) + num(f.analise) + num(f.certame) : 0;
  return {
    L, lance_base: L, prazo, custos: c, inv, custo_total: inv, venda, corret, cf, ganho, imposto,
    lucro, roi, tir, tma_m: tm, fee: c.fee, feeGrupo, receitaGrupo: feeGrupo + corret,
    vpl: -inv + (venda - corret - imposto) / Math.pow(1 + tm, prazo),
    breakeven: inv / (1 - f.comissao_pct / 100),
    desconto: P.merc && L ? Math.round((1 - L / P.merc) * 100) : 0,
    desconto_aval: P.aval && L ? Math.round((1 - L / P.aval) * 100) : 0,
    viavel: lucro > 0 && tir >= tm, desoc: P.desoc, merc: P.merc, aval: P.aval,
  };
}

/* Lance máximo: dada a saída provável e a margem exigida, quanto dá para cobrir.
   Fórmula fechada (assume venal ≥ lance, o caso normal em arrematação com deságio);
   se o piso do fee passar a valer, resolve de novo com o fee fixo. */
export function lanceMax(i, o, margemPct) {
  o = o || {};
  const P = par(i, o), v = P.v, f = cfg().fee;
  const m = (margemPct != null ? margemPct : (num(P.A.margem_pct) || v.margem_alvo)) / 100;
  const prazo = Math.max(1, P.m_oc + P.m_ref + P.m_ven + (o.extra || 0));
  const feeEntra = v.fee_no_custo !== false;
  const V = P.merc * P.fator, cor = f.comissao_pct / 100;
  const ITBI = P.venal * v.itbi / 100;
  const B = P.reforma + P.mobilia;
  const F = P.dd + P.advogado + (P.desoc ? 0 : P.aval * v.taxa_ocup_mes / 100 * P.m_oc)
    + P.debitos + B + posseMes() * prazo + (feeEntra ? num(f.analise) + num(f.certame) : 0);
  const k = 1 + (ehLeilao(i) ? v.leiloeiro / 100 : 0) + v.registro / 100 + (ehLeilao(i) ? 0 : v.escritura / 100);
  const pj = v.regime === 'PJ';
  const tau = pj ? 0 : v.ir_pf / 100;
  const solve = (K, Ff) => pj
    ? (V * (1 - cor - v.carga_pj / 100) / (1 + m) - ITBI - Ff) / K
    : (V * (1 - cor - tau) + tau * (ITBI + B) - (1 + m) * (ITBI + Ff)) / ((1 + m) * K - tau * k);
  let L = solve(k + canalPct(i) + (feeEntra ? f.exito_pct / 100 : 0), F);
  if (feeEntra && L * f.exito_pct / 100 < num(f.piso)) L = solve(k + canalPct(i), F + num(f.piso));
  return Math.max(0, Math.floor(L / 500) * 500);
}

/* Compat: liImovel e criarOperacao continuam chamando analise(i) */
export function analise(i) {
  const r = motor(i, {});
  r.lance_max = lanceMax(i, {});
  return r;
}

const CENARIOS = [
  { id: 'pes', nome: 'Pessimista', dFator: -7, multRef: 1.3, extra: 3, cor: '#ef4444' },
  { id: 'base', nome: 'Base', dFator: 0, multRef: 1, extra: 0, cor: '#9C7A3C' },   // literal: import circular proíbe COR no top-level
  { id: 'oti', nome: 'Otimista', dFator: 3, multRef: 0.85, extra: -1, cor: '#16a34a' },
];

export function abrirImovel(i, aba) {
  i = i || { id: null, status: 'garimpado' };
  aba = aba || (i.id ? 'analise' : 'dados');
  const novo = !i.id;
  const tabs = novo ? [['dados', '📋 Dados']] : [['analise', '🧮 Análise'], ['dados', '📋 Dados'], ['timeline', '🕒 Atividades']];
  const st = IMV_STATUS.find(s => s.id === i.status) || IMV_STATUS[0];
  const titulo = novo ? '＋ Novo imóvel (garimpo)' : `<span style="font-family:Georgia,serif">${esc(i.titulo)}</span> <span class="ma-status" style="background:${st.cor}">${st.emoji} ${esc(st.nome)}</span>`;
  const html = `
    ${novo ? '' : `<div class="flex gap-2" style="flex-wrap:wrap">
      ${/^https?:\/\//i.test(i.link || '') ? `<a class="btn btn-ghost" href="${esc(i.link)}" target="_blank" rel="noopener">🔗 Edital / anúncio</a>` : ''}
      <button class="btn btn-ghost" id="d-parecer">📄 Gerar parecer</button>
      <button class="btn btn-ghost" id="d-tarefa">📅 Agendar passo</button>
      ${i.status !== 'arrematado' ? `<button class="btn btn-gold" id="d-arrematar">🏁 Arrematado → criar operação</button>` : `<button class="btn btn-ghost" data-abrir-op="${esc((S.operacoes.find(o => o.imovel_id === i.id) || {}).id || '')}">🔁 Abrir operação</button>`}
      <button class="btn btn-danger" id="d-del" style="margin-left:auto">🗑 Excluir</button>
    </div>`}
    <div class="ma-drawer-tabs">${tabs.map(([id, l]) => `<button class="btn ${id === aba ? 'btn-primary' : 'btn-ghost'} d-tab" data-tab="${id}" style="font-size:12px;padding:5px 10px">${l}</button>`).join('')}</div>
    <div id="d-body">${{ dados: dadosImv, analise: analiseImv, timeline: i2 => timelineHtml(S.atividades.filter(a => a.imovel_id === i2.id), { imovel_id: i2.id, investidor_id: i2.investidor_id || undefined }) }[aba](i)}</div>`;
  abrirModal(titulo, html, box => {
    box.querySelectorAll('.d-tab').forEach(b => b.onclick = () => abrirImovel(i, b.dataset.tab));
    if (!novo) {
      box.querySelector('#d-parecer').onclick = () => gerarParecer(i);
      box.querySelector('#d-tarefa').onclick = () => editarAtividade(null, { imovel_id: i.id, investidor_id: i.investidor_id || undefined, tipo: 'tarefa' }, () => abrirImovel(imvPorId(i.id), 'timeline'));
      const arr = box.querySelector('#d-arrematar'); if (arr) arr.onclick = () => criarOperacao(i);
      const ao = box.querySelector('[data-abrir-op]'); if (ao) ao.onclick = () => { const o = S.operacoes.find(x => x.id === ao.dataset.abrirOp); if (o) abrirOperacao(o); };
      box.querySelector('#d-del').onclick = async () => { if (!confirm(`Excluir ${i.titulo}?`)) return; fecharModal(); for (const a of S.atividades.filter(a => a.imovel_id === i.id)) await remover('atividades', a.id); await remover('imoveis', i.id); };
    }
    wireDadosImv(box, i); wireAnaliseImv(box, i);
    wireTimeline(box, () => abrirImovel(imvPorId(i.id), 'timeline'));
  }, 860);
}
function dadosImv(i) {
  const invs = Object.fromEntries(S.investidores.filter(c => c.coluna !== 'fora').map(c => [c.id, c.nome]));
  return `<form class="ma-form" id="f-imv">
    ${campo('Identificação (endereço curto) *', input('titulo', i.titulo, 'text', 'required placeholder="Ap. 32 · Ed. Solar · Rua X, 100"'), true)}
    ${campo('Tipo', select('tipo', IMV_TIPO, i.tipo))}
    ${campo('Cidade', input('cidade', i.cidade || 'São José do Rio Preto'))}
    ${campo('Bairro', input('bairro', i.bairro))}
    ${campo('Área útil (m²)', input('area', i.area, 'number'))}
    ${campo('Matrícula nº', input('matricula', i.matricula))}
    ${campo('Cartório / CRI', input('cartorio', i.cartorio))}
    ${campo('Modalidade', select('modalidade', MODAL, i.modalidade))}
    ${campo('Credor / instituição', input('credor', i.credor || 'CAIXA'))}
    ${campo('Leiloeiro / portal', input('leiloeiro', i.leiloeiro))}
    ${campo('Link do edital / anúncio', input('link', i.link, 'url'), true)}
    ${campo('Avaliação (R$)', input('avaliacao', i.avaliacao, 'number'))}
    ${campo('Lance mínimo / preço (R$)', input('lance_min', i.lance_min, 'number'))}
    ${campo('Data do certame / prazo', input('data_certame', i.data_certame, 'date'))}
    ${campo('Status', `<select class="input" name="status">${IMV_STATUS.map(s => `<option value="${s.id}" ${(i.status || 'garimpado') === s.id ? 'selected' : ''}>${s.emoji} ${esc(s.nome)}</option>`).join('')}</select>`)}
    ${campo('Investidor vinculado', select('investidor_id', invs, i.investidor_id))}
    ${campo('Ocupado?', select('ocupado', { '1': 'Sim — precificar desocupação ANTES do lance' }, i.ocupado ? '1' : ''))}
    ${campo('Aceita financiamento (Porta 2)?', select('aceita_fin', { '1': 'Sim — candidato à vitrine Conquista' }, i.aceita_fin ? '1' : ''))}
    ${campo('Débitos de condomínio conhecidos (R$)', input('debitos_cond', i.debitos_cond, 'number'))}
    ${campo('Observações (edital, visita, riscos)', `<textarea class="input" name="obs" rows="3">${esc(i.obs || '')}</textarea>`, true)}
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`;
}
function wireDadosImv(box, i) {
  const form = box.querySelector('#f-imv'); if (!form) return;
  box.querySelector('#f-cancel').onclick = fecharModal;
  form.onsubmit = async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    const it = { ...i };
    ['titulo', 'tipo', 'cidade', 'bairro', 'matricula', 'cartorio', 'modalidade', 'credor', 'leiloeiro', 'link', 'data_certame', 'status', 'investidor_id', 'obs'].forEach(k => { it[k] = String(fd.get(k) || '').trim(); });
    ['avaliacao', 'lance_min', 'debitos_cond', 'area'].forEach(k => { it[k] = num(fd.get(k)); });
    it.ocupado = !!fd.get('ocupado'); it.aceita_fin = !!fd.get('aceita_fin');
    if (!it.titulo) return;
    if (!it.id) { it.id = uid('imv'); it.criado_em = new Date().toISOString(); it.analise = { ...CUSTOS_DEFAULT, debitos: it.debitos_cond || 0 }; }
    else if (it.analise && it.debitos_cond && !num(it.analise.debitos)) it.analise.debitos = it.debitos_cond;
    fecharModal(); await upsert('imoveis', it);
    if (!i.id) abrirImovel(imvPorId(it.id), 'analise');
  };
}
function analiseImv(i) {
  const v = viab(), A = { ...(i.analise || {}) }, f = cfg().fee;
  const fatorBase = num(A.fator_venda) || v.fator_venda;
  const cen = CENARIOS.map(c => ({ ...c, r: motor(i, { fator: fatorBase + c.dFator, multRef: c.multRef, extra: c.extra }) }));
  const base = cen[1].r;
  const rotaOcup = { r: motor(i, { desocupado: false }), lm: lanceMax(i, { desocupado: false }) };
  const rotaDeso = { r: motor(i, { desocupado: true }), lm: lanceMax(i, { desocupado: true }) };
  const lm = lanceMax(i, {});
  const custoOcupacao = rotaOcup.r.inv - rotaDeso.r.inv;
  return `<form class="ma-form" id="f-an" style="grid-template-columns:repeat(auto-fit,minmax(155px,1fr))">
    ${campo('Valor de mercado (R$)', input('mercado', A.mercado || i.avaliacao, 'number', 'placeholder="o que vale de verdade"'))}
    ${campo('Venal de referência — base do ITBI', input('venal', A.venal || i.avaliacao, 'number'))}
    ${campo('Lance / preço de compra (R$)', input('lance_base', A.lance_base || i.lance_min, 'number'))}
    ${campo('Meses até desocupar', input('m_ocup', A.m_ocup != null ? A.m_ocup : 3, 'number'))}
    ${campo('Meses de reforma', input('m_reforma', A.m_reforma != null ? A.m_reforma : 2, 'number'))}
    ${campo('Meses de comercialização', input('m_venda', A.m_venda != null ? A.m_venda : 3, 'number'))}
    ${campo('Reforma (R$)', input('reforma', A.reforma, 'number'))}
    ${campo('Mobília (R$)', input('mobilia', A.mobilia, 'number'))}
    ${campo('Due diligence (R$)', input('dd', A.dd != null ? A.dd : 1500, 'number'))}
    ${campo('Advogado + imissão (R$)', input('advogado', A.advogado != null ? A.advogado : 8000, 'number'))}
    ${campo('Débitos do edital (R$)', input('debitos', A.debitos || i.debitos_cond, 'number'))}
    ${campo('Preço de saída (% do mercado)', input('fator_venda', fatorBase, 'number', 'step="0.5"'))}
    ${campo('Margem alvo (%)', input('margem_pct', A.margem_pct || v.margem_alvo, 'number'))}
    ${campo('Risco', select('risco', RISCO, A.risco))}
    ${campo('Parecer (ocupação, edital, condomínio, estado)', `<textarea class="input" name="parecer" rows="3">${esc(A.parecer || '')}</textarea>`, true)}
    <div class="flex gap-2" style="grid-column:1/-1;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit">💾 Salvar análise</button>
      <button class="btn btn-ghost" type="button" id="an-cfg">⚙️ Premissas do modelo</button>
      <span class="tiny muted">Fee ${f.exito_pct}% (piso ${brl(f.piso)}) · corretagem PSM ${f.comissao_pct}% · ITBI ${v.itbi}% · taxa de ocupação ${v.taxa_ocup_mes}%/mês · ${v.regime}</span>
    </div>
  </form>
  <div id="an-out">${anOut(i, cen, lm, rotaOcup, rotaDeso, custoOcupacao)}</div>`;
}

function anOut(i, cen, lm, rotaOcup, rotaDeso, custoOcupacao) {
  const base = cen[1].r, v = viab();
  const linha = (lbl, fn, fmt) => `<tr><td>${lbl}</td>${cen.map(c => `<td class="ma-num" style="text-align:right">${fmt(fn(c.r))}</td>`).join('')}</tr>`;
  const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
  const rota = (nome, R, atual) => `<div class="ma-rota ${atual ? 'on' : ''}">
      <div class="tiny" style="letter-spacing:1.2px;text-transform:uppercase;font-weight:800;opacity:.7">${nome}${atual ? ' · como está' : ''}</div>
      <div class="ma-mini-v" style="color:${R.r.lucro > 0 ? '#16a34a' : '#ef4444'}">${brl(R.r.lucro)}</div>
      <div class="tiny muted">lucro do investidor · ROI ${pct(R.r.roi)} em ${R.r.prazo}m</div>
      <div class="tiny" style="margin-top:6px">Lance máximo <b>${brl(R.lm)}</b> <span class="muted">(deságio ${R.r.aval ? Math.round((1 - R.lm / R.r.aval) * 100) : 0}% sobre a avaliação)</span></div>
    </div>`;
  return `
    <div class="ma-sec">As duas rotas — a conta decide, não a estratégia</div>
    <div class="ma-rotas">
      ${rota('🔒 Ocupado', rotaOcup, !i.ocupado === false)}
      ${rota('🔓 Desocupado', rotaDeso, !i.ocupado === true)}
    </div>
    <div class="tiny muted" style="margin-top:6px">A ocupação custa <b style="color:#ef4444">${brl(custoOcupacao)}</b> nesta operação — advogado, taxa de ocupação da Caixa e ${rotaOcup.r.prazo - rotaDeso.r.prazo} meses a mais de posse. ${base.aval ? `Isso é ${Math.round(custoOcupacao / base.aval * 100)}% da avaliação: no ticket baixo é o que consome a margem.` : ''}</div>

    <div class="ma-sec">Três cenários</div>
    <div style="overflow-x:auto"><table class="ma-tbl">
      <tr><th></th>${cen.map(c => `<th style="text-align:right;color:${c.cor}">${c.nome}</th>`).join('')}</tr>
      ${linha('Preço de saída', r => r.venda, brl)}
      ${linha('Prazo (meses)', r => r.prazo, x => x)}
      ${linha('Investimento total', r => r.inv, brl)}
      ${linha('Lucro do investidor', r => r.lucro, brl)}
      ${linha('ROI', r => r.roi, pct)}
      ${linha('TIR ao mês', r => r.tir, x => (x * 100).toFixed(2).replace('.', ',') + '%')}
      ${linha('VPL pela TMA', r => r.vpl, brl)}
      <tr><td><b>Veredito</b></td>${cen.map(c => `<td style="text-align:right"><span class="ma-status" style="background:${c.r.viavel ? '#16a34a' : '#ef4444'}">${c.r.viavel ? 'VIÁVEL' : 'INVIÁVEL'}</span></td>`).join('')}</tr>
    </table></div>
    <div class="tiny muted">TMA exigida: ${(tmaMes() * 100).toFixed(2).replace('.', ',')}% ao mês (${v.tma_aa}% ao ano). Passa quem tiver lucro positivo <i>e</i> TIR acima da TMA.</div>

    <div class="ma-minis" style="margin-top:12px">
      ${mini('🎯 LANCE MÁXIMO', brl(lm), `para ${num(i.analise?.margem_pct) || v.margem_alvo}% de margem · deságio ${base.aval ? Math.round((1 - lm / base.aval) * 100) : 0}% sobre a avaliação`, COR.dourado)}
      ${mini(base.L <= lm ? '✅ Seu lance cabe' : '🚫 Lance acima do teto', brl(Math.abs(lm - base.L)), base.L <= lm ? 'de folga até o teto' : 'acima do que a conta suporta', base.L <= lm ? '#16a34a' : '#ef4444')}
      ${mini('💵 Custo total no lance', brl(base.inv), `desconto ${base.desconto}% vs mercado · break-even ${brl(base.breakeven)}${num(i.area) ? ` · mercado ${brl(base.merc / num(i.area))}/m²` : ''}`)}
      ${mini('🏯 Receita do grupo no giro', brl(base.receitaGrupo), `fee ${brl(base.feeGrupo)} + corretagem ${brl(base.corret)}`, COR.verde)}
    </div>
    ${base.lucro <= 0 && base.receitaGrupo > 0 ? `<div class="alert alert-warn" style="font-size:12.5px;margin-top:8px">⚠️ O grupo fatura ${brl(base.receitaGrupo)} neste giro mesmo com o investidor no prejuízo. Não leve este imóvel ao cliente — com o sobrenome na porta, um caso malconduzido custa mais que o fee.</div>` : ''}`;
}

function wireAnaliseImv(box, i) {
  const form = box.querySelector('#f-an'); if (!form) return;
  const ler = () => {
    const fd = new FormData(form), a = { ...(i.analise || {}) };
    ['mercado', 'venal', 'lance_base', 'm_ocup', 'm_reforma', 'm_venda', 'reforma', 'mobilia', 'dd', 'advogado', 'debitos', 'fator_venda', 'margem_pct']
      .forEach(k => { a[k] = num(fd.get(k)); });
    a.risco = fd.get('risco'); a.parecer = String(fd.get('parecer') || '').trim();
    return a;
  };
  const redesenhar = () => {
    const it = { ...i, analise: ler() }, fb = num(ler().fator_venda) || viab().fator_venda;
    const cen = CENARIOS.map(c => ({ ...c, r: motor(it, { fator: fb + c.dFator, multRef: c.multRef, extra: c.extra }) }));
    const ro = { r: motor(it, { desocupado: false }), lm: lanceMax(it, { desocupado: false }) };
    const rd = { r: motor(it, { desocupado: true }), lm: lanceMax(it, { desocupado: true }) };
    box.querySelector('#an-out').innerHTML = anOut(it, cen, lanceMax(it, {}), ro, rd, ro.r.inv - rd.r.inv);
  };
  form.querySelectorAll('input,select').forEach(el => el.oninput = redesenhar);
  box.querySelector('#an-cfg').onclick = () => editarViab(() => abrirImovel(imvPorId(i.id), 'analise'));
  form.onsubmit = async ev => {
    ev.preventDefault();
    const it = { ...i, analise: ler() };
    if (!it.status || it.status === 'garimpado') it.status = 'analise';
    fecharModal(); await upsert('imoveis', it);
  };
}

/* Premissas do modelo — o que era decisão fixa na planilha vira parâmetro do sócio */
export function editarViab(depois) {
  const v = viab();
  abrirModal('⚙️ Premissas do modelo de viabilidade', `<form class="ma-form" id="f-viab">
    ${campo('Preço de saída padrão (% do valor de mercado)', input('fator_venda', v.fator_venda, 'number', 'step="0.5"'))}
    ${campo('Regime tributário', select('regime', { PF: 'PF — 15% sobre o ganho', PJ: 'PJ — carga sobre a receita' }, v.regime))}
    ${campo('Fee da assessoria entra no custo?', select('fee_no_custo', { sim: 'SIM — o investidor vê o custo real', nao: 'NÃO — viabilidade antes do fee' }, v.fee_no_custo === false ? 'nao' : 'sim'))}
    ${campo('Taxa de ocupação da Caixa (%/mês)', input('taxa_ocup_mes', v.taxa_ocup_mes, 'number', 'step="0.1"'))}
    ${campo('Margem alvo padrão (%)', input('margem_alvo', v.margem_alvo, 'number'))}
    ${campo('TMA (% ao ano)', input('tma_aa', v.tma_aa, 'number'))}
    ${campo('ITBI (%)', input('itbi', v.itbi, 'number', 'step="0.1"'))}
    ${campo('Registro (%)', input('registro', v.registro, 'number', 'step="0.1"'))}
    ${campo('Escritura (%)', input('escritura', v.escritura, 'number', 'step="0.1"'))}
    ${campo('Comissão do leiloeiro (%)', input('leiloeiro', v.leiloeiro, 'number', 'step="0.5"'))}
    ${campo('Taxa do banco — venda direta (%)', input('banco', v.banco, 'number', 'step="0.5"'))}
    ${campo('Taxa da plataforma — online (%)', input('plataforma', v.plataforma, 'number', 'step="0.5"'))}
    ${campo('IR ganho de capital — PF (%)', input('ir_pf', v.ir_pf, 'number', 'step="0.5"'))}
    ${campo('Carga PJ sobre a receita (%)', input('carga_pj', v.carga_pj, 'number', 'step="0.01"'))}
    ${campo('IPTU anual (R$)', input('iptu_ano', v.iptu_ano, 'number'))}
    ${campo('Condomínio mensal (R$)', input('cond_mes', v.cond_mes, 'number'))}
    ${campo('Água e energia (R$/mês)', input('util_mes', v.util_mes, 'number'))}
    ${campo('Seguro anual (R$)', input('seguro_ano', v.seguro_ano, 'number'))}
    ${campo('Manutenção (R$/mês)', input('manut_mes', v.manut_mes, 'number'))}
    <div class="tiny muted" style="grid-column:1/-1">Custo mensal de posse resultante: <b>${brl(posseMes())}</b>. Estas premissas valem para todas as análises.</div>
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div>
  </form>`, box => {
    box.querySelector('#f-cancel').onclick = () => { fecharModal(); if (depois) depois(); };
    box.querySelector('#f-viab').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target), o = {};
      ['fator_venda', 'taxa_ocup_mes', 'margem_alvo', 'tma_aa', 'itbi', 'registro', 'escritura', 'leiloeiro', 'banco', 'plataforma', 'ir_pf', 'carga_pj', 'iptu_ano', 'cond_mes', 'util_mes', 'seguro_ano', 'manut_mes']
        .forEach(k => { o[k] = num(fd.get(k)); });
      o.regime = fd.get('regime') || 'PF';
      o.fee_no_custo = fd.get('fee_no_custo') !== 'nao';
      fecharModal(); await setCol('config', { ...S.config, viab: o }); if (depois) depois();
    };
  }, 860);
}


/* ═══════════ 📄 PARECER DE VIABILIDADE — o produto de R$ 500 ═══════════
   Junta o imóvel, a análise e as premissas num documento para o investidor.
   Os números vêm do motor; o texto é a minuta 'parecer', editável em Minutas. */
export function gerarParecer(i) {
  const m = minutaPorSlug('parecer');
  if (!m) return alert('Minuta de parecer não encontrada.');
  const v = viab(), A = { ...(i.analise || {}) };
  const fb = num(A.fator_venda) || v.fator_venda;
  const cen = { pes: motor(i, { fator: fb - 7, multRef: 1.3, extra: 3 }), base: motor(i, {}), oti: motor(i, { fator: fb + 3, multRef: 0.85, extra: -1 }) };
  const ro = motor(i, { desocupado: false }), rd = motor(i, { desocupado: true });
  const lm = lanceMax(i, {});
  const b = cen.base;
  const pc = x => (x * 100).toFixed(1).replace('.', ',') + '%';
  const mm = x => 'R$ ' + num(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const meses = n => n + (n === 1 ? ' mês' : ' meses');
  const extra = {
    imovel_titulo: i.titulo || '', imovel_bairro: i.bairro || '', imovel_cidade: i.cidade || '',
    imovel_matricula: i.matricula || '', imovel_cartorio: i.cartorio || '', imovel_credor: i.credor || '',
    imovel_modalidade: ({ online: 'venda online', direta: 'venda direta online', extra: 'leilão extrajudicial', judicial: 'leilão judicial' })[i.modalidade] || '',
    imovel_tipo: i.tipo || '', imovel_link: i.link || '',
    imovel_ocupacao: i.ocupado ? 'Ocupado' : 'Desocupado',
    aval: mm(b.aval), mercado: mm(b.merc), venal: mm(num(A.venal) || i.avaliacao),
    rs_m2: num(i.area) ? mm(b.merc / num(i.area)) : '—',
    lance: mm(b.L), desagio_aval: pc(b.desconto_aval / 100), desagio_merc: pc(b.desconto / 100),
    investimento: mm(b.inv), venda: mm(b.venda), corretagem: mm(b.corret), imposto: mm(b.imposto),
    lucro: mm(b.lucro), roi: pc(b.roi), tir: (b.tir * 100).toFixed(2).replace('.', ',') + '% ao mês',
    prazo: meses(b.prazo), breakeven: mm(b.breakeven), vpl: mm(b.vpl),
    lance_maximo: mm(lm), desagio_necessario: b.aval ? pc(1 - lm / b.aval) : '—',
    veredito: b.L <= lm ? 'Lance dentro do teto — operação recomendada' : 'Lance ACIMA do teto — não recomendada neste valor',
    risco: ({ baixo: 'Baixo', medio: 'Médio', alto: 'Alto' })[A.risco] || 'não classificado',
    parecer_tecnico: A.parecer || 'Sem observações técnicas registradas nesta análise.',
    rota_oc_lucro: mm(ro.lucro), rota_oc_lm: mm(lanceMax(i, { desocupado: false })), rota_oc_prazo: meses(ro.prazo),
    rota_de_lucro: mm(rd.lucro), rota_de_lm: mm(lanceMax(i, { desocupado: true })), rota_de_prazo: meses(rd.prazo),
    custo_ocupacao: mm(ro.inv - rd.inv),
    p_fator: fb.toString().replace('.', ',') + '%', p_regime: v.regime === 'PJ' ? 'pessoa jurídica' : 'pessoa física',
    p_tma: v.tma_aa + '% ao ano', p_margem: (num(A.margem_pct) || v.margem_alvo) + '%',
  };
  Object.entries(b.custos).forEach(([k, val]) => { extra['c_' + (k === 'leiloeiro' ? 'leiloeiro' : k)] = mm(val); });
  ['pes', 'base', 'oti'].forEach(k => {
    const r = cen[k];
    extra[k + '_venda'] = mm(r.venda); extra[k + '_prazo'] = meses(r.prazo); extra[k + '_lucro'] = mm(r.lucro);
    extra[k + '_roi'] = pc(r.roi); extra[k + '_ver'] = r.viavel ? 'Viável' : 'Inviável';
  });
  const invs = Object.fromEntries(S.investidores.map(c => [c.id, c.nome]));
  abrirModal(`📄 Parecer de viabilidade — ${esc(i.titulo)}`, `<div class="ma-form">
    ${campo('Destinatário (opcional)', select('inv', invs, i.investidor_id), true)}
    <div class="tiny muted" style="grid-column:1/-1">Sai com os números da análise salva. O texto do parecer é editável na aba 📜 Minutas.</div>
    <div class="flex gap-2" style="grid-column:1/-1;flex-wrap:wrap">
      <button class="btn btn-gold" id="pa-pdf">🖨 Imprimir / PDF</button>
      <button class="btn btn-primary" id="pa-doc">⬇ Baixar Word (.docx)</button>
      <button class="btn btn-ghost" id="pa-x">Cancelar</button>
    </div></div>`, box => {
    const montar = () => {
      const inv = invPorId(box.querySelector('[name=inv]').value);
      const ctx = contexto({ inv, imv: i, extra });
      return { texto: preencher(m.corpo, ctx), nome: `Parecer de Viabilidade — ${i.titulo || 'imóvel'}` };
    };
    box.querySelector('#pa-x').onclick = fecharModal;
    box.querySelector('#pa-pdf').onclick = () => { const r = montar(); imprimirDoc(r.nome, r.texto); };
    box.querySelector('#pa-doc').onclick = () => { const r = montar(); baixarDocx(r.nome, r.texto); };
  }, 640);
}

/* ═══════════════════════════ 🔁 OPERAÇÕES ═══════════════════════════ */
function criarOperacao(i) {
  const invs = Object.fromEntries(S.investidores.filter(c => c.coluna !== 'fora').map(c => [c.id, c.nome]));
  abrirModal(`🏁 Arrematação — ${esc(i.titulo)}`, `<form class="ma-form" id="f-op">
    ${campo('Investidor *', select('investidor_id', invs, i.investidor_id, 'required'))}
    ${campo('Data da arrematação / compra', input('data', hojeISO(), 'date'))}
    ${campo('Valor da arrematação (R$) *', input('valor', i.analise?.lance_base || i.lance_min, 'number', 'required'))}
    ${campo('Destino previsto', select('destino', DESTINO, i.aceita_fin ? 'flip' : 'indef'))}
    <div class="tiny muted" style="grid-column:1/-1">Ao confirmar: o imóvel vira <b>Arrematado</b>, o investidor vai pra <b>Arrematado</b> no funil, e a operação nasce com os 3 honorários (análise, certame e êxito calculado pelos parâmetros atuais) e o checklist pós-arrematação.</div>
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-gold" type="submit">🏁 Confirmar arrematação</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`, box => {
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-op').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const invId = fd.get('investidor_id'); const valor = num(fd.get('valor')); if (!invId || !valor) return;
      const f = cfg().fee, agora = new Date().toISOString();
      const o = { id: uid('op'), investidor_id: invId, imovel_id: i.id, data_arrematacao: fd.get('data') || hojeISO(), valor, destino: fd.get('destino') || 'indef', status: 'pos',
        honorarios: { analise: { valor: f.analise, pago: false, em: null }, certame: { valor: f.certame, pago: false, em: null }, exito: { valor: Math.round(feeExito(valor)), pago: false, em: null } },
        checklist: Object.fromEntries(CHECK_POS.map(([k]) => [k, { done: false, em: null }])), saida: {}, custos_reais: num(analise(i).custo_total - valor - analise(i).fee), obs: '', criado_em: agora };
      fecharModal();
      await upsert('operacoes', o);
      await upsert('imoveis', { ...i, status: 'arrematado', investidor_id: invId });
      const inv = invPorId(invId); if (inv && !['arrematado', 'carteira'].includes(inv.coluna)) await upsert('investidores', { ...inv, coluna: 'arrematado', hist: [...(inv.hist || []), { em: agora, o: 'etapa:arrematado', por: autorNome() }] });
      await upsert('atividades', { id: uid('atv'), tipo: 'nota', investidor_id: invId, imovel_id: i.id, operacao_id: o.id, texto: `🏁 Arrematação confirmada por ${brl(valor)} — fee de êxito ${brl(o.honorarios.exito.valor)}`, quando: null, feito: true, feito_em: agora, autor: autorNome(), criado_em: agora });
      abrirOperacao(S.operacoes.find(x => x.id === o.id));
    };
  });
}
export function renderOperacoes() {
  const ops = S.operacoes.slice().sort((a, b) => (b.data_arrematacao || '').localeCompare(a.data_arrematacao || ''));
  const tot = k => ops.reduce((s, o) => s + ['analise', 'certame', 'exito'].reduce((t, p) => t + ((o.honorarios?.[p]?.pago ? 1 : 0) === (k === 'pago' ? 1 : 0) ? num(o.honorarios?.[p]?.valor) : 0), 0), 0);
  const comissao = ops.reduce((s, o) => s + num(o.saida?.comissao_valor), 0);
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div><h2 class="card-title" style="margin:0">🔁 Operações (giros)</h2><div class="card-sub" style="margin:0">Cada arrematação vira uma operação: honorários (3 parcelas + recibo), checklist pós-arrematação, mesa de ciclo (flip ou renda) e resultado do giro.</div></div>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="ma-nova-op">＋ Operação a partir de um imóvel</button>
      </div>
      <div class="ma-minis" style="margin:10px 0 0">
        ${mini('🔁 Em andamento', ops.filter(o => o.status !== 'concluida').length, `${ops.filter(o => o.status === 'concluida').length} concluídas`, COR.dourado)}
        ${mini('💰 Fee recebido (total)', brl(tot('pago')), '', '#16a34a')}
        ${mini('⏳ Fee a receber', brl(tot('pend')), '', '#ef4444')}
        ${mini('🏘 Comissão PSM nas saídas', brl(comissao), 'registrada nas operações concluídas', COR.verde)}
      </div>
    </div>
    <div class="ma-list">${ops.map(liOperacao).join('') || '<div class="card tiny muted">Nenhuma operação ainda. Marque um imóvel como arrematado (Imóveis → 🏁) pra abrir a primeira.</div>'}</div>`;
}
function liOperacao(o) {
  const inv = invPorId(o.investidor_id), imv = imvPorId(o.imovel_id);
  const pend = ['analise', 'certame', 'exito'].filter(k => !o.honorarios?.[k]?.pago && num(o.honorarios?.[k]?.valor)).reduce((s, k) => s + num(o.honorarios[k].valor), 0);
  const chk = CHECK_POS.filter(([k]) => o.checklist?.[k]?.done).length;
  const cor = o.status === 'concluida' ? '#16a34a' : o.status === 'destino' ? '#0ea5e9' : COR.dourado;
  return `<div class="ma-li" data-abrir-op="${esc(o.id)}">
    <div>
      <div class="flex items-center gap-2" style="flex-wrap:wrap"><b>${esc(imv?.titulo || '(imóvel excluído)')}</b><span class="ma-status" style="background:${cor}">${esc(OP_STATUS[o.status] || o.status)}</span><span class="ma-tag" style="background:#334155">${esc((DESTINO[o.destino] || '').replace(/^.. /, ''))}</span></div>
      <div class="tiny muted">💼 ${esc(inv?.nome || '(investidor excluído)')} · arrematado em ${dtBR(o.data_arrematacao)} por ${brl(o.valor)}</div>
      <div class="tiny" style="margin-top:3px">Fee êxito ${brl(o.honorarios?.exito?.valor)} ${o.honorarios?.exito?.pago ? '<span style="color:#16a34a">✓ pago</span>' : '<span style="color:#ef4444">pendente</span>'} · pós-arrematação ${chk}/${CHECK_POS.length}${o.saida?.valor_venda ? ` · vendido por ${brl(o.saida.valor_venda)}` : o.saida?.aluguel ? ` · alugado por ${brl(o.saida.aluguel)}/mês` : ''}</div>
    </div>
    <div class="tiny muted" style="text-align:right">${pend ? `a receber<br><b style="color:#ef4444">${brl(pend)}</b>` : '<span style="color:#16a34a">fees ok</span>'}</div>
  </div>`;
}
export function abrirOperacao(o) {
  if (!o) return;
  const inv = invPorId(o.investidor_id), imv = imvPorId(o.imovel_id);
  const f = cfg().fee;
  const h = o.honorarios || {};
  const parc = (k, lbl) => { const p = h[k] || {}; return `<div class="ma-li" style="cursor:default;grid-template-columns:1fr auto auto"><div><b>${lbl}</b><div class="tiny muted">${p.pago ? `✓ pago em ${dtBR(p.em)}` : 'pendente'}</div></div>
      <div class="flex gap-2" style="align-items:center"><input class="input" data-hv="${k}" type="number" value="${num(p.valor)}" style="width:110px">${p.pago ? `<button class="btn btn-ghost" data-hp="${k}" data-v="0" style="font-size:11px">desfazer</button>` : `<button class="btn btn-primary" data-hp="${k}" data-v="1" style="font-size:11px">💰 Marcar pago</button>`}<button class="btn btn-ghost" data-recibo="${k}" style="font-size:11px" title="gerar recibo">🧾</button></div></div>`; };
  const s = o.saida || {};
  const custoInv = num(o.valor) + num(o.custos_reais) + ['analise', 'certame', 'exito'].reduce((t, k) => t + num(h[k]?.valor), 0);
  const comissao = num(s.valor_venda) * num(s.comissao_pct ?? f.comissao_pct) / 100;
  const lucro = s.valor_venda ? num(s.valor_venda) - comissao - custoInv : 0;
  const html = `
    <div class="flex gap-2" style="flex-wrap:wrap">
      <button class="btn btn-ghost" data-abrir-inv="${esc(o.investidor_id)}">💼 ${esc(inv?.nome || 'investidor')}</button>
      <button class="btn btn-ghost" data-abrir-imv="${esc(o.imovel_id)}">🏠 ${esc(imv?.titulo || 'imóvel')}</button>
      <button class="btn btn-ghost" id="d-tarefa">📅 Agendar passo</button>
      <button class="btn btn-danger" id="d-del" style="margin-left:auto">🗑 Excluir</button>
    </div>
    <div class="ma-minis" style="margin-top:10px">${mini('Arrematação', brl(o.valor), dtBR(o.data_arrematacao))}${mini('Custo total do investidor', brl(custoInv), 'lance + custos + honorários', '#64748b')}${mini('Receita Morimatsu', brl(['analise', 'certame', 'exito'].reduce((t, k) => t + num(h[k]?.valor), 0)), `${brl(['analise', 'certame', 'exito'].reduce((t, k) => t + (h[k]?.pago ? num(h[k].valor) : 0), 0))} recebido`, COR.dourado)}${s.valor_venda ? mini('Resultado do giro', brl(lucro), `${custoInv ? Math.round(lucro / custoInv * 100) : 0}% · comissão PSM ${brl(comissao)}`, lucro > 0 ? '#16a34a' : '#ef4444') : ''}</div>

    <div class="ma-sec">💰 Honorários Morimatsu</div>
    <div class="ma-list">${parc('analise', 'Análise do imóvel')}${parc('certame', 'Participação no certame')}${parc('exito', `Honorários de êxito (${f.exito_pct}% · piso ${brl(f.piso)})`)}</div>

    <div class="ma-sec">✅ Pós-arrematação</div>
    <div class="ma-chk">${CHECK_POS.map(([k, l]) => `<label><input type="checkbox" data-chk="${k}" ${o.checklist?.[k]?.done ? 'checked' : ''}> <span>${l}${o.checklist?.[k]?.done ? `<span class="tiny muted"> · ${dtBR(o.checklist[k].em)}</span>` : ''}</span></label>`).join('')}</div>

    <div class="ma-sec">🔁 Mesa de ciclo — destino e saída</div>
    <form class="ma-form" id="f-saida" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      ${campo('Destino', select('destino', DESTINO, o.destino || 'indef'))}
      ${campo('Status da operação', select('status', OP_STATUS, o.status || 'pos'))}
      ${campo('Custos reais do investidor (R$)', input('custos_reais', o.custos_reais, 'number'))}
      ${campo('Valor de venda (R$)', input('valor_venda', s.valor_venda, 'number'))}
      ${campo('Data da venda', input('data_venda', s.data_venda, 'date'))}
      ${campo('Comissão PSM (%)', input('comissao_pct', s.comissao_pct ?? f.comissao_pct, 'number', 'step="0.5"'))}
      ${campo('Aluguel mensal (R$)', input('aluguel', s.aluguel, 'number'))}
      ${campo('Adm. locação (%/mês)', input('adm_pct', s.adm_pct ?? f.adm_pct, 'number', 'step="0.5"'))}
      ${campo('Observações', `<textarea class="input" name="obs" rows="2">${esc(o.obs || '')}</textarea>`, true)}
      <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar operação</button><button class="btn btn-ghost" type="button" id="f-cancel">Fechar</button></div>
    </form>
    <div class="ma-sec">🕒 Atividades</div>
    ${timelineHtml(S.atividades.filter(a => a.operacao_id === o.id), { operacao_id: o.id, investidor_id: o.investidor_id, imovel_id: o.imovel_id })}`;
  abrirModal(`🔁 Operação · <span style="font-family:Georgia,serif">${esc(imv?.titulo || '')}</span>`, html, box => {
    const refresh = () => abrirOperacao(S.operacoes.find(x => x.id === o.id));
    box.querySelector('[data-abrir-inv]').onclick = () => { const i = invPorId(o.investidor_id); if (i) abrirInvestidor(i, 'operacoes'); };
    box.querySelector('[data-abrir-imv]').onclick = () => { const i = imvPorId(o.imovel_id); if (i) abrirImovel(i); };
    box.querySelector('#d-tarefa').onclick = () => editarAtividade(null, { operacao_id: o.id, investidor_id: o.investidor_id, imovel_id: o.imovel_id, tipo: 'tarefa' }, refresh);
    box.querySelector('#d-del').onclick = async () => { if (!confirm('Excluir esta operação? O imóvel e o investidor permanecem.')) return; fecharModal(); await remover('operacoes', o.id); };
    box.querySelectorAll('[data-hp]').forEach(b => b.onclick = async () => {
      const k = b.dataset.hp, pago = b.dataset.v === '1';
      const hon = { ...(o.honorarios || {}) }; hon[k] = { ...(hon[k] || {}), valor: num(box.querySelector(`[data-hv="${k}"]`).value), pago, em: pago ? new Date().toISOString() : null };
      await upsert('operacoes', { ...o, honorarios: hon });
      if (pago) await upsert('atividades', { id: uid('atv'), tipo: 'nota', investidor_id: o.investidor_id, imovel_id: o.imovel_id, operacao_id: o.id, texto: `💰 Recebido ${brl(hon[k].valor)} — ${k}`, quando: null, feito: true, feito_em: new Date().toISOString(), autor: autorNome(), criado_em: new Date().toISOString() });
      refresh();
    });
    box.querySelectorAll('[data-recibo]').forEach(b => b.onclick = () => { const k = b.dataset.recibo; const hon = { ...(o.honorarios || {}) }; hon[k] = { ...(hon[k] || {}), valor: num(box.querySelector(`[data-hv="${k}"]`).value) }; gerarRecibo({ ...o, honorarios: hon }, k); });
    box.querySelectorAll('[data-chk]').forEach(cb => cb.onchange = async () => { const chk = { ...(o.checklist || {}) }; chk[cb.dataset.chk] = { done: cb.checked, em: cb.checked ? new Date().toISOString() : null }; await upsert('operacoes', { ...o, checklist: chk }); refresh(); });
    box.querySelector('#f-cancel').onclick = fecharModal;
    box.querySelector('#f-saida').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const saida = { valor_venda: num(fd.get('valor_venda')), data_venda: fd.get('data_venda') || null, comissao_pct: num(fd.get('comissao_pct')), aluguel: num(fd.get('aluguel')), adm_pct: num(fd.get('adm_pct')) };
      saida.comissao_valor = saida.valor_venda * saida.comissao_pct / 100;
      const it = { ...o, destino: fd.get('destino') || 'indef', status: fd.get('status') || 'pos', custos_reais: num(fd.get('custos_reais')), saida, obs: String(fd.get('obs') || '').trim() };
      fecharModal(); await upsert('operacoes', it);
      if (it.status === 'concluida') { const inv = invPorId(o.investidor_id); if (inv && inv.coluna !== 'carteira') await upsert('investidores', { ...inv, coluna: 'carteira', hist: [...(inv.hist || []), { em: new Date().toISOString(), o: 'etapa:carteira', por: autorNome() }] }); }
    };
    wireTimeline(box, refresh);
  }, 900);
}

/* ═══════════════════════════ 📅 AGENDA (nutrição) ═══════════════════════════ */
export function renderAgenda() {
  const hoje = hojeISO(), sem = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const atv = S.atividades.slice().sort((a, b) => (a.quando || '9').localeCompare(b.quando || '9'));
  const abertas = atv.filter(a => !a.feito && a.quando);
  const grupos = [
    ['⏰ Atrasadas', abertas.filter(a => a.quando.slice(0, 10) < hoje), '#ef4444'],
    ['📌 Hoje', abertas.filter(a => a.quando.slice(0, 10) === hoje), '#0ea5e9'],
    ['📅 Próximos 7 dias', abertas.filter(a => a.quando.slice(0, 10) > hoje && a.quando.slice(0, 10) <= sem), COR.verde],
    ['🗓 Depois', abertas.filter(a => a.quando.slice(0, 10) > sem), '#64748b'],
  ];
  const semData = atv.filter(a => !a.feito && !a.quando);
  const feitas = atv.filter(a => a.feito).sort((a, b) => (b.feito_em || '').localeCompare(a.feito_em || '')).slice(0, 40);
  const semPasso = S.investidores.filter(c => c.coluna !== 'fora' && !abertas.some(a => a.investidor_id === c.id));
  const li = a => { const inv = invPorId(a.investidor_id), imv = imvPorId(a.imovel_id); return `<div class="ma-tl ${a.feito ? 'feito' : ''} ${!a.feito && a.quando && a.quando.slice(0, 10) < hoje ? 'atrasada' : ''}">
    <span class="ma-tl-ico">${(TIPO_ATV[a.tipo] || '📝').slice(0, 2)}</span>
    <div style="flex:1"><div>${esc(a.texto)}</div><div class="tiny muted">${a.quando ? '📅 ' + dtBR(a.quando) + (a.quando.length > 10 ? ' ' + a.quando.slice(11, 16) : '') + ' · ' : ''}${inv ? `<a href="#" data-abrir-inv="${esc(inv.id)}">💼 ${esc(inv.nome)}</a>` : ''}${imv ? ` · <a href="#" data-abrir-imv="${esc(imv.id)}">🏠 ${esc(imv.titulo)}</a>` : ''} · ${esc(a.autor || '')}${a.feito ? ' · ✓ ' + dtBR(a.feito_em) : ''}</div></div>
    <div class="flex gap-2">${inv?.fone && !a.feito ? `<a class="btn btn-ghost" href="${waLink(inv.fone)}" target="_blank" rel="noopener" style="font-size:11px;padding:2px 6px">💬</a>` : ''}${a.feito ? '' : `<button class="btn btn-ghost t-done" data-id="${esc(a.id)}" style="font-size:11px;padding:2px 6px" title="concluir">✓</button><button class="btn btn-ghost t-adiar" data-id="${esc(a.id)}" style="font-size:11px;padding:2px 6px" title="adiar">+1d</button>`}<button class="btn btn-ghost t-edit" data-id="${esc(a.id)}" style="font-size:11px;padding:2px 6px">✏️</button><button class="btn btn-ghost t-del" data-id="${esc(a.id)}" style="font-size:11px;padding:2px 6px">🗑</button></div>
  </div>`; };
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div><h2 class="card-title" style="margin:0">📅 Agenda de nutrição</h2><div class="card-sub" style="margin:0">Tudo que tem data: próximos contatos, tarefas de análise, prazos de certame, pós-arrematação. Nenhum investidor fica sem próximo passo.</div></div>
        <span style="flex:1"></span>
        <div class="flex gap-2">${[['abertas', 'Abertas'], ['feitas', 'Concluídas']].map(([id, l]) => `<button class="btn ${_fAg === id ? 'btn-primary' : 'btn-ghost'} f-ag" data-f="${id}" style="font-size:11.5px;padding:4px 9px">${l}</button>`).join('')}</div>
        <button class="btn btn-primary" id="ma-nova-atv">＋ Tarefa / contato</button>
      </div>
      <div class="ma-minis" style="margin:10px 0 0">${grupos.map(([l, g, cor]) => mini(l, g.length, '', cor)).join('')}${mini('👤 Sem próximo passo', semPasso.length, semPasso.slice(0, 3).map(c => esc(c.nome)).join(', '), semPasso.length ? '#d97706' : '#16a34a')}</div>
    </div>
    ${_fAg === 'abertas' ? `
      ${grupos.map(([l, g]) => g.length ? `<div class="card"><h2 class="card-title">${l} <span class="muted">${g.length}</span></h2><div class="ma-timeline" style="max-height:none">${g.map(li).join('')}</div></div>` : '').join('')}
      ${semData.length ? `<div class="card"><h2 class="card-title">📝 Sem data</h2><div class="ma-timeline" style="max-height:none">${semData.map(li).join('')}</div></div>` : ''}
      ${!abertas.length && !semData.length ? '<div class="card tiny muted">Nada pendente. Agende o próximo contato de cada investidor pela ficha dele.</div>' : ''}
      ${semPasso.length ? `<div class="card"><h2 class="card-title">👤 Investidores sem próximo passo</h2><div class="ma-list">${semPasso.map(c => `<div class="ma-li" data-abrir-inv="${esc(c.id)}"><div><b>${esc(c.nome)}</b> <span class="tiny muted">${esc(COLUNAS.find(k => k.id === (c.coluna || 'pre'))?.nome || '')} · score ${scoreDe(c)}</span></div><button class="btn btn-ghost t-novo-inv" data-id="${esc(c.id)}" style="font-size:11px">📅 agendar</button></div>`).join('')}</div></div>` : ''}`
    : `<div class="card"><h2 class="card-title">✓ Concluídas recentes</h2><div class="ma-timeline" style="max-height:none">${feitas.map(li).join('') || '<div class="tiny muted">Nada concluído ainda.</div>'}</div></div>`}`;
}
export function editarAtividade(a, defaults, depois) {
  const novo = !a; a = a || { id: null, tipo: 'tarefa', quando: hojeISO(), ...(defaults || {}) };
  const invs = Object.fromEntries(S.investidores.map(c => [c.id, c.nome]));
  const imvs = Object.fromEntries(S.imoveis.map(i => [i.id, i.titulo]));
  abrirModal(novo ? '＋ Tarefa / contato' : '✏️ Editar registro', `<form class="ma-form" id="f-atv">
    ${campo('O que fazer / o que aconteceu *', `<textarea class="input" name="texto" rows="2" required>${esc(a.texto || '')}</textarea>`, true)}
    ${campo('Tipo', select('tipo', TIPO_ATV, a.tipo))}
    ${campo('Quando (vazio = já feito, só registro)', input('quando', (a.quando || '').slice(0, 10), 'date'))}
    ${campo('Hora (opcional)', input('hora', (a.quando || '').length > 10 ? a.quando.slice(11, 16) : '', 'time'))}
    ${campo('Investidor', select('investidor_id', invs, a.investidor_id))}
    ${campo('Imóvel', select('imovel_id', imvs, a.imovel_id))}
    <div class="flex gap-2" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">💾 Salvar</button><button class="btn btn-ghost" type="button" id="f-cancel">Cancelar</button></div></form>`, box => {
    box.querySelector('#f-cancel').onclick = () => { fecharModal(); if (depois) depois(); };
    box.querySelector('#f-atv').onsubmit = async ev => {
      ev.preventDefault(); const fd = new FormData(ev.target);
      const d = fd.get('quando'), h = fd.get('hora');
      const it = { ...a, texto: String(fd.get('texto') || '').trim(), tipo: fd.get('tipo') || 'tarefa', quando: d ? (h ? `${d}T${h}` : d) : null, investidor_id: fd.get('investidor_id') || a.investidor_id || null, imovel_id: fd.get('imovel_id') || a.imovel_id || null };
      if (!it.texto) return;
      if (!it.id) { it.id = uid('atv'); it.autor = autorNome(); it.criado_em = new Date().toISOString(); it.feito = !it.quando; it.feito_em = it.quando ? null : it.criado_em; }
      fecharModal(); await upsert('atividades', it); if (depois) depois();
    };
  });
}

/* ═══════════════════════════ wire das abas operacionais ═══════════════════════════ */
export function wireOps(root, tab) {
  const $ = s => root.querySelector(s);
  const busca = $('#ma-busca');
  if (busca) busca.oninput = e => { _busca = e.target.value; render(); const el = root.querySelector('#ma-busca'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
  root.querySelectorAll('[data-abrir-inv]').forEach(b => b.onclick = e => { e.preventDefault(); const i = invPorId(b.dataset.abrirInv); if (i) abrirInvestidor(i); });
  root.querySelectorAll('[data-abrir-imv]').forEach(b => b.onclick = e => { e.preventDefault(); const i = imvPorId(b.dataset.abrirImv); if (i) abrirImovel(i); });
  root.querySelectorAll('[data-abrir-op]').forEach(b => b.onclick = () => { const o = S.operacoes.find(x => x.id === b.dataset.abrirOp); if (o) abrirOperacao(o); });
  if (tab === 'investidores') {
    $('#ma-novo-inv').onclick = () => abrirInvestidor(null);
    ativarDrag({
      host: $('#ma-kanban'), card: '.ma-card', coluna: '.ma-col', colDe: col => col.dataset.col,
      aoClicar: id => { const c = invPorId(id); if (c) abrirInvestidor(c); },
      aoSoltar: async (id, destino) => {
        const c = invPorId(id); if (!c || c.coluna === destino) return;
        await upsert('investidores', { ...c, coluna: destino, hist: [...(c.hist || []), { em: new Date().toISOString(), o: 'etapa:' + destino, por: autorNome() }] });
      },
    });
    const abrir = ctxQuery().abrir; if (abrir && invPorId(abrir)) { history.replaceState(null, '', '#/morimatsu-investidores'); abrirInvestidor(invPorId(abrir)); }
  }
  if (tab === 'imoveis') {
    $('#ma-novo-imv').onclick = () => abrirImovel(null);
    root.querySelectorAll('.f-imv').forEach(b => b.onclick = () => { _fImv = b.dataset.f; render(); });
  }
  if (tab === 'operacoes') {
    $('#ma-nova-op').onclick = () => {
      const cand = S.imoveis.filter(i => !['arrematado', 'descartado', 'perdido'].includes(i.status));
      if (!cand.length) return alert('Cadastre e analise um imóvel primeiro (aba Imóveis).');
      abrirModal('🏁 Qual imóvel foi arrematado?', `<div class="ma-list">${cand.map(i => `<div class="ma-li" data-pick="${esc(i.id)}"><div><b>${esc(i.titulo)}</b><div class="tiny muted">${esc(i.cidade || '')} · ${brl(i.lance_min)}${invPorId(i.investidor_id) ? ' · 💼 ' + esc(invPorId(i.investidor_id).nome) : ''}</div></div><span>→</span></div>`).join('')}</div>`, box => box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => criarOperacao(imvPorId(b.dataset.pick))));
    };
  }
  if (tab === 'agenda') {
    $('#ma-nova-atv').onclick = () => editarAtividade(null, {}, null);
    root.querySelectorAll('.f-ag').forEach(b => b.onclick = () => { _fAg = b.dataset.f; render(); });
    root.querySelectorAll('.t-done').forEach(b => b.onclick = async () => { const a = S.atividades.find(x => x.id === b.dataset.id); if (a) await upsert('atividades', { ...a, feito: true, feito_em: new Date().toISOString() }); });
    root.querySelectorAll('.t-adiar').forEach(b => b.onclick = async () => { const a = S.atividades.find(x => x.id === b.dataset.id); if (!a) return; const base = new Date((a.quando || hojeISO()).slice(0, 10) < hojeISO() ? hojeISO() + 'T12:00:00' : a.quando.slice(0, 10) + 'T12:00:00'); base.setDate(base.getDate() + 1); await upsert('atividades', { ...a, quando: base.toISOString().slice(0, 10) + (a.quando && a.quando.length > 10 ? a.quando.slice(10) : '') }); });
    root.querySelectorAll('.t-edit').forEach(b => b.onclick = () => editarAtividade(S.atividades.find(x => x.id === b.dataset.id), null, null));
    root.querySelectorAll('.t-del').forEach(b => b.onclick = async () => { if (!confirm('Excluir este registro?')) return; await remover('atividades', b.dataset.id); });
    root.querySelectorAll('.t-novo-inv').forEach(b => b.onclick = e => { e.stopPropagation(); editarAtividade(null, { investidor_id: b.dataset.id, tipo: 'contato' }, null); });
  }
}

/* ═══════════ 📜 CONTRATO e 🧾 RECIBO — agora saem das MINUTAS do banco (v87.56) ═══════════
   O texto vive na aba 📜 Minutas (editável pelo sócio); aqui só abrimos o gerador
   já apontando pro investidor / operação certos. Word (.docx) e PDF saem de lá. */
export function gerarContrato(inv) {
  const m = minutaPorSlug('assessoria_aquisicao') || minutas()[0];
  if (!m) return alert('Nenhuma minuta cadastrada.');
  gerarMinuta(m, { inv: inv?.id });
}
export function gerarRecibo(o, parcela) {
  const m = minutaPorSlug('recibo');
  if (!m) return alert('Minuta de recibo não encontrada.');
  gerarMinuta(m, { inv: o?.investidor_id, imv: o?.imovel_id, op: o?.id, parcela: parcela || 'exito', valor: num(o?.honorarios?.[parcela || 'exito']?.valor) || '' });
}
