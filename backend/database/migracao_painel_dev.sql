-- =====================================================================
--  WOODCONTROL - Migração: Painel do Desenvolvedor
--
--  Para o banco que JÁ ESTÁ rodando (não apaga nada). Pode rodar mais
--  de uma vez sem problema. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_painel_dev.sql
-- =====================================================================

BEGIN;

-- Quem administra o WoodControl em si (você). Login separado das empresas.
CREATE TABLE IF NOT EXISTS desenvolvedores (
    id           SERIAL PRIMARY KEY,
    nome         VARCHAR(100) NOT NULL,
    email        VARCHAR(150) NOT NULL UNIQUE,
    senha_hash   VARCHAR(255) NOT NULL,
    ativo        BOOLEAN   NOT NULL DEFAULT TRUE,
    ultimo_login TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_desenvolvedores_updated_at ON desenvolvedores;
CREATE TRIGGER tg_desenvolvedores_updated_at BEFORE UPDATE ON desenvolvedores
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Usuário criado com senha provisória precisa trocá-la no primeiro acesso
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE;

-- Controle interno das solicitações vindas do index.html
ALTER TABLE solicitacoes_acesso
    ADD COLUMN IF NOT EXISTS observacao_interna TEXT,
    ADD COLUMN IF NOT EXISTS atendido_por INT REFERENCES desenvolvedores(id) ON DELETE SET NULL;

COMMIT;
