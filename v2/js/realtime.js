/* ============================================================================
   PSM-OS v2 — ⚡⚡ Tempo real PUSH (<1s) via Supabase Realtime Broadcast (v81.29)

   Conecta um WebSocket ao canal de broadcast "psm-os". Quando QUALQUER login faz
   uma ação (write bem-sucedido em api.js → window.__psmNotifyChange), o canal
   recebe um sinal "change" e TODOS os outros logins re-renderizam a página atual
   em <1s — sem recarregar, em qualquer device.

   • O broadcast NÃO carrega dados (só o sinal "mudou") → seguro.
   • Se não estiver configurado (sem anon key) ou o socket cair, o app continua
     no "pulso" (polling) — nada quebra. window.__psmRT sinaliza conexão ativa.
============================================================================ */
import { api } from './api.js';
import { router } from './router.js';
import { refreshNotifs } from './notifs.js';
import { reloadTimeline } from './timeline.js';

const CDN = 'https://esm.sh/@supabase/supabase-js@2';
let _channel = null, _client = null, _last = Date.now(), _pending = false, _t = null;

const bump = () => { _last = Date.now(); };
const isTyping = () => {
  const el = document.activeElement; if (!el) return false;
  const t = (el.tagName || '').toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable === true;
};
const modalOpen = () => !!document.querySelector(
  '.modal.open, .modal[style*="flex"], .modal[style*="block"], .overlay.open, dialog[open], [data-modal="open"]');

function applyRefresh() {
  // Espera o usuário ficar livre pra não atrapalhar (digitando / modal / aba oculta).
  if (document.visibilityState !== 'visible' || isTyping() || modalOpen() || (Date.now() - _last < 1500)) {
    _pending = true; return;
  }
  _pending = false;
  try { router.refresh({ quiet: true }); } catch (_) {}
  try { refreshNotifs(); } catch (_) {}
  try { reloadTimeline(); } catch (_) {}
  try { window.__psmApplyPerms && window.__psmApplyPerms(); } catch (_) {}  // menu ao vivo c/ mudança de permissão
}
function schedule() { clearTimeout(_t); _t = setTimeout(applyRefresh, 250); }  // debounce rajadas

export async function initRealtime() {
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, bump, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _pending) schedule();
  });

  let cfg;
  try { cfg = await api.request('/api/v3/realtime_config'); } catch (_) { return; }   // → segue no pulso
  if (!cfg || !cfg.enabled || !cfg.url || !cfg.anon_key) return;                       // não configurado → pulso
  try {
    const { createClient } = await import(/* @vite-ignore */ CDN);
    _client = createClient(cfg.url, cfg.anon_key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    _channel = _client.channel(cfg.channel || 'psm-os');
    _channel.on('broadcast', { event: 'change' }, () => schedule());
    _channel.subscribe((status) => { window.__psmRT = (status === 'SUBSCRIBED'); });
    // api.js chama isto após cada write bem-sucedido → avisa todos os outros logins.
    window.__psmNotifyChange = () => {
      try { _channel && _channel.send({ type: 'broadcast', event: 'change', payload: {} }); } catch (_) {}
    };
  } catch (_) { window.__psmRT = false; /* CDN/socket falhou → segue no pulso */ }
}
