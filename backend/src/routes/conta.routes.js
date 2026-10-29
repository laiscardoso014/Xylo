// =====================================================================
// CONTA - rotas PÚBLICAS (sem login) ligadas ao e-mail
//
//   GET  /api/conta/email?email=           confere se o e-mail parece existir (formato, domínio)
//   GET  /api/conta/link?t=TOKEN           o que é este link (convite, troca de e-mail, nova senha)
//   POST /api/conta/confirmar { t, senha } usa o link: confirma o e-mail / cria a senha
//   POST /api/conta/esqueci   { cnpj, email }   manda o link de nova senha
//   POST /api/conta/reenviar  { cnpj, email }   manda de novo o convite (conta ainda não ativada)
//
// "esqueci" e "reenviar" respondem SEMPRE a mesma coisa (não revelam se o
// e-mail existe) e têm limite de pedidos por IP.
// =====================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, query: q, validationResult } = require('express-validator');
const { query, pool } = require('../config/db');
const { conferirEmail } = require('../conta/conferirEmail');
const { enviarLink, hashToken } = require('../conta/emails');

const router = express.Router();

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}

// Limite simples por IP (memória)
function limite(maximo, janelaMs) {
  const usos = new Map();
  return (req, res, next) => {
    const agora = Date.now();
    const lista = (usos.get(req.ip) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= maximo) return res.status(429).json({ erro: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
    lista.push(agora);
    usos.set(req.ip, lista);
    next();
  };
}

const RESPOSTA_GENERICA = 'Se os dados estiverem certos, você vai receber um e-mail em alguns minutos. Confira também a caixa de spam.';
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

router.get('/email', limite(60, 60e3), [q('email').isString().isLength({ min: 3, max: 150 })], validar, async (req, res, next) => {
  try {
    res.json(await conferirEmail(req.query.email));
  } catch (err) {
    next(err);
  }
});

async function buscarLink(token) {
  const { rows } = await query(
    `SELECT t.id, t.tipo, t.email_novo, t.usado_em, t.expira_em < now() AS expirado,
            u.id AS usuario_id, u.nome, u.email, u.ativo, u.email_confirmado_em, e.nome AS empresa, e.cnpj, e.ativo AS empresa_ativa
       FROM tokens_conta t JOIN usuarios u ON u.id = t.usuario_id JOIN empresas e ON e.id = u.empresa_id
      WHERE t.token_hash = $1`, [hashToken(token)]);
  return rows[0] || null;
}
function problemaDoLink(l) {
  if (!l) return 'Este link não é válido. Confira se copiou o endereço inteiro.';
  if (l.usado_em) return 'Este link já foi usado (ou um link mais novo foi enviado depois dele).';
  if (l.expirado) return 'Este link expirou.';
  if (!l.ativo || !l.empresa_ativa) return 'Este acesso está desativado. Fale com o administrador da sua empresa.';
  return null;
}

router.get('/link', limite(60, 60e3), [q('t').isString().isLength({ min: 20, max: 100 }).withMessage('Link inválido.')], validar, async (req, res, next) => {
  try {
    const l = await buscarLink(req.query.t);
    const problema = problemaDoLink(l);
    if (problema) return res.status(410).json({ erro: problema, tipo: l?.tipo || null, cnpj: l?.cnpj || null, email: l?.email || null });
    res.json({ tipo: l.tipo, nome: l.nome, email: l.tipo === 'troca_email' ? l.email_novo : l.email, email_atual: l.email, empresa: l.empresa, cnpj: l.cnpj });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/confirmar',
  limite(20, 10 * 60e3),
  [body('t').isString().isLength({ min: 20, max: 100 }).withMessage('Link inválido.'),
    body('senha').optional().isString().isLength({ min: 8, max: 100 }).withMessage('A senha precisa ter pelo menos 8 caracteres.')],
  validar,
  async (req, res, next) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const l = await buscarLink(req.body.t);
      const problema = problemaDoLink(l);
      if (problema) { await c.query('ROLLBACK'); return res.status(410).json({ erro: problema }); }
      // o histórico registra a confirmação como feita pela própria pessoa
      await c.query("SELECT set_config('xylo.usuario_id', $1, true)", [String(l.usuario_id)]);
      const usado = await c.query('UPDATE tokens_conta SET usado_em = now() WHERE id = $1 AND usado_em IS NULL', [l.id]);
      if (!usado.rowCount) { await c.query('ROLLBACK'); return res.status(410).json({ erro: 'Este link já foi usado.' }); }

      if (l.tipo === 'convite' || l.tipo === 'nova_senha') {
        if (!req.body.senha) { await c.query('ROLLBACK'); return res.status(400).json({ erro: 'Crie uma senha com pelo menos 8 caracteres.' }); }
        if (!/[A-Za-z]/.test(req.body.senha) || !/\d/.test(req.body.senha)) {
          await c.query('ROLLBACK');
          return res.status(400).json({ erro: 'Use letras e números na senha.' });
        }
        // clicar no link do e-mail também prova que o e-mail é dele
        await c.query(
          `UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = FALSE, senha_alterada_em = now(),
                  email_confirmado_em = COALESCE(email_confirmado_em, now())
            WHERE id = $1`, [l.usuario_id, await bcrypt.hash(req.body.senha, 10)]);
      } else {
        // troca de e-mail: só agora o e-mail de login muda
        await c.query('UPDATE usuarios SET email = $2, email_confirmado_em = now() WHERE id = $1', [l.usuario_id, l.email_novo]);
      }
      await c.query('COMMIT');
      res.json({ tipo: l.tipo, cnpj: l.cnpj, email: l.tipo === 'troca_email' ? l.email_novo : l.email, nome: l.nome });
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') return res.status(409).json({ erro: 'Outro usuário desta empresa já usa este e-mail.' });
      next(err);
    } finally {
      c.release();
    }
  }
);

const regrasPedido = [
  body('cnpj').custom((v) => soDigitos(v).length === 14).withMessage('Informe o CNPJ da empresa (14 números).'),
  body('email').trim().isEmail().withMessage('Informe o seu e-mail.'),
];
async function acharUsuario(cnpj, email) {
  const { rows } = await query(
    `SELECT u.id, u.nome, u.email, u.email_confirmado_em, p.nome AS perfil, e.nome AS empresa
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id JOIN perfis p ON p.id = u.perfil_id
      WHERE e.cnpj = $1 AND lower(u.email) = lower($2) AND u.ativo AND e.ativo`, [soDigitos(cnpj), String(email).trim()]);
  return rows[0] || null;
}

router.post('/esqueci', limite(5, 15 * 60e3), regrasPedido, validar, async (req, res, next) => {
  try {
    const u = await acharUsuario(req.body.cnpj, req.body.email);
    if (u) {
      // conta ainda não ativada: manda o convite (que também cria a senha)
      await enviarLink(query, u.id, u.email_confirmado_em ? 'nova_senha' : 'convite', u.email, { nome: u.nome, empresa: u.empresa, perfil: u.perfil });
    }
    // Nunca devolve o link aqui (nem no modo teste): só o dono do e-mail pode recebê-lo
    res.json({ mensagem: RESPOSTA_GENERICA });
  } catch (err) {
    next(err);
  }
});

router.post('/reenviar', limite(5, 15 * 60e3), regrasPedido, validar, async (req, res, next) => {
  try {
    const u = await acharUsuario(req.body.cnpj, req.body.email);
    if (u && !u.email_confirmado_em) await enviarLink(query, u.id, 'convite', u.email, { nome: u.nome, empresa: u.empresa, perfil: u.perfil });
    res.json({ mensagem: RESPOSTA_GENERICA });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
