// =====================================================================
// Cria (ou atualiza a senha de) um usuário do PAINEL DO DESENVOLVEDOR.
// Rode de dentro da pasta backend:   node database/criar-dev.js
// =====================================================================
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

async function main() {
  // Lê as respostas linha a linha (funciona digitando ou colando tudo de uma vez)
  const rl = readline.createInterface({ input: process.stdin });
  const linhas = [];
  let esperando = null;
  rl.on('line', (l) => (esperando ? (esperando(l), (esperando = null)) : linhas.push(l)));
  const perguntar = (texto) => {
    process.stdout.write(texto);
    return linhas.length ? Promise.resolve(linhas.shift()) : new Promise((r) => (esperando = r));
  };

  console.log('\n=== Xylo (CTech) - acesso ao Painel do Desenvolvedor ===\n');
  const nome = (await perguntar('Seu nome: ')).trim();
  const email = (await perguntar('E-mail (login do painel): ')).trim().toLowerCase();
  const senha = await perguntar('Senha (mínimo 8 caracteres): ');
  rl.close();

  if (!nome) throw new Error('Informe o seu nome.');
  // Mesmo formato exigido no restante do sistema: nome@dominio.algo
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('E-mail inválido. Use o formato completo, por exemplo: lais@ctech.com');
  }
  if (senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');

  await pool.query(
    `INSERT INTO desenvolvedores (nome, email, senha_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, ativo = TRUE`,
    [nome, email, await bcrypt.hash(senha, 10)]
  );
  console.log('\n✅ Pronto! Entre no painel (frontend/dev.html) com o e-mail', email, '\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Erro:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
