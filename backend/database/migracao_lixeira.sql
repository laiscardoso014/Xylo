-- =====================================================================
--  XYLO - Migração: LIXEIRA (exclusão com recuperação) e HISTÓRICO
--
--  O que muda:
--    1) fretes, despesas e tabela de preços passam a guardar QUEM LANÇOU
--       (viagens já guardavam). O Financeiro só exclui o que ele lançou.
--    2) Tabela LIXEIRA: o registro excluído SAI da tabela dele (não aparece
--       em tela, total, relatório, Excel nem no assistente) e fica guardado
--       aqui, inteiro, com motivo, quem e quando. O administrador restaura.
--       Nada é apagado de vez.
--    3) HISTÓRICO (tabela auditoria, que já existia vazia): um gatilho
--       (trigger) grava toda inclusão, alteração, cancelamento, exclusão e
--       restauração - com o antes e o depois de cada campo alterado.
--       Também grava as entradas no sistema (login).
--
--  Para o banco que JÁ ESTÁ rodando. Não apaga nada e pode rodar mais de
--  uma vez. Dentro da pasta backend:
--
--    & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d db_woodcontrol -f database/migracao_lixeira.sql
-- =====================================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- 1) Quem lançou -------------------------------------------------------
ALTER TABLE fretes         ADD COLUMN IF NOT EXISTS criado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE despesas       ADD COLUMN IF NOT EXISTS criado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE tabelas_precos ADD COLUMN IF NOT EXISTS criado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;

-- 2) Lixeira -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS lixeira (
    id             BIGSERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tabela         VARCHAR(30) NOT NULL
                   CHECK (tabela IN ('viagens', 'fretes', 'despesas', 'tabelas_precos')),
    registro_id    INT NOT NULL,                   -- volta com o MESMO id ao restaurar
    resumo         VARCHAR(300) NOT NULL,          -- "Viagem nº 12 · 26/10/2026 · POMESUL · 43,03 t"
    data_registro  DATE,                           -- data da viagem/frete/despesa (filtro)
    valor          NUMERIC(12, 2),                 -- valor do registro (para mostrar)
    dados          JSONB NOT NULL,                 -- a linha inteira, como estava
    dependentes    JSONB,                          -- ex.: divisão da carga entre empreiteiros
    motivo         VARCHAR(300) NOT NULL,
    criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,  -- quem tinha lançado
    excluido_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
    excluido_em    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_lixeira_registro UNIQUE (tabela, registro_id)
);
CREATE INDEX IF NOT EXISTS ix_lixeira_empresa ON lixeira (empresa_id, excluido_em DESC);

-- 3) Histórico (auditoria) --------------------------------------------
ALTER TABLE auditoria DROP CONSTRAINT IF EXISTS auditoria_acao_check;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_acao_check
    CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'EXCLUIR', 'RESTAURAR', 'CANCELAR'));
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS detalhe VARCHAR(300);   -- ex.: motivo da exclusão
CREATE INDEX IF NOT EXISTS ix_auditoria_registro ON auditoria (empresa_id, tabela, registro_id);

-- O backend informa QUEM está mexendo pelas variáveis da sessão do banco:
--   xylo.usuario_id, xylo.ip   (a cada conexão, ver src/config/db.js)
--   xylo.acao, xylo.detalhe    (só na exclusão/restauração, dentro da transação)
CREATE OR REPLACE FUNCTION fn_auditar() RETURNS trigger AS $$
DECLARE
    v_usuario INT  := NULLIF(current_setting('xylo.usuario_id', true), '')::int;
    v_ip      TEXT := NULLIF(current_setting('xylo.ip', true), '');
    v_acao    TEXT := NULLIF(current_setting('xylo.acao', true), '');
    v_detalhe TEXT := NULLIF(current_setting('xylo.detalhe', true), '');
    -- campos que não entram no histórico (controle interno / sigilo)
    ignorar   TEXT[] := ARRAY['created_at', 'updated_at', 'ultimo_login', 'senha_hash', 'senha_alterada_em', 'logo'];
    antes     JSONB;
    depois    JSONB;
    mud_antes  JSONB := '{}'::jsonb;
    mud_depois JSONB := '{}'::jsonb;
    registro  JSONB;
    v_empresa INT;
    chave     TEXT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN antes  := to_jsonb(OLD); END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN depois := to_jsonb(NEW); END IF;
    registro := COALESCE(depois, antes);
    v_empresa := CASE WHEN TG_TABLE_NAME = 'empresas' THEN (registro->>'id')::int ELSE (registro->>'empresa_id')::int END;

    -- Empresa sendo apagada (painel do desenvolvedor): não há onde registrar
    IF NOT EXISTS (SELECT 1 FROM empresas WHERE id = v_empresa) THEN RETURN NULL; END IF;

    IF TG_OP = 'UPDATE' THEN
        -- só os campos que mudaram
        FOR chave IN SELECT jsonb_object_keys(depois) LOOP
            CONTINUE WHEN (antes -> chave) IS NOT DISTINCT FROM (depois -> chave);
            IF chave = ANY (ignorar) THEN
                IF chave = 'senha_hash' THEN mud_depois := mud_depois || '{"senha": "alterada"}'; END IF;
                IF chave = 'logo'       THEN mud_depois := mud_depois || '{"logo": "alterada"}';  END IF;
                CONTINUE;
            END IF;
            mud_antes  := mud_antes  || jsonb_build_object(chave, antes  -> chave);
            mud_depois := mud_depois || jsonb_build_object(chave, depois -> chave);
        END LOOP;
        IF mud_depois = '{}'::jsonb THEN RETURN NULL; END IF;   -- nada que interesse mudou
        antes := mud_antes;
        depois := mud_depois;
        IF v_acao IS NULL AND (depois->>'status' IN ('Cancelada', 'Cancelado') OR depois->>'status_pagamento' = 'Cancelado') THEN
            v_acao := 'CANCELAR';
        END IF;
    ELSE
        antes  := antes  - ignorar;
        depois := depois - ignorar;
    END IF;

    INSERT INTO auditoria (empresa_id, usuario_id, acao, tabela, registro_id, dados_anteriores, dados_novos, ip, detalhe)
    VALUES (v_empresa, v_usuario, COALESCE(v_acao, TG_OP), TG_TABLE_NAME, (registro->>'id')::int,
            antes, depois, v_ip, left(v_detalhe, 300));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['viagens', 'fretes', 'despesas', 'tabelas_precos', 'clientes', 'florestas',
                             'empreiteiros', 'usuarios', 'categorias_despesa'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_auditoria ON %I', t, t);
        EXECUTE format('CREATE TRIGGER tg_%s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_auditar()', t, t);
    END LOOP;
    -- empresa: só alterações (dados da empresa, logo)
    DROP TRIGGER IF EXISTS tg_empresas_auditoria ON empresas;
    CREATE TRIGGER tg_empresas_auditoria AFTER UPDATE ON empresas FOR EACH ROW EXECUTE FUNCTION fn_auditar();
END $$;

COMMIT;
