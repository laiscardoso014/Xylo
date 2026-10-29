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
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, somenteAdmin } = require('../middlewares/auth');
const { telefoneValido, MSG } = require('../utils/documentos');
const { conferirEmail } = require('../conta/conferirEmail');
const { enviarLink } = require('../conta/emails');

// Dados para o texto do e-mail (nome da empresa, perfil, quem convidou)
async function dadosDoConvite(usuarioId, quemConvidouId) {
  const { rows } = await query(
    `SELECT u.nome, u.email, p.nome AS perfil, e.nome AS empresa, (SELECT nome FROM usuarios WHERE id = $2) AS quem
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1`, [usuarioId, quemConvidouId]);
  const r = rows[0];
  return { para: r.email, d: { nome: r.nome, empresa: r.empresa, perfil: r.perfil, quemCriou: r.quem } };
}

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

const CAMPOS = `u.id, u.nome, u.email, u.ativo, u.ultimo_login, u.perfil_id, p.nome AS perfil,
  (u.email_confirmado_em IS NOT NULL) AS email_confirmado,
  (SELECT max(t.created_at) FROM tokens_conta t WHERE t.usuario_id = u.id AND t.tipo = 'convite') AS convite_enviado_em`;

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
const CAMPOS_EU = `u.id, u.nome, u.email, u.telefone, p.nome AS perfil, u.ultimo_login, u.senha_alterada_em, u.created_at,
  (SELECT t.email_novo FROM tokens_conta t WHERE t.usuario_id = u.id AND t.tipo = 'troca_email' AND t.usado_em IS NULL
      AND t.expira_em > now() ORDER BY t.id DESC LIMIT 1) AS email_pendente`;
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
// Trocar o e-mail muda o login: por segurança, pede a senha atual E manda um
// link para o e-mail NOVO; o login só muda quando a pessoa confirmar.
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
      let confirmacao = null;
      if (novoEmail !== atual.rows[0].email) {
        const conf = await conferirEmail(novoEmail);
        if (!conf.ok) return res.status(400).json({ erro: conf.motivo, sugestao: conf.sugestao });
        const outro = await query('SELECT 1 FROM usuarios WHERE empresa_id = $1 AND lower(email) = $2 AND id <> $3', [req.usuario.empresaId, novoEmail, req.usuario.id]);
        if (outro.rowCount) return res.status(409).json({ erro: 'Já existe outro usuário com este e-mail nesta empresa.' });
        // O e-mail de login só muda depois que a pessoa clicar no link enviado PARA O NOVO endereço
        const { d } = await dadosDoConvite(req.usuario.id, req.usuario.id);
        confirmacao = await enviarLink(query, req.usuario.id, 'troca_email', novoEmail, d);
        if (confirmacao.erro) return res.status(502).json({ erro: `Não consegui enviar o e-mail de confirmação: ${confirmacao.erro}` });
        // modo teste: o link fica só no console do servidor (a prova é receber no e-mail novo)
        if (confirmacao.link_teste) delete confirmacao.link_teste;
      }
      const telefone = req.body.telefone ? String(req.body.telefone).replace(/\D/g, '') : null;
      await query('UPDATE usuarios SET nome = $2, telefone = $3 WHERE id = $1', [req.usuario.id, req.body.nome.trim(), telefone]);
      const { rows } = await query(`SELECT ${CAMPOS_EU} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1`, [req.usuario.id]);
      res.json({ ...rows[0], confirmacao_email: confirmacao });
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

// CRIAR   POST /api/usuarios   { nome, email, perfil_id }
// Não tem senha: a pessoa recebe um e-mail com o link para CONFIRMAR o
// e-mail e CRIAR a senha dela. Só entra no sistema depois disso.
router.post(
  '/',
  [
    body('nome').trim().notEmpty().withMessage('Informe o nome.'),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
    body('perfil_id').isInt({ min: 1 }).withMessage('Escolha o perfil.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const conf = await conferirEmail(req.body.email);
      if (!conf.ok) return res.status(400).json({ erro: conf.motivo, sugestao: conf.sugestao });
      // senha impossível de adivinhar (ninguém a conhece): a de verdade a pessoa cria pelo link
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const { rows } = await query(
        `INSERT INTO usuarios (empresa_id, perfil_id, nome, email, senha_hash, deve_trocar_senha)
         VALUES ($1, $2, $3, lower($4), $5, FALSE) RETURNING id`,
        [req.usuario.empresaId, req.body.perfil_id, req.body.nome, req.body.email.trim(), hash]
      );
      const { para, d } = await dadosDoConvite(rows[0].id, req.usuario.id);
      const convite = await enviarLink(query, rows[0].id, 'convite', para, d);
      const novo = await query(`SELECT ${CAMPOS} FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.id = $1`,
        [rows[0].id]);
      res.status(201).json({ ...novo.rows[0], convite });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um usuário com este e-mail nesta empresa.' });
      next(err);
    }
  }
);

// REENVIAR CONVITE   POST /api/usuarios/:id/convite   (conta ainda não ativada)
router.post('/:id/convite', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const u = await query('SELECT id, email_confirmado_em, ativo FROM usuarios WHERE id = $1 AND empresa_id = $2', [req.params.id, req.usuario.empresaId]);
    if (!u.rowCount) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (u.rows[0].email_confirmado_em) return res.status(409).json({ erro: 'Este usuário já confirmou o e-mail.' });
    if (!u.rows[0].ativo) return res.status(409).json({ erro: 'Usuário inativo: ative antes de reenviar o convite.' });
    const { para, d } = await dadosDoConvite(u.rows[0].id, req.usuario.id);
    res.json({ convite: await enviarLink(query, u.rows[0].id, 'convite', para, d) });
  } catch (err) {
    next(err);
  }
});

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
      if (req.body.senha) {
        const conf = await query('SELECT email_confirmado_em FROM usuarios WHERE id = $1 AND empresa_id = $2', [id, req.usuario.empresaId]);
        if (conf.rowCount && !conf.rows[0].email_confirmado_em) {
          return res.status(409).json({ erro: 'Este usuário ainda não confirmou o e-mail: reenvie o convite (ele cria a senha pelo link).' });
        }
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
