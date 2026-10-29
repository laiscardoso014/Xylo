// =====================================================================
// FINANCEIRO - mensalidade do Xylo vista pela empresa  (/api/faturas)
// Só o Administrador da empresa.
//
//   GET  /api/faturas                 faturas da empresa + resumo
//   GET  /api/faturas/:id             uma fatura (PIX copia e cola, recebedor)
//   POST /api/faturas/:id/informar    "Já paguei" (avisa a CTech para dar baixa)
// =====================================================================
const express = require('express');
const { param, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, somenteAdmin } = require('../middlewares/auth');
const F = require('../faturas/faturas');

const router = express.Router();
router.use(autenticar, somenteAdmin);

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: 'Fatura inválida.' });
  next();
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${F.CAMPOS} FROM faturas f JOIN empresas e ON e.id = f.empresa_id
        WHERE f.empresa_id = $1 AND f.status <> 'Cancelada'
        ORDER BY f.competencia DESC, f.id DESC`, [req.usuario.empresaId]);
    const plano = (await query(
      'SELECT mensalidade::float AS mensalidade, dia_vencimento FROM empresas WHERE id = $1', [req.usuario.empresaId])).rows[0];
    const cfg = await F.lerConfig();
    const pendentes = rows.filter((f) => f.situacao === 'Aberta' || f.situacao === 'Vencida');
    res.json({
      faturas: rows,
      plano,
      contato: { email: cfg.email_contato || null, whatsapp: cfg.whatsapp || null },
      resumo: {
        em_aberto: Math.round(pendentes.reduce((t, f) => t + f.valor, 0) * 100) / 100,
        vencidas: rows.filter((f) => f.situacao === 'Vencida').length,
        proxima: pendentes.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

const buscar = async (id, empresaId) => (await query(
  `SELECT ${F.CAMPOS}, f.pix_copia_cola, f.recebedor, e.razao_social, e.email AS empresa_email, e.cidade AS empresa_cidade, e.uf AS empresa_uf
     FROM faturas f JOIN empresas e ON e.id = f.empresa_id
    WHERE f.id = $1 AND f.empresa_id = $2 AND f.status <> 'Cancelada'`, [id, empresaId])).rows[0];

router.get('/:id', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const f = await buscar(req.params.id, req.usuario.empresaId);
    if (!f) return res.status(404).json({ erro: 'Fatura não encontrada.' });
    res.json(f);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/informar', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE faturas SET informado_em = now(), informado_por = $3, updated_at = now()
        WHERE id = $1 AND empresa_id = $2 AND status = 'Aberta'`, [req.params.id, req.usuario.empresaId, req.usuario.id]);
    if (!rowCount) return res.status(409).json({ erro: 'Esta fatura não está em aberto.' });
    res.json(await buscar(req.params.id, req.usuario.empresaId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
