-- v88.35 — 📜 Histórico Notion (Diretoria)
-- Arquivo da gestão antiga da PSM no Notion (workspace PSM IMÓVEIS, teamspaces PSM VENDAS e
-- PSM LOCAÇÃO): páginas em Markdown, bancos de dados e os datasets normalizados de vendas e
-- metas usados nos comparativos. Os dados de cliente NÃO vão para o repositório (é público):
-- entram por upload na própria tela (só sócio) e ficam só aqui.
-- Sem policies: com RLS ligado e nenhuma policy, anon/authenticated não leem nada;
-- só o backend (service role em /api/v3/diretoria/historico, min_lvl 10) acessa.
CREATE TABLE IF NOT EXISTS public.hist_notion (
  id           TEXT PRIMARY KEY,          -- notion_id da página/banco, ou 'dataset:<nome>'
  kind         TEXT NOT NULL CHECK (kind IN ('pagina', 'banco', 'dataset')),
  titulo       TEXT,
  caminho      TEXT,                      -- hierarquia original: "PSM VENDAS/GESTÃO 2026/VGV 2025"
  teamspace    TEXT,
  banco        TEXT,                      -- página que é registro de banco: nome do banco
  criado       TIMESTAMPTZ,
  editado      TIMESTAMPTZ,
  autor        TEXT,
  conteudo     TEXT,                      -- Markdown (páginas)
  dados        JSONB,                     -- colunas + linhas (bancos) ou dataset normalizado
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hist_notion_kind ON public.hist_notion (kind);
ALTER TABLE public.hist_notion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hist_notion FROM anon, authenticated;
