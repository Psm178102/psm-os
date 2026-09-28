/* PSM-OS v2 — 🧪 Inteligência · Vendas · Turmas e funil por canal (v88.86)
   Dos negócios que ENTRARAM em cada mês (a "turma"): quantos chegaram a cada degrau do funil do RD e
   quantos viraram venda em 30/60/90 dias — por frente, por canal de origem e por corretor.
   Fonte: /api/v3/intel/turmas (uma consulta agregada no banco + cache). Só sócio.
   Leitura honesta: é a trajetória no RD. Na Conquista a esteira OFICIAL de etapas é a do PSM HUB
   (Dicionário §5) — aqui se comparam canais e turmas, não se substitui o número oficial do mês. */
import { api } from '../api.js';

let _root = null, _d = null, _meses = 6, _frente = 'todas';
const DEG = [['contato', 'Contato'], ['agendamento', 'Agend.'], ['visita', 'Visita'], ['proposta', 'Proposta'], ['vendas', 'Venda']];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => (b ? (a / b * 100) : null);
const fp = v => v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = ym => { const [y, m] = ym.split('-'); return `${MES[+m - 1]}/${y.slice(2)}`; };

export async function pageIntelTurmas(ctx, root) {
  _root = root;
  await load(false);
}

async function load(fresh) {
  _root.innerHTML = `<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Montando as turmas…</div></div>`;
  try {
    _d = await api.request(`/api/v3/intel/turmas?meses=${_meses}${fresh ? '&fresh=1' : ''}`);
    if (!_d || !_d.ok) throw new Error((_d && _d.error) || 'erro');
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Não consegui montar as turmas: ${esc(e.message)}</div>`;
    return;
  }
  render();
}

// célula de conversão com barra discreta
function cel(a, b, fraca) {
  const p = pct(a, b);
  if (p == null) return '<td class="muted" style="text-align:right">—</td>';
  return `<td style="text-align:right;${fraca ? 'color:var(--ink-muted)' : ''}" title="${a} de ${b}">
    <div style="font-weight:600">${fp(p)}</div><div class="tiny muted">${a}</div></td>`;
}

function render() {
  const fr = _frente;
  const turmas = (_d.turmas || []).filter(t => t.frente === fr).sort((a, b) => b.mes.localeCompare(a.mes));
  const canais = (_d.canais || []).filter(c => c.frente === fr && c.entraram > 0);
  const corr = (_d.corretores || []).filter(c => c.frente === fr && c.entraram > 0).slice(0, 25);
  const tot = turmas.reduce((a, t) => { ['entraram', 'visita', 'proposta', 'vendas', 'vgv'].forEach(k => a[k] = (a[k] || 0) + (t[k] || 0)); return a; }, {});
  const frentes = Object.entries(_d.frentes || {}).filter(([k]) => (_d.turmas || []).some(t => t.frente === k && t.entraram));
  const th = (t, al = 'right') => `<th style="padding:6px 8px;text-align:${al};font-size:11px;color:var(--ink-muted);white-space:nowrap">${t}</th>`;

  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h2 class="card-title">🧪 Turmas e funil por canal</h2>
          <p class="card-sub">Dos negócios que entraram em cada mês: até onde chegaram no funil e quantos viraram venda em 30, 60 e 90 dias.</p>
        </div>
        <select id="tu-meses" class="select" style="padding:5px 10px;font-size:12px">${[3, 6, 12].map(n => `<option value="${n}"${n === _meses ? ' selected' : ''}>últimos ${n} meses</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" id="tu-fresh" title="recalcular agora">🔄</button>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-sm ${fr === 'todas' ? 'btn-primary' : 'btn-ghost'}" data-fr="todas">Todas</button>
        ${frentes.map(([k, l]) => `<button class="btn btn-sm ${fr === k ? 'btn-primary' : 'btn-ghost'}" data-fr="${k}">${esc(l)}</button>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px">
        ${kpi('Entraram', (tot.entraram || 0).toLocaleString('pt-BR'), `desde ${nomeMes(_d.desde.slice(0, 7))}`)}
        ${kpi('Chegaram à visita', fp(pct(tot.visita || 0, tot.entraram)), `${tot.visita || 0} negócios`)}
        ${kpi('Chegaram à proposta', fp(pct(tot.proposta || 0, tot.entraram)), `${tot.proposta || 0} negócios`)}
        ${kpi('Viraram venda', fp(pct(tot.vendas || 0, tot.entraram)), `${tot.vendas || 0} vendas · ${brl(tot.vgv)}`)}
      </div>

      <h3 class="card-title" style="font-size:14px;margin-top:18px">📅 Turmas por mês de entrada</h3>
      <div class="tiny muted">% sobre quem entrou no mês. Venda em 30/60/90 dias só aparece quando a turma já teve esse tempo; antes disso fica em cinza (ainda amadurecendo).</div>
      <div style="overflow-x:auto;margin-top:6px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:760px">
          <thead><tr style="border-bottom:2px solid var(--border)">${th('Turma', 'left')}${th('Entraram')}${DEG.map(([, l]) => th(l)).join('')}${th('Venda ≤30d')}${th('≤60d')}${th('≤90d')}${th('VGV')}${th('Dias até vender')}</tr></thead>
          <tbody>${turmas.map(t => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:6px 8px;font-weight:600">${nomeMes(t.mes)}</td>
            <td style="text-align:right;font-weight:600">${t.entraram.toLocaleString('pt-BR')}</td>
            ${DEG.map(([k]) => cel(t[k], t.entraram)).join('')}
            ${cel(t.vendas_30, t.entraram, !t.maduro_30)}${cel(t.vendas_60, t.entraram, !t.maduro_60)}${cel(t.vendas_90, t.entraram, !t.maduro_90)}
            <td style="text-align:right;white-space:nowrap">${t.vgv ? brl(t.vgv) : '—'}</td>
            <td style="text-align:right">${t.dias_venda_medio != null ? t.dias_venda_medio.toLocaleString('pt-BR') + ' d' : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="14" class="muted" style="padding:12px">Sem negócios nesta frente no período.</td></tr>'}</tbody>
        </table>
      </div>

      <h3 class="card-title" style="font-size:14px;margin-top:18px">📣 Funil por canal de origem</h3>
      <div class="tiny muted">Categorias do Dicionário §2 (origem do cliente no RD). Mostra qual canal traz gente que avança — não só volume.</div>
      <div style="overflow-x:auto;margin-top:6px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
          <thead><tr style="border-bottom:2px solid var(--border)">${th('Canal', 'left')}${th('Entraram')}${DEG.map(([, l]) => th(l)).join('')}${th('VGV')}</tr></thead>
          <tbody>${canais.map(c => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:6px 8px;font-weight:600">${esc(c.canal_label)}</td>
            <td style="text-align:right;font-weight:600">${c.entraram.toLocaleString('pt-BR')}</td>
            ${DEG.map(([k]) => cel(c[k], c.entraram)).join('')}
            <td style="text-align:right;white-space:nowrap">${c.vgv ? brl(c.vgv) : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted" style="padding:12px">Sem dados.</td></tr>'}</tbody>
        </table>
      </div>

      <h3 class="card-title" style="font-size:14px;margin-top:18px">👤 Por corretor · turmas de ${(_d.turmas_corretor || []).map(nomeMes).join(', ')}</h3>
      <div class="tiny muted">Só as 3 turmas mais recentes — o retrato de agora. Dono = responsável pelo negócio no RD.</div>
      <div style="overflow-x:auto;margin-top:6px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
          <thead><tr style="border-bottom:2px solid var(--border)">${th('Corretor', 'left')}${th('Entraram')}${DEG.map(([, l]) => th(l)).join('')}${th('VGV')}</tr></thead>
          <tbody>${corr.map(c => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:6px 8px;font-weight:600">${esc(c.nome)}</td>
            <td style="text-align:right;font-weight:600">${c.entraram.toLocaleString('pt-BR')}</td>
            ${DEG.map(([k]) => cel(c[k], c.entraram)).join('')}
            <td style="text-align:right;white-space:nowrap">${c.vgv ? brl(c.vgv) : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted" style="padding:12px">Sem dados.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="tiny muted" style="margin-top:12px;line-height:1.6">
        Como ler: cada negócio conta no degrau mais alto que já alcançou no RD (histórico de colunas + coluna atual + venda).
        ${fr === 'conquista' || fr === 'todas' ? 'Na Conquista, a esteira oficial de etapas é a do PSM HUB; esta tabela mostra o caminho no RD para comparar canais e turmas.' : ''}
        ${_d.cached ? 'Dados em cache (recalcula quando o RD sincroniza).' : ''}
      </div>
    </div>`;
  _root.querySelectorAll('[data-fr]').forEach(b => b.addEventListener('click', () => { _frente = b.dataset.fr; render(); }));
  document.getElementById('tu-meses').addEventListener('change', e => { _meses = +e.target.value; load(false); });
  document.getElementById('tu-fresh').addEventListener('click', () => load(true));
}

function kpi(label, value, sub) {
  return `<div style="background:var(--bg-3);border-radius:var(--r-md);padding:12px 14px">
    <div class="tiny muted" style="font-weight:600">${label}</div>
    <div style="font-size:20px;font-weight:600;margin-top:2px">${value}</div>
    ${sub ? `<div class="tiny muted">${esc(sub)}</div>` : ''}</div>`;
}
