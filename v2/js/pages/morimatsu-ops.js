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
  const _v = veredito(i, {}); const V = _v.status === 'sem_dados' ? null : _v;
  const inv = invPorId(i.investidor_id);
  const hoje = hojeISO();
  return `<div class="ma-li" data-abrir-imv="${esc(i.id)}">
    <div>
      <div class="flex items-center gap-2" style="flex-wrap:wrap"><b>${esc(i.titulo)}</b><span class="ma-status" style="background:${st.cor}">${st.emoji} ${esc(st.nome)}</span>${i.data_certame ? `<span class="ma-tag" style="background:${i.data_certame < hoje ? '#64748b' : '#ef4444'}">🔨 ${dtBR(i.data_certame)}</span>` : ''}${i.ocupado ? '<span class="ma-tag" style="background:#d97706">ocupado</span>' : ''}${i.aceita_fin ? '<span class="ma-tag" style="background:#0ea5e9">financiável · Porta 2</span>' : ''}${i.analise?.risco ? `<span class="ma-tag" style="background:#334155">${RISCO[i.analise.risco]}</span>` : ''}${V ? `<span class="ma-tag" style="background:${V.cor}">${V.rotulo}</span>` : ''}</div>
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
  fee_tabela: [{ ate: 450000, pct: 6 }, { ate: null, pct: 5 }],   // comissão da assessoria por faixa de arremate
  ir_pf: 15, carga_pj: 5.93,
  iptu_ano: 2400, cond_mes: 600, util_mes: 150, seguro_ano: 800, manut_mes: 200,
};
export const viab = () => ({ ...VIAB_DEFAULT, ...(S.config?.viab || {}) });
export const posseMes = () => { const v = viab(); return v.iptu_ano / 12 + v.cond_mes + v.util_mes + v.seguro_ano / 12 + v.manut_mes; };
export const tmaMes = () => Math.pow(1 + viab().tma_aa / 100, 1 / 12) - 1;
const ehLeilao = i => ['extra', 'judicial'].includes(i.modalidade);
const canalPct = i => { const v = viab(); return i.modalidade === 'direta' ? v.banco / 100 : i.modalidade === 'online' ? v.plataforma / 100 : 0; };

/* Parâmetros do imóvel, com os padrões de quem ainda não preencheu */
/* Tabela de comissão da assessoria por FAIXA de arremate (v87.67).
   Regra do Paulo: até R$ 450.000 → 6% do valor de arremate. Acima disso a faixa
   é editável nas Premissas (padrão 5%, a tabela v1). O piso protege ticket baixo. */
export const FEE_TABELA_DEFAULT = [{ ate: 450000, pct: 6 }, { ate: null, pct: 5 }];
export const tabelaFee = () => {
  const t = viab().fee_tabela;
  return (Array.isArray(t) && t.length) ? t : FEE_TABELA_DEFAULT;
};
export function feeAssessoria(L) {
  L = num(L);
  if (L <= 0) return 0;
  const f = cfg().fee, t = tabelaFee();
  const faixa = t.find(x => !num(x.ate) || L <= num(x.ate)) || t[t.length - 1];
  return Math.max(L * num(faixa.pct) / 100, num(f.piso));
}
export const faixaFee = L => {
  const t = tabelaFee();
  return t.find(x => !num(x.ate) || num(L) <= num(x.ate)) || t[t.length - 1];
};

/* Rótulos didáticos — a tela, o parecer e a cascata falam a mesma língua */
export const CUSTO_LABEL = {
  lance: 'Arrematação (lance)',
  leiloeiro: 'Comissão do leiloeiro',
  canal: 'Taxa do banco ou da plataforma',
  itbi: 'ITBI',
  registro: 'Registro e emolumentos',
  escritura: 'Documentação e escritura',
  fee: 'Comissão da assessoria',
  dd: 'Due diligence (custas processuais e taxas)',
  advogado: 'Advogado e custas da imissão',
  ocupacao: 'Taxa de ocupação do credor',
  debitos_iptu: 'Débitos de IPTU',
  debitos_cond: 'Débitos de condomínio',
  reforma: 'Reforma',
  mobilia: 'Mobília',
  posse: 'Custos correntes de posse no período',
};

function par(i, o) {
  const v = viab(), A = { ...(i.analise || {}) };
  const aval = num(i.avaliacao) || num(i.lance_min) || 0;
  const desoc = (o.desocupado != null) ? o.desocupado : !i.ocupado;
  const m_oc = desoc ? 0 : (A.m_ocup != null ? num(A.m_ocup) : 3);
  const merc = num(A.mercado) || aval;
  // débitos: split IPTU × condomínio (v87.67). O campo antigo `debitos` vira condomínio.
  const dIptu = A.debitos_iptu != null ? num(A.debitos_iptu) : 0;
  const dCond = A.debitos_cond != null ? num(A.debitos_cond) : (num(A.debitos) || num(i.debitos_cond) || 0);
  return {
    v, A, aval, desoc, m_oc, merc,
    venal: num(A.venal) || aval,
    L: num(o.lance != null ? o.lance : (A.lance_base || i.lance_min)),
    m_doc: A.m_docs != null ? num(A.m_docs) : 1,
    m_ref: A.m_reforma != null ? num(A.m_reforma) : 2,
    m_ven: A.m_venda != null ? num(A.m_venda) : 3,
    reforma: (num(A.reforma) || 0) * (o.multRef || 1),
    mobilia: num(A.mobilia) || 0,
    dd: A.dd != null ? num(A.dd) : 1500,
    advogado: desoc ? 0 : (A.advogado != null ? num(A.advogado) : 8000),
    dIptu, dCond,
    // valor de venda esperado: valor direto vence o "% do mercado"
    vendaBase: num(A.venda_esperada) || merc * ((o.fator != null ? o.fator : (num(A.fator_venda) || v.fator_venda)) / 100),
    multVenda: o.multVenda != null ? o.multVenda : 1,
    // overrides em R$ (o usuário digitou o valor exato do carnê/guia)
    itbiValor: num(A.itbi_valor) || 0,
    escrituraValor: num(A.escritura_valor) || 0,
    // comissão de revenda: pode ser 0 (venda sem corretor)
    comRevenda: A.comissao_revenda != null ? num(A.comissao_revenda) : num(cfg().fee.comissao_pct),
  };
}

export function motor(i, o) {
  o = o || {};
  const P = par(i, o), v = P.v, f = cfg().fee;
  const L = P.L;
  const prazo = Math.max(1, P.m_oc + P.m_doc + P.m_ref + P.m_ven + (o.extra || 0));
  const feeEntra = v.fee_no_custo !== false;
  const c = {
    lance: L,
    leiloeiro: ehLeilao(i) ? L * v.leiloeiro / 100 : 0,
    canal: L * canalPct(i),
    itbi: P.itbiValor || Math.max(P.venal, L) * v.itbi / 100,
    registro: L * v.registro / 100,
    escritura: P.escrituraValor || (ehLeilao(i) ? 0 : L * v.escritura / 100),
    fee: (feeEntra && L > 0) ? feeAssessoria(L) + num(f.analise) + num(f.certame) : 0,
    dd: P.dd,
    advogado: P.advogado,
    ocupacao: P.desoc ? 0 : P.aval * v.taxa_ocup_mes / 100 * P.m_oc,
    debitos_iptu: P.dIptu,
    debitos_cond: P.dCond,
    reforma: P.reforma,
    mobilia: P.mobilia,
    posse: posseMes() * prazo,
  };
  const inv = Object.values(c).reduce((s, x) => s + x, 0);
  const venda = P.vendaBase * P.multVenda;
  const corret = venda * P.comRevenda / 100;
  // custo de aquisição para o IR: lance + transmissão + benfeitorias comprovadas
  const cf = c.lance + c.leiloeiro + c.itbi + c.registro + c.escritura + c.reforma + c.mobilia;
  const ganho = Math.max(0, venda - cf);
  const imposto = v.regime === 'PJ' ? venda * v.carga_pj / 100 : ganho * v.ir_pf / 100;
  const lucro = venda - corret - imposto - inv;
  const agio = inv ? lucro / inv : 0;            // ágio total sobre o capital investido
  const agioMes = prazo ? agio / prazo : 0;      // ágio dividido pelos meses até a venda
  const tir = agio <= -1 ? -1 : Math.pow(1 + agio, 1 / prazo) - 1;
  const tm = tmaMes();
  const feeGrupo = L > 0 ? feeAssessoria(L) + num(f.analise) + num(f.certame) : 0;
  return {
    L, lance_base: L, prazo, custos: c, inv, custo_total: inv, venda, corret, cf, ganho, imposto,
    lucro, roi: agio, agio, agioMes, tir, tma_m: tm, fee: c.fee, feeGrupo, receitaGrupo: feeGrupo + corret,
    meses: { ocupacao: P.m_oc, documentacao: P.m_doc, reforma: P.m_ref, venda: P.m_ven },
    vpl: -inv + (venda - corret - imposto) / Math.pow(1 + tm, prazo),
    breakeven: inv / (1 - P.comRevenda / 100),
    desconto: P.merc && L ? Math.round((1 - L / P.merc) * 100) : 0,
    desconto_aval: P.aval && L ? Math.round((1 - L / P.aval) * 100) : 0,
    viavel: lucro > 0 && tir >= tm, desoc: P.desoc, merc: P.merc, aval: P.aval,
    faixaFee: faixaFee(L), comRevenda: P.comRevenda,
  };
}

/* Lance máximo: dada a saída esperada e o ágio exigido, quanto dá para cobrir.
   A comissão da assessoria é POR FAIXA, então a equação é resolvida faixa a faixa
   (mais o caso do piso) e fica o maior lance que cai dentro da própria faixa. */
export function lanceMax(i, o, margemPct) {
  o = o || {};
  const P = par(i, o), v = P.v, f = cfg().fee;
  // v87.68: ágio 0 é uma pergunta legítima ("onde empata?") e precisa ser obedecido.
  // O `||` antigo trocava 0 por 20 em silêncio: a tela dizia 0 e o teto saía com 20%.
  const mDigitado = P.A.margem_pct;
  const m = (margemPct != null ? margemPct
    : (mDigitado != null && mDigitado !== '' && isFinite(num(mDigitado)) ? num(mDigitado) : v.margem_alvo)) / 100;
  const prazo = Math.max(1, P.m_oc + P.m_doc + P.m_ref + P.m_ven + (o.extra || 0));
  const feeEntra = v.fee_no_custo !== false;
  const V = P.vendaBase * P.multVenda, cor = P.comRevenda / 100;
  const ITBI = P.itbiValor || P.venal * v.itbi / 100;   // fixo: assume venal ≥ lance
  const B = P.reforma + P.mobilia;
  const F = P.dd + P.advogado + (P.desoc ? 0 : P.aval * v.taxa_ocup_mes / 100 * P.m_oc)
    + P.dIptu + P.dCond + B + posseMes() * prazo + (feeEntra ? num(f.analise) + num(f.certame) : 0)
    + (P.escrituraValor || 0);
  // parcelas proporcionais ao lance
  const kFiscal = 1 + (ehLeilao(i) ? v.leiloeiro / 100 : 0) + v.registro / 100
    + (P.escrituraValor ? 0 : (ehLeilao(i) ? 0 : v.escritura / 100));
  const canal = canalPct(i);
  const pj = v.regime === 'PJ';
  const tau = pj ? 0 : v.ir_pf / 100;
  const solve = (K, Ff) => pj
    ? (V * (1 - cor - v.carga_pj / 100) / (1 + m) - ITBI - Ff) / K
    : (V * (1 - cor - tau) + tau * (ITBI + B) - (1 + m) * (ITBI + Ff)) / ((1 + m) * K - tau * kFiscal);

  const cand = [];
  if (feeEntra) {
    for (const faixa of tabelaFee()) {
      const L = solve(kFiscal + canal + num(faixa.pct) / 100, F);
      const teto = num(faixa.ate) || Infinity;
      // vale se cai dentro da faixa E o percentual supera o piso
      if (L > 0 && L <= teto && L * num(faixa.pct) / 100 >= num(f.piso)) cand.push(L);
    }
    const Lpiso = solve(kFiscal + canal, F + num(f.piso));   // piso mandando
    if (Lpiso > 0 && feeAssessoria(Lpiso) <= num(f.piso) + 0.01) cand.push(Lpiso);
  } else {
    const L = solve(kFiscal + canal, F);
    if (L > 0) cand.push(L);
  }
  if (!cand.length) return 0;
  return Math.max(0, Math.floor(Math.max(...cand) / 500) * 500);
}

/* ═══════════ ⚖️ VEREDITO — viável · condicionado · reprovado ═══════════
   Um imóvel raramente é um sim ou um não seco. Na mesa, a pergunta é
   "fecha em alguma hipótese?". Então o motor devolve três estados:
     VIÁVEL       — fecha no lance analisado, do jeito que o imóvel está
     CONDICIONADO — não fecha assim, mas existe condição concreta que destrava
                    (comprar por até X, desocupado, sem os débitos, reforma menor…)
     REPROVADO    — não existe lance possível: o teto fica abaixo do lance mínimo
                    do edital, ou não sobra nada nem no melhor arranjo
   Cada condição é testada mexendo em UMA alavanca de cada vez e rodando o motor. */
export function veredito(i, o) {
  o = o || {};
  const base = motor(i, o);
  const lm = lanceMax(i, o);
  const minEdital = num(i.lance_min) || 0;
  if (!base.L || !base.merc) return { status: 'sem_dados', rotulo: 'SEM DADOS', cor: '#64748b', lm, base, cond: [], motivo: 'informe ao menos o valor de mercado e o lance para o motor rodar' };
  if (base.viavel) return { status: 'viavel', rotulo: 'VIÁVEL', cor: '#16a34a', lm, base, cond: [], motivo: '' };

  const cond = [];
  const alt = mod => motor({ ...i, analise: { ...(i.analise || {}), ...(mod.analise || {}) } }, { ...o, ...(mod.opts || {}) });
  const A = { ...(i.analise || {}) };

  // 1) preço: existe lance que fecha?
  const precoPossivel = lm > 0 && (!minEdital || lm >= minEdital);   // abaixo do mínimo do edital não há lance a dar
  if (precoPossivel && lm < base.L) cond.push(`comprar por até ${brl(lm)} — você analisou ${brl(base.L)}`);

  // 2) ocupação
  if (i.ocupado && alt({ opts: { desocupado: true } }).viavel) cond.push('comprar desocupado, ou fechar a desocupação antes do lance');

  // 3) débitos do edital
  const deb = num(A.debitos) || num(i.debitos_cond) || 0;
  if (deb > 0 && alt({ analise: { debitos: 0 } }).viavel) cond.push(`os ${brl(deb)} de débitos ficarem por conta do credor — conferir na ficha da unidade`);

  // 4) reforma
  const ref = num(A.reforma) || 0;
  if (ref > 0 && alt({ analise: { reforma: ref / 2 } }).viavel) cond.push(`reforma sair por até ${brl(ref / 2)} — orçar antes de cobrir o lance`);

  // 5) velocidade de venda
  const mv = A.m_venda != null ? num(A.m_venda) : 3;
  if (mv > 1 && alt({ analise: { m_venda: 1 } }).viavel) cond.push('vender em até 1 mês após a reforma — só com preço de liquidez');

  if (cond.length && precoPossivel) return { status: 'condicionado', rotulo: 'CONDICIONADO', cor: '#d97706', lm, base, cond, motivo: '' };
  if (cond.length) return { status: 'condicionado', rotulo: 'CONDICIONADO', cor: '#d97706', lm, base,
    cond: cond.concat([`atenção: mesmo assim o teto (${brl(lm)}) fica abaixo do lance mínimo do edital (${brl(minEdital)})`]), motivo: '' };
  const motivo = (minEdital && lm < minEdital)
    ? `o lance máximo (${brl(lm)}) fica abaixo do lance mínimo do edital (${brl(minEdital)}) — não há preço que feche`
    : 'nem mexendo em preço, ocupação, débitos, reforma ou prazo a operação entrega o retorno exigido';
  return { status: 'reprovado', rotulo: 'REPROVADO', cor: '#ef4444', lm, base, cond: [], motivo };
}

/* Compat: liImovel e criarOperacao continuam chamando analise(i) */
export function analise(i) {
  const r = motor(i, {});
  r.lance_max = lanceMax(i, {});
  return r;
}

const CENARIOS = [
  { id: 'pes', nome: 'Pessimista', multVenda: 0.93, multRef: 1.3, extra: 3, cor: '#ef4444',
    ajuda: 'vende 7% abaixo do esperado · reforma 30% maior · 3 meses a mais' },
  { id: 'base', nome: 'Realista', multVenda: 1, multRef: 1, extra: 0, cor: '#9C7A3C',   // literal: import circular proíbe COR no top-level
    ajuda: 'exatamente os números que você digitou' },
  { id: 'oti', nome: 'Otimista', multVenda: 1.03, multRef: 0.85, extra: -1, cor: '#16a34a',
    ajuda: 'vende 3% acima · reforma 15% menor · 1 mês a menos' },
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
  const cen = CENARIOS.map(c => ({ ...c, r: motor(i, { multVenda: c.multVenda, multRef: c.multRef, extra: c.extra }) }));
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
    ${campo('Meses de desembaraço da documentação', input('m_docs', A.m_docs != null ? A.m_docs : 1, 'number'))}
    ${campo('Meses de reforma', input('m_reforma', A.m_reforma != null ? A.m_reforma : 2, 'number'))}
    ${campo('Meses de comercialização', input('m_venda', A.m_venda != null ? A.m_venda : 3, 'number'))}
    ${campo('Reforma (R$)', input('reforma', A.reforma, 'number'))}
    ${campo('Mobília (R$)', input('mobilia', A.mobilia, 'number'))}
    ${campo('Due diligence (R$)', input('dd', A.dd != null ? A.dd : 1500, 'number'))}
    ${campo('Advogado + imissão (R$)', input('advogado', A.advogado != null ? A.advogado : 8000, 'number'))}
    ${campo('Débitos de IPTU (R$)', input('debitos_iptu', A.debitos_iptu, 'number'))}
    ${campo('Débitos de condomínio (R$)', input('debitos_cond', A.debitos_cond != null ? A.debitos_cond : (A.debitos || i.debitos_cond), 'number'))}
    ${campo('ITBI (R$) — zero calcula', input('itbi_valor', A.itbi_valor, 'number'))}
    ${campo('Documentação/escritura (R$) — zero calcula', input('escritura_valor', A.escritura_valor, 'number'))}
    ${campo('Valor de venda esperado (R$) — zero usa o %', input('venda_esperada', A.venda_esperada, 'number'))}
    ${campo('Comissão de revenda (%)', input('comissao_revenda', A.comissao_revenda != null ? A.comissao_revenda : cfg().fee.comissao_pct, 'number', 'step="0.5"'))}
    ${campo('Preço de saída (% do mercado)', input('fator_venda', fatorBase, 'number', 'step="0.5"'))}
    ${campo('Ágio alvo (%)', input('margem_pct', A.margem_pct != null && A.margem_pct !== '' ? A.margem_pct : v.margem_alvo, 'number', 'min="0"'))}
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
  const V = veredito(i, {});
  return `
    <div class="ma-veredito" style="border-color:${V.cor}">
      <div class="ma-ver-selo" style="background:${V.cor}">${V.rotulo}</div>
      <div style="flex:1;min-width:220px">
        ${V.status === 'sem_dados'
          ? `<div>${esc(V.motivo)}.</div>`
          : V.status === 'viavel'
          ? `<div>Fecha no lance de <b>${brl(V.base.L)}</b>: lucro de <b>${brl(V.base.lucro)}</b> em ${V.base.prazo} meses, ${(V.base.roi * 100).toFixed(1).replace('.', ',')}% sobre o investimento. Teto: ${brl(V.lm)}.</div>`
          : V.status === 'condicionado'
            ? `<div>Não fecha do jeito que está, mas fecha <b>se</b>:</div><ul class="ma-cond">${V.cond.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`
            : `<div>Não fecha em nenhuma hipótese testada — ${esc(V.motivo)}.</div>`}
      </div>
    </div>
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
      ${linha('Ágio total', r => r.agio, pct)}
      ${linha('Ágio ao mês', r => r.agioMes, x => (x * 100).toFixed(2).replace('.', ',') + '%')}
      ${linha('TIR ao mês', r => r.tir, x => (x * 100).toFixed(2).replace('.', ',') + '%')}
      ${linha('VPL pela TMA', r => r.vpl, brl)}
      <tr><td><b>Fecha neste cenário?</b></td>${cen.map(c => `<td style="text-align:right"><span class="ma-status" style="background:${c.r.viavel ? '#16a34a' : '#94a3b8'}">${c.r.viavel ? 'SIM' : 'NÃO'}</span></td>`).join('')}</tr>
    </table></div>
    <div class="tiny muted">TMA exigida: ${(tmaMes() * 100).toFixed(2).replace('.', ',')}% ao mês (${v.tma_aa}% ao ano). Passa quem tiver lucro positivo <i>e</i> TIR acima da TMA.</div>

    <div class="ma-minis" style="margin-top:12px">
      ${(() => { const mp = i.analise?.margem_pct; const usado = (mp != null && mp !== '' && isFinite(num(mp))) ? num(mp) : v.margem_alvo;
        return mini('🎯 LANCE MÁXIMO', brl(lm), usado === 0
          ? 'ágio 0 — este é o lance que EMPATA, não o que dá lucro'
          : `para ${String(usado).replace('.', ',')}% de ágio · deságio ${base.aval ? Math.round((1 - lm / base.aval) * 100) : 0}% sobre a avaliação`, COR.dourado); })()}
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
    ['mercado', 'venal', 'lance_base', 'm_ocup', 'm_docs', 'm_reforma', 'm_venda', 'reforma', 'mobilia', 'dd', 'advogado',
     'debitos_iptu', 'debitos_cond', 'itbi_valor', 'escritura_valor', 'venda_esperada', 'comissao_revenda', 'fator_venda', 'margem_pct']
      .forEach(k => { if (fd.get(k) !== null) a[k] = num(fd.get(k)); });
    a.risco = fd.get('risco'); a.parecer = String(fd.get('parecer') || '').trim();
    return a;
  };
  const redesenhar = () => {
    const it = { ...i, analise: ler() }, fb = num(ler().fator_venda) || viab().fator_venda;
    const cen = CENARIOS.map(c => ({ ...c, r: motor(it, { multVenda: c.multVenda, multRef: c.multRef, extra: c.extra }) }));
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
    ${campo('Ágio alvo padrão (%)', input('margem_alvo', v.margem_alvo, 'number'))}
    ${campo('Assessoria — até R$ (1ª faixa)', input('fx1_ate', tabelaFee()[0]?.ate ?? 450000, 'number'), true)}
    ${campo('Assessoria — % da 1ª faixa', input('fx1_pct', tabelaFee()[0]?.pct ?? 6, 'number', 'step="0.5"'))}
    ${campo('Assessoria — % acima disso', input('fx2_pct', tabelaFee()[1]?.pct ?? 5, 'number', 'step="0.5"'))}
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
      o.fee_tabela = [{ ate: num(fd.get('fx1_ate')) || 450000, pct: num(fd.get('fx1_pct')) || 6 }, { ate: null, pct: num(fd.get('fx2_pct')) || 5 }];
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
  const cen = { pes: motor(i, { multVenda: 0.93, multRef: 1.3, extra: 3 }), base: motor(i, {}), oti: motor(i, { multVenda: 1.03, multRef: 0.85, extra: -1 }) };
  const ro = motor(i, { desocupado: false }), rd = motor(i, { desocupado: true });
  const lm = lanceMax(i, {});
  const V = veredito(i, {});
  const b = cen.base;
  const pc = x => (x * 100).toFixed(1).replace('.', ',') + '%';
  const mm = x => (num(x) < 0 ? '−' : '') + 'R$ ' + Math.abs(num(x)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    veredito: ({ viavel: 'VIÁVEL — operação recomendada no lance analisado',
                 condicionado: 'CONDICIONADO — recomendada apenas nas condições abaixo',
                 reprovado: 'REPROVADO — não recomendada',
                 sem_dados: 'SEM DADOS SUFICIENTES' })[V.status] || '—',
    condicoes: V.status === 'condicionado' ? V.cond.map(c => '· ' + c).join('\n')
      : V.status === 'reprovado' ? '· ' + V.motivo
      : '· Nenhuma condição adicional: a operação fecha no lance analisado.',
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

/* ═══════════ 🧮 SIMULADOR — tela própria, avulsa ou vinculada ═══════════
   Na mesa do leilão não dá para cadastrar imóvel antes de fazer conta. Aqui o
   simulador roda solto: digita os números e o veredito sai na hora. Se quiser,
   puxa um imóvel já cadastrado, mexe à vontade e só grava se decidir gravar.
   A simulação fica no navegador (localStorage), então recarregar não perde.
   v87.67: campos completos (prazos separados, débitos separados, comissão da
   assessoria por faixa) e cascata didática mostrando para onde vai cada real. */
const SIM_KEY = 'psm.morimatsu.sim';
const simVazia = () => ({
  id: '__sim', titulo: '', modalidade: 'extra', credor: 'Caixa Econômica Federal',
  cidade: '', bairro: '', matricula: '', cartorio: '', area: 0,
  avaliacao: 0, lance_min: 0, ocupado: true, vinculo: null,
  analise: {
    mercado: 0, venal: 0, lance_base: 0,
    m_ocup: 3, m_docs: 1, m_reforma: 2, m_venda: 3,
    reforma: 0, mobilia: 0, dd: 1500, advogado: 8000,
    debitos_iptu: 0, debitos_cond: 0, itbi_valor: 0, escritura_valor: 0,
    venda_esperada: 0, comissao_revenda: 6, margem_pct: 20,
  },
});
let _sim = null;
function sim() {
  if (_sim) return _sim;
  try { const g = JSON.parse(localStorage.getItem(SIM_KEY) || 'null'); if (g && g.analise) _sim = { ...simVazia(), ...g, analise: { ...simVazia().analise, ...g.analise } }; } catch (_) { _sim = null; }
  return (_sim = _sim || simVazia());
}
function salvarSim() { try { localStorage.setItem(SIM_KEY, JSON.stringify(_sim)); } catch (_) { /* modo anônimo */ } }
function carregarImovel(id) {
  const o = imvPorId(id);
  if (!o) { _sim = simVazia(); return salvarSim(); }
  _sim = JSON.parse(JSON.stringify({ ...simVazia(), ...o, id: '__sim', vinculo: o.id, analise: { ...simVazia().analise, ...(o.analise || {}) } }));
  const A = _sim.analise;
  if (!num(A.mercado)) A.mercado = num(o.avaliacao);
  if (!num(A.venal)) A.venal = num(o.avaliacao);
  if (!num(A.lance_base)) A.lance_base = num(o.lance_min);
  if (!num(A.debitos_cond) && num(o.debitos_cond)) A.debitos_cond = num(o.debitos_cond);
  salvarSim();
}

const ajuda = t => `<span class="tiny muted" style="display:block;margin-top:2px;line-height:1.35">${t}</span>`;
const bloco = (n, titulo, sub) => `<div class="ma-bloco"><div class="ma-bloco-n">${n}</div><div><b>${titulo}</b>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div></div>`;

export function renderSimulador() {
  const s = sim(), A = s.analise, v = viab(), f = cfg().fee;
  const vinc = s.vinculo ? imvPorId(s.vinculo) : null;
  const cmp = (lbl, campoHtml, dica) => `<label class="field">${lbl ? `<span class="tiny muted">${lbl}</span>` : ''}${campoHtml}${dica ? ajuda(dica) : ''}</label>`;
  const faixas = tabelaFee().map(x => `${num(x.ate) ? 'até ' + brl(x.ate) : 'acima disso'} → ${x.pct}%`).join(' · ');
  return `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title" style="margin:0">🧮 Simulador de arremate</h2>
          <div class="card-sub" style="margin:0">Digite os números e o veredito sai na hora. Não precisa cadastrar imóvel — se quiser, puxe um já cadastrado ou grave a simulação como imóvel novo.</div>
        </div>
        <select class="input" id="sim-imv" style="max-width:250px">
          <option value="">🧮 Simulação avulsa</option>
          ${S.imoveis.map(i => `<option value="${esc(i.id)}" ${s.vinculo === i.id ? 'selected' : ''}>🏠 ${esc(i.titulo)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="sim-cfg">⚙️ Premissas</button>
        <button class="btn btn-ghost" id="sim-zerar">🔄 Limpar</button>
      </div>
      ${vinc ? `<div class="tiny muted mt-2">Vinculado a <b>${esc(vinc.titulo)}</b>. Mexer aqui não altera o imóvel — use “Salvar no imóvel” para gravar.</div>` : ''}
    </div>

    <div id="sim-resposta">${simResposta(sim())}</div>

    <form id="f-sim">
    <div class="card">
      ${bloco(1, 'Os valores de referência', 'Três valores diferentes que quase sempre são confundidos — e cada um serve para uma coisa.')}
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${cmp('Identificação do imóvel', input('titulo', s.titulo, 'text', 'placeholder="Ap. 32 · Ed. Solar"'))}
        ${cmp('Modalidade', `<select class="input" name="modalidade">${Object.entries(MODAL).map(([k, l]) => `<option value="${k}" ${s.modalidade === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'Leilão não tem escritura; venda direta e online têm taxa do canal.')}
        ${cmp('Valor de avaliação (R$)', input('avaliacao', s.avaliacao, 'number'), 'O que o credor diz que vale. Base da taxa de ocupação.')}
        ${cmp('Valor de mercado local (R$)', input('mercado', A.mercado, 'number'), 'O que vale de verdade na região. É o número mais importante da conta.')}
        ${cmp('Valor venal de referência (R$)', input('venal', A.venal, 'number'), 'Base do ITBI. O município cobra sobre o MAIOR entre este e o lance.')}
        ${cmp('Área útil (m²)', input('area', s.area, 'number'), num(s.area) && num(A.mercado) ? `Mercado a <b>${brl(num(A.mercado) / num(s.area))}/m²</b> — confira contra o bairro.` : 'Serve para checar o R$/m² do valor de mercado.')}
      </div>
    </div>

    <div class="card">
      ${bloco(2, 'O lance', 'O que o edital pede e o que você pretende dar. O teto quem calcula é o motor.')}
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${cmp('Lance mínimo do edital (R$)', input('lance_min', s.lance_min, 'number'), 'Abaixo disso não existe lance. Se o teto ficar abaixo do mínimo, o imóvel é reprovado.')}
        ${cmp('Lance que você pretende dar (R$)', input('lance_base', A.lance_base, 'number'), 'É este que o simulador testa contra o teto.')}
        ${cmp('Quanto você quer ganhar (%)', input('margem_pct', A.margem_pct != null && A.margem_pct !== '' ? A.margem_pct : v.margem_alvo, 'number', 'min="0"'),
          num(A.margem_pct) === 0 && A.margem_pct != null
            ? '<b style="color:#d97706">Com ágio 0 o teto vira o ponto de equilíbrio</b> — o lance máximo passa a ser o que empata, sem lucro. Use só para saber onde é o empate.'
            : 'Quanto você quer ganhar sobre o capital investido. É o que define o lance máximo.')}
      </div>
    </div>

    <div class="card">
      ${bloco(3, 'Os prazos', 'Cada mês custa dinheiro: condomínio, IPTU, luz e o seu capital parado. O prazo total é a soma dos quatro.')}
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(165px,1fr))">
        ${cmp('Imóvel ocupado?', `<select class="input" name="ocupado"><option value="1" ${s.ocupado ? 'selected' : ''}>Sim</option><option value="" ${s.ocupado ? '' : 'selected'}>Não</option></select>`, 'Ocupado liga advogado, taxa de ocupação e os meses de desocupação.')}
        ${cmp('Meses de desocupação', input('m_ocup', A.m_ocup, 'number'), 'Da arrematação até a posse na mão.')}
        ${cmp('Meses de desembaraço da documentação', input('m_docs', A.m_docs, 'number'), 'Carta de arrematação, registro na matrícula, certidões.')}
        ${cmp('Meses de reforma', input('m_reforma', A.m_reforma, 'number'), 'Da chave na mão até o imóvel pronto para anunciar.')}
        ${cmp('Meses até a venda acontecer', input('m_venda', A.m_venda, 'number'), 'Tempo de vitrine até assinar. É o mais subestimado dos quatro.')}
      </div>
    </div>

    <div class="card">
      ${bloco(4, 'Os custos de aquisição', 'Tudo o que sai do bolso para o imóvel ser seu. O lance é menos da metade da história.')}
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${cmp('ITBI (R$)', input('itbi_valor', A.itbi_valor, 'number'), `Deixe zero para calcular ${v.itbi}% sobre a maior base. Preencha se já tem a guia.`)}
        ${cmp('Documentação e escritura (R$)', input('escritura_valor', A.escritura_valor, 'number'), 'Deixe zero para calcular pela tabela. Leilão sai por carta de arrematação.')}
        ${cmp('Custas e certidões (R$)', input('dd', A.dd, 'number'), 'Custas processuais, certidões e taxas da análise documental.')}
        ${cmp('Advogado e imissão (R$)', input('advogado', A.advogado, 'number'), 'Só entra se o imóvel estiver ocupado.')}
        ${cmp('Débitos de IPTU (R$)', input('debitos_iptu', A.debitos_iptu, 'number'), 'O atrasado que vem junto. O edital da unidade diz quem paga.')}
        ${cmp('Débitos de condomínio (R$)', input('debitos_cond', A.debitos_cond, 'number'), 'Idem. É o passivo que mais surpreende no ticket baixo.')}
      </div>
      <div class="tiny muted mt-2">Calculados automaticamente: comissão do leiloeiro ${v.leiloeiro}% · registro ${v.registro}% · taxa de ocupação ${v.taxa_ocup_mes}% ao mês sobre a avaliação · <b>comissão da assessoria pela tabela (${esc(faixas)}, piso ${brl(f.piso)})</b>.</div>
    </div>

    <div class="card">
      ${bloco(5, 'Os custos até a venda', 'O que você gasta com o imóvel na mão, antes de alguém comprar.')}
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${cmp('Custo de reforma (R$)', input('reforma', A.reforma, 'number'), 'Orce pelo pior cenário do padrão do prédio — venda direta costuma ser sem visita interna.')}
        ${cmp('Custo de mobília (R$)', input('mobilia', A.mobilia, 'number'), 'Decoração para foto e visita, quando houver.')}
      </div>
      <div class="tiny muted mt-2">Calculado automaticamente: posse corrente de ${brl(posseMes())} ao mês (IPTU, condomínio, água e luz, seguro e manutenção) multiplicada pelo prazo total.</div>
    </div>

    <div class="card">
      ${bloco(6, 'A saída', 'Por quanto sai e o que ainda é descontado na venda.')}
      <div class="ma-form" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        ${cmp('Valor de venda esperado (R$)', input('venda_esperada', A.venda_esperada, 'number'), `Deixe zero para usar ${v.fator_venda}% do valor de mercado. É a premissa que mais mexe no resultado.`)}
        ${cmp('Comissão de revenda (%)', input('comissao_revenda', A.comissao_revenda, 'number', 'step="0.5"'), 'Zere se a venda for sem corretor.')}
      </div>
      <div class="tiny muted mt-2">Calculado automaticamente: imposto sobre o ganho — ${v.regime === 'PJ' ? `pessoa jurídica, ${v.carga_pj}% sobre a receita` : `pessoa física, ${v.ir_pf}% sobre o ganho de capital`}.</div>
    </div>
    </form>

    <div class="card">
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
        ${vinc ? `<button class="btn btn-primary" id="sim-save">💾 Salvar no imóvel</button>` : `<button class="btn btn-primary" id="sim-novo">＋ Criar imóvel com estes dados</button>`}
        <button class="btn btn-gold" id="sim-parecer">📄 Gerar parecer</button>
        <span class="tiny muted">Tudo recalcula a cada tecla. Nada é gravado até você mandar.</span>
      </div>
    </div>
    <div id="sim-out">${simOut(sim())}</div>`;
}

/* Cascata: para onde vai cada real, em ordem, com o peso de cada linha */
function cascata(r) {
  const linhas = Object.entries(r.custos).filter(([k, val]) => k !== 'lance' && num(val) > 0);
  const pc = x => (x * 100).toFixed(1).replace('.', ',') + '%';
  return `<div style="overflow-x:auto"><table class="ma-tbl">
    <tr><th>De onde sai o dinheiro</th><th style="text-align:right">Valor</th><th style="text-align:right">% do total</th></tr>
    <tr><td><b>${CUSTO_LABEL.lance}</b></td><td class="ma-num" style="text-align:right"><b>${brl(r.custos.lance)}</b></td><td class="ma-num" style="text-align:right">${pc(r.custos.lance / r.inv)}</td></tr>
    ${linhas.map(([k, val]) => `<tr><td>${esc(CUSTO_LABEL[k] || k)}</td><td class="ma-num" style="text-align:right">${brl(val)}</td><td class="ma-num" style="text-align:right">${pc(val / r.inv)}</td></tr>`).join('')}
    <tr style="background:var(--bg-3)"><td><b>INVESTIMENTO TOTAL</b></td><td class="ma-num" style="text-align:right"><b>${brl(r.inv)}</b></td><td class="ma-num" style="text-align:right">100%</td></tr>
    <tr><td colspan="3" style="padding-top:12px"><b>E o que volta na venda</b></td></tr>
    <tr><td>Valor de venda</td><td class="ma-num" style="text-align:right">${brl(r.venda)}</td><td></td></tr>
    <tr><td>− Comissão de revenda (${String(r.comRevenda).replace('.', ',')}%)</td><td class="ma-num" style="text-align:right">−${brl(r.corret)}</td><td></td></tr>
    <tr><td>− Imposto sobre o ganho</td><td class="ma-num" style="text-align:right">−${brl(r.imposto)}</td><td></td></tr>
    <tr><td>− Investimento total</td><td class="ma-num" style="text-align:right">−${brl(r.inv)}</td><td></td></tr>
    <tr style="background:var(--bg-3)"><td><b>= LUCRO LÍQUIDO</b></td><td class="ma-num" style="text-align:right"><b style="color:${r.lucro > 0 ? '#16a34a' : '#ef4444'}">${brl(r.lucro)}</b></td><td class="ma-num" style="text-align:right"><b>${pc(r.agio)}</b></td></tr>
  </table></div>`;
}

/* ═══════════ 🎯 A RESPOSTA — o topo do simulador ═══════════
   A conta detalhada estava respondendo tudo, menos a pergunta que se faz na mesa
   do leilão: "posso dar esse lance ou não, e até quanto?". Este bloco responde
   isso em uma frase, com uma régua mostrando onde o seu lance cai em relação ao
   mínimo do edital e ao teto que a conta suporta. O resto virou "ver detalhes". */
function regua(minEdital, teto, lance) {
  const vals = [minEdital, teto, lance].filter(x => num(x) > 0);
  if (vals.length < 2) return '';
  const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.08;
  const pos = v => Math.max(0, Math.min(100, (num(v) - lo) / (hi - lo) * 100));
  const pTeto = pos(teto), pLance = pos(lance), pMin = pos(minEdital);
  const cabe = num(lance) <= num(teto);
  return `<div class="ma-regua">
    <div class="ma-regua-trilho">
      <div class="ma-regua-ok" style="width:${pTeto}%"></div>
      <div class="ma-regua-nao" style="left:${pTeto}%;width:${100 - pTeto}%"></div>
      ${num(minEdital) > 0 ? `<div class="ma-regua-marca" style="left:${pMin}%"><span>mínimo do edital<br><b>${brl(minEdital)}</b></span></div>` : ''}
      <div class="ma-regua-marca teto" style="left:${pTeto}%"><span>teto da conta<br><b>${brl(teto)}</b></span></div>
      ${num(lance) > 0 ? `<div class="ma-regua-pin ${cabe ? 'ok' : 'nao'}" style="left:${pLance}%" title="seu lance">▼<span>seu lance<br><b>${brl(lance)}</b></span></div>` : ''}
    </div>
    <div class="ma-regua-leg"><span>◀ verde: dá lucro</span><span>vermelho: dá prejuízo ▶</span></div>
  </div>`;
}

function resumoSimples(s, b, lm, V) {
  const minEdital = num(s.lance_min), lance = num(b.L);
  const cabe = lance > 0 && lance <= lm;
  const semLance = !lance;
  const impossivel = minEdital > 0 && lm < minEdital;
  const dif = Math.abs(lm - lance);
  const pc2 = x => (x * 100).toFixed(2).replace('.', ',') + '%';
  const liquido = b.venda - b.corret - b.imposto;

  let selo, cor, frase;
  if (impossivel) {
    selo = 'NÃO DÁ'; cor = '#ef4444';
    frase = `A conta só suporta até <b>${brl(lm)}</b>, e o edital pede no mínimo <b>${brl(minEdital)}</b>.
      Não existe lance que feche: o banco está pedindo mais do que o imóvel comporta. <b>Passe este imóvel.</b>`;
  } else if (semLance) {
    selo = 'PODE DAR ATÉ'; cor = '#9C7A3C';
    frase = `Você pode cobrir até <b>${brl(lm)}</b> e ainda ganhar o que pediu. Coloque o lance que pretende dar para comparar.`;
  } else if (cabe) {
    selo = 'PODE DAR'; cor = '#16a34a';
    frase = `Seu lance de <b>${brl(lance)}</b> cabe. O teto é <b>${brl(lm)}</b> — você ainda tem <b>${brl(dif)}</b> de folga para disputar.`;
  } else {
    selo = 'NÃO COBRIR'; cor = '#ef4444';
    frase = `Seu lance de <b>${brl(lance)}</b> passa <b>${brl(dif)}</b> do teto. O máximo que fecha é <b>${brl(lm)}</b>.
      Acima disso você compra o prejuízo.`;
  }

  const cartao = (ico, titulo, valor, nota, corV) => `<div class="ma-resumo-c">
    <div class="tiny muted">${ico} ${titulo}</div>
    <div class="ma-resumo-v" ${corV ? `style="color:${corV}"` : ''}>${valor}</div>
    <div class="tiny muted">${nota}</div></div>`;

  return `
    <div class="card ma-resposta" style="border-color:${cor}">
      <div class="ma-resposta-topo">
        <div class="ma-resposta-selo" style="background:${cor}">${selo}</div>
        <div class="ma-resposta-valor">${brl(lm)}</div>
        <div class="tiny muted" style="width:100%">é o máximo que você pode dar neste imóvel</div>
      </div>
      <p class="ma-resposta-frase">${frase}</p>
      ${regua(minEdital, lm, lance)}
    </div>

    ${lance ? `<div class="card">
      <h2 class="card-title">Se você arrematar por ${brl(lance)}</h2>
      <div class="ma-resumo">
        ${cartao('💸', 'Você coloca', brl(b.inv), 'lance + taxas + reforma + os meses até vender')}
        ${cartao('💰', 'Você recebe', brl(liquido), 'venda já sem a comissão e o imposto')}
        ${cartao(b.lucro > 0 ? '✅' : '🔻', b.lucro > 0 ? 'Sobra' : 'Falta', brl(Math.abs(b.lucro)), b.lucro > 0 ? 'no seu bolso, no fim' : 'você põe mais do que tira', b.lucro > 0 ? '#16a34a' : '#ef4444')}
        ${cartao('📈', 'Rende', pc2(b.agioMes) + ' ao mês', `em ${b.prazo} meses · seu piso é ${pc2(b.tma_m)} ao mês`, b.agioMes >= b.tma_m ? '#16a34a' : '#ef4444')}
      </div>
      ${V && V.status === 'condicionado' && V.cond.length ? `<div class="alert alert-warn mt-2" style="font-size:13px">
        <b>Fecharia se:</b><ul class="ma-cond">${V.cond.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    </div>` : ''}`;
}

const semDados = A => !num(A.lance_base) || !(num(A.mercado) || num(A.venda_esperada));
const aguardando = txt => `<div class="card"><div class="ma-veredito" style="border-color:#64748b">
  <div class="ma-ver-selo" style="background:#64748b">AGUARDANDO</div>
  <div style="flex:1">${txt}</div></div></div>`;

/* Topo: a resposta. Fica acima do formulário — é o que se olha na mesa do leilão. */
function simResposta(s) {
  if (semDados(s.analise)) return aguardando('Preencha o <b>valor de mercado</b> e o <b>lance</b> lá embaixo para o simulador responder.');
  return resumoSimples(s, motor(s, {}), lanceMax(s, {}), veredito(s, {}));
}

function simOut(s) {
  const v = viab(), A = s.analise;
  if (semDados(A)) return '';
  const cen = CENARIOS.map(c => ({ ...c, r: motor(s, { multVenda: c.multVenda, multRef: c.multRef, extra: c.extra }) }));
  const ro = { r: motor(s, { desocupado: false }), lm: lanceMax(s, { desocupado: false }) };
  const rd = { r: motor(s, { desocupado: true }), lm: lanceMax(s, { desocupado: true }) };
  const b = cen[1].r, lm = lanceMax(s, {});
  const V = veredito(s, {});
  const pc = x => (x * 100).toFixed(1).replace('.', ',') + '%';
  const pc2 = x => (x * 100).toFixed(2).replace('.', ',') + '%';
  return `
    <details class="card ma-detalhes"><summary><b>Ver a conta detalhada</b> <span class="tiny muted">— cascata de custos, cenários e as duas rotas</span></summary>
    <div style="margin-top:10px">${anOut(s, cen, lm, ro, rd, ro.r.inv - rd.r.inv)}</div>
    <div class="ma-sec">🧾 A conta aberta — cenário realista</div>
    <div>
      <p class="card-sub">Prazo total de <b>${b.prazo} meses</b>: ${b.meses.ocupacao} de desocupação, ${b.meses.documentacao} de documentação, ${b.meses.reforma} de reforma e ${b.meses.venda} até vender. Comissão da assessoria pela faixa ${num(b.faixaFee.ate) ? 'até ' + brl(b.faixaFee.ate) : 'acima da última faixa'} → <b>${b.faixaFee.pct}%</b>.</p>
      ${cascata(b)}
    </div>
    <div class="ma-sec">📈 Ágio — total e por mês</div>
    <div>
      <p class="card-sub">O ágio total dividido pelos meses até a venda mostra o quanto o capital rende por mês nesta operação. É o número que compara este imóvel com qualquer outra aplicação.</p>
      <div style="overflow-x:auto"><table class="ma-tbl">
        <tr><th>Cenário</th><th style="text-align:right">Venda</th><th style="text-align:right">Prazo</th><th style="text-align:right">Lucro</th><th style="text-align:right">Ágio total</th><th style="text-align:right">Ágio ao mês</th><th>Fecha?</th></tr>
        ${cen.map(c => `<tr>
          <td><b style="color:${c.cor}">${c.nome}</b><div class="tiny muted">${esc(c.ajuda)}</div></td>
          <td class="ma-num" style="text-align:right">${brl(c.r.venda)}</td>
          <td class="ma-num" style="text-align:right">${c.r.prazo}m</td>
          <td class="ma-num" style="text-align:right;color:${c.r.lucro > 0 ? '#16a34a' : '#ef4444'}">${brl(c.r.lucro)}</td>
          <td class="ma-num" style="text-align:right"><b>${pc(c.r.agio)}</b></td>
          <td class="ma-num" style="text-align:right"><b>${pc2(c.r.agioMes)}</b></td>
          <td><span class="ma-status" style="background:${c.r.viavel ? '#16a34a' : '#94a3b8'}">${c.r.viavel ? 'SIM' : 'NÃO'}</span></td>
        </tr>`).join('')}
      </table></div>
      <div class="tiny muted mt-2">Referência: a TMA exigida é de <b>${pc2(tmaMes())} ao mês</b> (${v.tma_aa}% ao ano). Ágio ao mês abaixo disso significa que o capital rende menos parado do que nesta operação.</div>
    </div></details>`;
}

export function wireSimulador(root) {
  const $ = q => root.querySelector(q);
  const form = $('#f-sim');
  const ler = () => {
    const fd = new FormData(form), s = sim();
    ['titulo', 'modalidade'].forEach(k => { s[k] = String(fd.get(k) || '').trim(); });
    ['area', 'avaliacao', 'lance_min'].forEach(k => { s[k] = num(fd.get(k)); });
    s.ocupado = !!fd.get('ocupado');
    ['mercado', 'venal', 'lance_base', 'm_ocup', 'm_docs', 'm_reforma', 'm_venda', 'reforma', 'mobilia',
     'dd', 'advogado', 'debitos_iptu', 'debitos_cond', 'itbi_valor', 'escritura_valor',
     'venda_esperada', 'comissao_revenda', 'margem_pct'].forEach(k => { s.analise[k] = num(fd.get(k)); });
    salvarSim();
    return s;
  };
  const repintar = () => { const s = ler(); $('#sim-resposta').innerHTML = simResposta(s); $('#sim-out').innerHTML = simOut(s); };
  form.querySelectorAll('input,select').forEach(el => el.oninput = el.onchange = repintar);
  $('#sim-imv').onchange = e => { e.target.value ? carregarImovel(e.target.value) : (_sim = simVazia(), salvarSim()); render(); };
  $('#sim-zerar').onclick = () => { if (!confirm('Limpar a simulação?')) return; _sim = simVazia(); salvarSim(); render(); };
  $('#sim-cfg').onclick = () => editarViab(() => render());
  $('#sim-parecer').onclick = () => { const s = ler(); if (!num(s.analise.lance_base)) return alert('Informe o lance antes de gerar o parecer.'); gerarParecer({ ...s, titulo: s.titulo || 'Imóvel simulado' }); };
  const nv = $('#sim-novo');
  if (nv) nv.onclick = async () => {
    const s = ler();
    if (!s.titulo) return alert('Dê um nome ao imóvel antes de cadastrar.');
    const novo = { ...JSON.parse(JSON.stringify(s)), id: uid('imv'), status: 'analise', criado_em: new Date().toISOString() };
    delete novo.vinculo;
    novo.debitos_cond = s.analise.debitos_cond;
    await upsert('imoveis', novo);
    _sim.vinculo = novo.id; salvarSim(); render();
  };
  const sv = $('#sim-save');
  if (sv) sv.onclick = async () => {
    const s = ler(), o = imvPorId(s.vinculo);
    if (!o) return alert('O imóvel vinculado não existe mais.');
    if (!confirm(`Gravar estes números em "${o.titulo}"?`)) return;
    await upsert('imoveis', { ...o, titulo: s.titulo || o.titulo, area: s.area, modalidade: s.modalidade,
      avaliacao: s.avaliacao, lance_min: s.lance_min, ocupado: s.ocupado, debitos_cond: s.analise.debitos_cond,
      analise: { ...(o.analise || {}), ...s.analise } });
  };
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
