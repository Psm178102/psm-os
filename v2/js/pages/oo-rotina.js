/* PSM-OS v2 — 🧭 Rotina & Plano do corretor, dentro do One-on-One (v88.44)
   A rotina de alta performance + o plano de canais/funil de cada corretor, no
   próprio 1:1, pra ele não "perder a folha". Conteúdo por pessoa em
   GET /api/v3/oo/rotina (atrás de login: tem taxas e pontos fracos do corretor). */
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const GOLD = 'var(--amarelo-ouro)';
const SECOES = [
  ['rt-placar', '🎯 Placar'], ['rt-dia', '⏰ Seu dia'], ['rt-semana', '📅 Sua semana'], ['rt-canais', '📣 Canais'],
  ['rt-cadencia', '🪜 Cadência'], ['rt-regras', '📌 Regras'], ['rt-semaforo', '🚦 Semáforo'], ['rt-check', '✅ Checklists'], ['rt-mes1', '🚀 1º mês'],
];

export async function montarRotinaOO(host, { corretorId, nome, selfView }) {
  if (!host) return;
  host.innerHTML = `<div class="tiny muted"><span class="spinner"></span> Carregando a rotina…</div>`;
  let r;
  try {
    r = await api.request('/api/v3/oo/rotina?corretor_id=' + encodeURIComponent(corretorId));
  } catch (e) {
    host.innerHTML = `<div class="alert alert-err">Não consegui carregar a rotina: ${esc(e.message)}</div>`;
    return;
  }
  const p = r && r.plano;
  const primeiro = String(nome || '').split(' ')[0];
  if (!p) {
    host.innerHTML = box(`<div style="text-align:center;padding:18px 8px">
      <div style="font-size:30px">🧭</div>
      <div style="font-weight:800;margin-top:6px">${selfView ? 'Sua rotina ainda não foi montada' : 'A rotina de ' + esc(primeiro) + ' ainda não foi montada'}</div>
      <div class="tiny muted" style="margin-top:4px">${selfView ? 'Peça ao seu gestor para montar a sua rotina e o seu plano de canais no próximo 1:1.' : 'Monte a rotina e o plano de canais e grave em /api/v3/oo/rotina (sócio).'}</div></div>`);
    return;
  }
  host.innerHTML = `
    ${hero(p, selfView, primeiro, r.updated_at)}
    ${nav()}
    ${lembretes(p)}
    ${secPlacar(p)}
    ${secDia(p)}
    ${secSemana(p)}
    ${secCanais(p)}
    ${secCadencia(p)}
    ${secRegras(p)}
    ${secSemaforo(p)}
    ${secCheck(p, corretorId)}
    ${secMes1(p)}`;
  wire(host, corretorId);
}

/* ───────────── blocos ───────────── */
function box(inner, extra = '') {
  return `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px 16px;${extra}">${inner}</div>`;
}
function sec(id, n, titulo, sub, inner) {
  return `<section id="${id}" style="margin-top:16px;scroll-margin-top:70px">${box(`
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <span style="background:var(--psm-navy);color:var(--ink-inverted);border-radius:999px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:none">${n}</span>
      <div><div style="font-weight:800;font-size:15px">${titulo}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>
    </div>${inner}`)}</section>`;
}
function dica(txt, cor = GOLD) {
  return `<div style="margin-top:10px;border-left:4px solid ${cor};background:var(--bg-3);padding:9px 12px;border-radius:6px;font-size:13px">${txt}</div>`;
}

function hero(p, selfView, primeiro, up) {
  const m = p.meta || {};
  const upTxt = up ? new Date(up).toLocaleDateString('pt-BR') : '';
  return box(`
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
      <div style="flex:1 1 280px">
        <div class="tiny" style="text-transform:uppercase;letter-spacing:.6px;opacity:.8">🧭 ${selfView ? 'Minha rotina' : 'Rotina de ' + esc(primeiro)} · ${esc(p.vigencia || '')}</div>
        <div style="font-size:20px;font-weight:800;margin-top:2px">${esc(p.titulo || 'Rotina & plano')}</div>
        <div style="font-size:13.5px;margin-top:6px;opacity:.92">${esc(p.ideia || '')}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${m.vgv ? chip(brl(m.vgv), 'meta de VGV/mês') : ''}
        ${m.vendas ? chip(String(m.vendas), 'vendas/mês') : ''}
        ${m.ticket ? chip(brl(m.ticket), 'ticket médio') : ''}
      </div>
    </div>
    ${m.explica ? `<div class="tiny" style="margin-top:10px;opacity:.85">💡 ${esc(m.explica)}</div>` : ''}
    <div class="tiny" style="margin-top:6px;opacity:.65">Feito a partir de: ${esc(p.fontes || '')}${upTxt ? ' · atualizado em ' + upTxt : ''}</div>`,
    'background:linear-gradient(135deg,var(--psm-navy),var(--psm-navy-2));color:var(--ink-inverted);border:none');
}
function chip(v, l) {
  return `<div style="background:rgba(255,255,255,.12);border-radius:10px;padding:8px 12px;min-width:110px">
    <div style="font-size:18px;font-weight:800">${v}</div><div class="tiny" style="opacity:.8">${l}</div></div>`;
}
function nav() {
  return `<div style="position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0;margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
    ${SECOES.map(([id, l]) => `<button class="btn btn-ghost btn-sm" data-rt-go="${id}">${l}</button>`).join('')}
    <button class="btn btn-ghost btn-sm" data-rt-print style="margin-left:auto">🖨 Imprimir</button></div>`;
}

/* 📋 lembretes que valem em TODO atendimento (fichas, proposta personalizada) — ficam no topo */
function lembretes(p) {
  const l = p.lembretes || [];
  if (!l.length) return '';
  return `<div style="margin-top:12px;border:2px solid ${GOLD};border-radius:var(--r-md);padding:12px 14px;background:linear-gradient(180deg,rgba(202,138,4,.12),var(--bg-2))">
    <div style="font-weight:800;font-size:14px;margin-bottom:6px">📌 Em todo atendimento, não esqueça</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">
      ${l.map(x => `<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:9px 11px">
        <div style="font-weight:800">${esc(x.icone || '📌')} ${esc(x.titulo)}</div>
        <div style="font-size:12.5px;margin-top:3px">${esc(x.texto)}</div></div>`).join('')}
    </div></div>`;
}

function secPlacar(p) {
  const f = p.funil || {};
  const max = Math.max(...(f.valores || [1]));
  const barras = (f.etapas || []).map((e, i) => {
    const v = f.valores[i]; const w = Math.max(24, Math.round(v / max * 100));
    return `<div style="display:flex;align-items:center;gap:10px;margin:5px 0">
      <div style="width:110px;font-size:13px;font-weight:700">${esc(e)}</div>
      <div style="flex:1"><div style="width:${w}%;background:${i === f.etapas.length - 1 ? GOLD : 'var(--psm-navy)'};color:#fff;border-radius:6px;padding:5px 10px;font-weight:800;font-size:13px">${v}/mês</div></div></div>`;
  }).join('');
  const linhas = (p.placar || []).map(x => `<tr><td style="padding:6px 8px;font-weight:600">${esc(x.rotulo)}</td>
      <td style="padding:6px 8px;text-align:center">${esc(x.dia)}</td><td style="padding:6px 8px;text-align:center;font-weight:800">${esc(x.semana)}</td><td style="padding:6px 8px;text-align:center">${esc(x.mes)}</td></tr>`).join('');
  const taxas = (f.taxas || []).map(t => `<tr${t.alavanca ? ' style="background:var(--bg-3)"' : ''}><td style="padding:6px 8px">${esc(t.etapa)}${t.alavanca ? ' <b style="color:' + GOLD + '">← maior alavanca</b>' : ''}</td>
      <td style="padding:6px 8px;text-align:center">${esc(t.hoje)}</td><td style="padding:6px 8px;text-align:center;font-weight:800">${esc(t.meta)}</td></tr>`).join('');
  return sec('rt-placar', 1, 'O placar que você persegue', 'De trás para frente: quantos agendamentos viram as vendas do mês', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;align-items:start">
      <div>${barras}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">O quê</th><th style="padding:6px 8px">Dia</th><th style="padding:6px 8px">Semana</th><th style="padding:6px 8px">Mês</th></tr></thead>
        <tbody>${linhas}</tbody></table>
    </div>
    <div style="margin-top:14px;font-weight:700;font-size:13px">Onde você está × onde precisa chegar</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
      <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">Etapa</th><th style="padding:6px 8px">Hoje</th><th style="padding:6px 8px">Meta</th></tr></thead>
      <tbody>${taxas}</tbody></table>`);
}

function secDia(p) {
  const agora = new Date(); const hm = agora.getHours() * 60 + agora.getMinutes();
  const mins = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const util = agora.getDay() >= 1 && agora.getDay() <= 5;
  const itens = (p.dia || []).map(b => {
    const now = util && hm >= mins(b.ini) && hm < mins(b.fim);
    const cor = b.tipo === 'gold' ? GOLD : b.tipo === 'ouro' ? 'var(--psm-navy)' : b.tipo === 'pausa' ? 'var(--border-2)' : 'var(--info)';
    const fundo = b.tipo === 'gold' ? 'background:linear-gradient(90deg,rgba(202,138,4,.18),var(--bg-2));' : b.tipo === 'ouro' ? 'background:var(--bg-3);' : '';
    return `<div style="display:flex;gap:12px;align-items:stretch;margin:6px 0">
      <div style="width:92px;flex:none;text-align:right;font-weight:800;font-size:13px;padding-top:8px">${esc(b.ini)}<div class="tiny muted" style="font-weight:600">até ${esc(b.fim)}</div></div>
      <div style="width:6px;flex:none;border-radius:4px;background:${cor}"></div>
      <div style="flex:1;border:1px solid ${now ? cor : 'var(--border)'};${now ? 'box-shadow:0 0 0 2px ' + cor + ';' : ''}border-radius:10px;padding:8px 12px;${fundo}">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b style="font-size:14px">${b.tipo === 'gold' ? '⭐ ' : b.tipo === 'ouro' ? '🔥 ' : ''}${esc(b.bloco)}</b>
          ${now ? '<span class="tiny" style="background:' + cor + ';color:#fff;border-radius:999px;padding:1px 8px;font-weight:800">AGORA</span>' : ''}
          ${b.passo && b.passo !== '–' ? `<span class="tiny muted">passo ${esc(b.passo)}</span>` : ''}
        </div>
        <div style="font-size:13px;margin-top:3px">${esc(b.oque)}</div>
        ${b.entrega && b.entrega !== '–' ? `<div class="tiny" style="margin-top:4px"><b>Entrega:</b> ${esc(b.entrega)}</div>` : ''}
      </div></div>`;
  }).join('');
  return sec('rt-dia', 2, 'Seu dia, hora a hora (segunda a sexta)', 'O bloco em que você está agora aparece destacado', itens + (p.dia_nota ? dica('⭐ ' + esc(p.dia_nota)) : ''));
}

function secSemana(p) {
  const hoje = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][new Date().getDay()];
  const cards = (p.semana || []).map(d => {
    const isHoje = d.dia === hoje;
    const est = d.destaque ? `border:2px solid ${GOLD};background:linear-gradient(180deg,rgba(202,138,4,.14),var(--bg-2))` : `border:1px solid ${isHoje ? 'var(--psm-navy)' : 'var(--border)'}`;
    return `<div style="${est};border-radius:10px;padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <b>${esc(d.dia)}</b>${isHoje ? '<span class="tiny" style="background:var(--psm-navy);color:var(--ink-inverted);border-radius:999px;padding:1px 8px;font-weight:800">HOJE</span>' : ''}</div>
      <div style="font-size:12px;font-weight:800;color:${d.destaque ? GOLD : 'var(--info)'};margin-top:2px;text-transform:uppercase;letter-spacing:.4px">${esc(d.canal)}</div>
      <div style="font-size:12.5px;margin-top:5px">☀️ ${esc(d.manha)}</div>
      <div style="font-size:12.5px;margin-top:3px">🌇 ${esc(d.tarde)}</div>
      ${d.rito ? `<div class="tiny" style="margin-top:6px;${d.destaque ? 'font-weight:800' : ''}">📍 ${esc(d.rito)}</div>` : ''}
    </div>`;
  }).join('');
  return sec('rt-semana', 3, 'Sua semana', 'Cada dia tem um canal para a manhã; a tarde é de visitas e follow-up',
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">${cards}</div>` + (p.sabado ? dica('🗓 ' + esc(p.sabado)) : ''));
}

function secCanais(p) {
  const linhas = (p.canais || []).map(c => `
    <div style="padding:10px 0;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <b style="min-width:200px">${esc(c.nome)}</b>
        <div style="flex:1;min-width:160px;background:var(--bg-3);border-radius:6px;height:18px;position:relative">
          <div style="width:${Math.min(100, c.energia * 2.5)}%;height:100%;border-radius:6px;background:${c.energia >= 20 ? GOLD : 'var(--psm-navy)'}"></div>
          <span style="position:absolute;left:8px;top:0;font-size:11.5px;font-weight:800;line-height:18px;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.45)">${c.energia}% do seu tempo</span>
        </div>
        <span class="tiny" style="font-weight:800">meta: ${esc(c.vendas)}${/^[\d,]+$/.test(c.vendas) ? ' venda/mês' : ''}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;margin-top:6px;font-size:12.5px">
        <div><b>Na semana:</b> ${esc(c.semana)}</div><div><b>No mês:</b> ${esc(c.mes)}</div></div>
      <div class="tiny muted" style="margin-top:3px">📊 ${esc(c.dado)}</div>
    </div>`).join('');
  return sec('rt-canais', 4, 'Onde colocar a sua energia', 'Metade do tempo vai para onde você mais converte (indicação e networking), sem largar o volume do tráfego pago', linhas);
}

function secCadencia(p) {
  const itens = (p.cadencia || []).map(c => `
    <div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--border);${c.alavanca ? 'background:var(--bg-3);margin:0 -8px;padding:8px;border-radius:8px' : ''}">
      <div style="width:28px;height:28px;flex:none;border-radius:999px;background:${c.alavanca ? GOLD : 'var(--psm-navy)'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px">${esc(c.passo)}</div>
      <div style="flex:1">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline"><b>${esc(c.nome)}</b><span class="tiny muted">RD: ${esc(c.rd)}</span>${c.alavanca ? '<span class="tiny" style="color:' + GOLD + ';font-weight:800">← maior alavanca</span>' : ''}</div>
        <div style="font-size:12.5px">⏱ ${esc(c.prazo)}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;margin-top:2px">
          ${c.perde ? `<span style="color:var(--err)">⚠️ Hoje: ${esc(c.perde)}</span>` : ''}
          <span style="color:var(--ok)">🎯 Meta: ${esc(c.meta)}</span></div>
      </div></div>`).join('');
  return sec('rt-cadencia', 5, 'A cadência MAP, passo a passo', 'Os 14 passos do Mapa do Corretor MAP: prazo, etapa no RD, onde você perde hoje e a meta. Os scripts estão no Mapa do Corretor.', itens);
}

function secRegras(p) {
  const itens = (p.regras || []).map((r, i) => `
    <div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--border)">
      <div style="font-weight:800;font-size:18px;color:${GOLD};width:22px;flex:none">${i + 1}</div>
      <div><b>${esc(r[0])}</b><div style="font-size:12.5px">${esc(r[1])}</div></div></div>`).join('');
  return sec('rt-regras', 6, `As ${(p.regras || []).length} regras que não se negociam`, 'Se uma delas falhar, o placar falha junto', itens);
}

function secSemaforo(p) {
  const cel = (t, bg) => `<td style="padding:6px 8px;text-align:center;background:${bg}">${esc(t)}</td>`;
  const linhas = (p.semaforo || []).map(s => `<tr><td style="padding:6px 8px;font-weight:600">${esc(s.ind)}</td>
    ${cel(s.verde, 'rgba(22,163,74,.13)')}${cel(s.amarelo, 'rgba(217,119,6,.13)')}${cel(s.vermelho, 'rgba(220,38,38,.12)')}</tr>`).join('');
  const gat = (p.gatilhos || []).map(g => `<div style="padding:8px 0;border-top:1px solid var(--border)">
      <div style="font-weight:700">🚨 ${esc(g.sinal)}</div><div style="font-size:12.5px">➡️ ${esc(g.acao)}</div></div>`).join('');
  return sec('rt-semaforo', 7, 'Semáforo e o que fazer quando algo sai do trilho', 'O Paulo olha toda segunda (Semanal MAP) e toda quinta (1:1)', `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:6px 8px">Indicador</th><th style="padding:6px 8px">🟢 Verde</th><th style="padding:6px 8px">🟡 Amarelo</th><th style="padding:6px 8px">🔴 Vermelho</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <div style="margin-top:12px;font-weight:700;font-size:13px">Se acontecer isto, faça aquilo</div>${gat}`);
}

/* checklists com marcação do DIA (fica neste aparelho; zera sozinho no dia seguinte) */
function ckKey(cid) { const d = new Date(); return `oo_rotina_ck:${cid}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function ckLoad(cid) { try { return JSON.parse(localStorage.getItem(ckKey(cid)) || '{}'); } catch { return {}; } }
function ckSave(cid, v) { try { localStorage.setItem(ckKey(cid), JSON.stringify(v)); } catch { /* sem storage: só não lembra */ } }
function secCheck(p, cid) {
  const st = ckLoad(cid);
  const grupos = Object.entries(p.checklists || {}).map(([g, itens], gi) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px">
      <b>${esc(g)}</b>
      ${itens.map((t, i) => { const k = gi + ':' + i; return `<label style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" data-rt-ck="${k}" ${st[k] ? 'checked' : ''} style="margin-top:3px"> <span>${esc(t)}</span></label>`; }).join('')}
    </div>`).join('');
  return sec('rt-check', 8, 'Checklists do dia', 'Marque ao longo do dia. As marcações ficam neste aparelho e zeram sozinhas amanhã.',
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">${grupos}</div>`);
}

function secMes1(p) {
  const itens = (p.mes1 || []).map(s => `<div style="display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--border)">
      <div style="width:120px;flex:none"><b>${esc(s.semana)}</b><div class="tiny" style="color:var(--info);font-weight:800">${esc(s.foco)}</div></div>
      <div style="font-size:13px">${esc(s.entregas)}</div></div>`).join('');
  return sec('rt-mes1', 9, 'O primeiro mês', 'Semana a semana até o ritmo das 3 vendas', itens + (p.rampa ? dica('📈 ' + esc(p.rampa), 'var(--info)') : ''));
}

function wire(host, cid) {
  host.querySelectorAll('[data-rt-go]').forEach(b => b.addEventListener('click', () => {
    document.getElementById(b.dataset.rtGo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  host.querySelector('[data-rt-print]')?.addEventListener('click', () => window.print());
  host.querySelectorAll('[data-rt-ck]').forEach(el => el.addEventListener('change', () => {
    const st = ckLoad(cid); st[el.dataset.rtCk] = el.checked; ckSave(cid, st);
  }));
}
