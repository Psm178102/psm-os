# Integração do Supabase no `index.html`

Este guia é o que eu (Claude) vou executar **depois** que você me passar
`SUPABASE_URL` e `SUPABASE_ANON_KEY`. Fica aqui documentado pra auditoria.

---

## Fase 1 — Modo paralelo (1 semana)

### 1.1 — Injetar config + wrapper no `<head>`

No topo do `<head>` do `index.html`, adicionar:

```html
<script>
  window.SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
  window.SUPABASE_ANON_KEY = 'eyJhbGc...';
  window.PSM_SYNC_MODE = 'parallel'; // parallel | supabase
</script>
<script src="/lib/psm-supabase.js"></script>
```

> A key anon é pública e pode ficar no HTML — a segurança vem das RLS policies.

### 1.2 — Verificar monkey-patch

O `psm-supabase.js` faz monkey-patch do `saveState()` automaticamente.
Não precisa editar nenhuma chamada de `saveState()` no código.

### 1.3 — Login paralelo

No handler atual de login (procurar por `psm_senhas`), **depois** do
login local funcionar, tentar também:

```javascript
if (window.psmAuth && window.psmAuth.isReady()) {
  window.psmAuth.signIn(email, senhaDoSupabase).then(function(r){
    if (r.error) console.warn('[login-sb]', r.error);
  });
}
```

Na fase paralela, se o login Supabase falhar, o sistema continua
funcionando no modo atual. Só não sincroniza pro banco até o usuário
logar no Supabase.

### 1.4 — Deploy Vercel

```bash
git add lib/psm-supabase.js supabase/ index.html
git commit -m "feat(supabase): modo paralelo ativado (dual-write)"
git push origin main
```

### 1.5 — Validação (checklist)

- [ ] Abrir housepsm.com.br, fazer login
- [ ] Console do navegador: `window.psmDb.isReady()` → `true`
- [ ] Console: `window.psmAuth.user()` → objeto com email
- [ ] Criar um lead de teste
- [ ] Abrir Supabase → Table Editor → `shared_kv` → confirmar linha `LEADS_POOL` com o lead novo
- [ ] Criar uma reunião 1:1 num corretor
- [ ] Supabase → `user_kv` → confirmar linha `oo_reunioes_<bid>`
- [ ] Abrir em outro navegador com outro corretor → confirmar que mudanças em `shared_kv` chegam em tempo real

### 1.6 — Monitoramento (1 semana)

- Verificar diariamente: `audit_log` não tem erros estranhos
- Verificar: número de linhas em `shared_kv` é estável (não explode)
- Confirmar com corretores: sistema **igual ou mais rápido**
- Se pintar bug: desabilitar só removendo o `<script src="/lib/psm-supabase.js">` e fazer deploy. Rollback imediato.

---

## Fase 2 — Cutover (Supabase vira fonte única)

**Só fazer depois de 1 semana estável na fase 1.**

### 2.1 — Mudar o modo

No `<head>` do `index.html`:

```html
window.PSM_SYNC_MODE = 'supabase';
```

### 2.2 — Hidratar do Supabase no boot

No início do boot do `index.html` (antes de ler `localStorage`):

```javascript
if (window.psmDb && window.psmDb.mode() === 'supabase' && window.psmAuth.user()) {
  await window.psmDb.hydrateAll().then(function(data){
    Object.keys(data).forEach(function(k){
      window.S[k] = data[k];
      try { localStorage.setItem(k, JSON.stringify(data[k])); } catch(e){}
    });
  });
}
```

### 2.3 — Remover sync Firebase antigo

Comentar o bloco `startAutoSync` do SyncManager Firebase e os listeners
`onSnapshot` dele. O realtime do Supabase já está ligado.

### 2.4 — Novo validation

- [ ] Limpar localStorage do navegador → recarregar → sistema hidrata tudo do Supabase
- [ ] Confirmar que tudo aparece igual ao que estava antes
- [ ] Criar conta nova de corretor via `auth.users` → confirmar que ele só vê os próprios `user_kv`

---

## Rollback de emergência

Se der merda depois do cutover:

1. Voltar `window.PSM_SYNC_MODE = 'parallel';`
2. Reabilitar Firebase sync
3. Deploy

Dados não se perdem porque o `localStorage` continua sendo escrito em
paralelo até o fim da fase 1, e o Supabase guarda tudo via PITR.

---

## Notas técnicas

- **Por que `user_kv` separado de `shared_kv`?**
  RLS fica trivial. Usuário só mexe no próprio `user_kv` (policy `user_id = auth.uid()`). Shared é leitura/escrita pra todos autenticados.

- **Por que debounce de 1.5s no write?**
  O `saveState()` hoje é chamado MUITO (a cada tecla em alguns lugares). Sem debounce seriam 100+ requests/min por corretor. Com debounce, fica ~10/min.

- **Por que realtime só em `shared_kv`?**
  `user_kv` são dados privados — não faz sentido broadcast. E menos tráfego de realtime.

- **Deduplicação no monkey-patch**
  Usa uma "assinatura" barata (tamanho do JSON + número de keys). Não é perfeita mas evita 90% dos re-envios desnecessários. Se virar problema, troca por hash real.
