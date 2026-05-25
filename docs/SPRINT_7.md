# Sprint 7 — Migração Python real

## Stack
- **Backend**: Vercel Serverless Python (BaseHTTPRequestHandler) em `/api/v3/`
- **Auth**: bcrypt (12 rounds) + JWT (HS256, TTL 12h)
- **Frontend**: Vanilla JS ES modules em `/v2/`
- **Estilo**: CSS tokens + utilities (sem framework JS)
- **DB**: Postgres Supabase (já existente, com schema v3 ampliado)
- **Convivência**: `/v1` (index.html) continua em paralelo enquanto `/v2/` cresce

## Pré-requisitos no Vercel (env vars)

```
SUPABASE_URL              = https://fdlnvpmlertjdgfkduzc.supabase.co
SUPABASE_SERVICE_KEY      = <service role key>
JWT_SECRET                = <openssl rand -hex 32>     # OBRIGATÓRIO ≥ 32 chars
JWT_ISSUER                = psm-os                     # opcional
JWT_TTL_HOURS             = 12                         # opcional
```

## Pré-requisito no Postgres

Rodar **`docs/v3_auth_schema.sql`** uma vez. Adiciona:
- `users.password_hash`, `users.last_login_at`, `users.last_login_ip`, `users.password_set_at`
- Tabela `password_reset_tokens` (futuro)
- Tabela `user_sessions` (revogação opcional)
- View `users_public` (sem hash)

## Endpoints novos

| Endpoint                              | Método | Auth         | Função                                         |
|--------------------------------------|--------|--------------|------------------------------------------------|
| `/api/v3/health`                     | GET    | —            | Status backend + envs + Postgres + contadores  |
| `/api/v3/auth/login`                 | POST   | —            | email+senha → JWT                              |
| `/api/v3/auth/me`                    | GET    | Bearer       | user logado (revalida sessão)                  |
| `/api/v3/auth/set_password`          | POST   | Bearer / —   | Bootstrap (sem auth) ou troca (Sócio/próprio)  |

## Frontend `/v2/`

```
/v2/
├── index.html         (shell)
├── login.html
├── css/
│   ├── tokens.css     (design tokens)
│   └── app.css        (componentes)
├── js/
│   ├── main.js        (bootstrap + router setup)
│   ├── router.js      (hash router)
│   ├── api.js         (fetch + JWT)
│   └── auth.js        (login/logout/hydrate)
└── pages/             (a popular nas próximas sprints)
```

## Roadmap interno

- [x] **7.0** — Backend auth + schema SQL
- [x] **7.1** — Shell frontend (login + dashboard + usuarios + conta)
- [ ] **7.2** — Migrar **Configurações > Usuários** completa (CRUD + roles + frente + bloqueio) e remover do `/v1`
- [ ] **7.3** — Migrar **Painel do Corretor** + **Dashboard**
- [ ] **7.4** — Migrar **CRM** + **Financeiro tempo real**
- [ ] **7.5** — Cutover: redirecionar `/` para `/v2/` por default; `/v1` vira fallback readonly

## Primeira definição de senha do Paulo

Após push + deploy + schema rodado:

1. Acessar `https://<dominio>/v2/login.html`
2. Clicar em "definir senha inicial"
3. Preencher email + nova senha
4. Voltar e logar

Internamente: `POST /api/v3/auth/set_password` em modo bootstrap (sem JWT). Funciona porque `users.password_hash` está NULL.
