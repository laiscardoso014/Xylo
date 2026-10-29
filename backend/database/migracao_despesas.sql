-- =====================================================================
--  XYLO - Migração: Despesas
--
--  O que muda:
--    - categorias padrão criadas para cada empresa (Adiantamento, Pagamento
--      de empreiteiro, Pagamento de floresta, Folha, Combustível, Manutenção,
--      Outros), inclusive para as empresas que já existem
--    - despesa pode ser ligada a uma floresta (além do empreiteiro)
--    - data_pagamento: quando a despesa foi paga
--    - situação "Cancelado" (não apaga, sai dos totais e dos relatórios)
--
--  Para o banco que JÁ ESTÁ rodando. Não apaga nada e pode rodar mais de
--  uma vez. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_despesas.sql
-- =====================================================================

BEGIN;
SET LOCAL client_min_messages = warning;  -- esconde os avisos "já existe"

-- 1. Categorias padrão ------------------------------------------------
CREATE OR REPLACE FUNCTION fn_categorias_padrao() RETURNS trigger AS $$
BEGIN
    INSERT INTO categorias_despesa (empresa_id, nome) VALUES
        (NEW.id, 'Adiantamento'),
        (NEW.id, 'Pagamento de empreiteiro'),
        (NEW.id, 'Pagamento de floresta'),
        (NEW.id, 'Folha de pagamento'),
        (NEW.id, 'Combustível'),
        (NEW.id, 'Manutenção'),
        (NEW.id, 'Outros')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_empresa_categorias_padrao ON empresas;
CREATE TRIGGER tg_empresa_categorias_padrao
    AFTER INSERT ON empresas
    FOR EACH ROW EXECUTE FUNCTION fn_categorias_padrao();

INSERT INTO categorias_despesa (empresa_id, nome)
SELECT e.id, c.nome
  FROM empresas e
 CROSS JOIN (VALUES ('Adiantamento'), ('Pagamento de empreiteiro'), ('Pagamento de floresta'),
                    ('Folha de pagamento'), ('Combustível'), ('Manutenção'), ('Outros')) AS c(nome)
ON CONFLICT DO NOTHING;

-- 2. Tabela despesas ----------------------------------------------------
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS floresta_id INT REFERENCES florestas(id) ON DELETE RESTRICT;
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS data_pagamento DATE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_despesa_status') THEN
        ALTER TABLE despesas DROP CONSTRAINT IF EXISTS despesas_status_check;
        ALTER TABLE despesas ADD CONSTRAINT ck_despesa_status
            CHECK (status IN ('Pendente', 'Pago', 'Cancelado'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'despesas_forma_pagamento_check') THEN
        UPDATE despesas SET forma_pagamento = 'Outro'
         WHERE forma_pagamento IS NOT NULL
           AND forma_pagamento NOT IN ('À vista', 'Cheque', 'Boleto', 'PIX', 'Outro');
        ALTER TABLE despesas ADD CONSTRAINT despesas_forma_pagamento_check
            CHECK (forma_pagamento IN ('À vista', 'Cheque', 'Boleto', 'PIX', 'Outro'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_despesa_data     ON despesas (empresa_id, data);
CREATE INDEX IF NOT EXISTS ix_despesa_floresta ON despesas (floresta_id);

-- 3. Relatório por empreiteiro ignora despesas canceladas ----------------
CREATE OR REPLACE VIEW vw_relatorio_empreiteiro AS
    WITH producao AS (
        SELECT empresa_id, to_char(data, 'YYYY-MM') AS mes, empreiteiro_id,
               COUNT(DISTINCT viagem_id) AS qtd_viagens,
               SUM(peso_liquido) AS toneladas,
               SUM(valor_total)  AS valor_bruto
          FROM vw_viagem_empreiteiros
         GROUP BY empresa_id, mes, empreiteiro_id
    ), gastos AS (
        SELECT empresa_id, to_char(data, 'YYYY-MM') AS mes, empreiteiro_id,
               SUM(valor) AS despesas
          FROM despesas
         WHERE empreiteiro_id IS NOT NULL AND status <> 'Cancelado'
         GROUP BY empresa_id, mes, empreiteiro_id
    )
    SELECT COALESCE(p.empresa_id, g.empresa_id) AS empresa_id,
           COALESCE(p.mes, g.mes)               AS mes,
           e.id AS empreiteiro_id, e.nome AS empreiteiro,
           COALESCE(p.qtd_viagens, 0) AS qtd_viagens,
           COALESCE(p.toneladas, 0)   AS toneladas,
           COALESCE(p.valor_bruto, 0) AS valor_bruto,
           COALESCE(g.despesas, 0)    AS despesas,
           COALESCE(p.valor_bruto, 0) - COALESCE(g.despesas, 0) AS liquido
      FROM producao p
      FULL JOIN gastos g ON g.empresa_id = p.empresa_id AND g.mes = p.mes
                        AND g.empreiteiro_id = p.empreiteiro_id
      JOIN empreiteiros e ON e.id = COALESCE(p.empreiteiro_id, g.empreiteiro_id);

COMMIT;
