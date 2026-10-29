// =====================================================================
// EXPORTAÇÃO EM EXCEL (.xlsx) - todos os perfis podem baixar
//
//   GET /api/exportacao/relatorio?tipo=fechamento|clientes|florestas|empreiteiros|classes&mes=2026-01
//   GET /api/exportacao/relatorio?tipo=anual&ano=2026
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
const { novaPasta } = require('../utils/xlsx');
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

module.exports = router;
