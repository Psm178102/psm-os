/* ============================================================================
   PSM-OS v2 — Auth flow
============================================================================ */
import { api, tokenStore, userStore, ApiError } from './api.js';

export const auth = {
  /** Login com email+senha. Resolve com user; lança ApiError em falha. */
  async login(email, password) {
    const r = await api.login(email, password);
    if (!r || !r.ok || !r.token) throw new ApiError(500, 'login', 'resposta inválida');
    tokenStore.set(r.token, r.expires_at);
    userStore.set(r.user);
    return r.user;
  },

  /** Boot: revalida token contra /me e atualiza user no storage. */
  async hydrate() {
    if (!tokenStore.get()) return null;
    if (tokenStore.isExpired()) { tokenStore.clear(); return null; }
    try {
      const r = await api.me();
      if (r && r.ok && r.user) {
        userStore.set(r.user);
        return r.user;
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) tokenStore.clear();
    }
    return null;
  },

  logout() {
    // v88.5: avisa o servidor ANTES de sair, pra registrar a hora exata em que
    // este login foi fechado (alimenta o Check-in/Check-out do sistema). fetch
    // cru + keepalive de propósito: o location.href abaixo mata a página no
    // mesmo instante e uma chamada normal morreria com ela. Exceção consciente
    // à regra "tudo por api.request" — é um disparo sem resposta pra ler.
    try {
      const t = tokenStore.get();
      if (t) {
        fetch('/api/v3/auth/logout', {
          method: 'POST',
          keepalive: true,
          headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: '{}',
        }).catch(() => {});
      }
    } catch (_) {}
    tokenStore.clear();
    userStore.clear();
    location.href = '/login';
  },

  user() { return userStore.get(); },
  isLoggedIn() { return !!tokenStore.get() && !tokenStore.isExpired(); },
};

// Listener global: token expirou em qualquer fetch → manda pro login
window.addEventListener('auth:expired', () => {
  const onLogin = location.pathname === '/login' || location.pathname.endsWith('/login.html');
  if (!onLogin) {
    location.href = '/login?from=' + encodeURIComponent(location.pathname + location.hash);
  }
});

export default auth;
