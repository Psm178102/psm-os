/* PSM-OS v2 — Simulador Energia (produtividade corretor por canal) (Sprint 8.4)
   v87.73: formulário desenhado UMA vez — digitar só repinta KPIs e tabela
   (o campo parava de apagar enquanto se digitava; ver sim-campos.js). */
import { ATTR_NUM, parseNum, numCampo } from '../sim-campos.js';

const KEY = 'psm_v2_sim_energia';

const CANAIS = [
  { id: 'trafego_pago', lbl: 'Tráfego Pago',      tx: 0.0133, ene: 100 },
  { id: 'indicacao',    lbl: 'Indicação',          tx: 0.08,   ene: 90  },
  { id: 'carteira',     lbl: 'Carteira Própria',   tx: 0.15,   ene: 100 },
  { id: 'eventos',      lbl: 'Eventos (Rodadas)',  tx: 0.03,   ene: 10  },
  { id: 'networking',   lbl: 'Networking',         tx: 0.06,   ene: 100 },
  { id: 'plantao',      lbl: 'Plantão',            tx: 0.05,   ene: 0   },
  { id: 'reativacao',   lbl: 'Reativação',         tx: 0.01,   ene: 0   },
  { id: 'ativo',        lbl: 'Ativo (Prospecção)', tx: 0.005,  ene: 0   },
  { id: 'organico',     lbl: 'Tráfego Orgânico',   tx: 0.018,  ene: 0   },
  { id: 'captacao',     lbl: 'Captação de Imóvel', tx: 0.025,  ene: 0   },
];

let _root, _s;

export async function pageSimEnergia(ctx, root) {
  _root = root;
  const defaults = { atend: 100, ticket: 1500000, fMin: 0, fMax: 1, metaVendas: 4 };
  CANAIS.forEach(c => { defaults['en_' + c.id] = c.ene; });
  try { _s = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = defaults; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

function compute() {
  // sumproduct(energia * txBase) → divisor pra normalizar mix
  let sumProdu = 0;
  CANAIS.forEach(c => { sumProdu += ((+_s['en_' + c.id] || 0) / 100) * c.tx; });

  let totalVendas = 0, totalVGV = 0;
  const linhas = CANAIS.map(c => {
    const en = +_s['en_' + c.id] || 0;
    const mixPct = sumProdu > 0 ? ((en / 100) * c.tx) / sumProdu : 0;
    const atendCanal = (+_s.atend || 0) * mixPct;
    const fator = (+_s.fMin || 0) + ((+_s.fMax || 0) - (+_s.fMin || 0)) * en / 100;
    const txAjust = c.tx * fator;
    const vendas = atendCanal * txAjust;
    const vgv = vendas * (+_s.ticket || 0);
    totalVendas += vendas;
    totalVGV += vgv;
    return { c, en, mixPct, atendCanal, txAjust, vendas, vgv };
  });

  const cumprimentoMeta = +_s.metaVendas > 0 ? totalVendas / _s.metaVendas * 100 : 0;
  return { linhas, totalVendas, totalVGV, cumprimentoMeta };
}

function render() {
  _root.innerHTML = `
    <style>@media(max-width:900px){.en-grid{grid-template-columns:minmax(0,1fr) !important}}</style>
    <div class="card">
      <h2 class="card-title">⚡ Simulador Energia</h2>
      <p class="card-sub">Produtividade do corretor por canal — onde investir sua energia gera mais resultado?</p>

      <div class="en-grid" style="display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px;margin-top:12px;align-items:start">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Parâmetros Gerais</div>
          ${inp('Atendimentos / mês', 'atend')}
          ${inp('Ticket Médio (R$)', 'ticket')}
          ${inp('Meta Vendas / mês', 'metaVendas')}
          ${inp('Fator Mínimo Energia', 'fMin')}
          ${inp('Fator Máximo Energia', 'fMax')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Energia por Canal (0-100%)</div>
          ${CANAIS.map(can => inp(can.lbl, 'en_' + can.id, '%')).join('')}
        </div>

        <div>
          <div id="en-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px"></div>

          <div class="card" style="padding:0;overflow:auto" id="en-tabela"></div>

          <div class="alert" style="background:rgba(168, 85, 247, .1);color:var(--lilas);border:1px solid rgba(168, 85, 247, .3);margin-top:14px;padding:12px;border-radius:8px">
            <b>💡 Como usar:</b> ajuste a energia (0-100%) em cada canal pra simular onde investir tempo/atenção. O sistema calcula automaticamente o mix ideal de atendimentos, conversão e VGV previsto.
          </div>

          <div class="flex gap-2 mt-3">
            <button class="btn btn-ghost" data-back>← Voltar Simuladores</button>
          </div>
        </div>
      </div>
    </div>
  `;
  bind();
  pintaSaida();
}

/* Repinta SÓ os KPIs e a tabela — os <input> ficam vivos do começo ao fim */
function pintaSaida() {
  const c = compute();
  const k = _root.querySelector('#en-kpis');
  if (k) k.innerHTML = kpi('Vendas Previstas', dec(c.totalVendas, 2), 'var(--psm-navy)', '#fff')
    + kpi('VGV Previsto', fmt(c.totalVGV), '#22c55e')
    + kpi('Cumprimento Meta', dec(c.cumprimentoMeta, 1) + '%', c.cumprimentoMeta >= 100 ? '#22c55e' : '#f59e0b');
  const t = _root.querySelector('#en-tabela');
  if (t) t.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:var(--psm-navy);color:#fff">
        <th style="padding:8px;text-align:left">Canal</th>
        <th style="padding:8px;text-align:right">Energia</th>
        <th style="padding:8px;text-align:right">Mix %</th>
        <th style="padding:8px;text-align:right">Atend.</th>
        <th style="padding:8px;text-align:right">Conv.</th>
        <th style="padding:8px;text-align:right">Vendas</th>
        <th style="padding:8px;text-align:right">VGV</th>
      </tr></thead>
      <tbody>
        ${c.linhas.sort((a, b) => b.vendas - a.vendas).map(l => `
          <tr style="border-bottom:1px solid var(--bd)">
            <td style="padding:6px 8px;font-weight:700">${l.c.lbl}</td>
            <td style="padding:6px 8px;text-align:right">${dec(l.en, 1)}%</td>
            <td style="padding:6px 8px;text-align:right">${dec(l.mixPct * 100, 1)}%</td>
            <td style="padding:6px 8px;text-align:right">${dec(l.atendCanal, 1)}</td>
            <td style="padding:6px 8px;text-align:right">${dec(l.txAjust * 100, 2)}%</td>
            <td style="padding:6px 8px;text-align:right;font-weight:800;color:#22c55e">${dec(l.vendas, 2)}</td>
            <td style="padding:6px 8px;text-align:right;color:var(--psm-gold)">${fmt(l.vgv)}</td>
          </tr>
        `).join('')}
        <tr style="background:var(--psm-navy);color:#fff;font-weight:800">
          <td colspan="5" style="padding:8px">TOTAL</td>
          <td style="padding:8px;text-align:right">${dec(c.totalVendas, 2)}</td>
          <td style="padding:8px;text-align:right">${fmt(c.totalVGV)}</td>
        </tr>
      </tbody>
    </table>`;
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', () => { _s[el.dataset.key] = parseNum(el.value); save(); pintaSaida(); });
    el.addEventListener('blur', () => { el.value = numCampo(_s[el.dataset.key]); });
  });
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function inp(label, key, suffix) {
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1">${/R\$/.test(label) ? '<span class="tiny muted" style="align-self:center;font-weight:700">R$</span>' : ''}<input ${ATTR_NUM} class="input" data-key="${key}" value="${numCampo(_s[key])}" style="flex:1;min-width:0;font-size:12px;padding:6px 8px">${suffix ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.8;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
function dec(n, casas) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }
