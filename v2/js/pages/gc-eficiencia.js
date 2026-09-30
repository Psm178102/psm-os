/* PSM-OS v2 — ⚙️ EFICIÊNCIA DA ESTEIRA (aba da Gestão Comercial · v89.13, pedido do Paulo 30/set)
   A planilha do Kaue no Notion ("Eficiência da Esteira" + "Métricas da META" +
   "Produtividade individual") dentro do House, sem digitação, e explicando o
   raciocínio em passos pra quem gere entender de onde sai cada número.
   Backend: /api/v3/oo/eficiencia (cache 10 min). Escopo: esteira do PSM HUB
   (Funil Conquista) · vendas do RD · metas do House. Mês = mês da data "até". */
import { api } from '../api.js';

let _d = null, _key = '', _err = '', _loading = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = (v, dig = 1) => (v == null ? '—' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(+v) ? 0 : dig }));
const f0 = v => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'));
const pc = v => (v == null ? '—' : Math.round(v * 100) + '%');
const R$ = v => (v == null ? '—' : v >= 1e6 ? 'R$ ' + fN(v / 1e6, 2) + ' mi' : 'R$ ' + f0(v / 1e3) + ' mil');
const nome = n => esc(String(n || '').replace(/ Lima Zaninello| Cavalcante| Ozório| Ozorio/g, ''));
const OK = 'var(--gc-ok)', WARN = 'var(--gc-warn)', ERR = 'var(--gc-err)';
const ROT = { prospeccao: 'Prospecções', agendamento: 'Agendamentos', atendimento: 'Atendimentos', pasta: 'Pastas', venda: 'Vendas' };
const rot1 = { prospeccao: 'prospecção', agendamento: 'agendamento', atendimento: 'atendimento', pasta: 'pasta', venda: 'venda' };
const corPct = p => (p == null ? 'var(--border-2)' : p >= 1 ? OK : p >= 0.8 ? WARN : ERR);
const sec = (t, sub, inner) => `<div class="gc-pan"><div class="gc-pan-t">${t}${sub ? ` <span class="tiny muted" style="font-weight:500">· ${sub}</span>` : ''}</div>${inner}</div>`;
const tabela = (cab, linhas) => `<div style="overflow-x:auto;margin-top:10px"><table><thead><tr>${cab.map((c, i) => `<th style="text-align:${i ? 'right' : 'left'}">${c}</th>`).join('')}</tr></thead><tbody>${linhas.join('') || `<tr><td colspan="${cab.length}" class="tiny muted">sem dados no mês</td></tr>`}</tbody></table></div>`;
const barra = p => p == null ? '—' : `<span style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end"><b style="color:${corPct(p)}">${pc(p)}</b><span style="display:inline-block;width:60px;height:6px;border-radius:3px;background:var(--border-2);overflow:hidden"><span style="display:block;height:100%;width:${Math.min(100, p * 100)}%;background:${corPct(p)}"></span></span></span>`;
const falta = (dif, fim) => dif == null ? '—' : Math.abs(dif) < 0.5
  ? `<span style="color:${OK};font-weight:700">● no ponto</span>`
  : dif < 0 ? `<span style="color:${ERR};font-weight:700">● ${fim ? 'faltaram' : 'faltam'} ${fN(-dif)}</span>`
    : `<span style="color:${OK};font-weight:700">● ${fN(dif)} acima</span>`;
const passo = (n, titulo, txt) => `<div style="display:flex;gap:10px;margin-top:10px"><div style="flex:0 0 26px;height:26px;border-radius:50%;background:var(--accent,#3b82f6);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:13px">${n}</div><div><div style="font-weight:700">${titulo}</div><div class="tiny" style="margin-top:2px;line-height:1.5">${txt}</div></div></div>`;

export function eficienciaHTML(team) {
  const aviso = team && team !== 'conquista'
    ? `<div class="alert alert-warn tiny" style="margin-top:12px">Esta aba cobre só a <b>esteira da Conquista</b> (PSM HUB). O filtro de equipe não se aplica aqui.</div>` : '';
  return `${aviso}<div id="gc-efi" style="margin-top:4px">${_d ? corpo() : _err ? `<div class="alert alert-err tiny" style="margin-top:12px">${esc(_err)}</div>` : '<div class="muted tiny" style="margin-top:12px"><span class="spinner"></span> Montando a eficiência da esteira (HUB do mês + 3 meses de referência)…</div>'}</div>`;
}

export async function eficienciaLoad(until, fresh) {
  const key = String(until || '').slice(0, 7);
  if (!fresh && _d && _key === key) return;
  if (_loading) return;
  _loading = true; _err = '';
  if (_key !== key) _d = null;
  try {
    _d = await api.request(`/api/v3/oo/eficiencia?until=${until}${fresh ? '&fresh=1' : ''}`);
    _key = key;
  } catch (e) { _err = e.message || String(e); _d = null; }
  _loading = false;
  const box = document.getElementById('gc-efi');
  if (box) box.innerHTML = _d ? corpo() : `<div class="alert alert-err tiny" style="margin-top:12px">${esc(_err)}</div>`;
}

/* resumo compacto pro 🧠 Sr. Performance */
export function eficienciaResumo() {
  if (!_d) return null;
  return { mes: _d.mes.nome, referencia: _d.referencia.meses, taxas: _d.taxas.map(t => ({ de: t.de, para: t.para, taxa: t.taxa, amostra: `${t.n_de}→${t.n_para}` })),
    pela_conversao: _d.conversao.map(c => ({ etapa: `${c.de}→${c.para}`, entrou: c.entrou, esperado: c.esperado, realizado: c.realizado, desempenho: c.desempenho })),
    pela_meta: _d.pela_meta.map(p => ({ etapa: p.etapa, meta: p.meta, ate_hoje: p.ate_hoje, realizado: p.realizado, projecao: p.projecao })),
    gargalo: _d.gargalo, meta_vgv: _d.meta_vgv, meta_vendas: _d.meta_vendas, vgv_real: _d.real.vgv };
}

function corpo() {
  const d = _d, m = d.mes;
  const cab = `<div class="tiny muted" style="margin-top:12px">⚙️ ${esc(m.nome)} · ${esc(d.fonte)} · referência: ${esc(d.referencia.meses.join(', ') || '—')}${d.cached ? ' · cache 10 min' : ''}</div>`;
  const av = (d.avisos || []).map(a => `<div class="alert alert-warn tiny" style="margin-top:8px">${esc(a)}</div>`).join('');
  return cab + av + blocoRaciocinio(d) + blocoConversao(d) + blocoMeta(d) + blocoPessoas(d) + blocoNotion(d);
}

/* 🧠 O RACIOCÍNIO — os números do mês contados como uma conversa */
function blocoRaciocinio(d) {
  const m = d.mes, t = Object.fromEntries(d.taxas.map(x => [x.de, x])), ref = d.referencia, mt = d.meta || {};
  const pm = Object.fromEntries(d.pela_meta.map(p => [p.etapa, p]));
  const cadeiaTaxas = d.taxas.map(x => `de cada <b>100 ${ROT[x.de].toLowerCase()}</b>, <b>${f0((x.taxa || 0) * 100)}</b> viram ${ROT[x.para].toLowerCase()} <span class="muted">(${fN(x.n_de)} → ${fN(x.n_para)})</span>`).join('; ');
  const reverso = ['venda', 'pasta', 'atendimento', 'agendamento', 'prospeccao'].map(k => `<b>${fN(mt[k])}</b> ${ROT[k].toLowerCase()}`).join(' ← ');
  const ritmo = ['prospeccao', 'agendamento', 'atendimento', 'pasta', 'venda'].map(k => {
    const p = pm[k]; return `${ROT[k]}: deveria ter <b>${fN(p.ate_hoje)}</b>, tem <b style="color:${corPct(p.pct_ritmo)}">${fN(p.realizado)}</b>`;
  }).join(' · ');
  const g = d.gargalo ? d.conversao.find(c => c.de + '>' + c.para === d.gargalo) : null;
  const gTxt = g
    ? `O maior vazamento do mês está em <b>${ROT[g.de]} → ${ROT[g.para]}</b>: com ${fN(g.entrou)} ${ROT[g.de].toLowerCase()}, o normal seria chegar a <b>${fN(g.esperado)}</b> ${ROT[g.para].toLowerCase()}; chegaram <b style="color:${ERR}">${fN(g.realizado)}</b> (${pc(g.desempenho)} do esperado). É nessa passagem que a gestão tem que entrar primeiro.`
    : `Nenhuma passagem abaixo de 90% do normal: a conversão está no ritmo histórico. Se a meta não fecha, o problema é <b>volume</b> na entrada (prospecção), não conversão.`;
  return sec('🧠 O raciocínio', 'leia de cima pra baixo · é a mesma conta do Notion, com os números reais',
    passo(1, 'Quanto a meta pede em vendas',
      `Meta de ${esc(m.nome)}: <b>${R$(d.meta_vgv)}</b>. O ticket médio real das vendas de ${esc(ref.meses.join(', '))} foi <b>${R$(ref.ticket)}</b>. `
      + `${R$(d.meta_vgv)} ÷ ${R$(ref.ticket)} = <b>${fN(d.meta_vendas)} vendas</b> no mês.`)
    + passo(2, 'Como a equipe converte normalmente',
      `Nos 3 meses fechados anteriores (${esc(ref.meses.join(', '))}): ${cadeiaTaxas}. `
      + `<span class="muted">Usamos 3 meses porque poucos negócios enganam: "5 pastas, 1 venda" pode ser sorte ou azar.</span>`)
    + passo(3, 'De trás pra frente: o que precisa entrar',
      `Para ${fN(mt.venda)} vendas, dividindo pelas taxas do passo 2: ${reverso}. `
      + `Essa é a <b>meta de atividade</b> do mês. Não é chute: sai da meta de VGV e de como a equipe converte.`)
    + passo(4, `Onde deveríamos estar hoje (${m.encerrado ? 'mês encerrado' : `dia útil ${m.dias_uteis_passados} de ${m.dias_uteis}`})`,
      `${m.encerrado ? 'O mês acabou, então a comparação é com a meta cheia.' : `Já passaram <b>${pc(m.fracao)}</b> dos dias úteis (seg–sáb), então deveríamos ter ${pc(m.fracao)} de cada meta.`} ${ritmo}.`)
    + passo(5, 'Onde o funil está vazando',
      `Outra pergunta: com o que <b>de fato entrou</b> em cada etapa, quanto deveria ter passado pra seguinte se a equipe convertesse como sempre? ${gTxt}`)
  );
}

/* 1️⃣ PELA CONVERSÃO — o quadro "Eficiência da Esteira" do Kaue */
function blocoConversao(d) {
  const fim = d.mes.encerrado;
  const lin = d.conversao.map(c => `<tr${d.gargalo === c.de + '>' + c.para ? ' style="background:rgba(239,68,68,.08)"' : ''}>
    <td><b>${ROT[c.de]} → ${ROT[c.para]}</b>${d.gargalo === c.de + '>' + c.para ? ' <span style="color:' + ERR + '">⚠ gargalo</span>' : ''}</td>
    <td style="text-align:right">${fN(c.entrou)}</td>
    <td style="text-align:right">${pc(c.taxa)} <span class="tiny muted">(${fN(c.n_de)}→${fN(c.n_para)})</span></td>
    <td style="text-align:right">${fN(c.esperado)}</td>
    <td style="text-align:right;font-weight:700">${fN(c.realizado)}</td>
    <td style="text-align:right">${falta(c.diferenca, fim)}</td>
    <td style="text-align:right">${barra(c.desempenho)}</td>
    <td style="text-align:right" class="tiny muted">${pc(c.taxa_mes)}</td></tr>`);
  return sec('1️⃣ Pela conversão', 'com o que entrou este mês, quanto deveria ter chegado na etapa seguinte',
    tabela(['Passagem', 'Entraram', 'Taxa normal (amostra)', 'Esperado na seguinte', 'Chegaram', 'Falta / acima', 'Desempenho', 'Taxa do mês'], lin)
    + `<div class="tiny muted" style="margin-top:6px"><b>Como ler:</b> "Esperado" = entraram × taxa normal. Desempenho = chegaram ÷ esperado: <span style="color:${OK}">100%+</span> converteu como sempre ou melhor; <span style="color:${ERR}">abaixo de 80%</span> é vazamento. `
    + `A esteira conta o que <b>entrou</b> em cada etapa no mês, então uma pasta deste mês pode ter vindo de um atendimento do mês passado: por isso a taxa às vezes passa de 100%.</div>`);
}

/* 2️⃣ PELA META — o quadro "Métricas da META" do Kaue, com meta até hoje proporcional */
function blocoMeta(d) {
  const fim = d.mes.encerrado;
  const lin = d.pela_meta.map(p => `<tr>
    <td><b>${p.rotulo}</b></td>
    <td style="text-align:right">${fN(p.meta)}</td>
    <td style="text-align:right">${fN(p.ate_hoje)}</td>
    <td style="text-align:right;font-weight:700">${fN(p.realizado)}</td>
    <td style="text-align:right">${falta(p.falta_hoje == null ? null : -p.falta_hoje, fim)}</td>
    <td style="text-align:right">${barra(p.pct_ritmo)}</td>
    <td style="text-align:right">${fN(p.projecao)}</td>
    <td style="text-align:right">${fim ? '—' : fN(p.por_dia)}</td></tr>`);
  const vgv = `<div class="gc-kpis" style="margin-top:10px">
    <div class="gc-kpi" style="--kc:${corPct(d.meta_vgv ? d.real.vgv / (d.meta_vgv * d.mes.fracao || 1) : null)}"><div class="l">VGV no mês (RD)</div><div class="v">${R$(d.real.vgv)}</div><div class="s">meta ${R$(d.meta_vgv)} · ${pc(d.meta_vgv ? d.real.vgv / d.meta_vgv : null)} da meta</div></div>
    <div class="gc-kpi" style="--kc:${corPct(d.meta_vendas ? d.real.venda / (d.meta_vendas * d.mes.fracao || 1) : null)}"><div class="l">Vendas no mês (RD)</div><div class="v">${fN(d.real.venda)}</div><div class="s">meta ${fN(d.meta_vendas)} vendas</div></div>
  </div>`;
  return sec('2️⃣ Pela meta', `funil reverso · meta até hoje = meta × ${pc(d.mes.fracao)} dos dias úteis`,
    vgv + tabela(['Etapa', 'Meta do mês', 'Deveria ter até hoje', 'Tem', 'Falta / acima', 'Ritmo', fim ? 'Fechou em' : 'Projeção no ritmo', 'Precisa por dia útil'], lin)
    + `<div class="tiny muted" style="margin-top:6px"><b>Como ler:</b> "Deveria ter até hoje" divide a meta pelos dias úteis que já passaram (no Notion era a meta cheia, e o status ficava vermelho o mês inteiro). `
    + `"Projeção no ritmo" = o que temos ÷ ${pc(d.mes.fracao)}. "Precisa por dia útil" = o que falta ÷ dias úteis que sobram.</div>`);
}

/* 👤 POR CORRETOR — "Produtividade individual" */
function blocoPessoas(d) {
  const tp = (d.taxas.find(t => t.de === 'pasta') || {}).taxa;
  const lin = d.pessoas.map(p => {
    const r = p.real, mt = p.meta || {}, pr = p.ref.pra_1_venda || {};
    const cel = k => {
      const alvo = mt[k] != null ? mt[k] * d.mes.fracao : null;
      const cor = alvo ? corPct(r[k] / alvo) : 'inherit';
      return `<td style="text-align:right"><b style="color:${cor}">${fN(r[k])}</b>${mt[k] != null ? `<span class="tiny muted"> / ${fN(mt[k])}</span>` : ''}</td>`;
    };
    const pra1 = p.ref.vendas ? ['prospeccao', 'agendamento', 'atendimento', 'pasta'].map(k => f0(pr[k])).join(' · ') + ` <span class="muted">(${p.ref.vendas} venda${p.ref.vendas === 1 ? '' : 's'})</span>` : '<span class="muted">sem venda em 3 meses</span>';
    return `<tr${p.na_meta ? '' : ' style="opacity:.6"'}><td>${nome(p.nome)}${p.na_meta ? '' : ' <span class="tiny muted">(fora da meta)</span>'}</td>
      ${cel('prospeccao')}${cel('agendamento')}${cel('atendimento')}${cel('pasta')}${cel('venda')}
      <td style="text-align:right">${fN(tp != null ? r.pasta * tp : null)}</td>
      <td style="text-align:right;white-space:nowrap">${p.meta_vgv ? R$(p.meta_vgv) : '—'}</td>
      <td style="text-align:right;white-space:nowrap" class="tiny">${pra1}</td></tr>`;
  });
  return sec('👤 Por corretor', 'realizado / meta do mês · cor = ritmo até hoje',
    tabela(['Corretor', 'Prospecções', 'Agendamentos', 'Atendimentos', 'Pastas', 'Vendas', 'Vendas que as pastas sustentam', 'Meta VGV', 'Pra 1 venda (3 meses): prosp · agend · atend · pasta'], lin)
    + `<div class="tiny muted" style="margin-top:6px"><b>Como ler:</b> a meta de cada etapa sai da meta de VGV do corretor ÷ ticket médio, voltando pelas taxas da equipe (passo 3). `
    + `"Vendas que as pastas sustentam" = pastas do mês × ${pc(tp)} (taxa normal pasta → venda). "Pra 1 venda" usa só a esteira do próprio corretor nos 3 meses: com 1 ou 2 vendas é indicativo, não regra.</div>`);
}

/* 📓 o que muda em relação à planilha do Notion */
function blocoNotion(d) {
  const itens = [
    ['Taxas de conversão', 'Vinham de poucos negócios (ex.: 5 atendimentos → 5 pastas = "100%").', `3 meses fechados da esteira do HUB (${esc(d.referencia.meses.join(', '))}), com a amostra ao lado de cada taxa.`],
    ['Meta até hoje', 'Igual à meta do mês inteiro: o status ficava "abaixo do ritmo" até o último dia.', 'Proporcional aos dias úteis (seg–sáb) que já passaram.'],
    ['Projeção do mês', 'Repetia o produzido até hoje.', 'Produzido ÷ fração do mês que passou (ritmo).'],
    ['Números', 'Digitados à mão. Em 30/09 mostravam 2 vendas e R$ 409 mil (parados em ~16/09).', 'Automáticos: HUB a cada 5 min, RD a cada 30 min. Um número só em todo o House.'],
    ['Vendas', 'Contagem própria.', 'RD (regra do Dicionário de Métricas). Se o HUB divergir, a tela avisa.'],
  ];
  return `<details class="gc-pan"><summary class="gc-pan-t" style="cursor:pointer">📓 O que mudou em relação à planilha do Notion <span class="tiny muted" style="font-weight:500">· clique pra abrir</span></summary>
    ${tabela(['', 'No Notion', 'Aqui'], itens.map(([a, b, c]) => `<tr><td><b>${a}</b></td><td style="text-align:right" class="tiny">${b}</td><td style="text-align:right" class="tiny">${c}</td></tr>`))}</details>`;
}
