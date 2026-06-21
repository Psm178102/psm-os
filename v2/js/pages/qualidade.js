/* ============================================================================
   PSM-OS v2 — 🧹 Qualidade dos Dados (saúde dos cadastros)
   Varredura read-only que aponta: duplicatas, campos faltando, URLs suspeitas e
   credenciais sem dono / com usuário inativo. Lê os mesmos endpoints das telas
   (nada é alterado aqui). Cada achado leva à página onde se corrige.
============================================================================ */
import { api } from '../api.js';

let _root = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const httpOk = u => { const s = String(u || '').trim(); return !s || /^https?:\/\//i.test(s); };

export async function pageQualidade(ctx, root) {
  _root = root;
  root.innerHTML = '<div class="card"><div class="flex items-center gap-2 muted"><span class="spinner"></span> Varrendo os cadastros…</div></div>';
  const safe = u => api.request(u).catch(() => null);
  const [sist, sac, lk, cnd, vault, users] = await Promise.all([
    safe('/api/v3/secretaria/sistemas'), safe('/api/v3/secretaria/sac'),
    safe('/api/v3/secretaria/links'), safe('/api/v3/juridico/cnds'),
    safe('/api/v3/vault/creds'), safe('/api/v3/users/list'),
  ]);
  const I = (sist && sist.items) || [], S = (sac && sac.items) || [], L = (lk && lk.items) || [],
        C = (cnd && cnd.items) || [], V = (vault && vault.items) || [], U = (users && users.users) || [];

  const inativos = new Set(U.filter(u => (u.status || 'ativo') !== 'ativo' || u.hide_from_ranking).map(u => String(u.id)));
  const nome = id => (U.find(u => String(u.id) === String(id)) || {}).name || id;
  const issues = [];   // {sev:1|2|3, area, ico, hash, titulo, det}
  const add = (sev, area, ico, hash, titulo, det) => issues.push({ sev, area, ico, hash, titulo, det });

  // ── Duplicatas (por nome normalizado) ───────────────────────────────
  function dups(arr, keyFn, label) {
    const map = {};
    arr.forEach(it => { const k = keyFn(it); if (k) (map[k] = map[k] || []).push(it); });
    return Object.entries(map).filter(([, v]) => v.length > 1).map(([, v]) => v);
  }
  dups(I, x => norm(x.incorporadora)).forEach(g => add(2, 'Incorporadoras', '🏢', '#/sistemas-incorporadoras', `Duplicada: "${g[0].incorporadora}"`, `${g.length} cards com o mesmo nome — junte num só.`));
  dups(L, x => String(x.link || '').trim() || norm(x.titulo)).forEach(g => add(3, 'Links úteis', '🔗', '#/links-uteis', `Duplicado: "${g[0].titulo}"`, `${g.length} entradas iguais.`));
  dups(C, x => String(x.link || '').trim() || norm(x.titulo)).forEach(g => add(3, "CND's", '⚖️', '#/cnds', `Duplicado: "${g[0].titulo}"`, `${g.length} entradas iguais.`));
  dups(V, x => norm(x.titulo)).forEach(g => add(3, 'Cofre', '🔐', '#/logins', `Duplicado: "${g[0].titulo}"`, `${g.length} credenciais com o mesmo título.`));
  dups(S, x => norm((x.incorporadora || '') + '|' + (x.tipo || '') + '|' + (x.nome || ''))).forEach(g => add(3, 'SAC', '📞', '#/sac-incorporadoras', `Contato repetido em "${g[0].incorporadora}"`, `${g.length} iguais (${esc(g[0].tipo || 'contato')}).`));

  // ── Campos faltando ─────────────────────────────────────────────────
  I.forEach(x => { if (!x.sistema_login || !x.sistema_senha) add(1, 'Incorporadoras', '🏢', '#/sistemas-incorporadoras', `Acesso incompleto: "${x.incorporadora}"`, `Falta ${[!x.sistema_login && 'login', !x.sistema_senha && 'senha'].filter(Boolean).join(' e ')} do sistema.`); });
  L.forEach(x => { if (!String(x.link || '').trim()) add(2, 'Links úteis', '🔗', '#/links-uteis', `Sem link: "${x.titulo}"`, 'Cadastrado sem URL — não abre nada.'); });
  C.forEach(x => { if (!String(x.link || '').trim()) add(2, "CND's", '⚖️', '#/cnds', `Sem link: "${x.titulo}"`, 'Sem URL de emissão/consulta.'); });
  S.forEach(x => { if (!String(x.telefone || '').trim() && !String(x.whatsapp || '').trim()) add(2, 'SAC', '📞', '#/sac-incorporadoras', `Sem contato: "${x.incorporadora}${x.nome ? ' · ' + x.nome : ''}"`, 'Sem telefone nem WhatsApp.'); });

  // ── URLs suspeitas (não começam com http) ───────────────────────────
  L.forEach(x => { if (!httpOk(x.link)) add(2, 'Links úteis', '🔗', '#/links-uteis', `URL suspeita: "${x.titulo}"`, `Não parece um link válido: ${esc(String(x.link).slice(0, 40))}`); });
  C.forEach(x => { if (!httpOk(x.link)) add(2, "CND's", '⚖️', '#/cnds', `URL suspeita: "${x.titulo}"`, `Não parece um link válido.`); });
  I.forEach(x => { ['grupo_link', 'tabelas_link', 'drive_link', 'sistema_url'].forEach(f => { if (x[f] && !httpOk(x[f])) add(3, 'Incorporadoras', '🏢', '#/sistemas-incorporadoras', `URL suspeita em "${x.incorporadora}"`, `Campo ${f} não parece um link válido.`); }); });

  // ── Cofre: sem dono / com usuário inativo ───────────────────────────
  V.forEach(x => {
    const viewers = (x.viewers || []).map(String);
    if (!viewers.length) add(3, 'Cofre', '🔐', '#/logins', `Só você vê: "${x.titulo}"`, 'Nenhum usuário liberado além do sócio.');
    const inat = viewers.filter(v => inativos.has(v));
    if (inat.length) add(2, 'Cofre', '🔐', '#/logins', `Inativo com acesso: "${x.titulo}"`, `${inat.map(nome).join(', ')} (desativado/oculto) ainda vê esta credencial.`);
    if (!x.senha) add(3, 'Cofre', '🔐', '#/logins', `Sem senha: "${x.titulo}"`, 'Credencial cadastrada sem senha.');
  });

  render(issues, { I: I.length, S: S.length, L: L.length, C: C.length, V: V.length });
}

function render(issues, counts) {
  issues.sort((a, b) => a.sev - b.sev || a.area.localeCompare(b.area, 'pt-BR'));
  const sevLbl = { 1: { t: '🔴 Alta', c: '#dc2626', bg: '#fee2e2' }, 2: { t: '🟡 Média', c: '#b45309', bg: '#fef3c7' }, 3: { t: '🔵 Baixa', c: '#1d4ed8', bg: '#dbeafe' } };
  const n1 = issues.filter(i => i.sev === 1).length, n2 = issues.filter(i => i.sev === 2).length, n3 = issues.filter(i => i.sev === 3).length;
  const total = counts.I + counts.S + counts.L + counts.C + counts.V;

  _root.innerHTML = `
    <style>
      .q-stat{display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 6px}
      .q-stat .s{flex:1;min-width:120px;border:1px solid var(--bd);border-radius:10px;padding:9px 12px;text-align:center}
      .q-stat .n{font-size:22px;font-weight:800;line-height:1}.q-stat .l{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-top:3px;color:var(--ink-muted,#64748b)}
      .q-row{display:flex;align-items:center;gap:10px;border:1px solid var(--bd);border-left:4px solid var(--c);border-radius:10px;padding:9px 13px;margin-bottom:7px}
      .q-row .b{flex:1;min-width:0}.q-row .t{font-size:13.5px;font-weight:700}.q-row .d{font-size:12px;color:var(--ink-muted,#64748b)}
      .q-tag{font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px}
    </style>
    <div class="card">
      <div class="flex items-center" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h2 class="card-title" style="margin:0">🧹 Qualidade dos Dados</h2>
          <p class="tiny muted" style="margin:2px 0 0;max-width:680px">Varredura dos cadastros (Incorporadoras, SAC, Links, CND's, Cofre). Aponta duplicatas, campos faltando, URLs suspeitas e credenciais sem dono. Clique pra corrigir.</p></div>
        <button class="btn btn-ghost btn-sm" id="q-reload">🔄 Re-escanear</button>
      </div>
      <div class="q-stat">
        <div class="s" style="${n1 ? 'border-color:#fca5a5;background:#fef2f2' : ''}"><div class="n" style="color:#dc2626">${n1}</div><div class="l">🔴 Alta</div></div>
        <div class="s" style="${n2 ? 'border-color:#fdba74;background:#fffbeb' : ''}"><div class="n" style="color:#b45309">${n2}</div><div class="l">🟡 Média</div></div>
        <div class="s"><div class="n" style="color:#1d4ed8">${n3}</div><div class="l">🔵 Baixa</div></div>
        <div class="s"><div class="n" style="color:#16a34a">${total}</div><div class="l">Registros</div></div>
      </div>
      ${!issues.length ? `<div class="card mt-2" style="text-align:center;padding:30px;background:var(--bg-3)"><div style="font-size:30px">✨</div><div class="muted tiny" style="margin-top:6px">Tudo limpo! Nenhum problema encontrado nos cadastros.</div></div>`
        : issues.map(i => { const sv = sevLbl[i.sev]; return `<div class="q-row" style="--c:${sv.c}">
            <span style="font-size:17px">${i.ico}</span>
            <div class="b"><div class="t">${esc(i.titulo)}</div><div class="d">${esc(i.det)}</div></div>
            <span class="q-tag" style="background:${sv.bg};color:${sv.c}">${i.area}</span>
            <a class="btn btn-ghost btn-sm" href="${i.hash}">corrigir →</a>
          </div>`; }).join('')}
    </div>`;
  const r = _root.querySelector('#q-reload');
  if (r) r.onclick = () => pageQualidade(null, _root);
}
