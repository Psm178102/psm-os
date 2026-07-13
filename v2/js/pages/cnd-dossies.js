/* PSM-OS v2 — 📁 Dossiês de CNDs (v84.37) · aba da tela CNDs (Jurídico)
   Comprador + vendedor + imóvel (ou só um) → checklist de certidões gerado
   pelo perfil, com link de emissão, dados pra colar (CPF, mãe, RG…), status,
   validade com alerta e URL do PDF. Hierarquia: cada um vê os seus; gestão
   (lvl>=7) vê todos. Backend: /api/v3/juridico/dossies */
import { api } from '../api.js';

let _host = null, _d = null, _busy = false, _sel = null, _form = null; // _form: null | 'novo' | dossiê

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hojeStr = () => new Date().toISOString().substring(0, 10);
const ST_CERT = { pendente: ['⏳ Pendente', '#a16207'], emitida: ['✅ Emitida', '#16a34a'], positiva: ['🔴 POSITIVA', '#dc2626'] };
const ECIV = ['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'];
const ECIV_LBL = { solteiro: 'Solteiro(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)', viuvo: 'Viúvo(a)', uniao_estavel: 'União estável' };

export async function dossiesAba(host) { _host = host; await reload(); }

async function reload() {
  if (!_host) return;
  _host.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Carregando dossiês…</div></div>';
  try {
    _d = await api.request('/api/v3/juridico/dossies');
  } catch (e) {
    _host.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div>
      <div class="tiny muted mt-1">Se for a 1ª vez: a tabela "cnd_dossies" precisa da migração no Supabase.</div></div>`;
    return;
  }
  if (_sel) _sel = (_d.dossies || []).find(x => x.id === _sel.id) || null;
  render();
}

async function post(body, okMsg) {
  if (_busy) return null;
  _busy = true;
  let r = null;
  try {
    r = await api.request('/api/v3/juridico/dossies', { method: 'POST', body });
    if (okMsg) alert(okMsg);
  } catch (e) { alert('❌ NÃO SALVOU: ' + e.message); }
  _busy = false;
  return r;
}

const userName = id => ((_d.users || []).find(u => u.id === id) || {}).name || '—';
const vencida = c => c.validade && String(c.validade).substring(0, 10) < hojeStr() && c.status !== 'pendente';

function progresso(d) {
  const cs = d.certidoes || [];
  const ok = cs.filter(c => c.status === 'emitida' && !vencida(c)).length;
  return { ok, total: cs.length, positivas: cs.filter(c => c.status === 'positiva').length,
           vencidas: cs.filter(vencida).length };
}

/* ── render raiz ─────────────────────────────────────────────────────────── */
function render() {
  if (_form) return renderForm();
  if (_sel) return renderDossie();
  const list = _d.dossies || [];
  _host.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <h3 class="card-title" style="margin:0">📁 Dossiês de CNDs</h3>
          <div class="tiny muted">Cadastre comprador, vendedor e imóvel — o sistema monta o checklist de certidões, com link de emissão e os dados prontos pra colar. ${_d.gestao ? 'Você vê TODOS os dossiês (gestão).' : 'Você vê os dossiês que criou.'}</div>
        </div>
        <button class="btn btn-primary btn-sm" id="dd-novo">➕ Novo dossiê</button>
      </div>
    </div>
    <div class="mt-2">
      ${list.map(d => {
        const p = progresso(d);
        const pct = p.total ? Math.round(p.ok / p.total * 100) : 0;
        return `<div class="card dd-item" data-id="${esc(d.id)}" style="margin:0 0 8px;padding:12px 14px;cursor:pointer">
          <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
            <b>${esc(d.titulo)}</b>
            <span class="badge">${d.status === 'completo' ? '✅ completo' : d.status === 'arquivado' ? '📦 arquivado' : '🔵 aberto'}</span>
            ${p.positivas ? `<span class="badge" style="background:#dc262622;color:#dc2626;font-weight:800">🔴 ${p.positivas} POSITIVA(S)</span>` : ''}
            ${p.vencidas ? `<span class="badge" style="background:#a1620722;color:#a16207;font-weight:800">⚠️ ${p.vencidas} vencida(s)</span>` : ''}
            <span style="margin-left:auto" class="tiny muted">${p.ok}/${p.total} certidões</span>
          </div>
          <div style="background:var(--bg-3);border-radius:99px;height:6px;margin-top:8px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${pct === 100 ? '#16a34a' : '#2563eb'}"></div>
          </div>
          <div class="tiny muted mt-1">por ${esc(userName(d.criado_por))} · ${esc(String(d.criado_em || '').substring(0, 10).split('-').reverse().join('/'))}</div>
        </div>`;
      }).join('') || '<div class="card muted" style="text-align:center;padding:26px">Nenhum dossiê ainda. Clique em ➕ Novo dossiê.</div>'}
    </div>`;
  _host.querySelector('#dd-novo').onclick = () => { _form = 'novo'; render(); };
  _host.querySelectorAll('.dd-item').forEach(el => el.onclick = () => {
    _sel = (_d.dossies || []).find(x => x.id === el.dataset.id); render();
  });
}

/* ── formulário do dossiê ────────────────────────────────────────────────── */
function pessoaForm(pfx, p, titulo, basica) {
  p = p || {};
  const conj = ['casado', 'uniao_estavel'].includes(p.estado_civil || '');
  return `<div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:10px">
    <b class="tiny">${titulo}</b> <span class="tiny muted">${basica ? '(checklist básico: Federal + CNDT)' : '(checklist completo de certidões)'} — deixe em branco pra não incluir</span>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="${pfx}-nome" value="${esc(p.nome || '')}" placeholder="Nome completo" style="flex:2;min-width:200px">
      <input class="input" id="${pfx}-cpf" value="${esc(p.cpf || '')}" placeholder="CPF" style="flex:1;min-width:130px">
      <input class="input" id="${pfx}-rg" value="${esc(p.rg || '')}" placeholder="RG" style="flex:1;min-width:110px">
      <input class="input" id="${pfx}-nascimento" type="date" value="${esc(p.nascimento || '')}" title="Data de nascimento" style="width:150px">
    </div>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="${pfx}-mae" value="${esc(p.mae || '')}" placeholder="Nome da mãe" style="flex:1;min-width:180px">
      <input class="input" id="${pfx}-pai" value="${esc(p.pai || '')}" placeholder="Nome do pai" style="flex:1;min-width:180px">
      <input class="input" id="${pfx}-naturalidade" value="${esc(p.naturalidade || '')}" placeholder="Naturalidade" style="flex:1;min-width:140px">
      <select class="input" id="${pfx}-eciv" style="width:160px">
        <option value="">Estado civil…</option>
        ${ECIV.map(e => `<option value="${e}"${p.estado_civil === e ? ' selected' : ''}>${ECIV_LBL[e]}</option>`).join('')}
      </select>
    </div>
    <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="${pfx}-profissao" value="${esc(p.profissao || '')}" placeholder="Profissão" style="flex:1;min-width:140px">
      <input class="input" id="${pfx}-endereco" value="${esc(p.endereco || '')}" placeholder="Endereço" style="flex:2;min-width:220px">
    </div>
    <div id="${pfx}-conj" class="flex mt-1" style="gap:6px;flex-wrap:wrap;${conj ? '' : 'display:none'}">
      <span class="tiny" style="width:100%;font-weight:800">💍 Cônjuge (casado/união: entra no checklist com a lista completa)</span>
      <input class="input" id="${pfx}-cnome" value="${esc(p.conjuge_nome || '')}" placeholder="Nome do cônjuge" style="flex:2;min-width:200px">
      <input class="input" id="${pfx}-ccpf" value="${esc(p.conjuge_cpf || '')}" placeholder="CPF do cônjuge" style="flex:1;min-width:130px">
      <input class="input" id="${pfx}-crg" value="${esc(p.conjuge_rg || '')}" placeholder="RG do cônjuge" style="flex:1;min-width:110px">
    </div>
  </div>`;
}

function lerPessoa(pfx) {
  const g = id => (_host.querySelector(`#${pfx}-${id}`)?.value || '').trim();
  return { nome: g('nome'), cpf: g('cpf'), rg: g('rg'), nascimento: g('nascimento'),
           mae: g('mae'), pai: g('pai'), naturalidade: g('naturalidade'),
           estado_civil: g('eciv'), profissao: g('profissao'), endereco: g('endereco'),
           conjuge_nome: g('cnome'), conjuge_cpf: g('ccpf'), conjuge_rg: g('crg') };
}

function renderForm() {
  const d = _form === 'novo' ? {} : _form;
  const im = d.imovel || {};
  _host.innerHTML = `
    <div class="card">
      <div class="flex items-center"><h3 class="card-title" style="margin:0;flex:1">${_form === 'novo' ? '➕ Novo dossiê' : '✏️ Editar dossiê'}</h3>
        <button class="btn btn-ghost btn-sm" id="dd-voltar">← Voltar</button></div>
      <div class="mt-2"><input class="input" id="dd-titulo" value="${esc(d.titulo || '')}" placeholder="Título do dossiê * — ex.: Casa Rua das Flores · João → Maria" style="font-weight:700"></div>
      ${pessoaForm('dv', d.vendedor, '🏠 VENDEDOR', false)}
      ${pessoaForm('dc', d.comprador, '🤝 COMPRADOR', true)}
      <div class="mt-2" style="background:var(--bg-3);border-radius:10px;padding:10px">
        <b class="tiny">🏘 IMÓVEL</b> <span class="tiny muted">(tributos municipais; matrícula atualizada fica fora — tem custo)</span>
        <div class="flex mt-1" style="gap:6px;flex-wrap:wrap">
          <input class="input" id="di-endereco" value="${esc(im.endereco || '')}" placeholder="Endereço do imóvel" style="flex:2;min-width:220px">
          <input class="input" id="di-matricula" value="${esc(im.matricula || '')}" placeholder="Nº da matrícula" style="flex:1;min-width:120px">
          <input class="input" id="di-cartorio" value="${esc(im.cartorio || '')}" placeholder="Cartório de registro" style="flex:1;min-width:150px">
        </div>
        <div class="flex mt-1" style="gap:6px;flex-wrap:wrap;align-items:center">
          <input class="input" id="di-inscricao" value="${esc(im.inscricao_municipal || '')}" placeholder="Inscrição municipal / IPTU" style="flex:1;min-width:170px">
          <input class="input" id="di-cidade" value="${esc(im.cidade || '')}" placeholder="Cidade" style="flex:1;min-width:130px">
          <label class="tiny flex gap-1" style="align-items:center;font-weight:700"><input type="checkbox" id="di-cond" ${im.condominio ? 'checked' : ''}> É condomínio (inclui quitação condominial)</label>
        </div>
      </div>
      <div class="mt-2"><textarea class="input" id="dd-obs" rows="2" placeholder="Observações do dossiê" style="resize:vertical">${esc(d.obs || '')}</textarea></div>
      <div class="flex mt-3" style="gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="dd-cancel">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="dd-save">💾 Salvar e gerar checklist</button>
      </div>
    </div>`;
  const voltar = () => { _form = null; render(); };
  _host.querySelector('#dd-voltar').onclick = voltar;
  _host.querySelector('#dd-cancel').onclick = voltar;
  ['dv', 'dc'].forEach(pfx => {
    const sel = _host.querySelector(`#${pfx}-eciv`);
    sel.onchange = () => {
      _host.querySelector(`#${pfx}-conj`).style.display = ['casado', 'uniao_estavel'].includes(sel.value) ? '' : 'none';
    };
  });
  _host.querySelector('#dd-save').onclick = async () => {
    const titulo = _host.querySelector('#dd-titulo').value.trim();
    if (!titulo) { alert('Dê um título ao dossiê.'); return; }
    const g = id => (_host.querySelector('#' + id)?.value || '').trim();
    const body = { action: 'upsert', id: _form === 'novo' ? undefined : _form.id, titulo,
                   vendedor: lerPessoa('dv'), comprador: lerPessoa('dc'),
                   imovel: { endereco: g('di-endereco'), matricula: g('di-matricula'), cartorio: g('di-cartorio'),
                             inscricao_municipal: g('di-inscricao'), cidade: g('di-cidade'),
                             condominio: _host.querySelector('#di-cond').checked },
                   obs: g('dd-obs') };
    const r = await post(body, '📁 Dossiê salvo — checklist de certidões gerado.');
    if (r) { _form = null; _sel = { id: r.id }; reload(); }
  };
}

/* ── vista do dossiê (dados pra colar + checklist) ───────────────────────── */
function chipsCopiar(titulo, pares) {
  const chips = pares.filter(([, v]) => v).map(([l, v]) =>
    `<button class="btn btn-ghost btn-sm dd-copy" data-v="${esc(v)}" title="Copiar ${esc(l)}" style="padding:2px 9px;font-size:11px">${esc(l)}: <b>${esc(v)}</b> 📋</button>`).join('');
  return chips ? `<div class="mt-1"><span class="tiny muted" style="font-weight:800">${titulo}</span><div class="flex" style="gap:4px;flex-wrap:wrap;margin-top:3px">${chips}</div></div>` : '';
}

function renderDossie() {
  const d = _sel;
  const p = progresso(d);
  const grupos = {};
  (d.certidoes || []).forEach(c => { (grupos[c.rotulo] = grupos[c.rotulo] || []).push(c); });
  const v = d.vendedor || {}, c0 = d.comprador || {}, im = d.imovel || {};
  const fmtN = s => s ? String(s).substring(0, 10).split('-').reverse().join('/') : '';
  _host.innerHTML = `
    <div class="card">
      <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="dd-voltar">←</button>
        <h3 class="card-title" style="margin:0;flex:1">${esc(d.titulo)}</h3>
        <span class="tiny muted">${p.ok}/${p.total} emitidas</span>
        <select class="input" id="dd-status" style="width:auto;padding:3px 8px">
          ${['aberto', 'completo', 'arquivado'].map(s => `<option value="${s}"${d.status === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="dd-editar">✏️ Editar dados</button>
        <button class="btn btn-ghost btn-sm" id="dd-del" style="color:#dc2626">🗑</button>
      </div>
      ${chipsCopiar('🏠 Vendedor — clique pra copiar', [['Nome', v.nome], ['CPF', v.cpf], ['RG', v.rg], ['Nascimento', fmtN(v.nascimento)], ['Mãe', v.mae], ['Pai', v.pai], ['Naturalidade', v.naturalidade]])}
      ${chipsCopiar('💍 Cônjuge do vendedor', [['Nome', v.conjuge_nome], ['CPF', v.conjuge_cpf], ['RG', v.conjuge_rg]])}
      ${chipsCopiar('🤝 Comprador', [['Nome', c0.nome], ['CPF', c0.cpf], ['RG', c0.rg], ['Nascimento', fmtN(c0.nascimento)], ['Mãe', c0.mae]])}
      ${chipsCopiar('🏘 Imóvel', [['Endereço', im.endereco], ['Matrícula', im.matricula], ['Inscrição', im.inscricao_municipal], ['Cidade', im.cidade]])}
      ${d.obs ? `<div class="tiny muted mt-2">📝 ${esc(d.obs)}</div>` : ''}
    </div>
    ${Object.entries(grupos).map(([rotulo, certs]) => `
      <div class="card mt-2" style="padding:12px 14px">
        <b class="tiny">${esc(rotulo)}</b>
        ${certs.map(c => {
          const [sl, sc] = ST_CERT[c.status] || ST_CERT.pendente;
          const venc = vencida(c);
          return `<div style="border-top:1px solid var(--bd,#eef2f7);padding:8px 0" data-cert="${esc(c.alvo)}|${esc(c.tipo)}">
            <div class="flex items-center" style="gap:6px;flex-wrap:wrap">
              <b style="font-size:13px">${esc(c.nome)}</b>
              <span class="tiny" style="background:${sc}1a;color:${sc};padding:1px 9px;border-radius:999px;font-weight:800">${sl}</span>
              ${venc ? '<span class="tiny" style="background:#dc26261a;color:#dc2626;padding:1px 9px;border-radius:999px;font-weight:800">⚠️ VENCIDA</span>' : ''}
              <span style="margin-left:auto"></span>
              ${c.link ? `<a class="btn btn-primary btn-sm" href="${esc(c.link)}" target="_blank" rel="noopener" style="padding:2px 10px;font-size:11px">🔗 Emitir</a>` : ''}
              ${c.arquivo_url ? `<a class="btn btn-ghost btn-sm" href="${esc(c.arquivo_url)}" target="_blank" rel="noopener" style="padding:2px 10px;font-size:11px">📄 PDF</a>` : ''}
            </div>
            <div class="flex mt-1" style="gap:6px;flex-wrap:wrap;align-items:center">
              <select class="input ct-status" style="width:auto;padding:2px 7px;font-size:12px">
                ${Object.entries(ST_CERT).map(([k, [l]]) => `<option value="${k}"${c.status === k ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
              <label class="tiny muted">validade <input class="input ct-val" type="date" value="${esc(String(c.validade || '').substring(0, 10))}" style="width:140px;padding:2px 6px"></label>
              <input class="input ct-url" value="${esc(c.arquivo_url || '')}" placeholder="URL do PDF (Drive)" style="flex:1;min-width:160px;padding:2px 8px;font-size:12px">
              <button class="btn btn-ghost btn-sm ct-save" style="padding:2px 10px;font-size:11px">💾</button>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('') || '<div class="card mt-2 muted">Checklist vazio — edite o dossiê e preencha vendedor, comprador ou imóvel.</div>'}`;
  _host.querySelector('#dd-voltar').onclick = () => { _sel = null; render(); };
  _host.querySelector('#dd-editar').onclick = () => { _form = d; render(); };
  _host.querySelector('#dd-status').onchange = async e => {
    await post({ action: 'upsert', id: d.id, titulo: d.titulo, vendedor: d.vendedor, comprador: d.comprador, imovel: d.imovel, obs: d.obs, status: e.target.value });
    reload();
  };
  _host.querySelector('#dd-del').onclick = async () => {
    if (!confirm(`Excluir o dossiê "${d.titulo}"? Os dados e o checklist somem de vez.`)) return;
    const r = await post({ action: 'delete', id: d.id });
    if (r) { _sel = null; reload(); }
  };
  _host.querySelectorAll('.dd-copy').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.v); } catch (_) { prompt('Copie:', b.dataset.v); return; }
    b.style.background = '#16a34a22'; setTimeout(() => { b.style.background = ''; }, 900);
  });
  _host.querySelectorAll('[data-cert]').forEach(row => {
    row.querySelector('.ct-save').onclick = async () => {
      const [alvo, tipo] = row.dataset.cert.split('|');
      const r = await post({ action: 'set_cert', id: d.id, alvo, tipo,
                             cstatus: row.querySelector('.ct-status').value,
                             validade: row.querySelector('.ct-val').value,
                             arquivo_url: row.querySelector('.ct-url').value.trim() });
      if (r) reload();
    };
  });
}
