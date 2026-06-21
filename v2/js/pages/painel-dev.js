/* ============================================================================
   PSM-OS v2 — Meu Painel · Desenvolvimento Individual (v78.6)
   • Teste de Perfil Comportamental (Águia/Gato/Tubarão/Lobo, IBC) respondível no
     sistema → calcula %, mostra resultado e SALVA automático.
   • Rotina em planner semanal (dias × períodos).
   • Metas pessoais: RESULTADO (VGV, ganhos R$) + EVOLUÇÃO (conquistas/realizações).
   • Anexo de análise comportamental (PDF/link) + interpretação por IA.
   Tudo per-usuário via /api/v3/profile/painel_extra. mountDev(container, opts).
============================================================================ */
import { api } from '../api.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// I=Águia, C=Gato, A=Tubarão, O=Lobo  (×4 = %)
const LETRA_ANIMAL = { I: 'aguia', C: 'gato', A: 'tubarao', O: 'lobo' };
const PERFIS = {
  aguia:   { nome: 'Águia',   emoji: '🦅', cor: '#2563eb', lema: 'Fazer Diferente', resumo: 'Criativa, intuitiva, visionária — foco no futuro, flexível e curiosa.', forte: 'Antecipa o futuro, provoca mudanças, criatividade e visão global.', melhoria: 'Falta de atenção ao aqui e agora; impaciência; defender o novo só por ser novo.', motiva: 'Liberdade de expressão, ausência de controles rígidos, ambiente descentralizado, delegar detalhes.' },
  gato:    { nome: 'Gato',    emoji: '🐱', cor: '#16a34a', lema: 'Fazer Junto',     resumo: 'Sensível, relacional, focada em time, harmonia e contribuição.', forte: 'Mantém comunicação harmoniosa, desenvolve a cultura, une o grupo.', melhoria: 'Esconder conflitos; colocar a felicidade acima dos resultados; manipular pelos sentimentos.', motiva: 'Aceitação social, reconhecimento da equipe, ambiente harmônico, trabalho em grupo.' },
  tubarao: { nome: 'Tubarão', emoji: '🦈', cor: '#dc2626', lema: 'Fazer Rápido',   resumo: 'Senso de urgência, ação, prática — vence desafios, aqui e agora.', forte: 'Faz acontecer, para com a burocracia, iniciativa e foco em resultado.', melhoria: 'Impaciência e rebeldia; não gostar de delegar; competir demais.', motiva: 'Liberdade para agir, controle das próprias atividades, competição individual, variedade de tarefas.' },
  lobo:    { nome: 'Lobo',    emoji: '🐺', cor: '#7c3aed', lema: 'Fazer Certo',     resumo: 'Detalhista, organizado, estrategista — pontual, conservador, previsível.', forte: 'Consistência, conformidade e qualidade; estratégia e profundidade.', melhoria: 'Dificuldade de se adaptar a mudanças; pode travar o progresso; sistematização excessiva.', motiva: 'Regras claras, ausência de riscos/erros, segurança, ver o produto acabado (começo, meio e fim).' },
};
// Teste IBC — 25 questões, 4 alternativas (letra → animal)
const QUESTOES = [
  ['Eu sou…', [['I', 'Idealista, criativo e visionário'], ['C', 'Divertido, espiritual e benéfico'], ['O', 'Confiável, meticuloso e previsível'], ['A', 'Focado, determinado e persistente']]],
  ['Eu gosto de…', [['A', 'Ser piloto'], ['C', 'Conversar com os passageiros'], ['O', 'Planejar a viagem'], ['I', 'Explorar novas rotas']]],
  ['Se você quiser se dar bem comigo…', [['I', 'Me dê liberdade'], ['O', 'Me deixe saber sua expectativa'], ['A', 'Lidere, siga ou saia do caminho'], ['C', 'Seja amigável, carinhoso e compreensivo']]],
  ['Para conseguir obter bons resultados é preciso…', [['I', 'Ter incertezas'], ['O', 'Controlar o essencial'], ['C', 'Diversão e celebração'], ['A', 'Planejar e obter recursos']]],
  ['Eu me divirto quando…', [['A', 'Estou me exercitando'], ['I', 'Tenho novidades'], ['C', 'Estou com os outros'], ['O', 'Determino as regras']]],
  ['Eu penso que…', [['C', 'Unidos venceremos, divididos perderemos'], ['A', 'O ataque é melhor que a defesa'], ['I', 'É bom ser manso, mas andar com um porrete'], ['O', 'Um homem prevenido vale por dois']]],
  ['Minha preocupação é…', [['I', 'Gerar a ideia global'], ['C', 'Fazer com que as pessoas gostem'], ['O', 'Fazer com que funcione'], ['A', 'Fazer com que aconteça']]],
  ['Eu prefiro…', [['I', 'Perguntas a respostas'], ['O', 'Ter todos os detalhes'], ['A', 'Vantagens a meu favor'], ['C', 'Que todos tenham a chance de ser ouvido']]],
  ['Eu gosto de… (II)', [['A', 'Fazer progresso'], ['C', 'Construir memórias'], ['O', 'Fazer sentido'], ['I', 'Tornar as pessoas confortáveis']]],
  ['Eu gosto de chegar…', [['A', 'Na frente'], ['C', 'Junto'], ['I', 'No meio'], ['O', 'Em outro lugar']]],
  ['Um ótimo dia para mim é quando…', [['A', 'Consigo fazer muitas coisas'], ['C', 'Me divirto com meus amigos'], ['O', 'Tudo segue conforme planejado'], ['I', 'Desfruto de coisas novas e estimulantes']]],
  ['Eu vejo a morte como…', [['I', 'Uma grande aventura misteriosa'], ['C', 'Oportunidade para rever os falecidos'], ['O', 'Um modo de receber recompensas'], ['A', 'Algo que sempre chega muito cedo']]],
  ['Minha filosofia de vida é…', [['A', 'Há ganhadores e perdedores, e eu acredito ser um ganhador'], ['C', 'Para eu ganhar, ninguém precisa perder'], ['O', 'Para ganhar é preciso seguir as regras'], ['I', 'Para ganhar, é necessário inventar novas regras']]],
  ['Eu sempre gostei de…', [['I', 'Explorar'], ['O', 'Evitar surpresas'], ['A', 'Focalizar a meta'], ['C', 'Realizar uma abordagem natural']]],
  ['Eu gosto de mudanças se…', [['A', 'Me der uma vantagem competitiva'], ['C', 'For divertido e puder ser compartilhado'], ['I', 'Me der mais liberdade e variedade'], ['O', 'Melhorar ou me der mais controle']]],
  ['Não existe nada de errado em…', [['A', 'Se colocar na frente'], ['C', 'Colocar os outros na frente'], ['I', 'Mudar de ideia'], ['O', 'Ser consistente']]],
  ['Eu gosto de buscar conselhos de…', [['A', 'Pessoas bem-sucedidas'], ['C', 'Anciões e conselheiros'], ['O', 'Autoridades no assunto'], ['I', 'Lugares, os mais estranhos']]],
  ['Meu lema é…', [['I', 'Fazer o que precisa ser feito'], ['O', 'Fazer bem feito'], ['C', 'Fazer junto com o grupo'], ['A', 'Simplesmente fazer']]],
  ['Eu gosto de… (III)', [['I', 'Complexidade, mesmo se confuso'], ['O', 'Ordem e sistematização'], ['C', 'Calor humano e animação'], ['A', 'Coisas claras e simples']]],
  ['Tempo para mim é…', [['A', 'Algo que detesto desperdiçar'], ['C', 'Um grande ciclo'], ['O', 'Uma flecha que leva ao inevitável'], ['I', 'Irrelevante']]],
  ['Se eu fosse bilionário…', [['C', 'Faria doações para muitas entidades'], ['O', 'Criaria uma poupança avantajada'], ['I', 'Faria o que desse na cabeça'], ['A', 'Exibiria bastante com algumas pessoas']]],
  ['Eu acredito que…', [['A', 'O destino é mais importante que a jornada'], ['C', 'A jornada é mais importante que o destino'], ['O', 'Um centavo economizado é um centavo ganho'], ['I', 'Bastam um navio e uma estrela para navegar']]],
  ['Eu acredito também que…', [['A', 'Aquele que hesita está perdido'], ['O', 'De grão em grão a galinha enche o papo'], ['C', 'O que vai, volta'], ['I', 'Um sorriso ou uma careta é o mesmo para quem é cego']]],
  ['Eu acredito ainda que…', [['O', 'É melhor prudência do que arrependimento'], ['I', 'A autoridade deve ser desafiada'], ['A', 'Ganhar é fundamental'], ['C', 'O coletivo é mais importante que o individual']]],
  ['Eu penso que… (II)', [['I', 'Não é fácil ficar encurralado'], ['O', 'É preferível olhar, antes de pular'], ['C', 'Duas cabeças pensam melhor do que uma'], ['A', 'Se você não tem condições de competir, não compita']]],
];
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const PERIODOS = ['🌅 Manhã', '☀️ Tarde', '🌙 Noite'];

let _box = null, _uid = null, _canEdit = false, _data = {};

export async function mountDev(container, opts) {
  _box = container; _uid = opts.uid; _canEdit = !!opts.canEdit;
  _box.innerHTML = '<div class="muted tiny"><span class="spinner"></span> Carregando desenvolvimento individual…</div>';
  try {
    const r = await api.request('/api/v3/profile/painel_extra?uid=' + encodeURIComponent(_uid));
    _data = r.data || {}; _canEdit = !!r.can_edit;
  } catch (e) { _data = {}; }
  render();
}

async function patch(secao, valor, statusEl) {
  _data[secao] = valor;
  if (statusEl) statusEl.textContent = 'Salvando…';
  try {
    await api.request('/api/v3/profile/painel_extra', { method: 'POST', body: { uid: _uid, patch: { [secao]: valor } } });
    if (statusEl) { statusEl.textContent = '✓ Salvo'; statusEl.style.color = '#16a34a'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
    return true;
  } catch (e) { if (statusEl) { statusEl.textContent = 'Erro: ' + e.message; statusEl.style.color = '#dc2626'; } return false; }
}

function render() {
  const comp = _data.comportamental, rot = _data.rotina || {}, metas = _data.metas || {}, pdf = _data.pdf || {};
  _box.innerHTML = `
    <style>
      .dev-sec{margin-top:18px}
      .dev-h{font-size:15px;font-weight:800;margin:0 0 8px;display:flex;align-items:center;gap:8px}
      .pf-bar{height:14px;border-radius:7px;background:var(--bg-3);overflow:hidden}
      .pf-bar > i{display:block;height:100%;border-radius:7px}
      .pf-grid{display:grid;grid-template-columns:90px 1fr 46px;gap:8px 10px;align-items:center}
      .plan{width:100%;border-collapse:collapse}.plan th,.plan td{border:1px solid var(--bd);padding:4px;vertical-align:top}
      .plan th{font-size:11px;background:var(--bg-3)}.plan textarea{width:100%;border:0;background:transparent;resize:vertical;min-height:42px;font-size:12px;color:inherit;font-family:inherit}
      .ev-row{display:flex;gap:8px;align-items:center;margin-bottom:6px}
      .dev-card{border:1px solid var(--bd);border-radius:12px;padding:13px 15px;margin-bottom:12px}
    </style>

    <!-- ===== PERFIL COMPORTAMENTAL ===== -->
    <div class="dev-card dev-sec">
      <h3 class="dev-h">🧭 Perfil Comportamental ${comp ? `<span class="tiny muted" style="font-weight:400">· feito em ${esc((comp.data || '').slice(0, 10).split('-').reverse().join('/'))}</span>` : ''}</h3>
      ${comp ? resultadoHTML(comp) : `<div class="tiny muted">Descubra seu perfil (Águia / Gato / Tubarão / Lobo) respondendo 25 perguntas rápidas. O resultado fica salvo aqui.</div>`}
      ${_canEdit ? `<button class="btn btn-primary btn-sm mt-2" id="pf-start">${comp ? '🔁 Refazer teste' : '▶️ Fazer o teste agora'}</button>` : ''}
    </div>

    <!-- ===== ROTINA (planner semanal) ===== -->
    <div class="dev-card dev-sec">
      <h3 class="dev-h">🗓 Rotina — planner semanal <span id="rot-st" class="tiny muted" style="font-weight:400;margin-left:auto"></span></h3>
      <div style="overflow-x:auto"><table class="plan"><thead><tr><th></th>${DIAS.map(d => `<th>${d}</th>`).join('')}</tr></thead>
        <tbody>${PERIODOS.map((p, pi) => `<tr><th>${p}</th>${DIAS.map((d, di) => `<td><textarea data-rot="${pi}_${di}" ${_canEdit ? '' : 'readonly'} placeholder="">${esc((rot[pi + '_' + di]) || '')}</textarea></td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${_canEdit ? `<button class="btn btn-primary btn-sm mt-2" id="rot-save">💾 Salvar rotina</button>` : ''}
    </div>

    <!-- ===== METAS PESSOAIS ===== -->
    <div class="dev-card dev-sec">
      <h3 class="dev-h">🎯 Metas pessoais <span id="meta-st" class="tiny muted" style="font-weight:400;margin-left:auto"></span></h3>
      <div class="tiny muted" style="font-weight:700;margin:2px 0 6px">🏁 Metas de RESULTADO</div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:150px"><label class="tiny muted">VGV (meta R$)</label><input id="m-vgv" class="input" type="text" value="${esc(metas.vgv || '')}" placeholder="Ex.: 2.000.000" ${_canEdit ? '' : 'disabled'}></div>
        <div style="flex:1;min-width:150px"><label class="tiny muted">Ganhos / comissões (meta R$)</label><input id="m-ganhos" class="input" type="text" value="${esc(metas.ganhos || '')}" placeholder="Ex.: 60.000" ${_canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="mt-2"><label class="tiny muted">Outras metas de resultado</label><input id="m-result-obs" class="input" value="${esc(metas.resultado_obs || '')}" placeholder="Ex.: 6 vendas/mês, 4 captações/semana…" ${_canEdit ? '' : 'disabled'}></div>

      <div class="tiny muted" style="font-weight:700;margin:12px 0 6px">🌱 Metas de EVOLUÇÃO — conquistas & realizações</div>
      <div id="ev-list">${(metas.evolucao || []).map((e, i) => evRow(e, i)).join('') || '<div class="tiny muted" id="ev-empty">Nenhuma ainda. Adicione conquistas/realizações que você busca.</div>'}</div>
      ${_canEdit ? `<button class="btn btn-ghost btn-sm mt-1" id="ev-add">➕ Adicionar conquista/realização</button>
        <div class="mt-2"><button class="btn btn-primary btn-sm" id="meta-save">💾 Salvar metas</button></div>` : ''}
    </div>

    <!-- ===== ANÁLISE COMPORTAMENTAL (PDF) ===== -->
    <div class="dev-card dev-sec">
      <h3 class="dev-h">📎 Análise comportamental (PDF) <span id="pdf-st" class="tiny muted" style="font-weight:400;margin-left:auto"></span></h3>
      <label class="tiny muted">Link do PDF (Google Drive)</label>
      <div class="flex gap-2"><input id="pdf-link" class="input" value="${esc(pdf.link || '')}" placeholder="https://drive.google.com/…" ${_canEdit ? '' : 'disabled'}>
        ${pdf.link ? `<a class="btn btn-ghost btn-sm" href="${esc(pdf.link)}" target="_blank" rel="noopener">📎 abrir</a>` : ''}</div>
      <label class="tiny muted" style="margin-top:8px;display:block">Texto da análise (cole aqui o conteúdo do laudo/relatório)</label>
      <textarea id="pdf-texto" class="input" rows="4" placeholder="Cole o texto da análise comportamental para a IA interpretar…" ${_canEdit ? '' : 'disabled'}>${esc(pdf.texto || '')}</textarea>
      ${_canEdit ? `<div class="flex gap-2 mt-2"><button class="btn btn-primary btn-sm" id="pdf-save">💾 Salvar</button><button class="btn btn-ghost btn-sm" id="pdf-ia">🤖 Interpretar com IA</button></div>` : ''}
      ${pdf.interpretacao ? `<div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:11px 13px"><div class="tiny muted" style="font-weight:700;margin-bottom:4px">🤖 Interpretação da IA</div><div class="tiny" style="white-space:pre-wrap">${esc(pdf.interpretacao)}</div></div>` : ''}
    </div>`;
  wire();
}

function resultadoHTML(comp) {
  const pct = comp.pct || {};
  const ordem = ['aguia', 'gato', 'tubarao', 'lobo'].sort((a, b) => (pct[b] || 0) - (pct[a] || 0));
  const dom = PERFIS[comp.dominante] || PERFIS[ordem[0]];
  return `
    <div style="background:${dom.cor}14;border:1px solid ${dom.cor}55;border-radius:10px;padding:11px 13px;margin-bottom:10px">
      <div style="font-size:15px;font-weight:800;color:${dom.cor}">${dom.emoji} Perfil dominante: ${dom.nome} <span class="tiny" style="opacity:.7">— "${dom.lema}"</span></div>
      <div class="tiny" style="margin-top:3px">${esc(dom.resumo)}</div>
      <div class="tiny" style="margin-top:5px"><b>💪 Forças:</b> ${esc(dom.forte)}</div>
      <div class="tiny" style="margin-top:3px"><b>🎯 A desenvolver:</b> ${esc(dom.melhoria)}</div>
      <div class="tiny" style="margin-top:3px"><b>🔋 Motiva:</b> ${esc(dom.motiva)}</div>
    </div>
    <div class="pf-grid">
      ${ordem.map(k => { const p = pct[k] || 0; return `<div style="font-weight:700">${PERFIS[k].emoji} ${PERFIS[k].nome}</div><div class="pf-bar"><i style="width:${p}%;background:${PERFIS[k].cor}"></i></div><div style="text-align:right;font-weight:800;color:${PERFIS[k].cor}">${p}%</div>`; }).join('')}
    </div>`;
}

function evRow(e, i) {
  e = e || {};
  return `<div class="ev-row" data-ev="${i}">
    <input class="input ev-txt" value="${esc(e.texto || '')}" placeholder="Conquista / realização (ex.: virar líder, bater 1ª venda alto padrão…)" style="flex:1" ${_canEdit ? '' : 'disabled'}>
    <input class="input ev-prazo" value="${esc(e.prazo || '')}" placeholder="prazo" style="width:110px" ${_canEdit ? '' : 'disabled'}>
    <label class="tiny" style="white-space:nowrap"><input type="checkbox" class="ev-feito" ${e.feito ? 'checked' : ''} ${_canEdit ? '' : 'disabled'}> feito</label>
    ${_canEdit ? '<button class="btn btn-ghost btn-sm ev-del" title="Remover" style="color:#dc2626">✕</button>' : ''}
  </div>`;
}

function wire() {
  const $ = s => _box.querySelector(s);
  // teste
  $('#pf-start') && ($('#pf-start').onclick = abrirTeste);
  // rotina
  $('#rot-save') && ($('#rot-save').onclick = () => {
    const rot = {}; _box.querySelectorAll('[data-rot]').forEach(t => { const v = t.value.trim(); if (v) rot[t.dataset.rot] = v; });
    patch('rotina', rot, $('#rot-st'));
  });
  // metas
  $('#ev-add') && ($('#ev-add').onclick = () => {
    const list = $('#ev-list'); const emp = $('#ev-empty'); if (emp) emp.remove();
    const div = document.createElement('div'); div.innerHTML = evRow({}, Date.now()); list.appendChild(div.firstElementChild); bindEvDel();
  });
  bindEvDel();
  $('#meta-save') && ($('#meta-save').onclick = () => {
    const evolucao = [..._box.querySelectorAll('[data-ev]')].map(r => ({
      texto: r.querySelector('.ev-txt').value.trim(), prazo: r.querySelector('.ev-prazo').value.trim(), feito: r.querySelector('.ev-feito').checked,
    })).filter(e => e.texto);
    patch('metas', { vgv: $('#m-vgv').value.trim(), ganhos: $('#m-ganhos').value.trim(), resultado_obs: $('#m-result-obs').value.trim(), evolucao }, $('#meta-st'));
  });
  // pdf
  $('#pdf-save') && ($('#pdf-save').onclick = () => savePdf());
  $('#pdf-ia') && ($('#pdf-ia').onclick = interpretarIA);
}

function bindEvDel() { _box.querySelectorAll('.ev-del').forEach(b => b.onclick = e => e.target.closest('[data-ev]').remove()); }

function savePdf(extra) {
  const $ = s => _box.querySelector(s);
  const pdf = Object.assign({}, _data.pdf || {}, { link: $('#pdf-link').value.trim(), texto: $('#pdf-texto').value.trim() }, extra || {});
  return patch('pdf', pdf, $('#pdf-st'));
}

async function interpretarIA() {
  const $ = s => _box.querySelector(s);
  const texto = $('#pdf-texto').value.trim();
  const st = $('#pdf-st');
  if (!texto) { alert('Cole o texto da análise comportamental primeiro (a IA lê o texto, não o PDF em si).'); return; }
  const btn = $('#pdf-ia'); btn.disabled = true; btn.textContent = '🤖 Interpretando…';
  try {
    const r = await api.request('/api/v3/ia/chat', { method: 'POST', body: { agent: 'sr_performance', messages: [
      { role: 'user', content: 'Você é um especialista em desenvolvimento de pessoas numa imobiliária de alto padrão. Interprete esta análise comportamental de um colaborador e devolva, em português, de forma objetiva: (1) resumo do perfil, (2) 3 pontos fortes pra alavancar nas vendas, (3) 3 pontos de atenção, (4) como liderar/motivar essa pessoa, (5) 2 ações práticas de desenvolvimento. Análise:\n\n' + texto },
    ] } });
    const reply = r.reply || r.message || r.content || r.text || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '';
    if (!reply) throw new Error('resposta vazia da IA');
    await savePdf({ interpretacao: reply });
    render();
  } catch (e) {
    btn.disabled = false; btn.textContent = '🤖 Interpretar com IA';
    if (st) { st.textContent = 'IA indisponível: ' + e.message; st.style.color = '#dc2626'; }
  }
}

/* ── Teste (modal) ── */
function abrirTeste() {
  const ov = document.createElement('div');
  ov.id = 'pf-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.7);backdrop-filter:blur(2px);display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow:auto';
  ov.innerHTML = `<div style="width:680px;max-width:96vw;background:var(--bg-2,#fff);color:var(--ink,#0f172a);border:1px solid var(--bd);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.4)">
    <div style="position:sticky;top:0;background:inherit;padding:14px 18px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:14px 14px 0 0">
      <b style="font-size:15px">🧭 Avaliação de Perfil Comportamental</b>
      <button id="pf-x" class="btn btn-ghost btn-sm">✕</button>
    </div>
    <div style="padding:14px 18px">
      <div class="tiny muted" style="margin-bottom:10px">Escolha <b>uma</b> alternativa por questão. São 25 — o resultado é calculado e salvo automaticamente. <span id="pf-prog" style="font-weight:700"></span></div>
      <div id="pf-qs">${QUESTOES.map((q, qi) => `
        <div class="dev-card" data-q="${qi}" style="padding:11px 13px;margin-bottom:9px">
          <div style="font-weight:700;font-size:13.5px;margin-bottom:6px">${qi + 1}. ${esc(q[0])}</div>
          ${q[1].map((o, oi) => `<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;padding:4px 0;cursor:pointer">
            <input type="radio" name="q${qi}" value="${o[0]}" style="margin-top:3px"> <span>${esc(o[1])}</span></label>`).join('')}
        </div>`).join('')}</div>
      <div style="position:sticky;bottom:0;background:inherit;padding:10px 0;display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="pf-fin">✅ Ver resultado e salvar</button>
        <span id="pf-msg" class="tiny" style="color:#dc2626"></span>
      </div>
    </div></div>`;
  document.body.appendChild(ov);
  const prog = () => { const n = ov.querySelectorAll('input[type=radio]:checked').length; ov.querySelector('#pf-prog').textContent = `(${n}/25)`; };
  ov.addEventListener('change', e => { if (e.target.name && e.target.name.startsWith('q')) prog(); });
  prog();
  ov.querySelector('#pf-x').onclick = () => ov.remove();
  ov.querySelector('#pf-fin').onclick = async () => {
    const cont = { I: 0, C: 0, A: 0, O: 0 }; let respondidas = 0;
    QUESTOES.forEach((q, qi) => { const sel = ov.querySelector(`input[name="q${qi}"]:checked`); if (sel) { cont[sel.value] = (cont[sel.value] || 0) + 1; respondidas++; } });
    if (respondidas < 25) { ov.querySelector('#pf-msg').textContent = `Faltam ${25 - respondidas} questão(ões).`; const first = ov.querySelector(`[data-q] `); ov.querySelector(`#pf-qs`).scrollIntoView({ block: 'start' }); return; }
    const pct = {}; Object.keys(LETRA_ANIMAL).forEach(l => { pct[LETRA_ANIMAL[l]] = (cont[l] || 0) * 4; });
    const dominante = Object.keys(pct).reduce((a, b) => (pct[b] > pct[a] ? b : a), 'aguia');
    const comp = { pct, dominante, data: new Date().toISOString(), scores: cont };
    const fin = ov.querySelector('#pf-fin'); fin.disabled = true; fin.textContent = 'Salvando…';
    const ok = await patch('comportamental', comp);
    ov.remove();
    if (ok) render();
    else alert('Não consegui salvar o resultado. Tente de novo.');
  };
}
