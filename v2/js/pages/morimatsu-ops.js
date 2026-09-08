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
import { gerarMinuta, minutaPorSlug, minutas } from './morimatsu-minutas.js';
import {
  S, COR, COLUNAS, OBJETIVO, PAGAMENTO, FAIXA, CAPITAL, DISP, MODAL, RAIO, ORIGEM,
  scoreDe, porta2, alertaCapital, esc, uid, num, brl, dtBR, hojeISO, autorNome, cfg, feeExito,
  invPorId, imvPorId, upsert, remover, abrirModal, fecharModal, campo, select, input, mini, render, irPara, ctxQuery,
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
const CUSTOS_DEFAULT = { leiloeiro_pct: 5, itbi_pct: 2, registro: 2500, debitos: 0, desocupacao: 0, reforma: 0, outros: 0, saida_alvo: 0, margem_pct: 20 };

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
/* Análise: custo total no lance-base e lance máximo dado saída alvo + margem */
export function analise(i) {
  const a = { ...CUSTOS_DEFAULT, ...(i.analise || {}) };
  const f = cfg().fee;
  const lance_base = num(a.lance_base) || num(i.lance_min);
  const varPct = (num(a.leiloeiro_pct) + num(a.itbi_pct)) / 100;
  const fixos = num(a.registro) + num(a.debitos) + num(a.desocupacao) + num(a.reforma) + num(a.outros);
  const custoDe = L => L + L * varPct + fixos + feeExito(L);
  const custo_total = lance_base ? custoDe(lance_base) : 0;
  const saida = num(a.saida_alvo) || num(i.avaliacao) * 0.97;
  const com = saida * num(f.comissao_pct) / 100;
  const m = num(a.margem_pct) / 100;
  const alvoCusto = (saida - com) / (1 + m);
  let lance_max = (alvoCusto - fixos) / (1 + varPct + num(f.exito_pct) / 100);
  if (lance_max * num(f.exito_pct) / 100 < num(f.piso)) lance_max = (alvoCusto - fixos - num(f.piso)) / (1 + varPct);
  lance_max = Math.max(0, Math.floor(lance_max / 500) * 500);
  const lucro = lance_base ? saida - com - custo_total : 0;
  return { lance_base, custo_total, lance_max, saida, com, lucro, fixos, desconto: num(i.avaliacao) && lance_base ? Math.round((1 - lance_base / num(i.avaliacao)) * 100) : 0, roi: custo_total ? Math.round(lucro / custo_total * 100) : 0, fee: lance_base ? feeExito(lance_base) : 0 };
}
export function abrirImovel(i, aba) {
  i = i || { id: null, status: 'garimpado' };
  aba = aba || (i.id ? 'analise' : 'dados');
  const novo = !i.id;
  const tabs = novo ? [['dados', '📋 Dados']] : [['analise', '🧮 Análise'], ['dados', '📋 Dados'], ['timeline', '🕒 Atividades']];
  const st = IMV_STATUS.find(s => s.id === i.status) || IMV_STATUS[0];
  const titulo = novo ? '＋ Novo imóvel (garimpo)' : `<span style="font-family:Georgia,serif">${esc(i.titulo)}</span> <span class="ma-status" style="background:${st.cor}">${st.emoji} ${esc(st.nome)}</span>`;
  const html = `
    ${novo ? '' : `<div class="flex gap-2" style="flex-wrap:wrap">
      ${i.link ? `<a class="btn btn-ghost" href="${esc(i.link)}" target="_blank" rel="noopener">🔗 Edital / anúncio</a>` : ''}
      <button class="btn btn-ghost" id="d-tarefa">📅 Agendar passo</button>
      ${i.status !== 'arrematado' ? `<button class="btn btn-gold" id="d-arrematar">🏁 Arrematado → criar operação</button>` : `<button class="btn btn-ghost" data-abrir-op="${esc((S.operacoes.find(o => o.imovel_id === i.id) || {}).id || '')}">🔁 Abrir operação</button>`}
      <button class="btn btn-danger" id="d-del" style="margin-left:auto">🗑 Excluir</button>
    </div>`}
    <div class="ma-drawer-tabs">${tabs.map(([id, l]) => `<button class="btn ${id === aba ? 'btn-primary' : 'btn-ghost'} d-tab" data-tab="${id}" style="font-size:12px;padding:5px 10px">${l}</button>`).join('')}</div>
    <div id="d-body">${{ dados: dadosImv, analise: analiseImv, timeline: i2 => timelineHtml(S.atividades.filter(a => a.imovel_id === i2.id), { imovel_id: i2.id, investidor_id: i2.investidor_id || undefined }) }[aba](i)}</div>`;
  abrirModal(titulo, html, box => {
    box.querySelectorAll('.d-tab').forEach(b => b.onclick = () => abrirImovel(i, b.dataset.tab));
    if (!novo) {
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
    ['avaliacao', 'lance_min', 'debitos_cond'].forEach(k => { it[k] = num(fd.get(k)); });
    it.ocupado = !!fd.get('ocupado'); it.aceita_fin = !!fd.get('aceita_fin');
    if (!it.titulo) return;
    if (!it.id) { it.id = uid('imv'); it.criado_em = new Date().toISOString(); it.analise = { ...CUSTOS_DEFAULT, debitos: it.debitos_cond || 0 }; }
    else if (it.analise && it.debitos_cond && !num(it.analise.debitos)) it.analise.debitos = it.debitos_cond;
    fecharModal(); await upsert('imoveis', it);
    if (!i.id) abrirImovel(imvPorId(it.id), 'analise');
  };
}
function analiseImv(i) {
  const a = { ...CUSTOS_DEFAULT, ...(i.analise || {}) };
  const an = analise(i);
  const f = cfg().fee;
  return `<form class="ma-form" id="f-an" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
    ${campo('Lance-base pra análise (R$)', input('lance_base', a.lance_base || i.lance_min, 'number'))}
    ${campo('Comissão do leiloeiro (%)', input('leiloeiro_pct', a.leiloeiro_pct, 'number', 'step="0.5"'))}
    ${campo('ITBI (%)', input('itbi_pct', a.itbi_pct, 'number', 'step="0.5"'))}
    ${campo('Registro + certidões (R$)', input('registro', a.registro, 'number'))}
    ${campo('Débitos (cond./IPTU) (R$)', input('debitos', a.debitos, 'number'))}
    ${campo('Desocupação (R$)', input('desocupacao', a.desocupacao, 'number'))}
    ${campo('Reforma (pior cenário) (R$)', input('reforma', a.reforma, 'number'))}
    ${campo('Outros (R$)', input('outros', a.outros, 'number'))}
    ${campo('Saída alvo — revenda (R$)', input('saida_alvo', a.saida_alvo || Math.round(num(i.avaliacao) * 0.97), 'number'))}
    ${campo('Margem alvo do investidor (%)', input('margem_pct', a.margem_pct, 'number', 'step="1"'))}
    ${campo('Risco', select('risco', RISCO, a.risco))}
    ${campo('Parecer (ocupação, edital, condomínio, estado)', `<textarea class="input" name="parecer" rows="4">${esc(a.parecer || '')}</textarea>`, true)}
    <div class="flex gap-2" style="grid-column:1/-1;align-items:center;flex-wrap:wrap"><button class="btn btn-primary" type="submit">💾 Salvar análise</button><span class="tiny muted">Fee Morimatsu ${f.exito_pct}% (piso ${brl(f.piso)}) e comissão PSM ${f.comissao_pct}% entram automaticamente na conta.</span></div>
  </form>
  <div class="ma-minis" id="an-out" style="margin-top:12px">${anOut(an)}</div>
  <div class="tiny muted">Lance máximo = maior lance em que a revenda alvo, descontada a comissão PSM, ainda entrega a margem alvo sobre o custo total (lance + leiloeiro + ITBI + fixos + fee).</div>`;
}
function anOut(an) {
  return [
    mini('💵 Custo total no lance-base', brl(an.custo_total), `lance ${brl(an.lance_base)} + custos ${brl(an.custo_total - an.lance_base)} (fee ${brl(an.fee)})`),
    mini('🎯 Lance MÁXIMO', brl(an.lance_max), 'pra saída alvo com a margem alvo', COR.dourado),
    mini('📈 Lucro no lance-base', brl(an.lucro), `${an.roi}% sobre o custo · desconto ${an.desconto}% vs avaliação`, an.lucro > 0 ? '#16a34a' : '#ef4444'),
    mini('🏘 Saída alvo − comissão PSM', brl(an.saida - an.com), `comissão ${brl(an.com)}`, '#0ea5e9'),
  ].join('');
}
function wireAnaliseImv(box, i) {
  const form = box.querySelector('#f-an'); if (!form) return;
  const lerForm = () => { const fd = new FormData(form); const a = { ...(i.analise || {}) }; ['lance_base', 'leiloeiro_pct', 'itbi_pct', 'registro', 'debitos', 'desocupacao', 'reforma', 'outros', 'saida_alvo', 'margem_pct'].forEach(k => { a[k] = num(fd.get(k)); }); a.risco = fd.get('risco'); a.parecer = String(fd.get('parecer') || '').trim(); return a; };
  form.querySelectorAll('input').forEach(el => el.oninput = () => { box.querySelector('#an-out').innerHTML = anOut(analise({ ...i, analise: lerForm() })); });
  form.onsubmit = async ev => { ev.preventDefault(); const it = { ...i, analise: lerForm() }; if (!it.status || it.status === 'garimpado') it.status = 'analise'; fecharModal(); await upsert('imoveis', it); };
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
