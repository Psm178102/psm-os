/* PSM-OS v2 — Simulador VPL (Sprint 8.4 · v86.17 layout PROPOSTA PERSONALIZADA)
   O fluxo aparece IGUAL à planilha oficial (faixa amarela, N°/Data, colunas
   ENTRADA/MENSAIS/SEMESTRAIS/ANUAIS/FINANCIAMENTO-CHAVES/TOTAL, linhas verdes,
   chaves em azul, pós-chaves em vermelho, rodapé Total) — e Imprimir/Compartilhar
   abrem a MESMA via em janela limpa (PDF pelo diálogo do navegador). */

const KEY = 'psm_v2_sim_vpl';
let _root = null;
let _s = null;

const DEFAULTS = {
  empreendimento: '', torreUnidade: '', m2: 45, cliente: '',
  dataInicio: new Date().toISOString().slice(0, 10),
  valorTabela: 480000, taxaAA: 6.168, prazoObra: 42,
  pctAto: 5, pctMensal: 14, pctAnual: 6, pctSemestral: 0, pctFinanc: 75,
  numAto: 1,                                        // 1 = ato à vista; 3 = ato em 3x
  numAnuais: 3, numSemestrais: 0, numMensais: 0,   // 0 = até as chaves
  mesesExibidos: 0,                                 // 0 = até as chaves (igual planilha: pode exibir além, zerado em vermelho)
  desconto: 0,
};

export async function pageSimVPL(ctx, root) {
  _root = root;
  try { _s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { _s = { ...DEFAULTS }; }
  render();
}

function save() { try { localStorage.setItem(KEY, JSON.stringify(_s)); } catch {} }

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function labelMes(i) {
  // linha i (1..N) = i meses depois do início; ATO é a linha 0
  try {
    const [y, m] = String(_s.dataInicio || '').slice(0, 7).split('-').map(Number);
    const d = new Date(y, (m - 1) + i, 1);
    return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
  } catch { return `mês ${i}`; }
}

function compute() {
  const v = _s;
  const taxaM = Math.pow(1 + v.taxaAA / 100, 1 / 12) - 1;
  const valorFinal = v.valorTabela * (1 - v.desconto / 100);
  // ── ATO PARCELADO (v86.59) ────────────────────────────────────────────────
  // O ato ocupa os meses 0..nAto-1, e as mensais começam DEPOIS dele. O prazo
  // até as chaves não muda: quem cede espaço é a quantidade de mensais.
  //   ato à vista, prazo 40 → ato no mês 0  +  40 mensais (meses 1..40)
  //   ato em 3x,   prazo 40 → ato em 0,1,2  +  38 mensais (meses 3..40)
  // A conta é sempre (prazo − nAto + 1), que com nAto=1 devolve o prazo cheio —
  // o comportamento antigo continua idêntico para quem não parcela.
  const nAto = Math.max(1, Math.min(Math.round(v.numAto || 1), Math.max(1, v.prazoObra)));
  const atoTotal = valorFinal * v.pctAto / 100;
  const ato = atoTotal / nAto;                       // valor de CADA parcela do ato
  const mensaisAteChaves = Math.max(0, v.prazoObra - nAto + 1);
  // Nº de Mensais digitado à mão continua valendo, mas TETADO pelas chaves: sem
  // isso, parcelar o ato empurrava as últimas mensais para depois da entrega —
  // com 42 fixas, prazo 42 e ato em 4x, três delas caíam nos meses 43, 44 e 45,
  // já em cima do financiamento. Achado testando no ar (v86.60).
  const nMensaisPedido = v.numMensais > 0 ? Math.min(v.numMensais, 480) : mensaisAteChaves;
  const nMensais = Math.min(nMensaisPedido, mensaisAteChaves);
  const mensaisAparadas = Math.max(0, nMensaisPedido - nMensais);
  const totalMensal = valorFinal * v.pctMensal / 100;
  const mensal = nMensais > 0 ? totalMensal / nMensais : 0;
  // anuais/semestrais que não cabem ATÉ AS CHAVES são aparadas (não podem cair depois
  // da entrega, em cima do financiamento). Igual ao tratamento das mensais.
  const totalAnual = valorFinal * v.pctAnual / 100;
  const nAnuaisPedido = Math.max(0, Math.round(v.numAnuais || 0));
  const nAnuais = Math.min(nAnuaisPedido, Math.floor(v.prazoObra / 12));
  const anual = nAnuais > 0 ? totalAnual / nAnuais : 0;
  const totalSemestral = valorFinal * v.pctSemestral / 100;
  const nSemestraisPedido = Math.max(0, Math.round(v.numSemestrais || 0));
  const nSemestrais = Math.min(nSemestraisPedido, Math.floor(v.prazoObra / 6));
  const semestral = nSemestrais > 0 ? totalSemestral / nSemestrais : 0;
  const parcelasAparadas = (nAnuaisPedido - nAnuais) + (nSemestraisPedido - nSemestrais);
  const financ = valorFinal * v.pctFinanc / 100;
  const pctTotal = v.pctAto + v.pctMensal + v.pctAnual + v.pctSemestral + v.pctFinanc;

  const nLinhas = Math.max(v.prazoObra, v.mesesExibidos > 0 ? Math.min(v.mesesExibidos, 480) : 0);
  const fluxo = [];
  for (let i = 0; i <= nLinhas; i++) {
    const ent = i < nAto ? ato : 0;
    const m = (i >= nAto && i < nAto + nMensais) ? mensal : 0;
    const a = (i > 0 && i % 12 === 0 && i / 12 <= nAnuais) ? anual : 0;
    const s = (i > 0 && nSemestrais > 0 && i % 6 === 0 && i / 6 <= nSemestrais) ? semestral : 0;
    const f = (i === v.prazoObra) ? financ : 0;
    const total = ent + m + a + s + f;
    const pv = total / Math.pow(1 + taxaM, i);
    fluxo.push({ mes: i, ent, m, a, s, f, total, pv, chaves: i === v.prazoObra && v.prazoObra > 0 });
  }
  const vpl = fluxo.reduce((sum, x) => sum + x.pv, 0);
  const descVPL = v.valorTabela > 0 ? ((1 - vpl / v.valorTabela) * 100).toFixed(2) : '0.00';
  const m2VPL = v.m2 > 0 ? (vpl / v.m2).toFixed(0) : 0;
  const m2Tabela = v.m2 > 0 ? (v.valorTabela / v.m2).toFixed(0) : 0;
  const tot = fluxo.reduce((acc, x) => ({ ent: acc.ent + x.ent, m: acc.m + x.m, s: acc.s + x.s, a: acc.a + x.a, f: acc.f + x.f, total: acc.total + x.total }),
    { ent: 0, m: 0, s: 0, a: 0, f: 0, total: 0 });
  return { taxaM, ato, atoTotal, nAto, mensaisAparadas, parcelasAparadas, nAnuais, nSemestrais, mensal, anual, semestral, financ, pctTotal, fluxo, tot, vpl, descVPL, m2VPL, m2Tabela, totalMensal, totalAnual, valorFinal, nMensais };
}

/* ═══════════ A TABELA DA PLANILHA (idêntica na tela, na impressão e no share) ═══════════ */
const fmt2 = n => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// célula de dinheiro estilo Excel contábil: "R$" encostado à esquerda, valor à direita
function celR$(v, forca) {
  if (!v && !forca) return '<td class="pp-c pp-money"></td>';
  return `<td class="pp-c pp-money"><span class="pp-rs">R$</span><span>${v ? fmt2(v) : '-'}</span></td>`;
}

function propostaTableHTML(c) {
  const linhas = c.fluxo.map(x => {
    // parcela do ato (meses 0..nAto-1) também é ATO — linha branca, não verde
    const tipo = x.mes < c.nAto ? 'ato' : (x.chaves ? 'chaves' : (x.total > 0.005 ? 'verde' : 'verm'));
    return `<tr class="pp-r pp-${tipo}">
      <td class="pp-c pp-n">${x.mes}</td>
      <td class="pp-c pp-data">${x.mes === 0 ? 'ATO' : labelMes(x.mes)}${x.mes > 0 && x.mes < c.nAto ? ` <span style="font-size:9px">(ato ${x.mes + 1}/${c.nAto})</span>` : ''}</td>
      ${celR$(x.ent)}
      ${x.mes === 0 ? celR$(0, true) : celR$(x.m)}
      ${celR$(x.s)}
      ${celR$(x.a)}
      ${celR$(x.f)}
      <td class="pp-c pp-money pp-tot"><span>${fmt2(x.total)}</span></td>
    </tr>`;
  }).join('');
  return `
  <table class="pp-table">
    <thead>
      <tr>
        <th class="pp-h pp-n" rowspan="2">N°</th>
        <th class="pp-h pp-data" rowspan="2">Data</th>
        <th class="pp-titulo" colspan="6">PROPOSTA PERSONALIZADA</th>
      </tr>
      <tr>
        <th class="pp-h">ENTRADA</th>
        <th class="pp-h">MENSAIS</th>
        <th class="pp-h">SEMESTRAIS</th>
        <th class="pp-h">ANUAIS</th>
        <th class="pp-h">FINANCIAMENTO /<br>CHAVES</th>
        <th class="pp-h">TOTAL</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
    <tfoot>
      <tr class="pp-foot">
        <td class="pp-c" colspan="2"><b>Total</b></td>
        ${celR$(c.tot.ent, true)}${celR$(c.tot.m, true)}${celR$(c.tot.s, true)}${celR$(c.tot.a, true)}${celR$(c.tot.f, true)}
        <td class="pp-c pp-money pp-tot"><span class="pp-rs">R$</span><span>${fmt2(c.tot.total)}</span></td>
      </tr>
    </tfoot>
  </table>`;
}

// CSS fiel à planilha — o MESMO na tela e na via de impressão/compartilhamento
const PP_CSS = `
  .pp-table{border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1a1a1a;width:100%;max-width:980px;background:#fff}
  /* v86.85: a planilha é uma FOLHA impressa fiel — fica clara nos 2 temas, com tinta escura própria (antes herdava a letra creme do escuro sobre verde/amarelo claro) */
  .pp-table .pp-c,.pp-table .pp-h{border:1px solid #000;padding:2px 6px;height:19px}
  .pp-titulo{background:#ffff00;color:#1a1a1a;font-weight:800;font-size:21px;border:1.5px solid #000;text-align:center;padding:6px}
  .pp-h{background:#f3f3f3;font-weight:700;text-align:center;font-size:11.5px}
  .pp-n{width:44px;text-align:center;font-weight:700}
  .pp-data{width:74px;text-align:center;font-weight:700}
  .pp-money{min-width:108px;text-align:right;white-space:nowrap}
  .pp-money .pp-rs{float:left;padding-right:8px}
  .pp-r td{background:#dde8d0}
  .pp-ato td{background:#e9e9e9;font-weight:700}
  .pp-verde .pp-n{background:#d9ead3;color:#38761d}
  .pp-verm .pp-n{background:#f4cccc;color:#cc0000}
  .pp-verm td:not(.pp-n){color:#333}
  .pp-chaves .pp-n{background:#a4c2f4;color:#1c4587}
  .pp-tot{font-weight:700}
  .pp-foot td{background:#c6d5b0;font-weight:800;border:1.5px solid #000}
`;

/* via limpa (janela nova): igual à foto, pronta pra imprimir/salvar PDF/compartilhar */
function abrirVia(autoPrint) {
  const c = compute();
  // foto pronta embutida na via (gerada AQUI, no app — a via só oferece o download)
  let fotoUrl = '';
  try { fotoUrl = desenharPropostaCanvas(c, 2).toDataURL('image/png'); } catch (_) {}
  const nomeArq = `proposta-${(_s.cliente || _s.empreendimento || 'psm').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'psm'}.png`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Proposta ${escHtml(_s.cliente || _s.empreendimento || 'PSM')}</title>
    <style>
      body{margin:18px;background:var(--bg-2)}
      .pp-cab{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:var(--ink);margin:0 0 8px;max-width:980px}
      .pp-acoes{position:fixed;top:10px;right:10px;display:flex;gap:8px;font-family:Arial;z-index:9}
      .pp-acoes button,.pp-acoes a{padding:8px 14px;border:1px solid #999;border-radius:8px;background:#f5f5f5;font-weight:700;cursor:pointer;text-decoration:none;color:var(--ink);font-size:13px;font-family:Arial}
      @media print{.pp-acoes{display:none}body{margin:0}}
      ${PP_CSS}
    </style></head><body>
    <div class="pp-acoes">
      <button onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
      ${fotoUrl ? `<a href="${fotoUrl}" download="${nomeArq}">📷 Baixar foto</a>` : ''}
      <button onclick="window.close()">✕ Fechar</button>
    </div>
    <div class="pp-cab">${cabecalhoHTML(c)}</div>
    ${propostaTableHTML(c)}
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela — libere pop-ups pra imprimir/compartilhar.'); return; }
  w.document.write(html);
  w.document.close();
  if (autoPrint) setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
}

function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

function cabecalhoHTML(c) {
  return [
    _s.empreendimento && `<b>Empreendimento:</b> ${escHtml(_s.empreendimento)}`,
    _s.torreUnidade && `<b>Torre/Unidade:</b> ${escHtml(_s.torreUnidade)}`,
    _s.cliente && `<b>Cliente:</b> ${escHtml(_s.cliente)}`,
    `<b>Valor:</b> R$ ${fmt2(c.valorFinal)}${_s.desconto ? ` (tabela R$ ${fmt2(_s.valorTabela)} − ${_s.desconto}%)` : ''}`,
    `<b>Data:</b> ${new Date().toLocaleDateString('pt-BR')}`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
}

/* 📷 A proposta como FOTO (PNG 2×): desenho DIRETO no canvas — a tabela é
   determinística (mesmas larguras/cores/formatos da planilha), então a foto sai
   idêntica sem lib externa e sem canvas 'tainted' (foreignObject não exporta
   no Chrome — descoberto no teste local antes do deploy). */
const PPC = {
  cols: [44, 74, 118, 118, 118, 118, 132, 118],   // N° Data ENTRADA MENSAIS SEM ANU FIN TOTAL
  hTit: 36, hHead: 32, hRow: 21, hFoot: 26, pad: 16, hCab: 22,
  verde: '#dde8d0', nVerde: '#d9ead3', nVerdeTx: '#38761d', nVerm: '#f4cccc',
  nVermTx: '#cc0000', nAzul: '#a4c2f4', nAzulTx: '#1c4587', foot: '#c6d5b0', amarelo: '#ffff00',
};

function desenharPropostaCanvas(c, scale) {
  const W = PPC.cols.reduce((a, b) => a + b, 0);
  const n = c.fluxo.length;
  const H = PPC.hCab + PPC.hTit + PPC.hHead + n * PPC.hRow + PPC.hFoot;
  const cv = document.createElement('canvas');
  cv.width = (W + PPC.pad * 2) * scale; cv.height = (H + PPC.pad * 2) * scale;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W + PPC.pad * 2, H + PPC.pad * 2);
  g.translate(PPC.pad, PPC.pad);
  const X = [0]; PPC.cols.forEach((w, i) => X.push(X[i] + w));
  const fmtv = v => fmt2(v);
  const cell = (x0, y0, w, h, bg) => { if (bg) { g.fillStyle = bg; g.fillRect(x0, y0, w, h); } g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(x0 + .5, y0 + .5, w, h); };
  const txt = (s, x, y, { al = 'left', bold = false, size = 12, col = '#000' } = {}) => {
    g.fillStyle = col; g.font = `${bold ? 'bold ' : ''}${size}px Arial, Helvetica, sans-serif`; g.textAlign = al; g.textBaseline = 'middle'; g.fillText(s, x, y);
  };
  const money = (ci, y, h, v, forca, bold) => {
    if (!v && !forca) return;
    txt('R$', X[ci] + 6, y + h / 2, { bold });
    txt(v ? fmtv(v) : '-', X[ci + 1] - 6, y + h / 2, { al: 'right', bold });
  };
  // cabeçalho de identificação (linha simples acima da tabela)
  const cab = [_s.empreendimento && `Empreendimento: ${_s.empreendimento}`, _s.torreUnidade && `Torre/Unidade: ${_s.torreUnidade}`,
    _s.cliente && `Cliente: ${_s.cliente}`, `Valor: R$ ${fmtv(c.valorFinal)}`, new Date().toLocaleDateString('pt-BR')].filter(Boolean).join('  ·  ');
  txt(cab, 0, PPC.hCab / 2 - 3, { size: 11.5 });
  let y = PPC.hCab;
  // título amarelo + N°/Data com altura dupla
  cell(X[0], y, PPC.cols[0], PPC.hTit + PPC.hHead, '#fff'); txt('N°', X[0] + PPC.cols[0] / 2, y + (PPC.hTit + PPC.hHead) / 2, { al: 'center', bold: true, size: 11.5 });
  cell(X[1], y, PPC.cols[1], PPC.hTit + PPC.hHead, '#fff'); txt('Data', X[1] + PPC.cols[1] / 2, y + (PPC.hTit + PPC.hHead) / 2, { al: 'center', bold: true, size: 11.5 });
  cell(X[2], y, W - X[2], PPC.hTit, PPC.amarelo);
  txt('PROPOSTA PERSONALIZADA', X[2] + (W - X[2]) / 2, y + PPC.hTit / 2, { al: 'center', bold: true, size: 21 });
  y += PPC.hTit;
  const HEADS = ['ENTRADA', 'MENSAIS', 'SEMESTRAIS', 'ANUAIS', ['FINANCIAMENTO /', 'CHAVES'], 'TOTAL'];
  HEADS.forEach((hh, i) => {
    const ci = i + 2;
    cell(X[ci], y, PPC.cols[ci], PPC.hHead, '#fff');
    if (Array.isArray(hh)) { txt(hh[0], X[ci] + PPC.cols[ci] / 2, y + 10, { al: 'center', bold: true, size: 10.5 }); txt(hh[1], X[ci] + PPC.cols[ci] / 2, y + 22, { al: 'center', bold: true, size: 10.5 }); }
    else txt(hh, X[ci] + PPC.cols[ci] / 2, y + PPC.hHead / 2, { al: 'center', bold: true, size: 11 });
  });
  y += PPC.hHead;
  c.fluxo.forEach(x => {
    const tipo = x.mes < c.nAto ? 'ato' : (x.chaves ? 'chaves' : (x.total > 0.005 ? 'verde' : 'verm'));
    const bg = tipo === 'ato' ? '#fff' : PPC.verde;
    const nBg = tipo === 'ato' ? '#fff' : tipo === 'verde' ? PPC.nVerde : tipo === 'chaves' ? PPC.nAzul : PPC.nVerm;
    const nTx = tipo === 'verde' ? PPC.nVerdeTx : tipo === 'chaves' ? PPC.nAzulTx : tipo === 'verm' ? PPC.nVermTx : '#000';
    cell(X[0], y, PPC.cols[0], PPC.hRow, nBg);
    txt(String(x.mes), X[0] + PPC.cols[0] / 2, y + PPC.hRow / 2, { al: 'center', bold: true, col: nTx });
    cell(X[1], y, PPC.cols[1], PPC.hRow, bg);
    txt(x.mes === 0 ? 'ATO' : (x.mes < c.nAto ? `${labelMes(x.mes)} (ato ${x.mes + 1}/${c.nAto})` : labelMes(x.mes)),
        X[1] + PPC.cols[1] / 2, y + PPC.hRow / 2, { al: 'center', bold: true, size: x.mes > 0 && x.mes < c.nAto ? 9 : undefined });
    for (let ci = 2; ci <= 7; ci++) cell(X[ci], y, PPC.cols[ci], PPC.hRow, bg);
    const boldAto = tipo === 'ato';
    money(2, y, PPC.hRow, x.ent, false, boldAto);
    money(3, y, PPC.hRow, x.m, x.mes === 0, boldAto);
    money(4, y, PPC.hRow, x.s); money(5, y, PPC.hRow, x.a); money(6, y, PPC.hRow, x.f);
    txt(fmtv(x.total), X[8] - 6, y + PPC.hRow / 2, { al: 'right', bold: true });
    y += PPC.hRow;
  });
  // rodapé Total
  cell(X[0], y, PPC.cols[0] + PPC.cols[1], PPC.hFoot, PPC.foot);
  txt('Total', X[0] + (PPC.cols[0] + PPC.cols[1]) / 2, y + PPC.hFoot / 2, { al: 'center', bold: true });
  [[2, c.tot.ent], [3, c.tot.m], [4, c.tot.s], [5, c.tot.a], [6, c.tot.f], [7, c.tot.total]].forEach(([ci, v]) => {
    cell(X[ci], y, PPC.cols[ci], PPC.hFoot, PPC.foot);
    money(ci, y, PPC.hFoot, v, true, true);
  });
  return cv;
}

async function baixarFoto() {
  try {
    const cv = desenharPropostaCanvas(compute(), 2);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('canvas vazio');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `proposta-${(_s.cliente || _s.empreendimento || 'psm').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'psm'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    alert('Não consegui gerar a foto (' + (e.message || e) + '). Use 🖨 Imprimir/PDF — sai idêntico.');
  }
}

function render() {
  const c = compute();
  _root.innerHTML = `
    <style>${PP_CSS}</style>
    <div class="card">
      <h2 class="card-title">📐 Simulador VPL · Proposta Personalizada</h2>
      <p class="card-sub">Valor Presente Líquido — o fluxo sai IGUAL à planilha oficial (na tela, na impressão e no compartilhamento)</p>

      <div style="display:grid;grid-template-columns:320px 1fr;gap:14px;margin-top:12px" id="vpl-grid">
        <div style="background:var(--bg-3);border-radius:10px;padding:14px">
          ${section('Dados do Imóvel', [
            inp('Empreendimento', 'empreendimento', 'text'),
            inp('Torre / Unidade', 'torreUnidade', 'text'),
            inp('M²', 'm2', 'num', 'm²'),
            inp('Cliente', 'cliente', 'text'),
            inp('Início do fluxo (1ª mensal)', 'dataInicio', 'date'),
            inp('Valor de Tabela (R$)', 'valorTabela', 'num'),
            inp('Taxa VPL (% a.a.)', 'taxaAA', 'num', '% a.a.'),
            `<div class="tiny muted" id="vpl-taxam">Taxa mensal: ${(c.taxaM * 100).toFixed(4)}% a.m.</div>`,
            inp('Desconto sobre Tabela (%)', 'desconto', 'num', '%'),
          ])}
          ${section('Fluxo de Pagamentos', [
            inp('Ato/Entrada (%)', 'pctAto', 'num', '%'),
            inp('Ato em quantas vezes (1 = à vista)', 'numAto', 'num', 'x'),
            `<div class="tiny muted" id="vpl-avisoato"></div>`,
            inp('Mensais (%)', 'pctMensal', 'num', '%'),
            inp('Nº de Mensais (0 = até chaves)', 'numMensais', 'num'),
            inp('Prazo Obra / Chaves (meses)', 'prazoObra', 'num'),
            inp('Semestrais (%)', 'pctSemestral', 'num', '%'),
            inp('Nº Semestrais', 'numSemestrais', 'num'),
            inp('Anuais (%)', 'pctAnual', 'num', '%'),
            inp('Nº Anuais', 'numAnuais', 'num'),
            inp('Financiamento/Chaves (%)', 'pctFinanc', 'num', '%'),
            inp('Meses exibidos (0 = até chaves)', 'mesesExibidos', 'num'),
          ])}
          <div id="vpl-alerta"></div>
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:14px" id="vpl-kpis">${kpisHTML(c)}</div>

          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:14px" id="vpl-minis">${minisHTML(c)}</div>

          <div class="flex gap-2" style="margin-bottom:10px;flex-wrap:wrap">
            <button class="btn btn-primary" id="vpl-print">🖨 Imprimir / PDF</button>
            <button class="btn btn-ghost" id="vpl-share">📤 Compartilhar (via limpa)</button>
            <button class="btn btn-ghost" id="vpl-foto">📷 Baixar foto (PNG)</button>
            <button class="btn btn-ghost" data-back style="margin-left:auto">← Voltar Simuladores</button>
          </div>

          <!-- proposta INTEIRA projetada na página (sem barra de rolagem interna;
               a página cresce — pedido do Paulo, v86.18) -->
          <div id="vpl-proposta" style="background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:12px;overflow-x:auto">
            ${propostaTableHTML(c)}
          </div>
        </div>
      </div>
    </div>
  `;
  bind();
  pintaSaida();   // #vpl-alerta e #vpl-avisoato nascem vazios de propósito
}

function kpisHTML(c) {
  return kpi('Valor VPL', fmt(c.vpl), 'var(--psm-navy)', '#fff')
    + kpi('Desconto VPL', c.descVPL + '%', '#22c55e')
    + kpi('R$/m² VPL', 'R$ ' + Number(c.m2VPL).toLocaleString('pt-BR'), '#3b82f6')
    + kpi('R$/m² Tabela', 'R$ ' + Number(c.m2Tabela).toLocaleString('pt-BR'), 'var(--muted)');
}

function minisHTML(c) {
  const atoLbl = c.nAto > 1 ? `Ato ${c.nAto}x` : 'Ato';
  const atoHint = c.nAto > 1 ? `${_s.pctAto}% · total ${fmt(c.atoTotal)}` : _s.pctAto + '%';
  return miniKpi(atoLbl, fmt(c.ato), atoHint)
    + miniKpi('Mensais ' + c.nMensais + 'x', fmt(c.mensal), 'por mês')
    + miniKpi('Semestrais ' + _s.numSemestrais + 'x', fmt(c.semestral), '')
    + miniKpi('Anuais ' + _s.numAnuais + 'x', fmt(c.anual), '')
    + miniKpi('Financiamento/Chaves', fmt(c.financ), _s.pctFinanc + '%')
    + miniKpi('Total do fluxo', fmt(c.tot.total), '');
}

/* Repinta SÓ o resultado (KPIs, avisos e a proposta) — nunca o painel da
   esquerda. É o que faz a digitação parar de ser sabotada: enquanto o
   simulador recalcular re-renderizando o formulário inteiro, o input onde o
   dedo está some e volta, o valor cru se perde e o cursor pula pro fim.
   Aqui os <input> ficam vivos na tela do começo ao fim (v86.59). */
function pintaSaida() {
  const c = compute();
  const set = (sel, html) => { const el = _root.querySelector(sel); if (el) el.innerHTML = html; };
  set('#vpl-kpis', kpisHTML(c));
  set('#vpl-minis', minisHTML(c));
  set('#vpl-proposta', propostaTableHTML(c));
  set('#vpl-taxam', `Taxa mensal: ${(c.taxaM * 100).toFixed(4)}% a.m.`);
  set('#vpl-alerta', Math.abs(c.pctTotal - 100) > 0.1
    ? `<div class="alert alert-warn tiny">⚠ Total: ${c.pctTotal.toFixed(1)}% (deve ser 100%)</div>` : '');
  const aparou = c.mensaisAparadas > 0
    ? ` <span style="color:var(--warn)">· Nº de Mensais reduzido em ${c.mensaisAparadas} para não passar das chaves</span>` : '';
  const aparouPar = c.parcelasAparadas > 0
    ? ` <span style="color:var(--warn)">· ${c.parcelasAparadas} parcela(s) anual/semestral aparada(s) (não cabem antes das chaves)</span>` : '';
  set('#vpl-avisoato', (c.nAto > 1 || c.mensaisAparadas > 0 || c.parcelasAparadas > 0)
    ? `${c.nAto > 1 ? `ato ${c.nAto}x (meses 0 a ${c.nAto - 1}) + ` : ''}<b>${c.nMensais} mensais</b> (meses ${c.nAto} a ${_s.prazoObra}), chaves no mês ${_s.prazoObra}${aparou}${aparouPar}`
    : '');
}

function bind() {
  _root.querySelectorAll('[data-key]').forEach(el => {
    el.addEventListener('input', e => {
      const k = el.dataset.key;
      const t = el.dataset.type;
      _s[k] = t === 'num' ? parseNum(e.target.value) : e.target.value;
      save();
      pintaSaida();
    });
  });
  _root.querySelector('#vpl-print')?.addEventListener('click', () => abrirVia(true));
  _root.querySelector('#vpl-share')?.addEventListener('click', () => abrirVia(false));
  _root.querySelector('#vpl-foto')?.addEventListener('click', baixarFoto);
  const back = _root.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => location.hash = '/simuladores');
}

function section(title, items) {
  return `
    <div class="tiny muted" style="text-transform:uppercase;font-weight:800;letter-spacing:1px;margin:10px 0 6px">${title}</div>
    <div style="display:flex;flex-direction:column;gap:6px">${items.join('')}</div>
  `;
}

/* Aceita o jeito brasileiro de digitar: "1.500,50" e "1500.5" dão o mesmo
   número, e o campo NÃO é reformatado enquanto se digita. Ponto só é tratado
   como milhar quando vem seguido de exatamente 3 dígitos ("1.500"); "1.5"
   continua sendo um e meio. */
function parseNum(txt) {
  if (typeof txt !== 'string') return Number(txt) || 0;
  const t = txt.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : 0;
}

function inp(label, key, type, suffix) {
  const val = _s[key] ?? '';
  // numérico é type=text + inputmode decimal: type=number engole vírgula no
  // pt-BR, muda de valor com a roda do mouse e não deixa posicionar o cursor.
  const attrs = type === 'text' ? 'type="text"'
    : (type === 'date' ? 'type="date"' : 'type="text" inputmode="decimal" autocomplete="off"');
  return `
    <div>
      <label class="tiny muted" style="font-weight:600;display:block;margin-bottom:2px">${label}</label>
      <div class="flex gap-1" style="align-items:center">
        ${(/R\$/.test(label) || suffix === 'R$') ? '<span class="tiny muted" style="font-weight:700">R$</span>' : ''}
        <input ${attrs} class="input" data-key="${key}" data-type="${type}" value="${escHtml(val)}" style="flex:1;font-size:12px;padding:6px 8px">
        ${(suffix && suffix !== 'R$') ? `<span class="tiny muted">${suffix}</span>` : ''}
      </div>
    </div>
  `;
}

function kpi(label, value, bg, color) {
  return `
    <div style="background:${bg};color:${color || '#fff'};padding:12px;border-radius:8px;text-align:center">
      <div style="font-size:9px;text-transform:uppercase;opacity:.7;font-weight:700">${label}</div>
      <div style="font-size:16px;font-weight:800;margin-top:4px">${value}</div>
    </div>
  `;
}

function miniKpi(label, value, sub) {
  return `
    <div style="background:var(--bg-3);padding:10px;border-radius:8px">
      <div class="tiny muted">${label}</div>
      <div style="font-weight:800;font-size:14px;color:var(--tx)">${value}</div>
      ${sub ? `<div class="tiny muted">${sub}</div>` : ''}
    </div>
  `;
}

function fmt(n) { return 'R$ ' + Math.round(n).toLocaleString('pt-BR'); }
