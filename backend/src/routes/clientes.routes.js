// EXEMPLO DE CADASTRO (CRUD). Use este arquivo como modelo para
// fornecedores, empreiteiros, motoristas, veículos etc.
// Regra de ouro: TODA consulta filtra por empresa_id vindo do token.
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin } = require('../middlewares/auth');
const { documentoValido, telefoneValido, MSG } = require('../utils/documentos');

const router = express.Router();
router.use(autenticar);

// Visualização só lê; Administrador e Financeiro criam/editam; só o Administrador desativa

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

const soDigitos = (v) => (v ? String(v).replace(/\D/g, '') : null);

// criando = true  -> nome obrigatório
// criando = false -> (edição) nome só é validado se for enviado
const regrasCampos = (criando) => [
  criando
    ? body('nome').trim().notEmpty().withMessage('Informe o nome.')
    : body('nome').optional().trim().notEmpty().withMessage('O nome não pode ficar vazio.'),
  body('estado').optional({ values: 'falsy' }).isLength({ min: 2, max: 2 }).withMessage('Use a sigla do estado (ex.: SC).'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('E-mail inválido.'),
  body('cpf_cnpj').optional({ values: 'falsy' }).custom(documentoValido).withMessage(MSG.documento),
  body('telefone').optional({ values: 'falsy' }).custom(telefoneValido).withMessage(MSG.telefone),
];

// LISTAR   GET /api/clientes?ativo=false  (por padrão só os ativos)
router.get('/', async (req, res, next) => {
  try {
    const somenteAtivos = req.query.ativo !== 'false';
    const { rows } = await query(
      `SELECT id, nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, ativo, observacoes
         FROM clientes
        WHERE empresa_id = $1 AND ($2::boolean = false OR ativo)
        ORDER BY nome`,
      [req.usuario.empresaId, somenteAtivos]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// CRIAR   POST /api/clientes
router.post('/', podeEditar, regrasCampos(true), validar, async (req, res, next) => {
  try {
    const { nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, observacoes } = req.body;
    const { rows } = await query(
      `INSERT INTO clientes (empresa_id, nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, ativo, observacoes`,
      [
        req.usuario.empresaId, nome, razao_social || null, soDigitos(cpf_cnpj),
        soDigitos(telefone), email || null, cidade || null, estado ? estado.toUpperCase() : null,
        observacoes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um cliente com este nome ou CPF/CNPJ.' });
    next(err);
  }
});

// EDITAR   PUT /api/clientes/:id   (campos não enviados ficam como estavam)
router.put(
  '/:id',
  podeEditar,
  [param('id').isInt({ min: 1 }), ...regrasCampos(false)],
  validar,
  async (req, res, next) => {
    try {
      const { nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, observacoes, ativo } = req.body;
      const { rows } = await query(
        `UPDATE clientes SET
            nome         = COALESCE($3, nome),
            razao_social = COALESCE($4, razao_social),
            cpf_cnpj     = COALESCE($5, cpf_cnpj),
            telefone     = COALESCE($6, telefone),
            email        = COALESCE($7, email),
            cidade       = COALESCE($8, cidade),
            estado       = COALESCE($9, estado),
            observacoes  = COALESCE($10, observacoes),
            ativo        = COALESCE($11, ativo)
          WHERE id = $1 AND empresa_id = $2
      RETURNING id, nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, ativo, observacoes`,
        [
          req.params.id, req.usuario.empresaId,
          nome ?? null, razao_social ?? null, soDigitos(cpf_cnpj), soDigitos(telefone), email ?? null,
          cidade ?? null, estado ? estado.toUpperCase() : null, observacoes ?? null,
          typeof ativo === 'boolean' ? ativo : null,
        ]
      );
      if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado.' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um cliente com este nome ou CPF/CNPJ.' });
      next(err);
    }
  }
);

// DESATIVAR   DELETE /api/clientes/:id   (não apaga: só marca ativo = false)
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE clientes SET ativo = false WHERE id = $1 AND empresa_id = $2`,
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
