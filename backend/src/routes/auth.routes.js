const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

// POST /api/auth/login   { cnpj, email, senha }
router.post(
  '/login',
  [
    body('cnpj').trim().notEmpty().withMessage('Informe o CNPJ.')
      .bail().custom((v) => String(v).replace(/\D/g, '').length === 14).withMessage('O CNPJ tem 14 números.'),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
    body('senha').notEmpty().withMessage('Informe a senha.'),
  ],
  async (req, res, next) => {
    try {
      const erros = validationResult(req);
      if (!erros.isEmpty()) {
        return res.status(400).json({
          erro: 'Dados inválidos.',
          detalhes: erros.array().map((e) => ({ campo: e.path, mensagem: e.msg })),
        });
      }

      const cnpj = String(req.body.cnpj).replace(/\D/g, ''); // o banco guarda só dígitos
      const { email, senha } = req.body;

      const { rows } = await query(
        `SELECT u.id, u.nome, u.email, u.senha_hash, u.ativo AS usuario_ativo, u.deve_trocar_senha, u.email_confirmado_em,
                u.empresa_id, p.nome AS perfil,
                e.nome AS empresa_nome, e.ativo AS empresa_ativa
           FROM usuarios u
           JOIN empresas e ON e.id = u.empresa_id
           JOIN perfis   p ON p.id = u.perfil_id
          WHERE e.cnpj = $1 AND lower(u.email) = lower($2)`,
        [cnpj, email]
      );

      const usuario = rows[0];
      const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senha_hash) : false;

      // Conta criada por convite e ainda não ativada: ainda não existe senha
      // (a pessoa cria pelo link do e-mail). Explica e oferece reenviar.
      if (usuario && !usuario.email_confirmado_em && usuario.usuario_ativo && usuario.empresa_ativa) {
        return res.status(403).json({
          erro: 'Sua conta ainda não foi ativada. Abra o e-mail que enviamos e clique em "Confirmar e-mail e criar minha senha".',
          codigo: 'EMAIL_NAO_CONFIRMADO',
        });
      }

      // Mesma mensagem para CNPJ, e-mail ou senha errados: não revela qual dado existe
      if (!usuario || !senhaOk) {
        return res.status(401).json({ erro: 'CNPJ, e-mail ou senha inválidos.' });
      }
      // Dados certos, mas acesso bloqueado: aí sim explica o motivo
      if (!usuario.empresa_ativa) {
        return res.status(403).json({ erro: 'O acesso desta empresa está suspenso. Entre em contato com o suporte da CTech.' });
      }
      if (!usuario.usuario_ativo) {
        return res.status(403).json({ erro: 'Seu usuário está desativado. Fale com o administrador da sua empresa.' });
      }

      const token = jwt.sign(
        { sub: String(usuario.id), empresa_id: usuario.empresa_id, perfil: usuario.perfil },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
      );

      await query('UPDATE usuarios SET ultimo_login = now() WHERE id = $1', [usuario.id]);
      // Histórico: registra a entrada (quem, quando e de qual IP)
      await query(`INSERT INTO auditoria (empresa_id, usuario_id, acao, tabela, registro_id, ip)
                   VALUES ($1, $2, 'LOGIN', 'usuarios', $2, $3)`, [usuario.empresa_id, usuario.id, req.ip]);

      res.json({
        token,
        usuario: {
          id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil,
          deve_trocar_senha: usuario.deve_trocar_senha, // senha provisória: o front obriga a trocar
        },
        empresa: { id: usuario.empresa_id, nome: usuario.empresa_nome },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/auth/me   (precisa do token): o frontend usa para checar se ainda está logado
router.get('/me', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
