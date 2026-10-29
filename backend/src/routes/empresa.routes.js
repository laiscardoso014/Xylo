// =====================================================================
// DADOS DA EMPRESA (a empresa de quem está logado)
//
//   GET    /api/empresa        todos os perfis: nome, razão social, CNPJ, contato, endereço e logo
//   PUT    /api/empresa        só Administrador: altera os dados (o CNPJ não muda: é a chave do login)
//   PUT    /api/empresa/logo   só Administrador: { logo: "data:image/png;base64,..." }
//   DELETE /api/empresa/logo   só Administrador: tira a logo
//
// A logo aparece no topo do sistema e no cabeçalho dos relatórios impressos/PDF.
// =====================================================================
const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, somenteAdmin } = require('../middlewares/auth');
const { telefoneValido, MSG } = require('../utils/documentos');

const router = express.Router();
router.use(autenticar);

const LOGO_MAX_BYTES = 512 * 1024;
const CAMPOS = 'id, nome, razao_social, cnpj, email, telefone, endereco, cidade, uf, logo';

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

// Confere se o arquivo é mesmo uma imagem PNG, JPEG ou WEBP (pelos primeiros bytes,
// não só pelo nome) e se cabe no limite.
function conferirLogo(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m) return 'Envie uma imagem PNG, JPG ou WEBP.';
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) return 'A imagem está vazia.';
  if (bytes.length > LOGO_MAX_BYTES) return 'A logo precisa ter no máximo 512 KB.';
  const assinatura = {
    png: bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    webp: bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
  };
  return assinatura[m[1]] ? null : 'O arquivo não é uma imagem válida.';
}

// ---------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${CAMPOS} FROM empresas WHERE id = $1`, [req.usuario.empresaId]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put(
  '/',
  somenteAdmin,
  [
    body('nome').trim().notEmpty().withMessage('Informe o nome da empresa.').isLength({ max: 150 }).withMessage('Nome muito longo.'),
    body('razao_social').optional({ values: 'falsy' }).isLength({ max: 150 }).withMessage('Razão social muito longa.'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('E-mail inválido.'),
    body('telefone').optional({ values: 'falsy' }).custom(telefoneValido).withMessage(MSG.telefone),
    body('endereco').optional({ values: 'falsy' }).isLength({ max: 200 }).withMessage('Endereço muito longo.'),
    body('cidade').optional({ values: 'falsy' }).isLength({ max: 100 }).withMessage('Cidade muito longa.'),
    body('uf').optional({ values: 'falsy' }).trim().isLength({ min: 2, max: 2 }).withMessage('Use a sigla do estado (ex.: SC).'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const b = req.body;
      const { rows } = await query(
        `UPDATE empresas SET nome = $2, razao_social = $3, email = lower($4), telefone = $5,
                endereco = $6, cidade = $7, uf = upper($8)
          WHERE id = $1 RETURNING ${CAMPOS}`,
        [req.usuario.empresaId, b.nome.trim(), textoOuNulo(b.razao_social), textoOuNulo(b.email),
          textoOuNulo(b.telefone) && b.telefone.replace(/\D/g, ''), textoOuNulo(b.endereco), textoOuNulo(b.cidade), textoOuNulo(b.uf)]
      );
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.put('/logo', somenteAdmin, async (req, res, next) => {
  try {
    const problema = conferirLogo(req.body && req.body.logo);
    if (problema) return res.status(400).json({ erro: problema });
    const { rows } = await query(`UPDATE empresas SET logo = $2 WHERE id = $1 RETURNING ${CAMPOS}`, [req.usuario.empresaId, req.body.logo]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/logo', somenteAdmin, async (req, res, next) => {
  try {
    await query('UPDATE empresas SET logo = NULL WHERE id = $1', [req.usuario.empresaId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
