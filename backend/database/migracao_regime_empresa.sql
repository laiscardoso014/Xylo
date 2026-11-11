SET client_encoding = 'UTF8';
-- =====================================================================
-- REGIME DA SOLICITAÇÃO -> EMPRESA -> DRE
--
-- O regime fiscal escolhido no formulário de demonstração passa a ser
-- copiado para a empresa na aprovação, e a DRE já começa com os impostos
-- típicos do regime (marcados como "sugeridos" até o Administrador salvar).
-- Este arquivo também arruma as empresas aprovadas ANTES desta mudança.
-- Pode rodar mais de uma vez sem problema.
--   psql -U postgres -d db_woodcontrol -f database/migracao_regime_empresa.sql
-- =====================================================================

-- Tudo dentro de um bloco que só roda UMA vez (quando a coluna nova ainda não existe):
-- assim, rodar de novo não desfaz o que o Administrador já ajustou.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'empresas' AND column_name = 'fiscal_sugerido') THEN
        RAISE NOTICE 'migracao_regime_empresa: já aplicada, nada a fazer.';
        RETURN;
    END IF;

    -- TRUE = os impostos da DRE ainda são a sugestão automática do regime
    ALTER TABLE empresas ADD COLUMN fiscal_sugerido BOOLEAN NOT NULL DEFAULT FALSE;

    -- 1) Empresas sem regime: puxa o da solicitação aprovada mais recente
    UPDATE empresas e
       SET regime_tributario = s.regime
      FROM (SELECT DISTINCT ON (empresa_id) empresa_id,
                   CASE regime_fiscal WHEN 'MEI' THEN 'mei' WHEN 'Simples Nacional' THEN 'simples'
                                      WHEN 'Lucro Presumido' THEN 'presumido' WHEN 'Lucro Real' THEN 'real' END AS regime
              FROM solicitacoes_acesso
             WHERE empresa_id IS NOT NULL
             ORDER BY empresa_id, created_at DESC) s
     WHERE s.empresa_id = e.id AND e.regime_tributario IS NULL AND s.regime IS NOT NULL;

    -- 2) Impostos sugeridos onde nunca foram informados (as duas alíquotas em zero).
    --    Mesmos números de backend/src/relatorios/regimes.js
    UPDATE empresas SET
           aliquota_receita = CASE regime_tributario WHEN 'simples' THEN 6 WHEN 'presumido' THEN 3.65 WHEN 'real' THEN 9.25 ELSE 0 END,
           aliquota_ir_csll = CASE regime_tributario WHEN 'presumido' THEN 2.28 WHEN 'real' THEN 24 ELSE 0 END,
           base_ir_csll     = CASE regime_tributario WHEN 'real' THEN 'lucro' ELSE 'receita' END,
           fiscal_sugerido  = TRUE
     WHERE regime_tributario IN ('mei', 'simples', 'presumido', 'real')
       AND aliquota_receita = 0 AND aliquota_ir_csll = 0;
END $$;
