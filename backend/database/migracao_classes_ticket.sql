SET client_encoding = 'UTF8';
-- =====================================================================
-- CLASSES DE MADEIRA: "Como aparece no ticket"
-- Nomes que a balança escreve para a classe, separados por vírgula
-- (ex.: "PINUS GROSSO, TORA G, G32+"). A leitura do ticket e a importação
-- de planilha usam esses nomes para escolher a classe certa.
-- Pode rodar mais de uma vez.
--   psql "ENDEREÇO_DO_BANCO" -f database/migracao_classes_ticket.sql
-- =====================================================================
ALTER TABLE classes_madeira ADD COLUMN IF NOT EXISTS nomes_ticket VARCHAR(300);
