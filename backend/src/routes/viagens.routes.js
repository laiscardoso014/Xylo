// =====================================================================
// VIAGENS - cada carga de madeira (o coração do sistema)
//
// Campos principais: cliente, nº da viagem, data, ticket, placa, floresta,
// empreiteiro, classe, peso líquido, valor da tonelada e valor total.
//
// PREÇOS: não são fixos. Cada viagem guarda os SEUS valores por tonelada,
// digitados ao lançar (ou ao ler o ticket):
//   - venda ao cliente (valor_tonelada)            obrigatório
//   - compra da floresta (valor_ton_floresta)      obrigatório (0 = floresta própria)
//   - empreiteiro (valor_ton_empreiteiro)          obrigatório quando há empreiteiro
// O formulário sugere os valores da última viagem parecida (GET /sugestoes).
// Os totais (peso x valor) são colunas calculadas do banco.
//
// Permissões: Visualização só consulta; Administrador e Financeiro lançam e
// corrigem; só o Administrador cancela (a viagem não é apagada, fica como
// "Cancelada" e sai dos totais e relatórios).
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin } = require('../middlewares/auth');
const { lerNumero, numeroValido } = require('../utils/numeros');
const { motoristaDaCarga, motoristasCadastrados } = require('../utils/motoristas');

const router = express.Router();
router.use(autenticar);

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
const idOuNulo = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const valorOuNulo = (v) => (v === '' || v === null || v === undefined ? null : lerNumero(v));

const SELECT_VIAGENS = `
  SELECT v.id, v.numero_viagem, to_char(v.data, 'YYYY-MM-DD') AS data, v.ticket, v.placa,
         v.cliente_id, c.nome AS cliente,
         v.floresta_id, f.nome AS floresta,
         v.empreiteiro_id, e.nome AS empreiteiro,
         v.classe_id, cm.nome AS classe,
         v.peso_liquido, v.valor_tonelada, v.valor_total,
         v.valor_ton_floresta, v.total_floresta,
         v.valor_ton_empreiteiro, v.total_empreiteiro,
         v.status, v.observacoes, v.criado_por,
         to_char(v.hora_pesagem, 'HH24:MI') AS hora_pesagem, v.motorista_id, m.nome AS motorista
    FROM viagens v
    LEFT JOIN motoristas m   ON m.id = v.motorista_id
    JOIN clientes c          ON c.id = v.cliente_id
    JOIN florestas f         ON f.id = v.floresta_id
    LEFT JOIN empreiteiros e ON e.id = v.empreiteiro_id
    JOIN classes_madeira cm  ON cm.id = v.classe_id`;

// Confere se cliente, floresta, empreiteiro e classe são DESTA empresa
async function cadastrosDaEmpresa(empresaId, b) {
  const { rows } = await query(
    `SELECT (SELECT count(*) FROM clientes        WHERE id = $2 AND empresa_id = $1) AS cliente,
            (SELECT count(*) FROM florestas       WHERE id = $3 AND empresa_id = $1) AS floresta,
            (SELECT count(*) FROM classes_madeira WHERE id = $4 AND empresa_id = $1) AS classe,
            ($5::int IS NULL OR EXISTS (SELECT 1 FROM empreiteiros WHERE id = $5 AND empresa_id = $1)) AS empreiteiro`,
    [empresaId, b.cliente_id, b.floresta_id, b.classe_id, idOuNulo(b.empreiteiro_id)]
  );
  const r = rows[0];
  if (Number(r.cliente) !== 1) return 'Escolha um cliente válido.';
  if (Number(r.floresta) !== 1) return 'Escolha uma floresta válida.';
  if (Number(r.classe) !== 1) return 'Escolha uma classe de madeira válida.';
  if (!r.empreiteiro) return 'Escolha um empreiteiro válido.';
  return null;
}

// Traduz os erros do banco para mensagens claras
function erroDaViagem(err, res, next) {
  if (err.code === '23505') return res.status(409).json({ erro: 'Já existe uma viagem com este ticket.' });
  if (err.code === 'P0001') return res.status(400).json({ erro: err.message });
  return next(err);
}

const regrasViagem = [
  body('data').isISO8601().withMessage('Informe a data da viagem.'),
  body('cliente_id').isInt({ min: 1 }).withMessage('Escolha o cliente.'),
  body('floresta_id').isInt({ min: 1 }).withMessage('Escolha a floresta.'),
  body('classe_id').isInt({ min: 1 }).withMessage('Escolha a classe de madeira.'),
  body('empreiteiro_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Empreiteiro inválido.'),
  body('peso_liquido').custom((v) => numeroValido(0.01)(v)).withMessage('Informe o peso líquido em toneladas (ex.: 46,79).'),
  // Preços por tonelada da viagem (mudam de carga para carga)
  body('valor_tonelada').custom(numeroValido(0)).withMessage('Informe o valor de venda da tonelada (ex.: 280,00).'),
  body('valor_ton_floresta').custom(numeroValido(0)).withMessage('Informe o valor pago à floresta por tonelada (0 se a floresta é própria).'),
  body('valor_ton_empreiteiro')
    .if((v, { req }) => req.body.empreiteiro_id)
    .custom(numeroValido(0)).withMessage('Informe o valor pago ao empreiteiro por tonelada.'),
  body('numero_viagem').optional({ values: 'falsy' }).isLength({ max: 20 }).withMessage('Nº da viagem muito longo.'),
  body('ticket').optional({ values: 'falsy' }).isLength({ max: 30 }).withMessage('Ticket muito longo.'),
  body('placa').optional({ values: 'falsy' }).isLength({ max: 20 }).withMessage('Placa muito longa.'),
  // motorista: tem que estar cadastrado (Funcionários, "É motorista"); conferido em motoristaDaCarga
  body('motorista_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Motorista inválido.'),
  body('motorista').optional({ values: 'falsy' }).isString().isLength({ max: 150 }).withMessage('Nome do motorista muito longo.'),
  body('hora_pesagem').optional({ values: 'falsy' }).matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).withMessage('Horário da pesagem inválido (use HH:MM).'),
];
const horaOuNula = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 5) : null);

// ---------------------------------------------------------------------
// OPÇÕES PARA O FORMULÁRIO   GET /api/viagens/opcoes
// (clientes, florestas e empreiteiros ativos + classes de madeira)
// ---------------------------------------------------------------------
router.get('/opcoes', async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const [clientes, florestas, empreiteiros, classes, motoristas] = await Promise.all([
      query('SELECT id, nome FROM clientes WHERE empresa_id = $1 AND ativo ORDER BY nome', [e]),
      query('SELECT id, nome FROM florestas WHERE empresa_id = $1 AND ativo ORDER BY nome', [e]),
      query('SELECT id, nome FROM empreiteiros WHERE empresa_id = $1 AND ativo ORDER BY nome', [e]),
      query(`SELECT id, nome FROM classes_madeira WHERE empresa_id = $1 AND ativo
              ORDER BY CASE nome WHEN 'Lixo' THEN 1 WHEN 'Fina' THEN 2 WHEN 'Média' THEN 3 WHEN 'Grossa' THEN 4 ELSE 5 END`, [e]),
      motoristasCadastrados(query, e),
    ]);
    // motoristas: só os cadastrados como funcionário ativo; motoristas_nomes: todos os nomes já usados (tela Funcionários)
    const nomes = await query('SELECT id, nome FROM motoristas WHERE empresa_id = $1 AND ativo ORDER BY nome', [e]);
    res.json({ clientes: clientes.rows, florestas: florestas.rows, empreiteiros: empreiteiros.rows, classes: classes.rows,
      motoristas, motoristas_nomes: nomes.rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// SUGESTÕES DE PREÇO   GET /api/viagens/sugestoes?cliente_id=&floresta_id=&empreiteiro_id=&classe_id=&ignorar_id=
// Os preços mudam de carga para carga: o formulário mostra (e numa viagem
// nova já preenche, marcado como "sugestão") o valor da ÚLTIMA viagem
// parecida. Mesma classe primeiro; senão, a última de qualquer classe.
//   -> { venda, floresta, empreiteiro }  cada um: { valor, data, numero_viagem, mesma_classe, classe } | null
// ---------------------------------------------------------------------
router.get(
  '/sugestoes',
  [q('classe_id').optional({ values: 'falsy' }).isInt(), q('cliente_id').optional({ values: 'falsy' }).isInt(),
    q('floresta_id').optional({ values: 'falsy' }).isInt(), q('empreiteiro_id').optional({ values: 'falsy' }).isInt(),
    q('ignorar_id').optional({ values: 'falsy' }).isInt()],
  validar,
  async (req, res, next) => {
    try {
      const e = req.usuario.empresaId;
      const classe = idOuNulo(req.query.classe_id);
      const ignorar = idOuNulo(req.query.ignorar_id);
      // coluna = valor da viagem; filtro = quem (cliente/floresta/empreiteiro)
      const ultima = async (coluna, filtro, id) => {
        if (!id) return null;
        const { rows } = await query(
          `SELECT v.${coluna}::float AS valor, to_char(v.data, 'YYYY-MM-DD') AS data, v.numero_viagem,
                  ($3::int IS NOT NULL AND v.classe_id = $3) AS mesma_classe, k.nome AS classe
             FROM viagens v JOIN classes_madeira k ON k.id = v.classe_id
            WHERE v.empresa_id = $1 AND v.${filtro} = $2 AND v.status <> 'Cancelada' AND v.${coluna} IS NOT NULL
              AND ($4::int IS NULL OR v.id <> $4)
            ORDER BY ($3::int IS NOT NULL AND v.classe_id = $3) DESC, v.data DESC, v.id DESC LIMIT 1`,
          [e, id, classe, ignorar]);
        return rows[0] || null;
      };
      const [venda, floresta, empreiteiro] = await Promise.all([
        ultima('valor_tonelada', 'cliente_id', idOuNulo(req.query.cliente_id)),
        ultima('valor_ton_floresta', 'floresta_id', idOuNulo(req.query.floresta_id)),
        ultima('valor_ton_empreiteiro', 'empreiteiro_id', idOuNulo(req.query.empreiteiro_id)),
      ]);
      res.json({ venda, floresta, empreiteiro });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// LISTAR   GET /api/viagens?mes=2026-01&cliente_id=&floresta_id=&empreiteiro_id=&canceladas=true
// Devolve as viagens do mês e os totais (sem as canceladas).
// ---------------------------------------------------------------------
router.get(
  '/',
  [q('mes').optional().matches(/^\d{4}-\d{2}$/).withMessage('Mês inválido (use AAAA-MM).'),
    q('cliente_id').optional({ values: 'falsy' }).isInt(), q('floresta_id').optional({ values: 'falsy' }).isInt(),
    q('empreiteiro_id').optional({ values: 'falsy' }).isInt()],
  validar,
  async (req, res, next) => {
    try {
      const filtros = [
        req.usuario.empresaId,
        req.query.mes || null,
        idOuNulo(req.query.cliente_id),
        idOuNulo(req.query.floresta_id),
        idOuNulo(req.query.empreiteiro_id),
      ];
      const onde = `
        WHERE v.empresa_id = $1
          AND ($2::text IS NULL OR to_char(v.data, 'YYYY-MM') = $2)
          AND ($3::int IS NULL OR v.cliente_id = $3)
          AND ($4::int IS NULL OR v.floresta_id = $4)
          AND ($5::int IS NULL OR v.empreiteiro_id = $5)`;

      const canceladas = req.query.canceladas === 'true';
      const [lista, totais] = await Promise.all([
        query(`${SELECT_VIAGENS} ${onde} ${canceladas ? '' : "AND v.status <> 'Cancelada'"}
               ORDER BY v.data DESC, c.nome, (CASE WHEN v.numero_viagem ~ '^[0-9]+$' THEN v.numero_viagem::int END) DESC NULLS LAST, v.id DESC`,
        filtros),
        query(`SELECT COUNT(*)::int AS viagens,
                      COALESCE(SUM(v.peso_liquido), 0)      AS toneladas,
                      COALESCE(SUM(v.valor_total), 0)       AS valor_total,
                      COALESCE(SUM(v.total_floresta), 0)    AS custo_floresta,
                      COALESCE(SUM(v.total_empreiteiro), 0) AS custo_empreiteiro
                 FROM viagens v ${onde} AND v.status <> 'Cancelada'`, filtros),
      ]);
      res.json({ viagens: lista.rows, totais: totais.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// LANÇAR   POST /api/viagens
// Nº da viagem vazio -> o próximo número do cliente no mês (como na planilha)
// Valores por tonelada (venda, floresta, empreiteiro): informados em cada viagem
// ---------------------------------------------------------------------
router.post('/', podeEditar, regrasViagem, validar, async (req, res, next) => {
  try {
    const b = req.body;
    const invalido = await cadastrosDaEmpresa(req.usuario.empresaId, b);
    if (invalido) return res.status(400).json({ erro: invalido });
    const mot = await motoristaDaCarga(query, req.usuario.empresaId, b);
    if (mot.erro) return res.status(400).json({ erro: mot.erro });

    const { rows } = await query(
      `INSERT INTO viagens (empresa_id, numero_viagem, data, ticket, placa, cliente_id, floresta_id,
                            empreiteiro_id, classe_id, peso_liquido, valor_tonelada, observacoes, criado_por,
                            motorista_id, hora_pesagem, valor_ton_floresta, valor_ton_empreiteiro)
       VALUES ($1,
               COALESCE($2, (SELECT (COALESCE(MAX(numero_viagem::int), 0) + 1)::text
                               FROM viagens
                              WHERE empresa_id = $1 AND cliente_id = $6 AND numero_viagem ~ '^[0-9]+$'
                                AND date_trunc('month', data) = date_trunc('month', $3::date))),
               $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        req.usuario.empresaId, textoOuNulo(b.numero_viagem), b.data, textoOuNulo(b.ticket), textoOuNulo(b.placa),
        b.cliente_id, b.floresta_id, idOuNulo(b.empreiteiro_id), b.classe_id,
        lerNumero(b.peso_liquido), valorOuNulo(b.valor_tonelada), textoOuNulo(b.observacoes), req.usuario.id,
        mot.id, horaOuNula(b.hora_pesagem),
        valorOuNulo(b.valor_ton_floresta), idOuNulo(b.empreiteiro_id) ? valorOuNulo(b.valor_ton_empreiteiro) : null,
      ]
    );
    const nova = await query(`${SELECT_VIAGENS} WHERE v.id = $1`, [rows[0].id]);
    res.status(201).json(nova.rows[0]);
  } catch (err) {
    erroDaViagem(err, res, next);
  }
});

// ---------------------------------------------------------------------
// CORRIGIR   PUT /api/viagens/:id
// Os valores por tonelada (venda, floresta, empreiteiro) são os informados.
// ---------------------------------------------------------------------
router.put('/:id', podeEditar, [param('id').isInt({ min: 1 }), ...regrasViagem], validar, async (req, res, next) => {
  try {
    const b = req.body;
    const atual = await query('SELECT status, motorista_id FROM viagens WHERE id = $1 AND empresa_id = $2', [req.params.id, req.usuario.empresaId]);
    if (!atual.rowCount) return res.status(404).json({ erro: 'Viagem não encontrada.' });
    if (atual.rows[0].status === 'Cancelada') return res.status(400).json({ erro: 'Viagem cancelada não pode ser alterada.' });

    const invalido = await cadastrosDaEmpresa(req.usuario.empresaId, b);
    if (invalido) return res.status(400).json({ erro: invalido });
    const mot = await motoristaDaCarga(query, req.usuario.empresaId, b, atual.rows[0].motorista_id);
    if (mot.erro) return res.status(400).json({ erro: mot.erro });

    await query(
      `UPDATE viagens SET
          numero_viagem = COALESCE($3, numero_viagem), data = $4, ticket = $5, placa = $6,
          cliente_id = $7, floresta_id = $8, empreiteiro_id = $9, classe_id = $10,
          peso_liquido = $11, valor_tonelada = $12, observacoes = $13,
          motorista_id = $14, hora_pesagem = $15,
          valor_ton_floresta = $16, valor_ton_empreiteiro = $17
        WHERE id = $1 AND empresa_id = $2`,
      [
        req.params.id, req.usuario.empresaId, textoOuNulo(b.numero_viagem), b.data, textoOuNulo(b.ticket), textoOuNulo(b.placa),
        b.cliente_id, b.floresta_id, idOuNulo(b.empreiteiro_id), b.classe_id,
        lerNumero(b.peso_liquido), valorOuNulo(b.valor_tonelada), textoOuNulo(b.observacoes),
        mot.id, horaOuNula(b.hora_pesagem),
        valorOuNulo(b.valor_ton_floresta), idOuNulo(b.empreiteiro_id) ? valorOuNulo(b.valor_ton_empreiteiro) : null,
      ]
    );
    const { rows } = await query(`${SELECT_VIAGENS} WHERE v.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    erroDaViagem(err, res, next);
  }
});

// ---------------------------------------------------------------------
// CANCELAR   DELETE /api/viagens/:id   (só Administrador)
// Não apaga: marca como "Cancelada" (sai dos totais e libera o ticket).
// ---------------------------------------------------------------------
router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE viagens SET status = 'Cancelada' WHERE id = $1 AND empresa_id = $2 AND status <> 'Cancelada'`,
      [req.params.id, req.usuario.empresaId]
    );
    if (!rowCount) return res.status(404).json({ erro: 'Viagem não encontrada ou já cancelada.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
