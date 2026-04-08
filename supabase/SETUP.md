# Setup Supabase para PSM OS

Este guia assume zero conhecimento de Supabase. Segue na ordem.
Tempo estimado: **20 minutos**.

---

## 1. Criar a conta e o projeto

1. Entra em https://supabase.com → **Start your project** → cria conta com GitHub ou email.
2. Clica em **New Project**.
3. Preenche:
   - **Name**: `psm-os`
   - **Database Password**: gera uma senha forte e **SALVA NUM GERENCIADOR DE SENHAS** (1Password, Bitwarden, etc). Você vai precisar dela pra restaurar backups no futuro.
   - **Region**: `South America (São Paulo)` — obrigatório, é o mais perto.
   - **Pricing Plan**: Free serve pra começar. Quando estabilizar o uso, sobe pra **Pro ($25/mês)** pelo **Point-in-Time Recovery** de 7 dias (é o backup "de verdade" que você pediu).
4. Clica **Create new project** e espera ~2 minutos.

---

## 2. Rodar o schema

1. No menu lateral: **SQL Editor** → **New query**.
2. Abre o arquivo `supabase/schema.sql` deste repositório (ou da pasta), **copia tudo** e cola no editor.
3. Clica **Run** (canto inferior direito, ou Ctrl+Enter).
4. Deve aparecer `Success. No rows returned`. Se der erro, manda print pro Claude.

### Verificar que rodou

No menu lateral: **Table Editor**. Você deve ver:
- `profiles`
- `user_kv`
- `shared_kv`
- `audit_log`

---

## 3. Pegar as credenciais do projeto

No menu lateral: **Project Settings** (engrenagem) → **API**.

Você vai precisar de **2 coisas**:

1. **Project URL** — algo como `https://xxxxxxxxxxxx.supabase.co`
2. **anon public key** — começa com `eyJhbGciOi...` (é uma string longa JWT)

> ⚠️ A key **anon** é pública e pode ir no HTML sem problema (a segurança é feita pelas RLS policies no banco). A key **service_role** NÃO — essa nunca vai no frontend.

Guarda essas duas informações num arquivo temporário. Quando terminar esta etapa, me passa no chat e eu configuro o index.html.

---

## 4. Ligar Realtime em shared_kv

O schema.sql já fez isso via SQL, mas confirma:

1. Menu lateral: **Database** → **Replication**.
2. Procura a publicação `supabase_realtime`.
3. Confirma que `shared_kv` aparece na lista de tabelas publicadas.
4. `user_kv` NÃO deve aparecer (de propósito — são dados privados por corretor).

---

## 5. Configurar Auth

Menu lateral: **Authentication** → **Providers**.

1. Confirma que **Email** está habilitado.
2. **Desabilita** "Confirm email" por enquanto (em **Authentication → Providers → Email → Confirm email: OFF**). Isso simplifica a migração — a gente religa depois.
3. Em **Authentication → URL Configuration**:
   - **Site URL**: `https://housepsm.com.br`
   - **Redirect URLs**: adiciona `https://housepsm.com.br/*`

---

## 6. Ligar backup point-in-time (quando subir pra Pro)

Quando estiver no plano **Pro**:

1. **Database** → **Backups**.
2. Ativa **Point in Time Recovery**.
3. A partir daí, você consegue restaurar o estado do banco em qualquer segundo dos últimos 7 dias.

No plano Free, você ainda tem backup diário automático (7 dias de retenção). É menos granular mas já é **muito melhor** do que o que temos hoje.

---

## 7. Quando terminar, me passa no chat:

```
SUPABASE_URL: https://xxxx.supabase.co
SUPABASE_ANON_KEY: eyJhbGc...
```

Com essas 2 strings eu:
1. Crio o seu usuário diretor (você) em `auth.users`
2. Crio a linha em `profiles` ligando seu user_id ao `b_paulo` legacy
3. Configuro o `index.html` pra carregar `lib/psm-supabase.js` em modo **paralelo** (escreve em Supabase E localStorage)
4. Deploy via Vercel
5. Testa: cria um lead, confirma que aparece na tabela `shared_kv` no Supabase
6. Depois de 1 semana estável em paralelo → corta localStorage e Supabase vira fonte única

---

## FAQ rápido

**"Perco meus dados atuais?"**
Não. O modo paralelo mantém tudo no localStorage enquanto copia pro Supabase. Se der merda no Supabase, a gente volta num comando.

**"E os 40+ corretores?"**
Cada um faz login com email + senha nova (Supabase Auth). Eu preparo um script `migrate-old-users.sql` que cria `auth.users` a partir do `psm_senhas` atual — mas senha tem que ser resetada via email (é mais seguro).

**"Custo?"**
Free até ~500MB de dados e 2GB de transferência/mês. PSM hoje cabe folgado. Pro ($25/mês) é quando quiser PITR sério.

**"E se o Supabase cair?"**
Modo paralelo resolve isso na fase 1: o sistema continua funcionando no localStorage. Na fase 2 (Supabase fonte única), você ainda tem os backups diários + PITR pra restaurar.
