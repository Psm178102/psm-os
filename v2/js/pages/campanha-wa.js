/* PSM-OS v2 — 📣 Campanha de Ofertas WhatsApp (Evolution API). Diretor (lvl≥7).
   Segmenta leads parados +Nd do RD → compõe oferta (1 imóvel/oferta p/ todos) →
   diretor REVISA e dispara com throttle (1 por vez + teto/dia) → quem responde SIM
   vira 🔥 Quente (capturado pelo webhook). Respeita opt-out. Nada é enviado sem o clique. */
import { api } from '../api.js';
import { auth } from '../auth.js';

let _root = null, _aud = [], _imoveis = [], _status = null;
let _sending = false, _stop = false;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f$ = n => 'R$ ' + Math.round(+n || 0).toLocaleString('pt-BR');
const fone = p => { const s = String(p || ''); return s.length >= 12 ? `(${s.slice(2, 4)}) ${s.slice(4, 9)}-${s.slice(9)}` : s; };

const TPL_PADRAO = 'Oi {primeiro_nome}! Aqui é da PSM Imóveis 🏠\nApareceu uma oportunidade que combina com o que você procurava:\n\n{OFERTA}\n\nQuer que eu te mande os detalhes e fotos? Responde *SIM* que eu já te envio 👍';

export async function pageCampanhaWa(ctx, root) {
  _root = root;
  if ((auth.user()?.lvl || 0) < 7) { root.innerHTML = '<div class="alert alert-warn">🔒 Requer Sócio/Diretor (lvl 7+).</div>'; return; }
  render(true);
  const [aud, imv, st] = await Promise.all([
    api.request('/api/v3/wa/audience?dias=30').catch(e => ({ erro: e.message })),
    api.request('/api/v3/imoveis/list').catch(() => ({ imoveis: [] })),
    api.request('/api/v3/wa/list').catch(() => ({})),
  ]);
  _aud = (aud && aud.audiencia) || [];
  _audErro = aud && aud.erro;
  _imoveis = (imv && imv.imoveis) || [];
  _status = st || {};
  render(false);
}
let _audErro = null;

function render(loading) {
  if (!_root) return;
  if (loading) { _root.innerHTML = `<div class="card"><h2 class="card-title">📣 Campanha de Ofertas (WhatsApp)</h2><div class="muted tiny"><span class="spinner"></span> Carregando audiência (leads parados) + ofertas…</div></div>`; return; }
  const enviadosHoje = (_status && _status.enviados_hoje) || 0;
  const quentes = (_status && _status.quentes) || [];
  const imovelOpts = ['<option value="">— escolher imóvel/oferta —</option>']
    .concat(_imoveis.slice(0, 200).map((i, idx) => `<option value="${idx}">${esc((i.codigo || i.titulo || 'imóvel') + (i.bairro ? ' · ' + i.bairro : '') + (i.valor ? ' · ' + f$(i.valor) : ''))}</option>`)).join('');

  _root.innerHTML = `
  <div class="card">
    <h2 class="card-title">📣 Campanha de Ofertas — WhatsApp</h2>
    <p class="card-sub">Chama leads <b>parados +30 dias</b> do RD com uma oferta. Quem responder <b>SIM</b> vira 🔥 quente pra você atender. Você revisa e dispara — envio com throttle, respeita opt-out.</p>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0">
      ${kpi('🎯 Audiência (c/ telefone)', _aud.length, '#2563eb')}
      ${kpi('📤 Enviados hoje', enviadosHoje, '#d97706')}
      ${kpi('🔥 Responderam SIM', quentes.length, '#16a34a')}
    </div>
    ${_audErro ? `<div class="alert alert-warn">⚠️ ${esc(_audErro)} ${/wa_|relation|exist/i.test(_audErro) ? '— rode <b>supabase/sprint_wa_campanha.sql</b>.' : ''}</div>` : ''}

    <div class="st-sec" style="font-size:11px;text-transform:uppercase;font-weight:800;color:#94a3b8;margin:16px 0 8px">1️⃣ A oferta (vai igual pra todos)</div>
    <div style="background:var(--bg-3);border-radius:12px;padding:13px">
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <label class="tiny muted" style="font-weight:600">Puxar de um imóvel:</label>
        <select id="cw-imovel" class="select" style="max-width:340px;font-size:12px">${imovelOpts}</select>
        <span class="tiny muted">(ou escreva livre abaixo)</span>
      </div>
      <textarea id="cw-msg" class="input" rows="7" style="width:100%;font-family:inherit;font-size:13px;line-height:1.5">${esc(TPL_PADRAO)}</textarea>
      <div class="tiny muted" style="margin-top:6px">Use <code>{primeiro_nome}</code> (personaliza por cliente) e <code>{OFERTA}</code> (preenchido pelo imóvel). <b>Prévia:</b></div>
      <div id="cw-preview" style="background:#0b141a;color:#e9edef;border-radius:10px;padding:12px;margin-top:6px;white-space:pre-wrap;font-size:13px;max-width:420px"></div>
    </div>

    <div class="st-sec" style="font-size:11px;text-transform:uppercase;font-weight:800;color:#94a3b8;margin:16px 0 8px">2️⃣ Disparo (segurança)</div>
    <div style="background:var(--bg-3);border-radius:12px;padding:13px">
      <div class="flex gap-3" style="flex-wrap:wrap;align-items:center">
        <div><label class="tiny muted" style="font-weight:600;display:block">Intervalo entre msgs (seg)</label><input id="cw-int" type="number" class="input" value="8" style="width:110px"></div>
        <div><label class="tiny muted" style="font-weight:600;display:block">Teto por dia</label><input id="cw-cap" type="number" class="input" value="30" style="width:110px"></div>
        <div style="flex:1"></div>
        <button class="btn btn-primary" id="cw-disparar" style="font-size:14px;padding:10px 18px">▶ Revisar e Disparar (${_aud.length})</button>
      </div>
      <div id="cw-prog" class="tiny" style="margin-top:10px"></div>
      <div class="tiny muted" style="margin-top:6px">⚠️ WhatsApp não-oficial: o envio é lento de propósito (1 por vez) pra não banir o número. Quem responder "sair/parar" entra no opt-out automático.</div>
    </div>

    <div class="st-sec" style="font-size:11px;text-transform:uppercase;font-weight:800;color:#94a3b8;margin:16px 0 8px">🔥 Quentes — responderam SIM (atender)</div>
    <div id="cw-quentes"></div>

    <div class="tiny muted" style="margin-top:14px"><a href="#/imoveis" style="color:var(--psm-gold)">← Imóveis</a> · <a href="#/captacoes" style="color:var(--psm-gold)">Captações</a></div>
  </div>`;

  renderQuentes(quentes);
  wire();
  updatePreview();
}

function kpi(l, v, c) { return `<div style="background:var(--bg-3);border-left:4px solid ${c};border-radius:10px;padding:12px"><div class="tiny muted">${l}</div><div style="font-size:22px;font-weight:800;color:${c}">${v}</div></div>`; }

function renderQuentes(q) {
  const el = document.getElementById('cw-quentes'); if (!el) return;
  if (!q.length) { el.innerHTML = '<div class="tiny muted">Ninguém respondeu SIM ainda. Assim que responderem, aparecem aqui com o link pra abrir a conversa.</div>'; return; }
  el.innerHTML = `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
    <thead><tr style="background:var(--bg-3)"><th style="text-align:left;padding:8px 10px">Cliente</th><th style="text-align:left;padding:8px 10px">Telefone</th><th style="text-align:left;padding:8px 10px">Respondeu</th><th style="padding:8px 10px"></th></tr></thead>
    <tbody>${q.map(r => `<tr style="border-bottom:1px solid var(--border)">
      <td style="text-align:left;padding:8px 10px;font-weight:600">${esc(r.nome || '—')}</td>
      <td style="text-align:left;padding:8px 10px">${esc(fone(r.phone))}</td>
      <td style="text-align:left;padding:8px 10px" class="muted">${esc((r.reply_text || '').slice(0, 40))}</td>
      <td style="padding:8px 10px;text-align:right"><a class="btn btn-primary btn-sm" target="_blank" href="https://wa.me/${esc(r.phone)}">💬 Atender</a></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function offerText() {
  const sel = document.getElementById('cw-imovel');
  const i = sel && sel.value !== '' ? _imoveis[+sel.value] : null;
  if (!i) return '';
  const parts = [];
  parts.push('🏠 ' + (i.titulo || i.codigo || 'Imóvel'));
  if (i.tipo) parts.push(i.tipo);
  if (i.bairro) parts.push('📍 ' + i.bairro);
  if (i.valor) parts.push('💰 ' + f$(i.valor));
  return parts.join(' · ');
}

function updatePreview() {
  const msgEl = document.getElementById('cw-msg'), pv = document.getElementById('cw-preview');
  if (!msgEl || !pv) return;
  const nome = (_aud[0] && _aud[0].nome) || 'Maria';
  const primeiro = nome.split(' ')[0];
  let t = msgEl.value.replace(/\{OFERTA\}/g, offerText() || '[escolha um imóvel ou escreva a oferta]');
  t = t.replace(/\{primeiro_nome\}/g, primeiro).replace(/\{nome\}/g, nome);
  pv.textContent = t;
}

function wire() {
  const sel = document.getElementById('cw-imovel');
  if (sel) sel.addEventListener('change', () => { updatePreview(); });
  const msg = document.getElementById('cw-msg');
  if (msg) msg.addEventListener('input', updatePreview);
  const btn = document.getElementById('cw-disparar');
  if (btn) btn.addEventListener('click', disparar);
}

async function disparar() {
  if (_sending) { _stop = true; return; }
  const prog = document.getElementById('cw-prog');
  const int = Math.max(3, parseInt(document.getElementById('cw-int').value) || 8);
  const cap = Math.max(1, parseInt(document.getElementById('cw-cap').value) || 30);
  const jaHoje = (_status && _status.enviados_hoje) || 0;
  const restante = Math.max(0, cap - jaHoje);
  // baked: substitui {OFERTA} agora (o {primeiro_nome} é trocado no backend por contato)
  const msgBase = document.getElementById('cw-msg').value.replace(/\{OFERTA\}/g, offerText());
  const oferta = offerText();
  const alvos = _aud.slice(0, restante);
  if (!alvos.length) { prog.innerHTML = `<span style="color:#dc2626">Teto diário atingido (${jaHoje}/${cap}). Tente amanhã ou aumente o teto.</span>`; return; }
  if (!confirm(`Vai enviar a oferta pra ${alvos.length} cliente(s) parado(s), 1 a cada ${int}s.\n\nPrévia:\n${msgBase.replace(/\{primeiro_nome\}/g, (alvos[0].nome || '').split(' ')[0])}\n\nConfirma o disparo?`)) return;

  _sending = true; _stop = false;
  const btn = document.getElementById('cw-disparar');
  btn.textContent = '⏹ Parar disparo'; btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost');
  let ok = 0, fail = 0, skip = 0;
  for (let k = 0; k < alvos.length; k++) {
    if (_stop) break;
    const c = alvos[k];
    prog.innerHTML = `📤 Enviando ${k + 1}/${alvos.length} — ${esc(c.nome || c.phone)}… <span class="muted">(✅ ${ok} · ⏭ ${skip} · ⚠️ ${fail})</span>`;
    try {
      const r = await api.request('/api/v3/wa/send_one', { method: 'POST', body: {
        phone: c.phone, nome: c.nome, deal_id: c.deal_id, oferta, mensagem: msgBase, campaign: 'ofertas_parados',
      } });
      if (r && r.sent) ok++; else if (r && r.skipped) skip++; else fail++;
    } catch { fail++; }
    if (k < alvos.length - 1 && !_stop) await new Promise(res => setTimeout(res, int * 1000));
  }
  _sending = false;
  btn.textContent = `▶ Revisar e Disparar (${_aud.length})`; btn.classList.add('btn-primary'); btn.classList.remove('btn-ghost');
  prog.innerHTML = `<b style="color:#16a34a">✅ Disparo ${_stop ? 'interrompido' : 'concluído'}:</b> ${ok} enviados · ${skip} pulados (opt-out) · ${fail} falhas. As respostas "sim" aparecem em 🔥 Quentes.`;
  try { _status = await api.request('/api/v3/wa/list'); renderQuentes(_status.quentes || []); } catch {}
}
