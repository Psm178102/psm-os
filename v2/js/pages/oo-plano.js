/* PSM-OS v2 — 🧭 1:1 novo (v89.4): Resultado no trimestre · Atividade por canal · Gargalo da fase.
   Metodologia aprovada pelo Paulo em 30/09/2026 (protótipo claude.ai/artifact/P6yT6GoAUd7SSc2c8RXgid).
   Dados: GET/POST /api/v3/oo/plano. O gestor edita o plano de canais (mín. 3 canais — regra da PSM)
   e a data de início da fase; o corretor só vê. */
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const n2 = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const brl = (v) => {
  const x = Number(v) || 0;
  if (x >= 1e6) return 'R$ ' + (x / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
  if (x >= 1e3) return 'R$ ' + (x / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + n0(x);
};
const dBR = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesNome = (ym) => MESES[Number(ym.slice(5, 7)) - 1] + ' de ' + ym.slice(0, 4);
const ymAdd = (ym, k) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

const IC = {
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};
const PILL = { ok: ['ok', 'Na meta'], warn: ['warn', 'Entre mínimo e meta'], err: ['err', 'Abaixo do mínimo'], futuro: ['info', 'Mês não começou'] };
const pill = (st, txt) => { const [c, t] = PILL[st] || ['info', st]; return `<span class="hp-pill hp-pill--${c}">${esc(txt || t)}</span>`; };
const label = (t) => `<div class="hp-kpi__label">${esc(t)}</div>`;
const secao = (n, t, sub) => `<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:22px 0 10px"><h3 style="margin:0;font:600 20px/28px var(--font-sans)">${n}. ${esc(t)}</h3><span style="font-size:13px;color:var(--ink-muted)">${esc(sub)}</span></div>`;

let _st = { host: null, cid: '', ym: '', selfView: false, r: null, onReuniao: null };

export async function montarPlanoOO(host, { corretorId, selfView, ym, onReuniao }) {
  if (!host) return;
  const hoje = new Date();
  _st = { host, cid: corretorId, selfView: !!selfView, onReuniao,
    ym: ym || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`, r: null };
  await carregar();
}

async function carregar() {
  const { host, cid, ym } = _st;
  host.innerHTML = `<div class="hp-card"><span class="spinner"></span> <span class="tiny muted">Calculando resultado, canais e funil…</span></div>`;
  try {
    _st.r = await api.request(`/api/v3/oo/plano?corretor_id=${encodeURIComponent(cid)}&ym=${ym}`);
  } catch (e) {
    host.innerHTML = `<div class="hp-notice hp-notice--err">${IC.alert}<div><b>Não consegui calcular o 1:1</b><span>${esc(e.message)}</span></div></div>`;
    return;
  }
  render();
}

function render() {
  const r = _st.r, sv = _st.selfView;
  if (!r || !r.ok) { _st.host.innerHTML = `<div class="hp-notice hp-notice--err">${IC.alert}<div><b>Sem dados</b><span>${esc(r?.error || '')}</span></div></div>`; return; }
  const primeiro = String(r.corretor?.name || '').split(' ')[0];
  const fase = r.fase || {};
  const avisos = (r.avisos || []).map(a => `<div class="hp-notice hp-notice--warn" style="margin-top:8px">${IC.alert}<div><b>${a.tipo === 'vgv' ? 'A meta de VGV não acompanha o plano' : 'Atenção'}</b><span>${esc(a.txt)}</span></div></div>`).join('');
  _st.host.innerHTML = `
    <div class="hp-card" style="padding:18px 20px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div class="hp-kpi__label">1:1 · plano de ${esc(mesNome(r.ym))}</div>
          <div style="font-size:13px;color:var(--ink-2);margin-top:2px">Fase atual: <b>${esc((fase.equipe || '').toUpperCase() || '—')}</b> desde ${fase.desde ? esc(fase.desde.split('-').reverse().join('/')) : '—'}${fase.definida ? '' : ' <span class="hp-pill hp-pill--warn">não definida</span>'} · conversões medidas só nesta fase</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="hp-btn hp-btn--sm" data-pl-mes="-1" aria-label="Mês anterior">‹</button>
          <span style="font:600 13px var(--font-sans);min-width:120px;text-align:center">${esc(mesNome(r.ym))}</span>
          <button class="hp-btn hp-btn--sm" data-pl-mes="1" aria-label="Próximo mês">›</button>
          ${sv ? '' : '<button class="hp-btn hp-btn--sm hp-btn--primary" id="pl-edit">Ajustar plano</button>'}
        </div>
      </div>
      ${avisos}
      ${r.read_fail ? `<div class="hp-notice hp-notice--warn" style="margin-top:8px">${IC.alert}<div><b>Leitura parcial do banco</b><span>Alguns números podem estar incompletos. Recarregue em alguns minutos.</span></div></div>` : ''}
      ${secao(1, 'Resultado', 'Julgado no trimestre. A meta é só a da aba Metas.')}
      ${blocoResultado(r.resultado)}
      ${secao(2, 'Atividade', sv ? 'De onde vêm as suas vendas e o que fazer na semana.' : 'De onde vêm as vendas e o que ' + primeiro + ' precisa fazer na semana.')}
      ${blocoCanais(r)}
      ${blocoFunil(r)}
      ${secao(3, 'Gargalo', 'Onde o funil da fase atual perde mais, contra a referência de mercado.')}
      ${blocoGargalo(r)}
      <div id="pl-log" style="margin-top:10px"></div>
    </div>
    <div id="pl-modal"></div>`;
  _st.host.querySelectorAll('[data-pl-mes]').forEach(b => b.addEventListener('click', () => { _st.ym = ymAdd(_st.ym, Number(b.dataset.plMes)); carregar(); }));
  _st.host.querySelector('#pl-edit')?.addEventListener('click', abrirEditor);
  _st.host.querySelector('#pl-reuniao')?.addEventListener('click', () => _st.onReuniao && _st.onReuniao());
  _st.host.querySelector('#pl-plano-novo')?.addEventListener('click', abrirEditor);
  _st.host.querySelector('#pl-verlog')?.addEventListener('click', () => {
    const b = _st.host.querySelector('#pl-log');
    b.innerHTML = b.innerHTML ? '' : changelog(r.plano?.changelog);
  });
}

function blocoResultado(t) {
  if (!t) return '';
  const pv = t.meta_vgv > 0 ? t.real_vgv / t.meta_vgv * 100 : null;
  const decorrido = t.dias_tri ? t.dias_passados / t.dias_tri : 1;
  const ritmo = pv == null ? null : (pv / 100) >= decorrido ? 'ok' : (pv / 100) >= decorrido * 0.7 ? 'warn' : 'err';
  const fx = t.faixa;
  const vendasTxt = (t.vendas || []).map(v => `${brl(v.vgv)} em ${dBR(v.data)}${v.funil ? ' (' + esc(v.funil) + ')' : ''}`).join(' · ');
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
    <div class="hp-kpi">${label('VGV · ' + t.tri)}
      <div class="hp-kpi__value">${brl(t.real_vgv)}</div>
      <div class="hp-kpi__foot">${t.meta_vgv > 0 ? `de ${brl(t.meta_vgv)} · <b style="color:var(--${ritmo === 'ok' ? 'ok' : ritmo === 'warn' ? 'warn' : 'err'})">${n0(pv)}%</b>` : 'sem meta de VGV na aba Metas'}</div>
      ${t.meta_vgv > 0 ? `<div class="hp-kpi__bar"><i style="width:${Math.min(100, pv)}%;background:var(--${ritmo === 'ok' ? 'ok' : ritmo === 'warn' ? 'warn' : 'err'})"></i></div>
      <div style="margin-top:6px">${pill(ritmo, ritmo === 'ok' ? 'No ritmo do trimestre' : ritmo === 'warn' ? 'Um pouco abaixo do ritmo' : 'Abaixo do ritmo')} <span class="tiny muted">${n0(decorrido * 100)}% do trimestre passou</span></div>` : ''}
    </div>
    <div class="hp-kpi">${label('Vendas · ' + t.tri)}
      <div class="hp-kpi__value">${n0(t.real_vendas)}${t.meta_vendas ? ` <span style="font-size:20px;color:var(--ink-muted)">de ${n2(t.meta_vendas)}</span>` : ''}</div>
      <div class="hp-kpi__foot" style="white-space:normal">${vendasTxt || 'Nenhuma venda no trimestre ainda.'}</div>
      ${t.fonte_meta_vendas ? `<div class="tiny muted">Meta de vendas: ${esc(t.fonte_meta_vendas)}</div>` : ''}
    </div>
    <div class="hp-kpi" style="background:var(--surface-2)">${label('Faixa normal no trimestre')}
      <div class="hp-kpi__value">${fx ? `${fx.lo} a ${fx.hi}` : '—'}</div>
      <div style="font-size:13px;line-height:19px;color:var(--ink-2)">${fx ? `Com meta de ${n2(t.meta_vendas)} vendas, terminar o trimestre com ${fx.lo > 0 ? (fx.lo - 1) + ' ou menos' : '0'} é alerta de verdade. Venda de um mês só é sorte ou azar; o trimestre mostra o trabalho.` : 'Sem meta de vendas para o trimestre.'}</div>
    </div>
  </div>`;
}

function blocoCanais(r) {
  const p = r.plano;
  if (!p) {
    return `<div class="hp-notice hp-notice--warn">${IC.alert}<div><b>Sem plano de canais para ${esc(mesNome(r.ym))}</b>
      <span>O plano diz quantas vendas se espera de cada canal (no mínimo 3 canais) e daí sai o volume que precisa entrar por semana.${_st.selfView ? ' Seu gestor define no 1:1.' : ''}</span>
      ${_st.selfView ? '' : '<div style="margin-top:8px"><button class="hp-btn hp-btn--sm hp-btn--primary" id="pl-plano-novo">Definir plano do mês</button></div>'}</div></div>`;
  }
  const regraOk = p.canais_ativos >= p.min_canais;
  const futuro = p.corrido_pct === 0;
  const banner = futuro
    ? `<div class="hp-notice" style="border-radius:0">${IC.info}<div><b>Plano com ${p.canais.length} canais</b><span>Regra da PSM: ninguém depende de menos de ${p.min_canais} canais. A contagem de canais ativos começa quando o mês começar.</span></div></div>`
    : `<div class="hp-notice hp-notice--${regraOk ? 'ok' : 'err'}" style="border-radius:0">${regraOk ? IC.info : IC.alert}<div><b>Canais ativos: ${p.canais_ativos} de no mínimo ${p.min_canais}</b><span>Canal ativo = está pelo menos no mínimo esperado até hoje (${n0(p.corrido_pct)}% do mês). Regra da PSM: ninguém depende de menos de ${p.min_canais} canais.</span></div></div>`;
  const conv = (c) => `${n2(c.conv_pct)}% <span class="hp-pill hp-pill--${c.conv_fonte === 'medida' ? 'ok' : 'warn'}" title="${c.conv_fonte === 'medida' ? `${c.amostra_vendas} vendas em ${c.amostra} negócios da fase já maduros` : `estimada pelo gestor — vira medida com ${50} negócios maduros no canal (tem ${c.amostra})`}">${c.conv_fonte}</span>`;
  const linhas = p.canais.map(c => `<tr>
      <td><b>${esc(c.label)}</b><div class="tiny muted">${esc(c.desc)}</div></td>
      <td class="num">${n2(c.vendas)}</td>
      <td class="num" style="white-space:nowrap">${conv(c)}</td>
      <td class="num">${n0(c.min_mes)}</td>
      <td class="num"><b>${n0(c.meta_mes)}</b></td>
      <td class="num"><b>${n0(c.meta_sem)}</b></td>
      <td class="num"><b>${n0(c.real_mes)}</b></td>
      <td class="num muted">${n0(c.mes_anterior)}</td>
      <td>${pill(c.status)}</td>
    </tr>`).join('');
  const t = p.total;
  const fora = (p.fora_plano || []).length ? `<div class="tiny" style="color:var(--ink-2)"><b>Entradas fora do plano neste mês:</b> ${p.fora_plano.map(f => `${esc(f.label)} (${f.real_mes})`).join(', ')}.</div>` : '';
  return `<div class="hp-table-wrap">
    <div style="padding:12px 14px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--border)">
      <div><div style="font:600 16px/24px var(--font-sans)">Plano de canais · ${esc(mesNome(r.ym))}${p.herdado ? ` <span class="hp-pill hp-pill--info">copiado de ${esc(mesNome(p.ym_origem))}</span>` : ''}</div>
        <div style="font-size:13px;color:var(--ink-2)">${n2(p.vendas_min)} a ${n2(p.vendas_meta)} vendas no mês${p.ticket ? ` · ticket ${brl(p.ticket)}` : ''}. Entrada necessária = vendas do canal ÷ conversão do canal.</div></div>
      ${(p.changelog || []).length && !_st.selfView ? '<button class="hp-btn hp-btn--sm hp-btn--ghost" id="pl-verlog">O que mudou?</button>' : ''}
    </div>
    ${banner}
    <table class="hp-table">
      <thead><tr><th>Canal</th><th class="num">Vendas no plano</th><th class="num">Conversão</th><th class="num">Mínimo/mês</th><th class="num">Meta/mês</th><th class="num">Meta/semana</th><th class="num">No mês</th><th class="num">Mês passado</th><th>Situação</th></tr></thead>
      <tbody>${linhas}
        <tr style="background:var(--surface-2)"><td><b>Total</b></td><td class="num"><b>${n2(t.vendas)}</b></td><td></td><td class="num">${n0(t.min_mes)}</td><td class="num"><b>${n0(t.meta_mes)}</b></td><td class="num"><b>${n0(t.meta_sem)}</b></td><td class="num"><b>${n0(t.real_mes)}</b></td><td class="num muted">${n0(t.mes_anterior)}</td><td></td></tr>
      </tbody>
    </table>
    <div style="padding:10px 14px;background:var(--surface-2);border-top:1px solid var(--border);display:grid;gap:4px">
      <div class="tiny" style="color:var(--ink-2)"><b>Medida</b> = conversão real no canal, com os negócios desta fase que já tiveram tempo de fechar (${r.jornada_dias} dias). <b>Estimada</b> = número que o gestor definiu, até o canal ter 50 negócios maduros.</div>
      <div class="tiny" style="color:var(--ink-2)">Indicação, carteira e reativação só contam se o negócio for criado no RD com essa origem.</div>
      ${fora}
    </div>
  </div>`;
}

function blocoFunil(r) {
  const f = r.funil_semana;
  if (!f || !(f.linhas || []).length) return '';
  const ref = f.ref || {};
  return `<div class="hp-table-wrap" style="margin-top:12px">
    <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
      <div style="font:600 16px/24px var(--font-sans)">Funil da semana · ${dBR(f.since)} a ${dBR(f.until)} · todos os canais</div>
      <div style="font-size:13px;color:var(--ink-2)">O necessário para as ${n2(r.plano?.vendas_meta)} vendas do plano com a conversão de referência (agendamento → visita ${n0(ref.visita)}%, visita → proposta ${n0(ref.proposta)}%, proposta → venda ${n2(ref.venda)}%).</div>
    </div>
    <table class="hp-table">
      <thead><tr><th>Etapa</th><th class="num">Meta da semana</th><th class="num">Na semana</th><th class="num">Meta do mês</th><th>Situação</th></tr></thead>
      <tbody>${f.linhas.map(l => `<tr><td><b>${esc(l.label)}</b></td><td class="num"><b>${n0(l.meta_sem)}</b></td><td class="num"><b>${n0(l.real_sem)}</b></td><td class="num muted">${n0(l.meta_mes)}</td><td>${pill(l.status, l.status === 'ok' ? 'No ritmo' : l.status === 'warn' ? 'Atenção' : 'Abaixo')}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function blocoGargalo(r) {
  const g = r.gargalo, c = r.coorte;
  const passos = (r.passos || []).map(p => `<tr>
      <td>${esc(p.label)}</td>
      <td class="num">${p.de} → ${p.para}</td>
      <td class="num"><b style="color:var(--${p.taxa_pct == null ? 'ink-muted' : p.taxa_pct >= p.ref_pct ? 'ok' : 'err'})">${p.taxa_pct == null ? '—' : n0(p.taxa_pct) + '%'}</b></td>
      <td class="num muted">${n0(p.ref_pct)}%</td>
      <td>${p.amostra_ok ? '' : '<span class="tiny muted">amostra pequena</span>'}</td>
    </tr>`).join('');
  const destaque = g ? `<div class="hp-kpi" style="border-color:var(--err)">
      ${label('Maior perda desde ' + dBR(r.fase?.desde || ''))}
      <div style="font:600 16px/24px var(--font-sans)">${esc(g.label)}</div>
      <div style="display:flex;gap:18px;align-items:baseline">
        <div><div class="hp-kpi__value" style="color:var(--err)">${n0(g.taxa_pct)}%</div><div class="tiny muted">${esc(String(r.corretor?.name || '').split(' ')[0])}</div></div>
        <div><div style="font:600 20px/28px var(--font-sans);color:var(--ink-2)">${n0(g.ref_pct)}%</div><div class="tiny muted">referência</div></div>
      </div>
      <div style="font-size:13px;line-height:19px;color:var(--ink-2)">${g.de} negócios chegaram à etapa anterior e só ${g.para} passaram. ${g.key === 'visita' ? 'Antes de cobrar, confira se as visitas acontecem e não são registradas no RD (tarefa de visita concluída no dia).' : 'É o assunto número 1 do 1:1.'}</div>
      ${_st.selfView ? '' : '<div style="margin-top:6px"><button class="hp-btn hp-btn--sm hp-btn--primary" id="pl-reuniao">Registrar combinados na reunião 1:1</button></div>'}
    </div>`
    : `<div class="hp-notice">${IC.info}<div><b>Sem gargalo claro ainda</b><span>${c && c.entrada ? 'Nenhuma passagem com amostra suficiente (10+ negócios) está abaixo da referência.' : 'A fase ainda não tem negócios suficientes. O gargalo aparece depois de uns 30 dias de dados.'}</span></div></div>`;
  return `<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:12px;align-items:start">
    ${destaque}
    <div class="hp-table-wrap">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;color:var(--ink-2)">Negócios que entraram desde ${dBR(r.fase?.desde || '')}${c ? ` (${c.entrada})` : ''}, cada um na etapa mais avançada que atingiu. Os mais novos ainda estão andando.</div>
      <table class="hp-table"><thead><tr><th>Passagem</th><th class="num">Negócios</th><th class="num">Conversão</th><th class="num">Referência</th><th></th></tr></thead><tbody>${passos}</tbody></table>
    </div>
  </div>`;
}

function changelog(log) {
  if (!(log || []).length) return '';
  return `<div class="hp-table-wrap"><table class="hp-table"><thead><tr><th>Quem</th><th>Quando</th><th>O que mudou</th></tr></thead><tbody>${log.map(e => `<tr>
    <td>${esc(e.quem)}</td><td class="muted">${e.quando ? new Date(e.quando).toLocaleString('pt-BR') : ''}</td>
    <td>${(e.mudancas || []).map(m => `${esc(m.campo)}: ${m.de == null ? '' : `<s>${esc(String(m.de))}</s> → `}<b>${esc(String(m.para ?? '—'))}</b>`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ── editor do plano (gestor) ── */
function abrirEditor() {
  const r = _st.r, p = r.plano;
  const atual = {};
  (p?.canais || []).forEach(c => { atual[c.canal] = { vendas: c.vendas, conv: c.conv_estimada_pct || c.conv_pct }; });
  const linhas = (r.canais_disponiveis || []).map(c => {
    const a = atual[c.canal] || {};
    return `<tr>
      <td><label for="pl-v-${c.canal}"><b>${esc(c.label)}</b></label><div class="tiny muted">${esc(c.desc)}</div></td>
      <td><input class="hp-input" style="width:90px" type="number" min="0" step="0.05" id="pl-v-${c.canal}" data-v="${c.canal}" value="${a.vendas ?? ''}" placeholder="0"></td>
      <td><input class="hp-input" style="width:90px" type="number" min="0" max="100" step="0.01" id="pl-c-${c.canal}" data-c="${c.canal}" value="${a.conv ?? ''}" placeholder="%" aria-label="Conversão estimada de ${esc(c.label)} em %"></td>
    </tr>`;
  }).join('');
  const m = document.getElementById('pl-modal');
  m.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:28px 12px;overflow:auto" id="pl-ov">
    <div class="hp-card" style="max-width:720px;width:100%;box-shadow:var(--shadow-3);border-radius:var(--radius-lg);padding:20px" role="dialog" aria-modal="true" aria-labelledby="pl-tit">
      <h3 id="pl-tit" style="margin:0 0 4px;font:600 20px/28px var(--font-sans)">Plano de canais · ${esc(mesNome(r.ym))}</h3>
      <div style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Quantas vendas você espera de cada canal neste mês e a conversão estimada (lead → venda). Preencha pelo menos 3 canais. Canal em branco fica fora do plano.</div>
      <div class="hp-table-wrap"><table class="hp-table"><thead><tr><th>Canal</th><th>Vendas no mês</th><th>Conversão %</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px">
        <div class="hp-field"><label for="pl-min">Mínimo de vendas no mês</label><input class="hp-input" type="number" min="0" step="0.5" id="pl-min" value="${p?.vendas_min ?? ''}"><span class="hp-field__hint">Em branco = igual à soma do plano</span></div>
        <div class="hp-field"><label for="pl-tk">Ticket médio (R$)</label><input class="hp-input" type="number" min="0" step="1000" id="pl-tk" value="${p?.ticket || ''}"><span class="hp-field__hint">Usado para conferir a meta de VGV da aba Metas</span></div>
        <div class="hp-field"><label for="pl-fase">Início da fase atual</label><input class="hp-input" type="date" id="pl-fase" value="${esc((r.fase?.desde || '').slice(0, 10))}"><span class="hp-field__hint">Mudou de equipe ou de produto? A conversão recomeça daqui.</span></div>
      </div>
      <div id="pl-soma" style="margin-top:10px;font-size:13px"></div>
      <div id="pl-erro" style="margin-top:8px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="hp-btn" id="pl-cancel">Cancelar</button>
        <button class="hp-btn hp-btn--primary" id="pl-save">Salvar plano</button>
      </div>
    </div></div>`;
  const soma = () => {
    let tot = 0, n = 0;
    m.querySelectorAll('[data-v]').forEach(i => { const v = Number(i.value) || 0; if (v > 0) { tot += v; n++; } });
    const el = m.querySelector('#pl-soma');
    el.innerHTML = `Soma do plano: <b>${n2(tot)} vendas</b> em <b>${n} canais</b> ${n >= 3 ? '<span class="hp-pill hp-pill--ok">regra dos 3 canais ok</span>' : '<span class="hp-pill hp-pill--err">mínimo de 3 canais</span>'}`;
  };
  m.querySelectorAll('input').forEach(i => i.addEventListener('input', soma));
  soma();
  const fechar = () => { m.innerHTML = ''; };
  m.querySelector('#pl-cancel').addEventListener('click', fechar);
  m.querySelector('#pl-ov').addEventListener('click', (e) => { if (e.target.id === 'pl-ov') fechar(); });
  m.querySelector('#pl-save').addEventListener('click', async () => {
    const btn = m.querySelector('#pl-save');
    const canais = [];
    m.querySelectorAll('[data-v]').forEach(i => {
      const v = Number(i.value) || 0;
      if (v > 0) canais.push({ canal: i.dataset.v, vendas: v, conv_pct: Number(m.querySelector(`[data-c="${i.dataset.v}"]`).value) || 0 });
    });
    const body = { corretor_id: _st.cid, ym: r.ym, plano: { canais, vendas_min: Number(m.querySelector('#pl-min').value) || null, ticket: Number(m.querySelector('#pl-tk').value) || 0 } };
    btn.disabled = true;
    try {
      await api.request('/api/v3/oo/plano', { method: 'POST', body });
      const f = m.querySelector('#pl-fase').value;
      if (f && f !== (r.fase?.desde || '').slice(0, 10)) {
        await api.request('/api/v3/oo/plano', { method: 'POST', body: { corretor_id: _st.cid, fase: { desde: f, equipe: r.corretor?.team } } });
      }
      fechar();
      carregar();
    } catch (e) {
      btn.disabled = false;
      m.querySelector('#pl-erro').innerHTML = `<div class="hp-notice hp-notice--err">${IC.alert}<div><b>Não salvou</b><span>${esc(e.message)}</span></div></div>`;
    }
  });
}
