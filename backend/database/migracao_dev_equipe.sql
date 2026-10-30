-- =====================================================================
-- PAINEL DO DESENVOLVEDOR: equipe, histórico e lixeira
--
--   dev_historico  tudo o que a equipe CTech faz no painel (quem, o quê, quando)
--   dev_lixeira    solicitações de acesso excluídas (dá para restaurar)
--
-- Rode uma vez (pode rodar de novo, não apaga nada):
--   psql -U postgres -d db_woodcontrol -f database/migracao_dev_equipe.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS dev_historico (
    id          SERIAL PRIMARY KEY,
    dev_id      INT REFERENCES desenvolvedores(id) ON DELETE SET NULL,
    dev_nome    VARCHAR(100),                 -- guardado: o nome continua se o membro sair
    acao        VARCHAR(200) NOT NULL,        -- texto para ler ("Bloqueou a empresa ...")
    area        VARCHAR(30) NOT NULL,         -- acesso, solicitacoes, empresas, cobranca, equipe, lixeira
    detalhe     JSONB,
    ip          VARCHAR(60),
    data_hora   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dev_historico_data ON dev_historico (data_hora DESC);

CREATE TABLE IF NOT EXISTS dev_lixeira (
    id           SERIAL PRIMARY KEY,
    tipo         VARCHAR(30) NOT NULL,        -- solicitacao
    resumo       VARCHAR(200) NOT NULL,       -- "Transportes Silva (CNPJ ...)"
    dados        JSONB NOT NULL,              -- o registro como estava
    motivo       VARCHAR(200),
    excluido_por INT REFERENCES desenvolvedores(id) ON DELETE SET NULL,
    excluido_em  TIMESTAMP NOT NULL DEFAULT now()
);
