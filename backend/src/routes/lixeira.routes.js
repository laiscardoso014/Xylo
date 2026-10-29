// =====================================================================
// LIXEIRA - excluir lançamentos errados sem perder nada
//
//   POST /api/lixeira                 { tipo, id, motivo }  -> exclui (move para a lixeira)
//   GET  /api/lixeira?tipo=&busca=&de=&ate=                 -> lista (só Administrador)
//   POST /api/lixeira/:id/restaurar                         -> devolve o registro (mesmo id)
//
// tipo: viagens | fretes | despesas | precos
//
// REGRAS
//   - Excluir: Administrador exclui qualquer registro; Financeiro só o que
//     ELE lançou (criado_por). Visualização não exclui. Motivo obrigatório.
//   - O registro SAI da tabela dele (some de telas, totais, relatórios,
//     Excel e assistente) e fica inteiro aqui. Nunca é apagado de vez.
//   - Restaurar: Administrador, a qualquer momento. Quem excluiu pode
//     "Desfazer" nos primeiros 10 minutos.
//   - Ao restaurar, o sistema confere conflitos: ticket já relançado,
//     nº da viagem/carga já usado, preço com período sobreposto.
//   - Tudo fica no Histórico (gatilho fn_auditar no banco).
//
// "Cancelar" continua existindo e é outra coisa: a carga/pagamento que de
// fato não aconteceu continua visível (filtro Canceladas). Excluir é para
// lançamento ERRADO.
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { pool, query } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin, PERFIS } = require('../middlewares/auth');
const formatar = require('../auditoria/formatar');

const router = express.Router();
router.use(autenticar);

const TIPOS = {
  viagens: { tabela: 'viagens', valor: 'valor_total', data: 'data' },
  fretes: { tabela: 'fretes', valor: 'valor_total', data: 'data' },
  despesas: { tabela: 'despesas', valor: 'valor', data: 'data' },
  precos: { tabela: 'tabelas_precos', valor: 'valor_tonelada', data: 'data_inicio' },
};
const TIPO_DA_TABELA = Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [v.tabela, k]));
const PRAZO_DESFAZER_MIN = 10;

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}

// Transação com o mesmo "quem" das outras gravações (pool.connect já identifica o usuário)
async function emTransacao(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
// Marca a próxima gravação no histórico como EXCLUIR/RESTAURAR (só dentro desta transação)
const marcarAcao = (c, acao, detalhe) =>
  c.query("SELECT set_config('xylo.acao', $1, true), set_config('xylo.detalhe', $2, true)", [acao || '', detalhe || '']);

const erroHttp = (status, erro) => Object.assign(new Error(erro), { status, publico: true });

// Colunas que dá para gravar (as calculadas pelo banco ficam de fora)
async function colunasGravaveis(c, tabela) {
  const { rows } = await c.query(
    `SELECT attname FROM pg_attribute
      WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''`, [tabela]);
  return rows.map((r) => r.attname);
}
async function inserirDeJSON(c, tabela, dados) {
  const cols = (await colunasGravaveis(c, tabela)).filter((col) => Object.prototype.hasOwnProperty.call(dados, col));
  const lista = cols.map((col) => `"${col}"`).join(', ');
  await c.query(`INSERT INTO ${tabela} (${lista}) SELECT ${lista} FROM jsonb_populate_record(NULL::${tabela}, $1::jsonb)`, [JSON.stringify(dados)]);
}

// ---------------------------------------------------------------------
// EXCLUIR
// ---------------------------------------------------------------------
router.post(
  '/',
  podeEditar,
  [
    body('tipo').isIn(Object.keys(TIPOS)).withMessage('Tipo de registro inválido.'),
    body('id').isInt({ min: 1 }).withMessage('Registro inválido.'),
    body('motivo').isString().trim().isLength({ min: 5, max: 300 })
      .withMessage('Escreva o motivo da exclusão (pelo menos 5 letras).'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const t = TIPOS[req.body.tipo];
      const empresaId = req.usuario.empresaId;
      const admin = req.usuario.perfil === PERFIS.ADMIN;
      const motivo = req.body.motivo.trim();
      const nomes = await formatar.carregarNomes(empresaId);

      const r = await emTransacao(async (c) => {
        const atual = await c.query(`SELECT to_jsonb(x) AS dados FROM ${t.tabela} x WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
          [req.body.id, empresaId]);
        if (!atual.rowCount) throw erroHttp(404, 'Registro não encontrado (talvez já tenha sido excluído).');
        const dados = atual.rows[0].dados;
        if (!admin && dados.criado_por !== req.usuario.id) {
          throw erroHttp(403, 'Você só pode excluir o que você mesmo lançou. Peça ao administrador para excluir este.');
        }

        let dependentes = null;
        if (t.tabela === 'viagens') {
          const d = await c.query('SELECT jsonb_agg(to_jsonb(ve)) AS lista FROM viagem_empreiteiros ve WHERE viagem_id = $1', [req.body.id]);
          dependentes = d.rows[0].lista;
        }
        const resumo = formatar.resumo(t.tabela, dados, nomes);
        const item = await c.query(
          `INSERT INTO lixeira (empresa_id, tabela, registro_id, resumo, data_registro, valor, dados, dependentes,
                                motivo, criado_por, excluido_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [empresaId, t.tabela, dados.id, resumo, dados[t.data] || null, dados[t.valor] ?? null, JSON.stringify(dados),
            dependentes ? JSON.stringify(dependentes) : null, motivo, dados.criado_por || null, req.usuario.id]);

        await marcarAcao(c, 'EXCLUIR', motivo);
        await c.query(`DELETE FROM ${t.tabela} WHERE id = $1`, [dados.id]);
        await marcarAcao(c, '', '');

        // Preço: se era o vigente, o anterior (encerrado por causa dele) volta a valer
        let aviso = null;
        if (t.tabela === 'tabelas_precos' && !dados.data_fim) {
          const alvo = dados.cliente_id ? 'cliente_id' : dados.floresta_id ? 'floresta_id' : 'empreiteiro_id';
          const reaberto = await c.query(
            `UPDATE tabelas_precos SET data_fim = NULL
              WHERE empresa_id = $1 AND tipo = $2 AND classe_id = $3 AND ${alvo} = $4 AND data_fim = $5::date - 1
              RETURNING to_char(data_inicio, 'DD/MM/YYYY') AS ini, valor_tonelada`,
            [empresaId, dados.tipo, dados.classe_id, dados[alvo], dados.data_inicio]);
          if (reaberto.rowCount) {
            aviso = `O preço anterior (${formatar.dinheiro(reaberto.rows[0].valor_tonelada)}/t, desde ${reaberto.rows[0].ini}) voltou a valer.`;
          }
        }
        return { id: Number(item.rows[0].id), resumo, aviso };
      });
      res.status(201).json({ ...r, prazo_desfazer_min: PRAZO_DESFAZER_MIN });
    } catch (err) {
      if (err.publico) return res.status(err.status).json({ erro: err.message });
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// LISTAR (só Administrador)
// ---------------------------------------------------------------------
router.get(
  '/',
  somenteAdmin,
  [q('tipo').optional({ values: 'falsy' }).isIn(Object.keys(TIPOS)), q('de').optional({ values: 'falsy' }).isISO8601(),
    q('ate').optional({ values: 'falsy' }).isISO8601(), q('busca').optional().isString().isLength({ max: 100 })],
  validar,
  async (req, res, next) => {
    try {
      const empresaId = req.usuario.empresaId;
      const p = [empresaId, req.query.tipo ? TIPOS[req.query.tipo].tabela : null, req.query.de || null, req.query.ate || null,
        req.query.busca ? `%${req.query.busca.trim()}%` : null];
      const [lista, contagem, nomes] = await Promise.all([
        query(
          `SELECT l.id, l.tabela, l.registro_id, l.resumo, l.valor, to_char(l.data_registro, 'YYYY-MM-DD') AS data_registro,
                  l.motivo, l.dados, to_char(l.excluido_em, 'DD/MM/YYYY HH24:MI') AS excluido_em,
                  ue.nome AS excluido_por, uc.nome AS criado_por
             FROM lixeira l
             LEFT JOIN usuarios ue ON ue.id = l.excluido_por
             LEFT JOIN usuarios uc ON uc.id = l.criado_por
            WHERE l.empresa_id = $1
              AND ($2::text IS NULL OR l.tabela = $2)
              AND ($3::date IS NULL OR l.excluido_em >= $3::date)
              AND ($4::date IS NULL OR l.excluido_em < $4::date + 1)
              AND ($5::text IS NULL OR l.resumo ILIKE $5 OR l.motivo ILIKE $5)
            ORDER BY l.excluido_em DESC, l.id DESC
            LIMIT 500`, p),
        query('SELECT tabela, count(*)::int AS qtd FROM lixeira WHERE empresa_id = $1 GROUP BY tabela', [empresaId]),
        formatar.carregarNomes(empresaId),
      ]);
      res.json({
        itens: lista.rows.map(({ dados, ...i }) => ({
          ...i,
          id: Number(i.id), // BIGSERIAL vem do PostgreSQL como texto
          tipo: TIPO_DA_TABELA[i.tabela],
          tipo_nome: formatar.TABELAS[i.tabela].nome,
          detalhes: formatar.campos(dados, nomes),
        })),
        contagem: Object.fromEntries(contagem.rows.map((r) => [TIPO_DA_TABELA[r.tabela], r.qtd])),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// RESTAURAR
// ---------------------------------------------------------------------
router.post('/:id/restaurar', podeEditar, [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const empresaId = req.usuario.empresaId;
    const admin = req.usuario.perfil === PERFIS.ADMIN;

    const r = await emTransacao(async (c) => {
      const achado = await c.query(
        `SELECT l.*, (now() - l.excluido_em) < make_interval(mins => $3) AS no_prazo,
                to_char(l.excluido_em, 'DD/MM/YYYY') AS excluido_dia
           FROM lixeira l WHERE l.id = $1 AND l.empresa_id = $2 FOR UPDATE`, [req.params.id, empresaId, PRAZO_DESFAZER_MIN]);
      if (!achado.rowCount) throw erroHttp(404, 'Este item não está mais na lixeira (talvez já tenha sido restaurado).');
      const item = achado.rows[0];
      if (!admin && !(item.excluido_por === req.usuario.id && item.no_prazo)) {
        throw erroHttp(403, `Só o administrador restaura da lixeira. (Quem excluiu pode desfazer nos primeiros ${PRAZO_DESFAZER_MIN} minutos.)`);
      }

      const dados = { ...item.dados };
      const avisos = [];
      const dataBR = formatar.dataBR;

      if (item.tabela === 'viagens') {
        // Ticket relançado em outra viagem?
        if (dados.ticket && dados.status !== 'Cancelada') {
          const t = await c.query(
            `SELECT numero_viagem, to_char(data, 'YYYY-MM-DD') AS data FROM viagens
              WHERE empresa_id = $1 AND ticket = $2 AND status <> 'Cancelada' LIMIT 1`, [empresaId, dados.ticket]);
          if (t.rowCount) {
            throw erroHttp(409, `O ticket ${dados.ticket} já está na viagem nº ${t.rows[0].numero_viagem} de ${dataBR(t.rows[0].data)}. `
              + 'Exclua ou corrija aquela antes de restaurar esta.');
          }
        }
        // Nº da viagem já usado no mês do cliente? Volta com o próximo número.
        const n = await c.query(
          `SELECT 1 FROM viagens WHERE empresa_id = $1 AND cliente_id = $2 AND numero_viagem = $3
              AND date_trunc('month', data) = date_trunc('month', $4::date)`,
          [empresaId, dados.cliente_id, dados.numero_viagem, dados.data]);
        if (n.rowCount) {
          const prox = await c.query(
            `SELECT (COALESCE(MAX(numero_viagem::int), 0) + 1)::text AS n FROM viagens
              WHERE empresa_id = $1 AND cliente_id = $2 AND numero_viagem ~ '^[0-9]+$'
                AND date_trunc('month', data) = date_trunc('month', $3::date)`, [empresaId, dados.cliente_id, dados.data]);
          avisos.push(`O nº ${dados.numero_viagem} já foi usado por outra viagem desse cliente no mês; esta voltou como nº ${prox.rows[0].n}.`);
          dados.numero_viagem = prox.rows[0].n;
        }
      }
      if (item.tabela === 'fretes') {
        const n = await c.query(
          `SELECT 1 FROM fretes WHERE empresa_id = $1 AND numero_carga = $2 AND date_trunc('month', data) = date_trunc('month', $3::date)`,
          [empresaId, dados.numero_carga, dados.data]);
        if (n.rowCount) {
          const prox = await c.query(
            `SELECT (COALESCE(MAX(numero_carga::int), 0) + 1)::text AS n FROM fretes
              WHERE empresa_id = $1 AND numero_carga ~ '^[0-9]+$' AND date_trunc('month', data) = date_trunc('month', $2::date)`,
            [empresaId, dados.data]);
          avisos.push(`A carga nº ${dados.numero_carga} já foi usada no mês; este frete voltou como nº ${prox.rows[0].n}.`);
          dados.numero_carga = prox.rows[0].n;
        }
      }
      if (item.tabela === 'tabelas_precos') {
        const alvo = dados.cliente_id ? 'cliente_id' : dados.floresta_id ? 'floresta_id' : 'empreiteiro_id';
        const sobre = await c.query(
          `SELECT id, to_char(data_inicio, 'YYYY-MM-DD') AS ini, data_fim IS NULL AS aberto, data_inicio < $5::date AS antes
             FROM tabelas_precos
            WHERE empresa_id = $1 AND tipo = $2 AND classe_id = $3 AND ${alvo} = $4
              AND daterange(data_inicio, COALESCE(data_fim, 'infinity'::date), '[]')
               && daterange($5::date, COALESCE($6::date, 'infinity'::date), '[]')`,
          [empresaId, dados.tipo, dados.classe_id, dados[alvo], dados.data_inicio, dados.data_fim]);
        const outros = sobre.rows.filter((x) => !(x.aberto && x.antes));
        if (outros.length) {
          throw erroHttp(409, `Já existe outro preço para esse período (vigente desde ${dataBR(outros[0].ini)}). `
            + 'Ajuste ou exclua esse preço antes de restaurar.');
        }
        // O preço anterior que voltou a valer é encerrado de novo na véspera deste
        for (const x of sobre.rows) {
          await c.query('UPDATE tabelas_precos SET data_fim = $2::date - 1 WHERE id = $1', [x.id, dados.data_inicio]);
          avisos.push(`O preço anterior (desde ${dataBR(x.ini)}) foi encerrado em ${dataBR(new Date(new Date(`${dados.data_inicio}T12:00:00Z`) - 864e5).toISOString().slice(0, 10))}.`);
        }
      }

      await marcarAcao(c, 'RESTAURAR', `Estava na lixeira desde ${item.excluido_dia}. Motivo da exclusão: ${item.motivo}`);
      await inserirDeJSON(c, item.tabela, dados);
      if (item.tabela === 'viagens' && Array.isArray(item.dependentes)) {
        for (const d of item.dependentes) await inserirDeJSON(c, 'viagem_empreiteiros', d);
      }
      await marcarAcao(c, '', '');
      await c.query('DELETE FROM lixeira WHERE id = $1', [item.id]);
      return { tipo: TIPO_DA_TABELA[item.tabela], registro_id: dados.id, resumo: item.resumo, avisos, data: dados[TIPOS[TIPO_DA_TABELA[item.tabela]].data] };
    });
    res.json(r);
  } catch (err) {
    if (err.publico) return res.status(err.status).json({ erro: err.message });
    if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um registro igual (ticket ou número). Corrija o outro antes de restaurar.' });
    if (err.code === '23503') return res.status(409).json({ erro: 'Um cadastro ligado a este registro não existe mais. Não foi possível restaurar.' });
    next(err);
  }
});

module.exports = router;
