// =====================================================================
// MOTORISTAS das viagens e fretes
//
// Regra: viagem e frete só podem ser lançados com um motorista que JÁ ESTÁ
// cadastrado no sistema (Pessoal › Funcionários, marcado "É motorista"),
// igual ao cliente, à floresta e ao empreiteiro.
//
// O "motorista" (tabela motoristas) é o nome como aparece nas cargas e nos
// tickets (ex.: POPO, TIO DAIA); ele fica ligado ao funcionário
// (funcionarios.motorista_id). É por essa ligação que a comissão da folha
// encontra as cargas.
// =====================================================================

// Comparação sem maiúsculas, acentos e espaços repetidos
const SEM_ACENTO = (col) => `translate(upper(regexp_replace(${col}, '\\s+', ' ', 'g')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC')`;
const limpar = (nome) => (typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim().slice(0, 150) : '');

// Motoristas que podem ser escolhidos: ligados a um funcionário ativo
async function motoristasCadastrados(executar, empresaId) {
  const { rows } = await executar(
    `SELECT m.id, m.nome, f.id AS funcionario_id, f.nome AS funcionario
       FROM motoristas m JOIN funcionarios f ON f.motorista_id = m.id
      WHERE m.empresa_id = $1 AND f.empresa_id = $1 AND f.ativo
      ORDER BY m.nome`, [empresaId]);
  return rows;
}

// Acha um motorista cadastrado pelo nome (o das cargas OU o nome do funcionário)
async function acharMotorista(executar, empresaId, nome) {
  const n = limpar(nome);
  if (!n) return null;
  const { rows } = await executar(
    `SELECT m.id, m.nome, f.nome AS funcionario
       FROM motoristas m JOIN funcionarios f ON f.motorista_id = m.id
      WHERE m.empresa_id = $1 AND f.ativo
        AND (${SEM_ACENTO('m.nome')} = ${SEM_ACENTO('$2')} OR ${SEM_ACENTO('f.nome')} = ${SEM_ACENTO('$2')})
      ORDER BY (${SEM_ACENTO('m.nome')} = ${SEM_ACENTO('$2')}) DESC, m.id LIMIT 1`, [empresaId, n]);
  return rows[0] || null;
}

const AVISO_CADASTRO = 'Cadastre em Pessoal › Funcionários (marque "É motorista") antes de lançar.';

// Confere o motorista de uma viagem/frete.
//   corpo: { motorista_id } (o formulário) ou { motorista } (nome, ex.: vindo de outro sistema)
//   atualId: o motorista que o registro já tem (corrigir carga antiga não obriga a trocar)
// -> { id } ou { erro }
async function motoristaDaCarga(executar, empresaId, corpo, atualId = null) {
  const id = Number(corpo.motorista_id) || null;
  if (id) {
    if (atualId && id === Number(atualId)) return { id };
    const { rows } = await executar(
      `SELECT m.id FROM motoristas m JOIN funcionarios f ON f.motorista_id = m.id
        WHERE m.id = $1 AND m.empresa_id = $2 AND f.ativo`, [id, empresaId]);
    return rows[0] ? { id } : { erro: `Este motorista não está cadastrado como funcionário ativo. ${AVISO_CADASTRO}` };
  }
  const nome = limpar(corpo.motorista);
  if (!nome) return { erro: `Escolha o motorista. ${AVISO_CADASTRO}` };
  const m = await acharMotorista(executar, empresaId, nome);
  return m ? { id: m.id } : { erro: `O motorista "${nome}" não está cadastrado. ${AVISO_CADASTRO}` };
}

// Cria (ou reaproveita) o nome nas cargas de um funcionário motorista.
// Usado só no cadastro de funcionários e na importação com "criar cadastros".
async function idDoMotorista(executar, empresaId, nome) {
  const n = limpar(nome);
  if (!n) return null;
  const achado = await executar(
    `SELECT id FROM motoristas WHERE empresa_id = $1 AND ${SEM_ACENTO('nome')} = ${SEM_ACENTO('$2')}
     ORDER BY ativo DESC, id LIMIT 1`, [empresaId, n]);
  if (achado.rows.length) return achado.rows[0].id;
  const novo = await executar(
    `INSERT INTO motoristas (empresa_id, nome) VALUES ($1, $2)
     ON CONFLICT (empresa_id, nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`, [empresaId, n]);
  return novo.rows[0].id;
}

module.exports = { motoristasCadastrados, acharMotorista, motoristaDaCarga, idDoMotorista, AVISO_CADASTRO };
