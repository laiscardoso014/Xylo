// =====================================================================
// RESTAURAR UM BACKUP DO XYLO (arquivo xylo-AAAA-MM-DD.json.gz)
//
// Uso (na pasta backend, com o .env apontando para o banco de DESTINO):
//   node database/restaurar-backup.js caminho\xylo-2026-11-04.json.gz          (só confere)
//   node database/restaurar-backup.js caminho\xylo-2026-11-04.json.gz --confirmar
//
// Sem --confirmar ele só mostra o que tem no arquivo e não mexe em nada.
// Com --confirmar ele APAGA os dados atuais do banco de destino e coloca
// os do backup no lugar (tudo numa transação: se der erro, nada muda).
//
// Dica segura: crie antes um banco/branch novo no Neon, rode o database.sql
// nele e restaure lá; confira; só então aponte o sistema para ele.
// =====================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { pool } = require('../src/config/db');

const arquivo = process.argv[2];
const confirmar = process.argv.includes('--confirmar');
const id = (n) => `"${String(n).replace(/"/g, '""')}"`;

async function principal() {
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.log('Informe o arquivo: node database/restaurar-backup.js xylo-AAAA-MM-DD.json.gz [--confirmar]');
    process.exit(1);
  }
  const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivo)).toString('utf8'));
  if (backup.sistema !== 'Xylo' || !backup.tabelas) throw new Error('Este arquivo não é um backup do Xylo.');
  // formato 2: cada tabela é o texto JSON original do PostgreSQL (sem perda); formato 1: lista
  const textoDe = (t) => (typeof backup.tabelas[t] === 'string' ? backup.tabelas[t] : JSON.stringify(backup.tabelas[t]));


  const cliente = await pool.connect();
  try {
    // tabelas que existem no banco de destino
    const { rows: existentes } = await cliente.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`);
    const noBanco = new Set(existentes.map((r) => r.table_name));
    const tabelas = Object.keys(backup.tabelas).filter((t) => noBanco.has(t));
    const faltando = Object.keys(backup.tabelas).filter((t) => !noBanco.has(t));

    console.log(`Backup de ${new Date(backup.gerado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    const qtd = {};
    for (const t of tabelas) qtd[t] = (await cliente.query('SELECT json_array_length($1::json) AS n', [textoDe(t)])).rows[0].n;
    for (const t of tabelas.sort()) console.log(`  ${t.padEnd(28)} ${qtd[t]} linha(s)`);
    if (faltando.length) console.log(`  (não existem no destino e serão ignoradas: ${faltando.join(', ')}) - rode o database.sql antes`);
    if (!confirmar) {
      console.log('\nNada foi alterado. Para restaurar de verdade, rode de novo com --confirmar');
      return;
    }

    // ordem: quem é referenciado entra antes de quem referencia (chaves estrangeiras)
    const { rows: fks } = await cliente.query(
      `SELECT DISTINCT c.conrelid::regclass::text AS filha, c.confrelid::regclass::text AS mae
         FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid <> c.confrelid`);
    const limpa = (n) => n.replace(/^.*\./, '').replace(/"/g, '');
    const maes = new Map(tabelas.map((t) => [t, new Set()]));
    for (const f of fks) if (maes.has(limpa(f.filha)) && maes.has(limpa(f.mae))) maes.get(limpa(f.filha)).add(limpa(f.mae));
    const ordem = [];
    const visto = new Set();
    const visitar = (t) => { if (visto.has(t)) return; visto.add(t); for (const m of maes.get(t)) visitar(m); ordem.push(t); };
    tabelas.sort().forEach(visitar);

    // colunas que o banco calcula sozinho não podem receber valor
    const { rows: geradas } = await cliente.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND (is_generated = 'ALWAYS' OR identity_generation = 'ALWAYS')`);
    const naoInserir = new Set(geradas.map((g) => `${g.table_name}.${g.column_name}`));
    const { rows: colunas } = await cliente.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() ORDER BY ordinal_position`);

    await cliente.query('BEGIN');
    // sem gatilhos durante a carga (não gera auditoria/lixeira falsa nem recalcula nada).
    // DISABLE TRIGGER USER é permitido ao dono das tabelas (no Neon não há superusuário);
    // as chaves estrangeiras continuam valendo, por isso a ordem acima.
    for (const t of ordem) await cliente.query(`ALTER TABLE ${id(t)} DISABLE TRIGGER USER`);
    await cliente.query(`TRUNCATE ${ordem.map(id).join(', ')} RESTART IDENTITY CASCADE`);

    for (const t of ordem) {
      if (!qtd[t]) continue;
      const json = textoDe(t);
      const { rows: chaves } = await cliente.query(
        'SELECT DISTINCT json_object_keys(e) AS k FROM json_array_elements($1::json) e', [json]);
      const noArquivo = new Set(chaves.map((c) => c.k));
      const cols = colunas.filter((c) => c.table_name === t && !naoInserir.has(`${t}.${c.column_name}`))
        .map((c) => c.column_name).filter((c) => noArquivo.has(c));
      const lista = cols.map(id).join(', ');
      await cliente.query(
        `INSERT INTO ${id(t)} (${lista}) SELECT ${lista} FROM json_populate_recordset(NULL::${id(t)}, $1::json)`, [json]);
      // contador do id continua depois do maior id restaurado
      const { rows: seq } = await cliente.query(
        `SELECT a.attname AS coluna, pg_get_serial_sequence($1, a.attname) AS seq
           FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [id(t)]);
      for (const s of seq.filter((x) => x.seq)) {
        await cliente.query(`SELECT setval($1, COALESCE((SELECT MAX(${id(s.coluna)}) FROM ${id(t)}), 0) + 1, false)`, [s.seq]);
      }
      console.log(`  ✓ ${t}: ${qtd[t]}`);
    }
    for (const t of ordem) await cliente.query(`ALTER TABLE ${id(t)} ENABLE TRIGGER USER`);
    await cliente.query('COMMIT');
    console.log('\nBackup restaurado com sucesso.');
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
    await pool.end();
  }
}

principal().catch((err) => {
  console.error('\nNão foi possível restaurar (nada foi alterado):', err.message);
  process.exit(1);
});
