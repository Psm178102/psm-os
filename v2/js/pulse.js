/* ============================================================================
   PSM-OS v2 — ⚡ Pulso de tempo real (v81.27)
   Pergunta ao backend a cada ~12s "mudou algo?" (assinatura leve de últimas
   mudanças). Quando a assinatura muda, re-renderiza a PÁGINA ATUAL em silêncio
   (sem piscar, preservando scroll) + atualiza sino e recados. Só re-desenha
   quando algo REALMENTE mudou — então não perde o que você está fazendo e não
   gasta à toa. Espera o usuário ficar livre (sem digitar, sem modal) pra aplicar.
============================================================================ */
import { api } from './api.js';
import { router } from './router.js';
import { refreshNotifs } from './notifs.js';
import { reloadTimeline } from './timeline.js';

const POLL_MS = 6000;
let _sig = null, _timer = null, _last = Date.now(), _pending = false, _lastRun = 0;

const bump = () => { _last = Date.now(); };
const isTyping = () => {
  const el = document.activeElement; if (!el) return false;
  const t = (el.tagName || '').toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable === true;
};
const modalOpen = () => !!document.querySelector(
  '.modal.open, .modal[style*="flex"], .modal[style*="block"], .overlay.open, dialog[open], [data-modal="open"]');

export function initPulse() {
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, bump, { passive: true }));
  if (_timer) clearInterval(_timer);
  tick();
  _timer = setInterval(tick, POLL_MS);
}

async function tick() {
  if (document.visibilityState !== 'visible') return;
  // Se o WebSocket (realtime.js) está conectado, o pulso vira só REDE DE SEGURANÇA
  // (a cada ~25s) — o push <1s já cobre o tempo real. Sem socket, mantém os 6s.
  const minGap = window.__psmRT ? 25000 : 0;
  if (Date.now() - _lastRun < minGap) return;
  _lastRun = Date.now();
  let sig;
  try { const r = await api.request('/api/v3/pulse'); sig = r && r.sig; } catch (_) { return; }
  if (sig == null) return;
  if (_sig === null) { _sig = sig; return; }   // baseline: só guarda
  if (sig !== _sig) { _sig = sig; _pending = true; }
  if (!_pending) return;
  // Tem mudança pendente — aplica quando o usuário estiver livre (não atrapalha o uso).
  if (isTyping() || modalOpen() || (Date.now() - _last < 4000)) return;
  _pending = false;
  try { router.refresh({ quiet: true }); } catch (_) {}
  try { refreshNotifs(); } catch (_) {}
  try { reloadTimeline(); } catch (_) {}
}
