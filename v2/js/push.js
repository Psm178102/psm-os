/* PSM-OS v2 — Web Push (notificações navegador + celular/PWA) — Sprint 9.9 */
import { api } from './api.js';

let _reg = null;

export function pushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}
export function pushPermission() {
  return ('Notification' in window) ? Notification.permission : 'denied';
}

/** Chamado no boot: guarda o registration e, se já houver permissão, garante a inscrição. */
export async function initPush(reg) {
  _reg = reg || null;
  if (!pushSupported()) return;
  if (Notification.permission === 'granted') {
    try { await _subscribe(); } catch (e) { /* silencioso */ }
  }
}

/** Chamado pelo botão: pede permissão e inscreve. Retorna true se ativou. */
export async function enablePush() {
  if (!pushSupported()) { alert('Este navegador não suporta notificações push.'); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('Permissão de notificações negada. Ative nas configurações do navegador.'); return false; }
  try { await _subscribe(); return true; }
  catch (e) { alert('Falha ao ativar notificações: ' + (e.message || e)); return false; }
}

async function _subscribe() {
  const reg = _reg || await navigator.serviceWorker.ready;
  const info = await api.request('/api/v3/push/subscribe', { method: 'GET' });
  if (!info || !info.public_key) throw new Error('servidor sem VAPID configurado');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlB64ToUint8(info.public_key),
    });
  }
  const j = sub.toJSON();
  await api.request('/api/v3/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, keys: j.keys } });
}

function _urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
