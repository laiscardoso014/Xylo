-- =====================================================================
--  XYLO - Migração: Fretes
--
--  O que muda na tabela "fretes":
--    - valor_fechado: frete cobrado por valor fechado (sem R$/tonelada),
--      como algumas cargas da planilha (ex.: R$ 8.635,00)
--    - valor_tonelada passa a ser opcional (um dos dois é obrigatório)
--    - valor_total = valor fechado, ou toneladas x valor da tonelada
--    - data_pagamento: quando o frete foi recebido
--    - situação "Cancelado" (o frete não é apagado, sai dos totais)
--
--  Para o banco que JÁ ESTÁ rodando. Não apaga nada e pode rodar mais de
--  uma vez. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_fretes.sql
-- =====================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'fretes' AND column_name = 'valor_fechado') THEN

        -- coluna calculada precisa ser recriada para mudar a fórmula
        ALTER TABLE fretes DROP COLUMN valor_total;

        ALTER TABLE fretes
            ALTER COLUMN valor_tonelada DROP NOT NULL,
            ALTER COLUMN valor_tonelada DROP DEFAULT,
            ADD COLUMN valor_fechado NUMERIC(12, 2) CHECK (valor_fechado >= 0),
            ADD COLUMN data_pagamento DATE;

        ALTER TABLE fretes
            ADD COLUMN valor_total NUMERIC(12, 2) GENERATED ALWAYS AS
                (COALESCE(valor_fechado, toneladas * COALESCE(valor_tonelada, 0))) STORED;

        ALTER TABLE fretes DROP CONSTRAINT IF EXISTS fretes_status_pagamento_check;
        ALTER TABLE fretes
            ADD CONSTRAINT ck_frete_status CHECK (status_pagamento IN ('Pendente', 'Pago', 'Cancelado')),
            ADD CONSTRAINT ck_frete_valor  CHECK (valor_fechado IS NOT NULL OR valor_tonelada IS NOT NULL),
            ADD CONSTRAINT ck_frete_valor_ton CHECK (valor_tonelada IS NULL OR valor_tonelada >= 0);

        CREATE INDEX IF NOT EXISTS ix_frete_data ON fretes (empresa_id, data);
    END IF;
END $$;

COMMIT;
