-- =====================================================================
--  XYLO - Migração: FOLHA DE PAGAMENTO
--
--  O que muda:
--    1) FUNCIONÁRIOS: alimentação padrão, telefone, observações e o vínculo
--       com o MOTORISTA das viagens/fretes (para calcular a comissão).
--    2) FAIXAS DE COMISSÃO (cada motorista tem a sua):
--       ex.: até 50 km R$ 1,20/t; até 100 km R$ 1,50/t; acima R$ 2,00/t.
--    3) ROTAS: distância (km) de cada floresta -> cliente (viagens) e de
--       cada cliente/destino (fretes). Uma carga pode ter o km corrigido só
--       nela (viagens.km / fretes.km).
--    4) FRETES ganham o motorista (a comissão também conta os fretes).
--    5) ADIANTAMENTOS parcelados: cada parcela é descontada na folha da
--       competência dela (ex.: R$ 3.805 em 5x de R$ 761).
--    6) FOLHA: situação (Aberta -> Fechada -> Paga), detalhe da comissão
--       (as cargas usadas) e a despesa gerada no pagamento.
--
--  Para o banco que JÁ ESTÁ rodando. Não apaga nada e pode rodar mais de
--  uma vez. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_folha.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL client_min_messages = warning;

-- 1) Funcionários --------------------------------------------------------
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS alimentacao  NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS telefone     VARCHAR(20);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS observacoes  TEXT;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS motorista_id INT REFERENCES motoristas(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_funcionario_motorista ON funcionarios (motorista_id) WHERE motorista_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_funcionario_empresa ON funcionarios (empresa_id);

-- 2) Faixas de comissão (por funcionário) -------------------------------
CREATE TABLE IF NOT EXISTS comissao_faixas (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    funcionario_id INT NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    km_ate         NUMERIC(7, 1) CHECK (km_ate > 0),          -- vazio = "acima" (última faixa)
    valor_tonelada NUMERIC(10, 2) NOT NULL CHECK (valor_tonelada >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_faixa_km      ON comissao_faixas (funcionario_id, km_ate) WHERE km_ate IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_faixa_acima   ON comissao_faixas (funcionario_id) WHERE km_ate IS NULL;

-- 3) Rotas e distâncias --------------------------------------------------
CREATE TABLE IF NOT EXISTS rotas (
    id            SERIAL PRIMARY KEY,
    empresa_id    INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('viagem', 'frete')),
    floresta_id   INT REFERENCES florestas(id) ON DELETE CASCADE,  -- viagem: de onde sai
    cliente_id    INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    destino       VARCHAR(100),                                     -- frete: para onde vai
    destino_chave VARCHAR(100) GENERATED ALWAYS AS (upper(btrim(coalesce(destino, '')))) STORED,
    km            NUMERIC(7, 1) NOT NULL CHECK (km > 0),
    observacao    TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_rota_viagem CHECK (tipo <> 'viagem' OR floresta_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_rota_viagem ON rotas (empresa_id, floresta_id, cliente_id) WHERE tipo = 'viagem';
CREATE UNIQUE INDEX IF NOT EXISTS uk_rota_frete  ON rotas (empresa_id, cliente_id, destino_chave) WHERE tipo = 'frete';

ALTER TABLE viagens ADD COLUMN IF NOT EXISTS km NUMERIC(7, 1) CHECK (km > 0);   -- corrige a rota só nesta carga
ALTER TABLE fretes  ADD COLUMN IF NOT EXISTS km NUMERIC(7, 1) CHECK (km > 0);
ALTER TABLE fretes  ADD COLUMN IF NOT EXISTS motorista_id INT REFERENCES motoristas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_viagem_motorista ON viagens (motorista_id);
CREATE INDEX IF NOT EXISTS ix_frete_motorista  ON fretes (motorista_id);

-- 4) Adiantamentos parcelados --------------------------------------------
CREATE TABLE IF NOT EXISTS adiantamentos (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    funcionario_id INT NOT NULL REFERENCES funcionarios(id) ON DELETE RESTRICT,
    data           DATE NOT NULL,                                  -- quando o dinheiro saiu
    valor          NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    parcelas       INT NOT NULL DEFAULT 1 CHECK (parcelas BETWEEN 1 AND 36),
    descricao      VARCHAR(200),
    despesa_id     INT REFERENCES despesas(id) ON DELETE SET NULL, -- saída de caixa (categoria Adiantamento)
    criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adiantamento_parcelas (
    id              SERIAL PRIMARY KEY,
    adiantamento_id INT NOT NULL REFERENCES adiantamentos(id) ON DELETE CASCADE,
    numero          INT NOT NULL,
    competencia     CHAR(7) NOT NULL CHECK (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
    valor           NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    CONSTRAINT uk_parcela UNIQUE (adiantamento_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_parcela_competencia ON adiantamento_parcelas (competencia);

-- 5) Folha ---------------------------------------------------------------
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS cargo            VARCHAR(100);   -- como era no mês
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS status           VARCHAR(10) NOT NULL DEFAULT 'Aberta';
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS comissao_manual  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS comissao_detalhe JSONB;          -- cargas usadas (guardado ao fechar)
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS data_pagamento   DATE;
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS despesa_id       INT REFERENCES despesas(id) ON DELETE SET NULL;
ALTER TABLE folhas DROP CONSTRAINT IF EXISTS ck_folha_status;
ALTER TABLE folhas ADD CONSTRAINT ck_folha_status CHECK (status IN ('Aberta', 'Fechada', 'Paga'));
CREATE INDEX IF NOT EXISTS ix_folha_competencia ON folhas (empresa_id, competencia);

-- 6) updated_at e histórico (auditoria) nas tabelas novas ------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['rotas', 'adiantamentos'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_updated_at ON %I', t, t);
        EXECUTE format('CREATE TRIGGER tg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t, t);
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_auditar') THEN
        FOREACH t IN ARRAY ARRAY['funcionarios', 'folhas', 'adiantamentos', 'rotas', 'comissao_faixas'] LOOP
            EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_auditoria ON %I', t, t);
            EXECUTE format('CREATE TRIGGER tg_%s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                            FOR EACH ROW EXECUTE FUNCTION fn_auditar()', t, t);
        END LOOP;
    END IF;
END $$;

COMMIT;
