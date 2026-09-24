/* ============================================================================
   PSM-OS v2 — 🛰️ Central de Operações  (v88.17)

   Pedido do Paulo (23/09/2026): UMA página, só Paulo e Isa, com TODAS as
   rotinas, tarefas automáticas, APIs, conexões, funcionalidades e agentes IA
   do House — layout fácil e, principalmente, ALERTA quando algo trava, dá
   erro, para ou fica pausado.

   Fonte única: /api/v3/system/ops_central (lvl 10 + lista de e-mails opcional).
   Abrir esta tela também roda o vigia no servidor (dispara alerta novo, com
   dedupe), então o aviso sai mesmo se o cron do Vercel falhar.

   Leitura em 3 segundos: faixa de cima = veredito (verde/amarelo/vermelho);
   logo abaixo "Precisa de você" (só o que está ruim); depois tudo por grupo.
============================================================================ */
import { api } from '../api.js';
import { auth } from '../auth.js';
import { router } from '../router.js';
import { setOpsBadge } from '../menu-badges.js';

let _root = null;
let _data = null;
let _filtro = 'todos';
let _busca = '';
let _carregando = false;

const GRUPOS = [
  { id: 'rotinas',     ico: '⏱️', nome: 'Rotinas automáticas',   sub: 'O que roda sozinho (heartbeat + agendador do Vercel)' },
  { id: 'integracoes', ico: '🔌', nome: 'Integrações e APIs',     sub: 'Conexões com RD, Meta, WhatsApp, Kenlo, PSM HUB, IAs…' },
  { id: 'agentes',     ico: '🤖', nome: 'Agentes IA',             sub: 'Agentes de conversa e os que trabalham sozinhos' },
  { id: 'saude',       ico: '🩺', nome: 'Saúde dos dados',        sub: 'Os números batem? Falta dado importante?' },
];

const ST = {
  error:   { cor: 'var(--err)',       fundo: 'rgba(220,38,38,.10)',  ico: '🔴', txt: 'Erro' },
  warn:    { cor: 'var(--warn)',      fundo: 'rgba(217,119,6,.10)',  ico: '🟡', txt: 'Atenção' },
  paused:  { cor: 'var(--info)',      fundo: 'rgba(37,99,235,.10)',  ico: '⏸',  txt: 'Pausado' },
  ok:      { cor: 'var(--ok)',        fundo: 'rgba(22,163,74,.08)',  ico: '🟢', txt: 'OK' },
  unknown: { cor: 'var(--ink-muted)', fundo: 'transparent',          ico: '⚪', txt: 'Sem registro' },
};
const ORDEM = { error: 0, warn: 1, paused: 2, unknown: 3, ok: 4 };

export async function pageCentralOps(ctx, root) {
  _root = root;
  // 🔒 cinto e suspensório: a fronteira real é o backend (lvl 10 + lista de e-mails)
  if ((auth.user()?.lvl || 0) < 10) {
    root.innerHTML = '<div class="alert alert-warn">🔒 Central de Operações: acesso só do Paulo e da Isa.</div>';
    return;
  }
  if (ctx?.query?.f && (ctx.query.f === 'todos' || GRUPOS.some(g => g.id === ctx.query.f))) _filtro = ctx.query.f;
  await reload(true);
  const t = setInterval(() => { if (!document.hidden) reload(false); }, 5 * 60 * 1000);
  router.onCleanup(() => clearInterval(t));
}

async function reload(primeira) {
  if (_carregando) return;
  _carregando = true;
  if (primeira || !_data) {
    _root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Checando rotinas, APIs e agentes… (leva uns segundos: testo cada conexão ao vivo)</div></div>';
  } else {
    const b = _root.querySelector('[data-op="reload"]');
    if (b) { b.disabled = true; b.textContent = '⏳ Checando…'; }
  }
  try {
    _data = await api.request('/api/v3/system/ops_central');
    render();
    atualizarBadge(_data);
  } catch (e) {
    _root.innerHTML = `<div class="alert alert-err">Não consegui checar a operação: ${esc(e.message)}</div>`;
  } finally {
    _carregando = false;
  }
}

/* ───────────────────────── render ───────────────────────── */

function render() {
  const itens = _data.itens || [];
  const r = _data.resumo || {};
  // pausa_intencional = decisão do sócio (ex.: WhatsApp): segue no grupo como ⏸, mas não cobra nada
  const ruins = itens.filter(i => ['error', 'warn', 'paused'].includes(i.status) && i.herda !== 'pausa_intencional')
    .sort((a, b) => ORDEM[a.status] - ORDEM[b.status]);
  const ativos = ruins.filter(i => !i.silenciado_ate);
  const calados = ruins.filter(i => i.silenciado_ate);

  _root.innerHTML = `
    ${veredito(r, ativos)}
    ${ativos.length ? `
      <div class="card" style="border-left:4px solid ${ativos.some(i => i.status === 'error') ? 'var(--err)' : 'var(--warn)'}">
        <h2 class="card-title">🚨 Precisa de você <span class="muted" style="font-weight:500;font-size:13px">(${ativos.length})</span></h2>
        <p class="card-sub">Só o que está com problema, do mais grave pro mais leve. "Silenciar" para de avisar por 24h (continua aparecendo aqui).</p>
        <div style="display:flex;flex-direction:column;gap:8px">${ativos.map(linhaAlerta).join('')}</div>
      </div>` : ''}
    ${calados.length ? `
      <details class="card" style="padding:12px 16px">
        <summary style="cursor:pointer;font-weight:700">🔕 Silenciados (${calados.length})</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${calados.map(linhaAlerta).join('')}</div>
      </details>` : ''}

    <div class="card">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${chip('todos', '📋 Tudo', itens)}
        ${GRUPOS.map(g => chip(g.id, `${g.ico} ${g.nome}`, itens.filter(i => i.grupo === g.id))).join('')}
        <input class="input" data-op="busca" placeholder="🔎 Buscar (ex.: backup, Meta, CEO)" value="${esc(_busca)}"
               style="flex:1;min-width:180px;max-width:320px;margin-left:auto;padding:7px 10px;font-size:13px">
      </div>
      ${GRUPOS.filter(g => _filtro === 'todos' || _filtro === g.id).map(g => blocoGrupo(g, itens)).join('')}
    </div>

    ${blocoCanais()}
    ${blocoAtalhos()}
  `;
  bind();
}

function veredito(r, ativos) {
  const nErr = ativos.filter(i => i.status === 'error').length;
  const nWarn = ativos.filter(i => i.status !== 'error').length;
  const st = nErr ? 'error' : (nWarn ? 'warn' : 'ok');
  const frase = nErr ? `${nErr} problema${nErr > 1 ? 's' : ''} sério${nErr > 1 ? 's' : ''}${nWarn ? ` e ${nWarn} ponto${nWarn > 1 ? 's' : ''} de atenção` : ''}`
    : nWarn ? `${nWarn} ponto${nWarn > 1 ? 's' : ''} de atenção — nada parado`
    : 'Tudo funcionando';
  const env = _data.ultimo_envio;
  const em = _data.em ? new Date(_data.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  return `
    <div class="card" style="background:${ST[st].fundo};border:1.5px solid ${ST[st].cor}">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:40px;line-height:1">${st === 'ok' ? '✅' : st === 'warn' ? '⚠️' : '🚨'}</div>
        <div style="flex:1;min-width:220px">
          <div style="font-size:22px;font-weight:800;color:${ST[st].cor}">${frase}</div>
          <div class="muted" style="font-size:13px;margin-top:2px">
            🟢 ${r.ok || 0} ok · 🟡 ${r.warn || 0} atenção · 🔴 ${r.error || 0} erro · ⏸ ${r.paused || 0} pausado · ⚪ ${r.unknown || 0} sem registro
          </div>
          <div class="muted tiny" style="margin-top:4px">Checado às ${em} · atualiza sozinho a cada 5 min${env?.em ? ` · último alerta enviado ${quando(env.em)}` : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-primary" data-op="reload">🔄 Checar agora</button>
        </div>
      </div>
    </div>`;
}

function linhaAlerta(i) {
  const s = ST[i.status] || ST.unknown;
  return `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:${s.fundo};border:1px solid var(--border)">
      <div style="font-size:18px;line-height:1.2">${s.ico}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${esc(i.nome)} <span class="tiny muted" style="font-weight:500">· ${esc(nomeGrupo(i.grupo))}</span></div>
        <div style="font-size:13px;margin-top:2px">${esc(i.detalhe)}</div>
        <div class="tiny muted" style="margin-top:3px">${i.desde ? `Problema desde ${quando(i.desde)}` : ''}${i.silenciado_ate ? ` · 🔕 silenciado até ${quando(i.silenciado_ate, true)}` : ''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        ${i.link ? `<a class="btn btn-ghost" href="${esc(i.link)}" style="font-size:12px;padding:5px 10px">Abrir →</a>` : ''}
        ${i.silenciado_ate
          ? `<button class="btn btn-ghost" data-op="reativar" data-id="${esc(i.id)}" style="font-size:12px;padding:5px 10px">🔔 Reativar</button>`
          : `<button class="btn btn-ghost" data-op="silenciar" data-id="${esc(i.id)}" style="font-size:12px;padding:5px 10px">🔕 24h</button>`}
      </div>
    </div>`;
}

function chip(id, label, lista) {
  const on = _filtro === id;
  const nErr = lista.filter(i => i.status === 'error').length;
  const nWarn = lista.filter(i => i.status === 'warn' || i.status === 'paused').length;
  const badge = nErr ? `<span style="background:var(--err);color:#fff;border-radius:9px;padding:0 6px;font-size:11px;margin-left:4px">${nErr}</span>`
    : nWarn ? `<span style="background:var(--warn);color:#fff;border-radius:9px;padding:0 6px;font-size:11px;margin-left:4px">${nWarn}</span>` : '';
  return `<button class="btn ${on ? 'btn-primary' : 'btn-ghost'}" data-filtro="${id}" style="font-size:12.5px;padding:7px 12px">${label} <span style="opacity:.6">${lista.length}</span>${badge}</button>`;
}

function blocoGrupo(g, todos) {
  const q = _busca.trim().toLowerCase();
  const lista = todos.filter(i => i.grupo === g.id)
    .filter(i => !q || `${i.nome} ${i.desc} ${i.detalhe}`.toLowerCase().includes(q))
    .sort((a, b) => (ORDEM[a.status] - ORDEM[b.status]) || a.nome.localeCompare(b.nome));
  if (!lista.length) return q ? '' : `<div class="muted tiny" style="margin:6px 0 14px">${g.ico} ${g.nome}: nada registrado.</div>`;
  return `
    <div style="margin-bottom:18px">
      <h3 class="card-title" style="margin:6px 0 2px">${g.ico} ${g.nome}</h3>
      <div class="muted tiny" style="margin-bottom:8px">${g.sub}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:8px">
        ${lista.map(cartao).join('')}
      </div>
    </div>`;
}

function cartao(i) {
  const s = ST[i.status] || ST.unknown;
  const titulo = `${i.nome}\n${i.desc || ''}`;
  return `
    <div title="${esc(titulo)}" style="border:1px solid var(--border);border-left:4px solid ${s.cor};border-radius:10px;padding:10px 12px;background:var(--bg-2);display:flex;flex-direction:column;gap:4px;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;min-width:0">
        ${i.ico ? `<span>${i.ico}</span>` : ''}
        <b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.nome)}</b>
        <span style="font-size:11px;font-weight:700;color:${s.cor};white-space:nowrap">${s.ico} ${s.txt}</span>
      </div>
      <div class="tiny muted" style="line-height:1.35">${esc(i.desc || '')}</div>
      <div style="font-size:12.5px;line-height:1.35">${esc(i.detalhe || '')}</div>
      <div class="tiny muted" style="display:flex;gap:8px;justify-content:space-between;margin-top:auto;padding-top:4px">
        <span>${i.agenda ? '⏱ ' + esc(i.agenda) : ''}${i.silenciado_ate ? ' · 🔕' : ''}</span>
        ${i.link ? `<a href="${esc(i.link)}" style="color:var(--info)">abrir →</a>` : ''}
      </div>
    </div>`;
}

function blocoCanais() {
  const c = _data.cfg || {};
  return `
    <div class="card">
      <h2 class="card-title">📣 Como os alertas chegam em você</h2>
      <p class="card-sub">O vigia roda sozinho (e toda vez que esta tela abre). Avisa quando o problema aparece, relembra a cada 6h se for erro e continuar, e avisa quando resolve. Rotinas curtas não alertam de madrugada (só rodam com o sistema em uso).</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px">
        <div style="border:1px solid var(--border);border-radius:10px;padding:12px">
          <b>🔔 Sino + celular (push)</b>
          <div class="tiny muted" style="margin-top:4px">Sempre ligado — erro, atenção e pausado. Para receber no celular, ative as notificações do House no aparelho.</div>
        </div>
        <label style="border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;display:block">
          <input type="checkbox" data-cfg="whatsapp" ${c.whatsapp !== false ? 'checked' : ''}> <b>💬 WhatsApp (só erro)</b>
          <div class="tiny muted" style="margin-top:4px">${c.wa_configurado ? 'Manda no WhatsApp cadastrado em "Minha conta → Meu dia".' : '⚠️ WhatsApp do servidor (Evolution) não configurado — este canal não sai.'}</div>
        </label>
        <label style="border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;display:block">
          <input type="checkbox" data-cfg="ntfy" ${c.ntfy !== false ? 'checked' : ''}> <b>🚨 App ntfy (só erro)</b>
          <div class="tiny muted" style="margin-top:4px">Funciona até com o banco fora do ar. Instale o app <b>ntfy</b> e assine o tópico <code>${esc(c.ntfy_topic || '')}</code>.</div>
        </label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">
        <button class="btn btn-ghost" data-op="testar">🧪 Mandar alerta de teste</button>
        <span class="tiny muted" data-op="msg"></span>
      </div>
      <details style="margin-top:12px">
        <summary class="tiny" style="cursor:pointer">🔐 Quem pode ver esta tela</summary>
        <div class="tiny muted" style="margin:6px 0">Hoje: todo Sócio/Diretor (nível 10). Para travar em pessoas específicas, liste os e-mails (um por linha; o seu precisa estar na lista). Vazio = todos os sócios.</div>
        <textarea class="input" data-cfg="admins" rows="2" style="width:100%;max-width:420px;font-size:13px">${esc((c.admins || []).join('\n'))}</textarea>
        <div><button class="btn btn-ghost" data-op="salvar-admins" style="font-size:12px;padding:5px 10px;margin-top:6px">Salvar lista</button></div>
      </details>
    </div>`;
}

function blocoAtalhos() {
  const links = [
    ['#/governanca', '🩺', 'Saúde do Sistema', 'Env vars, auditoria e mapa dos ciclos'],
    ['#/integracoes', '🔌', 'Integrações', 'Zoho da equipe, webhook, Kenlo manual'],
    ['#/agentes', '🧠', 'Central Agentes', 'Catálogo dos agentes'],
    ['#/central-sol', '☀️', 'Central Sol', 'Agente de WhatsApp'],
    ['#/backup', '💾', 'Backup', 'Rodar/baixar backup'],
    ['#/auditoria', '📜', 'Auditoria', 'Quem fez o quê'],
    ['#/configuracoes', '🔧', 'Configurações', 'Cargos, permissões, frentes'],
    ['#/logins', '🔐', 'Logins e Senhas', 'Cofre de acessos'],
    ['#/qualidade', '🧹', 'Qualidade dos Dados', 'Limpeza e pendências'],
    ['#/checkin', '🕵️', 'Check-in / Check-out', 'Quem usa o House'],
  ].filter(([h]) => router.pode(h.slice(1)));
  return `
    <div class="card">
      <h2 class="card-title">🧭 Onde mexer em cada coisa</h2>
      <p class="card-sub">Esta Central mostra e avisa. As telas de ajuste continuam onde estavam:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
        ${links.map(([h, ico, n, d]) => `
          <a href="${h}" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;text-decoration:none;color:inherit;display:block">
            <b>${ico} ${n}</b><div class="tiny muted">${d}</div></a>`).join('')}
      </div>
    </div>`;
}

/* ───────────────────────── ações ───────────────────────── */

function bind() {
  _root.querySelector('[data-op="reload"]')?.addEventListener('click', () => reload(false));
  _root.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => { _filtro = b.dataset.filtro; render(); }));
  const busca = _root.querySelector('[data-op="busca"]');
  busca?.addEventListener('input', () => {
    _busca = busca.value;
    const pos = busca.selectionStart;
    render();
    const nb = _root.querySelector('[data-op="busca"]');
    nb?.focus(); try { nb?.setSelectionRange(pos, pos); } catch (_) {}
  });
  _root.querySelectorAll('[data-op="silenciar"],[data-op="reativar"]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api.request('/api/v3/system/ops_central', { method: 'POST', body: { action: b.dataset.op, id: b.dataset.id, horas: 24 } });
      await reload(false);
    } catch (e) { alert('Não consegui: ' + e.message); b.disabled = false; }
  }));
  _root.querySelectorAll('input[data-cfg]').forEach(cb => cb.addEventListener('change', async () => {
    try {
      await api.request('/api/v3/system/ops_central', { method: 'POST', body: { action: 'config', [cb.dataset.cfg]: cb.checked } });
      msg('✅ Salvo.');
    } catch (e) { cb.checked = !cb.checked; msg('❌ ' + e.message); }
  }));
  _root.querySelector('[data-op="salvar-admins"]')?.addEventListener('click', async () => {
    const lista = (_root.querySelector('textarea[data-cfg="admins"]').value || '').split(/[\s,;]+/).filter(Boolean);
    try {
      await api.request('/api/v3/system/ops_central', { method: 'POST', body: { action: 'config', admins: lista } });
      msg('✅ Lista salva.');
    } catch (e) { msg('❌ ' + e.message); }
  });
  _root.querySelector('[data-op="testar"]')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await api.request('/api/v3/system/ops_central', { method: 'POST', body: { action: 'testar_alerta' } });
      const e = r.envio || {};
      const canais = [e.sino_push === true ? 'sino+push' : null, e.whatsapp ? `WhatsApp (${e.whatsapp})` : null, e.ntfy ? 'ntfy' : null].filter(Boolean);
      msg(canais.length ? `✅ Enviado por: ${canais.join(', ')}.` : '⚠️ Nenhum canal confirmou o envio.');
    } catch (err) { msg('❌ ' + err.message); }
    ev.target.disabled = false;
  });
}

function msg(t) { const m = _root.querySelector('[data-op="msg"]'); if (m) m.textContent = t; }

/* ───────────────────── badge do menu (exportado pro main.js) ───────────────────── */

export function atualizarBadge(d) {
  const ativos = (d?.ativos || (d?.itens || []).filter(i => ['error', 'warn', 'paused'].includes(i.status) && !i.silenciado_ate && i.herda !== 'pausa_intencional'));
  const nErr = ativos.filter(i => i.status === 'error').length;
  // v88.34: mesmo número do menu que os avisos das outras telas (menu-badges.js)
  setOpsBadge(nErr || ativos.length, nErr > 0);
}

/** Badge leve do menu: lê o último estado gravado pelo vigia (não re-checa as APIs). */
export async function pollBadgeOps() {
  if ((auth.user()?.lvl || 0) < 10) return;
  try { atualizarBadge(await api.request('/api/v3/system/ops_central?resumo=1')); } catch (_) {}
}

/* ───────────────────────── util ───────────────────────── */

function nomeGrupo(g) { return (GRUPOS.find(x => x.id === g) || {}).nome || g; }

function quando(iso, futuro) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (futuro) return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)}h`;
  return `há ${Math.round(min / 1440)} dias`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
