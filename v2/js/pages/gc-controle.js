/* PSM-OS v2 — 🧭 CONTROLE (aba da Gestão Comercial · v89.0, pedido do Paulo 29/set)
   "Essas métricas precisam estar CLARAS no painel de gestão comercial."
   5 blocos do FUNIL CONQUISTA: ⏱ 1º atendimento · 📞 cadência de tentativa de
   contato · 🔁 follow-up · 📂 pastas (aprovação de crédito) · 🏁 pós-visita.
   Backend: /api/v3/oo/controle (cache 10 min). Escopo fixo: Funil Conquista, sem
   Funil Parceria, sem leads de vaga, dono = dono atual do card no RD. */
import { api } from '../api.js';

let _d = null, _key = '', _err = '', _loading = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fN = v => (v == null ? '—' : (Number.isInteger(+v) ? (+v).toLocaleString('pt-BR') : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })));
const pc = v => (v == null ? '—' : fN(v) + '%');
const hh = h => {
  if (h == null) return '—';
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return fN(Math.round(h * 10) / 10) + ' h';
  return fN(Math.round(h / 24 * 10) / 10) + ' dias';
};
const dd = d => (d == null ? '—' : fN(Math.round(d * 10) / 10) + ' d');
const nome = n => esc(String(n || '').replace(/ Lima Zaninello| Cavalcante| Ozório/g, ''));
const OK = 'var(--gc-ok)', WARN = 'var(--gc-warn)', ERR = 'var(--gc-err)';
// célula de "coisa ruim": 0 = verde, >0 = vermelho
const bad = v => `<td style="text-align:right;font-weight:700;color:${(v || 0) > 0 ? ERR : OK}">${fN(v || 0)}</td>`;
const num = v => `<td style="text-align:right">${fN(v)}</td>`;
const kpi = (l, v, s, cor) => `<div class="gc-kpi" style="--kc:${cor || 'var(--border-2)'}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const nota = t => `<div class="tiny muted" style="margin-top:6px">${t}</div>`;
const sec = (t, sub, inner) => `<div class="gc-pan"><div class="gc-pan-t">${t}${sub ? ` <span class="tiny muted" style="font-weight:500">· ${sub}</span>` : ''}</div>${inner}</div>`;
const tabela = (cab, linhas) => `<div style="overflow-x:auto;margin-top:10px"><table><thead><tr>${cab.map((c, i) => `<th style="text-align:${i ? 'right' : 'left'}">${c}</th>`).join('')}</tr></thead><tbody>${linhas.join('') || `<tr><td colspan="${cab.length}" class="tiny muted">sem dados no período</td></tr>`}</tbody></table></div>`;
const corH = h => (h == null ? 'var(--border-2)' : h <= 1 ? OK : h <= 4 ? WARN : ERR);

export function controleHTML(team) {
  const aviso = team && team !== 'conquista'
    ? `<div class="alert alert-warn tiny" style="margin-top:12px">Esta aba cobre só o <b>Funil Conquista</b> (o filtro de equipe não se aplica aqui).</div>` : '';
  return `${aviso}<div id="gc-ctl" style="margin-top:4px">${_d ? corpo() : _err ? `<div class="alert alert-err tiny" style="margin-top:12px">${esc(_err)}</div>` : '<div class="muted tiny" style="margin-top:12px"><span class="spinner"></span> Calculando o controle da Conquista (atendimento, cadência, follow-up, pastas e pós-visita)…</div>'}</div>`;
}

export async function controleLoad(since, until, fresh) {
  const key = since + ':' + until;
  if (!fresh && _d && _key === key) return;
  if (_loading) return;
  _loading = true; _err = '';
  if (_key !== key) _d = null;
  try {
    _d = await api.request(`/api/v3/oo/controle?since=${since}&until=${until}${fresh ? '&fresh=1' : ''}`);
    _key = key;
  } catch (e) { _err = e.message || String(e); _d = null; }
  _loading = false;
  const box = document.getElementById('gc-ctl');
  if (box) box.innerHTML = _d ? corpo() : `<div class="alert alert-err tiny" style="margin-top:12px">${esc(_err)}</div>`;
}

/* resumo compacto pro 🧠 Sr. Performance */
export function controleResumo() {
  if (!_d) return null;
  const { atendimento: a, cadencia: c, followup: f, pastas: p, pos_visita: v } = _d;
  return { primeiro_atendimento: a.equipe, por_horario: a.por_horario, cadencia: c.equipe, followup: f.equipe, pastas: { entraram: p.entraram, desfecho: p.desfecho, dias_ate_venda: p.dias_ate_venda_med, credito_registrado_no_rd: p.campos_credito_no_rd }, pos_visita: v.equipe };
}

function corpo() {
  const d = _d;
  const cab = `<div class="tiny muted" style="margin-top:12px">🏠 ${esc(d.escopo)} · ${esc(d.janela.since)} → ${esc(d.janela.until)}${d.cached ? ' · cache 10 min' : ''}</div>`;
  return cab + blocoAtendimento(d.atendimento) + blocoCadencia(d.cadencia) + blocoFollowup(d.followup) + blocoPastas(d.pastas) + blocoPosVisita(d.pos_visita);
}

/* ⏱ 1º ATENDIMENTO */
function blocoAtendimento(a) {
  const e = a.equipe || {};
  const kp = `<div class="gc-kpis">
    ${kpi('Mediana até o 1º atendimento', hh(e.med_h), `horas corridas · meta: 5 min`, corH(e.med_util_h))}
    ${kpi('Mediana em horas úteis', hh(e.med_util_h), 'seg–sex 8h–19h · sáb 8h–13h', corH(e.med_util_h))}
    ${kpi('Atendidos em até 1h útil', pc(e.pct_1h_util), `${fN(e.n)} leads de tráfego/Marketplace`, (e.pct_1h_util || 0) >= 80 ? OK : (e.pct_1h_util || 0) >= 50 ? WARN : ERR)}
    ${kpi('Esperaram mais de 24h', pc(e.pct_24h), 'horas corridas', (e.pct_24h || 0) <= 5 ? OK : (e.pct_24h || 0) <= 15 ? WARN : ERR)}
    ${kpi('Em Novo atendimento agora', fN(a.novo_agora), a.novo_agora ? `${fN(a.novo_agora_mais_1h)} há mais de 1h · ${a.novo_por_dono.map(([n, q]) => nome(n) + ' ' + q).join(', ')}` : 'nenhum lead esperando', (a.novo_agora_mais_1h || 0) ? ERR : OK)}
  </div>`;
  const lin = (a.por_corretor || []).map(r => `<tr><td>${nome(r.nome)}</td>${num(r.n)}<td style="text-align:right;font-weight:700;color:${corH(r.med_util_h)}">${hh(r.med_h)}</td><td style="text-align:right">${hh(r.med_util_h)}</td><td style="text-align:right">${pc(r.pct_1h_util)}</td><td style="text-align:right;color:${(r.pct_24h || 0) > 15 ? ERR : 'inherit'}">${pc(r.pct_24h)}</td></tr>`);
  const hor = (a.por_horario || []).map(r => `<tr><td>${esc(r.faixa)}</td>${num(r.n)}<td style="text-align:right;font-weight:700;color:${corH(r.med_util_h)}">${hh(r.med_h)}</td><td style="text-align:right">${pc(r.pct_1h_util)}</td></tr>`);
  return sec('⏱ 1º atendimento', 'leads que entraram no período',
    kp + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      <div>${tabela(['Corretor', 'Leads', 'Mediana', 'Mediana útil', 'Até 1h útil', '+24h'], lin)}</div>
      <div>${tabela(['Quando o lead chegou', 'Leads', 'Mediana', 'Até 1h útil'], hor)}</div></div>`
    + nota('Tempo entre o lead entrar no RD e o card sair de "Novo atendimento". Inclui a espera pela distribuição. Se o corretor chamou antes de mover o card, o tempo real foi menor — mover o card na hora é parte da regra.'));
}

/* 📞 CADÊNCIA DE TENTATIVA DE CONTATO */
function blocoCadencia(c) {
  const e = c.equipe || {}, r = c.regra || {};
  const kp = `<div class="gc-kpis">
    ${kpi('Em tentativa de contato', fN(e.tdc_abertos), 'abertos agora', 'var(--border-2)')}
    ${kpi('Sem próxima tarefa', fN(e.sem_tarefa), 'lead sem data de nova tentativa', e.sem_tarefa ? ERR : OK)}
    ${kpi('Tarefa atrasada', fN(e.atrasada), 'tentativa agendada que passou', e.atrasada ? ERR : OK)}
    ${kpi(`Parados há +${r.parado_dias || 5} dias`, fN(e.parado_5d), 'sem sair da tentativa de contato', e.parado_5d ? WARN : OK)}
    ${kpi('Descartados sem contato', fN(e.sem_contato), `de ${fN(e.perdidos)} perdidos no período`, e.sem_contato ? ERR : OK)}
    ${kpi(`Descartados com menos de ${r.tentativas || 6} tentativas`, fN(e.irregular), `${fN(e.sem_registro)} sem nenhuma tentativa registrada`, e.irregular ? ERR : OK)}
  </div>`;
  const lin = (c.por_corretor || []).map(x => `<tr><td>${nome(x.nome)}</td>${num(x.tdc_abertos)}${bad(x.sem_tarefa)}${bad(x.atrasada)}${bad(x.parado_5d)}${num(x.perdidos)}${bad(x.sem_contato)}${bad(x.sem_registro)}${bad(x.curioso_sem_qualif)}${bad(x.outros)}${bad(x.nao_atendeu_sem_6)}</tr>`);
  return sec('📞 Cadência de tentativa de contato', `regra: ${r.tentativas || 6} tentativas registradas antes de descartar`,
    kp + tabela(['Corretor', 'Em tentativa', 'Sem tarefa', 'Atrasada', `+${r.parado_dias || 5}d`, 'Perdidos', 'Sem contato', 'Sem tentativa registrada', '"Curioso" sem qualificar', '"Outros"', '"Não atendeu" < 6'], lin)
    + nota('Perdidos = fechados como perdidos no período (qualquer data de entrada). "Sem contato" = perdido em Novo atendimento ou Tentativa de contato. As tentativas vêm do campo "Nº tentativa de contato" do RD — enquanto ele não for preenchido, todo descarte aparece como irregular.'));
}

/* 🔁 FOLLOW-UP */
function blocoFollowup(f) {
  const e = f.equipe || {};
  const pctDia = e.abertos ? Math.round(e.em_dia / e.abertos * 100) : null;
  const kp = `<div class="gc-kpis">
    ${kpi('Cards em acompanhamento', fN(e.abertos), 'qualificação → pasta, abertos agora', 'var(--border-2)')}
    ${kpi('Em dia', pc(pctDia), `${fN(e.em_dia)} com tarefa futura e dentro do prazo`, (pctDia || 0) >= 90 ? OK : (pctDia || 0) >= 70 ? WARN : ERR)}
    ${kpi('Sem próxima tarefa', fN(e.sem_tarefa), 'ninguém sabe quando é o próximo contato', e.sem_tarefa ? ERR : OK)}
    ${kpi('Tarefa atrasada', fN(e.atrasada), 'follow-up marcado que não foi feito', e.atrasada ? ERR : OK)}
    ${kpi('Prazo da etapa estourado', fN(e.estourado), 'dias sem atividade acima do limite', e.estourado ? WARN : OK)}
  </div>`;
  const et = (f.por_etapa || []).map(x => `<tr><td>${esc(x.etapa)}</td><td style="text-align:right">${x.sla_dias} d</td>${num(x.abertos)}${bad(x.sem_tarefa)}${bad(x.atrasada)}${bad(x.estourado)}<td style="text-align:right;color:${OK}">${fN(x.em_dia)}</td></tr>`);
  const co = (f.por_corretor || []).map(x => `<tr><td>${nome(x.nome)}</td>${num(x.abertos)}${bad(x.sem_tarefa)}${bad(x.atrasada)}${bad(x.estourado)}<td style="text-align:right;color:${OK}">${x.abertos ? Math.round(x.em_dia / x.abertos * 100) + '%' : '—'}</td></tr>`);
  return sec('🔁 Follow-up', 'retrato de agora',
    kp + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px">
      <div>${tabela(['Etapa', 'Prazo sem contato', 'Abertos', 'Sem tarefa', 'Atrasada', 'Estourado', 'Em dia'], et)}</div>
      <div>${tabela(['Corretor', 'Abertos', 'Sem tarefa', 'Atrasada', 'Estourado', '% em dia'], co)}</div></div>`
    + nota('Regra: nenhum card aberto sem próxima tarefa com data. "Prazo estourado" = dias desde a última atividade no RD acima do limite da etapa. Reativação fica fora (é base, não acompanhamento)' + (f.reativacao_abertos != null ? ` — ${fN(f.reativacao_abertos)} cards lá hoje.` : '.')));
}

/* 📂 PASTAS */
function blocoPastas(p) {
  const d = p.desfecho || {};
  const tot = p.entraram || 0;
  const pp = v => (tot ? Math.round((v || 0) / tot * 100) + '%' : '—');
  const cr = p.credito || {};
  const credito = p.campos_credito_no_rd
    ? `<div class="gc-kpis">
        ${kpi('Aprovado', pp(cr.aprovado), fN(cr.aprovado || 0) + ' pastas', OK)}
        ${kpi('Condicionado', pp(cr.condicionado), fN(cr.condicionado || 0) + ' pastas', WARN)}
        ${kpi('Reprovado', pp(cr.reprovado), fN(cr.reprovado || 0) + ' pastas', ERR)}
        ${kpi('Sem resultado registrado', pp(cr.sem_registro), fN(cr.sem_registro || 0) + ' pastas', cr.sem_registro ? ERR : OK)}
        ${kpi('Dias até o retorno do banco', dd(p.dias_retorno_med), `mediana · ${fN(p.com_retorno_registrado)} com envio e retorno`, 'var(--gc-acc)')}
      </div>`
    : `<div class="alert alert-err" style="margin-top:10px;font-size:13px">
        <b>⚠️ O RD não registra o resultado do crédito.</b> Sem isso não dá para saber quantos dias o banco leva, nem quantas pastas aprovam, condicionam ou reprovam.
        Para os números aparecerem aqui sozinhos, criar no RD (negócio, etapa 📂 Aprovação/Proposta, obrigatórios):
        <b>Data de envio da pasta</b> · <b>Data de retorno do banco</b> · <b>Resultado do crédito</b> (Aprovado / Condicionado / Reprovado / Pendência de documento) · <b>Banco/correspondente</b> · <b>Condição aprovada</b>.
        E nos motivos de perda: <b>Crédito reprovado</b> e <b>Condicionado sem entrada</b>.</div>`;
  const barra = tot ? `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;margin-top:10px;font-size:11px;font-weight:700;color:#fff">
      ${[['venda', OK, 'venda'], ['perdida', ERR, 'perdida'], ['saiu_sem_desfecho', WARN, 'saiu sem desfecho'], ['na_etapa', 'var(--ink-muted)', 'na etapa']].filter(([k]) => d[k]).map(([k, c, l]) => `<div title="${l}: ${d[k]}" style="flex:${d[k]};background:${c};display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden">${l} ${d[k]}</div>`).join('')}
    </div>` : '';
  const kp = `<div class="gc-kpis">
    ${kpi('Pastas no período', fN(tot), 'entraram em 📂 Aprovação/Proposta', 'var(--gc-acc)')}
    ${kpi('Viraram venda', pp(d.venda), `${fN(d.venda || 0)} · mediana ${dd(p.dias_ate_venda_med)} até a venda`, OK)}
    ${kpi('Perdidas', pp(d.perdida), `${fN(d.perdida || 0)} · mediana ${dd(p.dias_ate_perda_med)} até a perda`, ERR)}
    ${kpi('Saíram sem desfecho', pp(d.saiu_sem_desfecho), `${fN(d.saiu_sem_desfecho || 0)} voltaram de etapa (reprovada? condicionada?)`, WARN)}
    ${kpi('Em aprovação agora', fN(p.em_aprovacao_agora), `${fN((p.paradas || []).filter(x => (x.dias || 0) > 15).length)} há mais de 15 dias`, (p.paradas || []).some(x => (x.dias || 0) > 15) ? ERR : OK)}
  </div>`;
  const par = (p.paradas || []).map(x => `<tr><td>${nome(x.nome)}</td><td style="text-align:right;font-weight:700;color:${(x.dias || 0) > 15 ? ERR : (x.dias || 0) > 7 ? WARN : OK}">${x.dias == null ? '—' : x.dias + ' d'}</td><td style="text-align:right"><a href="https://crm.rdstation.com/app/deals/${esc(x.id)}" target="_blank" rel="noopener">abrir no RD ↗</a></td></tr>`);
  const co = (p.por_corretor || []).map(x => `<tr><td>${nome(x.nome)}</td>${num(x.entraram)}<td style="text-align:right;color:${OK}">${fN(x.venda)}</td><td style="text-align:right;color:${ERR}">${fN(x.perdida)}</td><td style="text-align:right;color:${WARN}">${fN(x.saiu_sem_desfecho)}</td>${num(x.na_etapa)}</tr>`);
  return sec('📂 Pastas · aprovação de crédito', 'pastas que entraram no período e o que aconteceu',
    kp + barra + credito + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      <div>${tabela(['Corretor', 'Pastas', 'Venda', 'Perdida', 'Saiu sem desfecho', 'Na etapa'], co)}</div>
      <div>${tabela(['Pasta parada agora (dono)', 'Dias na etapa', ''], par)}</div></div>`
    + nota('Pasta = card que entrou em 📂 Aprovação/Proposta. "Saiu sem desfecho" = voltou para outra etapa sem venda nem perda — hoje é onde se escondem as reprovadas e condicionadas.'));
}

/* 🏁 PÓS-VISITA */
function blocoPosVisita(v) {
  const e = v.equipe || {};
  const kp = `<div class="gc-kpis">
    ${kpi('Visitas realizadas', fN(e.visitas), 'no período', 'var(--gc-acc)')}
    ${kpi('Viraram venda', fN(e.venda), e.visitas ? Math.round(e.venda / e.visitas * 100) + '% das visitas' : '', OK)}
    ${kpi('Ainda abertas', fN(e.aberta), 'em negociação / pasta', 'var(--border-2)')}
    ${kpi('Perdidas', fN(e.perdida), '', e.perdida ? ERR : OK)}
    ${kpi('Perdidas para concorrente', fN(e.concorrente), '"Fechou com outra empresa"', e.concorrente ? ERR : OK)}
    ${kpi('Perdidas com motivo genérico', fN(e.generico), 'curioso / outros / sumiu / sem perfil — pode esconder concorrente', e.generico ? WARN : OK)}
  </div>`;
  const mot = (v.motivos || []).map(([m, n]) => `<tr><td>${esc(m)}</td>${num(n)}</tr>`);
  const co = (v.por_corretor || []).map(x => `<tr><td>${nome(x.nome)}</td>${num(x.visitas)}<td style="text-align:right;color:${OK}">${fN(x.venda)}</td>${num(x.aberta)}<td style="text-align:right;color:${ERR}">${fN(x.perdida)}</td>${bad(x.concorrente)}${bad(x.generico)}</tr>`);
  return sec('🏁 Depois da visita', 'visitas realizadas no período e o desfecho',
    kp + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      <div>${tabela(['Corretor', 'Visitas', 'Venda', 'Aberta', 'Perdida', 'Concorrente', 'Motivo genérico'], co)}</div>
      <div>${tabela(['Motivo da perda após visita', 'Qtd'], mot)}</div></div>`
    + nota('Cliente que visitou não é "curioso". Perda depois da visita tem que dizer o porquê: concorrente (qual), crédito, produto ou preço.'));
}
