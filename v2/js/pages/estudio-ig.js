/* PSM-OS v2 — 📸 Estúdio Instagram (v88.61)
   Pedido do Paulo (27/set): colocar dentro do marketing do House as 13 skills
   /ig-* adaptadas pra PSM Conquista. Aqui o time pede a peça, a skill escreve
   no cânone da marca, o anti-robô bloqueia vício de IA/regra da Sol, o Auditor
   dá a nota (corte 8) e só então a peça vai pra fila do Paulo no /cmo.
   Veredito "ajustar" do Paulo volta aqui com o motivo, pronto pra refazer.
   Backend: /api/v3/marketing/estudio (lvl 5+). Histórico: shared_kv mkt_estudio. */
import { api } from '../api.js';

const GRUPOS = [
  { lbl: '✍️ Produzir', ids: ['ig-reel', 'ig-caption', 'ig-carousel', 'ig-story', 'ig-repurpose'] },
  { lbl: '🔎 Pesquisar e planejar', ids: ['ig-viral', 'ig-plan', 'ig-audit', 'ig-profile'] },
  { lbl: '💬 Atender e engajar', ids: ['ig-reply', 'ig-dm', 'ig-comment'] },
  { lbl: '🧽 Revisar', ids: ['ig-human'] },
];
const VERED = {
  pendente:  ['#eab308', '⏳ na fila do Paulo'],
  aprovada:  ['#22c55e', '✅ aprovada · pronta pro Agendador'],
  ajustar:   ['#fb923c', '✏️ Paulo pediu ajuste'],
  reprovada: ['#f43f5e', '🚫 reprovada'],
};

let _root = null, _dados = null, _sel = null, _atual = null, _busy = false, _msg = '', _refazerAberto = false;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTs(ts) { try { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function notaCor(n) { return n == null ? 'color:var(--muted)' : n >= 8 ? 'color:#22c55e' : n >= 6 ? 'color:#eab308' : 'color:#f43f5e'; }
const skill = id => (_dados?.skills || []).find(s => s.id === id);

export async function pageEstudioIg(ctx, root) {
  _root = root;
  _sel = ctx?.query?.skill || _sel;
  if (!_dados) { root.innerHTML = '<div class="tiny muted" style="padding:20px"><span class="spinner"></span> carregando o Estúdio…</div>'; }
  await load();
}

async function load() {
  try {
    _dados = await api.request('/api/v3/marketing/estudio');
    if (_atual) _atual = (_dados.historico || []).find(h => h.id === _atual.id) || _atual;
  } catch (e) { _msg = '⚠️ ' + e.message; }
  render();
}

function render() {
  if (!_dados) { _root.innerHTML = `<div class="cmo-card">${esc(_msg || 'Falha ao carregar.')}</div>`; return; }
  const corte = _dados.corte || 8;
  _root.innerHTML = `
  <style>
    .est-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:12px}
    @media (max-width:520px){.est-grid{grid-template-columns:1fr 1fr}.est-card code{display:none}.est-card{padding:9px 10px}}
    .est-card{background:var(--bg-3);border:1px solid var(--bd);border-radius:10px;padding:10px 12px;cursor:pointer}
    .est-card:hover{border-color:#e88530}
    .est-card.on{border-color:#e88530;box-shadow:0 0 0 1px #e88530}
    .est-box{background:var(--bg-3);border:1px solid var(--bd);border-radius:12px;padding:14px 16px;margin-bottom:14px}
    .est-out{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.6;margin:0;padding:12px 14px;background:var(--bg-2,rgba(255,255,255,.04));border-radius:8px;max-height:60vh;overflow:auto}
    .est-pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;border:1px solid var(--bd)}
  </style>

  <div class="est-box" style="background:linear-gradient(135deg,rgba(232,133,48,.14),transparent)">
    <div class="flex" style="align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-weight:900;font-size:16px">📸 Estúdio Instagram · PSM Conquista</div>
      <span class="tiny muted">13 skills na voz da Sol</span>
      <a href="#/equipe-marketing" class="tiny" style="margin-left:auto;color:#38bdf8">🏭 Equipe de Marketing →</a>
    </div>
    <div class="tiny" style="margin-top:6px;color:var(--muted);line-height:1.6">
      Você pede → a skill escreve seguindo as regras da marca → o <b>anti-robô</b> bloqueia vício de IA e regra da Sol →
      o <b>Auditor dá nota 0-10</b> → com <b>${corte}+</b> a peça vai pra <b>fila do Paulo</b> (Diretoria → CMO → Validar peças).
      Nada aqui publica, agenda ou responde ninguém: quem publica é o Agendador, depois do OK do Paulo.
    </div>
  </div>

  ${GRUPOS.map(g => `
    <div class="tiny" style="font-weight:800;margin:4px 0 6px">${g.lbl}</div>
    <div class="est-grid">
      ${g.ids.map(id => { const s = skill(id); if (!s) return ''; return `
      <div class="est-card ${_sel === id ? 'on' : ''}" data-sk="${id}">
        <div class="flex" style="align-items:center;gap:7px"><span style="font-size:17px">${s.ico}</span><b style="font-size:13px">${esc(s.nome)}</b>
          <code class="tiny muted" style="margin-left:auto">/${esc(id)}</code></div>
        <div class="tiny" style="color:#38bdf8;margin-top:3px">${esc(s.estacao)}${s.peca ? ' · vira peça' : ' · insumo'}</div>
      </div>`; }).join('')}
    </div>`).join('')}

  ${_sel ? formHtml() : ''}
  ${_atual ? resultadoHtml(_atual, corte) : ''}
  ${historicoHtml()}`;
  wire();
}

function formHtml() {
  const s = skill(_sel);
  return `
  <div class="est-box" id="est-form">
    <div class="flex" style="align-items:center;gap:8px"><span style="font-size:18px">${s.ico}</span><b>${esc(s.nome)}</b><span class="tiny muted">· ${esc(s.estacao)}</span></div>
    <div class="tiny muted" style="margin:4px 0 8px;line-height:1.5">${esc(s.descricao)}</div>
    <textarea id="est-pedido" class="input" rows="6" style="width:100%;resize:vertical" placeholder="${esc(s.dica)}" ${_busy ? 'disabled' : ''}></textarea>
    <div class="flex gap-2" style="margin-top:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" id="est-gerar" ${_busy ? 'disabled' : ''}>${_busy ? '<span class="spinner"></span> escrevendo + auditando (até 1 min)…' : '✨ Gerar'}</button>
      <span class="tiny muted">Quanto mais dado real (número com fonte, dúvida de cliente, viral de referência), maior a nota de evidência.</span>
    </div>
    ${_msg ? `<div class="tiny" style="margin-top:8px;color:#fb923c">${esc(_msg)}</div>` : ''}
  </div>`;
}

function checagemHtml(c) {
  if (!c) return '';
  const bl = c.bloqueios || [], av = c.avisos || [];
  const sc = c.score;
  return `
  <div style="margin-top:10px">
    <div class="flex" style="gap:8px;align-items:center;flex-wrap:wrap">
      <b class="tiny">🧽 Anti-robô</b>
      ${sc != null ? `<span class="est-pill" style="${c.veredito === 'LIMPO' ? 'color:#22c55e' : notaCor(sc / 10)}">humano ${esc(sc)}/100 ${esc(c.veredito || '')}</span>` : ''}
      <span class="est-pill" style="color:${bl.length ? '#f43f5e' : '#22c55e'}">${bl.length ? `🚫 ${bl.length} bloqueio(s)` : '✅ sem bloqueio de marca'}</span>
      ${av.length ? `<span class="est-pill" style="color:#eab308">⚠️ ${av.length} aviso(s)</span>` : ''}
    </div>
    ${bl.length || av.length ? `<ul class="tiny" style="margin:6px 0 0 18px;line-height:1.55">
      ${bl.map(b => `<li style="color:#f43f5e">${esc(b)}</li>`).join('')}
      ${av.slice(0, 12).map(a => `<li style="color:#eab308">${esc(a)}</li>`).join('')}
    </ul>` : ''}
  </div>`;
}

function auditoriaHtml(a, corte) {
  if (!a) return '';
  if (a.nota == null) return `<div class="tiny" style="margin-top:10px;color:#fb923c">⚖️ Auditor indisponível: ${esc(a.erro || 'sem nota')} — gere de novo.</div>`;
  const it = a.itens || {};
  const MAX = { gancho: 3, clareza_cta: 2, marca: 2, evidencia: 2, originalidade: 1 };
  const LBL = { gancho: 'gancho', clareza_cta: 'clareza + CTA', marca: 'marca', evidencia: 'evidência', originalidade: 'originalidade' };
  return `
  <div style="margin-top:10px">
    <div class="flex" style="gap:8px;align-items:center;flex-wrap:wrap">
      <b class="tiny">⚖️ Auditor</b>
      <span style="font-weight:900;font-size:18px;${notaCor(a.nota)}">${esc(a.nota)}</span>
      <span class="tiny" style="${notaCor(a.nota)}">${a.nota >= corte ? 'passa no corte' : `abaixo do corte ${corte} → refazer`}</span>
      ${Object.keys(MAX).map(k => `<span class="est-pill tiny">${LBL[k]} ${esc(it[k] ?? '–')}/${MAX[k]}</span>`).join('')}
    </div>
    ${(a.motivos || []).length ? `<ul class="tiny muted" style="margin:6px 0 0 18px;line-height:1.55">${a.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function resultadoHtml(h, corte) {
  const s = skill(h.skill) || { ico: '•', nome: h.skill, peca: false, estacao: '' };
  const a = h.auditoria || {};
  const bloqueado = (h.checagem?.bloqueios || []).length > 0;
  const podeEnviar = s.peca && !h.peca_id && a.nota != null && a.nota >= corte && !bloqueado;
  const v = h.veredito && VERED[h.veredito];
  return `
  <div class="est-box" style="border-left:4px solid ${a.nota >= corte && !bloqueado ? '#22c55e' : '#fb923c'}">
    <div class="flex" style="align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:17px">${s.ico}</span><b>${esc(a.titulo || s.nome)}</b>
      <span class="tiny muted">v${esc(h.versao || 1)} · ${esc(h.autor || '')} · ${fmtTs(h.ts)}</span>
      ${v ? `<span class="tiny" style="color:${v[0]};font-weight:700">${v[1]}</span>` : ''}
      <button class="btn btn-ghost tiny" id="est-fechar" style="margin-left:auto">fechar</button>
    </div>
    ${h.veredito === 'ajustar' && h.veredito_motivo ? `<div class="tiny" style="margin-top:6px;color:#fb923c">💬 Paulo: ${esc(h.veredito_motivo)}</div>` : ''}
    <pre class="est-out" style="margin-top:10px">${esc(h.saida)}</pre>
    ${checagemHtml(h.checagem)}
    ${auditoriaHtml(a, corte)}
    <div class="flex gap-2" style="margin-top:12px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-ghost tiny" id="est-copiar">📋 Copiar</button>
      <button class="btn btn-ghost tiny" id="est-refazer" ${_busy ? 'disabled' : ''}>🔁 Refazer</button>
      ${s.peca ? (h.peca_id
        ? `<span class="tiny muted">já está na fila do Paulo</span>`
        : `<button class="btn tiny" id="est-enviar" style="background:#22c55e;color:#04170c;font-weight:800" ${podeEnviar && !_busy ? '' : 'disabled'}
             title="${podeEnviar ? '' : 'só vai com nota ≥ corte e sem bloqueio do anti-robô'}">✅ Enviar pro Paulo validar</button>`)
        : `<span class="tiny muted">insumo — segue pra estação: ${esc(s.estacao)}</span>`}
    </div>
    ${_refazerAberto ? `
    <div class="flex gap-2" style="margin-top:10px">
      <input class="input" id="est-ajuste" style="flex:1" placeholder="O que mudar? (opcional — os motivos do Auditor e do Paulo já vão juntos)">
      <button class="btn btn-primary tiny" id="est-refazer-go" ${_busy ? 'disabled' : ''}>${_busy ? '<span class="spinner"></span>' : 'Refazer'}</button>
    </div>` : ''}
  </div>`;
}

function historicoHtml() {
  const hist = _dados.historico || [];
  if (!hist.length) return '<div class="est-box tiny muted" style="text-align:center">Nenhuma peça ainda. Escolha uma skill acima e faça o primeiro pedido.</div>';
  return `
  <div style="font-weight:800;margin:6px 0 8px">Histórico (${hist.length})</div>
  ${hist.map(h => {
    const s = skill(h.skill) || { ico: '•', nome: h.skill };
    const n = h.auditoria?.nota;
    const v = h.veredito && VERED[h.veredito];
    return `<div class="est-box" data-hist="${esc(h.id)}" style="padding:9px 14px;margin-bottom:6px;cursor:pointer${_atual?.id === h.id ? ';border-color:#e88530' : ''}">
      <div class="flex" style="gap:8px;align-items:baseline;flex-wrap:wrap">
        <span>${s.ico}</span><b class="tiny">${esc(h.auditoria?.titulo || s.nome)}</b>
        <span class="tiny" style="font-weight:800;${notaCor(n)}">${n ?? '–'}</span>
        <span class="tiny muted">v${esc(h.versao || 1)} · ${esc(h.autor || '')} · ${fmtTs(h.ts)}</span>
        ${v ? `<span class="tiny" style="margin-left:auto;color:${v[0]};font-weight:700">${v[1]}</span>` : ''}
      </div>
    </div>`;
  }).join('')}`;
}

async function gerar(body) {
  if (_busy) return;
  _busy = true; _msg = ''; render();
  try {
    const r = await api.request('/api/v3/marketing/estudio', { method: 'POST', body: { acao: 'gerar', ...body } });
    _atual = r.item; _refazerAberto = false;
    _dados.historico = [r.item, ...(_dados.historico || [])];
  } catch (e) { _msg = '⚠️ ' + e.message; }
  _busy = false; render();
  _root.querySelector('.est-out')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wire() {
  _root.querySelectorAll('[data-sk]').forEach(el => el.onclick = () => { _sel = el.dataset.sk; _msg = ''; render(); _root.querySelector('#est-pedido')?.focus(); });
  const g = _root.querySelector('#est-gerar');
  if (g) g.onclick = () => {
    const pedido = (_root.querySelector('#est-pedido')?.value || '').trim();
    if (!pedido) { _msg = 'Escreva o pedido primeiro.'; render(); return; }
    gerar({ skill: _sel, pedido });
  };
  _root.querySelectorAll('[data-hist]').forEach(el => el.onclick = () => {
    _atual = (_dados.historico || []).find(h => h.id === el.dataset.hist); _refazerAberto = false; render();
    _root.querySelector('.est-out')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const f = _root.querySelector('#est-fechar'); if (f) f.onclick = () => { _atual = null; render(); };
  const c = _root.querySelector('#est-copiar');
  if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(_atual.saida || ''); c.textContent = '✅ copiado'; } catch { c.textContent = 'não deu pra copiar'; } };
  const rf = _root.querySelector('#est-refazer'); if (rf) rf.onclick = () => { _refazerAberto = !_refazerAberto; render(); _root.querySelector('#est-ajuste')?.focus(); };
  const rg = _root.querySelector('#est-refazer-go');
  if (rg) rg.onclick = () => gerar({ skill: _atual.skill, pedido: _atual.pedido, base_id: _atual.id, ajuste: (_root.querySelector('#est-ajuste')?.value || '').trim() });
  const en = _root.querySelector('#est-enviar');
  if (en) en.onclick = async () => {
    if (_busy) return;
    _busy = true; render();
    try {
      await api.request('/api/v3/marketing/estudio', { method: 'POST', body: { acao: 'enviar', id: _atual.id } });
      _busy = false; await load();
    } catch (e) { _busy = false; alert('Não foi: ' + e.message); render(); }
  };
}
