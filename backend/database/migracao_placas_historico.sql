-- =====================================================================
-- HISTÓRICO DE PLACAS DO MOTORISTA
--
-- O motorista pode trocar de caminhão (ex.: uma placa em 2024, outra em
-- 2025 e outra em 2026). Cada placa vale "a partir de" uma data; a anterior
-- vale até o dia antes da troca. Assim um ticket de 2024 com a placa antiga
-- encontra o motorista certo, e a placa antiga pode passar a outro motorista
-- depois da troca.
--   motorista_placas: motorista, placa, desde (vazio = desde sempre), ate (vazio = até hoje)
--   motoristas.placa continua sendo a placa ATUAL (a de "ate" vazio).
--
-- Quem já tem viagens com mais de uma placa, em períodos que não se misturam,
-- ganha o histórico montado pelas viagens. Confira em Pessoal › Funcionários.
--
-- Rode uma vez (pode rodar de novo, não apaga nada):
--   psql -U postgres -d db_woodcontrol -f database/migracao_placas_historico.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS motorista_placas (
    id           SERIAL PRIMARY KEY,
    empresa_id   INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    motorista_id INT NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
    placa        VARCHAR(7) NOT NULL,
    desde        DATE,             -- vazio = desde sempre
    ate          DATE,             -- vazio = até hoje (placa atual)
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_placa_periodo CHECK (desde IS NULL OR ate IS NULL OR ate >= desde)
);
CREATE INDEX IF NOT EXISTS ix_motorista_placas_placa ON motorista_placas (empresa_id, placa);
CREATE INDEX IF NOT EXISTS ix_motorista_placas_motorista ON motorista_placas (motorista_id);

-- Monta o histórico de quem ainda não tem nenhum
DO $$
DECLARE
    m RECORD;
    p RECORD;
    usos JSONB;
    anterior RECORD;
    mistura BOOLEAN;
    i INT;
BEGIN
    FOR m IN
        SELECT mo.id, mo.empresa_id, mo.placa FROM motoristas mo
         WHERE NOT EXISTS (SELECT 1 FROM motorista_placas x WHERE x.motorista_id = mo.id)
    LOOP
        -- placas usadas nas viagens dele, com o período de uso (só placas no padrão)
        SELECT COALESCE(jsonb_agg(u ORDER BY u.primeira), '[]') INTO usos FROM (
            SELECT upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g')) AS placa, MIN(v.data) AS primeira, MAX(v.data) AS ultima
              FROM viagens v
             WHERE v.motorista_id = m.id AND v.placa IS NOT NULL AND v.status <> 'Cancelada'
             GROUP BY 1
            HAVING upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
        ) u;

        -- os períodos se misturam? (usou as duas placas alternando) -> não dá para montar sozinho
        mistura := FALSE;
        FOR i IN 1 .. jsonb_array_length(usos) - 1 LOOP
            IF (usos -> i ->> 'primeira')::date <= (usos -> (i - 1) ->> 'ultima')::date THEN mistura := TRUE; END IF;
        END LOOP;

        IF jsonb_array_length(usos) >= 2 AND NOT mistura THEN
            FOR i IN 0 .. jsonb_array_length(usos) - 1 LOOP
                INSERT INTO motorista_placas (empresa_id, motorista_id, placa, desde, ate)
                VALUES (m.empresa_id, m.id, usos -> i ->> 'placa',
                        CASE WHEN i = 0 THEN NULL ELSE (usos -> i ->> 'primeira')::date END,
                        CASE WHEN i = jsonb_array_length(usos) - 1 THEN NULL ELSE (usos -> (i + 1) ->> 'primeira')::date - 1 END);
            END LOOP;
            UPDATE motoristas SET placa = usos -> (jsonb_array_length(usos) - 1) ->> 'placa' WHERE id = m.id;
        ELSIF m.placa IS NOT NULL THEN
            INSERT INTO motorista_placas (empresa_id, motorista_id, placa) VALUES (m.empresa_id, m.id, m.placa);
        END IF;
    END LOOP;
END $$;
