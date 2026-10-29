// USUÁRIOS DA EMPRESA
//   - Cada usuário (qualquer perfil): vê e altera SÓ os próprios dados
//       GET/PUT /api/usuarios/eu          nome, e-mail, telefone (Meu perfil)
//       PUT     /api/usuarios/minha-senha  troca da própria senha
//     Nome, e-mail, telefone e senha são pessoais: ninguém mais altera.
//   - Administrador: lista, cria, troca o perfil, ativa/desativa e gera uma
//     senha PROVISÓRIA para quem esqueceu (a pessoa cria a dela no próximo acesso).
// Usuário não é apagado: é desativado (ativo = false), para manter o histórico.
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, somenteAdmin } = require('../middlewares/auth');
const { telefoneValido, MSG } = require('../utils/documentos');

const router = express.Router();
router.use(autenticar);

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) {
    return res.status(400).json({
      erro: 'Dados inválidos.',
      detalhes: erros.array().map((e) => ({ campo: e.path, mensagem: e.msg })),
    });
  }
  next();
}

const CAMPOS = `u.id, u.nome, u.email, u.ativo, u.ultimo_login, u.perfil_id, p.nome AS perfil`;

// TROCAR A PRÓPRIA SENHA   PUT /api/usuarios/minha-senha   { senha_atual, nova_senha }
router.put(
  '/minha-senha',
  [
    body('senha_atual').notEmpty().withMessage('Informe a senha atual.'),
    body('nova_senha').isLength({ min: 6 }).withMessage('A nova senha precisa ter pelo menos 6 caracteres.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const { rows } = await query('SELECT senha_hash FROM usuarios WHERE id = $1 AND empresa_id = $2',
        [req.usuario.id, req.usuario.empresaId]);
      if (!rows[0] || !(await bcrypt.compare(req.body.senha_atual, rows[0].senha_hash))) {
        return res.status(400).json({ erro: 'A senha atual está incorreta.' });
      }
      const hash = await bcrypt.hash(req.body.nova_senha, 10);
      await query('UPDATE usuarios SET senha_hash = $1, deve_trocar_senha = FALSE, senha_alterada_em = now() WHERE id = $2', [hash, req.usuario.id]);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

// MEU PERFIL   GET /api/usuarios/eu
const CAMPOS_EU = `u.id, u.nome, u.email, u.telefone, p.nome AS perfil, u.ultimo_login, u.senha_alterada_em, u.created_at`;
router.get('/eu', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${CAMPOS_EU} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1 AND u.empresa_id = $2`,
      [req.usuario.id, req.usuario.empresaId]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ALTERAR MEUS DADOS   PUT /api/usuarios/eu   { nome, email, telefone, senha_atual? }
// Trocar o e-mail muda o login: por segurança, pede a senha atual.
router.put(
  '/eu',
  [
    body('nome').trim().notEmpty().withMessage('Informe o seu nome.').isLength({ max: 100 }).withMessage('Nome muito longo.'),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
    body('telefone').optional({ values: 'falsy' }).custom(telefoneValido).withMessage(MSG.telefone),
  ],
  validar,
  async (req, res, next) => {
    try {
      const atual = await query('SELECT email, senha_hash FROM usuarios WHERE id = $1 AND empresa_id = $2', [req.usuario.id, req.usuario.empresaId]);
      if (!atual.rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
      const novoEmail = req.body.email.trim().toLowerCase();
      if (novoEmail !== atual.rows[0].email) {
        if (!req.body.senha_atual) return res.status(400).json({ erro: 'Para trocar o e-mail de login, confirme com a sua senha atual.' });
        if (!(await bcrypt.compare(req.body.senha_atual, atual.rows[0].senha_hash))) {
          return res.status(400).json({ erro: 'A senha atual está incorreta.' });
        }
      }
      const telefone = req.body.telefone ? String(req.body.telefone).replace(/\D/g, '') : null;
      await query('UPDATE usuarios SET nome = $2, email = $3, telefone = $4 WHERE id = $1',
        [req.usuario.id, req.body.nome.trim(), novoEmail, telefone]);
      const { rows } = await query(`SELECT ${CAMPOS_EU} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1`, [req.usuario.id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Já existe outro usuário com este e-mail nesta empresa.' });
      next(err);
    }
  }
);

// Daqui para baixo: só Administrador
router.use(somenteAdmin);

// LISTAR   GET /api/usuarios
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${CAMPOS} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
        WHERE u.empresa_id = $1 ORDER BY u.ativo DESC, u.nome`,
      [req.usuario.empresaId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PERFIS para o <select>   GET /api/usuarios/perfis
router.get('/perfis', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, nome FROM perfis ORDER BY id');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// CRIAR   POST /api/usuarios   { nome, email, perfil_id, senha }
router.post(
  '/',
  [
    body('nome').trim().notEmpty().withMessage('Informe o nome.'),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
    body('perfil_id').isInt({ min: 1 }).withMessage('Escolha o perfil.'),
    body('senha').isLength({ min: 6 }).withMessage('A senha precisa ter pelo menos 6 caracteres.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const hash = await bcrypt.hash(req.body.senha, 10);
      const { rows } = await query(
        `INSERT INTO usuarios (empresa_id, perfil_id, nome, email, senha_hash, deve_trocar_senha)
         VALUES ($1, $2, $3, lower($4), $5, TRUE) RETURNING id`,
        [req.usuario.empresaId, req.body.perfil_id, req.body.nome, req.body.email, hash]
      );
      const novo = await query(`SELECT ${CAMPOS} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1`,
        [rows[0].id]);
      res.status(201).json(novo.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um usuário com este e-mail nesta empresa.' });
      next(err);
    }
  }
);

// EDITAR   PUT /api/usuarios/:id   { perfil_id?, ativo?, senha? }
// Nome e e-mail NÃO entram aqui: são dados pessoais, só o próprio usuário altera (Meu perfil).
// "senha" vira uma senha PROVISÓRIA: a pessoa é obrigada a criar a dela no próximo acesso.
router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }),
    body(['nome', 'email', 'telefone']).not().exists()
      .withMessage('Nome, e-mail e telefone são pessoais: só o próprio usuário altera, em Meu perfil.'),
    body('perfil_id').optional().isInt({ min: 1 }).withMessage('Perfil inválido.'),
    body('ativo').optional().isBoolean().withMessage('Valor inválido para ativo.'),
    body('senha').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('A senha precisa ter pelo menos 6 caracteres.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      // O administrador não pode tirar o próprio acesso (a empresa ficaria sem admin)
      if (id === req.usuario.id) {
        if (req.body.ativo === false) return res.status(400).json({ erro: 'Você não pode desativar o seu próprio usuário.' });
        if (req.body.perfil_id && Number(req.body.perfil_id) !== 1) {
          return res.status(400).json({ erro: 'Você não pode mudar o seu próprio perfil.' });
        }
      }

      if (id === req.usuario.id && req.body.senha) {
        return res.status(400).json({ erro: 'Para trocar a sua própria senha, use Meu perfil.' });
      }
      const hash = req.body.senha ? await bcrypt.hash(req.body.senha, 10) : null;
      const { rowCount } = await query(
        `UPDATE usuarios SET
            perfil_id  = COALESCE($3, perfil_id),
            ativo      = COALESCE($4, ativo),
            senha_hash = COALESCE($5, senha_hash),
            -- senha definida pelo administrador é provisória: a pessoa troca no próximo acesso
            deve_trocar_senha = CASE WHEN $5 IS NULL THEN deve_trocar_senha ELSE TRUE END
          WHERE id = $1 AND empresa_id = $2`,
        [id, req.usuario.empresaId, req.body.perfil_id ?? null, typeof req.body.ativo === 'boolean' ? req.body.ativo : null, hash]
      );
      if (!rowCount) return res.status(404).json({ erro: 'Usuário não encontrado.' });

      const { rows } = await query(`SELECT ${CAMPOS} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1`, [id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um usuário com este e-mail nesta empresa.' });
      next(err);
    }
  }
);

module.exports = router;
