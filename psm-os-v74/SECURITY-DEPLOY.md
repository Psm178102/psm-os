# PSM OS v68-v74 — Guia de Deploy Seguro

- **v68 SECURITY HARDENING** (2026-05-13) — Firebase via /api/config, safeHTML/safeMD, TimerRegistry, CSP endurecido
- **v69 PERFORMANCE & A11Y** (2026-05-20) — Logger centralizado, OG/SEO, manifest, skip-link, ARIA landmarks, admin gate
- **v70 MODULARIZATION** (2026-06-03) — Clock, PWA bootstrap e Sentry extraídos; 136 `console.error` migrados para `PSM.log`
- **v71 MORE MODULARIZATION** (2026-06-17) — NoSleep.js, LGPD module e Firebase watchdog extraídos; novo `psmLgpdRevogar()`
- **v72 FIREBASE EXTRACTION** (2026-07-01) — Toda a lógica de sync Firebase (~422 linhas) extraída para `/lib/psm-firebase.js`
- **v73 SUPABASE BRIDGE** (2026-07-15) — Wrapper Supabase funcional + `/api/supabase-config` + schema SQL + RLS policies
- **v74 A11Y & FOCUS** (2026-07-29) — `psm-a11y.js`, focus-visible global, prefers-reduced-motion, `<noscript>` fallback

Este documento descreve as ações obrigatórias para colocar a aplicação em produção de forma segura.

---

## 1. Env vars no Vercel (obrigatório)

Antes de fazer deploy, configure em **Vercel → Project → Settings → Environment Variables**:

| Variável | Valor | Ambiente |
|---|---|---|
| `FIREBASE_API_KEY` | apiKey do projeto Firebase | Production, Preview, Development |
| `FIREBASE_AUTH_DOMAIN` | `psm-os.firebaseapp.com` | todos |
| `FIREBASE_DATABASE_URL` | `https://psm-os-default-rtdb.firebaseio.com` | todos |
| `FIREBASE_PROJECT_ID` | `psm-os` | todos |
| `FIREBASE_STORAGE_BUCKET` | `psm-os.firebasestorage.app` | todos |
| `FIREBASE_MESSAGING_SENDER_ID` | `814980752519` | todos |
| `FIREBASE_APP_ID` | `1:814980752519:web:115914b27d538b4a770422` | todos |
| `GOOGLE_API_KEY` | Chave Google Drive + Maps (configure HTTP referrer restrictions no GCP) | todos |
| `ADMIN_SHA256` | **v69** — SHA-256 hex da senha do `/admin.html`. Gerar: `echo -n "minhasenha" \| shasum -a 256` | todos |
| `SUPABASE_URL` | **v73** — `https://<project>.supabase.co` | todos |
| `SUPABASE_ANON_KEY` | **v73** — Chave anonima do projeto (public-by-design — proteção é via RLS) | todos |
| `PSM_ALLOWED_ORIGINS` | `https://psm-os.vercel.app,https://app.psm.com` | Production |
| `PSM_SENTRY_DSN_PUBLIC` | (opcional) DSN do Sentry para clients | todos |

Após salvar, faça **Redeploy** do projeto para as vars ficarem ativas.

### Verificação

Após deploy, acesse `https://<seu-domínio>/api/config` no browser. Deve responder:

```json
{
  "version": "68.0.0",
  "serverTime": "2026-05-13T...",
  "firebase": { "apiKey": "...", "databaseURL": "...", ... },
  "integrations": { "sentryDsnPublic": null }
}
```

Se `firebase` vier `null`, alguma env var crítica (API_KEY ou DATABASE_URL) está faltando.

---

## 2. Firebase Realtime Database Rules (obrigatório)

A apiKey do Firebase Web SDK é pública por design — quem protege seus dados são
as **Database Rules**. No Firebase Console → Realtime Database → Rules, substitua
pelas regras abaixo:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "shared": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "users": {
      "$uid": {
        ".read":  "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```

**Sem essas rules, qualquer um com a apiKey consegue ler/escrever em qualquer node.**

Ative também a **Authentication anonymous** ou **email/password** no Firebase Console
e ajuste o fluxo de login para chamar `firebase.auth().signInAnonymously()` no boot,
caso ainda não faça.

---

## 3. O que mudou na v68 (resumo técnico)

### Novos arquivos
- `/lib/psm-security.js` — `escapeHTML`, `safeMD`, `buildEl`, `safeURL`
- `/lib/psm-timers.js` — `PSM.timers.register/clear/clearGroup` (registry para fix de memory leak)
- `/lib/psm-config.js` — loader async de `/api/config`
- `/api/config.js` — endpoint serverless que devolve config Firebase a partir das env vars

### Mudanças em arquivos existentes
- `index.html`
  - Removido `FB_DEFAULT_CONFIG` hardcoded — agora vem de `/api/config`
  - `fbInit()` aguarda `PSM.config.onReady` antes de inicializar
  - `el.innerHTML` da resposta Gemini agora passa por `safeMD` (anti-XSS)
  - Filenames de upload escapados com `psmEscape`
  - `cfg.projectId`/`cfg.databaseURL` escapados no Settings modal
  - Erro de cena do Modo TV escapado
  - Timers principais do Modo TV (relógio, progresso, timeline refresh) migrados para `PSM.timers` no grupo `tv-scene` — cleanup automático
  - CSP endurecido: removido `default-src https:` permissivo, `connect-src` com hosts explícitos, adicionado `upgrade-insecure-requests`
  - Versão bumpada para v68.0.0
- `vercel.json`
  - Rewrites adicionados: `/api/config`, `/api/auth`, `/api/dalle`
  - Headers extras: `Strict-Transport-Security`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`
- `sw.js` — `SW_VERSION` para invalidar caches antigos
- `version.json` — v68 + descrição do sprint

---

## 4. Novidades v69 — PERFORMANCE & A11Y

### Arquivos novos
- `/lib/psm-logger.js` — Logger centralizado (`PSM.log.debug/info/warn/error`) com bridge automático para Sentry. Substitui os 141 `console.error("[PSM v27.X]",e)` espalhados. Nível controlável via `localStorage.psm_log_level`.
- `/manifest.json` — Web App Manifest com nome, ícones, shortcuts para Dashboard TV e CRM, theme color. Antes não existia (PWA estava quebrada).

### Mudanças
- `index.html`
  - **OG/Twitter meta tags**: WhatsApp/LinkedIn/Telegram agora geram preview decente
  - `<meta name="description">`, `<meta name="robots">`, `<link rel="canonical">` para SEO
  - **Skip link** `<a class="psm-skip-link">` para usuários de teclado/screen reader
  - **Landmarks ARIA**: `role="application"`, `role="navigation"` (sidebar), `role="banner"` (header), `<main role="main">` (conteúdo)
  - `<div id="toasts">` com `role="status" aria-live="polite"` (screen readers leem toasts)
  - Versão bumpada para v69.0.0
- `admin.html`
  - **Gate de senha** com SHA-256 verificado contra env var `ADMIN_SHA256`
  - Session-based (sessionStorage) — fecha a aba, precisa logar de novo
- `api/config.js` — agora expõe `adminSha256`
- `sw.js` / `version.json` — bumps para invalidar caches

### Como gerar o hash da senha admin

```bash
echo -n "minha-senha-forte-aqui" | shasum -a 256 | awk '{print $1}'
# saida exemplo: 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
```

Cole o resultado em `ADMIN_SHA256` no Vercel.

---

## 5. Novidades v70 — MODULARIZATION

### Arquivos novos
- `/lib/psm-clock.js` — Relógio digital global (canto inferior direito) + Wake Lock API. Antes vivia inline no body.
- `/lib/psm-pwa.js` — Service Worker bootstrap, banner de auto-update, version checker. Antes ~140 linhas inline.
- `/lib/psm-sentry-init.js` — Carregamento async do Sentry SDK + init com DSN do `/api/config`. **DSN hardcoded removido do source.**

### Mudanças
- `index.html`
  - Bloco `<script>` de relógio (linhas 783-810) → 1 linha referenciando `/lib/psm-clock.js`
  - Bloco PWA (linhas 858-996, ~140 linhas) → 1 linha referenciando `/lib/psm-pwa.js`
  - Bloco Sentry (linhas 29957-30000, ~50 linhas) → 1 linha referenciando `/lib/psm-sentry-init.js`
  - **136 chamadas `console.error("[PSM v27.X]",e)` migradas para `PSM.log.error("legacy:27.X","caught",e)`** com bridge automático para Sentry
  - Versão bumpada para v70.0.0
- `vercel.json` / `sw.js` / `version.json` — bumps v70

### Como usar o logger central agora

```js
// Antes (v67-v69)
console.error("[PSM v27.7]", err);

// Agora (v70)
PSM.log.error('feature-name', 'mensagem descritiva', err);
// → também vai para Sentry automaticamente
// → controlável via localStorage.psm_log_level

// Atalhos
PSM.log.debug('boot', 'iniciando...');
PSM.log.info('sync', 'firebase ok');
PSM.log.warn('parse', 'JSON invalido, usando fallback');

// Grupo pré-bindado
var log = PSM.log.group('dashboard-tv');
log.info('cena trocou');
```

### Ganho de manutenibilidade

| Métrica | v69 | v70 |
|---|---|---|
| Blocos de código JS dentro do bundle `index.html` | ~10 blocos `<script>` inline | 7 blocos (3 extraídos) |
| Linhas de JS movidas para `/lib/` | ~30 KB | **~50 KB** (+psm-clock/pwa/sentry-init) |
| Erros não rastreados (`console.error` "fire-and-forget") | 136 | **0** (todos vão pelo logger) |
| Total libs em `/lib/` | 10 | **13** |

---

## 6. Novidades v71 — MORE MODULARIZATION

### Arquivos novos
- `/lib/psm-nosleep.js` — NoSleep.js v0.12.0 (MIT/richtr) wrappado em PSM. Mantém TV acesa via Wake Lock + fallback video 1s base64. Antes ~65 linhas inline.
- `/lib/psm-lgpd.js` — Consentimento LGPD + exportar + deletar dados (direito do titular). **Novo `psmLgpdRevogar()`** permite revogar consentimento sem perder dados. Aguarda `psmConfirm` estar disponível antes de mostrar (resiliente a race condition).
- `/lib/psm-fb-watchdog.js` — Watchdog Firebase: conta falhas consecutivas (default 3) e exibe banner sticky com instruções de troubleshooting. API `PSM.fbWatchdog.setThreshold(n)` permite ajustar sensibilidade.

### Mudanças
- `index.html`
  - Bloco NoSleep.js (linhas 789-860) → 1 referência `/lib/psm-nosleep.js`
  - Bloco LGPD (3 funções, ~60 linhas) → 1 referência `/lib/psm-lgpd.js`
  - Bloco Firebase watchdog (~30 linhas) → 1 referência `/lib/psm-fb-watchdog.js`
  - Versão bumpada para v71.0.0
- `sw.js` / `version.json` — bumps v71

### Comportamento preservado + melhorado

- ✅ Modo TV continua mantendo tela acesa (Chrome/Safari/LG webOS/Tizen)
- ✅ Modal LGPD aparece 1x por usuário, salva consentimento em localStorage
- ✅ Banner "Firebase offline" aparece após 3 falhas consecutivas
- ✅ **Novo**: `PSM.lgpd.revogar()` para revogar consentimento (compliance LGPD art. 8 §5)
- ✅ **Novo**: `PSM.fbWatchdog.setThreshold(n)` para ajustar sensibilidade do watchdog
- ✅ **Novo**: LGPD module aguarda `psmConfirm` estar disponível antes de mostrar (não trava se carregar antes)
- ✅ Todos os logs internos via `PSM.log` → bridge para Sentry automático

---

## 7. Novidades v72 — FIREBASE EXTRACTION

### Arquivo novo
- `/lib/psm-firebase.js` — **422 linhas** de lógica Firebase Realtime Database extraídas do bundle inline.

### O que está dentro
- **State privado** dentro do IIFE: `_fbApp`, `_fbDb`, `_fbReady`, `_fbSyncing`, `_fbLastPush`, `_fbDebounceTimer`, `_fbPendingRun`, `_fbSyncingTimer`, `_fbBackupTimer`, `_fbLastUpdate`, `_fbFirstLoad`
- **API pública** preservada em `window.*` para compat retroativa: `fbGetConfig`, `fbSaveConfig`, `fbInit`, `fbPushState`, `fbSetupConfig`
- **API de debug** nova em `PSM.firebase`: `isReady()`, `isSyncing()`, `getApp()`, `getDb()`

### Dependências externas (do bundle inline)
- `S` (state global), `SYNC_KEYS` (array), `STORAGE_KEY` (const)
- `firebase` (SDK do gstatic, carregado antes da lib)
- `_psmDeepMerge`, `saveState`, `render`, `toast`, `recalcBrokerMetrics`
- `_psmFbBlocked` (do toggle freeze), `psmFbReportFail`/`psmFbReportSuccess` (do watchdog v71)

### Ordem de carregamento crítica

```html
<!-- 1. firebase SDK do CDN -->
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>
<!-- 2. psm-firebase.js (sem defer — bundle inline precisa de fbInit no DOMContentLoaded) -->
<script src="/lib/psm-firebase.js?v=72"></script>
```

### Como debugar em produção

```js
PSM.firebase.isReady()    // true se conectado
PSM.firebase.isSyncing()  // true durante push
PSM.firebase.getDb()      // ref ao Realtime DB

// Forçar push imediato
fbPushState(true)

// Verificar config carregada
fbGetConfig()
```

---

## 8. Novidades v73 — SUPABASE BRIDGE

### O que mudou
Esta versão **não deprecia Firebase**. Adiciona Supabase como destino paralelo com schema e RLS prontos, abrindo caminho para a flippagem segura no futuro.

### Arquivos novos
- `/api/supabase-config.js` — Endpoint Vercel que devolve URL+anon key como JS executável (consumido via `<script src>`).
- `/supabase-schema.sql` — Schema completo: 3 tabelas (`shared_kv`, `user_kv`, `audit_log`) + 6 RLS policies + índices + trigger opcional.

### Wrappers atualizados
- `/lib/psm-supabase.js` — De **stub** (v69) para **wrapper completo v73**:
  - `signIn`, `signUp`, `signOut`, `getUser`
  - `kvGet`, `kvSet`, `kvDelete` para `shared_kv`/`user_kv`
  - `kvSubscribe(table, key, cb)` realtime via Postgres Changes
  - `audit(action, table, key, value)` para `audit_log`
  - `ready()` Promise para aguardar inicialização
  - `getClient()` para chamadas low-level

### Setup obrigatório no Supabase Console

1. **Criar projeto** em https://supabase.com → New Project
2. **Rodar schema SQL** em SQL Editor → New query → colar conteúdo de `/supabase-schema.sql` → Run
3. **Verificar RLS** em Database → Tables → cada tabela deve mostrar `RLS enabled` ✓
4. **Habilitar Auth** em Authentication → Providers → ativar Email (sign up + sign in)
5. **Copiar credenciais** em Project Settings → API:
   - `URL` → env var `SUPABASE_URL`
   - `anon public` → env var `SUPABASE_ANON_KEY`
6. **Configurar Vercel env** com essas duas vars
7. **Redeploy** o projeto

### Como começar a usar

```js
// Aguardar Supabase pronto antes de fazer call
await PSM.supabase.ready();

// Login
var r = await PSM.supabase.signIn('email@psm.com', 'senha');
if (r.error) console.error(r.error);

// Salvar uma chave global
await PSM.supabase.kvSet('shared_kv', 'BROKERS', {alice:1, bob:2});

// Ler de volta
var brokers = await PSM.supabase.kvGet('shared_kv', 'BROKERS');

// Subscrever a mudanças realtime
var unsub = PSM.supabase.kvSubscribe('shared_kv', 'BROKERS', function(payload){
  console.log('mudou no Supabase:', payload);
});
// Para parar:
unsub();

// Registrar audit
await PSM.supabase.audit('update', 'shared_kv', 'BROKERS', {alice:2});
```

### Estratégia BRIDGE (zero downtime)

```
ANTES (v72):                    AGORA (v73):
                                                                    
  App → Firebase                 App → Firebase (primary)
                                     ↘ Supabase (mirror, dual-write opcional)
```

A migração real (flippar primary) acontece em sprint futuro **somente após** validação de RLS em produção, comparação byte-a-byte entre os dois backends e backup completo.

---

## 9. Novidades v74 — A11Y & FOCUS

### Arquivos novos
- `/lib/psm-a11y.js` — Toolkit completo de acessibilidade

### Funções disponíveis

```js
// Anunciar para leitores de tela (sem visual)
PSM.a11y.announce('Venda registrada com sucesso');
PSM.a11y.announce('Erro: campo obrigatório', 'assertive');

// Focus trap em modais (impede Tab vazar para fora)
var trap = PSM.a11y.trapFocus(modalEl);
// ... usuário interage com modal ...
trap.release();  // ao fechar — restaura foco anterior automaticamente

// Esc para fechar modal
var unbind = PSM.a11y.bindEsc(modalEl, function(){ fecharModal(); });
unbind();  // ao destruir

// Navegação com setas em listas
var cleanup = PSM.a11y.keyboardNav(itemNodes, {
  loop: true,
  onEnter: function(item, index, ev){ /* ... */ }
});

// Respeitar preferência do usuário
if (PSM.a11y.prefersReducedMotion()) {
  // desativa animações pesadas
}

// Texto escondido visualmente, lido por SR
container.appendChild(PSM.a11y.srOnly('Aviso adicional para SR'));
```

### CSS global de a11y (adicionado ao head)

- **`:focus-visible`** com outline dourado #d4af37 + box-shadow — antes invisível em muitos botões
- **`@media (prefers-reduced-motion: reduce)`** — desativa as 29+ animations CSS para usuários sensíveis
- **`.sr-only` / `.psm-sr-only`** — classe utilitária para texto somente leitor de tela
- **Min `28px` height** em botões — caminho para WCAG 2.5.5 (touch target 44×44)

### `<noscript>` fallback decente

Antes: páginas em branco para usuário com JS desativado.
Agora: tela explicativa em português pedindo para habilitar JS, com instrução de contato com admin.

---

## 10. Roadmap pós-v74 (próximos sprints)

| Sprint | Foco | Tempo estimado |
|---|---|---|
| v75 | Remover `'unsafe-inline'` do CSP → CSP com nonce (após mais extração inline) | 3 dias |
| v76 | Integração axe-core em runtime (console) + relatório a11y gerado | 1 semana |
| v77 | Adicionar `role="dialog"` + `aria-modal` nos modais existentes + aplicar `trapFocus` automaticamente | 1 semana |
| v78 | Extrair render() + state management → `/lib/psm-state.js` (último bloco gigante inline) | 1 semana |
| v79 | Dual-write Firebase + Supabase em produção; comparar saídas; ativar flag de leitura preferencial | 1 semana |
| v80 | Deprecar Firebase: substituir reads por Supabase, manter Firebase só para histórico | 3 dias |

---

## 11. Checklist de smoke test pós-deploy

- [ ] `/api/config` responde 200 com `firebase` populado
- [ ] Console do browser não mostra "CSP violation" durante navegação normal
- [ ] Firebase Sync funciona (badge "Firebase conectado" no Settings)
- [ ] Modo TV abre, cenas trocam, relógio atualiza — `PSM.timers.stats()` no console mostra `tv-scene` ativos
- [ ] Sair do Modo TV e voltar — `PSM.timers.stats()` mostra que `tv-scene` foi limpo
- [ ] Resposta da IA (Gemini) renderiza com `<strong>` e `<br>` mas sem qualquer outra tag
- [ ] Upload de arquivo com nome `test<script>alert(1)</script>.png` exibe nome escapado, sem executar script
- [ ] **v69** `/admin.html` mostra gate de senha e bloqueia com `ADMIN_SHA256` errado
- [ ] **v69** Compartilhar URL no WhatsApp gera preview com título, descrição e logo
- [ ] **v69** Tab key navega corretamente pela página, skip-link aparece ao focar
- [ ] **v69** `localStorage.setItem('psm_log_level','debug'); location.reload();` mostra logs detalhados; `'silent'` silencia tudo
- [ ] **v69** Lighthouse PWA score sobe (manifest detectado, ícones presentes, theme-color ok)
- [ ] **v70** Relógio canto inferior direito atualiza a cada segundo (psm-clock.js funcionando)
- [ ] **v70** Console mostra `[PSM·clock] psm-clock.js v70.0.0 carregado` no boot
- [ ] **v70** Console mostra `[PSM·pwa]` ao registrar SW (vindo de psm-pwa.js)
- [ ] **v70** Console **NÃO** mostra "[PSM v27.7]" mais (substituído por `[PSM·legacy:27.7]`)
- [ ] **v70** `PSM.log.setLevel('silent')` silencia toda saída
- [ ] **v70** Erros são reportados ao Sentry automaticamente via PSM.log.error()
- [ ] **v71** Modo TV mantém tela acesa por 30+ min sem standby
- [ ] **v71** Modal LGPD aparece para novo usuário; aceitar salva `psm_lgpd_consent=1`
- [ ] **v71** `PSM.lgpd.status()` retorna `{consented:true, consentedAt:<ts>}` após aceitar
- [ ] **v71** `PSM.lgpd.revogar()` (no console) revoga consentimento e recarrega
- [ ] **v71** `PSM.fbWatchdog.getFailCount()` retorna 0 quando Firebase está ok
- [ ] **v71** Forçar 3 falhas Firebase consecutivas → banner "Sincronizacao Firebase falhou" aparece
- [ ] **v72** Console mostra `[PSM·firebase] psm-firebase.js v72.0.0 carregado` no boot
- [ ] **v72** Após login, `PSM.firebase.isReady()` retorna `true` (se Firebase configurado)
- [ ] **v72** `fbGetConfig()` retorna objeto da `/api/config` em produção
- [ ] **v72** Editar uma venda → ver no Firebase Console o `shared/_lastUpdate` atualizar em ~1.5s (debounce)
- [ ] **v72** Outro device com mesma conta recebe a mudança automaticamente
- [ ] **v72** Fechar aba → flush pendente roda (verificar `[PSM-Sync] Flush no unload disparado` no console antes do unload)
- [ ] **v73** `/api/supabase-config` retorna JS válido com `window.SUPABASE_URL` e `window.SUPABASE_ANON_KEY` populados
- [ ] **v73** Console mostra `[PSM·supabase] client conectado a https://xxx.supabase.co`
- [ ] **v73** `await PSM.supabase.ready()` resolve `true`
- [ ] **v73** `await PSM.supabase.kvSet('shared_kv', 'test', {a:1})` retorna `true` (RLS aceitou)
- [ ] **v73** `await PSM.supabase.kvGet('shared_kv', 'test')` retorna `{a:1}`
- [ ] **v73** Sem login, `kvSet('user_kv', ...)` retorna `false` (RLS bloqueou)
- [ ] **v73** Schema SQL aplicado: `pg_policies` mostra 6 policies nas 3 tabelas
- [ ] **v74** Console mostra `[PSM·a11y] psm-a11y.js v74.0.0 carregado`
- [ ] **v74** Pressionar Tab mostra outline dourado nos elementos focados
- [ ] **v74** OS com "Reduce motion" ativado → animações ficam estáticas (verificar Hero TV scene)
- [ ] **v74** `PSM.a11y.announce('teste')` → screen reader anuncia "teste"
- [ ] **v74** Desativar JS no DevTools → tela noscript em português aparece
- [ ] **v74** Lighthouse Accessibility score sobe (foco visível, contrast, sr-only)

---

## 13. Reverter para v67

Backup automático em `/Users/morimatsu/Desktop/v67-TIMELINE-REAL.backup-<timestamp>/`.

Para reverter: copiar `index.html`, `sw.js`, `vercel.json`, `version.json` do backup
de volta para o diretório de deploy e remover `lib/` e `api/config.js`.
