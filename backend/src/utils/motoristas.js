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
//
// PLACA: cada motorista dirige o seu caminhão (obrigatória no cadastro).
// Na folha está o nome completo e no ticket só o 1º nome: a placa é o que
// liga o ticket ao motorista certo. Ele pode TROCAR de caminhão com o tempo:
// motorista_placas guarda cada placa com o período (desde / ate), e a carga
// é ligada pela placa que ele usava NA DATA da carga. motoristas.placa é a atual.
// =====================================================================

// Comparação sem maiúsculas, acentos e espaços repetidos
const SEM_ACENTO = (col) => `translate(upper(regexp_replace(${col}, '\\s+', ' ', 'g')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC')`;
// Placa só com letras e números, maiúsculas: "abc-1d23" -> "ABC1D23"
const placaLimpa = (v) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
// Antiga (ABC1234) ou Mercosul (ABC1D23)
const placaValida = (p) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p);
const limpar = (nome) => (typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim().slice(0, 150) : '');

// Motoristas que podem ser escolhidos: ligados a um funcionário ativo
async function motoristasCadastrados(executar, empresaId) {
  const { rows } = await executar(
    `SELECT m.id, m.nome, m.placa, f.id AS funcionario_id, f.nome AS funcionario,
            COALESCE((SELECT json_agg(json_build_object('placa', mp.placa, 'desde', to_char(mp.desde, 'YYYY-MM-DD'), 'ate', to_char(mp.ate, 'YYYY-MM-DD'))
                                ORDER BY mp.desde NULLS FIRST)
                        FROM motorista_placas mp WHERE mp.motorista_id = m.id), '[]') AS placas
       FROM motoristas m JOIN funcionarios f ON f.motorista_id = m.id
      WHERE m.empresa_id = $1 AND f.empresa_id = $1 AND f.ativo
      ORDER BY m.nome`, [empresaId]);
  return rows;
}

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const valeNaData = (p, data) => (!p.desde || data >= p.desde) && (!p.ate || data <= p.ate);
// Placas de um motorista (lista de motoristasCadastrados); sem histórico, a atual vale sempre
const placasDe = (m) => (m.placas && m.placas.length ? m.placas : m.placa ? [{ placa: m.placa, desde: null, ate: null }] : []);
// Quem usava esta placa nesta data (data AAAA-MM-DD; vazia = hoje)
function donoDaPlaca(lista, placa, data) {
  const p = placaLimpa(placa || '');
  if (!p) return null;
  const d = data || hoje();
  return lista.find((m) => placasDe(m).some((x) => x.placa === p && valeNaData(x, d))) || null;
}
// Placa que o motorista usava nesta data
function placaNaData(m, data) {
  const d = data || hoje();
  const achada = placasDe(m).find((x) => valeNaData(x, d));
  return achada ? achada.placa : null;
}

// Motorista cadastrado (funcionário ativo) que usava esta placa na data (vazia = hoje)
async function acharPorPlaca(executar, empresaId, placa, data = null) {
  const p = placaLimpa(placa);
  if (!p) return null;
  const { rows } = await executar(
    `SELECT m.id, m.nome, m.placa, f.nome AS funcionario
       FROM motoristas m JOIN funcionarios f ON f.motorista_id = m.id
      WHERE m.empresa_id = $1 AND f.ativo
        AND (EXISTS (SELECT 1 FROM motorista_placas mp WHERE mp.motorista_id = m.id AND mp.placa = $2
                       AND (mp.desde IS NULL OR mp.desde <= COALESCE($3::date, CURRENT_DATE))
                       AND (mp.ate IS NULL OR mp.ate >= COALESCE($3::date, CURRENT_DATE)))
             OR (m.placa = $2 AND NOT EXISTS (SELECT 1 FROM motorista_placas mp WHERE mp.motorista_id = m.id)))
      ORDER BY m.id LIMIT 1`, [empresaId, p, data || null]);
  return rows[0] || null;
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
//   corpo: { motorista_id } (o formulário), { motorista } (nome) ou só { placa }
//          (sem motorista: o dono da placa)
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
  if (!nome) {
    const dono = await acharPorPlaca(executar, empresaId, corpo.placa, /^\d{4}-\d{2}-\d{2}$/.test(corpo.data || '') ? corpo.data : null);
    if (dono) return { id: dono.id };
    return { erro: `Escolha o motorista. ${AVISO_CADASTRO}` };
  }
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

module.exports = { motoristasCadastrados, acharMotorista, acharPorPlaca, donoDaPlaca, placaNaData, placasDe, placaLimpa, placaValida, motoristaDaCarga, idDoMotorista, AVISO_CADASTRO };
