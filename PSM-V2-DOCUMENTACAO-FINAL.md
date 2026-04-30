# 🏁 PSM /v2 — Documentação Final v64

**Status:** Reescrita + 8 evoluções concluídas
**Versão:** v64 (29/04/2026)
**URL produção:** https://www.housepsm.com.br/v2/
**Linhas de código:** 6.616
**Tamanho:** 359 KB minificável

---

## 📦 Pacote final pra subir

[v64-FINAL-FIM.zip](computer:///Users/morimatsu/Library/Application%20Support/Claude/local-agent-mode-sessions/785f69f3-e8d8-40c4-9324-6454a44f3bb8/9cc6d2c2-7337-4d58-830f-0f0c15361b98/local_e9fa1334-4962-46ed-a8f1-ff1f6fa5f185/outputs/v64-FINAL-FIM.zip)

Conteúdo: index.html (monolito v64), sw.js, version.json, admin.html, vercel.json, v2/{index.html, manifest.json, sw.js}

---

## 🧩 Módulos /v2 (54 ao todo)

### 📊 Dashboards & Análise
- Dashboard Hoje (auto-refresh 60s)
- KPIs (com comparativo MoM + chart + export)
- Forecast 6m (line chart)
- DRE (com colunas mês atual vs anterior + chart)
- Ranking (top 3 medalhas + chart horizontal)
- Arena TV (modo display escritório)
- **AI Insights** (resumo IA por tópico)

### 💼 Comercial
- Olho-no-Olho (registro diário)
- CRM (Kanban drag-drop + saved filters + chart funil + comments + files + tags)
- Lançar Venda
- Sync RD CRM
- Captação (workflow + tags + comments + files)
- Tabela Imóveis (catálogo + tags + files)
- Fichas/Propostas (gera DOCX com WhatsApp + email)
- Mapa Lançamentos
- Oportunidades

### 💰 Financeiro
- Comissões (com chart Pendente/Pago)
- Fluxo de Caixa (chart entradas vs saídas/dia)
- Repasses
- Custos Fixos & Variáveis (chart por categoria)

### 👥 Pessoas
- Equipe (sócio desativa)
- Metas (mensal por corretor)
- Premiações (chart por vigência)
- Plantões (calendário + chart distribuição)
- Tarefas (lista pessoal)
- Check-in (jornada + cálculo horas)
- Gestão de Pessoas (talentos + 1:1)
- Locações (contratos com WhatsApp)
- Organograma
- Formação (cursos + progresso pessoal)
- Manual interno
- Ética (com aceite registrado)

### 📣 Marketing & IA
- Agente IA (Sol, Vera, Sr Inteligência)
- Meta Ads (chart top 10 campanhas)
- Criativos (links com tags)
- Cronograma Conquista
- Cronograma PSM
- Radar Concorrência (com IA Sr Performance)
- PSM Live (feed agregado)

### 🧮 Simuladores
- VPL (TIR + payback)
- INCC vs IGP-M
- Leads (funil completo)
- Repasse (SAC banco)
- Energia Solar (payback)
- Criativo (hook/hold rate)
- Métricas Viab ADS (ROAS/ROI/CAC)

### 🔧 Sistema
- Recados Diretoria
- Canal Anônimo
- Notificações (histórico)
- Configurações (perfil + tema + notif)
- Migração v1→v2
- Governance (audit log)
- Integração RD CRM (OAuth)
- **Backup & Restore** (export/import JSON)

---

## 🎯 Features transversais

| | |
|---|---|
| 🔐 Auth real | Email + senha + reset Supabase |
| 🔒 RLS apertado | Cada user só vê próprio user_kv |
| 🔄 Realtime | 21 chaves auto-atualizam entre devices |
| 📱 Mobile | Drawer, hamburger, tabelas com scroll |
| 🌗 Tema | Dark + Light (persiste) |
| 🔍 Search | ⌘K global + `/` por tabela + saved filters |
| 📊 Charts | 12 visualizações (Chart.js) |
| 📄 Export | PDF + Excel em KPIs |
| 💬 WhatsApp | Deeplinks em 4 módulos |
| 📧 Email | Mailto: em Fichas |
| 🔔 Notif | Toast in-app + browser push |
| 🌐 Offline | Service worker /v2 com cache |
| ✨ Animações | Fade, slide, hover, drag |
| 🎯 Drag-drop | CRM Kanban arrastar entre colunas |
| ☑️ Bulk | Selecionar múltiplos em CRM/Captação |
| 📅 Calendário | Full month em AgendaPSM |
| 📊 MoM | Comparativo Mês/Mês em KPIs e DRE |
| 💬 Comments | Notas em deals/captações |
| 📎 Files | Upload Supabase Storage |
| 🏷️ Tags | Sistema universal |
| 🧠 AI Insights | Resumo IA do estado da empresa |
| 💾 Backup | Export/import JSON completo |

---

## 📋 Roteiro de deploy final

### 1. Subir GitHub (5 min)
- Substituir todos os arquivos do repo pelo conteúdo do `v64-FINAL-FIM.zip`
- Commit: `v64 FINAL — reescrita + 8 evoluções`

### 2. Configurar Supabase (15 min)
Em ordem, rodar no SQL Editor:
1. [SPRINT-S1-SIGNUP-USERS.sql](computer:///Users/morimatsu/Library/Application%20Support/Claude/local-agent-mode-sessions/785f69f3-e8d8-40c4-9324-6454a44f3bb8/9cc6d2c2-7337-4d58-830f-0f0c15361b98/local_e9fa1334-4962-46ed-a8f1-ff1f6fa5f185/outputs/SPRINT-S1-SIGNUP-USERS.sql) (cria 14 profiles)
2. [SPRINT-S1-AUTH-REAL.sql](computer:///Users/morimatsu/Library/Application%20Support/Claude/local-agent-mode-sessions/785f69f3-e8d8-40c4-9324-6454a44f3bb8/9cc6d2c2-7337-4d58-830f-0f0c15361b98/local_e9fa1334-4962-46ed-a8f1-ff1f6fa5f185/outputs/SPRINT-S1-AUTH-REAL.sql) (RLS por user)
3. [SPRINT-S7-SECURITY.sql](computer:///Users/morimatsu/Library/Application%20Support/Claude/local-agent-mode-sessions/785f69f3-e8d8-40c4-9324-6454a44f3bb8/9cc6d2c2-7337-4d58-830f-0f0c15361b98/local_e9fa1334-4962-46ed-a8f1-ff1f6fa5f185/outputs/SPRINT-S7-SECURITY.sql) (audit triggers refinados)
4. [SPRINT-V63-STORAGE.sql](computer:///Users/morimatsu/Library/Application%20Support/Claude/local-agent-mode-sessions/785f69f3-e8d8-40c4-9324-6454a44f3bb8/9cc6d2c2-7337-4d58-830f-0f0c15361b98/local_e9fa1334-4962-46ed-a8f1-ff1f6fa5f185/outputs/SPRINT-V63-STORAGE.sql) (bucket pra uploads)

Antes do passo 2: criar 14 emails no Supabase Dashboard → Authentication → Add user. Senha: `psm2026!`.

### 3. Comunicar à equipe
> Sistema novo no ar: **housepsm.com.br/v2/**
> Login: seu email @imobiliariapsm.com.br + `psm2026!` (troque na primeira)
> Migração de dados: aba "Migração v1→v2" no menu
> Sistema antigo (housepsm.com.br/) continua acessível por mais 1 semana

### 4. Validar (você + Marcus, 30 min)
- Login com email/senha funciona
- Migração importa dados antigos
- RD Sync puxa deals
- Notificação push funciona
- Mobile abre bem
- ⌘K abre search
- Drag-drop funciona

---

## ⚠️ Limitações conhecidas

- Auto-sync RD CRM: opcional (toggle) — recomendado ligar
- Browser notif precisa permission request manual
- Export PDF: simples (sem fonts customizadas)
- Backup restore: faz upsert, não delete (não apaga chaves removidas)
- AI Insights: depende de /api/agent estar configurado (Gemini key)
- Files: bucket público — qualquer um com URL acessa o arquivo

---

## 🚀 Possíveis evoluções futuras (quando quiser)

- Mobile native via Capacitor (já tem PWA, próximo passo seria envolver em Capacitor pra publicar nas lojas)
- Webhooks: Zapier/n8n notificando WhatsApp ao fechar venda
- Custom dashboards drag-drop (cada user monta o próprio)
- Export PDF com letterhead PSM
- Geocoding de endereços + mapa real (Google Maps API key)
- Email digest diário/semanal (via cron + SendGrid)

---

**A reescrita acabou aqui de verdade.** O resto é uso e manutenção.

