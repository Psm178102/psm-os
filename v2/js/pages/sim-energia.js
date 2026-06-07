/* PSM-OS v2 — Simulador Energia (produtividade corretor por canal) (Sprint 8.4) */

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
  CANAIS.forEach(c => { sumProdu += (_s['en_' + c.id] / 100) * c.tx; });

  let totalVendas = 0, totalVGV = 0;
  const linhas = CANAIS.map(c => {
    const en = _s['en_' + c.id] || 0;
    const mixPct = sumProdu > 0 ? ((en / 100) * c.tx) / sumProdu : 0;
    const atendCanal = _s.atend * mixPct;
    const fator = _s.fMin + (_s.fMax - _s.fMin) * en / 100;
    const txAjust = c.tx * fator;
    const vendas = atendCanal * txAjust;
    const vgv = vendas * _s.ticket;
    totalVendas += vendas;
    totalVGV += vgv;
    return { c, en, mixPct, atendCanal, txAjust, vendas, vgv };
  });

  const cumprimentoMeta = _s.metaVendas > 0 ? (totalVendas / _s.metaVendas * 100).toFixed(1) : '0';
  return { linhas, totalVendas, totalVGV, cumprimentoMeta };
}

function render() {
  const c = compute();
  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">⚡ Simulador Energia</h2>
      <p class="card-sub">Produtividade do corretor por canal — onde investir sua energia gera mais resultado?</p>

      <div style="display:grid;grid-template-columns:300px 1fr;gap:14px;margin-top:12px">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin-bottom:6px">Parâmetros Gerais</div>
          ${inp('Atendimentos / mês', 'atend', 'num')}
          ${inp('Ticket Médio (R$)', 'ticket', 'num')}
          ${inp('Meta Vendas / mês', 'metaVendas', 'num')}
          ${inp('Fator Mínimo Energia', 'fMin', 'num')}
          ${inp('Fator Máximo Energia', 'fMax', 'num')}

          <div class="tiny muted" style="text-transform:uppercase;font-weight:800;margin:14px 0 6px">Energia por Canal (0-100%)</div>
          ${CANAIS.map(can => inp(can.lbl, 'en_' + can.id, 'num', '%')).join('')}
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
            ${kpi('Vendas Previstas', c.totalVendas.toFixed(2), 'var(--psm-navy)', '#fff')}
            ${kpi('VGV Previsto', fmt(c.totalVGV), '#22c55e')}
            ${kpi('Cumprimento Meta', c.cumprimentoMeta + '%', c.cumprimentoMeta >= 100 ? '#22c55e' : '#f59e0b')}
          </div>

          <div class="card" style="padding:0;overflow:auto">
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
                ${c.linhas.sort((a,b)=>b.vendas-a.vendas).map(l => `
                  <tr style="border-bottom:1px solid var(--bd)">
                    <td style="padding:6px 8px;font-weight:700">${l.c.lbl}</td>
                    <td style="padding:6px 8px;text-align:right">${l.en}%</td>
                    <td style="padding:6px 8px;text-align:right">${(l.mixPct * 100).toFixed(1)}%</td>
                    <td style="padding:6px 8px;text-align:right">${l.atendCanal.toFixed(1)}</td>
                    <td style="padding:6px 8px;text-align:right">${(l.txAjust * 100).toFixed(2)}%</td>
                    <td style="padding:6px 8px;text-align:right;font-weight:800;color:#22c55e">${l.vendas.toFixed(2)}</td>
                    <td style="padding:6px 8px;text-align:right;color:var(--psm-gold)">${fmt(l.vgv)}</td>
                  </tr>
                `).join('')}
                <tr style="background:var(--psm-navy);color:#fff;font-weight:800">
                  <td colspan="5" style="padding:8px">TOTAL</td>
                  <td style="padding:8px;text-align:right">${c.totalVendas.toFixed(2)}</td>
                  <td style="padding:8px;text-align:right">${fmt(c.totalVGV)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="alert" style="background:rgba(168, 85, 247, .1);color:#a855f7;border:1px solid rgba(168, 85, 247, .3);margin-top:14px;padding:12px;border-radius:8px">
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
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', e => {
    const k = el.dataset.key, t = el.dataset.type;
    _s[k] = t === 'num' ? (parseFloat(e.target.value) || 0) : e.target.value;
    save();
    clearTimeout(window._enrTimer); window._enrTimer = setTimeout(render, 250);
  }));
  const back = _root.querySelector('[data-back]'); if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  return `<div style="margin-bottom:6px"><label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label><div class="flex gap-1">${(/R\$/.test(label) || suffix === 'R$') ? '<span class="tiny muted" style="align-self:center;font-weight:700">R$</span>' : ''}<input type="${type === 'text' ? 'text' : 'number'}" class="input" data-key="${key}" data-type="${type}" value="${val}" style="flex:1;font-size:12px;padding:6px 8px">${(suffix && suffix !== 'R$') ? `<span class="tiny muted" style="align-self:center">${suffix}</span>` : ''}</div></div>`;
}

function kpi(label, value, bg, color) {
  return `<div style="background:${bg};color:${color || '#fff'};padding:14px;border-radius:8px;text-align:center"><div style="font-size:9px;text-transform:uppercase;opacity:.8;font-weight:700">${label}</div><div style="font-size:18px;font-weight:800;margin-top:4px">${value}</div></div>`;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
