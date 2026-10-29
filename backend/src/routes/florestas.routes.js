// =====================================================================
// FLORESTAS - de onde a madeira sai (Grazziotin, Alfredo Wagner, Gabirova...)
//
// Uma floresta não pertence a um cliente: ela vende para vários clientes.
// O valor pago à floresta por tonelada fica na Tabela de Preços (tipo COMPRA).
//
// Permissões (mesmas do cadastro de clientes):
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

const CAMPOS = 'id, nome, proprietario, municipio, estado, observacoes, ativo';
const ERRO_DUPLICADA = 'Já existe uma floresta com este nome.';

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

// Texto vazio vira null (campo opcional em branco)
const textoOuNulo = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// criando = true  -> nome obrigatório
// criando = false -> (edição) nome só é validado se for enviado
const regrasCampos = (criando) => [
  criando
    ? body('nome').trim().notEmpty().withMessage('Informe o nome da floresta.')
    : body('nome').optional().trim().notEmpty().withMessage('O nome não pode ficar vazio.'),
  body('nome').optional().isLength({ max: 150 }).withMessage('Nome muito longo (máximo 150 caracteres).'),
  body('proprietario').optional({ values: 'falsy' }).isLength({ max: 150 }).withMessage('Nome do proprietário muito longo.'),
  body('municipio').optional({ values: 'falsy' }).isLength({ max: 100 }).withMessage('Nome do município muito longo.'),
  body('estado').optional({ values: 'falsy' }).trim().isLength({ min: 2, max: 2 }).withMessage('Use a sigla do estado (ex.: SC).'),
  body('ativo').optional().isBoolean().withMessage('Valor inválido para ativo.'),
];

// LISTAR   GET /api/florestas?ativo=false  (por padrão só as ativas)
router.get('/', async (req, res, next) => {
  try {
    const somenteAtivas = req.query.ativo !== 'false';
    const { rows } = await query(
      `SELECT ${CAMPOS}
         FROM florestas
        WHERE empresa_id = $1 AND ($2::boolean = false OR ativo)
        ORDER BY ativo DESC, nome`,
      [req.usuario.empresaId, somenteAtivas]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// CRIAR   POST /api/florestas
router.post('/', podeEditar, regrasCampos(true), validar, async (req, res, next) => {
  try {
    const { nome, proprietario, municipio, estado, observacoes } = req.body;
    const { rows } = await query(
      `INSERT INTO florestas (empresa_id, nome, proprietario, municipio, estado, observacoes)
       VALUES ($1, upper($2), $3, $4, upper($5), $6)
       RETURNING ${CAMPOS}`,
      [
        req.usuario.empresaId, nome.trim(), textoOuNulo(proprietario), textoOuNulo(municipio),
        textoOuNulo(estado), textoOuNulo(observacoes),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: ERRO_DUPLICADA });
    next(err);
  }
});

// EDITAR   PUT /api/florestas/:id
// Campo não enviado fica como estava; campo enviado em branco é apagado.
router.put('/:id', podeEditar, [param('id').isInt({ min: 1 }), ...regrasCampos(false)], validar, async (req, res, next) => {
  try {
    const b = req.body;
    const enviado = (campo) => Object.prototype.hasOwnProperty.call(b, campo);
    const { rows } = await query(
      `UPDATE florestas SET
          nome         = COALESCE(upper($3), nome),
          proprietario = CASE WHEN $4 THEN $5 ELSE proprietario END,
          municipio    = CASE WHEN $6 THEN $7 ELSE municipio END,
          estado       = CASE WHEN $8 THEN upper($9) ELSE estado END,
          observacoes  = CASE WHEN $10 THEN $11 ELSE observacoes END,
          ativo        = COALESCE($12, ativo)
        WHERE id = $1 AND empresa_id = $2
    RETURNING ${CAMPOS}`,
      [
        req.params.id, req.usuario.empresaId,
        enviado('nome') ? b.nome.trim() : null,
        enviado('proprietario'), textoOuNulo(b.proprietario),
        enviado('municipio'), textoOuNulo(b.municipio),
        enviado('estado'), textoOuNulo(b.estado),
        enviado('observacoes'), textoOuNulo(b.observacoes),
        typeof b.ativo === 'boolean' ? b.ativo : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Floresta não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: ERRO_DUPLICADA });
    next(err);
  }
});

// DESATIVAR   DELETE /api/florestas/:id   (não apaga: só marca ativo = false)
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'UPDATE florestas SET ativo = false WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Floresta não encontrada.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
