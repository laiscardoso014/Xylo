-- =====================================================================
-- MENSALIDADE DO XYLO: faturas com PIX
--
-- A CTech (painel do desenvolvedor) define o valor mensal de cada
-- empresa e gera as faturas do mês. O administrador da empresa vê,
-- imprime e paga pelo PIX (QR Code / copia e cola) na aba Financeiro.
--
-- Rode uma vez (pode rodar de novo, não apaga nada):
--   psql -U postgres -d db_woodcontrol -f database/migracao_faturas.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';

-- Plano de cada empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS mensalidade    NUMERIC(10,2) CHECK (mensalidade IS NULL OR mensalidade >= 0);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dia_vencimento SMALLINT NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 28);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cobrar_desde   DATE;  -- 1º mês cobrado (vazio = qualquer mês)

-- Quem recebe (dados da CTech): uma linha só
CREATE TABLE IF NOT EXISTS cobranca_config (
    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    chave_pix         VARCHAR(80),
    tipo_chave        VARCHAR(20),
    recebedor_nome    VARCHAR(100),          -- aparece no app do banco (até 25 letras no PIX)
    recebedor_doc     VARCHAR(14),           -- CPF/CNPJ de quem recebe (só na fatura)
    cidade            VARCHAR(60),
    email_contato     VARCHAR(150),
    whatsapp          VARCHAR(20),
    instrucoes        VARCHAR(300),
    gerar_automatico  BOOLEAN NOT NULL DEFAULT FALSE, -- gera sozinho as faturas do mês
    dia_geracao       SMALLINT NOT NULL DEFAULT 1 CHECK (dia_geracao BETWEEN 1 AND 28),
    updated_at        TIMESTAMP NOT NULL DEFAULT now()
);
INSERT INTO cobranca_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS faturas (
    id              SERIAL PRIMARY KEY,
    empresa_id      INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    numero          VARCHAR(20) NOT NULL UNIQUE,         -- ex.: 2026110003 (aparece na fatura e no PIX)
    competencia     DATE NOT NULL,                       -- 1º dia do mês cobrado
    descricao       VARCHAR(150) NOT NULL,
    valor           NUMERIC(10,2) NOT NULL CHECK (valor > 0),
    vencimento      DATE NOT NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'Aberta' CHECK (status IN ('Aberta', 'Paga', 'Cancelada')),
    pix_copia_cola  TEXT NOT NULL,                       -- código guardado: a fatura não muda se a chave mudar depois
    recebedor       JSONB NOT NULL,                      -- nome, documento, chave e cidade na data da fatura
    informado_em    TIMESTAMP,                           -- a empresa avisou "já paguei"
    informado_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
    pago_em         DATE,
    valor_pago      NUMERIC(10,2),
    obs_pagamento   VARCHAR(200),
    cancelada_motivo VARCHAR(200),
    email_enviado_em TIMESTAMP,
    gerada_por      VARCHAR(20) NOT NULL DEFAULT 'manual', -- manual | automatico
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_fatura_competencia CHECK (EXTRACT(DAY FROM competencia) = 1),
    CONSTRAINT ck_fatura_paga CHECK (status <> 'Paga' OR pago_em IS NOT NULL)
);
-- uma fatura (não cancelada) por empresa por mês
CREATE UNIQUE INDEX IF NOT EXISTS ux_fatura_mes ON faturas (empresa_id, competencia) WHERE status <> 'Cancelada';
CREATE INDEX IF NOT EXISTS ix_fatura_competencia ON faturas (competencia);
