# Changelog — House PSM

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

---

## [74.0.0] — 2026-07-29 — A11Y & FOCUS

### Adicionado
- `/lib/psm-a11y.js` — toolkit completo de acessibilidade
  - `announce(msg, mode)` — anuncia para screen readers (aria-live regions)
  - `trapFocus(el)` — focus trap em modais (retorna `{release()}`)
  - `restoreFocus()` — restaura foco anterior
  - `bindEsc(el, handler)` — Esc-to-close
  - `keyboardNav(items, opts)` — ArrowUp/Down + Home/End + Enter
  - `srOnly(text)`, `prefersReducedMotion()`
- CSS global `:focus-visible` com outline dourado #d4af37
- `@media (prefers-reduced-motion: reduce)` zerando todas as 29+ animations
- Classe `.psm-sr-only` para screen-reader only
- `<noscript>` fallback decente em português

---

## [73.0.0] — 2026-07-15 — SUPABASE BRIDGE

### Adicionado
- `/api/supabase-config.js` — endpoint Vercel que devolve URL+anon key como JS executável
- `/supabase-schema.sql` — schema completo com 3 tabelas + 6 RLS policies + índices + trigger opcional
- `/lib/psm-supabase.js` — wrapper funcional (saiu de stub):
  - Auth: `signIn`, `signUp`, `signOut`, `getUser`, `ready()`
  - KV: `kvGet`, `kvSet`, `kvDelete` para shared_kv/user_kv
  - Realtime: `kvSubscribe(table, key, cb)`
  - Audit: `audit(action, table, key, value)`
  - Escape hatch: `getClient()`

### Modificado
- `/api/config.js` agora também devolve `supabase: {url, anonKey}`
- `index.html` carrega supabase-js SDK do CDN antes de psm-supabase.js

### Notas
- **Estratégia BRIDGE**: Firebase continua primário. Supabase entra como destino paralelo. Flippagem real planejada para v78-v79 após validação em produção.

---

## [72.0.0] — 2026-07-01 — FIREBASE EXTRACTION

### Adicionado
- `/lib/psm-firebase.js` — 422 linhas de lógica Firebase Realtime DB extraídas do bundle
- API debug `PSM.firebase.{isReady, isSyncing, getApp, getDb}`

### Modificado
- `index.html` reduzido de 2.211.281 → 2.190.313 bytes (−20.9 KB)
- API pública preservada em `window.*`: `fbGetConfig`, `fbSaveConfig`, `fbInit`, `fbPushState`, `fbSetupConfig`
- State privado encapsulado em IIFE (11 vars Firebase agora fora do escopo global)

### Notas
- Primeira vez que o `index.html` ficou menor que a versão original v67 (−23 KB acumulado).

---

## [71.0.0] — 2026-06-17 — MORE MODULARIZATION

### Adicionado
- `/lib/psm-nosleep.js` — NoSleep.js v0.12.0 (MIT) wrappado em PSM (mantém TV acesa)
- `/lib/psm-lgpd.js` — consentimento + exportar + deletar
- `/lib/psm-fb-watchdog.js` — banner Firebase offline após 3 falhas
- Nova função `psmLgpdRevogar()` — revoga consentimento sem deletar dados (LGPD art. 8 §5)
- API `PSM.fbWatchdog.setThreshold(n)` para ajustar sensibilidade

### Modificado
- LGPD module agora aguarda `psmConfirm` estar disponível (resiliente a race condition)
- Banner Firebase com `role="alert" aria-live="polite"`

---

## [70.0.0] — 2026-06-03 — MODULARIZATION

### Adicionado
- `/lib/psm-clock.js` — relógio global + Wake Lock API
- `/lib/psm-pwa.js` — Service Worker bootstrap + version checker + banner update
- `/lib/psm-sentry-init.js` — carregamento async do Sentry SDK

### Modificado
- 136 chamadas `console.error("[PSM v27.X]",e)` migradas para `PSM.log.error("legacy:27.X","caught",e)`
- DSN Sentry hardcoded removido do source (agora vem de `PSM_SENTRY_DSN_PUBLIC` env var)
- API `psmForceUpdate()` preservada (definida em psm-pwa.js)

---

## [69.0.0] — 2026-05-20 — PERFORMANCE & A11Y

### Adicionado
- `/lib/psm-logger.js` — logger central com `debug/info/warn/error`, bridge automático Sentry, controle via `localStorage.psm_log_level`
- `/manifest.json` — PWA manifest com ícones, shortcuts (TV, CRM), theme color
- 12 meta tags SEO/OG (Twitter, OpenGraph) para preview em WhatsApp/LinkedIn
- 9 landmarks ARIA: `role="application"`, `navigation`, `banner`, `main`, `status`
- Skip-link "Pular para o conteúdo principal" para teclado/SR
- `<main>` tag substituindo `<div>` no container principal
- `aria-live="polite"` nos toasts
- Gate de senha SHA-256 no `/admin.html` (`ADMIN_SHA256` env var)
- 6 stubs para libs que estavam referenciadas mas faltando (404 → 200): psm-supabase, psm-ia, psm-native, psm-offline, psm-backup, psm-monitor

---

## [68.0.0] — 2026-05-13 — SECURITY HARDENING

### Adicionado
- `/api/config.js` — endpoint Vercel devolvendo config (Firebase, Google API, admin hash) das env vars
- `/lib/psm-security.js` — `escapeHTML`, `safeMD`, `buildEl`, `safeURL`, `stripTags`
- `/lib/psm-timers.js` — `TimerRegistry` com `register/clearGroup/clearAll` para fix de memory leak em TV 24/7
- `/lib/psm-config.js` — loader async de `/api/config`
- 5 headers de segurança extras no `vercel.json`: HSTS 2 anos, Permissions-Policy, COOP, CORP, X-DNS-Prefetch-Control

### Removido
- Credenciais Firebase hardcoded do `index.html` (linhas 2452-2459)
- Chave Google Drive/Maps hardcoded (linha 15053)
- 5 `innerHTML` com input externo sem escape (Gemini response, filenames, error messages)

### Modificado
- CSP endurecido: removido `default-src https:` permissivo, `connect-src` com hosts explícitos, `upgrade-insecure-requests`
- `fbInit()` aguarda `PSM.config.onReady` antes de inicializar

---

## [67.0.0] — 2026-04-30 — Baseline (TIMELINE REAL)

Versão original recebida. Inclui Timeline Horizontal Real (sprint v67) — feature
principal de visualização de lançamentos passados/futuros no Dashboard TV.

### Diagnóstico inicial detectou
- Bundle monolítico de 2.2 MB (30k linhas)
- Credenciais Firebase + Google API expostas no source
- 5 innerHTML com XSS potencial
- 6 libs referenciadas com 404 silencioso
- 141 `console.error` legacy
- CSP fraco com `default-src https:` permissivo
- Memory leak potencial em modo TV 24/7 (15+ timers sem cleanup)
- Sem `<noscript>`, sem ARIA landmarks, sem `:focus-visible`
- Sem PWA manifest
- Admin sem proteção de senha

---

## Arquivos de backup

- `~/Desktop/v67-TIMELINE-REAL.backup-20260513-112802/` — snapshot exato da v67 original antes de qualquer modificação.

Para rollback total: ver seção "Em caso de pane total" em [DEPLOY.md](./DEPLOY.md).
