// =====================================================================
// PAINEL DO DESENVOLVEDOR: equipe, usuários, histórico e lixeira
// (o login do painel é conferido no dev.routes.js antes de chegar aqui)
//
//   GET    /equipe                     membros da equipe CTech (quem entra no painel)
//   POST   /equipe                     novo membro { nome, email, senha }
//   PUT    /equipe/:id                 { nome, email, ativo }
//   POST   /equipe/:id/senha           { senha }  define uma senha nova para o membro
//   PUT    /minha-senha                { atual, nova }
//   GET    /usuarios?empresa_id=&busca=   usuários de todas as empresas (só leitura)
//   GET    /historico?area=&dev_id=&dias=  o que a equipe fez no painel
//   DELETE /solicitacoes/:id { motivo }  manda a solicitação para a lixeira
//   GET    /lixeira
//   POST   /lixeira/:id/restaurar
//   DELETE /lixeira/:id               apaga de vez
//
// O registro no histórico é automático (registrarAcao, no dev.routes.js).
// =====================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, query: q, validationResult } = require('express-validator');
const { pool, query } = require('../config/db');

const router = express.Router();

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}
const idValido = [param('id').isInt({ min: 1 }).withMessage('Registro inválido.')];
const senhaForte = (campo) => body(campo).isString().isLength({ min: 8, max: 100 }).withMessage('A senha precisa ter pelo menos 8 caracteres.')
  .matches(/[A-Za-z]/).withMessage('A senha precisa ter pelo menos uma letra.')
  .matches(/\d/).withMessage('A senha precisa ter pelo menos um número.');

// =====================================================================
// EQUIPE
// =====================================================================
router.get('/equipe', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nome, email, ativo, to_char(ultimo_login, 'YYYY-MM-DD"T"HH24:MI') AS ultimo_login,
              to_char(created_at, 'YYYY-MM-DD') AS desde, (id = $1) AS eu
         FROM desenvolvedores ORDER BY ativo DESC, nome`, [req.dev.id]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/equipe', [
  body('nome').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Informe o nome.'),
  body('email').trim().isEmail().withMessage('Informe um e-mail válido.').isLength({ max: 150 }),
  senhaForte('senha'),
], validar, async (req, res, next) => {
  try {
    const existe = await query('SELECT 1 FROM desenvolvedores WHERE lower(email) = lower($1)', [req.body.email.trim()]);
    if (existe.rowCount) return res.status(409).json({ erro: 'Já existe um membro da equipe com este e-mail.' });
    const { rows } = await query(
      'INSERT INTO desenvolvedores (nome, email, senha_hash) VALUES ($1, lower($2), $3) RETURNING id, nome, email, ativo',
      [req.body.nome.trim(), req.body.email.trim(), await bcrypt.hash(req.body.senha, 10)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/equipe/:id', [...idValido,
  body('nome').optional().isString().trim().isLength({ min: 2, max: 100 }).withMessage('Informe o nome.'),
  body('email').optional().trim().isEmail().withMessage('Informe um e-mail válido.'),
  body('ativo').optional().isBoolean(),
], validar, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.dev.id && req.body.ativo === false) return res.status(400).json({ erro: 'Você não pode desativar o seu próprio acesso.' });
    if (req.body.ativo === false) {
      const ativos = await query('SELECT count(*)::int AS n FROM desenvolvedores WHERE ativo AND id <> $1', [id]);
      if (!ativos.rows[0].n) return res.status(400).json({ erro: 'O painel precisa de pelo menos um membro ativo.' });
    }
    if (req.body.email) {
      const outro = await query('SELECT 1 FROM desenvolvedores WHERE lower(email) = lower($1) AND id <> $2', [req.body.email.trim(), id]);
      if (outro.rowCount) return res.status(409).json({ erro: 'Já existe um membro da equipe com este e-mail.' });
    }
    const { rows } = await query(
      `UPDATE desenvolvedores SET nome = COALESCE($2, nome), email = COALESCE(lower($3), email), ativo = COALESCE($4, ativo), updated_at = now()
        WHERE id = $1 RETURNING id, nome, email, ativo`,
      [id, req.body.nome ? req.body.nome.trim() : null, req.body.email ? req.body.email.trim() : null,
        typeof req.body.ativo === 'boolean' ? req.body.ativo : null]);
    if (!rows.length) return res.status(404).json({ erro: 'Membro não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/equipe/:id/senha', [...idValido, senhaForte('senha')], validar, async (req, res, next) => {
  try {
    const r = await query('UPDATE desenvolvedores SET senha_hash = $2, updated_at = now() WHERE id = $1 RETURNING nome',
      [req.params.id, await bcrypt.hash(req.body.senha, 10)]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Membro não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/minha-senha', [body('atual').notEmpty().withMessage('Informe a senha atual.'), senhaForte('nova')], validar, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT senha_hash FROM desenvolvedores WHERE id = $1', [req.dev.id]);
    if (!rows.length || !(await bcrypt.compare(req.body.atual, rows[0].senha_hash))) return res.status(400).json({ erro: 'A senha atual não confere.' });
    await query('UPDATE desenvolvedores SET senha_hash = $2, updated_at = now() WHERE id = $1', [req.dev.id, await bcrypt.hash(req.body.nova, 10)]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// USUÁRIOS DE TODAS AS EMPRESAS (só leitura: quem gerencia é o Administrador de cada empresa)
// =====================================================================
router.get('/usuarios', [q('empresa_id').optional({ values: 'falsy' }).isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const busca = typeof req.query.busca === 'string' && req.query.busca.trim() ? `%${req.query.busca.trim()}%` : null;
    const { rows } = await query(
      `SELECT u.id, u.nome, u.email, p.nome AS perfil, u.ativo, (u.email_confirmado_em IS NOT NULL) AS ativado,
              to_char(u.ultimo_login, 'YYYY-MM-DD"T"HH24:MI') AS ultimo_login, e.id AS empresa_id, e.nome AS empresa, e.ativo AS empresa_ativa
         FROM usuarios u JOIN perfis p ON p.id = u.perfil_id JOIN empresas e ON e.id = u.empresa_id
        WHERE ($1::int IS NULL OR u.empresa_id = $1) AND ($2::text IS NULL OR u.nome ILIKE $2 OR u.email ILIKE $2 OR e.nome ILIKE $2)
        ORDER BY e.nome, u.ativo DESC, u.nome LIMIT 500`, [req.query.empresa_id || null, busca]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// HISTÓRICO DO PAINEL
// =====================================================================
router.get('/historico', [
  q('dias').optional().isInt({ min: 1, max: 365 }),
  q('dev_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
], validar, async (req, res, next) => {
  try {
    const area = typeof req.query.area === 'string' && req.query.area ? req.query.area : null;
    const { rows } = await query(
      `SELECT h.id, COALESCE(d.nome, h.dev_nome, 'sistema') AS quem, h.acao, h.area, h.detalhe, h.ip,
              to_char(h.data_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_hora
         FROM dev_historico h LEFT JOIN desenvolvedores d ON d.id = h.dev_id
        WHERE h.data_hora >= now() - make_interval(days => $1)
          AND ($2::text IS NULL OR h.area = $2) AND ($3::int IS NULL OR h.dev_id = $3)
        ORDER BY h.data_hora DESC LIMIT 500`, [Number(req.query.dias) || 30, area, req.query.dev_id || null]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// LIXEIRA (solicitações de acesso)
// =====================================================================
router.delete('/solicitacoes/:id', [...idValido, body('motivo').optional({ values: 'falsy' }).isString().isLength({ max: 200 })], validar, async (req, res, next) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT * FROM solicitacoes_acesso WHERE id = $1 FOR UPDATE', [req.params.id]);
    const s = rows[0];
    if (!s) { await c.query('ROLLBACK'); return res.status(404).json({ erro: 'Solicitação não encontrada.' }); }
    if (s.status === 'Aprovada') { await c.query('ROLLBACK'); return res.status(400).json({ erro: 'Solicitação aprovada não pode ser excluída: ela está ligada à empresa criada.' }); }
    await c.query(
      `INSERT INTO dev_lixeira (tipo, resumo, dados, motivo, excluido_por) VALUES ('solicitacao', $1, $2, $3, $4)`,
      [`${s.nome_empresa} · ${s.nome_completo}`.slice(0, 200), s, (req.body.motivo || '').trim() || null, req.dev.id]);
    await c.query('DELETE FROM solicitacoes_acesso WHERE id = $1', [s.id]);
    await c.query('COMMIT');
    req.resumoAcao = `${s.nome_empresa} (${s.nome_completo})`;
    res.status(204).end();
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    c.release();
  }
});

router.get('/lixeira', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT l.id, l.tipo, l.resumo, l.motivo, l.dados, to_char(l.excluido_em, 'YYYY-MM-DD"T"HH24:MI') AS excluido_em, d.nome AS excluido_por
         FROM dev_lixeira l LEFT JOIN desenvolvedores d ON d.id = l.excluido_por ORDER BY l.excluido_em DESC`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/lixeira/:id/restaurar', idValido, validar, async (req, res, next) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT * FROM dev_lixeira WHERE id = $1 FOR UPDATE', [req.params.id]);
    const item = rows[0];
    if (!item) { await c.query('ROLLBACK'); return res.status(404).json({ erro: 'Este item não está mais na lixeira.' }); }
    if (item.tipo === 'solicitacao') {
      const d = item.dados;
      const livre = await c.query('SELECT 1 FROM solicitacoes_acesso WHERE id = $1', [d.id]);
      // volta com o mesmo número; se o número já foi usado, ganha um novo
      const colunas = ['nome_completo', 'whatsapp', 'email_corporativo', 'nome_empresa', 'cnpj', 'numero_funcionarios', 'faturamento_mensal',
        'regime_fiscal', 'observacoes', 'status', 'observacao_interna', 'atendido_por', 'created_at'];
      const comId = !livre.rowCount;
      const nomes = comId ? ['id', ...colunas] : colunas;
      const valores = nomes.map((k) => d[k] ?? null);
      await c.query(`INSERT INTO solicitacoes_acesso (${nomes.join(', ')}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`, valores);
    }
    await c.query('DELETE FROM dev_lixeira WHERE id = $1', [item.id]);
    await c.query('COMMIT');
    req.resumoAcao = item.resumo;
    res.json({ ok: true });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    c.release();
  }
});

router.delete('/lixeira/:id', idValido, validar, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM dev_lixeira WHERE id = $1 RETURNING resumo', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Este item não está mais na lixeira.' });
    req.resumoAcao = rows[0].resumo;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
