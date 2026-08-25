/* PSM-OS v2 — 🎯 Produtividade Real (v86.78)
   Peça 6 da spec: as 3 camadas por corretor + QUADRANTE atividade × rendimento.
   Camada 1 esforço (toques/visitas, registro no ato) · Camada 2 rendimento
   (conversão vs mediana do MESMO funil, no-show, pasta, SLA 1º contato) ·
   Camada 3 resultado (vendas/VGV na janela, forecast declarado).
   REGRA DURA: esta tela NUNCA vai pro modo TV nem vira ranking público —
   rendimento individual é conversa de 1:1 e de Reunião de Gestão.
   Backend: /api/v3/producao/produtividade (cache 10 min). lvl>=5. */
import { api } from '../api.js';

let _root = null, _d = null, _janela = 90;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n || 0));

const QUAD = {
  maquina:             ['🟢 Máquina', '#16a34a', 'Alta atividade, alto rendimento — dar MAIS lead: é o melhor ROI da casa.'],
  talento_ocioso:      ['🔵 Talento ocioso', '#2563eb', 'Converte bem e trabalha pouco — cobrar VOLUME: o upside mais barato.'],
  esforco_sem_tecnica: ['🟡 Esforço sem técnica', '#d97706', 'Trabalha muito e converte pouco — role-play, campo com o gestor, revisar script.'],
  escada:              ['🔴 Escada', '#dc2626', 'Atividade e rendimento baixos — degrau 1 da escada de consequência, no 1:1.'],
};

export async function pageProdutividadeReal(ctx, root) {
  _root = root;
  await load();
}

async function load() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Calculando produtividade real (janela ' + _janela + 'd)…</div></div>';
  try {
    _d = await api.request('/api/v3/producao/produtividade?janela=' + _janela);
  } catch (e) {
    _root.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message || e)}</div></div>`;
    return;
  }
  render();
}

function render() {
  const cs = (_d.corretores || []).slice().sort((a, b) => (b.toques_7d || 0) - (a.toques_7d || 0));
  const linha = c => {
    const q = QUAD[c.quadrante];
    return `<tr>
      <td style="font-weight:700;white-space:nowrap">${esc(c.corretor)}<div class="tiny muted">${esc(c.funil)}</div></td>
      <td>${q ? `<span title="${esc(q[2])}" style="color:${q[1]};font-weight:800;white-space:nowrap">${q[0]}</span>`
             : `<span class="tiny muted" title="Amostra < 30 leads ou sem atividade registrada — mês 1 é baseline">— baseline</span>`}</td>
      <td style="text-align:right">${c.toques_7d || 0}<div class="tiny muted">${c.atividade_pct != null ? c.atividade_pct + '% da meta' : ''}</div></td>
      <td style="text-align:right">${c.visitas_7d || 0}</td>
      <td style="text-align:right">${c.no_show_pct != null ? c.no_show_pct + '%' : '—'}</td>
      <td style="text-align:right">${c.sla_mediana_min != null ? c.sla_mediana_min + ' min' : '—'}<div class="tiny muted">${c.sla_amostra ? 'n=' + c.sla_amostra : ''}</div></td>
      <td style="text-align:right">${c.leads_janela}</td>
      <td style="text-align:right">${c.conv_pct != null ? c.conv_pct + '%' : '—'}<div class="tiny muted">${c.conv_equipe_pct != null ? 'equipe ' + c.conv_equipe_pct + '%' : ''}</div></td>
      <td style="text-align:right">${c.pasta_aprovacao_pct != null ? c.pasta_aprovacao_pct + '%' : '—'}${c.pasta_reprovacao_pct ? `<div class="tiny" style="color:#dc2626">reprova ${c.pasta_reprovacao_pct}%</div>` : ''}</td>
      <td style="text-align:right">${c.vendas_janela}<div class="tiny muted">R$ ${fmtK(c.vgv_janela)}</div></td>
      <td>${c.forecast_mes ? `<span class="tiny">${c.forecast_mes.comprometido}/${c.forecast_mes.provavel}/${c.forecast_mes.pipeline}</span>` : '<span class="tiny muted">não declarou</span>'}</td>
    </tr>`;
  };
  _root.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2" style="justify-content:space-between;flex-wrap:wrap">
        <div>
          <h3 class="card-title" style="margin:0">🎯 Produtividade Real</h3>
          <div class="tiny muted">Esforço (7d) · Rendimento (${_d.janela_dias}d, vs mediana do MESMO funil, amostra mín. 30 leads) · Resultado</div>
        </div>
        <div class="flex items-center gap-2">
          ${[30, 90, 180].map(j => `<button class="btn btn-sm ${j === _janela ? 'btn-primary' : ''}" data-j="${j}">${j}d</button>`).join('')}
        </div>
      </div>
      <div class="alert" style="margin:10px 0;font-size:12px">🔒 Esta tela não vai pra TV nem vira ranking público — rendimento individual é conversa de 1:1 e de Reunião de Gestão. Venda dentro da faixa de Poisson nunca é falha.</div>
      ${(_d.fora_da_lista || []).length ? `<div class="tiny muted" style="margin:-4px 0 10px">
        👤 Só <b>corretor ativo</b> entra aqui. Fora da lista (${_d.fora_da_lista.length}):
        ${_d.fora_da_lista.map(f => `${esc(f.quem)} <span style="opacity:.7">(${esc(f.motivo)})</span>`).join(' · ')}
      </div>` : ''}
      ${_d.filtro_aplicado === false ? `<div class="alert alert-warn tiny" style="margin:-4px 0 10px">⚠️ Não consegui ler o cadastro de usuários agora — a lista está <b>sem filtro</b> (pode conter sócio, gerente ou quem já saiu).</div>` : ''}
      <div style="overflow-x:auto">
        <table class="table" style="min-width:980px;font-size:13px">
          <thead><tr>
            <th>Corretor</th><th>Quadrante</th><th style="text-align:right">Toques 7d</th>
            <th style="text-align:right">Visitas 7d</th><th style="text-align:right">No-show</th>
            <th style="text-align:right">1º contato</th><th style="text-align:right">Leads</th>
            <th style="text-align:right">Conv.</th><th style="text-align:right">Pasta aprova</th>
            <th style="text-align:right">Vendas</th><th>Forecast C/P/P</th>
          </tr></thead>
          <tbody>${cs.length ? cs.map(linha).join('') : '<tr><td colspan="11" class="muted">Sem dados na janela — os eventos começam a contar com a rotina nova (registro no ato + campos do RD).</td></tr>'}</tbody>
        </table>
      </div>
      <div class="tiny muted" style="margin-top:10px">
        Fontes: producao_eventos (toques/visitas — registro no ato e campos personalizados do RD) · espelho deal_stage_events ·
        deals (safra ${_d.janela_dias}d) · forecast declarado no Meu Painel. Cache 10 min.
        Metas de partida: ${esc(JSON.stringify(_d.metas || {}))} — mês 1 é BASELINE (medir sem cobrar).
      </div>
    </div>`;
  _root.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { _janela = +b.dataset.j; load(); });
}
