/* PSM-OS v2 — 💰 Comissionamento Conquista + Mariane (v84.45)
   Matriz por origem (N1–N4), acelerador de R$ 850k, desconto de indicação na
   fonte e comissão fixa da Mariane. Tudo config-driven (shared_kv comissao_cfg),
   editável pela direção. Origem híbrida: RD (mapa) + ajuste manual por venda.
   Backend: /api/v3/comissao/calc */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _d = null, _mes = '', _aba = 'corretores', _busy = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + '%';
const NIVEL_COR = { 1: '#64748b', 2: '#2563eb', 3: '#7c3aed', 4: '#16a34a' };

export async function pageComissaoConquista(ctx, root) { _root = root; await reload(); }

async function reload() {
  if (!_root) return;
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Calculando comissões…</div></div>';
  try {
    _d = await api.request('/api/v3/comissao/calc' + (_mes ? '?mes=' + _mes : ''));
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    return;
  }
  _mes = _d.mes;
  render();
}

async function post(body, okMsg) {
  if (_busy) return null;
  _busy = true;
  let r = null;
  try { r = await api.request('/api/v3/comissao/calc', { method: 'POST', body }); if (okMsg) alert(okMsg); }
  catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  _busy = false;
  return r;
}

function mesShift(delta) {
  const [y, m] = _mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  _mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  reload();
}

const canEdit = () => (auth.user()?.lvl || 0) >= 7;

function render() {
  const podeEditar = canEdit();
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <h2 class="card-title" style="margin:0">💰 Comissionamento Conquista</h2>
        <span class="tiny muted">matriz por origem · acelerador R$ 850k → 1,9% · indicação da operação descontada na fonte</span>
        <span style="margin-left:auto"></span>
        <button class="btn btn-ghost btn-sm" id="cm-prev">‹</button>
        <b class="tiny" style="min-width:74px;text-align:center">${esc(_mes)}</b>
        <button class="btn btn-ghost btn-sm" id="cm-next">›</button>
        <button class="btn btn-ghost btn-sm" id="cm-reload">↻</button>
      </div>
      <div class="flex mt-2" style="gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${_aba === 'corretores' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-c">👥 Corretores</button>
        <button class="btn btn-sm ${_aba === 'mariane' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-m">🎁 Mariane</button>
        <button class="btn btn-sm ${_aba === 'config' ? 'btn-primary' : 'btn-ghost'}" id="cm-ab-cfg">📊 Regras & Origens</button>
      </div>
    </div>
    <div class="mt-2">${_aba === 'corretores' ? htmlCorretores() : _aba === 'mariane' ? htmlMariane() : htmlConfig(podeEditar)}</div>`;
  _root.querySelector('#cm-prev').onclick = () => mesShift(-1);
  _root.querySelector('#cm-next').onclick = () => mesShift(1);
  _root.querySelector('#cm-reload').onclick = reload;
  _root.querySelector('#cm-ab-c').onclick = () => { _aba = 'corretores'; render(); };
  _root.querySelector('#cm-ab-m').onclick = () => { _aba = 'mariane'; render(); };
  _root.querySelector('#cm-ab-cfg').onclick = () => { _aba = 'config'; render(); };
  if (_aba === 'corretores') wireCorretores();
  if (_aba === 'config') wireConfig();
}

/* ── 👥 Corretores ──────────────────────────────────────────────────────── */
function htmlCorretores() {
  const cs = _d.corretores || [];
  if (!cs.length) return '<div class="card muted" style="text-align:center;padding:26px">Nenhuma venda Conquista fechada neste mês.</div>';
  const totalGeral = cs.reduce((s, c) => s + c.comissao_total, 0);
  const vgvGeral = cs.reduce((s, c) => s + c.vgv_total, 0);
  return `
    <div class="flex" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1;min-width:150px;background:var(--bg-2);border-radius:10px;padding:8px 12px"><div class="tiny muted">VGV Conquista do mês</div><div style="font-weight:900;font-size:17px">${brl(vgvGeral)}</div></div>
      <div style="flex:1;min-width:150px;background:var(--bg-2);border-radius:10px;padding:8px 12px;border-left:3px solid #16a34a"><div class="tiny muted">Comissão total a pagar</div><div style="font-weight:900;font-size:17px">${brl(totalGeral)}</div></div>
      <div style="flex:1;min-width:120px;background:var(--bg-2);border-radius:10px;padding:8px 12px"><div class="tiny muted">Corretores</div><div style="font-weight:900;font-size:17px">${cs.length}</div></div>
    </div>
    ${cs.map(corretorCard).join('')}`;
}

function corretorCard(c) {
  const acel = c.acelerador;
  return `<div class="card" style="margin:0 0 10px;padding:12px 14px">
    <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
      <b>${esc(c.corretor_nome)}</b>
      <span class="badge">${c.n_vendas} venda(s)</span>
      <span class="tiny muted">VGV ${brl(c.vgv_total)} · N2/N3 ${brl(c.vgv_n2n3)}</span>
      ${acel ? '<span class="badge" style="background:#16a34a22;color:#16a34a;font-weight:800">🚀 Acelerador N4 (1,9%)</span>'
             : `<span class="tiny muted">faltam ${brl(Math.max(0, (_d.cfg.acelerador?.vgv_min || 850000) - c.vgv_n2n3))} p/ o N4</span>`}
      <b style="margin-left:auto;color:#16a34a;font-size:16px">${brl(c.comissao_total)}</b>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:3px 6px">Cliente</th><th>Origem</th><th style="text-align:right">VGV</th><th style="text-align:right">Taxa</th><th style="text-align:right">Desc. indic.</th><th style="text-align:right">Comissão</th><th></th></tr>
      ${c.vendas.map(v => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
        <td style="padding:5px 6px">${esc(v.cliente || '—')}</td>
        <td><span style="color:${v.definida ? (NIVEL_COR[v.acelerada ? 4 : v.nivel] || '#64748b') : '#dc2626'};font-weight:700">${esc(v.origem_lbl)}${v.acelerada ? ' 🚀' : ''}</span>${v.fonte_rd ? `<div class="tiny muted">RD: ${esc(v.fonte_rd)}</div>` : ''}</td>
        <td style="text-align:right">${brl(v.vgv)}</td>
        <td style="text-align:right;font-weight:700">${pct(v.taxa_aplicada)}</td>
        <td style="text-align:right;color:${v.desconto_indicacao ? '#dc2626' : 'inherit'}">${v.desconto_indicacao ? '− ' + brl(v.desconto_indicacao) : '—'}</td>
        <td style="text-align:right;font-weight:800">${brl(v.comissao_liquida)}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm cm-ori" data-did="${esc(v.deal_id)}" title="Definir/corrigir a origem desta venda" style="padding:1px 7px;font-size:11px">✏️</button></td>
      </tr>`).join('')}
    </table>
  </div>`;
}

function wireCorretores() {
  _root.querySelectorAll('.cm-ori').forEach(b => b.onclick = () => abrirOrigem(b.dataset.did));
}

function abrirOrigem(did) {
  const origens = _d.cfg.origens || [];
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `<div class="card" style="max-width:440px;width:100%;background:var(--bg-2)">
    <h3 class="card-title" style="margin:0">✏️ Origem da venda</h3>
    <div class="tiny muted">Ajuste manual (vale mais que o RD). Decide o nível e a taxa.</div>
    <div class="flex mt-2" style="gap:5px;flex-wrap:wrap">
      ${origens.map(o => `<button class="btn btn-ghost btn-sm cm-op" data-o="${esc(o.id)}" style="padding:3px 10px;border:1px solid ${NIVEL_COR[o.nivel]}55">N${o.nivel} · ${esc(o.rotulo)} (${pct(o.taxa)})</button>`).join('')}
    </div>
    <div class="flex mt-3" style="gap:6px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="cm-op-clear">Limpar (voltar pro RD)</button>
      <button class="btn btn-ghost btn-sm" id="cm-op-x">Fechar</button>
    </div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  if (!canEdit()) { ov.querySelectorAll('button').forEach(b => { if (!b.id) b.disabled = true; }); }
  ov.querySelectorAll('.cm-op').forEach(b => b.onclick = async () => {
    const r = await post({ action: 'set_origem', deal_id: did, origem: b.dataset.o }); if (r) { ov.remove(); reload(); }
  });
  ov.querySelector('#cm-op-clear').onclick = async () => { const r = await post({ action: 'set_origem', deal_id: did, origem: '' }); if (r) { ov.remove(); reload(); } };
  ov.querySelector('#cm-op-x').onclick = () => ov.remove();
}

/* ── 🎁 Mariane ─────────────────────────────────────────────────────────── */
function htmlMariane() {
  const m = _d.mariane || {};
  return `<div class="card">
    <div class="flex items-center" style="gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px"><div class="tiny muted">Indicações da operação fechadas em ${esc(_mes)}</div><div style="font-weight:900;font-size:22px">${m.qtd || 0}</div></div>
      <div style="min-width:150px"><div class="tiny muted">Valor por indicação</div><div style="font-weight:800;font-size:16px">${brl(m.valor_por_indicacao)}</div></div>
      <div style="min-width:170px;background:#16a34a15;border-radius:10px;padding:8px 12px;border-left:3px solid #16a34a"><div class="tiny muted">Comissão da Mariane no mês</div><div style="font-weight:900;font-size:20px">${brl(m.total)}</div></div>
    </div>
    <div class="tiny muted mt-2">Conta as indicações que a OPERAÇÃO dela gerou e fecharam (viraram venda) no mês. O valor por indicação é editável em Regras & Origens.</div>
    <div class="mt-2">${(m.fechadas || []).length ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Indicador</th><th>Indicado</th><th style="text-align:right">VGV</th></tr>
      ${m.fechadas.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:6px 8px">${esc(f.indicador || '—')}</td><td>${esc(f.indicado || '—')}</td><td style="text-align:right">${f.vgv ? brl(f.vgv) : '—'}</td></tr>`).join('')}
    </table>` : '<div class="muted tiny" style="text-align:center;padding:16px">Nenhuma indicação da operação fechou neste mês ainda.</div>'}</div>
  </div>`;
}

/* ── 📊 Regras & Origens ────────────────────────────────────────────────── */
function htmlConfig(podeEditar) {
  const cfg = _d.cfg || {};
  const porNivel = {};
  (cfg.origens || []).forEach(o => { (porNivel[o.nivel] = porNivel[o.nivel] || []).push(o); });
  const acel = cfg.acelerador || {};
  const fontes = _d.fontes_rd || [];
  const origens = cfg.origens || [];
  return `
    <div class="card">
      <b class="tiny">🎯 Matriz de comissão por origem</b>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
        <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Nível</th><th>Origens</th><th style="text-align:right">Taxa</th></tr>
        <tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:6px 8px"><b style="color:${NIVEL_COR[1]}">N1</b></td><td>Estagiário</td><td style="text-align:right;font-weight:800">${pct(cfg.taxa_estagiario)}</td></tr>
        ${[1, 2, 3].map(n => (porNivel[n] || []).length ? `<tr style="border-top:1px solid var(--bd,#eef2f7)"><td style="padding:6px 8px"><b style="color:${NIVEL_COR[n]}">N${n}</b></td><td>${porNivel[n].map(o => esc(o.rotulo)).join(' · ')}</td><td style="text-align:right;font-weight:800">${pct(porNivel[n][0].taxa)}</td></tr>` : '').join('')}
        <tr style="border-top:1px solid var(--bd,#eef2f7);background:#16a34a10"><td style="padding:6px 8px"><b style="color:${NIVEL_COR[4]}">N4 🚀</b></td><td>Acelerador: VGV mensal N2/N3 ≥ ${brl(acel.vgv_min)} → todas as vendas N2/N3 do mês sobem</td><td style="text-align:right;font-weight:800">${pct(acel.taxa)}</td></tr>
      </table>
      ${podeEditar ? `<div class="flex mt-2" style="gap:6px;flex-wrap:wrap;align-items:center">
        <label class="tiny">Estagiário <input class="input" id="cf-estag" type="number" step="0.1" value="${cfg.taxa_estagiario}" style="width:70px;padding:2px 6px">%</label>
        ${origens.map(o => `<label class="tiny">${esc(o.rotulo)} <input class="input cf-taxa" data-o="${esc(o.id)}" type="number" step="0.1" value="${o.taxa}" style="width:64px;padding:2px 6px">%</label>`).join('')}
        <label class="tiny">Acelerador ≥ <input class="input" id="cf-acmin" type="number" value="${acel.vgv_min}" style="width:110px;padding:2px 6px"> → <input class="input" id="cf-actaxa" type="number" step="0.1" value="${acel.taxa}" style="width:64px;padding:2px 6px">%</label>
        <label class="tiny">🎁 Mariane por indicação R$ <input class="input" id="cf-mari" type="number" step="1" value="${cfg.mariane_valor_indicacao}" style="width:90px;padding:2px 6px"></label>
        <button class="btn btn-primary btn-sm" id="cf-save">💾 Salvar regras</button>
      </div>` : '<div class="tiny muted mt-1">Só a direção (nível ≥ 7) edita as regras.</div>'}
    </div>
    <div class="card mt-2">
      <b class="tiny">🔗 Origens do RD → nível ${podeEditar ? '(mapeie cada fonte que aparece nas vendas)' : ''}</b>
      <div class="tiny muted">Fontes que apareceram nas vendas Conquista deste mês. As não mapeadas caem em "origem indefinida" (ajuste manual por venda também funciona).</div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px">
        <tr class="tiny muted" style="text-align:left"><th style="padding:4px 8px">Fonte no RD</th><th style="text-align:right">Vendas</th><th>Mapeia para</th></tr>
        ${fontes.length ? fontes.map(f => `<tr style="border-top:1px solid var(--bd,#eef2f7)">
          <td style="padding:6px 8px">${esc(f.fonte)}</td>
          <td style="text-align:right">${f.n}</td>
          <td>${podeEditar ? `<select class="input cf-map" data-fonte="${esc(f.fonte)}" style="padding:2px 6px;font-size:12px">
            <option value="">— indefinida —</option>
            ${origens.map(o => `<option value="${esc(o.id)}"${(cfg.mapa_rd || {})[f.fonte.toLowerCase()] === o.id ? ' selected' : ''}>N${o.nivel} · ${esc(o.rotulo)}</option>`).join('')}
          </select>` : `<span class="tiny ${f.mapeada ? '' : 'muted'}">${f.mapeada ? 'mapeada' : '⚠️ indefinida'}</span>`}</td>
        </tr>`).join('') : '<tr><td colspan="3" class="muted tiny" style="padding:12px;text-align:center">Nenhuma venda no mês pra listar fontes.</td></tr>'}
      </table>
      ${podeEditar && fontes.length ? '<button class="btn btn-primary btn-sm mt-2" id="cf-savemap">💾 Salvar mapeamento</button>' : ''}
    </div>`;
}

function wireConfig() {
  const $ = s => _root.querySelector(s);
  if ($('#cf-save')) $('#cf-save').onclick = async () => {
    const origens = (_d.cfg.origens || []).map(o => {
      const inp = _root.querySelector(`.cf-taxa[data-o="${o.id}"]`);
      return { ...o, taxa: inp ? Number(inp.value) : o.taxa };
    });
    const cfg = {
      taxa_estagiario: Number($('#cf-estag').value) || _d.cfg.taxa_estagiario,
      origens,
      acelerador: { ...(_d.cfg.acelerador || {}), vgv_min: Number($('#cf-acmin').value) || 850000, taxa: Number($('#cf-actaxa').value) || 1.9 },
      mariane_valor_indicacao: Number($('#cf-mari').value) || 0,
    };
    const r = await post({ action: 'set_cfg', cfg }, '💾 Regras atualizadas.'); if (r) reload();
  };
  if ($('#cf-savemap')) $('#cf-savemap').onclick = async () => {
    const mapa = {};
    _root.querySelectorAll('.cf-map').forEach(s => { if (s.value) mapa[s.dataset.fonte.toLowerCase()] = s.value; });
    const r = await post({ action: 'set_cfg', cfg: { mapa_rd: mapa } }, '💾 Mapeamento salvo.'); if (r) reload();
  };
}
