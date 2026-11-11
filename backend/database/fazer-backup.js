// =====================================================================
// FAZER BACKUP DO BANCO NO COMPUTADOR
//
// Uso (na pasta backend):
//   node database/fazer-backup.js                       -> salva em C:\Xylo\backups
//   node database/fazer-backup.js "G:\Meu Drive\Xylo"   -> salva em outra pasta
//
// Melhor ainda: aponte para uma pasta do Google Drive ou do OneDrive. Assim
// existe uma cópia fora do computador, mesmo que ele estrague ou seja roubado.
// A pasta também pode ficar no .env:   BACKUP_PASTA=G:\Meu Drive\Xylo
//
// Guarda os últimos 30 arquivos (BACKUP_MANTER=30) e apaga os mais antigos.
// Usa o banco do CONNECTION_STRING (o do .env, ou o que estiver na variável).
// Para rodar sozinho todo dia: database/agendar-backup.ps1
// Restaurar: node database/restaurar-backup.js <arquivo>
// =====================================================================
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { gerarBackup } = require('../src/utils/backup');
const { pool } = require('../src/config/db');

const pasta = path.resolve(process.argv[2] || process.env.BACKUP_PASTA || path.join(__dirname, '..', '..', 'backups'));
const manter = Math.max(1, Number(process.env.BACKUP_MANTER) || 30);

async function principal() {
  if (!process.env.CONNECTION_STRING) throw new Error('Falta o CONNECTION_STRING (no .env ou na variável de ambiente).');
  fs.mkdirSync(pasta, { recursive: true });
  const b = await gerarBackup();
  const arquivo = path.join(pasta, `xylo-${b.dia}_${b.hora}.json.gz`);
  // grava num temporário e renomeia: um backup interrompido nunca fica com cara de completo
  fs.writeFileSync(`${arquivo}.parcial`, b.gz);
  fs.renameSync(`${arquivo}.parcial`, arquivo);

  const antigos = fs.readdirSync(pasta).filter((n) => /^xylo-.*\.json\.gz$/.test(n)).sort().reverse().slice(manter);
  for (const n of antigos) fs.unlinkSync(path.join(pasta, n));

  const principais = ['empresas', 'usuarios', 'viagens', 'fretes', 'despesas', 'funcionarios']
    .map((t) => `${t} ${b.contagem[t] ?? 0}`).join(' · ');
  console.log(`✔ Backup salvo: ${arquivo}`);
  console.log(`  ${b.tabelas} tabelas, ${b.linhas} linhas, ${(b.gz.length / 1024).toFixed(0)} KB`);
  console.log(`  ${principais}`);
  if (antigos.length) console.log(`  (${antigos.length} backup(s) antigo(s) apagado(s); ficam os últimos ${manter})`);
}

principal()
  .catch((err) => { console.error('✖ Backup NÃO foi feito:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
