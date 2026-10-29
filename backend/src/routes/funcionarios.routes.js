// =====================================================================
// FUNCIONÁRIOS (folha de pagamento) - Administrador e Financeiro
//
//   GET    /api/funcionarios?inativos=true   lista (com as faixas de comissão)
//   POST   /api/funcionarios                 cadastra
//   PUT    /api/funcionarios/:id             altera (inclusive as faixas)
//   DELETE /api/funcionarios/:id             desativa (só Administrador)
//
// Motorista: o campo "motorista" liga o funcionário ao nome que aparece nas
// viagens e fretes (o mesmo cadastro de motoristas do ticket). É por ele que
// a comissão encontra as cargas.
// Faixas: [{ km_ate: 50, valor_tonelada: 1.2 }, ..., { km_ate: null, valor_tonelada: 2 }]
//   km_ate vazio = "acima" (a última faixa). Cada funcionário tem as suas.
//
// Visualização não vê: salário é informação sensível.
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { pool, query } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin } = require('../middlewares/auth');
const { lerNumero } = require('../utils/numeros');
const { idDoMotorista } = require('../utils/motoristas');
const { ordenarFaixas, textoFaixa } = require('../folha/calculo');

const router = express.Router();
router.use(autenticar, podeEditar);

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}
const textoOuNulo = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const valor = (v) => (v === '' || v === null || v === undefined ? 0 : lerNumero(v));

const SELECT = `
  SELECT f.id, f.nome, f.cargo, f.cpf, f.telefone, to_char(f.data_admissao, 'YYYY-MM-DD') AS data_admissao,
         f.salario_base, f.alimentacao, f.observacoes, f.ativo, f.motorista_id, m.nome AS motorista,
         COALESCE((SELECT json_agg(json_build_object('km_ate', cf.km_ate, 'valor_tonelada', cf.valor_tonelada))
                     FROM comissao_faixas cf WHERE cf.funcionario_id = f.id), '[]') AS faixas
    FROM funcionarios f LEFT JOIN motoristas m ON m.id = f.motorista_id`;

const comTexto = (f) => {
  const faixas = ordenarFaixas(f.faixas);
  return { ...f, faixas: faixas.map((x) => ({ ...x, texto: textoFaixa(faixas, x) })) };
};

// Confere e organiza as faixas digitadas
function lerFaixas(lista) {
  if (lista === undefined) return { faixas: null };
  if (!Array.isArray(lista)) return { erro: 'Faixas de comissão inválidas.' };
  const faixas = lista
    .filter((f) => f && !(String(f.valor_tonelada ?? '').trim() === '' && String(f.km_ate ?? '').trim() === ''))
    .map((f) => ({
      km_ate: f.km_ate === null || f.km_ate === undefined || String(f.km_ate).trim() === '' ? null : lerNumero(f.km_ate),
      valor_tonelada: lerNumero(f.valor_tonelada),
    }));
  for (const f of faixas) {
    if (f.km_ate !== null && (!Number.isFinite(f.km_ate) || f.km_ate <= 0)) return { erro: 'Nas faixas, o "até km" precisa ser um número maior que zero.' };
    if (!Number.isFinite(f.valor_tonelada) || f.valor_tonelada < 0) return { erro: 'Informe o R$ por tonelada de cada faixa.' };
  }
  if (faixas.filter((f) => f.km_ate === null).length > 1) return { erro: 'Só pode haver uma faixa "acima" (sem limite de km).' };
  const kms = faixas.filter((f) => f.km_ate !== null).map((f) => f.km_ate);
  if (new Set(kms).size !== kms.length) return { erro: 'Há duas faixas com o mesmo limite de km.' };
  return { faixas: ordenarFaixas(faixas) };
}

const regras = [
  body('nome').isString().trim().isLength({ min: 2, max: 150 }).withMessage('Informe o nome do funcionário.'),
  body('cargo').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Informe o cargo.'),
  body('data_admissao').optional({ values: 'falsy' }).isISO8601().withMessage('Data de admissão inválida.'),
  body('salario_base').optional({ values: 'falsy' }).custom((v) => Number.isFinite(lerNumero(v)) && lerNumero(v) >= 0).withMessage('Salário inválido.'),
  body('alimentacao').optional({ values: 'falsy' }).custom((v) => Number.isFinite(lerNumero(v)) && lerNumero(v) >= 0).withMessage('Alimentação inválida.'),
  body('cpf').optional({ values: 'falsy' }).custom((v) => /^\d{11}$/.test(String(v).replace(/\D/g, ''))).withMessage('CPF precisa ter 11 números.'),
  body('motorista').optional({ values: 'falsy' }).isString().isLength({ max: 150 }),
];

router.get('/', [q('inativos').optional().isIn(['true', 'false'])], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const [lista, livres] = await Promise.all([
      query(`${SELECT} WHERE f.empresa_id = $1 ${req.query.inativos === 'true' ? '' : 'AND f.ativo'} ORDER BY f.ativo DESC, f.nome`, [e]),
      // motoristas que aparecem nas cargas mas ainda não são funcionários
      query(`SELECT m.id, m.nome,
                    (SELECT count(*) FROM viagens v WHERE v.motorista_id = m.id AND v.status <> 'Cancelada')
                  + (SELECT count(*) FROM fretes fr WHERE fr.motorista_id = m.id AND fr.status_pagamento <> 'Cancelado') AS cargas
               FROM motoristas m
              WHERE m.empresa_id = $1 AND m.ativo AND NOT EXISTS (SELECT 1 FROM funcionarios f WHERE f.motorista_id = m.id)
              ORDER BY m.nome`, [e]),
    ]);
    res.json({ funcionarios: lista.rows.map(comTexto), motoristas_livres: livres.rows.map((m) => ({ ...m, cargas: Number(m.cargas) })) });
  } catch (err) {
    next(err);
  }
});

async function salvar(req, res, next, id = null) {
  const b = req.body;
  const { faixas, erro } = lerFaixas(b.faixas);
  if (erro) return res.status(400).json({ erro });
  const e = req.usuario.empresaId;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (id) {
      const atual = await c.query('SELECT 1 FROM funcionarios WHERE id = $1 AND empresa_id = $2', [id, e]);
      if (!atual.rowCount) { await c.query('ROLLBACK'); return res.status(404).json({ erro: 'Funcionário não encontrado.' }); }
    }
    const motoristaId = textoOuNulo(b.motorista) ? await idDoMotorista((s, p) => c.query(s, p), e, b.motorista) : null;
    if (motoristaId) {
      const outro = await c.query('SELECT nome FROM funcionarios WHERE motorista_id = $1 AND id <> COALESCE($2, 0)', [motoristaId, id]);
      if (outro.rowCount) {
        await c.query('ROLLBACK');
        return res.status(409).json({ erro: `O motorista "${b.motorista.trim()}" já está ligado ao funcionário ${outro.rows[0].nome}. Edite o cadastro dele em vez de criar outro.` });
      }
    }
    const valores = [e, b.nome.trim(), b.cargo.trim(), b.cpf ? String(b.cpf).replace(/\D/g, '') : null, textoOuNulo(b.telefone)?.replace(/\D/g, '') || null,
      b.data_admissao || null, valor(b.salario_base), valor(b.alimentacao), textoOuNulo(b.observacoes), motoristaId];
    let novoId = id;
    if (id) {
      await c.query(
        `UPDATE funcionarios SET nome = $2, cargo = $3, cpf = $4, telefone = $5, data_admissao = $6, salario_base = $7,
                alimentacao = $8, observacoes = $9, motorista_id = $10, ativo = COALESCE($11, ativo)
          WHERE id = $12 AND empresa_id = $1`,
        [...valores, typeof b.ativo === 'boolean' ? b.ativo : null, id]);
    } else {
      const r = await c.query(
        `INSERT INTO funcionarios (empresa_id, nome, cargo, cpf, telefone, data_admissao, salario_base, alimentacao, observacoes, motorista_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, valores);
      novoId = r.rows[0].id;
    }
    if (faixas) {
      await c.query('DELETE FROM comissao_faixas WHERE funcionario_id = $1', [novoId]);
      for (const f of faixas) {
        await c.query('INSERT INTO comissao_faixas (empresa_id, funcionario_id, km_ate, valor_tonelada) VALUES ($1, $2, $3, $4)',
          [e, novoId, f.km_ate, f.valor_tonelada]);
      }
    }
    await c.query('COMMIT');
    const { rows } = await query(`${SELECT} WHERE f.id = $1`, [novoId]);
    res.status(id ? 200 : 201).json(comTexto(rows[0]));
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    c.release();
  }
}

router.post('/', regras, validar, (req, res, next) => salvar(req, res, next));
router.put('/:id', [param('id').isInt({ min: 1 }), ...regras], validar, (req, res, next) => salvar(req, res, next, Number(req.params.id)));

router.delete('/:id', somenteAdmin, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query('UPDATE funcionarios SET ativo = FALSE WHERE id = $1 AND empresa_id = $2', [req.params.id, req.usuario.empresaId]);
    if (!rowCount) return res.status(404).json({ erro: 'Funcionário não encontrado.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
