/* ============================================================================
   PSM-OS v2 — Minha Comissão  v84.51
   ----------------------------------------------------------------------------
   A comissão do PRÓPRIO usuário, lida do motor de comissionamento (não do NIBO).
   O recorte vem pronto do backend (/api/v3/comissao/minha) — a tela nunca recebe
   o dinheiro de outra pessoa.
     • Leire     → reativações fechadas + bônus de volume + quanto falta pro próximo
     • Mariane   → indicações fechadas + faixa progressiva
     • MAP       → vendas + taxa (origem × senioridade) + régua do Sênior
     • Conquista → vendas + taxa por origem + acelerador N4 (sem senioridade)
   Sem dado inventado: quem não tem nada no mês vê estado vazio honesto.
============================================================================ */
import { api } from '../api.js';

const brl = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const pct = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const mult = n => '×' + Number(n || 1).toLocaleString('pt-BR', { minimumFractionDigits: 1 });

let _root = null, _d = null, _mes = '';

export async function pageMinhaComissao(ctx, root) {
  _root = root;
  if (!_mes) { const d = new Date(); _mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Calculando sua comissão…</div></div>';
  try {
    _d = await api.request('/api/v3/comissao/minha?mes=' + encodeURIComponent(_mes));
    render();
  } catch (e) {
    _root.innerHTML = `<div class="card"><b>Não consegui carregar sua comissão.</b><div class="tiny muted mt-1">${esc(e.message || e)}</div></div>`;
  }
}

function mesShift(n) {
  const [y, m] = _mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  _mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  load();
}

/* quantos fechamentos faltam pra próxima faixa de bônus/valor */
function proxFaixa(faixas, n) {
  const fx = (faixas || []).slice().sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < fx.length; i++) {
    if (n <= fx[i][0]) {
      const prox = fx[i + 1];
      if (!prox) return null;
      return { faltam: fx[i][0] + 1 - n, valor: prox[1] };
    }
  }
  return null;
}

function render() {
  const total = (_d.leire?.total || 0) + (_d.mariane?.total || 0)
    + (_d.map?.comissao_total || 0) + (_d.conquista?.comissao_total || 0);
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">💰 Minha Comissão</h2>
        <span class="tiny muted">${esc(_d.quem || '')}</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-ghost btn-sm" id="mc-prev">‹</button>
        <b class="tiny" style="min-width:74px;text-align:center">${esc(_d.mes)}</b>
        <button class="btn btn-ghost btn-sm" id="mc-next">›</button>
      </div>
      ${_d.tem_algo ? `<div class="mt-2" style="background:#16a34a15;border-radius:10px;padding:10px 14px;border-left:3px solid #16a34a">
        <div class="tiny muted">Sua comissão neste mês</div>
        <div style="font-weight:900;font-size:26px">${brl(total)}</div>
      </div>` : ''}
    </div>
    ${_d.leire ? blocoLeire(_d.leire) : ''}
    ${_d.mariane ? blocoMariane(_d.mariane) : ''}
    ${_d.map ? blocoMap(_d.map, _d.map_regua) : ''}
    ${_d.conquista ? blocoConquista(_d.conquista) : ''}
    ${!_d.tem_algo ? `<div class="card mt-2"><div class="muted" style="text-align:center;padding:22px">
      <div style="font-size:30px">🌱</div>
      <b>Nada fechou pra você em ${esc(_d.mes)} ainda.</b>
      <div class="tiny mt-1">Quando um negócio seu for ganho no RD, ele aparece aqui com o cálculo completo.</div>
    </div></div>` : ''}`;
  _root.querySelector('#mc-prev').onclick = () => mesShift(-1);
  _root.querySelector('#mc-next').onclick = () => mesShift(1);
}

/* ── 🔁 Reativação (Leire) ──────────────────────────────────────────────── */
function blocoLeire(m) {
  const p = proxFaixa(m.volume, m.qtd || 0);
  return `<div class="card mt-2">
    <b>🔁 Minhas reativações</b>
    <div class="flex items-center mt-2" style="gap:10px;flex-wrap:wrap">
      <div><div class="tiny muted">Fechadas no mês</div><div style="font-weight:900;font-size:22px">${m.qtd || 0}</div></div>
      <div><div class="tiny muted">Base</div><div style="font-weight:800">${brl(m.base)}</div></div>
      <div><div class="tiny muted">Bônus de volume</div><div style="font-weight:800;color:#16a34a">${mult(m.mult)}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="tiny muted">Sua comissão</div><div style="font-weight:900;font-size:20px;color:#16a34a">${brl(m.total)}</div></div>
    </div>
    ${m.no_teto ? `<div class="tiny mt-2" style="background:#f59e0b15;padding:6px 10px;border-radius:8px;border-left:3px solid #f59e0b">🏆 Você bateu o teto de ${brl(m.teto)} neste mês.</div>`
      : p ? `<div class="tiny mt-2" style="background:#2563eb12;padding:6px 10px;border-radius:8px;border-left:3px solid #2563eb">🎯 Faltam <b>${p.faltam} fechamento(s)</b> pro seu bônus subir pra <b>${mult(p.valor)}</b> — e o bônus vale pra <b>todas</b> as reativações do mês, não só a próxima.</div>` : ''}
    ${(m.fechadas || []).length ? `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 6px">Cliente</th><th style="text-align:right">VGV</th><th>Tipo</th><th style="text-align:right">Vale</th></tr>
      ${m.fechadas.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px">${esc(f.nome || '—')}</td>
        <td style="text-align:right">${brl(f.vgv)}</td>
        <td class="tiny">${f.tipo === 'lancamento' ? '🚀 Lançamento' : '🎯 Estoque'}</td>
        <td style="text-align:right;font-weight:700">${brl(f.valor)}</td>
      </tr>`).join('')}
    </table>` : ''}
  </div>`;
}

/* ── 🎁 Indicações (Mariane) ────────────────────────────────────────────── */
function blocoMariane(m) {
  const p = proxFaixa(m.faixas, m.qtd || 0);
  return `<div class="card mt-2">
    <b>🎁 Minhas indicações</b>
    <div class="flex items-center mt-2" style="gap:10px;flex-wrap:wrap">
      <div><div class="tiny muted">Fecharam no mês</div><div style="font-weight:900;font-size:22px">${m.qtd || 0}</div></div>
      <div><div class="tiny muted">Valor por indicação</div><div style="font-weight:800">${brl(m.rate)}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="tiny muted">Sua comissão</div><div style="font-weight:900;font-size:20px;color:#16a34a">${brl(m.total)}</div></div>
    </div>
    ${m.no_teto ? `<div class="tiny mt-2" style="background:#f59e0b15;padding:6px 10px;border-radius:8px;border-left:3px solid #f59e0b">🏆 Você bateu o teto de ${brl(m.teto)} neste mês.</div>`
      : p ? `<div class="tiny mt-2" style="background:#2563eb12;padding:6px 10px;border-radius:8px;border-left:3px solid #2563eb">🎯 Faltam <b>${p.faltam} indicação(ões)</b> pra cada uma passar a valer <b>${brl(p.valor)}</b> — retroativo pra todas do mês.</div>` : ''}
    ${(m.fechadas || []).length ? `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 6px">Indicou</th><th>Indicado</th><th style="text-align:right">Negócio</th></tr>
      ${m.fechadas.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px">${esc(f.indicador || '—')}</td><td>${esc(f.indicado || '—')}</td>
        <td style="text-align:right">${brl(f.valor_negocio)}</td>
      </tr>`).join('')}
    </table>` : ''}
  </div>`;
}

/* ── 🏢 Vendas MAP (régua do Sênior — SÓ o time MAP tem) ────────────────── */
function blocoMap(c, regua) {
  const min = (regua && regua.senior_vgv_min) || 3000000;
  const prog = Math.min(100, ((c.vgv_ano || 0) / min) * 100);
  const ehSenior = c.senioridade === 'senior';
  return `<div class="card mt-2">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>🏢 Minhas vendas · Empreendimentos</b>
      <span class="tiny" style="background:${ehSenior ? '#16a34a' : '#2563eb'}20;color:${ehSenior ? '#16a34a' : '#2563eb'};border-radius:20px;padding:2px 9px;font-weight:800">${esc(c.senioridade_lbl)}</span>
      <span style="margin-left:auto;font-weight:900;font-size:20px;color:#16a34a">${brl(c.comissao_total)}</span>
    </div>
    <div class="mt-2">
      <div class="flex tiny muted" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span>VGV no ano: <b>${brl(c.vgv_ano)}</b></span>
        <span>${ehSenior ? '🏆 Corretor Sênior' : `faltam <b>${brl(c.falta_senior)}</b> pra Sênior`} · meta ${brl(min)}</span>
      </div>
      <div style="height:8px;background:var(--bd,#eef2f7);border-radius:20px;overflow:hidden;margin-top:4px">
        <div style="height:100%;width:${prog}%;background:${ehSenior ? '#16a34a' : '#2563eb'};border-radius:20px"></div>
      </div>
      ${!ehSenior ? '<div class="tiny muted mt-1">Ao cruzar a meta, você vira Sênior <b>automaticamente</b> e suas taxas sobem.</div>' : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 6px">Cliente</th><th>Origem</th><th style="text-align:right">VGV</th><th style="text-align:right">Taxa</th><th style="text-align:right">Comissão</th></tr>
      ${(c.vendas || []).map(v => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px">${esc(v.cliente || '—')}</td>
        <td class="tiny ${v.definida ? '' : 'muted'}">${esc(v.origem_lbl)}</td>
        <td style="text-align:right">${brl(v.vgv)}</td>
        <td style="text-align:right;font-weight:700">${pct(v.taxa)}</td>
        <td style="text-align:right;font-weight:700">${brl(v.comissao)}</td>
      </tr>`).join('')}
    </table>
  </div>`;
}

/* ── 👥 Vendas Conquista (acelerador N4 — sem senioridade) ──────────────── */
function blocoConquista(c) {
  return `<div class="card mt-2">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>👥 Minhas vendas · Conquista</b>
      ${c.acelerador ? '<span class="tiny" style="background:#16a34a20;color:#16a34a;border-radius:20px;padding:2px 9px;font-weight:800">🚀 Acelerador ativo · 1,9%</span>' : ''}
      <span style="margin-left:auto;font-weight:900;font-size:20px;color:#16a34a">${brl(c.comissao_total)}</span>
    </div>
    <div class="tiny muted mt-1">VGV no mês ${brl(c.vgv_total)} · em origens N2/N3 ${brl(c.vgv_n2n3)}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 6px">Cliente</th><th>Origem</th><th style="text-align:right">VGV</th><th style="text-align:right">Taxa</th><th style="text-align:right">Comissão</th></tr>
      ${(c.vendas || []).map(v => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:6px">${esc(v.cliente || '—')}</td>
        <td class="tiny ${v.definida ? '' : 'muted'}">${esc(v.origem_lbl)}${v.acelerada ? ' 🚀' : ''}</td>
        <td style="text-align:right">${brl(v.vgv)}</td>
        <td style="text-align:right;font-weight:700">${pct(v.taxa_aplicada)}</td>
        <td style="text-align:right;font-weight:700">${brl(v.comissao_liquida)}${v.desconto_indicacao ? `<div class="tiny muted">− ${brl(v.desconto_indicacao)} indic.</div>` : ''}</td>
      </tr>`).join('')}
    </table>
  </div>`;
}
