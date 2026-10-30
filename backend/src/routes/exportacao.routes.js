// =====================================================================
// EXPORTAÇÃO EM EXCEL (.xlsx) - todos os perfis podem baixar
//
//   GET /api/exportacao/relatorio?tipo=fechamento|clientes|florestas|empreiteiros|classes&mes=2026-01
//   GET /api/exportacao/relatorio?tipo=anual&ano=2026
//   GET /api/exportacao/dre?de=2026-01&ate=2026-12&comparar=anterior&mensal=1   (DRE com fórmulas)
//
// A planilha sai pronta para usar: logo e dados da empresa no topo, cabeçalho
// congelado com filtro, valores em R$, datas, linha de TOTAL com fórmulas SOMA
// (se mexer nos números no Excel, o total acompanha) e abas extras com o
// detalhe do mês (viagens, fretes, despesas).
// =====================================================================
const express = require('express');
const { query: q, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar } = require('../middlewares/auth');
const { novaPasta, letra } = require('../utils/xlsx');
const DRE = require('../relatorios/dre');
const { dados } = require('./relatorios.routes');

const router = express.Router();
router.use(autenticar);

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const cnpjFormatado = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const pct = (parte, todo) => (Number(todo) ? Number(parte) / Number(todo) : null);

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}

// Viagens do mês (detalhe) - mesma visão da tela de Viagens, com os 3 preços
async function viagensDoMes(empresaId, mes, filtro = '') {
  const { rows } = await query(
    `SELECT to_char(v.data,'YYYY-MM-DD') AS data, v.numero_viagem, v.ticket, v.placa,
            c.nome AS cliente, f.nome AS floresta, e.nome AS empreiteiro, cm.nome AS classe,
            v.peso_liquido, v.valor_tonelada, v.valor_total,
            v.valor_ton_floresta, v.total_floresta, v.valor_ton_empreiteiro, v.total_empreiteiro, v.observacoes,
            to_char(v.hora_pesagem, 'HH24:MI') AS hora_pesagem, m.nome AS motorista
       FROM viagens v
       LEFT JOIN motoristas m ON m.id = v.motorista_id
       JOIN clientes c ON c.id = v.cliente_id JOIN florestas f ON f.id = v.floresta_id
       LEFT JOIN empreiteiros e ON e.id = v.empreiteiro_id JOIN classes_madeira cm ON cm.id = v.classe_id
      WHERE v.empresa_id = $1 AND to_char(v.data,'YYYY-MM') = $2 AND v.status <> 'Cancelada' ${filtro}
      ORDER BY v.data, c.nome, v.id`, [empresaId, mes]);
  return rows;
}
const COLUNAS_VIAGENS = [
  { titulo: 'Data', campo: 'data', formato: 'data', largura: 11 },
  { titulo: 'Nº', campo: 'numero_viagem', largura: 6 },
  { titulo: 'Ticket', campo: 'ticket', largura: 10 },
  { titulo: 'Placa', campo: 'placa', largura: 10 },
  { titulo: 'Motorista', campo: 'motorista', largura: 16 },
  { titulo: 'Horário pesagem', campo: 'hora_pesagem', largura: 9 },
  { titulo: 'Cliente', campo: 'cliente', largura: 22 },
  { titulo: 'Floresta', campo: 'floresta', largura: 20 },
  { titulo: 'Empreiteiro', campo: 'empreiteiro', largura: 18 },
  { titulo: 'Classe', campo: 'classe', largura: 11 },
  { titulo: 'Peso (t)', campo: 'peso_liquido', formato: 'decimal', total: 'soma', largura: 11 },
  { titulo: 'Venda R$/t', campo: 'valor_tonelada', formato: 'moeda', largura: 13 },
  { titulo: 'Venda total', campo: 'valor_total', formato: 'moeda', total: 'soma', largura: 15 },
  { titulo: 'Compra R$/t', campo: 'valor_ton_floresta', formato: 'moeda', largura: 13 },
  { titulo: 'Compra total', campo: 'total_floresta', formato: 'moeda', total: 'soma', largura: 15 },
  { titulo: 'Empreitada R$/t', campo: 'valor_ton_empreiteiro', formato: 'moeda', largura: 15 },
  { titulo: 'Empreitada total', campo: 'total_empreiteiro', formato: 'moeda', total: 'soma', largura: 16 },
  { titulo: 'Observações', campo: 'observacoes', largura: 30 },
];

router.get(
  '/relatorio',
  [
    q('tipo').isIn(['fechamento', 'clientes', 'florestas', 'empreiteiros', 'classes', 'anual']).withMessage('Tipo de relatório inválido.'),
    q('mes').if(q('tipo').not().equals('anual')).matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Informe o mês (AAAA-MM).'),
    q('ano').if(q('tipo').equals('anual')).isInt({ min: 2000, max: 2100 }).withMessage('Informe o ano.'),
  ],
  validar,
  async (req, res, next) => {
    try {
      const { tipo, mes } = req.query;
      const ano = Number(req.query.ano);
      const id = req.usuario.empresaId;
      const [emp, quem] = await Promise.all([
        query('SELECT nome, razao_social, cnpj, cidade, uf, logo FROM empresas WHERE id = $1', [id]),
        query('SELECT nome FROM usuarios WHERE id = $1', [req.usuario.id]),
      ]);
      const e = emp.rows[0];
      const periodo = tipo === 'anual' ? `ano de ${ano}` : nomeMes(mes);
      const empresaLinha = [e.razao_social || e.nome, e.cnpj ? `CNPJ ${cnpjFormatado(e.cnpj)}` : '', [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ');
      const emitido = `Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${quem.rows[0]?.nome || ''} · Xylo`;
      const topo = (titulo) => ({ titulo: `${titulo} — ${periodo}`, subtitulo: empresaLinha, notas: [emitido], logo: e.logo });
      const pasta = novaPasta();

      if (tipo === 'fechamento') {
        const d = await dados.dadosFechamento(id, mes);
        const linhas = [
          ...d.madeira.por_cliente.map((c) => ({ grupo: 'Faturamento (+)', item: `Madeira · ${c.cliente}`, qtd: Number(c.qtd_viagens), ton: c.toneladas, valor: c.valor_total })),
          ...(d.fretes.qtd ? [{ grupo: 'Faturamento (+)', item: 'Fretes', qtd: d.fretes.qtd, ton: d.fretes.toneladas, valor: d.fretes.valor }] : []),
          { grupo: 'Faturamento (+)', item: 'TOTAL DO FATURAMENTO', ton: d.toneladas_total, valor: d.faturamento },
          ...d.despesas.por_categoria.map((c) => ({ grupo: 'Despesas (−)', item: c.categoria, qtd: c.qtd, valor: -Number(c.valor) })),
          { grupo: 'Despesas (−)', item: 'TOTAL DAS DESPESAS', valor: -d.despesas.valor },
          { grupo: 'Resultado (=)', item: 'FATURAMENTO − DESPESAS', valor: d.resultado },
          { grupo: 'Previsão', item: 'A pagar às florestas (valores das viagens)', valor: d.custos_previstos.florestas },
          { grupo: 'Previsão', item: 'A pagar aos empreiteiros (valores das viagens)', valor: d.custos_previstos.empreiteiros },
        ];
        pasta.aba('Fechamento', {
          ...topo('Fechamento do mês'),
          colunas: [
            { titulo: 'Grupo', campo: 'grupo', largura: 18 },
            { titulo: 'Item', campo: 'item', largura: 42 },
            { titulo: 'Quantidade', campo: 'qtd', formato: 'inteiro', largura: 12 },
            { titulo: 'Toneladas', campo: 'ton', formato: 'decimal', largura: 12 },
            { titulo: 'Valor', campo: 'valor', formato: 'moeda', largura: 18 },
            { titulo: '% do faturamento', valor: (l) => (l.grupo === 'Previsão' ? null : pct(Math.abs(l.valor), d.faturamento)), formato: 'percentual', largura: 16 },
          ],
          linhas,
        });
        const [fretes, despesas] = await Promise.all([
          query(`SELECT to_char(fr.data,'YYYY-MM-DD') AS data, fr.numero_carga, c.nome AS cliente, fr.destino, fr.toneladas,
                        fr.valor_tonelada, fr.valor_fechado, fr.valor_total, fr.forma_pagamento, fr.status_pagamento, to_char(fr.data_pagamento,'YYYY-MM-DD') AS pago_em
                   FROM fretes fr JOIN clientes c ON c.id = fr.cliente_id
                  WHERE fr.empresa_id = $1 AND to_char(fr.data,'YYYY-MM') = $2 AND fr.status_pagamento <> 'Cancelado' ORDER BY fr.data`, [id, mes]),
          query(`SELECT to_char(d.data,'YYYY-MM-DD') AS data, d.descricao, cd.nome AS categoria, e.nome AS empreiteiro, f.nome AS floresta,
                        d.favorecido, d.valor, d.forma_pagamento, d.status, to_char(d.data_pagamento,'YYYY-MM-DD') AS pago_em
                   FROM despesas d JOIN categorias_despesa cd ON cd.id = d.categoria_id
                   LEFT JOIN empreiteiros e ON e.id = d.empreiteiro_id LEFT JOIN florestas f ON f.id = d.floresta_id
                  WHERE d.empresa_id = $1 AND to_char(d.data,'YYYY-MM') = $2 AND d.status <> 'Cancelado' ORDER BY d.data`, [id, mes]),
        ]);
        pasta.aba('Viagens', { ...topo('Viagens'), colunas: COLUNAS_VIAGENS, linhas: await viagensDoMes(id, mes), total: true });
        pasta.aba('Fretes', {
          ...topo('Fretes'), total: true, linhas: fretes.rows,
          colunas: [
            { titulo: 'Data', campo: 'data', formato: 'data', largura: 11 }, { titulo: 'Carga', campo: 'numero_carga', largura: 8 },
            { titulo: 'Cliente', campo: 'cliente', largura: 22 }, { titulo: 'Destino', campo: 'destino', largura: 18 },
            { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 11 },
            { titulo: 'R$/t', campo: 'valor_tonelada', formato: 'moeda', largura: 12 }, { titulo: 'Valor fechado', campo: 'valor_fechado', formato: 'moeda', largura: 14 },
            { titulo: 'Total', campo: 'valor_total', formato: 'moeda', total: 'soma', largura: 15 },
            { titulo: 'Forma', campo: 'forma_pagamento', largura: 10 }, { titulo: 'Situação', campo: 'status_pagamento', largura: 10 },
            { titulo: 'Pago em', campo: 'pago_em', formato: 'data', largura: 11 },
          ],
        });
        pasta.aba('Despesas', {
          ...topo('Despesas'), total: true, linhas: despesas.rows,
          colunas: [
            { titulo: 'Data', campo: 'data', formato: 'data', largura: 11 }, { titulo: 'Descrição', campo: 'descricao', largura: 30 },
            { titulo: 'Categoria', campo: 'categoria', largura: 22 }, { titulo: 'Empreiteiro', campo: 'empreiteiro', largura: 16 },
            { titulo: 'Floresta', campo: 'floresta', largura: 16 }, { titulo: 'Favorecido', campo: 'favorecido', largura: 18 },
            { titulo: 'Valor', campo: 'valor', formato: 'moeda', total: 'soma', largura: 15 },
            { titulo: 'Forma', campo: 'forma_pagamento', largura: 10 }, { titulo: 'Situação', campo: 'status', largura: 10 },
            { titulo: 'Pago em', campo: 'pago_em', formato: 'data', largura: 11 },
          ],
        });
      } else if (tipo === 'anual') {
        pasta.aba(`Resumo ${ano}`, {
          ...topo('Resumo anual'), total: true, linhas: await dados.dadosAnual(id, ano),
          colunas: [
            { titulo: 'Mês', valor: (l) => nomeMes(l.mes), largura: 16 },
            { titulo: 'Viagens', campo: 'viagens', formato: 'inteiro', total: 'soma', largura: 10 },
            { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 12 },
            { titulo: 'Madeira', campo: 'madeira', formato: 'moeda', total: 'soma', largura: 16 },
            { titulo: 'Fretes', campo: 'fretes', formato: 'moeda', total: 'soma', largura: 15 },
            { titulo: 'Faturamento', campo: 'faturamento', formato: 'moeda', total: 'soma', largura: 16 },
            { titulo: 'Despesas', campo: 'despesas', formato: 'moeda', total: 'soma', largura: 16 },
            { titulo: 'Resultado', campo: 'resultado', formato: 'moeda', total: 'soma', largura: 16 },
          ],
        });
      } else {
        const def = {
          clientes: {
            aba: 'Por cliente', titulo: 'Relatório por cliente', linhas: await dados.dadosClientes(id, mes),
            colunas: [
              { titulo: 'Cliente', campo: 'nome', largura: 30 }, { titulo: 'Viagens', campo: 'qtd_viagens', formato: 'inteiro', total: 'soma', largura: 10 },
              { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 12 },
              { titulo: 'Preço médio/t', campo: 'preco_medio', formato: 'moeda', largura: 15 },
              { titulo: 'Valor total', campo: 'valor_total', formato: 'moeda', total: 'soma', largura: 17 },
            ],
          },
          florestas: {
            aba: 'Por floresta', titulo: 'Relatório por floresta', linhas: await dados.dadosFlorestas(id, mes),
            colunas: [
              { titulo: 'Floresta', campo: 'nome', largura: 26 }, { titulo: 'Viagens', campo: 'qtd_viagens', formato: 'inteiro', total: 'soma', largura: 10 },
              { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 12 },
              { titulo: 'Vendido', campo: 'valor_vendido', formato: 'moeda', total: 'soma', largura: 16 },
              { titulo: 'A pagar (compra)', campo: 'a_pagar', formato: 'moeda', total: 'soma', largura: 17 },
              { titulo: 'Pago no mês', campo: 'pago', formato: 'moeda', total: 'soma', largura: 15 },
              { titulo: 'Saldo', campo: 'saldo', formato: 'moeda', total: 'soma', largura: 15 },
            ],
          },
          empreiteiros: {
            aba: 'Por empreiteiro', titulo: 'Relatório por empreiteiro', linhas: await dados.dadosEmpreiteiros(id, mes),
            colunas: [
              { titulo: 'Empreiteiro', campo: 'nome', largura: 26 }, { titulo: 'Viagens', campo: 'qtd_viagens', formato: 'inteiro', total: 'soma', largura: 10 },
              { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 12 },
              { titulo: 'Produção', campo: 'valor_bruto', formato: 'moeda', total: 'soma', largura: 16 },
              { titulo: 'Adiantamentos/despesas', campo: 'despesas', formato: 'moeda', total: 'soma', largura: 22 },
              { titulo: 'Líquido a pagar', campo: 'liquido', formato: 'moeda', total: 'soma', largura: 17 },
            ],
          },
          classes: {
            aba: 'Por classe', titulo: 'Totalização por classe', linhas: await dados.dadosClasses(id, mes),
            colunas: [
              { titulo: 'Classe', campo: 'nome', largura: 18 }, { titulo: 'Viagens', campo: 'qtd_viagens', formato: 'inteiro', total: 'soma', largura: 10 },
              { titulo: 'Toneladas', campo: 'toneladas', formato: 'decimal', total: 'soma', largura: 12 },
              { titulo: 'Preço médio/t', campo: 'preco_medio', formato: 'moeda', largura: 15 },
              { titulo: 'Valor total', campo: 'valor_total', formato: 'moeda', total: 'soma', largura: 17 },
              { titulo: 'Custo floresta', campo: 'custo_floresta', formato: 'moeda', total: 'soma', largura: 16 },
            ],
          },
        }[tipo];
        pasta.aba(def.aba, { ...topo(def.titulo), colunas: def.colunas, linhas: def.linhas, total: true });
        pasta.aba('Viagens do mês', { ...topo('Viagens'), colunas: COLUNAS_VIAGENS, linhas: await viagensDoMes(id, mes), total: true });
      }

      const nome = `xylo-${tipo}-${tipo === 'anual' ? ano : mes}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      res.send(pasta.gerar());
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------
// DRE em Excel: a demonstração com FÓRMULAS (subtotais, AV% e variação
// recalculam se alguém ajustar um valor), indicadores, critérios e as
// despesas que entraram em cada linha.
// ---------------------------------------------------------------------
const mesOk = /^\d{4}-(0[1-9]|1[0-2])$/;
router.get(
  '/dre',
  [q('de').matches(mesOk).withMessage('Informe o mês inicial.'), q('ate').matches(mesOk).withMessage('Informe o mês final.'),
    q('comparar').optional({ values: 'falsy' }).isIn(['anterior', 'ano_anterior']), q('mensal').optional().isIn(['0', '1'])],
  validar,
  async (req, res, next) => {
    try {
      const id = req.usuario.empresaId;
      const d = await DRE.calcularDRE(id, { de: req.query.de, ate: req.query.ate, comparar: req.query.comparar || null, mensal: req.query.mensal === '1' });
      const [emp, quem] = await Promise.all([
        query('SELECT nome, razao_social, cnpj, cidade, uf, logo FROM empresas WHERE id = $1', [id]),
        query('SELECT nome FROM usuarios WHERE id = $1', [req.usuario.id]),
      ]);
      const e = emp.rows[0];
      const empresaLinha = [e.razao_social || e.nome, e.cnpj ? `CNPJ ${cnpjFormatado(e.cnpj)}` : '', [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ');
      const emitido = `Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${quem.rows[0]?.nome || ''} · Xylo`;
      const regime = d.fiscal.regime_nome ? `Regime: ${d.fiscal.regime_nome}` : 'Regime tributário não informado';

      // Fórmulas: subtotal = soma dos filhos diretos; resultados = encadeados
      const L = d.linhas;
      const idx = Object.fromEntries(L.map((l, k) => [l.id, k]));
      const filhos = (k) => {
        const lista = [];
        for (let j = k + 1; j < L.length && L[j].nivel > L[k].nivel; j++) if (L[j].nivel === L[k].nivel + 1) lista.push(j);
        return lista;
      };
      const ENCADEADOS = {
        receita_liquida: ['receita_bruta', 'deducoes'], lucro_bruto: ['receita_liquida', 'custos'],
        resultado_operacional: ['lucro_bruto', 'despesas_operacionais'], resultado_antes_ir: ['resultado_operacional', 'resultado_financeiro'],
        resultado_liquido: ['resultado_antes_ir', 'ir_csll'],
      };
      const formula = (k, valorDe, col = null) => {
        const ref = (j) => `{${col ? `${col}:` : ''}L${j}}`;
        const l = L[k];
        const valor = valorDe(l);
        if (ENCADEADOS[l.id]) return { formula: ENCADEADOS[l.id].map((x) => ref(idx[x])).join('+'), valor };
        const f = filhos(k);
        if (f.length && l.id !== 'impostos_calc') return { formula: f.map(ref).join('+'), valor };
        return valor;
      };

      const colunas = [{ titulo: 'Descrição', campo: 'rotulo', largura: 52 }];
      // coluna do período (ou uma por mês + total)
      if (d.colunas_meses) {
        d.colunas_meses.forEach((m, j) => colunas.push({ titulo: m.rotulo, formato: 'moeda', largura: 14, valor: (l) => formula(l._k, (x) => x.meses[j]) }));
        const ini = letra(1); const fim = letra(d.colunas_meses.length);
        colunas.push({ titulo: 'Total', formato: 'moeda', largura: 16, valor: (l) => ({ formula: `SUM({${ini}:L${l._k}}:{${fim}:L${l._k}})`, valor: l.valor }) });
      } else {
        colunas.push({ titulo: d.periodo.nome, formato: 'moeda', largura: 18, valor: (l) => formula(l._k, (x) => x.valor) });
      }
      const colTotal = letra(colunas.length - 1);
      const kRL = idx.receita_liquida;
      colunas.push({ titulo: 'AV %', formato: 'percentual', largura: 9, valor: (l) => ({ formula: `IF({${colTotal}:L${kRL}}=0,"",{${colTotal}:L${l._k}}/{${colTotal}:L${kRL}})`, valor: l.av !== null ? l.av / 100 : null }) });
      if (d.comparativo) {
        const colAnt = letra(colunas.length);
        colunas.push({ titulo: d.comparativo.nome, formato: 'moeda', largura: 18, valor: (l) => formula(l._k, (x) => x.anterior, colAnt) });
        colunas.push({ titulo: 'Variação %', formato: 'percentual', largura: 11, valor: (l) => ({ formula: `IF({${colAnt}:L${l._k}}=0,"",({${colTotal}:L${l._k}}-{${colAnt}:L${l._k}})/ABS({${colAnt}:L${l._k}}))`, valor: l.variacao !== null ? l.variacao / 100 : null }) });
      }
      const estilo = (l) => (l.tipo === 'resultado' ? 'resultado' : l.tipo === 'subtotal' ? 'subtotal' : l.nivel === 0 ? 'grupo' : l.nivel === 2 ? 'detalhe' : 'item');
      const linhas = L.map((l, k) => ({ ...l, _k: k, _estilo: estilo(l) }));

      const ind = d.indicadores;
      const pctTxt = (v) => (v === null || v === undefined ? '–' : `${String(v.toFixed(1)).replace('.', ',')}%`);
      const brl = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      const pasta = novaPasta();
      pasta.aba('DRE', {
        titulo: `DRE — Demonstração do Resultado do Exercício · ${d.periodo.nome}`,
        subtitulo: empresaLinha, logo: e.logo, notas: [`${regime} · Regime de competência`, emitido],
        colunas, linhas, filtro: false, paisagem: Boolean(d.colunas_meses || d.comparativo),
        rodape: [
          `Margem bruta ${pctTxt(ind.margem_bruta)} · Margem operacional ${pctTxt(ind.margem_operacional)} · Margem líquida ${pctTxt(ind.margem_liquida)} (sobre a receita líquida)`,
          `${ind.viagens} viagem(ns), ${Number(ind.toneladas).toLocaleString('pt-BR')} t de madeira · receita ${brl(ind.receita_por_tonelada)}/t · custo da madeira ${brl(ind.custo_madeira_por_tonelada)}/t · resultado ${brl(ind.resultado_por_tonelada)}/t`,
          'AV % = análise vertical sobre a receita operacional líquida. Valores negativos = deduções, custos e despesas.',
          ...d.avisos.map((a) => `Atenção: ${a}`),
          '', '______________________________________          ______________________________________',
          'Responsável pela empresa                                         Contador(a) · CRC',
        ],
      });

      // Critérios
      const fora = d.fora_da_dre;
      const nomesFora = { floresta: 'Pagamentos e adiantamentos a florestas', empreiteiro: 'Pagamentos e adiantamentos a empreiteiros', folha: 'Pagamento da folha (o custo é a folha do mês)', adiantamento: 'Adiantamentos da folha', categoria: 'Categorias marcadas "não entra na DRE"' };
      pasta.aba('Critérios', {
        titulo: 'Como a DRE foi calculada', subtitulo: empresaLinha, filtro: false, paisagem: false,
        colunas: [{ titulo: 'Linha da DRE', campo: 'linha', largura: 34 }, { titulo: 'De onde vem', campo: 'origem', largura: 90 }],
        linhas: [
          { linha: 'Regime', origem: 'Competência: cada valor entra no mês da viagem, do frete, da folha ou da despesa (não do pagamento).' },
          { linha: 'Venda de madeira', origem: 'Soma do valor das viagens (peso × valor de venda por tonelada), sem as canceladas.' },
          { linha: 'Serviços de frete', origem: 'Soma dos fretes do período, sem os cancelados.' },
          { linha: 'Impostos sobre a receita', origem: `${d.fiscal.aliquota_receita ? `${d.fiscal.aliquota_receita}% sobre a receita bruta (Dados da empresa)` : 'Alíquota não informada'} + despesas das categorias do grupo "Impostos".` },
          { linha: 'Compra de madeira', origem: 'Valor pago à floresta informado em cada viagem (peso × R$/t).' },
          { linha: 'Corte e carregamento', origem: 'Valor do empreiteiro informado em cada viagem (e as divisões de carga).' },
          { linha: 'Custos da operação', origem: 'Despesas das categorias do grupo "Custos" (combustível, manutenção...).' },
          { linha: 'Pessoal', origem: 'Folha de pagamento do mês (salário, comissão, alimentação e extras) + despesas do grupo "Pessoal".' },
          { linha: 'Administrativas / comerciais / financeiras', origem: 'Despesas das categorias de cada grupo (a escolha fica na tela da DRE).' },
          { linha: 'IRPJ e CSLL', origem: d.fiscal.aliquota_ir_csll ? `${d.fiscal.aliquota_ir_csll}% sobre ${d.fiscal.base_ir_csll === 'receita' ? 'a receita bruta' : 'o resultado antes do IR (se positivo)'} + despesas do grupo "IRPJ e CSLL".` : 'Sem alíquota informada: só as despesas do grupo "IRPJ e CSLL".' },
          ...fora.map((f) => ({ linha: 'Fora da DRE', origem: `${nomesFora[f.motivo] || f.motivo}: ${f.qtd} lançamento(s), ${brl(f.valor)} (o custo já está em outra linha).` })),
        ],
      });

      // Despesas que entraram, por grupo
      const desp = await query(
        `SELECT to_char(d.data, 'YYYY-MM-DD') AS data, d.descricao, c.nome AS categoria, COALESCE(c.grupo_dre, fn_grupo_dre_sugerido(c.nome)) AS grupo,
                d.favorecido, d.valor, d.status
           FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
          WHERE d.empresa_id = $1 AND d.status <> 'Cancelado' AND to_char(d.data, 'YYYY-MM') BETWEEN $2 AND $3
            AND d.floresta_id IS NULL AND d.empreiteiro_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM folhas fo WHERE fo.despesa_id = d.id)
            AND NOT EXISTS (SELECT 1 FROM adiantamentos ad WHERE ad.despesa_id = d.id)
            AND COALESCE(c.grupo_dre, fn_grupo_dre_sugerido(c.nome)) <> 'nao_entra'
          ORDER BY 4, d.data`, [id, d.periodo.de, d.periodo.ate]);
      pasta.aba('Despesas na DRE', {
        titulo: `Despesas consideradas · ${d.periodo.nome}`, subtitulo: empresaLinha, total: true,
        linhas: desp.rows.map((x) => ({ ...x, grupo: DRE.GRUPOS[x.grupo] || x.grupo })),
        colunas: [
          { titulo: 'Grupo da DRE', campo: 'grupo', largura: 30 }, { titulo: 'Data', campo: 'data', formato: 'data', largura: 11 },
          { titulo: 'Categoria', campo: 'categoria', largura: 22 }, { titulo: 'Descrição', campo: 'descricao', largura: 40 },
          { titulo: 'Favorecido', campo: 'favorecido', largura: 22 }, { titulo: 'Valor', campo: 'valor', formato: 'moeda', total: 'soma', largura: 15 },
          { titulo: 'Situação', campo: 'status', largura: 10 },
        ],
      });

      const nome = `DRE ${d.periodo.de}${d.periodo.de !== d.periodo.ate ? ` a ${d.periodo.ate}` : ''} - ${(e.nome || 'empresa').replace(/[^\w\- ]+/g, '').trim()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
      res.send(pasta.gerar());
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
