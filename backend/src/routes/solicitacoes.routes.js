// SOLICITAÇÃO DE ACESSO - formulário "Quero contratar" da página de venda (index.html)
// Rota PÚBLICA (sem login): qualquer visitante pode enviar.
const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { cnpjValido, telefoneValido, MSG } = require('../utils/documentos');

const router = express.Router();

// O formulário manda valores curtos (ex.: "1-5"); o banco guarda o texto completo.
const FUNCIONARIOS = {
  '1-5': '1 a 5', '6-15': '6 a 15', '16-30': '16 a 30',
  '31-50': '31 a 50', '51-100': '51 a 100', '100+': 'Mais de 100',
};
const FATURAMENTO = {
  'ate-50k': 'Até R$ 50 mil', '50k-100k': 'R$ 50 mil a R$ 100 mil',
  '100k-300k': 'R$ 100 mil a R$ 300 mil', '300k-500k': 'R$ 300 mil a R$ 500 mil',
  '500k-1m': 'R$ 500 mil a R$ 1 milhão', 'acima-1m': 'Acima de R$ 1 milhão',
};
const REGIME = {
  mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido',
  real: 'Lucro Real', outro: 'Outro / Não sei informar',
};

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

// POST /api/solicitacoes
router.post(
  '/',
  [
    body('nome').trim().notEmpty().withMessage('Informe seu nome.').isLength({ max: 150 }),
    body('whatsapp').custom(telefoneValido).withMessage('WhatsApp inválido. Use DDD + número: (49) 99999-9999.'),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
    body('empresa').trim().notEmpty().withMessage('Informe o nome da empresa.').isLength({ max: 150 }),
    body('cnpj').optional({ values: 'falsy' }).custom(cnpjValido).withMessage(MSG.cnpj),
    body('funcionarios').isIn(Object.keys(FUNCIONARIOS)).withMessage('Escolha o número de funcionários.'),
    body('faturamento').isIn(Object.keys(FATURAMENTO)).withMessage('Escolha o faturamento mensal.'),
    body('regime').isIn(Object.keys(REGIME)).withMessage('Escolha o regime fiscal.'),
    body('observacoes').optional().isLength({ max: 2000 }),
  ],
  async (req, res, next) => {
    try {
      const erros = validationResult(req);
      if (!erros.isEmpty()) {
        return res.status(400).json({
          erro: erros.array()[0].msg,
          detalhes: erros.array().map((e) => ({ campo: e.path, mensagem: e.msg })),
        });
      }

      const b = req.body;
      await query(
        `INSERT INTO solicitacoes_acesso
           (nome_completo, whatsapp, email_corporativo, nome_empresa, cnpj,
            numero_funcionarios, faturamento_mensal, regime_fiscal, observacoes)
         VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, $9)`,
        [
          b.nome.trim(), soDigitos(b.whatsapp), b.email.trim(), b.empresa.trim(),
          b.cnpj ? soDigitos(b.cnpj) : null,
          FUNCIONARIOS[b.funcionarios], FATURAMENTO[b.faturamento], REGIME[b.regime],
          b.observacoes ? String(b.observacoes).trim() : null,
        ]
      );
      res.status(201).json({ mensagem: 'Solicitação recebida! Entraremos em contato em breve.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
