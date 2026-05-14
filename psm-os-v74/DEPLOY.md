# DEPLOY — House PSM v74

> **Para quem vai fazer o deploy:** leia este arquivo do início ao fim,
> na ordem. Não pule etapas. Cada `□` é um checkbox para você marcar conforme avança.

**Tempo estimado:** 30-45 min (primeira vez), 5 min (deploys subsequentes).

---

## 📋 Pré-requisitos

- [ ] Conta no Vercel com acesso ao projeto House PSM (peça o link de convite)
- [ ] Terminal aberto na pasta do projeto (`v67-TIMELINE-REAL/`)
- [ ] Node.js instalado (`node --version` deve responder)
- [ ] Acesso ao Firebase Console do projeto `psm-os` (peça acesso ao admin)
- [ ] (Opcional) Conta Supabase para feature v73 — pode pular agora e fazer depois

---

## ETAPA 1 — Instalar Vercel CLI e linkar projeto (5 min)

```bash
# 1.1 Instalar Vercel CLI globalmente
npm i -g vercel

# 1.2 Fazer login (vai abrir o browser)
vercel login

# 1.3 Linkar a pasta local ao projeto Vercel
cd /Users/morimatsu/Desktop/v67-TIMELINE-REAL
vercel link
# Quando perguntar:
#   - "Set up project?" → Y
#   - "Which scope?" → escolha o time/conta correto
#   - "Link to existing project?" → Y (se já existe) ou N (se for criar novo)
#   - "Project name?" → house-psm (ou nome existente)
```

- [ ] Comando `vercel link` rodou sem erro e criou pasta `.vercel/`

---

## ETAPA 2 — Configurar Environment Variables no Vercel (15 min)

**Onde:** Vercel Dashboard → Seu Projeto → Settings → Environment Variables.

Cole as variáveis abaixo (valores reais estão em `.env.production.template`).
**Marcar todas as 3 ambientes** (Production, Preview, Development) ao adicionar.

### 2.1 — Firebase (OBRIGATÓRIAS — sem elas o sync entre devices para)

- [ ] `FIREBASE_API_KEY`
- [ ] `FIREBASE_AUTH_DOMAIN`
- [ ] `FIREBASE_DATABASE_URL`
- [ ] `FIREBASE_PROJECT_ID`
- [ ] `FIREBASE_STORAGE_BUCKET`
- [ ] `FIREBASE_MESSAGING_SENDER_ID`
- [ ] `FIREBASE_APP_ID`

### 2.2 — Google API (OBRIGATÓRIA — Drive + Maps)

- [ ] `GOOGLE_API_KEY`

### 2.3 — Admin gate (OBRIGATÓRIA — protege `/admin.html`)

**Gerar hash da senha:**

```bash
# Use uma senha forte (mín 12 caracteres, mistura letras/números/símbolos)
echo -n "SUA-SENHA-AQUI" | shasum -a 256 | awk '{print $1}'
```

Cole o resultado de 64 caracteres em:
- [ ] `ADMIN_SHA256`

> **Guarde a senha em local seguro** (1Password, Bitwarden). O hash é one-way — sem a senha original não há como recuperar acesso ao admin.

### 2.4 — Origens permitidas (OBRIGATÓRIA)

- [ ] `PSM_ALLOWED_ORIGINS` = `https://SEU-DOMINIO.vercel.app,https://SEU-DOMINIO-CUSTOM.com`

(separe múltiplos domínios por vírgula, sem espaço)

### 2.5 — Sentry (OPCIONAL — captura erros em produção)

- [ ] `PSM_SENTRY_DSN_PUBLIC` (deixe vazio se não tiver Sentry configurado)

### 2.6 — Supabase (OPCIONAL — feature v73 pode ser ativada depois)

- [ ] `SUPABASE_URL` (deixe vazio se não criou projeto Supabase ainda)
- [ ] `SUPABASE_ANON_KEY` (idem)

---

## ETAPA 3 — Deploy para produção (3 min)

```bash
# Do diretório do projeto
vercel --prod
```

Aguarde a build (1-3 min) e copie a URL que aparecer.

- [ ] Deploy concluiu sem erro
- [ ] URL de produção anotada: `https://__________________________________`

---

## ETAPA 4 — Smoke tests obrigatórios (5 min)

Abra a URL de produção no navegador. **Console aberto (F12) para ver mensagens.**

### 4.1 — Verificações no console (devem aparecer no boot)

- [ ] `[PSM] psm-logger.js v74.0.0 carregado`
- [ ] `[PSM-Sec] psm-security.js v74.0.0 carregado`
- [ ] `[PSM-Timers] psm-timers.js v74.0.0 carregado`
- [ ] `[PSM-Config] config remota carregada`
- [ ] `[PSM·a11y] psm-a11y.js v74.0.0 carregado`
- [ ] `[PSM-Sync] Firebase conectado: psm-os` (← se isso não aparecer, env vars Firebase estão erradas)

### 4.2 — Verificar endpoint /api/config

Abra: `https://SEU-DOMINIO.vercel.app/api/config`

Deve retornar JSON com `firebase` populado (não null):

```json
{
  "version": "73.0.0",
  "firebase": { "apiKey": "AIza...", "databaseURL": "..." },
  "googleApiKey": "AIza...",
  "adminSha256": "abc123...",
  ...
}
```

- [ ] `firebase` não é `null`
- [ ] `googleApiKey` não é `null`
- [ ] `adminSha256` não é `null`

### 4.3 — Verificar admin.html

Abra: `https://SEU-DOMINIO.vercel.app/admin.html`

- [ ] Modal de senha aparece bloqueando o conteúdo
- [ ] Digitar senha errada → mostra "Senha incorreta"
- [ ] Digitar senha correta → libera o dashboard
- [ ] Recarregar página → modal volta a aparecer (sessão limpa após reload — esperado)

### 4.4 — Verificar PWA / SW

- [ ] Console mostra `[PSM·pwa] SW registrado: ...`
- [ ] Application → Service Workers (DevTools) → SW v74 ativo
- [ ] Application → Manifest → ícones e nome carregados

### 4.5 — Verificar a11y

- [ ] Pressionar `Tab` no site → outline dourado aparece nos focos
- [ ] Skip-link "Pular para conteúdo" aparece ao focar primeiro

### 4.6 — Verificar Firebase sync (multi-device)

- [ ] Abrir o site em 2 navegadores diferentes (ou device 1 + device 2) com mesmo login
- [ ] Editar algo no device 1 (uma meta, uma venda)
- [ ] Em ~1.5s deve aparecer no device 2

---

## ETAPA 5 — Configurações pós-deploy críticas (10 min)

### 5.1 — Firebase Realtime Database Rules (CRÍTICO)

**Onde:** Firebase Console → seu projeto → Realtime Database → Rules.

**Substituir as rules atuais por:**

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

Clique em "Publish".

- [ ] Rules publicadas
- [ ] Authentication → Sign-in method → Anonymous (ou Email/Password) habilitado

### 5.2 — Google Cloud API Key restrictions (CRÍTICO)

**Onde:** Google Cloud Console → APIs & Services → Credentials.

- [ ] Encontrar a API key usada (`GOOGLE_API_KEY`)
- [ ] Em "Application restrictions" → "HTTP referrers"
- [ ] Adicionar: `https://SEU-DOMINIO.vercel.app/*` e `https://SEU-DOMINIO-CUSTOM.com/*`
- [ ] Em "API restrictions" → marcar somente: Google Drive API, Maps JavaScript API

### 5.3 — Sentry (opcional, recomendado)

Se você adicionou `PSM_SENTRY_DSN_PUBLIC` no Vercel:

- [ ] Provoque um erro de teste no app: `throw new Error('teste deploy')` no console
- [ ] Verifique no Sentry Dashboard → Issues → aparece em ~30s

---

## ETAPA 6 (OPCIONAL) — Ativar Supabase (v73)

Pode pular agora e fazer depois. O sistema funciona normal sem Supabase.

### 6.1 — Criar projeto Supabase

- [ ] Criar conta em https://supabase.com
- [ ] New Project → escolha região (preferir `us-east-1`)
- [ ] Anotar URL e anon key (Project Settings → API)

### 6.2 — Rodar schema SQL

- [ ] Abrir SQL Editor → New query
- [ ] Colar conteúdo de `supabase-schema.sql` (na raiz deste projeto)
- [ ] Clicar em "Run"
- [ ] Verificar: Database → Tables → ver `shared_kv`, `user_kv`, `audit_log` com cadeado (RLS ativo)

### 6.3 — Habilitar Auth

- [ ] Authentication → Providers → ativar "Email"

### 6.4 — Configurar env vars no Vercel

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
- [ ] Redeploy: `vercel --prod`

### 6.5 — Smoke test Supabase

No console do site:

```js
await PSM.supabase.ready()  // deve retornar true
await PSM.supabase.kvSet('shared_kv', 'teste_v73', { ok: 1 })  // true
await PSM.supabase.kvGet('shared_kv', 'teste_v73')  // { ok: 1 }
```

- [ ] Os 3 comandos funcionam sem erro

---

## 🚨 Troubleshooting

### "Firebase não configurado" no console

→ Env vars `FIREBASE_*` não estão setadas no Vercel ou não foram aplicadas.
**Solução:** verificar Settings → Environment Variables, garantir que **todas as 3 ambientes** (Prod/Preview/Dev) estão marcadas, e fazer `vercel --prod` de novo.

### Banner "Sincronizacao Firebase falhou"

→ `FIREBASE_DATABASE_URL` correto mas Rules bloqueando.
**Solução:** revisar Etapa 5.1, garantir que Anonymous Auth está habilitada.

### `/admin.html` mostra "ADMIN_SHA256 nao configurada"

→ Variável `ADMIN_SHA256` vazia ou ausente.
**Solução:** Etapa 2.3, gerar o hash de novo e colar.

### Console mostra "[PSM] /api/config falhou"

→ Function `/api/config.js` quebrou no Vercel.
**Solução:** Vercel Dashboard → Deployments → último deploy → Functions → ver logs de erro.

### Site continua mostrando versão antiga (v67) após deploy

→ Service Worker cacheado.
**Solução 1:** Aguardar até 5 min (SW faz auto-update).
**Solução 2:** Console do usuário: `psmForceUpdate()` força reload limpando cache.

---

## 🔁 Re-deploy (mudanças futuras)

```bash
cd /Users/morimatsu/Desktop/v67-TIMELINE-REAL
vercel --prod
```

Não precisa refazer env vars nem Firebase Rules nem Supabase schema. Só o deploy.

---

## 📞 Em caso de pane total

**Rollback rápido para v67:**

```bash
# Cópia do backup intacto da v67 original
cp -r /Users/morimatsu/Desktop/v67-TIMELINE-REAL.backup-20260513-112802/* \
      /Users/morimatsu/Desktop/v67-TIMELINE-REAL/
cd /Users/morimatsu/Desktop/v67-TIMELINE-REAL
vercel --prod
```

Isso devolve o sistema ao estado original antes das modificações v68-v74.

---

✅ **Deploy concluído!** Avise quem está liderando o projeto.
