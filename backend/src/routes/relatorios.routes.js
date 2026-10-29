// =====================================================================
// RELATÓRIOS (somente leitura - todos os perfis podem ver)
//
//   GET /api/relatorios/fechamento?mes=2026-01    faturamento - despesas = resultado
//   GET /api/relatorios/clientes?mes=2026-01      por cliente (serraria)
//   GET /api/relatorios/florestas?mes=2026-01     por floresta: vendido, a pagar, pago, saldo
//   GET /api/relatorios/empreiteiros?mes=2026-01  por empreiteiro: produção - despesas = líquido
//   GET /api/relatorios/classes?mes=2026-01       totalização mensal por classe
//   GET /api/relatorios/anual?ano=2026            mês a mês do ano
//   GET /api/relatorios/evolucao?ate=2026-01      últimos 12 meses (painel inicial)
//   GET /api/relatorios/diario?mes=2026-01        dia a dia do mês (painel inicial)
//
// Viagens e fretes cancelados e despesas canceladas ficam fora de tudo.
// =====================================================================
const express = require('express');
const { query: q, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}

const exigeMes = [q('mes').matches(/^\d{4}-\d{2}$/).withMessage('Informe o mês (AAAA-MM).'), validar];

// Soma uma coluna numérica de uma lista de linhas (os NUMERIC chegam como texto)
const somar = (linhas, campo) => linhas.reduce((t, l) => t + Number(l[campo] || 0), 0);
const dinheiro = (n) => Math.round(n * 100) / 100;

// Envolve uma função de dados numa rota que responde JSON
const rota = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------
// FECHAMENTO DO MÊS (como a aba FECHAMENTO da planilha)
// Faturamento (madeira + fretes) - despesas lançadas = resultado.
// Os custos calculados pela tabela de preços (florestas e empreiteiros)
// aparecem à parte, como previsão: entram no resultado quando são pagos
// e lançados em Despesas.
// ---------------------------------------------------------------------
async function dadosFechamento(empresaId, mes) {
  const p = [empresaId, mes];
  const [clientes, fretes, despesas, custos] = await Promise.all([
    query(`SELECT cliente, qtd_viagens, toneladas, valor_total FROM vw_relatorio_cliente
            WHERE empresa_id = $1 AND mes = $2 ORDER BY valor_total DESC`, p),
    query(`SELECT COUNT(*)::int AS qtd, COALESCE(SUM(toneladas), 0) AS toneladas, COALESCE(SUM(valor_total), 0) AS valor
             FROM fretes WHERE empresa_id = $1 AND to_char(data, 'YYYY-MM') = $2 AND status_pagamento <> 'Cancelado'`, p),
    query(`SELECT c.nome AS categoria, COUNT(*)::int AS qtd, SUM(d.valor) AS valor
             FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
            WHERE d.empresa_id = $1 AND to_char(d.data, 'YYYY-MM') = $2 AND d.status <> 'Cancelado'
            GROUP BY c.nome ORDER BY SUM(d.valor) DESC`, p),
    query(`SELECT
             (SELECT COALESCE(SUM(total_floresta), 0) FROM viagens
               WHERE empresa_id = $1 AND to_char(data, 'YYYY-MM') = $2 AND status <> 'Cancelada') AS florestas,
             (SELECT COALESCE(SUM(valor_total), 0) FROM vw_viagem_empreiteiros
               WHERE empresa_id = $1 AND to_char(data, 'YYYY-MM') = $2) AS empreiteiros`, p),
  ]);

  const madeira = somar(clientes.rows, 'valor_total');
  const toneladasMadeira = somar(clientes.rows, 'toneladas');
  const valorFretes = Number(fretes.rows[0].valor);
  const faturamento = madeira + valorFretes;
  const totalDespesas = somar(despesas.rows, 'valor');

  return ({
    mes,
    madeira: { por_cliente: clientes.rows, viagens: somar(clientes.rows, 'qtd_viagens'), toneladas: dinheiro(toneladasMadeira), valor: dinheiro(madeira) },
    fretes: { qtd: fretes.rows[0].qtd, toneladas: Number(fretes.rows[0].toneladas), valor: dinheiro(valorFretes) },
    faturamento: dinheiro(faturamento),
    toneladas_total: dinheiro(toneladasMadeira + Number(fretes.rows[0].toneladas)),
    despesas: { por_categoria: despesas.rows, valor: dinheiro(totalDespesas) },
    resultado: dinheiro(faturamento - totalDespesas),
    custos_previstos: {
      florestas: Number(custos.rows[0].florestas),
      empreiteiros: Number(custos.rows[0].empreiteiros),
    },
  });
}
router.get('/fechamento', exigeMes, rota((req) => dadosFechamento(req.usuario.empresaId, req.query.mes)));

// ---------------------------------------------------------------------
// POR CLIENTE (serraria)
// ---------------------------------------------------------------------
async function dadosClientes(empresaId, mes) {
  const { rows } = await query(
    `SELECT cliente_id AS id, cliente AS nome, qtd_viagens, toneladas, valor_total,
            ROUND(valor_total / NULLIF(toneladas, 0), 2) AS preco_medio
       FROM vw_relatorio_cliente WHERE empresa_id = $1 AND mes = $2
      ORDER BY valor_total DESC`,
    [empresaId, mes]
  );
  return rows;
}
router.get('/clientes', exigeMes, rota((req) => dadosClientes(req.usuario.empresaId, req.query.mes)));

// ---------------------------------------------------------------------
// POR FLORESTA
// Vendido, a pagar à floresta (pela tabela de COMPRA), pago no mês
// (despesas ligadas à floresta) e saldo.
// ---------------------------------------------------------------------
async function dadosFlorestas(empresaId, mes) {
  const { rows } = await query(
    `WITH pagos AS (
       SELECT floresta_id, SUM(valor) AS pago
         FROM despesas
        WHERE empresa_id = $1 AND to_char(data, 'YYYY-MM') = $2 AND status <> 'Cancelado' AND floresta_id IS NOT NULL
        GROUP BY floresta_id
     ), producao AS (
       SELECT floresta_id, qtd_viagens, toneladas, valor_vendido, valor_a_pagar_floresta
         FROM vw_relatorio_floresta WHERE empresa_id = $1 AND mes = $2
     )
     SELECT f.id, f.nome,
            COALESCE(pr.qtd_viagens, 0) AS qtd_viagens,
            COALESCE(pr.toneladas, 0) AS toneladas,
            COALESCE(pr.valor_vendido, 0) AS valor_vendido,
            COALESCE(pr.valor_a_pagar_floresta, 0) AS a_pagar,
            COALESCE(pg.pago, 0) AS pago,
            COALESCE(pr.valor_a_pagar_floresta, 0) - COALESCE(pg.pago, 0) AS saldo
       FROM producao pr
       FULL JOIN pagos pg ON pg.floresta_id = pr.floresta_id
       JOIN florestas f ON f.id = COALESCE(pr.floresta_id, pg.floresta_id)
      ORDER BY COALESCE(pr.toneladas, 0) DESC, f.nome`,
    [empresaId, mes]
  );
  return rows;
}
router.get('/florestas', exigeMes, rota((req) => dadosFlorestas(req.usuario.empresaId, req.query.mes)));

// ---------------------------------------------------------------------
// POR EMPREITEIRO
// Produção (pela tabela de EMPREITADA) - despesas ligadas a ele
// (adiantamentos, pagamentos) = líquido a pagar.
// ---------------------------------------------------------------------
async function dadosEmpreiteiros(empresaId, mes) {
  const { rows } = await query(
    `SELECT empreiteiro_id AS id, empreiteiro AS nome, qtd_viagens, toneladas,
            valor_bruto, despesas, liquido
       FROM vw_relatorio_empreiteiro WHERE empresa_id = $1 AND mes = $2
      ORDER BY toneladas DESC, empreiteiro`,
    [empresaId, mes]
  );
  return rows;
}
router.get('/empreiteiros', exigeMes, rota((req) => dadosEmpreiteiros(req.usuario.empresaId, req.query.mes)));

// ---------------------------------------------------------------------
// TOTALIZAÇÃO MENSAL POR CLASSE (lixo, fina, média, grossa...)
// ---------------------------------------------------------------------
async function dadosClasses(empresaId, mes) {
  const { rows } = await query(
    `SELECT classe AS nome, qtd_viagens, toneladas, valor_total,
            ROUND(valor_total / NULLIF(toneladas, 0), 2) AS preco_medio,
            custo_floresta
       FROM vw_totalizacao_mensal
      WHERE empresa_id = $1 AND mes = $2 AND classe <> 'TOTAL'
      ORDER BY toneladas DESC`,
    [empresaId, mes]
  );
  return rows;
}
router.get('/classes', exigeMes, rota((req) => dadosClasses(req.usuario.empresaId, req.query.mes)));

// ---------------------------------------------------------------------
// Mês a mês entre dois meses (inclusive). Meses sem movimento vêm zerados.
// Usado pelo ANUAL e pela EVOLUÇÃO do painel inicial.
// ---------------------------------------------------------------------
function mesAMes(empresaId, inicio, fim) {
  return query(
    `WITH meses AS (
       SELECT to_char(m, 'YYYY-MM') AS mes
         FROM generate_series(to_date($2, 'YYYY-MM'), to_date($3, 'YYYY-MM'), interval '1 month') AS m
     ), periodo AS (
       SELECT to_date($2, 'YYYY-MM') AS ini, (to_date($3, 'YYYY-MM') + interval '1 month')::date AS fim
     ), mad AS (
       SELECT to_char(data, 'YYYY-MM') AS mes, COUNT(*) AS viagens, SUM(peso_liquido) AS toneladas, SUM(valor_total) AS madeira
         FROM viagens, periodo WHERE empresa_id = $1 AND data >= ini AND data < fim AND status <> 'Cancelada' GROUP BY 1
     ), fre AS (
       SELECT to_char(data, 'YYYY-MM') AS mes, SUM(valor_total) AS fretes
         FROM fretes, periodo WHERE empresa_id = $1 AND data >= ini AND data < fim AND status_pagamento <> 'Cancelado' GROUP BY 1
     ), des AS (
       SELECT to_char(data, 'YYYY-MM') AS mes, SUM(valor) AS despesas
         FROM despesas, periodo WHERE empresa_id = $1 AND data >= ini AND data < fim AND status <> 'Cancelado' GROUP BY 1
     )
     SELECT m.mes,
            COALESCE(mad.viagens, 0)::int AS viagens,
            COALESCE(mad.toneladas, 0) AS toneladas,
            COALESCE(mad.madeira, 0) AS madeira,
            COALESCE(fre.fretes, 0) AS fretes,
            COALESCE(mad.madeira, 0) + COALESCE(fre.fretes, 0) AS faturamento,
            COALESCE(des.despesas, 0) AS despesas,
            COALESCE(mad.madeira, 0) + COALESCE(fre.fretes, 0) - COALESCE(des.despesas, 0) AS resultado
       FROM meses m
       LEFT JOIN mad ON mad.mes = m.mes
       LEFT JOIN fre ON fre.mes = m.mes
       LEFT JOIN des ON des.mes = m.mes
      ORDER BY m.mes`,
    [empresaId, inicio, fim]
  );
}

// ANUAL: os 12 meses do ano
async function dadosAnual(empresaId, ano) {
  const { rows } = await mesAMes(empresaId, `${ano}-01`, `${ano}-12`);
  return rows;
}
const exigeAno = [q('ano').isInt({ min: 2000, max: 2100 }).withMessage('Informe o ano.'), validar];
router.get('/anual', exigeAno, rota((req) => dadosAnual(req.usuario.empresaId, Number(req.query.ano))));

// EVOLUÇÃO: os últimos N meses até o mês informado (painel inicial)
//   GET /api/relatorios/evolucao?ate=2026-01&meses=12
router.get(
  '/evolucao',
  [q('ate').matches(/^\d{4}-\d{2}$/).withMessage('Informe o mês final (AAAA-MM).'),
    q('meses').optional().isInt({ min: 1, max: 36 }).withMessage('Entre 1 e 36 meses.'), validar],
  async (req, res, next) => {
    try {
      const meses = Number(req.query.meses || 12);
      const [ano, mes] = req.query.ate.split('-').map(Number);
      const inicio = new Date(Date.UTC(ano, mes - meses, 1)).toISOString().slice(0, 7);
      const { rows } = await mesAMes(req.usuario.empresaId, inicio, req.query.ate);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// DIÁRIO: viagens, toneladas e valor de cada dia do mês (dias sem viagem vêm zerados)
//   GET /api/relatorios/diario?mes=2026-01
// ---------------------------------------------------------------------
router.get('/diario', exigeMes, async (req, res, next) => {
  try {
    const { rows } = await query(
      `WITH dias AS (
         SELECT d::date AS dia
           FROM generate_series(to_date($2, 'YYYY-MM'), (to_date($2, 'YYYY-MM') + interval '1 month - 1 day'), interval '1 day') AS d
       )
       SELECT to_char(dias.dia, 'YYYY-MM-DD') AS dia,
              COUNT(v.id)::int AS viagens,
              COALESCE(SUM(v.peso_liquido), 0) AS toneladas,
              COALESCE(SUM(v.valor_total), 0) AS valor
         FROM dias
         LEFT JOIN viagens v ON v.data = dias.dia AND v.empresa_id = $1 AND v.status <> 'Cancelada'
        GROUP BY dias.dia ORDER BY dias.dia`,
      [req.usuario.empresaId, req.query.mes]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// As mesmas consultas, para a exportação em Excel (src/routes/exportacao.routes.js)
module.exports.dados = { dadosFechamento, dadosClientes, dadosFlorestas, dadosEmpreiteiros, dadosClasses, dadosAnual };
