// =====================================================================
// TABELA DE PREÇOS - valor por tonelada, por classe de madeira
//
//   VENDA      -> o que o CLIENTE (serraria) paga     -> ligado a um cliente
//   COMPRA     -> o que se paga à FLORESTA            -> ligado a uma floresta
//   EMPREITADA -> o que se paga ao EMPREITEIRO        -> ligado a um empreiteiro
//
// VIGÊNCIA: preço não é sobrescrito. Ao cadastrar um preço novo para o mesmo
// cliente/floresta/empreiteiro + classe, o anterior é encerrado na véspera.
// Assim as viagens antigas mantêm o preço da época e fica o histórico.
//
// Permissões: Visualização só consulta; Administrador e Financeiro cadastram
// e corrigem valores; só o Administrador exclui.
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { pool, query } = require('../config/db');
const { autenticar, podeEditar } = require('../middlewares/auth');
const { lerNumero, numeroValido } = require('../utils/numeros');

const router = express.Router();
router.use(autenticar);

const TIPOS = {
  VENDA: { coluna: 'cliente_id', tabela: 'clientes', escolha: 'um cliente' },
  COMPRA: { coluna: 'floresta_id', tabela: 'florestas', escolha: 'uma floresta' },
  EMPREITADA: { coluna: 'empreiteiro_id', tabela: 'empreiteiros', escolha: 'um empreiteiro' },
};

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

const SELECT_PRECOS = `
  SELECT tp.id, tp.criado_por, tp.tipo, tp.classe_id, cm.nome AS classe,
         COALESCE(tp.cliente_id, tp.floresta_id, tp.empreiteiro_id) AS alvo_id,
         COALESCE(c.nome, f.nome, e.nome) AS alvo,
         tp.valor_tonelada,
         to_char(tp.data_inicio, 'YYYY-MM-DD') AS data_inicio,
         to_char(tp.data_fim, 'YYYY-MM-DD')    AS data_fim,
         (tp.data_fim IS NULL OR tp.data_fim >= CURRENT_DATE) AS vigente,
         tp.observacao
    FROM tabelas_precos tp
    JOIN classes_madeira cm ON cm.id = tp.classe_id
    LEFT JOIN clientes c     ON c.id = tp.cliente_id
    LEFT JOIN florestas f    ON f.id = tp.floresta_id
    LEFT JOIN empreiteiros e ON e.id = tp.empreiteiro_id`;

// CLASSES DE MADEIRA (para os selects)   GET /api/precos/classes
router.get('/classes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nome, unidade_medida FROM classes_madeira
        WHERE empresa_id = $1 AND ativo
        ORDER BY CASE nome WHEN 'Lixo' THEN 1 WHEN 'Fina' THEN 2 WHEN 'Média' THEN 3 WHEN 'Grossa' THEN 4 ELSE 5 END, nome`,
      [req.usuario.empresaId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// LISTAR   GET /api/precos?tipo=VENDA&todos=true  (por padrão só os vigentes)
router.get(
  '/',
  [q('tipo').optional().isIn(Object.keys(TIPOS)).withMessage('Tipo de preço inválido.')],
  validar,
  async (req, res, next) => {
    try {
      const todos = req.query.todos === 'true';
      const { rows } = await query(
        `${SELECT_PRECOS}
          WHERE tp.empresa_id = $1
            AND ($2::text IS NULL OR tp.tipo = $2)
            AND ($3::boolean OR tp.data_fim IS NULL OR tp.data_fim >= CURRENT_DATE)
          ORDER BY alvo, cm.id, tp.data_inicio DESC`,
        [req.usuario.empresaId, req.query.tipo || null, todos]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

// CRIAR   POST /api/precos   { tipo, alvo_id, classe_id, valor_tonelada, data_inicio, observacao }
router.post(
  '/',
  podeEditar,
  [
    body('tipo').isIn(Object.keys(TIPOS)).withMessage('Escolha o tipo de preço.'),
    body('alvo_id').isInt({ min: 1 }).withMessage('Escolha para quem é o preço.'),
    body('classe_id').isInt({ min: 1 }).withMessage('Escolha a classe de madeira.'),
    body('valor_tonelada').custom(numeroValido(0))
      .withMessage('Informe o valor da tonelada (ex.: 220,00).'),
    body('data_inicio').isISO8601().withMessage('Informe a data de início da vigência.'),
    body('observacao').optional({ values: 'falsy' }).isLength({ max: 500 }),
  ],
  validar,
  async (req, res, next) => {
    const { tipo, alvo_id: alvoId, classe_id: classeId, data_inicio: inicio } = req.body;
    const t = TIPOS[tipo];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // O cliente/floresta/empreiteiro e a classe precisam ser DESTA empresa
      const dono = await client.query(`SELECT 1 FROM ${t.tabela} WHERE id = $1 AND empresa_id = $2`, [alvoId, req.usuario.empresaId]);
      const classe = await client.query('SELECT 1 FROM classes_madeira WHERE id = $1 AND empresa_id = $2', [classeId, req.usuario.empresaId]);
      if (!dono.rowCount || !classe.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ erro: `Escolha ${t.escolha} e uma classe de madeira válidos.` });
      }

      // Mesma "chave": tipo + classe + quem
      const chave = `empresa_id = $1 AND tipo = $2 AND classe_id = $3 AND ${t.coluna} = $4`;
      const params = [req.usuario.empresaId, tipo, classeId, alvoId];

      // Não pode começar dentro (ou antes) de um período que já existe
      const conflito = await client.query(
        `SELECT to_char(data_inicio, 'DD/MM/YYYY') AS ini FROM tabelas_precos
          WHERE ${chave} AND (data_inicio >= $5 OR (data_fim IS NOT NULL AND data_fim >= $5))
          ORDER BY data_inicio DESC LIMIT 1`,
        [...params, inicio]
      );
      if (conflito.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          erro: `Já existe um preço com vigência a partir de ${conflito.rows[0].ini}. `
            + 'Para corrigir o valor, edite esse preço; para um reajuste, use uma data de início posterior.',
        });
      }

      // Encerra o preço em vigor na véspera do novo
      await client.query(
        `UPDATE tabelas_precos SET data_fim = $5::date - 1 WHERE ${chave} AND data_fim IS NULL`,
        [...params, inicio]
      );

      const novo = await client.query(
        `INSERT INTO tabelas_precos (empresa_id, tipo, classe_id, ${t.coluna}, valor_tonelada, data_inicio, observacao, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [...params, lerNumero(req.body.valor_tonelada), inicio, req.body.observacao || null, req.usuario.id]
      );
      await client.query('COMMIT');

      const { rows } = await query(`${SELECT_PRECOS} WHERE tp.id = $1`, [novo.rows[0].id]);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// CORRIGIR VALOR   PUT /api/precos/:id   { valor_tonelada, observacao }
// (corrige um valor digitado errado; para reajuste, cadastre um preço novo)
router.put(
  '/:id',
  podeEditar,
  [
    param('id').isInt({ min: 1 }),
    body('valor_tonelada').custom(numeroValido(0))
      .withMessage('Informe o valor da tonelada (ex.: 220,00).'),
    body('observacao').optional({ values: 'falsy' }).isLength({ max: 500 }),
  ],
  validar,
  async (req, res, next) => {
    try {
      const r = await query(
        `UPDATE tabelas_precos SET valor_tonelada = $3, observacao = $4
          WHERE id = $1 AND empresa_id = $2 RETURNING id`,
        [req.params.id, req.usuario.empresaId, lerNumero(req.body.valor_tonelada), req.body.observacao || null]
      );
      if (!r.rowCount) return res.status(404).json({ erro: 'Preço não encontrado.' });
      const { rows } = await query(`${SELECT_PRECOS} WHERE tp.id = $1`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// EXCLUIR: agora vai para a LIXEIRA (POST /api/lixeira { tipo: 'precos', id, motivo }).
// O antigo DELETE /api/precos/:id apagava de vez e não tinha volta.
router.delete('/:id', (req, res) => res.status(410).json({ erro: 'Use Excluir (com motivo): o preço vai para a lixeira e pode ser restaurado.' }));

module.exports = router;
