// =====================================================================
// FOLHA DE PAGAMENTO - Administrador e Financeiro (Visualização não vê)
//
//   GET  /api/folha?competencia=2026-01      folha do mês (a ABERTA é recalculada)
//   POST /api/folha/gerar    { competencia }  cria a linha de quem ainda não tem
//   PUT  /api/folha/:id      { salario_base, comissao, alimentacao, extras, desconto, observacoes, recalcular_comissao }
//   GET  /api/folha/:id/comissao              as cargas que formaram a comissão
//   POST /api/folha/fechar   { competencia }  congela os valores (guarda as cargas)
//   POST /api/folha/reabrir  { competencia }  (só Administrador; folha não paga)
//   POST /api/folha/pagar    { competencia, data, ids? }  -> despesa "Folha de pagamento" por funcionário
//   POST /api/folha/desfazer-pagamento { competencia }   (só Administrador)
//   GET  /api/folha/excel?competencia=        planilha da folha (igual à aba FOLHA)
//
//   GET    /api/folha/adiantamentos?funcionario_id=
//   POST   /api/folha/adiantamentos   { funcionario_id, data, valor, parcelas, primeira_competencia, descricao, lancar_despesa }
//   DELETE /api/folha/adiantamentos/:id   (só se nenhuma parcela caiu em folha fechada)
//
// Situação da folha: Aberta (acompanha os lançamentos) -> Fechada (valores
// congelados) -> Paga (gerou as despesas). Cada funcionário tem uma linha por mês.
// =====================================================================
const express = require('express');
const { body, param, query: q, validationResult } = require('express-validator');
const { pool, query } = require('../config/db');
const { autenticar, podeEditar, somenteAdmin } = require('../middlewares/auth');
const { lerNumero } = require('../utils/numeros');
const { novaPasta } = require('../utils/xlsx');
const calculo = require('../folha/calculo');

const router = express.Router();
router.use(autenticar, podeEditar);

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesTexto = (c) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const mesCurto = (c) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const somarMeses = (c, n) => {
  const [a, m] = c.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const r2 = calculo.r2;

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}
const regraCompetencia = (onde) => onde('competencia').matches(COMPETENCIA).withMessage('Informe a competência (mês/ano).');
const valorOk = (v) => v === undefined || v === null || v === '' || (Number.isFinite(lerNumero(v)) && lerNumero(v) >= 0);
const valor = (v) => (v === undefined || v === null || v === '' ? 0 : r2(lerNumero(v)));

async function categoria(c, empresaId, nome) {
  const r = await c.query('SELECT id FROM categorias_despesa WHERE empresa_id = $1 AND nome = $2', [empresaId, nome]);
  if (r.rowCount) return r.rows[0].id;
  return (await c.query('INSERT INTO categorias_despesa (empresa_id, nome) VALUES ($1, $2) RETURNING id', [empresaId, nome])).rows[0].id;
}
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

const SELECT_FOLHA = `
  SELECT x.id, x.competencia, x.funcionario_id, fu.nome, COALESCE(x.cargo, fu.cargo) AS cargo,
         to_char(fu.data_admissao, 'YYYY-MM-DD') AS data_admissao, fu.motorista_id, m.nome AS motorista,
         x.salario_base, x.comissao, x.comissao_manual, x.alimentacao, x.extras, x.adiantamento, x.desconto, x.saldo_pagar,
         x.observacoes, x.status, to_char(x.data_pagamento, 'YYYY-MM-DD') AS data_pagamento, x.despesa_id
    FROM folhas x JOIN funcionarios fu ON fu.id = x.funcionario_id LEFT JOIN motoristas m ON m.id = fu.motorista_id`;

// ---------------------------------------------------------------------
// FOLHA DO MÊS
// ---------------------------------------------------------------------
router.get('/', [regraCompetencia(q)], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const comp = req.query.competencia;
    await calculo.atualizarAbertas(e, comp);
    const [linhas, faltam] = await Promise.all([
      query(`${SELECT_FOLHA} WHERE x.empresa_id = $1 AND x.competencia = $2 ORDER BY (fu.motorista_id IS NULL), fu.nome`, [e, comp]),
      query(`SELECT count(*) AS n FROM funcionarios f WHERE f.empresa_id = $1 AND f.ativo
               AND (f.data_admissao IS NULL OR f.data_admissao <= $3::date)
               AND NOT EXISTS (SELECT 1 FROM folhas x WHERE x.funcionario_id = f.id AND x.competencia = $2)`, [e, comp, calculo.fimDoMes(comp)]),
    ]);
    // Pendências da comissão (cargas sem km / motorista sem faixa) das folhas abertas
    const itens = [];
    for (const l of linhas.rows) {
      let pend = null;
      if (l.status === 'Aberta' && l.motorista_id && !l.comissao_manual) {
        const c = await calculo.calcularComissao(e, { id: l.funcionario_id, motorista_id: l.motorista_id }, comp);
        pend = { cargas: c.cargas.length, sem_km: c.sem_km, sem_faixa: c.sem_faixa, toneladas: c.toneladas };
      }
      itens.push({ ...l, pendencias: pend });
    }
    const soma = (campo) => r2(itens.reduce((t, l) => t + Number(l[campo]), 0));
    const situacoes = [...new Set(itens.map((l) => l.status))];
    res.json({
      competencia: comp,
      linhas: itens,
      totais: {
        salario_base: soma('salario_base'), comissao: soma('comissao'), alimentacao: soma('alimentacao'), extras: soma('extras'),
        adiantamento: soma('adiantamento'), desconto: soma('desconto'), saldo_pagar: soma('saldo_pagar'),
      },
      situacao: !itens.length ? 'Vazia' : situacoes.length === 1 ? situacoes[0] : 'Mista',
      funcionarios_sem_folha: Number(faltam.rows[0].n),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/gerar', [regraCompetencia(body)], validar, async (req, res, next) => {
  try {
    const criadas = await calculo.gerarFolha(req.usuario.empresaId, req.body.competencia);
    res.json({ criadas });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/:id',
  [param('id').isInt({ min: 1 }),
    ...['salario_base', 'comissao', 'alimentacao', 'extras', 'desconto'].map((c) => body(c).optional().custom(valorOk).withMessage('Valor inválido.')),
    body('observacoes').optional({ values: 'null' }).isString().isLength({ max: 1000 })],
  validar,
  async (req, res, next) => {
    try {
      const e = req.usuario.empresaId;
      const atual = await query(`${SELECT_FOLHA} WHERE x.id = $1 AND x.empresa_id = $2`, [req.params.id, e]);
      if (!atual.rowCount) return res.status(404).json({ erro: 'Folha não encontrada.' });
      const f = atual.rows[0];
      if (f.status !== 'Aberta') return res.status(409).json({ erro: `A folha de ${mesCurto(f.competencia)} está ${f.status.toLowerCase()}: reabra para alterar.` });
      const b = req.body;
      let comissao = Number(f.comissao);
      let manual = f.comissao_manual;
      if (b.recalcular_comissao) {
        comissao = (await calculo.calcularComissao(e, { id: f.funcionario_id, motorista_id: f.motorista_id }, f.competencia)).total;
        manual = false;
      } else if (b.comissao !== undefined && valor(b.comissao) !== r2(f.comissao)) {
        comissao = valor(b.comissao);
        manual = true; // digitada à mão: não é mais recalculada sozinha
      }
      await query(
        `UPDATE folhas SET salario_base = $3, comissao = $4, comissao_manual = $5, alimentacao = $6, extras = $7, desconto = $8, observacoes = $9
          WHERE id = $1 AND empresa_id = $2`,
        [f.id, e, b.salario_base !== undefined ? valor(b.salario_base) : f.salario_base, comissao, manual,
          b.alimentacao !== undefined ? valor(b.alimentacao) : f.alimentacao, b.extras !== undefined ? valor(b.extras) : f.extras,
          b.desconto !== undefined ? valor(b.desconto) : f.desconto,
          b.observacoes !== undefined ? (typeof b.observacoes === 'string' && b.observacoes.trim() ? b.observacoes.trim() : null) : f.observacoes]);
      const { rows } = await query(`${SELECT_FOLHA} WHERE x.id = $1`, [f.id]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// As cargas que formaram a comissão (ao vivo se aberta; como foi fechada, se fechada)
router.get('/:id/comissao', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const { rows } = await query(`${SELECT_FOLHA.replace('x.observacoes,', 'x.observacoes, x.comissao_detalhe,')} WHERE x.id = $1 AND x.empresa_id = $2`, [req.params.id, e]);
    if (!rows.length) return res.status(404).json({ erro: 'Folha não encontrada.' });
    const f = rows[0];
    const detalhe = f.status !== 'Aberta' && f.comissao_detalhe
      ? f.comissao_detalhe
      : await calculo.calcularComissao(e, { id: f.funcionario_id, motorista_id: f.motorista_id }, f.competencia);
    res.json({ folha: { id: f.id, nome: f.nome, competencia: f.competencia, status: f.status, comissao: f.comissao, comissao_manual: f.comissao_manual, motorista: f.motorista }, ...detalhe });
  } catch (err) {
    next(err);
  }
});

router.post('/fechar', [regraCompetencia(body)], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const comp = req.body.competencia;
    await calculo.atualizarAbertas(e, comp);
    const abertas = (await query(`${SELECT_FOLHA} WHERE x.empresa_id = $1 AND x.competencia = $2 AND x.status = 'Aberta'`, [e, comp])).rows;
    if (!abertas.length) return res.status(409).json({ erro: 'Não há folha aberta neste mês.' });
    const detalhes = [];
    for (const f of abertas) detalhes.push(f.motorista_id ? await calculo.calcularComissao(e, { id: f.funcionario_id, motorista_id: f.motorista_id }, comp) : null);
    await emTransacao(async (c) => {
      for (let i = 0; i < abertas.length; i++) {
        await c.query("UPDATE folhas SET status = 'Fechada', comissao_detalhe = $2 WHERE id = $1", [abertas[i].id, detalhes[i] ? JSON.stringify(detalhes[i]) : null]);
      }
    });
    res.json({ fechadas: abertas.length });
  } catch (err) {
    next(err);
  }
});

router.post('/reabrir', somenteAdmin, [regraCompetencia(body)], validar, async (req, res, next) => {
  try {
    const r = await query("UPDATE folhas SET status = 'Aberta' WHERE empresa_id = $1 AND competencia = $2 AND status = 'Fechada'",
      [req.usuario.empresaId, req.body.competencia]);
    if (!r.rowCount) return res.status(409).json({ erro: 'Não há folha fechada (e não paga) neste mês.' });
    res.json({ reabertas: r.rowCount });
  } catch (err) {
    next(err);
  }
});

// Pagar: cria uma despesa "Folha de pagamento" (paga) por funcionário com saldo
router.post(
  '/pagar',
  [regraCompetencia(body), body('data').isISO8601().withMessage('Informe a data do pagamento.'), body('ids').optional().isArray()],
  validar,
  async (req, res, next) => {
    try {
      const e = req.usuario.empresaId;
      const comp = req.body.competencia;
      const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
      const fechadas = (await query(`${SELECT_FOLHA} WHERE x.empresa_id = $1 AND x.competencia = $2 AND x.status = 'Fechada'
                                      ${ids ? 'AND x.id = ANY($3::int[])' : ''}`, ids ? [e, comp, ids] : [e, comp])).rows;
      if (!fechadas.length) return res.status(409).json({ erro: 'Feche a folha antes de pagar (só a folha fechada pode ser paga).' });
      const r = await emTransacao(async (c) => {
        const cat = await categoria(c, e, 'Folha de pagamento');
        let total = 0;
        for (const f of fechadas) {
          let despesaId = null;
          if (Number(f.saldo_pagar) > 0) {
            const d = await c.query(
              `INSERT INTO despesas (empresa_id, categoria_id, data, descricao, favorecido, valor, status, data_pagamento, observacoes, criado_por)
               VALUES ($1, $2, $3, $4, $5, $6, 'Pago', $3, $7, $8) RETURNING id`,
              [e, cat, req.body.data, `Folha ${mesCurto(comp)} · ${f.nome}`.slice(0, 255), f.nome.slice(0, 150), f.saldo_pagar,
                'Gerada pela folha de pagamento', req.usuario.id]);
            despesaId = d.rows[0].id;
            total += Number(f.saldo_pagar);
          }
          await c.query("UPDATE folhas SET status = 'Paga', data_pagamento = $2, despesa_id = $3 WHERE id = $1", [f.id, req.body.data, despesaId]);
        }
        return { pagas: fechadas.length, total: r2(total) };
      });
      res.json(r);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/desfazer-pagamento', somenteAdmin, [regraCompetencia(body)], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const r = await emTransacao(async (c) => {
      const pagas = await c.query("SELECT id, despesa_id FROM folhas WHERE empresa_id = $1 AND competencia = $2 AND status = 'Paga' FOR UPDATE", [e, req.body.competencia]);
      for (const f of pagas.rows) {
        await c.query("UPDATE folhas SET status = 'Fechada', data_pagamento = NULL, despesa_id = NULL WHERE id = $1", [f.id]);
        if (f.despesa_id) await c.query('DELETE FROM despesas WHERE id = $1 AND empresa_id = $2', [f.despesa_id, e]);
      }
      return pagas.rowCount;
    });
    if (!r) return res.status(409).json({ erro: 'Não há folha paga neste mês.' });
    res.json({ desfeitas: r });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// EXCEL (igual à aba FOLHA da planilha + as comissões e os adiantamentos)
// ---------------------------------------------------------------------
router.get('/excel', [regraCompetencia(q)], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const comp = req.query.competencia;
    await calculo.atualizarAbertas(e, comp);
    const [emp, quem, folha, parcelas] = await Promise.all([
      query('SELECT nome, razao_social, cnpj, logo FROM empresas WHERE id = $1', [e]),
      query('SELECT nome FROM usuarios WHERE id = $1', [req.usuario.id]),
      query(`${SELECT_FOLHA.replace('x.observacoes,', 'x.observacoes, x.comissao_detalhe,')} WHERE x.empresa_id = $1 AND x.competencia = $2 ORDER BY (fu.motorista_id IS NULL), fu.nome`, [e, comp]),
      query(`SELECT fu.nome, to_char(a.data, 'YYYY-MM-DD') AS data, a.descricao, a.valor AS total, a.parcelas, p.numero, p.valor
               FROM adiantamento_parcelas p JOIN adiantamentos a ON a.id = p.adiantamento_id JOIN funcionarios fu ON fu.id = a.funcionario_id
              WHERE a.empresa_id = $1 AND p.competencia = $2 ORDER BY fu.nome, a.data`, [e, comp]),
    ]);
    const em = emp.rows[0];
    const cnpj = String(em.cnpj || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const topo = (titulo) => ({
      titulo: `${titulo} — ${mesTexto(comp)}`,
      subtitulo: [em.razao_social || em.nome, cnpj && `CNPJ ${cnpj}`].filter(Boolean).join(' · '),
      notas: [`Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${quem.rows[0]?.nome || ''} · Xylo`],
      logo: em.logo,
    });
    const pasta = novaPasta();
    pasta.aba('Folha', {
      ...topo('Folha de pagamento'),
      colunas: [
        { titulo: 'Funcionário', campo: 'nome', largura: 28 },
        { titulo: 'Cargo', campo: 'cargo', largura: 14 },
        { titulo: 'Admissão', campo: 'data_admissao', formato: 'data', largura: 11 },
        { titulo: 'Comp.', valor: () => mesCurto(comp), largura: 9 },
        { titulo: 'Salário base', campo: 'salario_base', formato: 'moeda', total: 'soma', largura: 14 },
        { titulo: 'Comissão', campo: 'comissao', formato: 'moeda', total: 'soma', largura: 13 },
        { titulo: 'Alimentação', campo: 'alimentacao', formato: 'moeda', total: 'soma', largura: 13 },
        { titulo: 'Extras', campo: 'extras', formato: 'moeda', total: 'soma', largura: 11 },
        { titulo: 'Adto', campo: 'adiantamento', formato: 'moeda', total: 'soma', largura: 11 },
        { titulo: 'Desconto', campo: 'desconto', formato: 'moeda', total: 'soma', largura: 11 },
        { titulo: 'Saldo a pagar', campo: 'saldo_pagar', formato: 'moeda', total: 'soma', largura: 15 },
        { titulo: 'Situação', campo: 'status', largura: 10 },
        { titulo: 'Observações', campo: 'observacoes', largura: 34 },
      ],
      linhas: folha.rows,
      total: true,
    });
    // Comissões: carga por carga
    const cargas = [];
    for (const f of folha.rows.filter((x) => x.motorista_id)) {
      const d = f.status !== 'Aberta' && f.comissao_detalhe ? f.comissao_detalhe
        : await calculo.calcularComissao(e, { id: f.funcionario_id, motorista_id: f.motorista_id }, comp);
      d.cargas.forEach((c) => cargas.push({ ...c, nome: f.nome, descricao: c.tipo === 'viagem' ? `Viagem nº ${c.numero}` : `Frete nº ${c.numero}`,
        rota: [c.origem, c.destino].filter(Boolean).join(' → '), obs: c.pendencia === 'sem_km' ? 'SEM KM: cadastre a rota' : c.pendencia === 'sem_faixa' ? 'SEM FAIXA para esta distância' : '' }));
    }
    if (cargas.length) {
      pasta.aba('Comissões', {
        ...topo('Comissão dos motoristas'),
        colunas: [
          { titulo: 'Motorista', campo: 'nome', largura: 26 }, { titulo: 'Data', campo: 'data', formato: 'data', largura: 11 },
          { titulo: 'Carga', campo: 'descricao', largura: 14 }, { titulo: 'Rota', campo: 'rota', largura: 34 },
          { titulo: 'Km', campo: 'km', formato: 'decimal', largura: 9 }, { titulo: 'Faixa', campo: 'faixa', largura: 16 },
          { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 11 },
          { titulo: 'R$/t', campo: 'valor_tonelada', formato: 'moeda', largura: 10 },
          { titulo: 'Comissão', campo: 'valor', formato: 'moeda', total: 'soma', largura: 13 },
          { titulo: 'Observação', campo: 'obs', largura: 28 },
        ],
        linhas: cargas,
        total: true,
      });
    }
    if (parcelas.rows.length) {
      pasta.aba('Adiantamentos', {
        ...topo('Adiantamentos descontados'),
        colunas: [
          { titulo: 'Funcionário', campo: 'nome', largura: 26 }, { titulo: 'Data do adiantamento', campo: 'data', formato: 'data', largura: 14 },
          { titulo: 'Descrição', campo: 'descricao', largura: 28 }, { titulo: 'Valor total', campo: 'total', formato: 'moeda', largura: 13 },
          { titulo: 'Parcela', valor: (l) => `${l.numero}/${l.parcelas}`, largura: 9 },
          { titulo: 'Descontado no mês', campo: 'valor', formato: 'moeda', total: 'soma', largura: 16 },
        ],
        linhas: parcelas.rows,
        total: true,
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="folha-${comp}.xlsx"`);
    res.send(pasta.gerar());
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// ADIANTAMENTOS (parcelados)
// ---------------------------------------------------------------------
// Situação de cada parcela: descontada (folha fechada/paga), na folha aberta, ou a descontar
router.get('/adiantamentos', [q('funcionario_id').optional({ values: 'falsy' }).isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const { rows } = await query(
      `SELECT a.id, a.funcionario_id, fu.nome, to_char(a.data, 'YYYY-MM-DD') AS data, a.valor, a.parcelas, a.descricao, a.despesa_id,
              json_agg(json_build_object('numero', p.numero, 'competencia', p.competencia, 'valor', p.valor,
                       'situacao', COALESCE((SELECT CASE WHEN fo.status = 'Aberta' THEN 'na folha aberta' ELSE 'descontada' END
                                               FROM folhas fo WHERE fo.funcionario_id = a.funcionario_id AND fo.competencia = p.competencia), 'a descontar'))
                       ORDER BY p.numero) AS lista
         FROM adiantamentos a JOIN funcionarios fu ON fu.id = a.funcionario_id JOIN adiantamento_parcelas p ON p.adiantamento_id = a.id
        WHERE a.empresa_id = $1 AND ($2::int IS NULL OR a.funcionario_id = $2)
        GROUP BY a.id, fu.nome ORDER BY a.data DESC, a.id DESC`, [e, req.query.funcionario_id || null]);
    res.json(rows.map((a) => {
      const descontado = r2(a.lista.filter((p) => p.situacao === 'descontada').reduce((t, p) => t + Number(p.valor), 0));
      return { ...a, descontado, restante: r2(Number(a.valor) - descontado) };
    }));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/adiantamentos',
  [body('funcionario_id').isInt({ min: 1 }).withMessage('Escolha o funcionário.'),
    body('data').isISO8601().withMessage('Informe a data do adiantamento.'),
    body('valor').custom((v) => Number.isFinite(lerNumero(v)) && lerNumero(v) > 0).withMessage('Informe o valor do adiantamento.'),
    body('parcelas').optional({ values: 'falsy' }).isInt({ min: 1, max: 36 }).withMessage('Parcelas: de 1 a 36.'),
    regraCompetencia(body).bail(),
    body('descricao').optional({ values: 'null' }).isString().isLength({ max: 200 })],
  validar,
  async (req, res, next) => {
    try {
      const e = req.usuario.empresaId;
      const b = req.body;
      // a 1ª parcela vem em "competencia" (o mês em que começa o desconto)
      const parcelas = Number(b.parcelas) || 1;
      const total = r2(lerNumero(b.valor));
      const func = await query('SELECT id, nome FROM funcionarios WHERE id = $1 AND empresa_id = $2', [b.funcionario_id, e]);
      if (!func.rowCount) return res.status(400).json({ erro: 'Funcionário inválido.' });
      const comps = Array.from({ length: parcelas }, (_, i) => somarMeses(b.competencia, i));
      const travada = await query(`SELECT competencia FROM folhas WHERE funcionario_id = $1 AND competencia = ANY($2) AND status <> 'Aberta' ORDER BY competencia LIMIT 1`,
        [b.funcionario_id, comps]);
      if (travada.rowCount) {
        return res.status(409).json({ erro: `A folha de ${mesCurto(travada.rows[0].competencia)} deste funcionário já foi fechada: comece o desconto num mês seguinte.` });
      }
      const base = Math.floor((total / parcelas) * 100) / 100;
      const valores = comps.map((_, i) => (i === parcelas - 1 ? r2(total - base * (parcelas - 1)) : base));
      const r = await emTransacao(async (c) => {
        let despesaId = null;
        if (b.lancar_despesa) {
          const cat = await categoria(c, e, 'Adiantamento');
          const d = await c.query(
            `INSERT INTO despesas (empresa_id, categoria_id, data, descricao, favorecido, valor, status, data_pagamento, observacoes, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, 'Pago', $3, $7, $8) RETURNING id`,
            [e, cat, b.data, `Adiantamento · ${func.rows[0].nome}${parcelas > 1 ? ` (${parcelas}x)` : ''}`.slice(0, 255), func.rows[0].nome.slice(0, 150),
              total, [b.descricao, 'Gerada pelo adiantamento da folha'].filter(Boolean).join(' · '), req.usuario.id]);
          despesaId = d.rows[0].id;
        }
        const a = await c.query(
          `INSERT INTO adiantamentos (empresa_id, funcionario_id, data, valor, parcelas, descricao, despesa_id, criado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [e, b.funcionario_id, b.data, total, parcelas, typeof b.descricao === 'string' && b.descricao.trim() ? b.descricao.trim() : null, despesaId, req.usuario.id]);
        for (let i = 0; i < parcelas; i++) {
          await c.query('INSERT INTO adiantamento_parcelas (adiantamento_id, numero, competencia, valor) VALUES ($1, $2, $3, $4)',
            [a.rows[0].id, i + 1, comps[i], valores[i]]);
        }
        return { id: a.rows[0].id, parcelas: comps.map((comp, i) => ({ competencia: comp, valor: valores[i] })) };
      });
      res.status(201).json(r);
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/adiantamentos/:id', [param('id').isInt({ min: 1 })], validar, async (req, res, next) => {
  try {
    const e = req.usuario.empresaId;
    const a = await query('SELECT id, funcionario_id, despesa_id FROM adiantamentos WHERE id = $1 AND empresa_id = $2', [req.params.id, e]);
    if (!a.rowCount) return res.status(404).json({ erro: 'Adiantamento não encontrado.' });
    const travada = await query(
      `SELECT p.competencia FROM adiantamento_parcelas p JOIN folhas fo ON fo.funcionario_id = $2 AND fo.competencia = p.competencia AND fo.status <> 'Aberta'
        WHERE p.adiantamento_id = $1 LIMIT 1`, [req.params.id, a.rows[0].funcionario_id]);
    if (travada.rowCount) return res.status(409).json({ erro: `Uma parcela já foi descontada na folha de ${mesCurto(travada.rows[0].competencia)} (fechada): não dá para excluir.` });
    await emTransacao(async (c) => {
      await c.query('DELETE FROM adiantamentos WHERE id = $1', [req.params.id]);
      if (a.rows[0].despesa_id) await c.query('DELETE FROM despesas WHERE id = $1 AND empresa_id = $2', [a.rows[0].despesa_id, e]);
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
