/* PSM-OS v2 — Mantém a TELA ACESA (Modo TV / painéis em monitor). v77.78
   Problema: TVs (ex.: LG webOS no navegador nativo) entram em "modo repouso"
   porque a página não sinaliza ao SO pra não dormir.

   Estratégia em camadas (best-effort, honesta):
     1) Screen Wake Lock API — padrão; funciona no webOS/Chromium recente.
        É liberado quando a aba fica oculta → re-adquire em visibilitychange/focus.
     2) Fallback p/ navegadores sem Wake Lock: um <video> minúsculo, mudo, em loop,
        alimentado por canvas.captureStream (sem asset externo). Vídeo TOCANDO
        segura a tela acesa na maioria das TVs/navegadores antigos.
     3) Se nada funcionar (sem Wake Lock e sem captureStream): reporta 'none'
        pra UI orientar o usuário a desativar o descanso de tela nas config. da TV.

   onChange recebe { method:'wakelock'|'video'|'none'|null, on:bool } a cada mudança.
*/
let _active = false;
let _lock = null;
let _video = null, _vidStop = null;
let _onChange = null, _visHandler = null;
let _status = { method: null, on: false };

function _set(method, on) {
  _status = { method, on };
  try { _onChange && _onChange(_status); } catch (_) {}
}

function _startVideo() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const cx = c.getContext('2d');
    const stream = c.captureStream ? c.captureStream(5)
      : (c.mozCaptureStream ? c.mozCaptureStream(5) : null);
    if (!stream) return null;
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.loop = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    // visível (1 canto, quase transparente) — vídeos com display:none costumam não contar
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    v.srcObject = stream;
    document.body.appendChild(v);
    v.play().catch(() => {});
    let t = 0;
    const iv = setInterval(() => { t ^= 1; cx.fillStyle = t ? '#000' : '#010101'; cx.fillRect(0, 0, 16, 16); }, 800);
    _video = v;
    return () => { clearInterval(iv); try { v.pause(); } catch (_) {} v.srcObject = null; v.remove(); _video = null; };
  } catch (_) {
    return null;
  }
}

async function _acquire() {
  if (!_active) return;
  if ('wakeLock' in navigator && navigator.wakeLock && navigator.wakeLock.request) {
    try {
      _lock = await navigator.wakeLock.request('screen');
      _lock.addEventListener && _lock.addEventListener('release', () => { if (_active) _set('wakelock', false); });
      _set('wakelock', true);
      return;
    } catch (_) { /* sem permissão/suporte → fallback */ }
  }
  if (!_video) _vidStop = _startVideo();
  _set(_video ? 'video' : 'none', !!_video);
}

export async function enableWakeLock(onChange) {
  _active = true;
  _onChange = onChange || null;
  _visHandler = () => { if (_active && document.visibilityState === 'visible') _acquire(); };
  document.addEventListener('visibilitychange', _visHandler);
  window.addEventListener('focus', _visHandler);
  await _acquire();
  return _status;
}

export function disableWakeLock() {
  _active = false;
  if (_visHandler) {
    document.removeEventListener('visibilitychange', _visHandler);
    window.removeEventListener('focus', _visHandler);
    _visHandler = null;
  }
  try { _lock && _lock.release && _lock.release(); } catch (_) {}
  _lock = null;
  if (_vidStop) { _vidStop(); _vidStop = null; }
  _set(null, false);
}

export function wakeLockStatus() { return _status; }
