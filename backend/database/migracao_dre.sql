-- =====================================================================
-- DRE (Demonstração do Resultado do Exercício)
--
-- 1) Cada categoria de despesa diz em que linha da DRE ela entra (grupo_dre):
--      custo          custos da operação (combustível, manutenção dos caminhões...)
--      pessoal        despesas com pessoal (lançadas fora da folha do sistema)
--      administrativa despesas administrativas e gerais
--      comercial      despesas comerciais (vendas, propaganda, comissões de venda)
--      financeira     despesas financeiras (juros, tarifas bancárias)
--      impostos       impostos sobre a receita pagos e lançados em despesas (DAS, ICMS, ISS...)
--      ir_csll        IRPJ e CSLL lançados em despesas
--      nao_entra      não é custo nem despesa do período (pagamento de floresta/empreiteiro,
--                     adiantamento: o custo já está nas viagens / na folha)
-- 2) Dados fiscais da empresa para a DRE: regime e alíquotas (o contador informa).
--
-- Rode uma vez (pode rodar de novo, não apaga nada):
--   psql -U postgres -d db_woodcontrol -f database/migracao_dre.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';

ALTER TABLE categorias_despesa ADD COLUMN IF NOT EXISTS grupo_dre VARCHAR(20);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_categoria_grupo_dre') THEN
        ALTER TABLE categorias_despesa ADD CONSTRAINT ck_categoria_grupo_dre CHECK (grupo_dre IS NULL OR grupo_dre IN
            ('custo', 'pessoal', 'administrativa', 'comercial', 'financeira', 'impostos', 'ir_csll', 'nao_entra'));
    END IF;
END $$;

-- Sugestão pelo nome (só onde ainda não foi escolhido)
CREATE OR REPLACE FUNCTION fn_grupo_dre_sugerido(p_nome TEXT) RETURNS VARCHAR AS $$
DECLARE n TEXT := lower(translate(p_nome, 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc'));
BEGIN
    IF n ~ '(pagamento de (floresta|empreiteiro)|adiantamento|transferencia entre|retirada|pro.?labore|distribuicao de lucro)' THEN RETURN 'nao_entra'; END IF;
    IF n ~ '(irpj|csll|imposto de renda)' THEN RETURN 'ir_csll'; END IF;
    IF n ~ '(imposto|das\M|simples|icms|iss\M|pis|cofins|tributo|taxa municipal)' THEN RETURN 'impostos'; END IF;
    IF n ~ '(juro|tarifa|banc|financ|iof|multa)' THEN RETURN 'financeira'; END IF;
    IF n ~ '(folha|salario|ferias|13|inss|fgts|vale|alimentacao|pessoal|rescis)' THEN RETURN 'pessoal'; END IF;
    IF n ~ '(combust|diesel|posto|manuten|pneu|pecas|oleo|frete|pedagio|motosserra|caminh)' THEN RETURN 'custo'; END IF;
    IF n ~ '(propaganda|marketing|comissao de venda|brinde)' THEN RETURN 'comercial'; END IF;
    RETURN 'administrativa';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE categorias_despesa SET grupo_dre = fn_grupo_dre_sugerido(nome) WHERE grupo_dre IS NULL;

-- Categoria nova (empresa nova ou criada na tela): já nasce com a sugestão
CREATE OR REPLACE FUNCTION fn_categoria_grupo_dre() RETURNS trigger AS $$
BEGIN
    IF NEW.grupo_dre IS NULL THEN NEW.grupo_dre := fn_grupo_dre_sugerido(NEW.nome); END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_categoria_grupo_dre ON categorias_despesa;
CREATE TRIGGER tg_categoria_grupo_dre BEFORE INSERT ON categorias_despesa
    FOR EACH ROW EXECUTE FUNCTION fn_categoria_grupo_dre();

-- Dados fiscais da empresa (para a DRE)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS regime_tributario VARCHAR(20);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aliquota_receita  NUMERIC(6, 3) NOT NULL DEFAULT 0;  -- % sobre a receita bruta (DAS, PIS/COFINS, ICMS, ISS)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aliquota_ir_csll  NUMERIC(6, 3) NOT NULL DEFAULT 0;  -- % de IRPJ + CSLL
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS base_ir_csll      VARCHAR(10) NOT NULL DEFAULT 'lucro'; -- 'lucro' (Real) ou 'receita' (Presumido)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_empresa_regime') THEN
        ALTER TABLE empresas ADD CONSTRAINT ck_empresa_regime CHECK (regime_tributario IS NULL OR regime_tributario IN ('mei', 'simples', 'presumido', 'real', 'outro'));
        ALTER TABLE empresas ADD CONSTRAINT ck_empresa_aliquotas CHECK (aliquota_receita BETWEEN 0 AND 100 AND aliquota_ir_csll BETWEEN 0 AND 100);
        ALTER TABLE empresas ADD CONSTRAINT ck_empresa_base_ir CHECK (base_ir_csll IN ('lucro', 'receita'));
    END IF;
END $$;
