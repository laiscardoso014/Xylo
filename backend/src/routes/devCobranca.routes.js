// =====================================================================
// COBRANÇA DA MENSALIDADE - painel do desenvolvedor  (/api/dev/cobranca/...)
// (o login do painel é conferido no dev.routes.js antes de chegar aqui)
//
//   GET  /config                    dados de quem recebe (chave PIX etc.)
//   PUT  /config
//   PUT  /empresas/:id              mensalidade, dia de vencimento, cobrar desde
//   GET  /faturas?mes=&situacao=    faturas + totais do mês
//   GET  /faturas/:id               uma fatura (para abrir/imprimir)
//   POST /gerar { mes, empresa_id?, valor?, descricao? }   gera as do mês
//   POST /faturas/:id/pagar { pago_em, valor_pago, obs }   dar baixa
//   POST /faturas/:id/desfazer-pagamento
//   POST /faturas/:id/cancelar { motivo }
//   POST /faturas/:id/email         manda de novo o e-mail da fatura
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { normalizarChave } = require('../faturas/pix');
const F = require('../faturas/faturas');

const router = express.Router();

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const idValido = [param('id').isInt({ min: 1 })];

// ---- Dados para receber ---------------------------------------------------
router.get('/config', async (req, res, next) => {
  try {
    const cfg = await F.lerConfig();
    res.json({ ...cfg, falta: F.faltaNaConfig(cfg) });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/config',
  [
    body('recebedor_nome').trim().notEmpty().withMessage('Informe o nome de quem recebe.').isLength({ max: 100 }),
    body('cidade').trim().notEmpty().withMessage('Informe a cidade.').isLength({ max: 60 }),
    body('recebedor_doc').optional({ values: 'falsy' }).customSanitizer(soDigitos)
      .custom((v) => v.length === 11 || v.length === 14).withMessage('CPF/CNPJ de quem recebe: 11 ou 14 números.'),
    body('email_contato').optional({ values: 'falsy' }).isEmail().withMessage('E-mail de contato inválido.'),
    body('whatsapp').optional({ values: 'falsy' }).isLength({ max: 20 }),
    body('instrucoes').optional({ values: 'falsy' }).isLength({ max: 300 }).withMessage('Instruções: até 300 caracteres.'),
    body('gerar_automatico').optional().isBoolean(),
    body('dia_geracao').optional().isInt({ min: 1, max: 28 }).withMessage('Dia de geração: 1 a 28.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      let chave;
      try {
        chave = normalizarChave(req.body.chave_pix);
      } catch (e) {
        return res.status(400).json({ erro: e.message });
      }
      const b = req.body;
      await query(
        `UPDATE cobranca_config SET chave_pix = $1, tipo_chave = $2, recebedor_nome = $3, recebedor_doc = $4, cidade = $5,
                email_contato = lower($6), whatsapp = $7, instrucoes = $8, gerar_automatico = $9, dia_geracao = $10, updated_at = now()
          WHERE id = 1`,
        [chave.chave, chave.tipo, b.recebedor_nome.trim(), b.recebedor_doc || null, b.cidade.trim(), b.email_contato || null,
          b.whatsapp ? soDigitos(b.whatsapp) : null, b.instrucoes || null, b.gerar_automatico === true, Number(b.dia_geracao) || 1]);
      const cfg = await F.lerConfig();
      // ligou o automático: já confere se o mês atual precisa ser gerado
      if (cfg.gerar_automatico) F.gerarAutomatico();
      res.json({ ...cfg, falta: F.faltaNaConfig(cfg) });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Plano de uma empresa ---------------------------------------------------
router.put(
  '/empresas/:id',
  [
    ...idValido,
    body('mensalidade').optional({ nullable: true, values: 'falsy' }).isFloat({ min: 0, max: 100000 }).withMessage('Mensalidade inválida.'),
    body('dia_vencimento').isInt({ min: 1, max: 28 }).withMessage('Dia de vencimento: 1 a 28.'),
    body('cobrar_desde').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}$/).withMessage('"Cobrar a partir de" inválido.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const valor = req.body.mensalidade ? Number(req.body.mensalidade) : null;
      const { rows } = await query(
        `UPDATE empresas SET mensalidade = $2, dia_vencimento = $3, cobrar_desde = $4
          WHERE id = $1 RETURNING id, nome, mensalidade::float AS mensalidade, dia_vencimento, to_char(cobrar_desde, 'YYYY-MM') AS cobrar_desde`,
        [req.params.id, valor, req.body.dia_vencimento, req.body.cobrar_desde ? `${req.body.cobrar_desde}-01` : null]);
      if (!rows[0]) return res.status(404).json({ erro: 'Empresa não encontrada.' });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Faturas ----------------------------------------------------------------
router.get('/faturas', [q('mes').optional().matches(/^\d{4}-\d{2}$/)], validar, async (req, res, next) => {
  try {
    const mes = req.query.mes ? F.competenciaISO(req.query.mes) : null;
    const { rows } = await query(
      `SELECT ${F.CAMPOS} FROM faturas f JOIN empresas e ON e.id = f.empresa_id
        WHERE ($1::date IS NULL OR f.competencia = $1)
        ORDER BY f.competencia DESC, e.nome, f.id DESC`, [mes]);
    const conta = (s) => rows.filter((f) => f.situacao === s);
    const soma = (l, campo = 'valor') => Math.round(l.reduce((t, f) => t + Number(f[campo] || 0), 0) * 100) / 100;
    // empresas com mensalidade que ainda não têm fatura neste mês
    const faltam = mes ? (await query(
      `SELECT e.id, e.nome, e.mensalidade::float AS mensalidade FROM empresas e
        WHERE e.ativo AND COALESCE(e.mensalidade, 0) > 0 AND (e.cobrar_desde IS NULL OR e.cobrar_desde <= $1)
          AND NOT EXISTS (SELECT 1 FROM faturas f WHERE f.empresa_id = e.id AND f.competencia = $1 AND f.status <> 'Cancelada')
        ORDER BY e.nome`, [mes])).rows : [];
    // vencidas de qualquer mês (para cobrar)
    const vencidas = (await query(
      `SELECT COUNT(*)::int AS qtd, COALESCE(SUM(valor), 0)::float AS total FROM faturas
        WHERE status = 'Aberta' AND vencimento < current_date`)).rows[0];
    res.json({
      faturas: rows,
      totais: {
        emitido: soma(rows.filter((f) => f.status !== 'Cancelada')),
        recebido: soma(conta('Paga'), 'valor_pago'),
        aberto: soma(conta('Aberta')),
        vencido: soma(conta('Vencida')),
        qtd: { abertas: conta('Aberta').length, vencidas: conta('Vencida').length, pagas: conta('Paga').length, canceladas: conta('Cancelada').length },
      },
      faltam,
      vencidas_geral: vencidas,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/faturas/:id', idValido, validar, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${F.CAMPOS}, f.pix_copia_cola, f.recebedor, e.razao_social, e.email AS empresa_email, e.cidade AS empresa_cidade, e.uf AS empresa_uf
         FROM faturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Fatura não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/gerar',
  [
    body('mes').matches(/^\d{4}-\d{2}$/).withMessage('Escolha o mês.'),
    body('empresa_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
    body('valor').optional({ values: 'falsy' }).isFloat({ min: 0.01, max: 100000 }).withMessage('Valor inválido.'),
    body('descricao').optional({ values: 'falsy' }).isLength({ max: 150 }),
    body('enviar_email').optional().isBoolean(),
  ],
  validar,
  async (req, res, next) => {
    try {
      const r = await F.gerarDoMes(req.body.mes, {
        empresaId: req.body.empresa_id ? Number(req.body.empresa_id) : null,
        valor: req.body.valor ? Number(req.body.valor) : null,
        descricao: req.body.descricao || null,
      });
      // e-mails depois de gravar (falha no e-mail não desfaz as faturas)
      const emails = { enviados: 0, falhas: [], modo_teste: false };
      if (req.body.enviar_email !== false) {
        for (const f of r.criadas) {
          const e = await F.enviarFaturaPorEmail(f.id);
          emails.enviados += e.enviados.length;
          if (e.modo_teste) emails.modo_teste = true;
          if (e.erro) emails.falhas.push(`${f.empresa}: ${e.erro}`);
        }
      }
      res.status(r.criadas.length ? 201 : 200).json({ ...r, emails });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  }
);

// carrega a fatura e confere se a ação cabe na situação dela
async function faturaPara(req, res, permitidas, acao) {
  const f = (await query('SELECT id, status FROM faturas WHERE id = $1', [req.params.id])).rows[0];
  if (!f) { res.status(404).json({ erro: 'Fatura não encontrada.' }); return null; }
  if (!permitidas.includes(f.status)) { res.status(409).json({ erro: `Não dá para ${acao} uma fatura ${f.status.toLowerCase()}.` }); return null; }
  return f;
}
const devolver = async (res, id) => res.json((await query(`SELECT ${F.CAMPOS} FROM faturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = $1`, [id])).rows[0]);

router.post(
  '/faturas/:id/pagar',
  [...idValido,
    body('pago_em').isISO8601().withMessage('Informe a data do pagamento.'),
    body('valor_pago').isFloat({ min: 0.01 }).withMessage('Informe o valor recebido.'),
    body('obs').optional({ values: 'falsy' }).isLength({ max: 200 })],
  validar,
  async (req, res, next) => {
    try {
      if (!(await faturaPara(req, res, ['Aberta'], 'dar baixa em'))) return;
      if (new Date(req.body.pago_em) > new Date(Date.now() + 86400e3)) return res.status(400).json({ erro: 'A data do pagamento não pode ser no futuro.' });
      await query(`UPDATE faturas SET status = 'Paga', pago_em = $2, valor_pago = $3, obs_pagamento = $4, updated_at = now() WHERE id = $1`,
        [req.params.id, req.body.pago_em.slice(0, 10), Number(req.body.valor_pago), req.body.obs || null]);
      await devolver(res, req.params.id);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/faturas/:id/desfazer-pagamento', idValido, validar, async (req, res, next) => {
  try {
    if (!(await faturaPara(req, res, ['Paga'], 'desfazer o pagamento de'))) return;
    await query(`UPDATE faturas SET status = 'Aberta', pago_em = NULL, valor_pago = NULL, obs_pagamento = NULL, updated_at = now() WHERE id = $1`, [req.params.id]);
    await devolver(res, req.params.id);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/faturas/:id/cancelar',
  [...idValido, body('motivo').trim().notEmpty().withMessage('Informe o motivo do cancelamento.').isLength({ max: 200 })],
  validar,
  async (req, res, next) => {
    try {
      if (!(await faturaPara(req, res, ['Aberta'], 'cancelar'))) return;
      await query(`UPDATE faturas SET status = 'Cancelada', cancelada_motivo = $2, updated_at = now() WHERE id = $1`, [req.params.id, req.body.motivo]);
      await devolver(res, req.params.id);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/faturas/:id/email', idValido, validar, async (req, res, next) => {
  try {
    if (!(await faturaPara(req, res, ['Aberta'], 'reenviar'))) return;
    res.json(await F.enviarFaturaPorEmail(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
