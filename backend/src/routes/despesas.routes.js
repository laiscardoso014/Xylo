// =====================================================================
// DESPESAS - o que sai do caixa: adiantamentos, pagamento de floresta e de
// empreiteiro, folha, combustível, manutenção...
//
// Cada despesa tem uma categoria e pode ser ligada a um empreiteiro e/ou a
// uma floresta (assim o relatório do empreiteiro desconta os adiantamentos).
// Categoria nova pode ser criada direto no formulário (campo categoria_nova).
//
// Situação: Pendente -> Pago (com data). Cancelado não é apagado: sai dos totais.
//
// Permissões: Visualização só consulta; Administrador e Financeiro lançam,
// corrigem e marcam como pago; só o Administrador cancela.
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { query, pool } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin } = require('../middlewares/auth');
const { lerNumero, numeroValido } = require('../utils/numeros');

const router = express.Router();
router.use(autenticar);

const FORMAS = ['À vista', 'Cheque', 'Boleto', 'PIX', 'Outro'];

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) {
    return res.status(400).json({
      erro: erros.array()[0].msg,
      detalhes: erros.array().map((e) => ({ campo: e.path, mensagem: e.msg })),
    });
  }
  next();
}

const textoOuNulo = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const vazio = (v) => v === '' || v === null || v === undefined;
const idOuNulo = (v) => (vazio(v) ? null : Number(v));

const SELECT_DESPESAS = `
  SELECT d.id, d.criado_por, to_char(d.data, 'YYYY-MM-DD') AS data, d.descricao, d.favorecido, d.valor,
         d.categoria_id, c.nome AS categoria,
         d.empreiteiro_id, e.nome AS empreiteiro,
         d.floresta_id, f.nome AS floresta,
         d.forma_pagamento, d.status, to_char(d.data_pagamento, 'YYYY-MM-DD') AS data_pagamento,
         d.observacoes
    FROM despesas d
    JOIN categorias_despesa c ON c.id = d.categoria_id
    LEFT JOIN empreiteiros e  ON e.id = d.empreiteiro_id
    LEFT JOIN florestas f     ON f.id = d.floresta_id`;

const regrasDespesa = [
  body('data').isISO8601().withMessage('Informe a data da despesa.'),
  body('descricao').trim().notEmpty().withMessage('Descreva a despesa (ex.: Adiantamento semanal).')
    .isLength({ max: 255 }).withMessage('Descrição muito longa (máx. 255 caracteres).'),
  body('valor').custom(numeroValido(0.01)).withMessage('Informe o valor (ex.: 7.175,00).'),
  body('categoria_id').if(body('categoria_nova').isEmpty())
    .isInt({ min: 1 }).withMessage('Escolha a categoria.'),
  body('categoria_nova').optional({ values: 'falsy' }).trim()
    .isLength({ min: 2, max: 100 }).withMessage('Nome da categoria deve ter de 2 a 100 caracteres.'),
  body('empreiteiro_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Empreiteiro inválido.'),
  body('floresta_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Floresta inválida.'),
  body('favorecido').optional({ values: 'falsy' }).isLength({ max: 150 }).withMessage('Favorecido muito longo.'),
  body('forma_pagamento').optional({ values: 'falsy' }).isIn(FORMAS).withMessage('Forma de pagamento inválida.'),
  body('status').optional().isIn(['Pendente', 'Pago']).withMessage('Situação inválida.'),
  body('data_pagamento').optional({ values: 'falsy' }).isISO8601().withMessage('Data de pagamento inválida.'),
];

// Confere se categoria, empreiteiro e floresta são desta empresa.
// Se veio categoria_nova, usa a existente com o mesmo nome ou cria.
async function prepararDespesa(cliente, empresaId, b) {
  let categoriaId = idOuNulo(b.categoria_id);
  const nova = textoOuNulo(b.categoria_nova);
  if (nova) {
    const existe = await cliente.query(
      'SELECT id FROM categorias_despesa WHERE empresa_id = $1 AND lower(nome) = lower($2)', [empresaId, nova]);
    if (existe.rowCount) {
      categoriaId = existe.rows[0].id;
      await cliente.query('UPDATE categorias_despesa SET ativo = TRUE WHERE id = $1', [categoriaId]);
    } else {
      const criada = await cliente.query(
        'INSERT INTO categorias_despesa (empresa_id, nome) VALUES ($1, $2) RETURNING id', [empresaId, nova]);
      categoriaId = criada.rows[0].id;
    }
  } else {
    const r = await cliente.query('SELECT 1 FROM categorias_despesa WHERE id = $1 AND empresa_id = $2', [categoriaId, empresaId]);
    if (!r.rowCount) return { erro: 'Escolha uma categoria válida.' };
  }

  const empreiteiroId = idOuNulo(b.empreiteiro_id);
  if (empreiteiroId) {
    const r = await cliente.query('SELECT 1 FROM empreiteiros WHERE id = $1 AND empresa_id = $2', [empreiteiroId, empresaId]);
    if (!r.rowCount) return { erro: 'Escolha um empreiteiro válido.' };
  }
  const florestaId = idOuNulo(b.floresta_id);
  if (florestaId) {
    const r = await cliente.query('SELECT 1 FROM florestas WHERE id = $1 AND empresa_id = $2', [florestaId, empresaId]);
    if (!r.rowCount) return { erro: 'Escolha uma floresta válida.' };
  }

  const pago = b.status === 'Pago';
  return {
    valores: [
      categoriaId, empreiteiroId, florestaId, b.data, b.descricao.trim(), textoOuNulo(b.favorecido),
      lerNumero(b.valor), b.forma_pagamento || null, pago ? 'Pago' : 'Pendente',
      // Pago sem data informada -> considera a data de hoje
      pago ? (b.data_pagamento || new Date().toISOString().slice(0, 10)) : null,
      textoOuNulo(b.observacoes),
    ],
  };
}

// Executa dentro de uma transação (a categoria nova só fica se a despesa for gravada)
async function emTransacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query(resultado && resultado.erro ? 'ROLLBACK' : 'COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

// ---------------------------------------------------------------------
// OPÇÕES DO FORMULÁRIO   GET /api/despesas/opcoes
// ---------------------------------------------------------------------
router.get('/opcoes', async (req, res, next) => {
  try {
    const id = req.usuario.empresaId;
    const [categorias, empreiteiros, florestas] = await Promise.all([
      query('SELECT id, nome FROM categorias_despesa WHERE empresa_id = $1 AND ativo ORDER BY nome', [id]),
      query('SELECT id, nome FROM empreiteiros WHERE empresa_id = $1 AND ativo ORDER BY nome', [id]),
      query('SELECT id, nome FROM florestas WHERE empresa_id = $1 AND ativo ORDER BY nome', [id]),
    ]);
    res.json({ categorias: categorias.rows, empreiteiros: empreiteiros.rows, florestas: florestas.rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// LISTAR   GET /api/despesas?mes=2026-01&categoria_id=&empreiteiro_id=&floresta_id=&situacao=&cancelados=true
// Devolve as despesas, os totais do período e o total por categoria
// (sem as canceladas).
// ---------------------------------------------------------------------
router.get(
  '/',
  [q('mes').optional().matches(/^\d{4}-\d{2}$/).withMessage('Mês inválido (use AAAA-MM).'),
    q('categoria_id').optional({ values: 'falsy' }).isInt(),
    q('empreiteiro_id').optional({ values: 'falsy' }).isInt(),
    q('floresta_id').optional({ values: 'falsy' }).isInt(),
    q('situacao').optional({ values: 'falsy' }).isIn(['Pendente', 'Pago'])],
  validar,
  async (req, res, next) => {
    try {
      const r = req.query;
      const filtros = [req.usuario.empresaId, r.mes || null, idOuNulo(r.categoria_id), idOuNulo(r.empreiteiro_id), idOuNulo(r.floresta_id)];
      const onde = `
        WHERE d.empresa_id = $1
          AND ($2::text IS NULL OR to_char(d.data, 'YYYY-MM') = $2)
          AND ($3::int IS NULL OR d.categoria_id = $3)
          AND ($4::int IS NULL OR d.empreiteiro_id = $4)
          AND ($5::int IS NULL OR d.floresta_id = $5)`;
      const cancelados = r.cancelados === 'true';

      const [lista, totais, porCategoria] = await Promise.all([
        query(`${SELECT_DESPESAS} ${onde}
                 AND ($6::text IS NULL OR d.status = $6)
                 ${cancelados ? '' : "AND d.status <> 'Cancelado'"}
               ORDER BY d.data DESC, d.id DESC`,
        [...filtros, r.situacao || null]),
        query(`SELECT COUNT(*)::int AS despesas,
                      COALESCE(SUM(d.valor), 0) AS valor_total,
                      COALESCE(SUM(d.valor) FILTER (WHERE d.status = 'Pago'), 0)     AS pago,
                      COALESCE(SUM(d.valor) FILTER (WHERE d.status = 'Pendente'), 0) AS a_pagar
                 FROM despesas d ${onde} AND d.status <> 'Cancelado'`, filtros),
        query(`SELECT c.nome AS categoria, COUNT(*)::int AS despesas, SUM(d.valor) AS valor
                 FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
                 ${onde} AND d.status <> 'Cancelado'
                GROUP BY c.nome ORDER BY SUM(d.valor) DESC`, filtros),
      ]);
      res.json({ despesas: lista.rows, totais: totais.rows[0], por_categoria: porCategoria.rows });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// LANÇAR   POST /api/despesas
// ---------------------------------------------------------------------
router.post('/', podeEditar, regrasDespesa, validar, async (req, res, next) => {
  try {
    const resultado = await emTransacao(async (cliente) => {
      const p = await prepararDespesa(cliente, req.usuario.empresaId, req.body);
      if (p.erro) return p;
      const { rows } = await cliente.query(
        `INSERT INTO despesas (empresa_id, categoria_id, empreiteiro_id, floresta_id, data, descricao, favorecido,
                               valor, forma_pagamento, status, data_pagamento, observacoes, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [req.usuario.empresaId, ...p.valores, req.usuario.id]
      );
      return { id: rows[0].id };
    });
    if (resultado.erro) return res.status(400).json({ erro: resultado.erro });
    const { rows } = await query(`${SELECT_DESPESAS} WHERE d.id = $1`, [resultado.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// CORRIGIR   PUT /api/despesas/:id
// ---------------------------------------------------------------------
router.put('/:id', podeEditar, [param('id').isInt({ min: 1 }), ...regrasDespesa], validar, async (req, res, next) => {
  try {
    const atual = await query('SELECT status FROM despesas WHERE id = $1 AND empresa_id = $2', [req.params.id, req.usuario.empresaId]);
    if (!atual.rowCount) return res.status(404).json({ erro: 'Despesa não encontrada.' });
    if (atual.rows[0].status === 'Cancelado') return res.status(400).json({ erro: 'Despesa cancelada não pode ser alterada.' });

    const resultado = await emTransacao(async (cliente) => {
      const p = await prepararDespesa(cliente, req.usuario.empresaId, req.body);
      if (p.erro) return p;
      await cliente.query(
        `UPDATE despesas SET
            categoria_id = $3, empreiteiro_id = $4, floresta_id = $5, data = $6, descricao = $7, favorecido = $8,
            valor = $9, forma_pagamento = $10, status = $11, data_pagamento = $12, observacoes = $13
          WHERE id = $1 AND empresa_id = $2`,
        [req.params.id, req.usuario.empresaId, ...p.valores]
      );
      return {};
    });
    if (resultado.erro) return res.status(400).json({ erro: resultado.erro });
    const { rows } = await query(`${SELECT_DESPESAS} WHERE d.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// MARCAR COMO PAGA / PENDENTE   PUT /api/despesas/:id/pagamento   { pago: true, data_pagamento? }
// ---------------------------------------------------------------------
router.put(
  '/:id/pagamento',
  podeEditar,
  [param('id').isInt({ min: 1 }), body('pago').isBoolean().withMessage('Informe se foi paga.'),
    body('data_pagamento').optional({ values: 'falsy' }).isISO8601().withMessage('Data de pagamento inválida.')],
  validar,
  async (req, res, next) => {
    try {
      const pago = req.body.pago === true || req.body.pago === 'true';
      const { rowCount } = await query(
        `UPDATE despesas SET
            status         = CASE WHEN $3 THEN 'Pago' ELSE 'Pendente' END,
            data_pagamento = CASE WHEN $3 THEN COALESCE($4::date, CURRENT_DATE) ELSE NULL END
          WHERE id = $1 AND empresa_id = $2 AND status <> 'Cancelado'`,
        [req.params.id, req.usuario.empresaId, pago, req.body.data_pagamento || null]
      );
      if (!rowCount) return res.status(404).json({ erro: 'Despesa não encontrada ou cancelada.' });
      const { rows } = await query(`${SELECT_DESPESAS} WHERE d.id = $1`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// CANCELAR   DELETE /api/despesas/:id   (só Administrador; não apaga)
// ---------------------------------------------------------------------
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE despesas SET status = 'Cancelado', data_pagamento = NULL
        WHERE id = $1 AND empresa_id = $2 AND status <> 'Cancelado'`,
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Despesa não encontrada ou já cancelada.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
