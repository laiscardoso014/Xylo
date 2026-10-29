// =====================================================================
// ROTAS E DISTÂNCIAS (para a comissão dos motoristas)
//
//   GET    /api/rotas            rotas cadastradas + PENDENTES (usadas nas cargas e sem km)
//   POST   /api/rotas            { tipo: 'viagem', floresta_id, cliente_id, km }
//                                { tipo: 'frete', cliente_id, destino, km }
//   PUT    /api/rotas/:id        { km, observacao }
//   DELETE /api/rotas/:id
//   PUT    /api/rotas/carga      { tipo: 'viagem'|'frete', id, km }  corrige o km SÓ nesta carga
//                                (km vazio = volta a usar o da rota)
//
// Viagem: floresta -> cliente. Frete: cliente -> destino (o destino é
// comparado sem diferenciar maiúsculas e espaços).
// =====================================================================
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, podeEditar } = require('../middlewares/auth');
const { lerNumero } = require('../utils/numeros');

const router = express.Router();
router.use(autenticar, podeEditar);

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}
const kmValido = (v) => Number.isFinite(lerNumero(v)) && lerNumero(v) > 0 && lerNumero(v) < 5000;

router.get('/', async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const [rotas, pendViagens, pendFretes] = await Promise.all([
      query(`SELECT r.id, r.tipo, r.floresta_id, f.nome AS floresta, r.cliente_id, c.nome AS cliente, r.destino, r.km, r.observacao,
                    CASE r.tipo
                      WHEN 'viagem' THEN (SELECT count(*) FROM viagens v WHERE v.empresa_id = r.empresa_id AND v.floresta_id = r.floresta_id
                                            AND v.cliente_id = r.cliente_id AND v.status <> 'Cancelada')
                      ELSE (SELECT count(*) FROM fretes fr WHERE fr.empresa_id = r.empresa_id AND fr.cliente_id = r.cliente_id
                              AND upper(btrim(coalesce(fr.destino, ''))) = r.destino_chave AND fr.status_pagamento <> 'Cancelado')
                    END AS cargas
               FROM rotas r JOIN clientes c ON c.id = r.cliente_id LEFT JOIN florestas f ON f.id = r.floresta_id
              WHERE r.empresa_id = $1 ORDER BY r.tipo DESC, f.nome NULLS LAST, c.nome, r.destino`, [e]),
      // Rotas usadas nas viagens (últimos 12 meses) sem km
      query(`SELECT 'viagem' AS tipo, v.floresta_id, f.nome AS floresta, v.cliente_id, c.nome AS cliente, NULL AS destino,
                    count(*) AS cargas, count(*) FILTER (WHERE v.motorista_id IS NOT NULL) AS com_motorista,
                    to_char(max(v.data), 'YYYY-MM-DD') AS ultima
               FROM viagens v JOIN florestas f ON f.id = v.floresta_id JOIN clientes c ON c.id = v.cliente_id
              WHERE v.empresa_id = $1 AND v.status <> 'Cancelada' AND v.data >= current_date - 365
                AND NOT EXISTS (SELECT 1 FROM rotas r WHERE r.empresa_id = v.empresa_id AND r.tipo = 'viagem'
                                  AND r.floresta_id = v.floresta_id AND r.cliente_id = v.cliente_id)
              GROUP BY v.floresta_id, f.nome, v.cliente_id, c.nome`, [e]),
      query(`SELECT 'frete' AS tipo, NULL AS floresta_id, NULL AS floresta, fr.cliente_id, c.nome AS cliente,
                    min(fr.destino) AS destino, count(*) AS cargas, count(*) FILTER (WHERE fr.motorista_id IS NOT NULL) AS com_motorista,
                    to_char(max(fr.data), 'YYYY-MM-DD') AS ultima
               FROM fretes fr JOIN clientes c ON c.id = fr.cliente_id
              WHERE fr.empresa_id = $1 AND fr.status_pagamento <> 'Cancelado' AND fr.data >= current_date - 365
                AND NOT EXISTS (SELECT 1 FROM rotas r WHERE r.empresa_id = fr.empresa_id AND r.tipo = 'frete'
                                  AND r.cliente_id = fr.cliente_id AND r.destino_chave = upper(btrim(coalesce(fr.destino, ''))))
              GROUP BY fr.cliente_id, c.nome, upper(btrim(coalesce(fr.destino, '')))`, [e]),
    ]);
    const n = (r) => ({ ...r, cargas: Number(r.cargas), com_motorista: r.com_motorista !== undefined ? Number(r.com_motorista) : undefined });
    res.json({
      rotas: rotas.rows.map(n),
      // as que têm motorista (afetam comissão) primeiro, depois as mais usadas
      pendentes: [...pendViagens.rows, ...pendFretes.rows].map(n).sort((a, b) => b.com_motorista - a.com_motorista || b.cargas - a.cargas),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  [body('tipo').isIn(['viagem', 'frete']).withMessage('Tipo de rota inválido.'),
    body('cliente_id').isInt({ min: 1 }).withMessage('Escolha o cliente.'),
    body('floresta_id').if(body('tipo').equals('viagem')).isInt({ min: 1 }).withMessage('Escolha a floresta.'),
    body('destino').optional({ values: 'null' }).isString().isLength({ max: 100 }),
    body('km').custom(kmValido).withMessage('Informe a distância em km (ex.: 85).')],
  validar,
  async (req, res, next) => {
    try {
      const e = req.usuario.empresaId;
      const b = req.body;
      const dono = await query(
        `SELECT (SELECT count(*) FROM clientes WHERE id = $2 AND empresa_id = $1) AS c,
                ($3::int IS NULL OR EXISTS (SELECT 1 FROM florestas WHERE id = $3 AND empresa_id = $1)) AS f`,
        [e, b.cliente_id, b.tipo === 'viagem' ? b.floresta_id : null]);
      if (Number(dono.rows[0].c) !== 1 || !dono.rows[0].f) return res.status(400).json({ erro: 'Cliente ou floresta inválidos.' });
      const { rows } = await query(
        `INSERT INTO rotas (empresa_id, tipo, floresta_id, cliente_id, destino, km, observacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [e, b.tipo, b.tipo === 'viagem' ? b.floresta_id : null, b.cliente_id,
          b.tipo === 'frete' && typeof b.destino === 'string' && b.destino.trim() ? b.destino.trim() : null,
          lerNumero(b.km), typeof b.observacao === 'string' && b.observacao.trim() ? b.observacao.trim() : null]);
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Esta rota já está cadastrada: altere o km dela na lista.' });
      next(err);
    }
  }
);

// Corrigir o km só numa carga (ex.: desvio, entrega em outro pátio)
router.put(
  '/carga',
  [body('tipo').isIn(['viagem', 'frete']), body('id').isInt({ min: 1 }),
    body('km').optional({ values: 'null' }).custom((v) => v === '' || kmValido(v)).withMessage('Distância inválida.')],
  validar,
  async (req, res, next) => {
    try {
      const tabela = req.body.tipo === 'viagem' ? 'viagens' : 'fretes';
      const km = req.body.km === '' || req.body.km === null || req.body.km === undefined ? null : lerNumero(req.body.km);
      // não mexe em carga de folha já fechada
      const fechada = await query(
        `SELECT 1 FROM ${tabela} x JOIN funcionarios f ON f.motorista_id = x.motorista_id
                JOIN folhas fo ON fo.funcionario_id = f.id AND fo.competencia = to_char(x.data, 'YYYY-MM') AND fo.status <> 'Aberta'
          WHERE x.id = $1 AND x.empresa_id = $2 LIMIT 1`, [req.body.id, req.usuario.empresaId]);
      if (fechada.rowCount) return res.status(409).json({ erro: 'A folha deste mês já foi fechada: reabra a folha para corrigir o km.' });
      const r = await query(`UPDATE ${tabela} SET km = $3 WHERE id = $1 AND empresa_id = $2`, [req.body.id, req.usuario.empresaId, km]);
      if (!r.rowCount) return res.status(404).json({ erro: 'Carga não encontrada.' });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.put('/:id', [param('id').isInt({ min: 1 }), body('km').custom(kmValido).withMessage('Informe a distância em km (ex.: 85).')], validar, async (req, res, next) => {
  try {
    const r = await query('UPDATE rotas SET km = $3, observacao = $4 WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.usuario.empresaId, lerNumero(req.body.km),
        typeof req.body.observacao === 'string' && req.body.observacao.trim() ? req.body.observacao.trim() : null]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Rota não encontrada.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const r = await query('DELETE FROM rotas WHERE id = $1 AND empresa_id = $2', [req.params.id, req.usuario.empresaId]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Rota não encontrada.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
