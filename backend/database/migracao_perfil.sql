-- =====================================================================
--  XYLO - Migração: Meu perfil e Dados da empresa
--
--  O que muda:
--    - empresas: endereço, cidade, UF e LOGO (aparece no sistema e nos relatórios)
--    - usuarios: telefone e a data da última troca de senha
--
--  Para o banco que JÁ ESTÁ rodando. Não apaga nada e pode rodar mais de
--  uma vez. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_perfil.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS endereco VARCHAR(200);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cidade   VARCHAR(100);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS uf       CHAR(2);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo     TEXT;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone VARCHAR(20);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_alterada_em TIMESTAMP;

COMMIT;
