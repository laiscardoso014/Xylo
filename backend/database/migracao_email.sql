-- =====================================================================
--  XYLO - Migração: CONFIRMAÇÃO DE E-MAIL
--
--  O que muda:
--    1) usuarios.email_confirmado_em: quando a pessoa confirmou que o e-mail
--       é dela (clicando no link). Sem confirmar, não entra no sistema.
--       Quem JÁ usava o sistema antes desta versão fica como confirmado
--       (ninguém é trancado do lado de fora).
--    2) tokens_conta: os links enviados por e-mail (convite, troca de e-mail,
--       nova senha). Guarda só o hash do link, a validade e se já foi usado.
--
--  Para o banco que JÁ ESTÁ rodando. Não apaga nada e pode rodar mais de
--  uma vez. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_email.sql
-- =====================================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'usuarios' AND column_name = 'email_confirmado_em') THEN
        ALTER TABLE usuarios ADD COLUMN email_confirmado_em TIMESTAMP;
        -- só na PRIMEIRA vez: quem já existia continua entrando normalmente
        UPDATE usuarios SET email_confirmado_em = COALESCE(ultimo_login, created_at, now());
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS tokens_conta (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('convite', 'troca_email', 'nova_senha')),
    token_hash  CHAR(64) NOT NULL UNIQUE,          -- SHA-256 do link (o link em si não fica no banco)
    email_novo  VARCHAR(150),                      -- troca de e-mail: o endereço novo
    expira_em   TIMESTAMP NOT NULL,
    usado_em    TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_token_usuario ON tokens_conta (usuario_id, tipo);

COMMIT;
