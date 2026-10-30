-- =====================================================================
-- LIMPAR OS DADOS (deixar o Xylo zerado para começar a usar de verdade)
--
-- APAGA: viagens, fretes, recebimentos, despesas, clientes, florestas,
--   empreiteiros, rotas, funcionários, motoristas, folhas, adiantamentos,
--   faturas da mensalidade, histórico (auditoria) e lixeira.
-- MANTÉM: as empresas (com os dados fiscais e o logo), os usuários e as
--   senhas, o login do desenvolvedor, os dados de cobrança (chave PIX),
--   as categorias de despesa e as classes de madeira.
-- Os números (nº de viagem, de carga, de fatura...) recomeçam do 1.
--
-- NÃO TEM VOLTA. Faça o backup antes (veja o passo a passo na conversa).
--   psql -U postgres -d db_woodcontrol -f database/limpar_dados.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';

DO $$
DECLARE
    tabelas TEXT;
BEGIN
    -- só as que existem neste banco (depende das migrações rodadas)
    SELECT string_agg(quote_ident(t), ', ') INTO tabelas
      FROM unnest(ARRAY[
          'viagem_empreiteiros', 'viagens', 'fretes', 'recebimentos',
          'adiantamento_parcelas', 'adiantamentos', 'folhas', 'comissao_faixas',
          'despesas', 'rotas', 'tabelas_precos', 'veiculos',
          'funcionarios', 'motoristas', 'clientes', 'florestas', 'empreiteiros',
          'faturas', 'auditoria', 'lixeira'
      ]) AS t
     WHERE to_regclass(t) IS NOT NULL;

    EXECUTE 'TRUNCATE ' || tabelas || ' RESTART IDENTITY';
    RAISE NOTICE 'Dados apagados: %', tabelas;
END $$;

-- Conferência: tudo deve aparecer com 0
SELECT 'viagens' AS tabela, count(*) FROM viagens
UNION ALL SELECT 'fretes', count(*) FROM fretes
UNION ALL SELECT 'despesas', count(*) FROM despesas
UNION ALL SELECT 'clientes', count(*) FROM clientes
UNION ALL SELECT 'florestas', count(*) FROM florestas
UNION ALL SELECT 'funcionarios', count(*) FROM funcionarios
UNION ALL SELECT 'usuarios (mantidos)', count(*) FROM usuarios
UNION ALL SELECT 'empresas (mantidas)', count(*) FROM empresas;
