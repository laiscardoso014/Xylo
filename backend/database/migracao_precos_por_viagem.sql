-- =====================================================================
-- PREÇOS POR VIAGEM (sem tabela de preços)
--
-- Os preços da madeira não são fixos: cada viagem guarda os SEUS valores
-- por tonelada, digitados ao lançar (ou ao ler o ticket):
--   valor_tonelada        venda ao cliente        (obrigatório)
--   valor_ton_floresta    compra da floresta      (o sistema exige no formulário)
--   valor_ton_empreiteiro pago ao empreiteiro     (quando houver empreiteiro)
-- O banco deixa de buscar preço na tabela de preços. A tabela continua no
-- banco (nada é apagado), só não é mais usada.
--
-- Rode uma vez (pode rodar de novo):
--   psql -U postgres -d db_woodcontrol -f database/migracao_precos_por_viagem.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_viagem_preparar() RETURNS trigger AS $$
BEGIN
    IF NEW.placa IS NOT NULL THEN
        NEW.placa := upper(regexp_replace(NEW.placa, '[^A-Za-z0-9 ]', '', 'g'));
    END IF;

    IF NEW.valor_tonelada IS NULL THEN
        RAISE EXCEPTION 'Informe o valor de venda da tonelada da viagem.';
    END IF;

    -- sem empreiteiro único, não há valor de empreiteiro na viagem (a divisão tem o seu)
    IF NEW.empreiteiro_id IS NULL THEN
        NEW.valor_ton_empreiteiro := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Carga dividida entre empreiteiros: sem valor na parte, usa o valor da viagem (ou zero)
CREATE OR REPLACE FUNCTION fn_viagem_empreiteiro_validar() RETURNS trigger AS $$
DECLARE
    v viagens%ROWTYPE;
    soma NUMERIC;
BEGIN
    SELECT * INTO v FROM viagens WHERE id = NEW.viagem_id;

    IF v.empreiteiro_id IS NOT NULL THEN
        RAISE EXCEPTION 'A viagem % já tem empreiteiro único. Para dividir, deixe o empreiteiro da viagem vazio.', v.numero_viagem;
    END IF;

    SELECT COALESCE(SUM(peso_liquido), 0) INTO soma
      FROM viagem_empreiteiros
     WHERE viagem_id = NEW.viagem_id AND id IS DISTINCT FROM NEW.id;

    IF soma + NEW.peso_liquido > v.peso_liquido THEN
        RAISE EXCEPTION 'A soma das partes (% t) passa do peso da carga (% t).',
                        soma + NEW.peso_liquido, v.peso_liquido;
    END IF;

    IF NEW.valor_tonelada IS NULL THEN
        NEW.valor_tonelada := COALESCE(v.valor_ton_empreiteiro, 0);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
