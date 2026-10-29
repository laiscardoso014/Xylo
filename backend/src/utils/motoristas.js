// Motorista digitado/lido no ticket -> id na tabela motoristas.
// Reaproveita o cadastro com o mesmo nome (sem diferenciar maiúsculas e
// acentos); se não houver, cria. "executar" = query do pool ou de uma transação.
async function idDoMotorista(executar, empresaId, nome) {
  const n = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim().slice(0, 150) : '';
  if (!n) return null;
  const achado = await executar(
    `SELECT id FROM motoristas WHERE empresa_id = $1
       AND translate(upper(nome), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC') = translate(upper($2), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC')
     ORDER BY ativo DESC, id LIMIT 1`, [empresaId, n]);
  if (achado.rows.length) return achado.rows[0].id;
  const novo = await executar(
    `INSERT INTO motoristas (empresa_id, nome) VALUES ($1, $2)
     ON CONFLICT (empresa_id, nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`, [empresaId, n]);
  return novo.rows[0].id;
}

module.exports = { idDoMotorista };
