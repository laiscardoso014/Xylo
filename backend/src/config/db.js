const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// CONNECTION_STRING vem do arquivo .env (carregado no server.js)
const pool = new Pool({ connectionString: process.env.CONNECTION_STRING });

pool.on('error', (err) => {
  console.error('Erro inesperado no banco:', err.message);
});

// ---------------------------------------------------------------------
// QUEM ESTÁ MEXENDO (para o histórico / auditoria)
//
// O middleware autenticar() guarda { usuarioId, ip } da requisição aqui.
// Toda conexão pega para ESCREVER recebe essas informações como variáveis
// da sessão do PostgreSQL (xylo.usuario_id e xylo.ip), e o gatilho
// fn_auditar() do banco as grava junto com o que mudou.
// Assim o histórico pega TUDO (telas, importação de Excel...) sem cada rota
// precisar lembrar de registrar.
// ---------------------------------------------------------------------
const contexto = new AsyncLocalStorage();

const conectarOriginal = pool.connect.bind(pool);
pool.connect = function conectar(callback) {
  if (typeof callback === 'function') return conectarOriginal(callback); // uso interno do pool.query (leituras)
  const ctx = contexto.getStore();
  return conectarOriginal().then(async (cliente) => {
    try {
      // Sempre define (vazio quando não há usuário) para não sobrar o valor de quem usou a conexão antes
      await cliente.query("SELECT set_config('xylo.usuario_id', $1, false), set_config('xylo.ip', $2, false)",
        [ctx && ctx.usuarioId ? String(ctx.usuarioId) : '', (ctx && ctx.ip) || '']);
    } catch (err) {
      cliente.release(err);
      throw err;
    }
    return cliente;
  });
};

// Atalho: query('SELECT ... WHERE id = $1', [id])
// Leituras vão direto; INSERT/UPDATE/DELETE passam pela conexão "identificada".
const ESCRITA = /^\s*(insert|update|delete)\b/i;
async function query(texto, parametros) {
  if (!ESCRITA.test(texto)) return pool.query(texto, parametros);
  const cliente = await pool.connect();
  try {
    return await cliente.query(texto, parametros);
  } finally {
    cliente.release();
  }
}

module.exports = { pool, query, contexto };
