/* ============================================================================
   PSM-OS v2 — Simulador Conquista (faixa de renda / MCMV)  v81.44
   ----------------------------------------------------------------------------
   O coração do modelo Conquista é captação POR FAIXA DE RENDA. Esta tela pega a
   renda familiar + entrada e devolve, na hora, o que o corretor precisa pra
   conduzir o cliente: em qual FAIXA MCMV ele cai, o VALOR MÁXIMO de imóvel que
   cabe no bolso, a PARCELA estimada, quanto dá pra FINANCIAR e o indicativo de
   SUBSÍDIO. A matemática de financiamento (Tabela Price) é exata; os limites de
   faixa são REFERÊNCIA MCMV 2024 (editáveis aqui em cima — confira os vigentes).
   100% frontend, sem backend. Gated em sócio por enquanto (ROUTE_MIN_LVL=10).
============================================================================ */

// ⚠️ REFERÊNCIA MCMV urbano 2024 — confira sempre os valores vigentes (mudam por ano/região).
//    rendaMax = teto de renda mensal da faixa | jurosRef = juros a.a. típicos | subsidioRef = subsídio máx estimado
const FAIXAS = [
  { nome: 'Faixa 1', rendaMax: 2640,  jurosRef: 4.75,  subsidioRef: 55000, cor: '#16a34a', nota: 'Maior subsídio + menores juros' },
  { nome: 'Faixa 2', rendaMax: 4400,  jurosRef: 6.50,  subsidioRef: 29000, cor: '#0ea5e9', nota: 'Subsídio decresce conforme a renda' },
  { nome: 'Faixa 3', rendaMax: 8000,  jurosRef: 8.16,  subsidioRef: 0,     cor: '#f59e0b', nota: 'Sem subsídio direto; juros reduzidos' },
  { nome: 'Faixa 4 · Classe Média', rendaMax: 12000, jurosRef: 10.0, subsidioRef: 0, cor: '#8b5cf6', nota: 'Imóvel até ~R$500k (piloto MCMV classe média)' },
];
const ACIMA = { nome: 'Acima do MCMV', jurosRef: 11.0, subsidioRef: 0, cor: '#64748b', nota: 'Financiamento SBPE / mercado' };

const BRL = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const num = id => parseFloat((document.getElementById(id)?.value || '0').toString().replace(/\./g, '').replace(',', '.')) || 0;

function faixaDe(renda) {
  for (const f of FAIXAS) if (renda <= f.rendaMax) return f;
  return ACIMA;
}

// Capacidade de financiamento (valor presente da série de parcelas) — Tabela Price.
function calc(renda, entrada, prazoAnos, taxaAA, compromPct) {
  const parcelaMax = renda * (compromPct / 100);
  const n = Math.max(1, Math.round(prazoAnos * 12));
  const iM = Math.pow(1 + taxaAA / 100, 1 / 12) - 1;        // juros mensal efetivo
  const financiavel = iM > 0 ? parcelaMax * (1 - Math.pow(1 + iM, -n)) / iM : parcelaMax * n;
  const imovelMax = entrada + financiavel;
  return { parcelaMax, financiavel, imovelMax, n, iM };
}

let _root = null;
export function pageSimConquista(ctx, root) {
  _root = root;
  root.innerHTML = `
    <style>
      .sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
      .sc-out{background:var(--bg-1,#fff);border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:14px}
      .sc-out .v{font-size:22px;font-weight:800;line-height:1.1}
      .sc-out .l{font-size:11px;color:var(--ink-muted,#64748b);font-weight:700;text-transform:uppercase;letter-spacing:.3px}
    </style>
    <div style="margin-bottom:14px">
      <div style="font-size:21px;font-weight:800">🏠 Simulador Conquista — Faixa de Renda</div>
      <div class="tiny muted">Renda do cliente → faixa MCMV, valor máximo de imóvel, parcela, financiamento e subsídio. Conduz a captação por faixa na hora.</div>
    </div>

    <div class="card" style="padding:16px;margin-bottom:14px">
      <div class="sc-grid">
        <div><label class="tiny muted">💰 Renda familiar (mês)</label><input id="sc-renda" class="input" inputmode="decimal" value="3.000" placeholder="R$"></div>
        <div><label class="tiny muted">🏦 Entrada (FGTS + recursos)</label><input id="sc-entrada" class="input" inputmode="decimal" value="20.000" placeholder="R$"></div>
        <div><label class="tiny muted">📅 Prazo (anos)</label><input id="sc-prazo" class="input" inputmode="decimal" value="30"></div>
        <div><label class="tiny muted">📈 Juros (% a.a.)</label><input id="sc-juros" class="input" inputmode="decimal" value="" placeholder="auto p/ faixa"></div>
        <div><label class="tiny muted">⚖️ Comprometimento (%)</label><input id="sc-comprom" class="input" inputmode="decimal" value="30"></div>
      </div>
      <div class="tiny muted" style="margin-top:8px">Dica: deixe os <b>juros em branco</b> pra usar a referência da faixa automaticamente. Comprometimento padrão da renda = 30%.</div>
    </div>

    <div id="sc-result"></div>

    <div class="card" style="padding:14px;margin-top:14px">
      <div style="font-weight:800;margin-bottom:8px">📊 Faixas MCMV (referência 2024)</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--ink-muted,#64748b)">
          <th style="padding:6px">Faixa</th><th style="padding:6px">Renda até</th><th style="padding:6px">Juros ref. a.a.</th><th style="padding:6px">Subsídio est.</th><th style="padding:6px">Observação</th></tr></thead>
        <tbody>${FAIXAS.map(f => `<tr style="border-top:1px solid var(--bd,#e2e8f0)">
          <td style="padding:6px"><span style="font-weight:800;color:${f.cor}">${f.nome}</span></td>
          <td style="padding:6px">${BRL(f.rendaMax)}</td>
          <td style="padding:6px">${f.jurosRef.toFixed(2).replace('.', ',')}%</td>
          <td style="padding:6px">${f.subsidioRef ? 'até ~' + BRL(f.subsidioRef) : '—'}</td>
          <td style="padding:6px" class="tiny muted">${esc(f.nota)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="tiny muted" style="margin-top:8px">⚠️ Limites de faixa, juros e subsídio são <b>referência</b> e mudam por ano/região — confira a tabela MCMV vigente. O cálculo de parcela/financiamento (Tabela Price) é exato sobre os parâmetros informados.</div>
    </div>`;
  _root.querySelectorAll('input').forEach(i => i.addEventListener('input', render));
  render();
}

function render() {
  const renda = num('sc-renda'), entrada = num('sc-entrada');
  const prazo = num('sc-prazo') || 30, comprom = num('sc-comprom') || 30;
  const f = faixaDe(renda);
  const jurosManual = num('sc-juros');
  const juros = jurosManual > 0 ? jurosManual : f.jurosRef;
  const r = calc(renda, entrada, prazo, juros, comprom);
  const out = document.getElementById('sc-result');
  if (!out) return;
  const temSubsidio = f.subsidioRef > 0;
  out.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <span style="background:${f.cor};color:#fff;font-weight:800;padding:8px 16px;border-radius:99px;font-size:15px">${esc(f.nome)}</span>
      <span class="tiny muted">${esc(f.nota)} · juros usados: <b>${juros.toFixed(2).replace('.', ',')}% a.a.</b>${jurosManual > 0 ? ' (manual)' : ' (ref. faixa)'}</span>
    </div>
    <div class="sc-grid">
      <div class="sc-out" style="border-left:4px solid ${f.cor}"><div class="l">🏠 Imóvel até</div><div class="v" style="color:${f.cor}">${BRL(r.imovelMax)}</div><div class="tiny muted">entrada + financiamento</div></div>
      <div class="sc-out"><div class="l">💳 Parcela estimada</div><div class="v">${BRL(r.parcelaMax)}</div><div class="tiny muted">${comprom}% da renda · ${r.n}x</div></div>
      <div class="sc-out"><div class="l">🏦 Financiável</div><div class="v">${BRL(r.financiavel)}</div><div class="tiny muted">capacidade (Price)</div></div>
      <div class="sc-out"><div class="l">💵 Entrada</div><div class="v">${BRL(entrada)}</div><div class="tiny muted">FGTS + recursos</div></div>
      <div class="sc-out"><div class="l">🎁 Subsídio</div><div class="v" style="color:${temSubsidio ? '#16a34a' : 'var(--ink-muted,#94a3b8)'}">${temSubsidio ? 'até ~' + BRL(f.subsidioRef) : '—'}</div><div class="tiny muted">${temSubsidio ? 'estimado (renda/região)' : 'faixa sem subsídio direto'}</div></div>
    </div>
    ${renda > 0 ? `<div class="card" style="padding:12px;margin-top:12px;background:var(--bg-3,#f8fafc)">
      <div class="tiny"><b>Leitura rápida pro cliente:</b> com renda de ${BRL(renda)} e entrada de ${BRL(entrada)}, ele se enquadra na <b style="color:${f.cor}">${esc(f.nome)}</b> e consegue um imóvel de até <b>${BRL(r.imovelMax)}</b>, pagando cerca de <b>${BRL(r.parcelaMax)}/mês</b> em ${prazo} anos.${temSubsidio ? ' Tem direito a subsídio (some à entrada e o poder de compra sobe).' : ''}</div>
    </div>` : '<div class="tiny muted" style="margin-top:10px">Informe a renda pra simular.</div>'}`;
}
