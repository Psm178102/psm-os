# PSM-OS v2 — Migração para Python + Postgres

Plano vivo. Atualizado conforme cada sprint avança.

## Por que estamos fazendo isso

O `index.html` monolítico (65k linhas, 2.5 MB) mistura **código** e **dados** num único arquivo. Toda vez que um deploy sobrescreve esse arquivo, mudanças feitas em runtime (promover corretor a gerente, adicionar venda, ajustar premissa) são **destruídas silenciosamente**.

**Solução:** separar:

```
   FRONTEND (apresentação)     ←→     BACKEND (regras)     ←→     POSTGRES (dados)
   index.html + js/                   /api/v2/*.py                  Supabase
   só renderiza                       FastAPI / stdlib               source of truth
```

## Status por sprint

| # | Sprint | O que entrega | Status |
|---|--------|---------------|--------|
| 0 | Fundação | `/api/v2/health` + `/api/v2/users` esqueleto | ⏳ em andamento |
| 1 | Estancar Kaue | Schema + seed users/teams + frontend lê do Postgres | pendente |
| 2 | Vendas | sales + opportunities + dashboard lê do banco | pendente |
| 3 | Financeiro | PSM_BP + NIBO cache no banco | pendente |
| 4 | Marketing | Meta Ads config + alertas | pendente |
| 5 | Modularização | Quebra index.html em /js/pages/*.js | pendente |
| 6 | Limpeza | Remove código morto + docs finais | pendente |

## Setup (uma vez por máquina/projeto)

### 1. Env vars no Vercel
Adicione em `Project Settings → Environment Variables`:

| Nome | Onde pegar | Por quê |
|------|------------|---------|
| `SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL | Já existe? Reusa o mesmo de `PSM_SUPABASE_URL` |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Settings → API → `service_role` key | **NOVA** — bypassa RLS, server-side only |
| `SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API → `anon` key | Opcional |

⚠️ **NUNCA exponha SUPABASE_SERVICE_KEY no frontend**. Ela só vive nas env vars do Vercel e é usada pelos `.py` em `/api/v2/`.

### 2. Schema no Supabase
1. Abra https://supabase.com/dashboard
2. SQL Editor → New query
3. Cole o conteúdo de `/docs/v2_schema.sql`
4. Run

### 3. Deploy
Vercel detecta automaticamente arquivos `.py` em `/api/` e instala `requirements.txt`. Não precisa de `vercel.json`.

## Como validar Sprint 0

Depois do deploy:

```bash
# 1. Healthcheck — funciona SEM Supabase configurado (zero deps)
curl https://psm-os.vercel.app/api/v2/health
# esperado: { "ok": true, "service": "PSM-OS Python Backend", ... }

# 2. Verifica se env vars estão configuradas
curl -s https://psm-os.vercel.app/api/v2/health | jq '.env'
# esperado: env.required.all_required_ok == true após você adicionar as keys no Vercel

# 3. Lista users (precisa schema rodado + envs OK)
curl https://psm-os.vercel.app/api/v2/users
# esperado: { "ok": true, "count": 3, "users": [paulo, isa, mariane] }
```

## Princípios da migração

1. **Strangler fig** — o velho continua vivo enquanto o novo cresce ao lado
2. **Nada destrutivo** — toda mudança v2 é em `/api/v2/*` (versionado), nunca toca `/api/*.js` antigo
3. **Source of truth fica no banco** — código só lê/escreve, nunca tem dados hardcoded
4. **Frontend só renderiza** — toda lógica de negócio sobe pro backend
5. **Cada sprint é deployável sozinho** — nunca precisamos esperar tudo terminar pra ter benefício

## Conventions

- **URL versioning**: `/api/v2/*` (frontend escolhe se usa v1 ou v2 durante migração)
- **Resposta padrão**: `{ ok: boolean, ...payload, error?: string }`
- **Erros**: status code HTTP correto + `{ok:false, error: 'mensagem'}`
- **IDs**: TEXT (strings curtas como 'paulo', 'kbordini') — não UUID — pra manter compat com frontend atual
- **Timestamps**: sempre `TIMESTAMPTZ DEFAULT NOW()` + trigger de updated_at

## Próximos passos imediatos (Sprint 0 → Sprint 1)

1. ✅ Subir os 5 arquivos novos pro GitHub (instruções no fim deste doc)
2. ✅ Adicionar `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` no Vercel
3. ✅ Rodar `v2_schema.sql` no Supabase SQL Editor
4. ✅ Validar `curl /api/v2/health` retorna 200
5. ✅ Validar `curl /api/v2/users` retorna os 3 seeds (paulo, isa, mariane)
6. ➡️  Sprint 1: seed completo com TODOS os usuários atuais + Kaue como gerente

## Arquivos novos desta sprint

```
api/
  requirements.txt          ← deps Python (supabase, pydantic)
  v2/
    health.py               ← GET /api/v2/health
    users.py                ← GET/POST /api/v2/users
docs/
  V2_MIGRATION.md           ← este arquivo
  v2_schema.sql             ← schema users + teams
```

⚠️ **NENHUM arquivo existente foi modificado nesta sprint.** Frontend continua igual.
