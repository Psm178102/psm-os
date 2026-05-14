# House PSM — Sistema de Gestão Imobiliária

Sistema interno PSM Conquista (imobiliária residencial — MCMV, primeiro imóvel,
São José do Rio Preto). Inclui **Dashboard TV** (modo vitrine 24/7 para escritório)
e **CRM** para corretores.

**Versão atual:** v74.0.0 (2026-07-29)
**Plataforma:** Vercel (Serverless + Static)
**Stack:** Vanilla JS + CSS, Firebase Realtime DB, Supabase (opcional), PWA

---

## 🚀 Deploy

> **Se você é o coworker que vai subir, vá direto para [DEPLOY.md](./DEPLOY.md).**

Esse arquivo tem o passo a passo completo, do zero ao site no ar, em ordem.

---

## Estrutura do projeto

```
v67-TIMELINE-REAL/
├── README.md                  ← este arquivo
├── DEPLOY.md                  ← guia de deploy passo a passo
├── CHANGELOG.md               ← histórico v67 → v74
├── SECURITY-DEPLOY.md         ← documentação técnica detalhada de cada sprint
├── .env.example               ← template de env vars (sem valores)
├── .env.production.template   ← template com valores reais para colar no Vercel
├── .gitignore
├── package.json               ← metadados (ajuda Vercel CLI)
│
├── index.html                 ← bundle principal SPA (~2.2 MB)
├── admin.html                 ← painel admin Supabase (com gate de senha)
├── sw.js                      ← Service Worker (cache + auto-update)
├── manifest.json              ← PWA manifest
├── version.json               ← versão semântica do build
├── vercel.json                ← rewrites + headers de segurança
├── supabase-schema.sql        ← schema + RLS (opcional, para v73)
│
├── api/                       ← Serverless Functions Vercel
│   ├── config.js              ← devolve credenciais (Firebase, Google, admin hash)
│   └── supabase-config.js     ← devolve URL+anon key Supabase como JS
│
├── lib/                       ← 18 módulos JS extraídos do bundle
│   ├── psm-logger.js          ← logger central + bridge Sentry
│   ├── psm-security.js        ← escapeHTML, safeMD, anti-XSS
│   ├── psm-timers.js          ← TimerRegistry (fix memory leak TV 24/7)
│   ├── psm-config.js          ← loader async de /api/config
│   ├── psm-a11y.js            ← announce, trapFocus, bindEsc
│   ├── psm-clock.js           ← relógio global + Wake Lock
│   ├── psm-pwa.js             ← SW bootstrap + version checker
│   ├── psm-sentry-init.js     ← Sentry SDK loader
│   ├── psm-nosleep.js         ← NoSleep.js wrappado
│   ├── psm-lgpd.js            ← consentimento + exportar + deletar
│   ├── psm-fb-watchdog.js     ← banner se Firebase falhar 3x
│   ├── psm-firebase.js        ← TODA lógica Firebase Realtime DB
│   ├── psm-supabase.js        ← wrapper Supabase (signIn/kvGet/kvSet/realtime)
│   ├── psm-ia.js              ← stub IA wrapper
│   ├── psm-native.js          ← stub Capacitor bridge
│   ├── psm-offline.js         ← stub CRDT offline
│   ├── psm-backup.js          ← stub backup diário
│   └── psm-monitor.js         ← stub heartbeat 24/7
│
├── scripts/
│   ├── gen-admin-hash.sh      ← gera SHA-256 da senha admin
│   └── smoke-test.html        ← página de smoke test pós-deploy
│
└── v2/                        ← reescrita React experimental (não deployada)
    └── index.html
```

---

## O que mudou da v67 para v74 (resumo)

8 sprints de hardening + modularização incremental sem quebrar produção:

| Sprint | Foco principal |
|--------|---------------|
| v68 | Segurança: credenciais via env vars, CSP endurecido, anti-XSS |
| v69 | Logger central, SEO/OG, PWA manifest, ARIA landmarks, admin gate |
| v70 | Modularização: clock, PWA, Sentry; 136 console.error → PSM.log |
| v71 | Modularização: NoSleep, LGPD, Firebase watchdog |
| v72 | Firebase sync inteiro extraído para `/lib/psm-firebase.js` (422 linhas) |
| v73 | Supabase bridge: wrapper, endpoint, schema SQL, RLS policies prontas |
| v74 | A11y: focus-visible, prefers-reduced-motion, `<noscript>`, toolkit `psm-a11y.js` |

**Resultado:**
- 18 módulos JS em `/lib/` (~93 KB modularizado)
- 0 credenciais hardcoded
- 0 console.error legacy
- 8 headers de segurança no Vercel
- 2 backends paralelos (Firebase ativo + Supabase em standby)

Histórico completo: [CHANGELOG.md](./CHANGELOG.md)
Documentação técnica detalhada: [SECURITY-DEPLOY.md](./SECURITY-DEPLOY.md)

---

## Rodar localmente

Como é vanilla JS sem build pipeline:

```bash
# Opção 1: Python
python3 -m http.server 3000

# Opção 2: Node
npx serve -p 3000

# Opção 3: PHP
php -S localhost:3000
```

Acesse `http://localhost:3000`. Sem `/api/config` retornando dados locais, o app
roda em modo offline-only (localStorage). Para testar com Firebase localmente,
configure manualmente `localStorage.setItem('psm_firebase_config', JSON.stringify({...}))`
ou use Vercel Dev: `vercel dev`.

---

## Suporte

- **Documentação técnica:** `SECURITY-DEPLOY.md`
- **Mudanças por versão:** `CHANGELOG.md`
- **Guia de deploy:** `DEPLOY.md`
- **Backup da v67 original:** `~/Desktop/v67-TIMELINE-REAL.backup-20260513-112802/`

---

## Licença

Proprietário — uso interno PSM Conquista.
