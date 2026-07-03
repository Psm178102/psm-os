# PSM-OS — Regras de Arquitetura (pós-auditoria jul/2026)

Regras que TODO código novo deve seguir. Nasceram da auditoria completa de 02/07/2026
(v83.8–v84.1), que caçou mini-sistemas, incongruências e duplicações. Não repetir os erros.

## 1. Regra de ouro do dado
**Dado de negócio mora no Postgres (Supabase). localStorage é SÓ preferência de UI.**

- ✅ localStorage: tema, menu recolhido, sons on/off, aba ativa, pins, "dispensei o aviso", cache com TTL.
- ❌ localStorage: tarefas, cenários, chats, premissas, listas de itens, qualquer coisa que outro
  usuário/aparelho precise ver. Se é dado que "se perde ao trocar de navegador", está no lugar errado.
- Config leve/compartilhada → `shared_kv` (key/value JSONB). Dado com volume/consulta → tabela própria.
- Exceção deliberada: os 10 simuladores-calculadora (`sim-*.js`) guardam rascunho local — são sandbox pessoal.

## 2. Fonte única (nunca duplicar verdade)
| Verdade | Fonte única | Consumidores |
|---|---|---|
| Frentes/empresas (nome, cor, funis RD, ativa) | `shared_kv 'frentes_config'` via `settings/frentes.py` | front: `v2/js/frentes.js` (FRENTES) · back: `_auth_lib.frente_of()` |
| Custo fixo/variável real | Custos detalhados da Viabilidade (`viab_custos_orcado`) | viab.py, dashboard.py (exec_premissas com campo `fonte`) |
| Níveis por cargo | `ROLE_LVL` + `shared_kv 'role_lvl_overrides'` via `lvl_of()` | todos os backends + /auth/me |
| Travas de nível por rota | `ROUTE_MIN_LVL` + `shared_kv 'route_min_lvl'` via `routeMinLvl()` | main.js canSee + Central de Permissões |
| Visibilidade de menu por papel | `shared_kv 'role_perms'` (matriz) | main.js + configuracoes.js |
| Cenários Viabilidade (sim/break-even) | `shared_kv 'viab_cenarios'` (action set_cenarios) | metricas-viab.js |
| Chats de agentes IA | `shared_kv 'agent_chat::<agent>::<uid>'` via `ia/chats.py` | ia.js, sr-gerencia.js, sr-performance.js |

**Proibido**: reimplementar mapeamento funil→frente, cálculo de comissão ou constantes de
frente em página/endpoint novo. Importe da fonte.

Nota comissões: `finance/comissoes.py` (NIBO, comissões PAGAS) e `viab.py` (comissão CALCULADA
por premissa) são propositalmente coisas diferentes — pagas × projetadas. Não "unificar" cegamente.

## 3. _auth_lib.py — 57 cópias, 1 conteúdo
O Vercel exige a cópia por diretório. A CANÔNICA é `api/v3/auth/_auth_lib.py`. Mudou nela →
re-sincronizar TODAS: `for d in api/v3/*/; do cp api/v3/auth/_auth_lib.py "$d/_auth_lib.py"; done`
e conferir `md5 -q api/v3/*/_auth_lib.py | sort | uniq -c` = 1 hash só.

## 4. Gates alinhados (front ↔ back)
O `min_lvl` do endpoint deve casar com a trava da página que o consome (matriz cuida do "quem vê";
o min_lvl é a fronteira dura). Ao criar endpoint novo, confira o `ROUTE_MIN_LVL`/Central de
Permissões da tela correspondente. Auditoria pegou: oo/list (0 vs 5) e wa/send_one (7 vs 5).

## 5. Padrão de página (SPA)
- `export async function pageX(ctx, root)`; timers/listeners globais SEMPRE com
  `router.onCleanup(...)` ou `window.addEventListener('hashchange', cleanup, { once: true })`.
- Toda chamada de API passa por `api.request()` (nunca fetch direto — exceção: streams/blob documentados).
- Valores monetários: SEMPRE cheios `R$ XX.XXX,XX` (nunca "30k") — decisão do sócio, v83.5.

## 6. Sentinela de consistência
`GET /api/v3/system/consistency` roda os checks "os números batem entre as fontes?" e alimenta o
aviso de saúde do menu (lvl≥7). Criou fonte de verdade nova? Adicione um check lá — é o que impede
a próxima premissa chumbada de viver 6 meses sem ninguém ver.
