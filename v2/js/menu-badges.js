/* ============================================================================
   PSM-OS v2 — 🔴 Números no menu lateral  (v88.34)

   Pedido do Paulo (23/09/2026), ao ver o "2" da Central de Operações: "toda vez
   que houver uma novidade ou algo importante, notificar também na aba do menu".

   Fonte: os avisos que já existem (tabela notifications). Cada aviso aponta pra
   uma tela (campo link) → o item daquela tela no menu ganha o número de avisos
   NÃO LIDOS. Como o menu abre com as seções fechadas, o título da seção mostra a
   soma do que tem dentro. Abrir a tela = avisos dela lidos → o número some
   (e o sino atualiza).

   Exceção: a Central de Operações conta os PROBLEMAS ativos (vem do vigia, não
   de avisos) — laranja quando é só atenção, vermelho quando há erro.

   Marcação via data-badge + CSS: o menu-labels reescreve o texto das seções e
   apagaria qualquer <span> colocado ali.
============================================================================ */
import { api } from './api.js';

let _timer = null;
let _porTela = {};                 // { '/crm': { n, ids } }
let _ops = { n: 0, erro: false };  // Central de Operações
let _marcando = null;

export function initMenuBadges() {
  css();
  refreshMenuBadges();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => { if (!document.hidden) refreshMenuBadges(); }, 60000);
  if (!window._psmMenuBadgesRoute) {
    window._psmMenuBadgesRoute = true;
    window.addEventListener('hashchange', () => setTimeout(lerTelaAtual, 2500));
  }
  setTimeout(lerTelaAtual, 4000);
}

export async function refreshMenuBadges() {
  try {
    const r = await api.request('/api/v3/notifications/list?por_tela=1');
    _porTela = r.por_tela || {};
  } catch (_) { /* sem rede: mantém o último */ }
  pintar();
}

/** Central de Operações: n problemas ativos (erro = vermelho, só atenção = laranja). */
export function setOpsBadge(n, erro) {
  _ops = { n: n || 0, erro: !!erro };
  pintar();
}

function rotaAtual() {
  const h = (location.hash || '').replace(/^#/, '');
  const base = h.split('?')[0].split('/').filter(Boolean)[0];
  return base ? '/' + base : null;
}

// Ficou na tela? Os avisos dela viram lidos (o número daquele item some).
async function lerTelaAtual() {
  const rota = rotaAtual();
  const e = rota && _porTela[rota];
  if (!e || !e.ids?.length || _marcando === rota) return;
  _marcando = rota;
  try {
    await api.request('/api/v3/notifications/mark_read', { method: 'POST', body: { ids: e.ids } });
    delete _porTela[rota];
    pintar();
    window.dispatchEvent(new CustomEvent('psm:notifs-refresh'));
  } catch (_) {
  } finally {
    _marcando = null;
  }
}

function pintar() {
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  sidebar.querySelectorAll('.sb-link[data-nav]').forEach(btn => {
    const rota = btn.dataset.nav;
    let n = _porTela[rota]?.n || 0;
    let cor = 'err';
    if (rota === '/central-ops') {
      n = _ops.n;
      cor = _ops.erro ? 'err' : 'warn';
    }
    if (n > 0) {
      btn.dataset.badge = n > 99 ? '99+' : String(n);
      btn.dataset.badgeCor = cor;
      btn.title = rota === '/central-ops'
        ? (_ops.erro ? `${n} problema(s) na operação` : `${n} ponto(s) de atenção`)
        : `${n} aviso(s) novo(s) nesta tela`;
    } else if (btn.dataset.badge) {
      delete btn.dataset.badge;
      delete btn.dataset.badgeCor;
      btn.removeAttribute('title');
    }
  });
  // título da seção = soma do que tem dentro (as seções começam fechadas)
  sidebar.querySelectorAll('.sb-sec').forEach(sec => {
    let soma = 0, temErro = false;
    let el = sec.nextElementSibling;
    while (el && !el.classList.contains('sb-sec')) {
      if (el.dataset?.badge) {
        soma += parseInt(el.dataset.badge, 10) || 0;
        if (el.dataset.badgeCor === 'err') temErro = true;
      }
      el = el.nextElementSibling;
    }
    if (soma > 0) {
      sec.dataset.badge = soma > 99 ? '99+' : String(soma);
      sec.dataset.badgeCor = temErro ? 'err' : 'warn';
    } else if (sec.dataset.badge) {
      delete sec.dataset.badge;
      delete sec.dataset.badgeCor;
    }
  });
}

function css() {
  if (document.getElementById('menu-badges-css')) return;
  const st = document.createElement('style');
  st.id = 'menu-badges-css';
  const pill = 'color:#fff;border-radius:9px;padding:0 7px;font-size:11px;font-weight:700;line-height:18px;'
    + 'letter-spacing:0;text-transform:none;min-width:18px;text-align:center;box-sizing:border-box';
  st.textContent =
    `.sb-link[data-badge]::after{content:attr(data-badge);margin-left:auto;${pill};background:var(--err)}`
    + '.sb-link[data-badge-cor="warn"]::after{background:var(--warn)}'
    // seção FECHADA mostra a soma (aberta, os itens já mostram); ::after é a setinha → número no ::before
    + `.sb-sec.sec-collapsed[data-badge]::before{content:attr(data-badge);position:absolute;right:24px;top:50%;transform:translateY(-50%);${pill};background:var(--err)}`
    + '.sb-sec.sec-collapsed[data-badge-cor="warn"]::before{background:var(--warn)}';
  document.head.appendChild(st);
}
