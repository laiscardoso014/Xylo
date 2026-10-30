-- =====================================================================
-- PLACA DO MOTORISTA
--
-- Cada motorista dirige sempre o mesmo caminhão. Na folha aparece o nome
-- completo, mas no ticket da balança só o 1º nome (ou o apelido): é pela
-- PLACA que o sistema sabe quem é o motorista da carga.
--   motoristas.placa  placa do caminhão dele (só letras e números, maiúsculas)
-- O cadastro de funcionário motorista passa a exigir a placa (na tela).
--
-- Quem já tem viagens ganha a placa que mais usou (se ninguém mais usou mais
-- aquela placa). Confira em Pessoal › Funcionários.
--
-- Rode uma vez (pode rodar de novo, não apaga nada):
--   psql -U postgres -d db_woodcontrol -f database/migracao_placa_motorista.sql
-- =====================================================================

-- O arquivo está em UTF-8 (acentos): no Windows o psql lê em WIN1252 se não avisar
SET client_encoding = 'UTF8';

ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS placa VARCHAR(7);
CREATE INDEX IF NOT EXISTS ix_motorista_placa ON motoristas (empresa_id, placa);

-- Preenche pelas viagens: a placa mais usada de cada motorista, desde que
-- esse motorista seja o que mais usou aquela placa (sem empate)
WITH uso AS (
    SELECT v.empresa_id, v.motorista_id, upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g')) AS placa, count(*) AS n
      FROM viagens v
     WHERE v.motorista_id IS NOT NULL AND v.placa IS NOT NULL AND v.status <> 'Cancelada'
     GROUP BY 1, 2, 3
), ranking AS (
    SELECT *,
           row_number() OVER (PARTITION BY motorista_id ORDER BY n DESC, placa) AS pos_motorista,
           rank()       OVER (PARTITION BY empresa_id, placa ORDER BY n DESC)   AS pos_placa,
           count(*)     OVER (PARTITION BY empresa_id, placa, n)                 AS empatados
      FROM uso
     WHERE placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
)
UPDATE motoristas m SET placa = r.placa
  FROM ranking r
 WHERE r.motorista_id = m.id AND m.placa IS NULL
   AND r.pos_motorista = 1 AND r.pos_placa = 1 AND r.empatados = 1
   AND NOT EXISTS (SELECT 1 FROM motoristas o WHERE o.empresa_id = m.empresa_id AND o.placa = r.placa AND o.id <> m.id);
