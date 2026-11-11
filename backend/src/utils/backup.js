// =====================================================================
// BACKUP COMPLETO DO BANCO (todas as tabelas) em um arquivo .json.gz
//
// Usado em três lugares:
//   - painel do dev: botão "Baixar backup agora"    (routes/devEquipe.routes.js)
//   - script no computador: database/fazer-backup.js (agendado no Windows)
//   - função xylo-backup na AWS, que grava no S3     (lambda.js)
// Restaurar: database/restaurar-backup.js
//
// - Tudo é lido numa única transação REPEATABLE READ: é uma "foto" do banco
//   num instante só (um lançamento feito durante o backup entra inteiro ou não entra).
// - Cada tabela vai como o TEXTO JSON que o próprio PostgreSQL gera (sem passar
//   pelo JavaScript): datas e números como 0.00 voltam idênticos.
// - O arquivo tem os dados de TODAS as empresas, inclusive os resumos de senha
//   (bcrypt): guarde só em lugar seguro.
// =====================================================================
const zlib = require('zlib');
const { pool } = require('../config/db');

async function gerarBackup() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: tabelas } = await c.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`);
    const dados = {};
    const contagem = {};
    let linhas = 0;
    for (const { table_name: t } of tabelas) {
      const { rows } = await c.query(`SELECT COALESCE(json_agg(x), '[]')::text AS j, count(*)::int AS n FROM "${t.replace(/"/g, '""')}" x`);
      dados[t] = rows[0].j;
      contagem[t] = rows[0].n;
      linhas += rows[0].n;
    }
    await c.query('COMMIT');
    const agora = new Date();
    const dia = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const hora = agora.toLocaleTimeString('sv-SE', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    const conteudo = { sistema: 'Xylo', formato: 2, gerado_em: agora.toISOString(), contagem, tabelas: dados };
    return { dia, hora, linhas, contagem, tabelas: tabelas.length, gz: zlib.gzipSync(Buffer.from(JSON.stringify(conteudo)), { level: 9 }) };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

module.exports = { gerarBackup };
