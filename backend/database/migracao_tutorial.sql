SET client_encoding = 'UTF8';
-- =====================================================================
-- TUTORIAL DO PRIMEIRO ACESSO
-- Guarda quando cada usuário terminou (ou pulou) o tour guiado, para ele
-- aparecer só uma vez, em qualquer computador. Ele pode rever pelo menu
-- do usuário (Ver tutorial). Pode rodar mais de uma vez.
--   psql -U postgres -d db_woodcontrol -f database/migracao_tutorial.sql
-- =====================================================================
-- Tabela própria (e não uma coluna em usuarios) para não gerar linha no Histórico da empresa
CREATE TABLE IF NOT EXISTS tutorial_vistos (
    usuario_id INT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    visto_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
