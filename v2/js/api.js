/* ============================================================================
   PSM-OS v2 — API client (ES module)
   ============================================================================
   - Wrapper sobre fetch()
   - Anexa JWT do localStorage automaticamente
   - Detecta 401 e dispara evento 'auth:expired'
============================================================================ */

const TOKEN_KEY  = 'psm.v2.token';
const USER_KEY   = 'psm.v2.user';
const EXP_KEY    = 'psm.v2.expires_at';

export const tokenStore = {
  get()      { return localStorage.getItem(TOKEN_KEY); },
  set(t, e)  { localStorage.setItem(TOKEN_KEY, t); if (e) localStorage.setItem(EXP_KEY, String(e)); },
  clear()    { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EXP_KEY); localStorage.removeItem(USER_KEY); },
  isExpired(){ const e = parseInt(localStorage.getItem(EXP_KEY) || '0', 10); return e > 0 && Date.now() / 1000 > e; },
};

export const userStore = {
  get()  { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  set(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); },
  clear(){ localStorage.removeItem(USER_KEY); },
};

async function request(path, { method = 'GET', body = null, auth = true, headers = {} } = {}) {
  const url = path.startsWith('http') ? path : path;
  const h = { 'Accept': 'application/json', ...headers };
  if (body && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
  }
  if (auth) {
    const tok = tokenStore.get();
    if (tok) h['Authorization'] = 'Bearer ' + tok;
  }

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: h,
      body: body == null ? null : (body instanceof FormData ? body : JSON.stringify(body)),
      cache: 'no-store',
    });
  } catch (e) {
    throw new ApiError(0, 'network', e.message || 'falha de rede');
  }

  // 401 → token inválido/expirado
  if (resp.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }

  let data = null;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await resp.json(); } catch { data = null; }
  } else {
    try { data = await resp.text(); } catch { data = null; }
  }

  if (!resp.ok) {
    const msg = (data && data.error) || (data && data.message) || `HTTP ${resp.status}`;
    throw new ApiError(resp.status, 'http', msg, data);
  }
  // ⚡ Tempo real: após um write bem-sucedido, avisa os outros logins (push <1s). v81.29
  try {
    const m = (method || 'GET').toUpperCase();
    if (m !== 'GET' && m !== 'HEAD' && typeof window !== 'undefined' && window.__psmNotifyChange) {
      window.__psmNotifyChange();
    }
  } catch (_) {}
  return data;
}

export class ApiError extends Error {
  constructor(status, kind, message, data) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.data = data;
  }
}

/* ─── Endpoints (Sprint 7.0) ─────────────────────────────────────────── */

export const api = {
  // Health
  health()      { return request('/api/v3/health', { auth: false }); },

  // Auth
  login(email, password) {
    return request('/api/v3/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
  },
  me() {
    return request('/api/v3/auth/me');
  },
  setPassword(user_id, new_password) {
    return request('/api/v3/auth/set_password', {
      method: 'POST',
      auth: !!tokenStore.get(), // anexa token se houver (bootstrap permite sem)
      body: { user_id, new_password },
    });
  },

  // Users (reaproveita v2 — backward compatible)
  listUsers()   { return request('/api/v2/users'); },
  getUser(id)   { return request('/api/v2/users?id=' + encodeURIComponent(id)); },
  saveUser(u)   { return request('/api/v2/users', { method: 'POST', body: u }); },

  // Generic
  request,
};

export default api;

/**
 * Filtra usuários "selecionáveis" para qualquer dropdown/checkbox de PESSOA no sistema:
 * remove DESATIVADOS (status !== 'ativo') e OCULTOS (hide_from_ranking = true).
 * Os ids em `keep` são SEMPRE mantidos (ex.: o responsável já atribuído a um registro),
 * pra não sumir uma seleção existente nem quebrar a edição de algo antigo.
 * Use SÓ em opções de seleção — para exibir o NOME de quem já está atribuído, use a
 * lista completa de usuários (senão o nome de um inativo viraria o id cru).
 */
export function selectableUsers(users, ...keep) {
  const k = new Set(keep.filter(Boolean).map(String));
  return (users || []).filter(u =>
    k.has(String(u.id)) || ((u.status || 'ativo') === 'ativo' && !u.hide_from_ranking));
}
