// Cria uma empresa e um usuário administrador de TESTE.
// Rode uma vez, de dentro da pasta backend:   node database/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

const CNPJ = '12345678000199'; // só dígitos
const EMAIL = 'admin@teste.com';
const SENHA = 'admin123';       // troque depois!

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const emp = await client.query(
      `INSERT INTO empresas (nome, razao_social, cnpj)
       VALUES ($1, $2, $3)
       ON CONFLICT (cnpj) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      ['Madeireira Exemplo', 'Madeireira Exemplo LTDA', CNPJ]
    );
    const empresaId = emp.rows[0].id;

    const perfil = await client.query(`SELECT id FROM perfis WHERE nome = 'Administrador'`);
    const hash = await bcrypt.hash(SENHA, 10);

    await client.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil_id, email_confirmado_em)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (empresa_id, email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, email_confirmado_em = now()`,
      [empresaId, 'Administrador', EMAIL, hash, perfil.rows[0].id]
    );

    await client.query('COMMIT');
    console.log('Pronto! Login de teste:');
    console.log('  CNPJ : 12.345.678/0001-99');
    console.log('  Email:', EMAIL);
    console.log('  Senha:', SENHA);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro no seed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
