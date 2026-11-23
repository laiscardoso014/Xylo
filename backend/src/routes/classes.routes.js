// =====================================================================
// CLASSES DE MADEIRA - Lixo, Fina, Média, Grossa, Eucalipto... (por empresa)
//
// Cada empresa já nasce com as classes padrão e pode criar as suas
// (ex.: "Toras 40+", "Cavaco"). A classe é escolhida em cada viagem.
//
// Permissões (mesmas de clientes, florestas e empreiteiros):
//   Visualização -> só lista
//   Administrador e Financeiro -> cadastram e editam
//   Só Administrador -> desativa (não apaga, para manter o histórico das viagens)
//
// Regra de ouro: TODA consulta filtra por empresa_id vindo do token.
// =====================================================================
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

// "viagens" = quantas viagens usam a classe (mostrado na lista)
const CAMPOS = `c.id, c.nome, c.descricao, c.unidade_medida, c.nomes_ticket, c.ativo,
  (SELECT count(*)::int FROM viagens v WHERE v.classe_id = c.id AND v.empresa_id = c.empresa_id) AS viagens`;
const ERRO_DUPLICADO = 'Já existe uma classe com este nome.';

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) {
    return res.status(400).json({
      erro: 'Dados inválidos.',
      detalhes: erros.array().map((e) => ({ campo: e.path, mensagem: e.msg })),
    });
  }
  next();
}

const textoOuNulo = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
// "pinus grosso ,  tora g,," -> "PINUS GROSSO, TORA G" (sem repetidos)
const listaTicket = (v) => {
  const itens = [...new Set(String(v ?? '').split(/[,;\n]/).map((x) => x.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean))];
  return itens.length ? itens.join(', ').slice(0, 300) : null;
};

const regrasCampos = (criando) => [
  criando
    ? body('nome').trim().notEmpty().withMessage('Informe o nome da classe.')
    : body('nome').optional().trim().notEmpty().withMessage('O nome não pode ficar vazio.'),
  body('nome').optional().isLength({ max: 50 }).withMessage('Nome muito longo (máximo 50 caracteres).'),
  body('descricao').optional({ values: 'null' }).isLength({ max: 150 }).withMessage('Descrição muito longa (máximo 150 caracteres).'),
  body('nomes_ticket').optional({ values: 'null' }).isLength({ max: 300 }).withMessage('Nomes do ticket muito longos (máximo 300 caracteres).'),
  body('unidade_medida').optional({ values: 'falsy' }).isIn(['TON', 'M3']).withMessage('Unidade inválida: use tonelada ou m³.'),
  body('ativo').optional().isBoolean().withMessage('Valor inválido para ativo.'),
];

// LISTAR   GET /api/classes?ativo=false  (por padrão só as ativas)
router.get('/', async (req, res, next) => {
  try {
    const somenteAtivos = req.query.ativo !== 'false';
    const { rows } = await query(
      `SELECT ${CAMPOS}
         FROM classes_madeira c
        WHERE c.empresa_id = $1 AND ($2::boolean = false OR c.ativo)
        ORDER BY c.ativo DESC, c.nome`,
      [req.usuario.empresaId, somenteAtivos]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Nome repetido sem diferenciar maiúscula/minúscula ("fina" = "Fina")
async function nomeEmUso(empresaId, nome, ignorarId = 0) {
  const { rowCount } = await query(
    'SELECT 1 FROM classes_madeira WHERE empresa_id = $1 AND lower(nome) = lower($2) AND id <> $3',
    [empresaId, nome.trim(), ignorarId]
  );
  return rowCount > 0;
}

// CRIAR   POST /api/classes
router.post('/', podeEditar, regrasCampos(true), validar, async (req, res, next) => {
  try {
    const { nome, descricao, unidade_medida, nomes_ticket } = req.body;
    if (await nomeEmUso(req.usuario.empresaId, nome)) return res.status(409).json({ erro: ERRO_DUPLICADO });
    const { rows } = await query(
      `WITH nova AS (
         INSERT INTO classes_madeira (empresa_id, nome, descricao, unidade_medida, nomes_ticket)
         VALUES ($1, $2, $3, $4, $5) RETURNING *)
       SELECT ${CAMPOS} FROM nova c`,
      [req.usuario.empresaId, nome.trim(), textoOuNulo(descricao), unidade_medida || 'TON', listaTicket(nomes_ticket)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: ERRO_DUPLICADO });
    next(err);
  }
});

// EDITAR   PUT /api/classes/:id
router.put('/:id', podeEditar, [param('id').isInt({ min: 1 }), ...regrasCampos(false)], validar, async (req, res, next) => {
  try {
    const b = req.body;
    const enviado = (campo) => Object.prototype.hasOwnProperty.call(b, campo);
    if (enviado('nome') && await nomeEmUso(req.usuario.empresaId, b.nome, Number(req.params.id))) {
      return res.status(409).json({ erro: ERRO_DUPLICADO });
    }
    const { rows } = await query(
      `WITH alterada AS (
         UPDATE classes_madeira SET
            nome           = COALESCE($3, nome),
            descricao      = CASE WHEN $4 THEN $5 ELSE descricao END,
            unidade_medida = COALESCE($6, unidade_medida),
            ativo          = COALESCE($7, ativo),
            nomes_ticket   = CASE WHEN $8 THEN $9 ELSE nomes_ticket END
          WHERE id = $1 AND empresa_id = $2
      RETURNING *)
       SELECT ${CAMPOS} FROM alterada c`,
      [
        req.params.id, req.usuario.empresaId,
        enviado('nome') ? b.nome.trim() : null,
        enviado('descricao'), textoOuNulo(b.descricao),
        b.unidade_medida || null,
        typeof b.ativo === 'boolean' ? b.ativo : null,
        enviado('nomes_ticket'), listaTicket(b.nomes_ticket),
      ]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Classe não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: ERRO_DUPLICADO });
    next(err);
  }
});

// DESATIVAR   DELETE /api/classes/:id   (não apaga: só marca ativo = false)
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'UPDATE classes_madeira SET ativo = false WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Classe não encontrada.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
