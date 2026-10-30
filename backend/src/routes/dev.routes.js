// =====================================================================
// PAINEL DO DESENVOLVEDOR  (/api/dev/...)
// Quem usa: você, que administra o Xylo (CTech). Login separado das empresas.
//
//   POST /api/dev/login                        entrar no painel
//   GET  /api/dev/resumo                       números para o início do painel
//   GET  /api/dev/solicitacoes?status=...      solicitações vindas do index.html
//   PUT  /api/dev/solicitacoes/:id             muda status / anotação interna
//   POST /api/dev/solicitacoes/:id/aprovar     cria a empresa + Administrador
//   GET  /api/dev/empresas                     empresas cadastradas
//   POST /api/dev/empresas                     cadastra empresa sem solicitação
//   PUT  /api/dev/empresas/:id                 bloquear/desbloquear, editar dados
//   POST /api/dev/empresas/:id/nova-senha-admin   gera nova senha provisória do admin
//   /api/dev/cobranca/...                      mensalidade: faturas com PIX (devCobranca.routes.js)
// =====================================================================
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const { pool, query } = require('../config/db');
const { cnpjValido, telefoneValido, MSG } = require('../utils/documentos');

const { enviarLink } = require('../conta/emails');
const { conferirEmail } = require('../conta/conferirEmail');

const router = express.Router();

const STATUS = ['Pendente', 'Em contato', 'Aprovada', 'Recusada'];
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

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

// Senha provisória fácil de ditar: sem letras/números que se confundem (0/O, 1/l)
function gerarSenhaProvisoria() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < 10; i++) senha += letras[crypto.randomInt(letras.length)];
  return senha;
}

// Só aceita token do painel (tipo "dev"); token de empresa não entra aqui
function autenticarDev(req, res, next) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return res.status(401).json({ erro: 'Faça login no painel.' });
  try {
    const dados = jwt.verify(token, process.env.JWT_SECRET);
    if (dados.tipo !== 'dev') return res.status(401).json({ erro: 'Acesso restrito ao desenvolvedor.' });
    req.dev = { id: Number(dados.sub), nome: dados.nome };
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão do painel expirada. Entre novamente.' });
  }
}

// ---------------------------------------------------------------------
// Cria empresa + usuário Administrador numa transação (tudo ou nada).
// Usado na aprovação de solicitação e no cadastro direto.
// ---------------------------------------------------------------------
async function criarEmpresaComAdmin(client, d) {
  const existe = await client.query('SELECT id FROM empresas WHERE cnpj = $1', [d.cnpj]);
  if (existe.rowCount) {
    const erro = new Error('Já existe uma empresa cadastrada com este CNPJ.');
    erro.status = 409;
    throw erro;
  }

  const empresa = (await client.query(
    `INSERT INTO empresas (nome, razao_social, cnpj, email, telefone)
     VALUES ($1, $2, $3, lower($4), $5) RETURNING id, nome, cnpj`,
    [d.nome_empresa, d.razao_social || null, d.cnpj, d.email_empresa || d.admin_email, d.telefone || null]
  )).rows[0];
  // (as classes de madeira padrão são criadas pelo trigger do banco)

  // Sem senha: o administrador recebe o convite por e-mail, confirma o e-mail e cria a senha
  const hash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10);
  const admin = await client.query(
    `INSERT INTO usuarios (empresa_id, perfil_id, nome, email, senha_hash, deve_trocar_senha)
     VALUES ($1, (SELECT id FROM perfis WHERE nome = 'Administrador'), $2, lower($3), $4, FALSE) RETURNING id`,
    [empresa.id, d.admin_nome, d.admin_email.trim(), hash]
  );

  return {
    empresa,
    adminId: admin.rows[0].id,
    acesso: { cnpj: empresa.cnpj, email: d.admin_email.trim().toLowerCase() },
  };
}

// Depois do COMMIT: manda o convite ao administrador da empresa nova
async function convidarAdmin(resultado, adminNome) {
  const convite = await enviarLink(query, resultado.adminId, 'convite', resultado.acesso.email,
    { nome: adminNome, empresa: resultado.empresa.nome, perfil: 'Administrador', quemCriou: 'A equipe CTech' });
  const { adminId, ...resto } = resultado;
  return { ...resto, acesso: { ...resto.acesso, convite } };
}

// E-mail do administrador: confere formato e domínio antes de criar
async function emailDoAdminOk(req, res) {
  const conf = await conferirEmail(req.body.admin_email);
  if (!conf.ok) { res.status(400).json({ erro: conf.motivo, sugestao: conf.sugestao }); return false; }
  return true;
}

const regrasEmpresa = [
  body('nome_empresa').trim().notEmpty().withMessage('Informe o nome da empresa.').isLength({ max: 150 }),
  body('razao_social').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('cnpj').customSanitizer(soDigitos).isLength({ min: 14, max: 14 }).withMessage('O CNPJ precisa ter 14 números.')
    .bail().custom(cnpjValido).withMessage(MSG.cnpj),
  body('admin_nome').trim().notEmpty().withMessage('Informe o nome do administrador da empresa.').isLength({ max: 100 }),
  body('admin_email').trim().isEmail().withMessage('Informe um e-mail válido para o administrador.'),
  body('telefone').optional({ values: 'falsy' }).custom(telefoneValido).withMessage(MSG.telefone).customSanitizer(soDigitos),
];

// =====================================================================
// HISTÓRICO DO PAINEL (dev_historico)
// =====================================================================
function registrar(dev, acao, area, detalhe, ip) {
  query('INSERT INTO dev_historico (dev_id, dev_nome, acao, area, detalhe, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [dev.id, dev.nome, acao.slice(0, 200), area, detalhe ? JSON.stringify(detalhe) : null, ip || null])
    .catch((err) => console.warn('[painel] histórico não gravado:', err.message));
}

// Nome da empresa / fatura / membro citado na rota (para o texto ficar legível)
async function nomeDe(tabela, id) {
  const sql = {
    empresas: 'SELECT nome FROM empresas WHERE id = $1',
    solicitacoes: "SELECT nome_empresa || ' (' || nome_completo || ')' AS nome FROM solicitacoes_acesso WHERE id = $1",
    faturas: "SELECT f.numero || ' · ' || e.nome AS nome FROM faturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = $1",
    equipe: 'SELECT nome FROM desenvolvedores WHERE id = $1',
  }[tabela];
  if (!sql) return `#${id}`;
  try { const { rows } = await query(sql, [id]); return rows[0] ? rows[0].nome : `#${id}`; } catch { return `#${id}`; }
}

// O que foi feito, em palavras (pelo método + caminho)
async function descrever(req) {
  const m = req.method;
  const c = req.path.replace(/\/+$/, '');
  const b = req.body || {};
  const id = (c.match(/\/(\d+)(?:\/|$)/) || [])[1];
  const regras = [
    [/^\/solicitacoes\/\d+\/aprovar$/, 'POST', 'solicitacoes', async () => `Aprovou a solicitação de ${await nomeDe('solicitacoes', id)} e criou a empresa`],
    [/^\/solicitacoes\/\d+$/, 'PUT', 'solicitacoes', async () => `Atualizou a solicitação de ${await nomeDe('solicitacoes', id)}${b.status ? ` (situação: ${b.status})` : ''}`],
    [/^\/solicitacoes\/\d+$/, 'DELETE', 'lixeira', async () => `Excluiu a solicitação de ${req.resumoAcao || `#${id}`}${b.motivo ? ` (motivo: ${b.motivo})` : ''}`],
    [/^\/empresas$/, 'POST', 'empresas', async () => `Cadastrou a empresa ${b.nome || ''}`],
    [/^\/empresas\/\d+$/, 'PUT', 'empresas', async () => {
      const nome = await nomeDe('empresas', id);
      if (b.ativo === false) return `Bloqueou a empresa ${nome}`;
      if (b.ativo === true && Object.keys(b).length === 1) return `Desbloqueou a empresa ${nome}`;
      return `Editou os dados da empresa ${nome}`;
    }],
    [/^\/empresas\/\d+\/nova-senha-admin$/, 'POST', 'empresas', async () => `Reenviou o acesso do administrador de ${await nomeDe('empresas', id)}`],
    [/^\/cobranca\/config$/, 'PUT', 'cobranca', async () => 'Alterou os dados de recebimento (PIX)'],
    [/^\/cobranca\/empresas\/\d+$/, 'PUT', 'cobranca', async () => `Alterou a mensalidade de ${await nomeDe('empresas', id)}`],
    [/^\/cobranca\/gerar$/, 'POST', 'cobranca', async () => `Gerou as faturas de ${b.mes || 'um mês'}${b.empresa_id ? ` para ${await nomeDe('empresas', b.empresa_id)}` : ''}`],
    [/^\/cobranca\/faturas\/\d+\/pagar$/, 'POST', 'cobranca', async () => `Deu baixa na fatura ${await nomeDe('faturas', id)}`],
    [/^\/cobranca\/faturas\/\d+\/desfazer-pagamento$/, 'POST', 'cobranca', async () => `Desfez o pagamento da fatura ${await nomeDe('faturas', id)}`],
    [/^\/cobranca\/faturas\/\d+\/cancelar$/, 'POST', 'cobranca', async () => `Cancelou a fatura ${await nomeDe('faturas', id)}${b.motivo ? ` (motivo: ${b.motivo})` : ''}`],
    [/^\/cobranca\/faturas\/\d+\/email$/, 'POST', 'cobranca', async () => `Reenviou por e-mail a fatura ${await nomeDe('faturas', id)}`],
    [/^\/equipe$/, 'POST', 'equipe', async () => `Adicionou ${b.nome || ''} à equipe`],
    [/^\/equipe\/\d+$/, 'PUT', 'equipe', async () => {
      const nome = await nomeDe('equipe', id);
      if (b.ativo === false) return `Desativou o acesso de ${nome}`;
      if (b.ativo === true) return `Reativou o acesso de ${nome}`;
      return `Editou o cadastro de ${nome}`;
    }],
    [/^\/equipe\/\d+\/senha$/, 'POST', 'equipe', async () => `Definiu uma senha nova para ${await nomeDe('equipe', id)}`],
    [/^\/minha-senha$/, 'PUT', 'equipe', async () => 'Trocou a própria senha'],
    [/^\/lixeira\/\d+\/restaurar$/, 'POST', 'lixeira', async () => `Restaurou da lixeira: ${req.resumoAcao || `#${id}`}`],
    [/^\/lixeira\/\d+$/, 'DELETE', 'lixeira', async () => `Apagou de vez da lixeira: ${req.resumoAcao || `#${id}`}`],
  ];
  const regra = regras.find(([re, metodo]) => metodo === m && re.test(c));
  if (!regra) return { acao: `${m} ${c}`, area: 'outros' };
  return { acao: await regra[3](), area: regra[2] };
}

function registrarAcao(req, res, next) {
  if (req.method === 'GET') return next();
  // nomes que a ação apaga/cria são lidos ANTES (ex.: nome da solicitação excluída)
  res.on('finish', async () => {
    if (res.statusCode >= 400) return;
    try {
      const { acao, area } = await descrever(req);
      const { senha, nova, atual, ...resto } = req.body || {};
      registrar(req.dev, acao, area, Object.keys(resto).length ? resto : null, req.ip);
    } catch (err) {
      console.warn('[painel] histórico não gravado:', err.message);
    }
  });
  next();
}

// =====================================================================
// LOGIN DO PAINEL   POST /api/dev/login   { email, senha }
// =====================================================================
router.post(
  '/login',
  // No login só exige que o campo esteja preenchido: quem confere se o e-mail existe é o banco.
  [body('email').trim().notEmpty().withMessage('Informe o e-mail.'), body('senha').notEmpty().withMessage('Informe a senha.')],
  validar,
  async (req, res, next) => {
    try {
      const { rows } = await query(
        'SELECT id, nome, email, senha_hash, ativo FROM desenvolvedores WHERE lower(email) = lower($1)',
        [req.body.email]
      );
      const dev = rows[0];
      const ok = dev ? await bcrypt.compare(req.body.senha, dev.senha_hash) : false;
      if (!dev || !ok || !dev.ativo) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });

      await query('UPDATE desenvolvedores SET ultimo_login = now() WHERE id = $1', [dev.id]);
      registrar({ id: dev.id, nome: dev.nome }, 'Entrou no painel', 'acesso', null, req.ip);
      const token = jwt.sign({ sub: String(dev.id), tipo: 'dev', nome: dev.nome }, process.env.JWT_SECRET, { expiresIn: '4h' });
      res.json({ token, dev: { id: dev.id, nome: dev.nome, email: dev.email } });
    } catch (err) {
      next(err);
    }
  }
);

// Daqui para baixo, só com login do painel
router.use(autenticarDev);

// Histórico: toda alteração feita no painel (POST/PUT/DELETE que deu certo) fica registrada
router.use(registrarAcao);

// Equipe, usuários das empresas, histórico e lixeira
router.use(require('./devEquipe.routes'));

// Cobrança da mensalidade (faturas com PIX)
router.use('/cobranca', require('./devCobranca.routes'));

// =====================================================================
// RESUMO
// =====================================================================
router.get('/resumo', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(*) FROM solicitacoes_acesso WHERE status = 'Pendente')   ::int AS pendentes,
        (SELECT COUNT(*) FROM solicitacoes_acesso WHERE status = 'Em contato') ::int AS em_contato,
        (SELECT COUNT(*) FROM empresas WHERE ativo)                            ::int AS empresas_ativas,
        (SELECT COUNT(*) FROM empresas WHERE NOT ativo)                        ::int AS empresas_bloqueadas,
        (SELECT COUNT(*) FROM usuarios WHERE ativo)                            ::int AS usuarios_ativos,
        (SELECT COUNT(*) FROM faturas WHERE status = 'Aberta' AND vencimento < current_date) ::int AS faturas_vencidas,
        (SELECT COUNT(*) FROM faturas WHERE status = 'Aberta' AND informado_em IS NOT NULL)  ::int AS pagamentos_informados,
        (SELECT COALESCE(SUM(valor_pago), 0) FROM faturas
          WHERE status = 'Paga' AND date_trunc('month', pago_em) = date_trunc('month', current_date))::float AS recebido_mes`);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// SOLICITAÇÕES
// =====================================================================
router.get('/solicitacoes', async (req, res, next) => {
  try {
    const status = STATUS.includes(req.query.status) ? req.query.status : null;
    const { rows } = await query(
      `SELECT s.*, e.nome AS empresa_criada, d.nome AS atendido_por_nome
         FROM solicitacoes_acesso s
         LEFT JOIN empresas e        ON e.id = s.empresa_id
         LEFT JOIN desenvolvedores d ON d.id = s.atendido_por
        WHERE ($1::text IS NULL OR s.status = $1)
        ORDER BY CASE s.status WHEN 'Pendente' THEN 0 WHEN 'Em contato' THEN 1 ELSE 2 END, s.created_at DESC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Muda status (Pendente, Em contato, Recusada) e/ou anotação interna
router.put(
  '/solicitacoes/:id',
  [
    param('id').isInt({ min: 1 }),
    body('status').optional().isIn(['Pendente', 'Em contato', 'Recusada']).withMessage('Status inválido. Para aprovar, use o botão Aprovar.'),
    body('observacao_interna').optional({ nullable: true }).isLength({ max: 2000 }),
  ],
  validar,
  async (req, res, next) => {
    try {
      const atual = await query('SELECT status FROM solicitacoes_acesso WHERE id = $1', [req.params.id]);
      if (!atual.rowCount) return res.status(404).json({ erro: 'Solicitação não encontrada.' });
      if (atual.rows[0].status === 'Aprovada' && req.body.status) {
        return res.status(400).json({ erro: 'Esta solicitação já foi aprovada e virou uma empresa.' });
      }
      const { rows } = await query(
        `UPDATE solicitacoes_acesso
            SET status = COALESCE($2, status),
                observacao_interna = COALESCE($3, observacao_interna),
                atendido_por = $4
          WHERE id = $1 RETURNING *`,
        [req.params.id, req.body.status ?? null, req.body.observacao_interna ?? null, req.dev.id]
      );
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// APROVAR: cria a empresa e o Administrador a partir da solicitação
router.post(
  '/solicitacoes/:id/aprovar',
  [param('id').isInt({ min: 1 }), ...regrasEmpresa],
  validar,
  async (req, res, next) => {
    if (!(await emailDoAdminOk(req, res))) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sol = (await client.query('SELECT * FROM solicitacoes_acesso WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!sol) {
        await client.query('ROLLBACK');
        return res.status(404).json({ erro: 'Solicitação não encontrada.' });
      }
      if (sol.status === 'Aprovada') {
        await client.query('ROLLBACK');
        return res.status(400).json({ erro: 'Esta solicitação já foi aprovada.' });
      }

      const resultado = await criarEmpresaComAdmin(client, {
        ...req.body,
        email_empresa: sol.email_corporativo,
        telefone: req.body.telefone || sol.whatsapp,
      });

      await client.query(
        `UPDATE solicitacoes_acesso SET status = 'Aprovada', empresa_id = $2, atendido_por = $3 WHERE id = $1`,
        [sol.id, resultado.empresa.id, req.dev.id]
      );
      await client.query('COMMIT');
      res.status(201).json(await convidarAdmin(resultado, req.body.admin_nome));
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.status) return res.status(err.status).json({ erro: err.message });
      next(err);
    } finally {
      client.release();
    }
  }
);

// =====================================================================
// EMPRESAS
// =====================================================================
router.get('/empresas', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT e.id, e.nome, e.razao_social, e.cnpj, e.email, e.telefone, e.ativo, e.created_at,
             e.mensalidade::float AS mensalidade, e.dia_vencimento, to_char(e.cobrar_desde, 'YYYY-MM') AS cobrar_desde,
             (SELECT COUNT(*) FROM faturas f WHERE f.empresa_id = e.id AND f.status = 'Aberta' AND f.vencimento < current_date)::int AS faturas_vencidas,
             (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id = e.id AND u.ativo)::int AS usuarios,
             (SELECT COUNT(*) FROM viagens v  WHERE v.empresa_id = e.id)::int            AS viagens,
             (SELECT MAX(u.ultimo_login) FROM usuarios u WHERE u.empresa_id = e.id)      AS ultimo_acesso,
             (SELECT u.email FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
               WHERE u.empresa_id = e.id AND p.nome = 'Administrador' ORDER BY u.id LIMIT 1) AS admin_email
        FROM empresas e
       ORDER BY e.ativo DESC, e.nome`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Cadastro direto (sem solicitação), ex.: empresa que fechou por telefone
router.post('/empresas', regrasEmpresa, validar, async (req, res, next) => {
  if (!(await emailDoAdminOk(req, res))) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await criarEmpresaComAdmin(client, req.body);
    await client.query('COMMIT');
    res.status(201).json(await convidarAdmin(resultado, req.body.admin_nome));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ erro: err.message });
    next(err);
  } finally {
    client.release();
  }
});

// Editar dados / bloquear e desbloquear (ativo = false bloqueia o login de todos da empresa)
router.put(
  '/empresas/:id',
  [
    param('id').isInt({ min: 1 }),
    body('nome').optional().trim().notEmpty().withMessage('O nome não pode ficar vazio.'),
    body('razao_social').optional({ nullable: true }).trim(),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('E-mail inválido.'),
    body('telefone').optional({ values: 'falsy' }).custom(telefoneValido).withMessage(MSG.telefone).customSanitizer(soDigitos),
    body('ativo').optional().isBoolean().withMessage('Valor inválido para ativo.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE empresas SET
            nome         = COALESCE($2, nome),
            razao_social = COALESCE($3, razao_social),
            email        = COALESCE(lower($4), email),
            telefone     = COALESCE($5, telefone),
            ativo        = COALESCE($6, ativo)
          WHERE id = $1 RETURNING id, nome, razao_social, cnpj, email, telefone, ativo`,
        [
          req.params.id, req.body.nome ?? null, req.body.razao_social ?? null, req.body.email || null,
          req.body.telefone || null, typeof req.body.ativo === 'boolean' ? req.body.ativo : null,
        ]
      );
      if (!rows[0]) return res.status(404).json({ erro: 'Empresa não encontrada.' });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// Administrador da empresa esqueceu a senha: gera outra provisória
router.post('/empresas/:id/nova-senha-admin', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const admin = (await query(
      `SELECT u.id, u.email, e.cnpj FROM usuarios u
         JOIN perfis p ON p.id = u.perfil_id JOIN empresas e ON e.id = u.empresa_id
        WHERE u.empresa_id = $1 AND p.nome = 'Administrador'
        ORDER BY u.ativo DESC, u.id LIMIT 1`,
      [req.params.id]
    )).rows[0];
    if (!admin) return res.status(404).json({ erro: 'Esta empresa não tem administrador.' });

    const senha = gerarSenhaProvisoria();
    // Suporte da CTech (falou com a pessoa): a senha provisória também libera quem ainda não confirmou o e-mail
    await query(`UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = TRUE, ativo = TRUE,
                        email_confirmado_em = COALESCE(email_confirmado_em, now()) WHERE id = $1`,
      [admin.id, await bcrypt.hash(senha, 10)]);
    res.json({ acesso: { cnpj: admin.cnpj, email: admin.email, senha_provisoria: senha } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
