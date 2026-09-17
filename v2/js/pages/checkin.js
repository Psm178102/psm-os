/* ============================================================================
   PSM-OS v2 — 🕵️ Check-in / Check-out do SISTEMA  (v88.5)

   Pedido do Paulo (17/09/2026): esta aba PAROU de ser o botão de presença que
   todo corretor apertava (teve 1 uso na história inteira) e virou o mapa de
   quem realmente usa o House. Ninguém executa tarefa aqui e SÓ SÓCIO vê.

   O que cada coluna significa (fonte: user_sessions, via /api/v3/checkin/uso):
     · ENTROU      = hora do login
     · TEMPO REAL  = soma do tempo com a tela aberta. O app manda um sinal de
                     vida a cada ~1min enquanto a aba está visível; intervalo
                     maior que 3min (aba fechada) não conta. Não é "token ativo".
     · FECHOU      = clicou Sair (logout) ou parou de dar sinal (fechou a aba)

   Registro silencioso: o sinal pega carona no pulso que o app já dispara, então
   não aparece requisição nova no navegador de quem está sendo medido.
   Tempo de permanência existe só para sessões a partir da v88.5 — login mais
   antigo aparece com a data de entrada e "—" no tempo.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null;
let _data = null;
let _dias = 30;
let _aberto = null;      // user_id expandido
let _lido = null;        // hora da última leitura

export async function pageCheckin(ctx, root) {
  _root = root;
  // 🔒 trava da própria página (o backend exige min_lvl=10 de novo — cinto e
  // suspensório: aqui é a tela, lá é a fronteira real).
  if ((auth.user()?.lvl || 0) < 10) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Esta tela é restrita aos Sócios.</div>';
    return;
  }
  await reload();
}

async function reload() {
  _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Lendo os acessos…</div></div>';
  try {
    _data = await api.request('/api/v3/checkin/uso?dias=' + _dias);
    _lido = new Date();
    render();
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Erro ao ler os acessos: ${esc(e.message)}</div>`;
  }
}

/* ───────────────────────── render ───────────────────────── */

function render() {
  const t = _data.totais || {};
  const pessoas = (_data.pessoas || []).filter(p => !p.is_service);
  const servico = (_data.pessoas || []).filter(p => p.is_service);
  const fantasmas = _data.fantasmas || [];

  _root.innerHTML = `
    <div class="card">
      <h2 class="card-title">🕵️ Check-in / Check-out do sistema</h2>
      <p class="card-sub">
        Quem realmente abre o House, por quanto tempo e quando fechou.
        <b>Registro silencioso</b>: ninguém é avisado e a aba não aparece pra quem não é Sócio.
      </p>

      <div class="flex gap-3 items-center mt-3" style="padding:10px;background:var(--bg-3);border-radius:var(--r-sm);flex-wrap:wrap">
        <label class="tiny muted" style="font-weight:700;letter-spacing:1px">PERÍODO:</label>
        ${[7, 30, 90].map(d => `
          <button class="btn ${d === _dias ? 'btn-primary' : 'btn-ghost'} f-dias" data-d="${d}" style="padding:5px 14px;font-size:12px">${d} dias</button>
        `).join('')}
        <button id="f-reload" class="btn btn-ghost" style="margin-left:auto">🔄 Atualizar</button>
        <span class="tiny muted">${_lido ? 'lido ' + _lido.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>

      <div class="flex gap-3 mt-4" style="flex-wrap:wrap">
        ${kpi('🟢 Online agora', t.online_agora || 0, 'com a tela aberta neste momento')}
        ${kpi('👥 Usaram o sistema', t.pessoas_com_uso || 0, `entraram nos últimos ${_dias} dias`)}
        ${kpi('👻 Não abriram', t.pessoas_sem_uso || 0, 'login ativo, zero acesso no período', (t.pessoas_sem_uso || 0) > 0 ? 'var(--err-forte)' : null)}
        ${kpi('⏱ Tempo total de tela', dur(t.ativo_seg || 0), `em ${t.sessoes || 0} logins`)}
      </div>

      ${t.truncado ? '<div class="alert alert-warn mt-3 tiny">Muitos registros no período — a lista de logins foi cortada nos mais recentes (os totais por pessoa estão completos).</div>' : ''}

      <h3 class="card-title mt-4">🏁 Ranking de uso real</h3>
      <p class="tiny muted">Ordenado por tempo com a tela aberta. Clique numa pessoa pra ver login por login.</p>
      ${tabela(pessoas)}

      ${fantasmas.length ? `
        <h3 class="card-title mt-4" style="color:var(--err-forte)">👻 Não abriram o sistema nos últimos ${_dias} dias (${fantasmas.length})</h3>
        <p class="tiny muted">Login ativo, mas nenhum acesso no período. Esta é a lista que responde "quem não está usando".</p>
        <div style="display:grid;gap:6px;margin-top:8px">
          ${fantasmas.map(f => `
            <div style="display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--bg-3);border-left:3px solid var(--err-forte);border-radius:var(--r-sm);font-size:12.5px">
              <b>${esc(f.name)}</b>
              <span class="tiny muted">${esc(f.role)}</span>
              <span class="tiny" style="margin-left:auto;color:var(--ink-muted)">
                ${f.last_login_at ? 'último login ' + quando(f.last_login_at) : '<b style="color:var(--err-forte)">nunca entrou</b>'}
              </span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${servico.length ? `
        <h3 class="card-title mt-4">⚙️ Contas técnicas</h3>
        <p class="tiny muted">Não são pessoas (TV do escritório, integração) — ficam fora do ranking pra não distorcer o placar.</p>
        <div class="tiny muted mt-2">${servico.map(s => `${esc(s.name)}: ${dur(s.ativo_seg)} em ${s.sessoes} login(s)`).join(' · ')}</div>
      ` : ''}

      <p class="tiny muted mt-4" style="border-top:1px solid var(--border);padding-top:10px">
        <b>Como o tempo é medido:</b> o sistema registra um sinal de vida por minuto enquanto a tela
        está aberta. Aba fechada ou computador parado não conta — por isso "tempo real de tela" é
        sempre menor que a janela entre o login e o último sinal. Sessão anterior a esta versão
        aparece com a entrada registrada e <b>—</b> no tempo (não havia medição ainda).
      </p>
    </div>
  `;

  _root.querySelectorAll('.f-dias').forEach(b => b.addEventListener('click', () => {
    _dias = Number(b.dataset.d) || 30; _aberto = null; reload();
  }));
  document.getElementById('f-reload').addEventListener('click', reload);
  _root.querySelectorAll('.p-row').forEach(r => r.addEventListener('click', () => {
    _aberto = (_aberto === r.dataset.u) ? null : r.dataset.u;
    render();
  }));
}

function tabela(pessoas) {
  if (!pessoas.length) {
    return '<div class="muted text-center" style="padding:30px">Ninguém entrou no sistema neste período.</div>';
  }
  return `
    <div style="overflow-x:auto;margin-top:8px">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead>
          <tr style="text-align:left;color:var(--ink-muted)">
            <th style="padding:6px 8px;font-size:10.5px;letter-spacing:1px">PESSOA</th>
            <th style="padding:6px 8px;font-size:10.5px;letter-spacing:1px;text-align:right">LOGINS</th>
            <th style="padding:6px 8px;font-size:10.5px;letter-spacing:1px;text-align:right">TEMPO REAL DE TELA</th>
            <th style="padding:6px 8px;font-size:10.5px;letter-spacing:1px;text-align:right">MÉDIA/LOGIN</th>
            <th style="padding:6px 8px;font-size:10.5px;letter-spacing:1px;text-align:right">DIAS</th>
            <th style="padding:6px 8px;font-size:10.5px;letter-spacing:1px">ÚLTIMO SINAL</th>
          </tr>
        </thead>
        <tbody>
          ${pessoas.map(p => linhaPessoa(p)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function linhaPessoa(p) {
  const aberto = _aberto === p.user_id;
  const semMedida = p.medidas === 0;
  const inativo = String(p.status || 'ativo').toLowerCase() !== 'ativo';
  return `
    <tr class="p-row" data-u="${esc(p.user_id)}" style="cursor:pointer;border-top:1px solid var(--border);background:${aberto ? 'var(--bg-3)' : 'transparent'}">
      <td style="padding:8px">
        <span style="font-size:9px;vertical-align:middle">${p.online ? '🟢' : '⚪'}</span>
        <b>${esc(p.name)}</b>
        ${inativo ? '<span class="tiny" style="color:var(--err-forte)"> · desligado</span>' : ''}
        <div class="tiny muted">${esc(p.role)}${p.team ? ' · ' + esc(p.team) : ''}</div>
      </td>
      <td style="padding:8px;text-align:right">${p.sessoes}</td>
      <td style="padding:8px;text-align:right;font-weight:800;${semMedida ? 'color:var(--ink-muted)' : ''}">
        ${semMedida ? '—' : dur(p.ativo_seg)}
      </td>
      <td style="padding:8px;text-align:right">${semMedida ? '—' : dur(p.media_seg)}</td>
      <td style="padding:8px;text-align:right">${p.dias_com_login}<span class="tiny muted">/${_dias}</span></td>
      <td style="padding:8px;white-space:nowrap">${quando(p.ultimo)}</td>
    </tr>
    ${aberto ? `<tr style="background:var(--bg-3)"><td colspan="6" style="padding:0 8px 12px">${detalhe(p)}</td></tr>` : ''}
  `;
}

function detalhe(p) {
  const minhas = (_data.sessoes || []).filter(s => s.user_id === p.user_id);
  return `
    ${faixaDias(p)}
    <div style="display:grid;gap:5px;max-height:360px;overflow-y:auto;margin-top:10px">
      ${minhas.length ? minhas.map(s => linhaSessao(s)).join('')
        : '<div class="tiny muted" style="padding:10px">Logins fora da lista carregada (período muito cheio).</div>'}
    </div>
  `;
}

function linhaSessao(s) {
  const ent = new Date(s.entrou);
  const sai = s.saiu ? new Date(s.saiu) : null;
  const dia = ent.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hIn = ent.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hOut = sai ? sai.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  const FIM = {
    logout:     { t: '🚪 clicou Sair',      c: 'var(--ok-escuro)' },
    aberta:     { t: '🟢 ainda na tela',    c: 'var(--ok-escuro)' },
    fechou:     { t: '· fechou a aba',      c: 'var(--ink-muted)' },
    sem_medida: { t: '· sem medição',       c: 'var(--ink-muted)' },
  }[s.motivo] || { t: '', c: 'var(--ink-muted)' };
  const med = s.motivo !== 'sem_medida';
  return `
    <div style="display:grid;grid-template-columns:92px 1fr auto;gap:10px;align-items:center;padding:7px 10px;background:var(--bg-2, var(--bg-1));border:1px solid var(--border);border-radius:var(--r-sm)">
      <div class="tiny" style="font-weight:700;text-transform:uppercase">${esc(dia)}</div>
      <div>
        <b>${hIn}</b> <span class="muted">→</span> <b>${hOut}</b>
        <span class="tiny" style="color:${FIM.c}">${FIM.t}</span>
        <div class="tiny muted">${esc(s.device)}${s.ip ? ' · ' + esc(s.ip) : ''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:800">${med ? dur(s.ativo_seg) : '—'}</div>
        <div class="tiny muted">de tela${med && s.span_seg > s.ativo_seg ? ' · janela ' + dur(s.span_seg) : ''}</div>
      </div>
    </div>
  `;
}

/** Barrinhas de um dia por coluna — mostra se o uso é constante ou foi um pico. */
function faixaDias(p) {
  const dias = [];
  const hoje = new Date();
  for (let i = _dias - 1; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * 86400000);
    // dia LOCAL (o backend agrupa por dia de Brasília). toISOString() daria o dia
    // UTC e depois das 21h as barras sairiam deslocadas um dia.
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
              + '-' + String(d.getDate()).padStart(2, '0');
    dias.push({ iso, seg: (p.por_dia || {})[iso] || 0 });
  }
  const max = Math.max(1, ...dias.map(d => d.seg));
  return `
    <div style="margin-top:10px">
      <div class="tiny muted" style="margin-bottom:4px">TEMPO DE TELA POR DIA (últimos ${_dias} dias)</div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:44px">
        ${dias.map(d => `
          <div title="${d.iso}: ${d.seg ? dur(d.seg) : 'nada'}"
               style="flex:1;min-width:2px;height:${d.seg ? Math.max(8, Math.round((d.seg / max) * 100)) : 3}%;
                      background:${d.seg ? 'var(--psm-green, var(--ok))' : 'var(--border)'};border-radius:2px 2px 0 0"></div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ───────────────────────── helpers ───────────────────────── */

function kpi(label, value, sub, cor) {
  return `<div style="background:var(--bg-3);padding:12px 18px;border-radius:var(--r-sm);min-width:170px;flex:1">
    <div class="tiny muted">${label}</div>
    <div style="font-size:22px;font-weight:800;line-height:1.2${cor ? ';color:' + cor : ''}">${value}</div>
    <div class="tiny muted">${sub}</div>
  </div>`;
}

/** segundos → "6h42" / "33min" / "48s" */
function dur(seg) {
  const s = Math.max(0, Math.round(Number(seg) || 0));
  if (!s) return '0min';
  if (s < 60) return s + 's';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (!h) return m + 'min';
  return h + 'h' + String(m).padStart(2, '0');
}

/** ISO → "agora" / "há 12min" / "há 3h" / "ontem 14:20" / "12/09 14:20" */
function quando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const difMin = Math.round((Date.now() - d.getTime()) / 60000);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (difMin <= 3) return '<b style="color:var(--ok-escuro)">agora</b>';
  if (difMin < 60) return 'há ' + difMin + 'min';
  if (difMin < 60 * 20) return 'há ' + Math.round(difMin / 60) + 'h';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const diasAtras = Math.round((hoje - dia) / 86400000);
  if (diasAtras === 0) return 'hoje ' + hora;
  if (diasAtras === 1) return 'ontem ' + hora;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
