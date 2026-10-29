// =====================================================================
// FRETES - serviço de transporte cobrado à parte (ex.: Buti/Balneário)
//
// Duas formas de cobrança, como na planilha:
//   - por tonelada:  toneladas x valor da tonelada  (ex.: 46,57 t x R$ 120)
//   - valor fechado: um valor só para a carga        (ex.: R$ 8.635,00)
// O total é calculado pelo banco (coluna valor_total).
//
// Situação: Pendente -> Pago (com data do pagamento). Cancelado não é apagado:
// sai dos totais.
//
// Permissões: Visualização só consulta; Administrador e Financeiro lançam,
// corrigem e marcam como pago; só o Administrador cancela.
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { query } = require('../config/db');
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
const valorOuNulo = (v) => (vazio(v) ? null : lerNumero(v));

const SELECT_FRETES = `
  SELECT fr.id, fr.criado_por, fr.numero_carga, to_char(fr.data, 'YYYY-MM-DD') AS data,
         fr.cliente_id, c.nome AS cliente, fr.destino,
         fr.toneladas, fr.valor_tonelada, fr.valor_fechado, fr.valor_total,
         fr.forma_pagamento, fr.status_pagamento,
         to_char(fr.data_pagamento, 'YYYY-MM-DD') AS data_pagamento, fr.observacoes
    FROM fretes fr
    JOIN clientes c ON c.id = fr.cliente_id`;

const regrasFrete = [
  body('data').isISO8601().withMessage('Informe a data do frete.'),
  body('cliente_id').isInt({ min: 1 }).withMessage('Escolha o cliente que paga o frete.'),
  body('toneladas').custom(numeroValido(0.01)).withMessage('Informe as toneladas (ex.: 46,57).'),
  body('cobranca').isIn(['tonelada', 'fechado']).withMessage('Escolha como o frete é cobrado.'),
  body('valor_tonelada').if(body('cobranca').equals('tonelada'))
    .custom(numeroValido(0)).withMessage('Informe o valor da tonelada (ex.: 120,00).'),
  body('valor_fechado').if(body('cobranca').equals('fechado'))
    .custom(numeroValido(0)).withMessage('Informe o valor fechado do frete (ex.: 8.635,00).'),
  body('forma_pagamento').optional({ values: 'falsy' }).isIn(FORMAS).withMessage('Forma de pagamento inválida.'),
  body('status_pagamento').optional().isIn(['Pendente', 'Pago']).withMessage('Situação inválida.'),
  body('data_pagamento').optional({ values: 'falsy' }).isISO8601().withMessage('Data de pagamento inválida.'),
  body('destino').optional({ values: 'falsy' }).isLength({ max: 100 }).withMessage('Destino muito longo.'),
  body('numero_carga').optional({ values: 'falsy' }).isLength({ max: 20 }).withMessage('Nº da carga muito longo.'),
];

// Monta os valores comuns de lançar e corrigir
function valoresDoFrete(b) {
  const porTonelada = b.cobranca === 'tonelada';
  const pago = b.status_pagamento === 'Pago';
  return {
    valorTonelada: porTonelada ? valorOuNulo(b.valor_tonelada) : null,
    valorFechado: porTonelada ? null : valorOuNulo(b.valor_fechado),
    status: pago ? 'Pago' : 'Pendente',
    // Pago sem data informada -> considera a data de hoje
    dataPagamento: pago ? (b.data_pagamento || new Date().toISOString().slice(0, 10)) : null,
  };
}

async function clienteDaEmpresa(empresaId, clienteId) {
  const r = await query('SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2', [clienteId, empresaId]);
  return r.rowCount === 1;
}

// ---------------------------------------------------------------------
// LISTAR   GET /api/fretes?mes=2026-01&cliente_id=&situacao=Pendente|Pago&cancelados=true
// Devolve os fretes e os totais do período (sem os cancelados).
// ---------------------------------------------------------------------
router.get(
  '/',
  [q('mes').optional().matches(/^\d{4}-\d{2}$/).withMessage('Mês inválido (use AAAA-MM).'),
    q('cliente_id').optional({ values: 'falsy' }).isInt(),
    q('situacao').optional({ values: 'falsy' }).isIn(['Pendente', 'Pago'])],
  validar,
  async (req, res, next) => {
    try {
      const filtros = [req.usuario.empresaId, req.query.mes || null, vazio(req.query.cliente_id) ? null : Number(req.query.cliente_id)];
      const onde = `
        WHERE fr.empresa_id = $1
          AND ($2::text IS NULL OR to_char(fr.data, 'YYYY-MM') = $2)
          AND ($3::int IS NULL OR fr.cliente_id = $3)`;
      const situacao = req.query.situacao || null;
      const cancelados = req.query.cancelados === 'true';

      const [lista, totais] = await Promise.all([
        query(`${SELECT_FRETES} ${onde}
                 AND ($4::text IS NULL OR fr.status_pagamento = $4)
                 ${cancelados ? '' : "AND fr.status_pagamento <> 'Cancelado'"}
               ORDER BY fr.data DESC, (CASE WHEN fr.numero_carga ~ '^[0-9]+$' THEN fr.numero_carga::int END) DESC NULLS LAST, fr.id DESC`,
        [...filtros, situacao]),
        query(`SELECT COUNT(*)::int AS fretes,
                      COALESCE(SUM(fr.toneladas), 0)   AS toneladas,
                      COALESCE(SUM(fr.valor_total), 0) AS valor_total,
                      COALESCE(SUM(fr.valor_total) FILTER (WHERE fr.status_pagamento = 'Pago'), 0)     AS recebido,
                      COALESCE(SUM(fr.valor_total) FILTER (WHERE fr.status_pagamento = 'Pendente'), 0) AS a_receber
                 FROM fretes fr ${onde} AND fr.status_pagamento <> 'Cancelado'`, filtros),
      ]);
      res.json({ fretes: lista.rows, totais: totais.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// LANÇAR   POST /api/fretes
// Nº da carga vazio -> próximo número do mês
// ---------------------------------------------------------------------
router.post('/', podeEditar, regrasFrete, validar, async (req, res, next) => {
  try {
    const b = req.body;
    if (!(await clienteDaEmpresa(req.usuario.empresaId, b.cliente_id))) {
      return res.status(400).json({ erro: 'Escolha um cliente válido.' });
    }
    const v = valoresDoFrete(b);
    const { rows } = await query(
      `INSERT INTO fretes (empresa_id, numero_carga, data, cliente_id, destino, toneladas,
                           valor_tonelada, valor_fechado, forma_pagamento, status_pagamento, data_pagamento, observacoes,
                           criado_por)
       VALUES ($1,
               COALESCE($2, (SELECT (COALESCE(MAX(numero_carga::int), 0) + 1)::text FROM fretes
                              WHERE empresa_id = $1 AND numero_carga ~ '^[0-9]+$'
                                AND date_trunc('month', data) = date_trunc('month', $3::date))),
               $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        req.usuario.empresaId, textoOuNulo(b.numero_carga), b.data, b.cliente_id, textoOuNulo(b.destino),
        lerNumero(b.toneladas), v.valorTonelada, v.valorFechado, b.forma_pagamento || null,
        v.status, v.dataPagamento, textoOuNulo(b.observacoes), req.usuario.id,
      ]
    );
    const novo = await query(`${SELECT_FRETES} WHERE fr.id = $1`, [rows[0].id]);
    res.status(201).json(novo.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// CORRIGIR   PUT /api/fretes/:id
// ---------------------------------------------------------------------
router.put('/:id', podeEditar, [param('id').isInt({ min: 1 }), ...regrasFrete], validar, async (req, res, next) => {
  try {
    const b = req.body;
    const atual = await query('SELECT status_pagamento FROM fretes WHERE id = $1 AND empresa_id = $2', [req.params.id, req.usuario.empresaId]);
    if (!atual.rowCount) return res.status(404).json({ erro: 'Frete não encontrado.' });
    if (atual.rows[0].status_pagamento === 'Cancelado') return res.status(400).json({ erro: 'Frete cancelado não pode ser alterado.' });
    if (!(await clienteDaEmpresa(req.usuario.empresaId, b.cliente_id))) {
      return res.status(400).json({ erro: 'Escolha um cliente válido.' });
    }
    const v = valoresDoFrete(b);
    await query(
      `UPDATE fretes SET
          numero_carga = COALESCE($3, numero_carga), data = $4, cliente_id = $5, destino = $6, toneladas = $7,
          valor_tonelada = $8, valor_fechado = $9, forma_pagamento = $10,
          status_pagamento = $11, data_pagamento = $12, observacoes = $13
        WHERE id = $1 AND empresa_id = $2`,
      [
        req.params.id, req.usuario.empresaId, textoOuNulo(b.numero_carga), b.data, b.cliente_id, textoOuNulo(b.destino),
        lerNumero(b.toneladas), v.valorTonelada, v.valorFechado, b.forma_pagamento || null,
        v.status, v.dataPagamento, textoOuNulo(b.observacoes),
      ]
    );
    const { rows } = await query(`${SELECT_FRETES} WHERE fr.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// MARCAR COMO PAGO / PENDENTE   PUT /api/fretes/:id/pagamento   { pago: true, data_pagamento? }
// Atalho da lista: não precisa abrir o formulário.
// ---------------------------------------------------------------------
router.put(
  '/:id/pagamento',
  podeEditar,
  [param('id').isInt({ min: 1 }), body('pago').isBoolean().withMessage('Informe se foi pago.'),
    body('data_pagamento').optional({ values: 'falsy' }).isISO8601().withMessage('Data de pagamento inválida.')],
  validar,
  async (req, res, next) => {
    try {
      const pago = req.body.pago === true || req.body.pago === 'true';
      const { rows } = await query(
        `UPDATE fretes SET
            status_pagamento = CASE WHEN $3 THEN 'Pago' ELSE 'Pendente' END,
            data_pagamento   = CASE WHEN $3 THEN COALESCE($4::date, CURRENT_DATE) ELSE NULL END
          WHERE id = $1 AND empresa_id = $2 AND status_pagamento <> 'Cancelado'
        RETURNING id`,
        [req.params.id, req.usuario.empresaId, pago, req.body.data_pagamento || null]
      );
      if (!rows[0]) return res.status(404).json({ erro: 'Frete não encontrado ou cancelado.' });
      const r = await query(`${SELECT_FRETES} WHERE fr.id = $1`, [req.params.id]);
      res.json(r.rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// CANCELAR   DELETE /api/fretes/:id   (só Administrador; não apaga)
// ---------------------------------------------------------------------
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE fretes SET status_pagamento = 'Cancelado', data_pagamento = NULL
        WHERE id = $1 AND empresa_id = $2 AND status_pagamento <> 'Cancelado'`,
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Frete não encontrado ou já cancelado.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
