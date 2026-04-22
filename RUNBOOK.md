# PSM-OS Runbook (v28)

## Visão Geral
Checklist operacional para colocar PSM-OS em producao com seguranca.

## 1. Setup Staging Espelho

### Firebase Projeto Staging
1. https://console.firebase.google.com/
2. Criar projeto `psm-staging`
3. Realtime Database → Criar banco
4. Regras de seguranca: copiar de prod
5. Authentication → Email/Password + Google
6. Copiar apiKey, databaseURL, authDomain para `index-staging.html`

### Supabase Projeto Staging
1. https://supabase.com/dashboard
2. New project: `psm-staging`
3. SQL Editor → executar migrations (mesmas de prod)
4. Settings → API → copiar URL + anon key
5. Settings → Auth → configurar redirect URLs

### Netlify Site Staging
1. netlify.com → Add new site
2. Conectar GitHub repo branch `staging`
3. Deploy dir: `mnt/outputs`
4. Variaveis: `PSM_FB_URL`, `PSM_SUPABASE_URL`, `PSM_SUPABASE_ANON`

## 2. Deploy Cloudflare Worker (Proxy)

```bash
npm i -g wrangler
wrangler login

cd ops/proxy
wrangler kv:namespace create PSM_KV
# copiar ID retornado para wrangler.toml

wrangler secret put GEMINI_API_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put PAGERDUTY_ROUTING_KEY
wrangler secret put SENTRY_KEY

wrangler deploy
```

Apos deploy, no index.html (prod):
```js
localStorage.setItem('PSM_PROXY_URL', 'https://psm-proxy.seudominio.workers.dev');
```

## 3. Sentry Setup

1. sentry.io → New Project → Browser JavaScript
2. Copiar DSN
3. `localStorage.setItem('psm_sentry_dsn', 'https://...@sentry.io/...')`
4. Reload → verificar console: `[PSM-Sentry] ativo`
5. Testar: `throw new Error('teste sentry')` → aparece em Sentry UI

## 4. PagerDuty Setup

1. pagerduty.com → Service → New Service
2. Integration: Events API v2
3. Copiar routing key
4. `localStorage.setItem('PSM_PAGERDUTY_WEBHOOK', 'xxx')`
5. Testar: `psmMonitor.alert('warn', 'teste')`

## 5. GitHub Actions Setup

1. Repo Settings → Secrets:
   - `NETLIFY_AUTH_TOKEN`
   - `NETLIFY_STAGING_SITE_ID`
   - `NETLIFY_PROD_SITE_ID`
   - `PAGERDUTY_ROUTING_KEY`
   - `PSM_TEST_USER`, `PSM_TEST_PASS`
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

2. Copiar `ops/ci/ci.yml` para `.github/workflows/ci.yml`
3. Copiar `ops/ci/scheduled-health.yml` para `.github/workflows/health.yml`
4. Push → verificar Actions tab

## 6. Supabase Auth Migration (senhas)

### 6.1. Criar users na Supabase
Para cada user em `_LOCAL_AUTH`:
```sql
-- Supabase Dashboard → Auth → Users → Add User
-- Email + senha provisoria
```

### 6.2. Migração programatica (uma vez)
```js
// Console navegador apos login admin:
var users = Object.keys(_LOCAL_AUTH);
for (var i=0; i<users.length; i++){
  var email = users[i];
  var senhaProvisoria = 'PSM@2026_' + Math.random().toString(36).slice(2,10);
  await fetch('https://SEU.supabase.co/auth/v1/admin/users', {
    method:'POST',
    headers:{
      'apikey':'SERVICE_ROLE_KEY',
      'Content-Type':'application/json',
      'Authorization':'Bearer SERVICE_ROLE_KEY'
    },
    body: JSON.stringify({ email: email, password: senhaProvisoria, email_confirm: true })
  });
  console.log(email, '→', senhaProvisoria);
  // Enviar email para user trocar
}
```

### 6.3. Ativar Supabase Auth no login
No `index.html` (futuro patch):
```js
// Substituir _localLogin por:
async function _supabaseLogin(email, senha) {
  var { data, error } = await window.psmSupabase.client.auth.signInWithPassword({ email, password: senha });
  return error ? null : data.user;
}
```

### 6.4. Remover `_LOCAL_AUTH` hardcoded
Apagar bloco L10165-10185 apos 100% usuarios migrados.

## 7. Rollback Emergencia

```bash
cd ops/scripts
./rollback.sh --last        # penultimo deploy Netlify
./rollback.sh 27.8          # versao especifica do GitHub Release
```

## 8. Pilot Rollout (Fase 1)

- Selecionar 2-3 power users (Marcus, Lucas, Paulo)
- Staging URL: https://staging--psm-os.netlify.app
- 1 semana uso diario
- Monitorar: Sentry issues, PagerDuty alerts, `psmMonitor.health()`
- Criterio sucesso: 0 critical alerts, <5 warn, feedback +ve

## 9. Rollout Fase 2 (50%)
- 5-8 users
- 2 semanas
- Manter suporte WhatsApp direto

## 10. Rollout Fase 3 (100%)
- Resto equipe
- Anunciar treinamento 30min
- Manter v27.8 disponivel 48h como fallback

## Métricas de saude (psmMonitor.health())
- `level: 'ok'` → tudo bem
- `level: 'warn'` → 1 issue → investigar
- `level: 'critical'` → 2+ issues → PagerDuty aciona
