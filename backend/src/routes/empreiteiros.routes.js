// =====================================================================
// EMPREITEIROS - quem corta e carrega a madeira (Xande, Cabeçote, Lico, Luiz...)
//
// O valor pago ao empreiteiro por tonelada fica na Tabela de Preços
// (tipo EMPREITADA). Adiantamentos, diesel e posto entram em Despesas,
// ligados ao empreiteiro, para o relatório mostrar o líquido a pagar.
//
// Permissões (mesmas de clientes e florestas):
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
const { documentoValido, telefoneValido, MSG } = require('../utils/documentos');

const router = express.Router();
router.use(autenticar);

const CAMPOS = 'id, nome, cpf_cnpj, telefone, observacoes, ativo';
const ERRO_DUPLICADO = 'Já existe um empreiteiro com este nome.';

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
// Documento e telefone são guardados só com os números
const digitosOuNulo = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d === '' ? null : d;
};

// criando = true  -> nome obrigatório
// criando = false -> (edição) nome só é validado se for enviado
const regrasCampos = (criando) => [
  criando
    ? body('nome').trim().notEmpty().withMessage('Informe o nome do empreiteiro.')
    : body('nome').optional().trim().notEmpty().withMessage('O nome não pode ficar vazio.'),
  body('nome').optional().isLength({ max: 150 }).withMessage('Nome muito longo (máximo 150 caracteres).'),
  body('cpf_cnpj').optional({ values: 'falsy' }).custom(documentoValido).withMessage(MSG.documento),
  body('telefone').optional({ values: 'falsy' }).custom(telefoneValido).withMessage(MSG.telefone),
  body('ativo').optional().isBoolean().withMessage('Valor inválido para ativo.'),
];

// LISTAR   GET /api/empreiteiros?ativo=false  (por padrão só os ativos)
router.get('/', async (req, res, next) => {
  try {
    const somenteAtivos = req.query.ativo !== 'false';
    const { rows } = await query(
      `SELECT ${CAMPOS}
         FROM empreiteiros
        WHERE empresa_id = $1 AND ($2::boolean = false OR ativo)
        ORDER BY ativo DESC, nome`,
      [req.usuario.empresaId, somenteAtivos]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// CRIAR   POST /api/empreiteiros
router.post('/', podeEditar, regrasCampos(true), validar, async (req, res, next) => {
  try {
    const { nome, cpf_cnpj, telefone, observacoes } = req.body;
    const { rows } = await query(
      `INSERT INTO empreiteiros (empresa_id, nome, cpf_cnpj, telefone, observacoes)
       VALUES ($1, upper($2), $3, $4, $5)
       RETURNING ${CAMPOS}`,
      [req.usuario.empresaId, nome.trim(), digitosOuNulo(cpf_cnpj), digitosOuNulo(telefone), textoOuNulo(observacoes)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: ERRO_DUPLICADO });
    next(err);
  }
});

// EDITAR   PUT /api/empreiteiros/:id
// Campo não enviado fica como estava; campo enviado em branco é apagado.
router.put('/:id', podeEditar, [param('id').isInt({ min: 1 }), ...regrasCampos(false)], validar, async (req, res, next) => {
  try {
    const b = req.body;
    const enviado = (campo) => Object.prototype.hasOwnProperty.call(b, campo);
    const { rows } = await query(
      `UPDATE empreiteiros SET
          nome        = COALESCE(upper($3), nome),
          cpf_cnpj    = CASE WHEN $4 THEN $5 ELSE cpf_cnpj END,
          telefone    = CASE WHEN $6 THEN $7 ELSE telefone END,
          observacoes = CASE WHEN $8 THEN $9 ELSE observacoes END,
          ativo       = COALESCE($10, ativo)
        WHERE id = $1 AND empresa_id = $2
    RETURNING ${CAMPOS}`,
      [
        req.params.id, req.usuario.empresaId,
        enviado('nome') ? b.nome.trim() : null,
        enviado('cpf_cnpj'), digitosOuNulo(b.cpf_cnpj),
        enviado('telefone'), digitosOuNulo(b.telefone),
        enviado('observacoes'), textoOuNulo(b.observacoes),
        typeof b.ativo === 'boolean' ? b.ativo : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Empreiteiro não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: ERRO_DUPLICADO });
    next(err);
  }
});

// DESATIVAR   DELETE /api/empreiteiros/:id   (não apaga: só marca ativo = false)
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'UPDATE empreiteiros SET ativo = false WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Empreiteiro não encontrado.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
