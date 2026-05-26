/* ============================================================================
   PSM-OS v2 — Sons da Arena (Web Audio API)
   Sprint 7.25
============================================================================ */

const STORAGE_KEY = 'psm_v2_sons_ativos';
let _ctx = null;
let _enabled = null;

function ensureCtx() {
  if (_ctx) return _ctx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _ctx = new Ctx();
  } catch (e) {
    return null;
  }
  return _ctx;
}

export function isEnabled() {
  if (_enabled != null) return _enabled;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    _enabled = v === null ? true : v === '1';  // default ligado
  } catch { _enabled = true; }
  return _enabled;
}

export function setEnabled(v) {
  _enabled = !!v;
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
  return _enabled;
}

/* ─── Player de tons sintéticos (sem MP3) ─────────────────────────────── */
function playTone(freq, duration, type = 'sine', volume = 0.15) {
  if (!isEnabled()) return;
  const ctx = ensureCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playSequence(notes) {
  if (!isEnabled()) return;
  const ctx = ensureCtx();
  if (!ctx) return;
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n.freq, n.dur, n.type || 'sine', n.vol || 0.15), n.t || (i * 120));
  });
}

/* ─── Presets de sons ─────────────────────────────────────────────────── */
export function playVenda() {
  // Tom alegre crescente: C E G C
  playSequence([
    { freq: 523, dur: 0.15, t: 0,   vol: 0.18 },     // C5
    { freq: 659, dur: 0.15, t: 100, vol: 0.18 },     // E5
    { freq: 784, dur: 0.15, t: 200, vol: 0.18 },     // G5
    { freq: 1047, dur: 0.35, t: 300, vol: 0.22 },    // C6
  ]);
}

export function playAlerta() {
  // Beep duplo grave
  playSequence([
    { freq: 440, dur: 0.18, t: 0,   vol: 0.20 },
    { freq: 440, dur: 0.18, t: 250, vol: 0.20 },
  ]);
}

export function playNotif() {
  // Chime suave
  playSequence([
    { freq: 880, dur: 0.12, t: 0,   vol: 0.10 },
    { freq: 1175, dur: 0.18, t: 80, vol: 0.10 },
  ]);
}

export function playCheckin() {
  playSequence([
    { freq: 660, dur: 0.10, t: 0, vol: 0.12 },
    { freq: 880, dur: 0.15, t: 80, vol: 0.12 },
  ]);
}

export function playError() {
  playSequence([
    { freq: 220, dur: 0.30, t: 0, vol: 0.15, type: 'sawtooth' },
  ]);
}

/* ─── Auto-trigger via global event listener ────────────────────────── */
export function initSounds() {
  // Listener custom — qualquer página pode disparar:
  // window.dispatchEvent(new CustomEvent('psm:sound', { detail: 'venda' }))
  window.addEventListener('psm:sound', e => {
    const t = e.detail;
    if (t === 'venda') playVenda();
    else if (t === 'alerta') playAlerta();
    else if (t === 'notif') playNotif();
    else if (t === 'checkin') playCheckin();
    else if (t === 'error') playError();
  });
}

/* ─── Helper exportado ────────────────────────────────────────────────── */
export const sounds = {
  isEnabled, setEnabled,
  venda: playVenda, alerta: playAlerta, notif: playNotif,
  checkin: playCheckin, error: playError,
  initSounds,
};
