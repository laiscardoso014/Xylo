// =====================================================================
// FERRAMENTAS DO ASSISTENTE
//
// A IA nunca acessa o banco diretamente: ela só pode pedir uma destas
// consultas prontas. Todas são SOMENTE LEITURA e filtram pela empresa de
// quem está logado (empresaId vem do token, nunca da IA).
//
// Cada ferramenta tem: descrição + parâmetros (para a IA) e executar().
// =====================================================================
const { query } = require('../config/db');
const { conferirMes } = require('./conferencia');

const MES = { type: 'string', description: 'Mês no formato AAAA-MM, ex.: 2026-01' };
const mesValido = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const n = (v) => Number(v || 0);
const exigirMes = (m) => { if (!mesValido(m)) throw new Error('Mês inválido: use AAAA-MM.'); };

const FERRAMENTAS = {
  // -------------------------------------------------------------------
  resumo_do_mes: {
    descricao: 'Fechamento de um mês: viagens, toneladas, faturamento (madeira + fretes), despesas por categoria e resultado. Use para perguntas sobre quanto faturou, gastou, lucrou ou transportou.',
    parametros: { mes: MES },
    obrigatorios: ['mes'],
    async executar(empresaId, { mes }) {
      exigirMes(mes);
      const p = [empresaId, mes];
      const [mad, fre, des, custos] = await Promise.all([
        query(`SELECT COALESCE(SUM(qtd_viagens),0)::int AS viagens, COALESCE(SUM(toneladas),0) AS toneladas, COALESCE(SUM(valor_total),0) AS valor
                 FROM vw_relatorio_cliente WHERE empresa_id = $1 AND mes = $2`, p),
        query(`SELECT COUNT(*)::int AS qtd, COALESCE(SUM(toneladas),0) AS toneladas, COALESCE(SUM(valor_total),0) AS valor
                 FROM fretes WHERE empresa_id = $1 AND to_char(data,'YYYY-MM') = $2 AND status_pagamento <> 'Cancelado'`, p),
        query(`SELECT c.nome AS categoria, SUM(d.valor) AS valor FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
                WHERE d.empresa_id = $1 AND to_char(d.data,'YYYY-MM') = $2 AND d.status <> 'Cancelado'
                GROUP BY c.nome ORDER BY SUM(d.valor) DESC`, p),
        query(`SELECT (SELECT COALESCE(SUM(total_floresta),0) FROM viagens WHERE empresa_id=$1 AND to_char(data,'YYYY-MM')=$2 AND status<>'Cancelada') AS florestas,
                      (SELECT COALESCE(SUM(valor_total),0) FROM vw_viagem_empreiteiros WHERE empresa_id=$1 AND to_char(data,'YYYY-MM')=$2) AS empreiteiros`, p),
      ]);
      const faturamento = n(mad.rows[0].valor) + n(fre.rows[0].valor);
      const despesas = des.rows.reduce((t, d) => t + n(d.valor), 0);
      return {
        mes,
        madeira: { viagens: mad.rows[0].viagens, toneladas: n(mad.rows[0].toneladas), valor: n(mad.rows[0].valor) },
        fretes: { quantidade: fre.rows[0].qtd, toneladas: n(fre.rows[0].toneladas), valor: n(fre.rows[0].valor) },
        faturamento,
        despesas_por_categoria: des.rows.map((d) => ({ categoria: d.categoria, valor: n(d.valor) })),
        despesas_total: despesas,
        resultado: faturamento - despesas,
        a_pagar_florestas_empreiteiros: { florestas: n(custos.rows[0].florestas), empreiteiros: n(custos.rows[0].empreiteiros) },
      };
    },
  },

  // -------------------------------------------------------------------
  conferir_mes: {
    descricao: 'Confere os lançamentos de um mês e devolve os problemas encontrados: viagens sem ticket, preço de venda muito fora da média, peso fora do normal, possíveis duplicadas, placa repetida no dia, viagens sem valor de compra da floresta ou do empreiteiro, empreiteiro com saldo negativo, fretes e despesas pendentes há mais de 30 dias. Use sempre que pedirem para conferir, verificar ou achar erros.',
    parametros: { mes: MES },
    obrigatorios: ['mes'],
    async executar(empresaId, { mes }) {
      exigirMes(mes);
      return conferirMes(empresaId, mes);
    },
  },

  // -------------------------------------------------------------------
  relatorio: {
    descricao: 'Relatório de um mês agrupado por cliente (serraria), floresta, empreiteiro ou classe de madeira. Cliente traz a madeira (viagens) e os fretes separados e somados. Floresta traz quanto há a pagar, quanto foi pago e o saldo; empreiteiro traz produção, adiantamentos e líquido a pagar.',
    parametros: {
      tipo: { type: 'string', enum: ['cliente', 'floresta', 'empreiteiro', 'classe'], description: 'Como agrupar' },
      mes: MES,
    },
    obrigatorios: ['tipo', 'mes'],
    async executar(empresaId, { tipo, mes }) {
      exigirMes(mes);
      const p = [empresaId, mes];
      const sql = {
        cliente: `SELECT c.nome, COALESCE(r.qtd_viagens,0)::int AS viagens, COALESCE(r.toneladas,0) AS toneladas_madeira,
                         COALESCE(r.valor_total,0) AS valor_madeira, COALESCE(f.qtd,0)::int AS fretes,
                         COALESCE(f.toneladas,0) AS toneladas_fretes, COALESCE(f.valor,0) AS valor_fretes,
                         COALESCE(r.valor_total,0) + COALESCE(f.valor,0) AS valor_total
                    FROM (SELECT * FROM vw_relatorio_cliente WHERE empresa_id=$1 AND mes=$2) r
                    FULL JOIN (SELECT cliente_id, COUNT(*) AS qtd, SUM(toneladas) AS toneladas, SUM(valor_total) AS valor FROM fretes
                                WHERE empresa_id=$1 AND to_char(data,'YYYY-MM')=$2 AND status_pagamento<>'Cancelado'
                                GROUP BY cliente_id) f ON f.cliente_id = r.cliente_id
                    JOIN clientes c ON c.id = COALESCE(r.cliente_id, f.cliente_id)
                   ORDER BY valor_total DESC`,
        floresta: `SELECT f.nome, COALESCE(r.qtd_viagens,0)::int AS viagens, COALESCE(r.toneladas,0) AS toneladas,
                          COALESCE(r.valor_a_pagar_floresta,0) AS a_pagar, COALESCE(pg.pago,0) AS pago_no_mes,
                          COALESCE(r.valor_a_pagar_floresta,0) - COALESCE(pg.pago,0) AS saldo
                     FROM (SELECT * FROM vw_relatorio_floresta WHERE empresa_id=$1 AND mes=$2) r
                     FULL JOIN (SELECT floresta_id, SUM(valor) AS pago FROM despesas
                                 WHERE empresa_id=$1 AND to_char(data,'YYYY-MM')=$2 AND status<>'Cancelado' AND floresta_id IS NOT NULL
                                 GROUP BY floresta_id) pg ON pg.floresta_id = r.floresta_id
                     JOIN florestas f ON f.id = COALESCE(r.floresta_id, pg.floresta_id)
                    ORDER BY toneladas DESC`,
        empreiteiro: `SELECT empreiteiro AS nome, qtd_viagens::int AS viagens, toneladas, valor_bruto AS producao,
                             despesas AS adiantamentos_e_pagamentos, liquido AS liquido_a_pagar
                        FROM vw_relatorio_empreiteiro WHERE empresa_id=$1 AND mes=$2 ORDER BY toneladas DESC`,
        classe: `SELECT classe AS nome, qtd_viagens::int AS viagens, toneladas, valor_total FROM vw_totalizacao_mensal
                  WHERE empresa_id=$1 AND mes=$2 AND classe <> 'TOTAL' ORDER BY toneladas DESC`,
      }[tipo];
      if (!sql) throw new Error('Tipo de relatório inválido.');
      const { rows } = await query(sql, p);
      return { mes, tipo, linhas: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'nome' ? v : n(v)]))) };
    },
  },

  // -------------------------------------------------------------------
  buscar_viagens: {
    descricao: 'Procura viagens por mês, ticket, placa, cliente, floresta, empreiteiro ou classe (nomes aceitam parte do texto). Devolve no máximo 30 viagens e o total encontrado.',
    parametros: {
      mes: MES,
      ticket: { type: 'string' },
      placa: { type: 'string' },
      cliente: { type: 'string' },
      floresta: { type: 'string' },
      empreiteiro: { type: 'string' },
      classe: { type: 'string' },
    },
    obrigatorios: [],
    async executar(empresaId, f) {
      if (f.mes) exigirMes(f.mes);
      const filtros = ['v.empresa_id = $1', "v.status <> 'Cancelada'"];
      const valores = [empresaId];
      const add = (sql, valor) => { valores.push(valor); filtros.push(sql.replace('?', `$${valores.length}`)); };
      if (f.mes) add("to_char(v.data,'YYYY-MM') = ?", f.mes);
      if (f.ticket) add('v.ticket = ?', String(f.ticket).trim());
      if (f.placa) add("upper(replace(v.placa,'-','')) = ?", String(f.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (f.cliente) add('c.nome ILIKE ?', `%${f.cliente}%`);
      if (f.floresta) add('fl.nome ILIKE ?', `%${f.floresta}%`);
      if (f.empreiteiro) add('e.nome ILIKE ?', `%${f.empreiteiro}%`);
      if (f.classe) add('cm.nome ILIKE ?', `%${f.classe}%`);
      const { rows } = await query(
        `SELECT v.numero_viagem, to_char(v.data,'YYYY-MM-DD') AS data, v.ticket, v.placa, c.nome AS cliente, fl.nome AS floresta,
                e.nome AS empreiteiro, cm.nome AS classe, v.peso_liquido, v.valor_tonelada, v.valor_total,
                COUNT(*) OVER() AS total_encontrado, SUM(v.peso_liquido) OVER() AS toneladas_total, SUM(v.valor_total) OVER() AS valor_total_geral
           FROM viagens v JOIN clientes c ON c.id = v.cliente_id JOIN florestas fl ON fl.id = v.floresta_id
           LEFT JOIN empreiteiros e ON e.id = v.empreiteiro_id JOIN classes_madeira cm ON cm.id = v.classe_id
          WHERE ${filtros.join(' AND ')}
          ORDER BY v.data DESC, v.id DESC LIMIT 30`, valores);
      return {
        total_encontrado: rows.length ? Number(rows[0].total_encontrado) : 0,
        toneladas_total: rows.length ? n(rows[0].toneladas_total) : 0,
        valor_total: rows.length ? n(rows[0].valor_total_geral) : 0,
        viagens: rows.map(({ total_encontrado: _a, toneladas_total: _b, valor_total_geral: _c, ...v }) => ({
          ...v, peso_liquido: n(v.peso_liquido), valor_tonelada: n(v.valor_tonelada), valor_total: n(v.valor_total),
        })),
      };
    },
  },

  // -------------------------------------------------------------------
  buscar_fretes: {
    descricao: 'Procura FRETES (transportes cobrados à parte, separados das viagens de madeira) por mês, cliente, destino, motorista, nº da carga ou situação do pagamento (Pendente/Pago). Nomes aceitam parte do texto. Devolve no máximo 30 fretes, o total encontrado, as toneladas e o valor. Use sempre que perguntarem por fretes ou cargas de um cliente (junto com buscar_viagens).',
    parametros: {
      mes: MES,
      cliente: { type: 'string' },
      destino: { type: 'string' },
      motorista: { type: 'string' },
      numero_carga: { type: 'string' },
      situacao: { type: 'string', enum: ['Pendente', 'Pago', 'Cancelado'] },
    },
    obrigatorios: [],
    async executar(empresaId, f) {
      if (f.mes) exigirMes(f.mes);
      const filtros = ['fr.empresa_id = $1'];
      const valores = [empresaId];
      const add = (sql, valor) => { valores.push(valor); filtros.push(sql.replace('?', `$${valores.length}`)); };
      if (f.situacao) add('fr.status_pagamento = ?', f.situacao); else filtros.push("fr.status_pagamento <> 'Cancelado'");
      if (f.mes) add("to_char(fr.data,'YYYY-MM') = ?", f.mes);
      if (f.cliente) add('c.nome ILIKE ?', `%${f.cliente}%`);
      if (f.destino) add('fr.destino ILIKE ?', `%${f.destino}%`);
      if (f.motorista) add('(m.nome ILIKE ? OR fu.nome ILIKE $X)'.replace('$X', `$${valores.length + 1}`), `%${f.motorista}%`);
      if (f.numero_carga) add('fr.numero_carga = ?', String(f.numero_carga).trim());
      const { rows } = await query(
        `SELECT fr.numero_carga, to_char(fr.data,'YYYY-MM-DD') AS data, c.nome AS cliente, fr.destino, fr.toneladas,
                fr.valor_tonelada, fr.valor_fechado, fr.valor_total, fr.status_pagamento AS situacao, fr.forma_pagamento,
                to_char(fr.data_pagamento,'YYYY-MM-DD') AS data_pagamento, COALESCE(fu.nome, m.nome) AS motorista,
                COUNT(*) OVER() AS total_encontrado, SUM(fr.toneladas) OVER() AS toneladas_total, SUM(fr.valor_total) OVER() AS valor_total_geral,
                SUM(CASE WHEN fr.status_pagamento = 'Pendente' THEN fr.valor_total ELSE 0 END) OVER() AS a_receber
           FROM fretes fr JOIN clientes c ON c.id = fr.cliente_id
           LEFT JOIN motoristas m ON m.id = fr.motorista_id
           LEFT JOIN funcionarios fu ON fu.motorista_id = m.id
          WHERE ${filtros.join(' AND ')}
          ORDER BY fr.data DESC, fr.id DESC LIMIT 30`, valores);
      const r0 = rows[0] || {};
      return {
        total_encontrado: rows.length ? Number(r0.total_encontrado) : 0,
        toneladas_total: n(r0.toneladas_total),
        valor_total: n(r0.valor_total_geral),
        a_receber: n(r0.a_receber),
        fretes: rows.map(({ total_encontrado: _a, toneladas_total: _b, valor_total_geral: _c, a_receber: _d, ...x }) => ({
          ...x, toneladas: n(x.toneladas), valor_tonelada: x.valor_tonelada === null ? null : n(x.valor_tonelada),
          valor_fechado: x.valor_fechado === null ? null : n(x.valor_fechado), valor_total: n(x.valor_total),
        })),
      };
    },
  },

  // -------------------------------------------------------------------
  precos_praticados: {
    descricao: 'Preços por tonelada praticados nas viagens dos últimos 90 dias (os preços não são fixos: cada viagem tem os seus). VENDA = o que o cliente paga; COMPRA = o que se paga à floresta; EMPREITADA = o que se paga ao empreiteiro. Mostra o último valor, a média, o menor e o maior. Pode filtrar por tipo e por parte do nome.',
    parametros: {
      tipo: { type: 'string', enum: ['VENDA', 'COMPRA', 'EMPREITADA'] },
      nome: { type: 'string', description: 'Parte do nome do cliente, floresta ou empreiteiro' },
    },
    obrigatorios: [],
    async executar(empresaId, { tipo, nome }) {
      const fontes = {
        VENDA: { coluna: 'v.valor_tonelada', join: 'JOIN clientes x ON x.id = v.cliente_id' },
        COMPRA: { coluna: 'v.valor_ton_floresta', join: 'JOIN florestas x ON x.id = v.floresta_id' },
        EMPREITADA: { coluna: 'v.valor_ton_empreiteiro', join: 'JOIN empreiteiros x ON x.id = v.empreiteiro_id' },
      };
      const precos = [];
      for (const [tp, f] of Object.entries(fontes)) {
        if (tipo && tipo !== tp) continue;
        const valores = [empresaId];
        let extra = '';
        if (nome) { valores.push(`%${nome}%`); extra = ` AND x.nome ILIKE $2`; }
        const { rows } = await query(
          `SELECT x.nome AS para, cm.nome AS classe, COUNT(*)::int AS viagens,
                  ROUND(AVG(${f.coluna}), 2) AS media, MIN(${f.coluna}) AS menor, MAX(${f.coluna}) AS maior,
                  (ARRAY_AGG(${f.coluna} ORDER BY v.data DESC, v.id DESC))[1] AS ultimo,
                  to_char(MAX(v.data), 'YYYY-MM-DD') AS ultima_data
             FROM viagens v ${f.join} JOIN classes_madeira cm ON cm.id = v.classe_id
            WHERE v.empresa_id = $1 AND v.status <> 'Cancelada' AND ${f.coluna} IS NOT NULL
              AND v.data >= CURRENT_DATE - 90 ${extra}
            GROUP BY x.nome, cm.nome ORDER BY x.nome, cm.nome LIMIT 60`, valores);
        rows.forEach((r) => precos.push({ tipo: tp, ...r, media: n(r.media), menor: n(r.menor), maior: n(r.maior), ultimo: n(r.ultimo) }));
      }
      return { periodo: 'últimos 90 dias', precos };
    },
  },

  // -------------------------------------------------------------------
  pendencias: {
    descricao: 'O que falta receber (fretes pendentes) e pagar (despesas pendentes), de todos os meses, com os maiores valores.',
    parametros: {},
    obrigatorios: [],
    async executar(empresaId) {
      const [fr, de] = await Promise.all([
        query(`SELECT fr.numero_carga, to_char(fr.data,'YYYY-MM-DD') AS data, c.nome AS cliente, fr.valor_total,
                      COUNT(*) OVER() AS qtd, SUM(fr.valor_total) OVER() AS total
                 FROM fretes fr JOIN clientes c ON c.id = fr.cliente_id
                WHERE fr.empresa_id = $1 AND fr.status_pagamento = 'Pendente' ORDER BY fr.valor_total DESC LIMIT 10`, [empresaId]),
        query(`SELECT d.descricao, to_char(d.data,'YYYY-MM-DD') AS data, d.valor, COUNT(*) OVER() AS qtd, SUM(d.valor) OVER() AS total
                 FROM despesas d WHERE d.empresa_id = $1 AND d.status = 'Pendente' ORDER BY d.valor DESC LIMIT 10`, [empresaId]),
      ]);
      const resumo = (rows) => ({ quantidade: rows.length ? Number(rows[0].qtd) : 0, total: rows.length ? n(rows[0].total) : 0 });
      return {
        fretes_a_receber: { ...resumo(fr.rows), maiores: fr.rows.map(({ qtd: _q, total: _t, ...r }) => ({ ...r, valor_total: n(r.valor_total) })) },
        despesas_a_pagar: { ...resumo(de.rows), maiores: de.rows.map(({ qtd: _q, total: _t, ...r }) => ({ ...r, valor: n(r.valor) })) },
      };
    },
  },

  // -------------------------------------------------------------------
  evolucao: {
    descricao: 'Mês a mês dos últimos N meses (até 24) terminando no mês informado: viagens, toneladas, faturamento, despesas e resultado. Use para comparar meses ou ver tendência.',
    parametros: { ate: MES, meses: { type: 'integer', minimum: 2, maximum: 24 } },
    obrigatorios: ['ate'],
    async executar(empresaId, { ate, meses = 6 }) {
      exigirMes(ate);
      const qtd = Math.min(Math.max(Number(meses) || 6, 2), 24);
      const { rows } = await query(
        `SELECT to_char(m, 'YYYY-MM') AS mes,
                (SELECT COUNT(*) FROM viagens WHERE empresa_id=$1 AND date_trunc('month',data)=m AND status<>'Cancelada')::int AS viagens,
                (SELECT COALESCE(SUM(peso_liquido),0) FROM viagens WHERE empresa_id=$1 AND date_trunc('month',data)=m AND status<>'Cancelada') AS toneladas,
                (SELECT COALESCE(SUM(valor_total),0) FROM viagens WHERE empresa_id=$1 AND date_trunc('month',data)=m AND status<>'Cancelada')
              + (SELECT COALESCE(SUM(valor_total),0) FROM fretes WHERE empresa_id=$1 AND date_trunc('month',data)=m AND status_pagamento<>'Cancelado') AS faturamento,
                (SELECT COALESCE(SUM(valor),0) FROM despesas WHERE empresa_id=$1 AND date_trunc('month',data)=m AND status<>'Cancelado') AS despesas
           FROM generate_series(to_date($2,'YYYY-MM') - make_interval(months => $3 - 1), to_date($2,'YYYY-MM'), interval '1 month') AS m
          ORDER BY m`, [empresaId, ate, qtd]);
      return { meses: rows.map((r) => ({ ...r, toneladas: n(r.toneladas), faturamento: n(r.faturamento), despesas: n(r.despesas), resultado: n(r.faturamento) - n(r.despesas) })) };
    },
  },
};

// Pessoal, despesas, cadastros, DRE e administração (ferramentasExtras.js)
Object.assign(FERRAMENTAS, require('./ferramentasExtras').EXTRAS);

// Quem pode usar cada ferramenta: o mesmo perfil que vê a tela correspondente
//   sem "acesso" ou 'todos' -> qualquer perfil
//   'editar' -> Administrador e Financeiro (salários, folha, adiantamentos)
//   'admin'  -> só Administrador (usuários, histórico, mensalidade)
function podeUsar(f, perfil) {
  const acesso = f.acesso || 'todos';
  if (acesso === 'todos') return true;
  if (acesso === 'editar') return perfil === 'Administrador' || perfil === 'Financeiro';
  return perfil === 'Administrador';
}

// Formato que a API da IA espera (só as ferramentas que o perfil pode usar)
const definicoesParaIA = (perfil) => Object.entries(FERRAMENTAS).filter(([, f]) => podeUsar(f, perfil)).map(([nome, f]) => ({
  name: nome,
  description: f.descricao,
  input_schema: { type: 'object', properties: f.parametros, required: f.obrigatorios },
}));

async function executarFerramenta(empresaId, nome, entrada, perfil) {
  const f = FERRAMENTAS[nome];
  if (!f) throw new Error(`Ferramenta desconhecida: ${nome}`);
  if (!podeUsar(f, perfil)) throw new Error('O seu perfil não tem acesso a esta informação.');
  return f.executar(empresaId, entrada || {});
}

module.exports = { FERRAMENTAS, definicoesParaIA, executarFerramenta, mesValido };
