// =====================================================================
// FERRAMENTAS DO ASSISTENTE - pessoal, despesas, cadastros, DRE e
// administração (o resto está em ferramentas.js)
//
// Igual às outras: SOMENTE LEITURA e sempre filtradas pela empresa do token.
// acesso: quem pode usar (o mesmo que vê a tela correspondente)
//   'todos'  -> qualquer perfil
//   'editar' -> Administrador e Financeiro (Pessoal: salários, folha)
//   'admin'  -> só Administrador (usuários, histórico, mensalidade)
// =====================================================================
const { query } = require('../config/db');
const calculo = require('../folha/calculo');
const { calcularDRE } = require('../relatorios/dre');

const MES = { type: 'string', description: 'Mês no formato AAAA-MM, ex.: 2026-01' };
const mesValido = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const exigirMes = (m) => { if (!mesValido(m)) throw new Error('Mês inválido: use AAAA-MM.'); };
const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const like = (t) => `%${String(t).trim()}%`;
const semAcentoSQL = (col) => `translate(lower(${col}), 'áàâãéêíóôõúç', 'aaaaeeiooouc')`;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Acha o funcionário pelo nome, pelo nome nas cargas (apelido) ou pela placa
async function acharFuncionario(empresaId, termo) {
  const t = semAcento(termo);
  const placa = String(termo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { rows } = await query(
    `SELECT f.id, f.nome, f.cargo, f.motorista_id, m.nome AS apelido, m.placa
       FROM funcionarios f LEFT JOIN motoristas m ON m.id = f.motorista_id
      WHERE f.empresa_id = $1
        AND (${semAcentoSQL('f.nome')} LIKE $2 OR ${semAcentoSQL('COALESCE(m.nome, \'\')')} LIKE $2 OR m.placa = $3
             OR EXISTS (SELECT 1 FROM motorista_placas mp WHERE mp.motorista_id = m.id AND mp.placa = $3))
      ORDER BY f.ativo DESC, (m.placa = $3) DESC, f.nome LIMIT 5`, [empresaId, `%${t}%`, placa]);
  return rows;
}

const EXTRAS = {
  // -------------------------------------------------------------------
  funcionarios: {
    acesso: 'editar',
    descricao: 'Funcionários cadastrados: cargo, admissão, salário base, alimentação, telefone e, para motoristas, o nome usado nas cargas, a placa atual e o histórico de placas (com as datas de cada caminhão) e as faixas de comissão por distância. Pode filtrar por parte do nome, apelido ou placa.',
    parametros: {
      nome: { type: 'string', description: 'Parte do nome, do apelido nas cargas ou a placa' },
      inativos: { type: 'boolean', description: 'true para incluir os desativados' },
    },
    obrigatorios: [],
    async executar(empresaId, { nome, inativos }) {
      const valores = [empresaId];
      let filtro = inativos ? '' : ' AND f.ativo';
      if (nome) {
        valores.push(`%${semAcento(nome)}%`, String(nome).toUpperCase().replace(/[^A-Z0-9]/g, ''));
        filtro += ` AND (${semAcentoSQL('f.nome')} LIKE $2 OR ${semAcentoSQL("COALESCE(m.nome, '')")} LIKE $2 OR m.placa = $3
                         OR EXISTS (SELECT 1 FROM motorista_placas mp WHERE mp.motorista_id = m.id AND mp.placa = $3))`;
      }
      const { rows } = await query(
        `SELECT f.nome, f.cargo, to_char(f.data_admissao, 'YYYY-MM-DD') AS admissao, f.salario_base, f.alimentacao, f.telefone,
                f.ativo, m.nome AS nome_nas_cargas, m.placa AS placa_atual,
                (SELECT json_agg(json_build_object('placa', mp.placa, 'desde', to_char(mp.desde, 'YYYY-MM-DD'), 'ate', to_char(mp.ate, 'YYYY-MM-DD')) ORDER BY mp.desde NULLS FIRST)
                   FROM motorista_placas mp WHERE mp.motorista_id = m.id) AS historico_de_placas,
                COALESCE((SELECT json_agg(json_build_object('ate_km', cf.km_ate, 'r_por_tonelada', cf.valor_tonelada) ORDER BY cf.km_ate NULLS LAST)
                            FROM comissao_faixas cf WHERE cf.funcionario_id = f.id), '[]') AS faixas_comissao
           FROM funcionarios f LEFT JOIN motoristas m ON m.id = f.motorista_id
          WHERE f.empresa_id = $1 ${filtro}
          ORDER BY f.ativo DESC, f.nome LIMIT 60`, valores);
      return {
        quantidade: rows.length,
        motoristas: rows.filter((r) => r.nome_nas_cargas).length,
        folha_base_mensal: r2(rows.filter((r) => r.ativo).reduce((t, r) => t + n(r.salario_base) + n(r.alimentacao), 0)),
        funcionarios: rows.map((r) => ({ ...r, salario_base: n(r.salario_base), alimentacao: n(r.alimentacao), motorista: !!r.nome_nas_cargas })),
      };
    },
  },

  // -------------------------------------------------------------------
  folha_do_mes: {
    acesso: 'editar',
    descricao: 'Folha de pagamento de um mês: por funcionário, salário base, comissão, alimentação, extras, adiantamento descontado, desconto e saldo a pagar, a situação (Aberta, Fechada, Paga) e os totais. Na folha aberta, a comissão dos motoristas é recalculada com as cargas lançadas até agora.',
    parametros: { mes: MES, nome: { type: 'string', description: 'Parte do nome de um funcionário (opcional)' } },
    obrigatorios: ['mes'],
    async executar(empresaId, { mes, nome }) {
      exigirMes(mes);
      const valores = [empresaId, mes];
      let filtro = '';
      if (nome) { valores.push(`%${semAcento(nome)}%`); filtro = ` AND ${semAcentoSQL('fu.nome')} LIKE $3`; }
      const { rows } = await query(
        `SELECT x.funcionario_id, fu.nome, COALESCE(x.cargo, fu.cargo) AS cargo, fu.motorista_id, x.salario_base, x.comissao, x.comissao_manual,
                x.alimentacao, x.extras, x.adiantamento, x.desconto, x.saldo_pagar, x.status, to_char(x.data_pagamento, 'YYYY-MM-DD') AS pago_em
           FROM folhas x JOIN funcionarios fu ON fu.id = x.funcionario_id
          WHERE x.empresa_id = $1 AND x.competencia = $2 ${filtro} ORDER BY fu.nome`, valores);
      if (!rows.length) {
        return { mes, situacao: 'não gerada', aviso: 'A folha deste mês ainda não foi gerada. Ela é criada ao abrir Pessoal › Folha de pagamento no mês.' };
      }
      const linhas = [];
      for (const l of rows) {
        let comissao = n(l.comissao);
        let pendencias = null;
        if (l.status === 'Aberta' && l.motorista_id && !l.comissao_manual) {
          const c = await calculo.calcularComissao(empresaId, { id: l.funcionario_id, motorista_id: l.motorista_id }, mes);
          comissao = c.total;
          if (c.sem_km || c.sem_faixa) pendencias = { cargas_sem_km: c.sem_km, sem_faixa: c.sem_faixa };
        }
        const saldo = r2(n(l.saldo_pagar) - n(l.comissao) + comissao);
        linhas.push({
          nome: l.nome, cargo: l.cargo, salario_base: n(l.salario_base), comissao, comissao_digitada: l.comissao_manual,
          alimentacao: n(l.alimentacao), extras: n(l.extras), adiantamento: n(l.adiantamento), desconto: n(l.desconto),
          saldo_a_pagar: saldo, situacao: l.status, pago_em: l.pago_em, pendencias,
        });
      }
      const soma = (c) => r2(linhas.reduce((t, l) => t + l[c], 0));
      return {
        mes, situacao: [...new Set(linhas.map((l) => l.situacao))].join(' / '), funcionarios: linhas.length,
        totais: { salario_base: soma('salario_base'), comissao: soma('comissao'), alimentacao: soma('alimentacao'), extras: soma('extras'),
          adiantamento: soma('adiantamento'), desconto: soma('desconto'), saldo_a_pagar: soma('saldo_a_pagar') },
        linhas,
      };
    },
  },

  // -------------------------------------------------------------------
  comissao_motorista: {
    acesso: 'editar',
    descricao: 'Comissão de um motorista em um mês, carga por carga: viagens e fretes que ele puxou, rota, km, faixa, toneladas e valor, e o que falta para calcular (carga sem km, sem faixa). Aceita o nome do funcionário, o nome nas cargas (apelido) ou a placa.',
    parametros: { motorista: { type: 'string' }, mes: MES },
    obrigatorios: ['motorista', 'mes'],
    async executar(empresaId, { motorista, mes }) {
      exigirMes(mes);
      const achados = await acharFuncionario(empresaId, motorista);
      const f = achados.find((x) => x.motorista_id);
      if (!f) return { encontrado: false, aviso: `Nenhum motorista cadastrado com "${motorista}". Os motoristas são funcionários marcados como "É motorista".` };
      const c = await calculo.calcularComissao(empresaId, f, mes);
      return {
        funcionario: f.nome, nome_nas_cargas: f.apelido, placa: f.placa, mes,
        cargas: c.cargas.length, toneladas: c.toneladas, comissao_total: c.total, cargas_sem_km: c.sem_km, sem_faixa: c.sem_faixa,
        faixas: c.faixas.map((x) => `${x.texto}: ${n(x.valor_tonelada).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/t`),
        detalhe: c.cargas.slice(0, 40).map((x) => ({ tipo: x.tipo, numero: x.numero, data: x.data, rota: `${x.origem} → ${x.destino || '?'}`,
          km: x.km, faixa: x.faixa, toneladas: x.toneladas, valor: x.valor, pendencia: x.pendencia })),
      };
    },
  },

  // -------------------------------------------------------------------
  adiantamentos: {
    acesso: 'editar',
    descricao: 'Adiantamentos (vales) dados aos funcionários: data, valor, parcelas, quanto já foi descontado na folha e quanto ainda falta. Pode filtrar por funcionário.',
    parametros: { funcionario: { type: 'string', description: 'Parte do nome (opcional)' }, so_em_aberto: { type: 'boolean' } },
    obrigatorios: [],
    async executar(empresaId, { funcionario, so_em_aberto }) {
      const valores = [empresaId];
      let filtro = '';
      if (funcionario) { valores.push(`%${semAcento(funcionario)}%`); filtro = ` AND ${semAcentoSQL('fu.nome')} LIKE $2`; }
      const { rows } = await query(
        `SELECT fu.nome, to_char(a.data, 'YYYY-MM-DD') AS data, a.valor, a.parcelas, a.descricao,
                COALESCE((SELECT SUM(p.valor) FROM adiantamento_parcelas p JOIN folhas fo ON fo.funcionario_id = a.funcionario_id AND fo.competencia = p.competencia
                           WHERE p.adiantamento_id = a.id AND fo.status <> 'Aberta'), 0) AS descontado
           FROM adiantamentos a JOIN funcionarios fu ON fu.id = a.funcionario_id
          WHERE a.empresa_id = $1 ${filtro} ORDER BY a.data DESC LIMIT 60`, valores);
      let lista = rows.map((r) => ({ ...r, valor: n(r.valor), descontado: n(r.descontado), falta_descontar: r2(n(r.valor) - n(r.descontado)) }));
      if (so_em_aberto) lista = lista.filter((r) => r.falta_descontar > 0);
      return { quantidade: lista.length, total: r2(lista.reduce((t, r) => t + r.valor, 0)), falta_descontar: r2(lista.reduce((t, r) => t + r.falta_descontar, 0)), adiantamentos: lista };
    },
  },

  // -------------------------------------------------------------------
  buscar_despesas: {
    acesso: 'todos',
    descricao: 'Procura DESPESAS (saídas de caixa) por mês, categoria, texto da descrição ou do favorecido, floresta, empreiteiro e situação (Pendente/Pago). Devolve até 30 despesas, o total, o pendente e a soma por categoria.',
    parametros: {
      mes: MES,
      categoria: { type: 'string' },
      texto: { type: 'string', description: 'Parte da descrição ou do favorecido' },
      floresta: { type: 'string' },
      empreiteiro: { type: 'string' },
      situacao: { type: 'string', enum: ['Pendente', 'Pago', 'Cancelado'] },
    },
    obrigatorios: [],
    async executar(empresaId, f) {
      if (f.mes) exigirMes(f.mes);
      const filtros = ['d.empresa_id = $1'];
      const valores = [empresaId];
      const add = (sql, ...vs) => { let s = sql; vs.forEach((v) => { valores.push(v); s = s.replace('?', `$${valores.length}`); }); filtros.push(s); };
      if (f.situacao) add('d.status = ?', f.situacao); else filtros.push("d.status <> 'Cancelado'");
      if (f.mes) add("to_char(d.data,'YYYY-MM') = ?", f.mes);
      if (f.categoria) add('cat.nome ILIKE ?', like(f.categoria));
      if (f.texto) add('(d.descricao ILIKE ? OR d.favorecido ILIKE ?)', like(f.texto), like(f.texto));
      if (f.floresta) add('fl.nome ILIKE ?', like(f.floresta));
      if (f.empreiteiro) add('e.nome ILIKE ?', like(f.empreiteiro));
      const { rows } = await query(
        `SELECT to_char(d.data,'YYYY-MM-DD') AS data, d.descricao, d.favorecido, cat.nome AS categoria, d.valor, d.status AS situacao,
                d.forma_pagamento, to_char(d.data_pagamento,'YYYY-MM-DD') AS pago_em, fl.nome AS floresta, e.nome AS empreiteiro
           FROM despesas d JOIN categorias_despesa cat ON cat.id = d.categoria_id
           LEFT JOIN florestas fl ON fl.id = d.floresta_id LEFT JOIN empreiteiros e ON e.id = d.empreiteiro_id
          WHERE ${filtros.join(' AND ')}
          ORDER BY d.data DESC, d.id DESC`, valores);
      const porCategoria = {};
      rows.forEach((r) => { porCategoria[r.categoria] = r2((porCategoria[r.categoria] || 0) + n(r.valor)); });
      return {
        total_encontrado: rows.length,
        valor_total: r2(rows.reduce((t, r) => t + n(r.valor), 0)),
        pendente: r2(rows.filter((r) => r.situacao === 'Pendente').reduce((t, r) => t + n(r.valor), 0)),
        por_categoria: Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).map(([categoria, valor]) => ({ categoria, valor })),
        despesas: rows.slice(0, 30).map((r) => ({ ...r, valor: n(r.valor) })),
      };
    },
  },

  // -------------------------------------------------------------------
  cadastros: {
    acesso: 'todos',
    descricao: 'Lista os cadastros: clientes (serrarias, com cidade e contato), florestas (proprietário e município), empreiteiros, rotas (origem, destino e km usados na comissão) ou motoristas (nome nas cargas, funcionário e placa). Pode filtrar por parte do nome.',
    parametros: {
      tipo: { type: 'string', enum: ['clientes', 'florestas', 'empreiteiros', 'rotas', 'motoristas'] },
      nome: { type: 'string' },
      inativos: { type: 'boolean' },
    },
    obrigatorios: ['tipo'],
    async executar(empresaId, { tipo, nome, inativos }) {
      const v = [empresaId];
      const filtroNome = (col) => { if (!nome) return ''; v.push(like(nome)); return ` AND ${col} ILIKE $${v.length}`; };
      const ativos = (col) => (inativos ? '' : ` AND ${col}`);
      const sql = {
        clientes: () => `SELECT nome, razao_social, cpf_cnpj AS cnpj, cidade, estado, telefone, email, ativo,
                                (SELECT to_char(MAX(data),'YYYY-MM-DD') FROM viagens WHERE cliente_id = c.id AND status <> 'Cancelada') AS ultima_viagem
                           FROM clientes c WHERE empresa_id = $1${ativos('ativo')}${filtroNome('nome')} ORDER BY nome LIMIT 100`,
        florestas: () => `SELECT nome, proprietario, municipio, estado, ativo,
                                 (SELECT to_char(MAX(data),'YYYY-MM-DD') FROM viagens WHERE floresta_id = f.id AND status <> 'Cancelada') AS ultima_viagem
                            FROM florestas f WHERE empresa_id = $1${ativos('ativo')}${filtroNome('nome')} ORDER BY nome LIMIT 100`,
        empreiteiros: () => `SELECT nome, telefone, ativo,
                                    (SELECT to_char(MAX(data),'YYYY-MM-DD') FROM viagens WHERE empreiteiro_id = e.id AND status <> 'Cancelada') AS ultima_viagem
                               FROM empreiteiros e WHERE empresa_id = $1${ativos('ativo')}${filtroNome('nome')} ORDER BY nome LIMIT 100`,
        rotas: () => `SELECT r.tipo, fl.nome AS floresta, COALESCE(c.nome, r.destino) AS destino, r.km, r.observacao
                        FROM rotas r LEFT JOIN florestas fl ON fl.id = r.floresta_id LEFT JOIN clientes c ON c.id = r.cliente_id
                       WHERE r.empresa_id = $1${nome ? (v.push(like(nome)), ` AND (fl.nome ILIKE $${v.length} OR c.nome ILIKE $${v.length} OR r.destino ILIKE $${v.length})`) : ''}
                       ORDER BY fl.nome NULLS LAST, destino LIMIT 150`,
        motoristas: () => `SELECT m.nome AS nome_nas_cargas, f.nome AS funcionario, m.placa AS placa_atual, f.ativo,
                                  (SELECT json_agg(json_build_object('placa', mp.placa, 'desde', to_char(mp.desde, 'YYYY-MM-DD'), 'ate', to_char(mp.ate, 'YYYY-MM-DD')) ORDER BY mp.desde NULLS FIRST)
                                     FROM motorista_placas mp WHERE mp.motorista_id = m.id) AS historico_de_placas
                             FROM motoristas m JOIN funcionarios f ON f.motorista_id = m.id
                            WHERE m.empresa_id = $1${ativos('f.ativo')}${nome ? (v.push(like(nome)), ` AND (m.nome ILIKE $${v.length} OR f.nome ILIKE $${v.length} OR m.placa ILIKE $${v.length})`) : ''}
                            ORDER BY m.nome LIMIT 100`,
      }[tipo];
      if (!sql) throw new Error('Tipo de cadastro inválido.');
      const { rows } = await query(sql(), v);
      return { tipo, quantidade: rows.length, itens: rows.map((r) => (r.km !== undefined ? { ...r, km: r.km === null ? null : n(r.km) } : r)) };
    },
  },

  // -------------------------------------------------------------------
  dre: {
    acesso: 'todos',
    descricao: 'DRE (Demonstração do Resultado) de um mês ou período: receita bruta, impostos, receita líquida, custos (madeira, corte, operação), lucro bruto, despesas operacionais, resultado financeiro, IRPJ/CSLL e lucro líquido, com margens. Pode comparar com o período anterior. Use para lucro, margem, custos e resultado.',
    parametros: {
      de: MES,
      ate: { type: 'string', description: 'Mês final AAAA-MM (igual ao "de" para um mês só)' },
      comparar: { type: 'boolean', description: 'true para comparar com o período anterior de mesmo tamanho' },
    },
    obrigatorios: ['de'],
    async executar(empresaId, { de, ate, comparar }) {
      exigirMes(de);
      const fim = ate && mesValido(ate) ? ate : de;
      const r = await calcularDRE(empresaId, { de, ate: fim, comparar: comparar ? 'anterior' : null });
      return {
        periodo: r.periodo.nome,
        comparado_com: r.comparativo ? r.comparativo.nome : null,
        regime: r.fiscal.regime_nome || 'não informado',
        linhas: r.linhas.filter((l) => l.nivel <= 1).map((l) => ({
          linha: l.rotulo, tipo: l.tipo, valor: l.valor, percentual_da_receita_liquida: l.av,
          ...(r.comparativo ? { anterior: l.anterior, variacao_percentual: l.variacao } : {}),
        })),
        indicadores: r.indicadores,
        avisos: r.avisos,
      };
    },
  },

  // -------------------------------------------------------------------
  historico: {
    acesso: 'admin',
    descricao: 'Histórico de alterações (auditoria): quem criou, alterou ou excluiu cada registro e quando. Pode filtrar por tipo (viagens, fretes, despesas, funcionarios, folhas, clientes...), por usuário e pelos últimos N dias (padrão 7).',
    parametros: {
      tabela: { type: 'string', enum: ['viagens', 'fretes', 'despesas', 'clientes', 'florestas', 'empreiteiros', 'funcionarios', 'folhas', 'adiantamentos', 'rotas', 'usuarios', 'empresas'] },
      usuario: { type: 'string', description: 'Parte do nome de quem fez' },
      dias: { type: 'integer', minimum: 1, maximum: 365 },
      numero: { type: 'string', description: 'Nº da viagem ou da carga (com tabela viagens/fretes)' },
    },
    obrigatorios: [],
    async executar(empresaId, { tabela, usuario, dias = 7, numero }) {
      const v = [empresaId, Math.min(Math.max(Number(dias) || 7, 1), 365)];
      let filtro = '';
      if (tabela) { v.push(tabela); filtro += ` AND a.tabela = $${v.length}`; }
      if (usuario) { v.push(like(usuario)); filtro += ` AND u.nome ILIKE $${v.length}`; }
      if (numero) { v.push(String(numero).trim()); filtro += ` AND COALESCE(a.dados_novos, a.dados_anteriores) ->> (CASE a.tabela WHEN 'fretes' THEN 'numero_carga' ELSE 'numero_viagem' END) = $${v.length}`; }
      const { rows } = await query(
        `SELECT to_char(a.data_hora, 'YYYY-MM-DD HH24:MI') AS quando, COALESCE(u.nome, 'sistema') AS quem, a.acao, a.tabela, a.registro_id,
                COALESCE(a.dados_novos, a.dados_anteriores) ->> 'numero_viagem' AS viagem,
                COALESCE(a.dados_novos, a.dados_anteriores) ->> 'numero_carga' AS carga,
                COALESCE(a.dados_novos, a.dados_anteriores) ->> 'nome' AS nome,
                COALESCE(a.dados_novos, a.dados_anteriores) ->> 'descricao' AS descricao,
                COALESCE(a.dados_novos, a.dados_anteriores) ->> 'data' AS data_do_registro, a.detalhe
           FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
          WHERE a.empresa_id = $1 AND a.data_hora >= now() - make_interval(days => $2) ${filtro}
          ORDER BY a.data_hora DESC LIMIT 40`, v);
      const acoes = { INSERT: 'criou', UPDATE: 'alterou', DELETE: 'excluiu' };
      return { dias: v[1], quantidade: rows.length, registros: rows.map((r) => ({ ...r, acao: acoes[r.acao] || r.acao })) };
    },
  },

  // -------------------------------------------------------------------
  usuarios: {
    acesso: 'admin',
    descricao: 'Usuários da empresa: nome, e-mail, perfil (Administrador, Financeiro, Visualização), se está ativo, se já ativou o acesso pelo e-mail e o último acesso.',
    parametros: {},
    obrigatorios: [],
    async executar(empresaId) {
      const { rows } = await query(
        `SELECT u.nome, u.email, p.nome AS perfil, u.ativo, (u.email_confirmado_em IS NOT NULL) AS acesso_ativado,
                to_char(u.ultimo_login, 'YYYY-MM-DD HH24:MI') AS ultimo_acesso
           FROM usuarios u JOIN perfis p ON p.id = u.perfil_id WHERE u.empresa_id = $1 ORDER BY u.ativo DESC, u.nome`, [empresaId]);
      return { quantidade: rows.length, usuarios: rows };
    },
  },

  // -------------------------------------------------------------------
  mensalidade: {
    acesso: 'admin',
    descricao: 'Faturas da mensalidade do Xylo (cobradas pela CTech): mês, valor, vencimento e situação (Aberta, Paga, Cancelada). O pagamento é por PIX na tela Financeiro.',
    parametros: {},
    obrigatorios: [],
    async executar(empresaId) {
      const { rows } = await query(
        `SELECT numero, to_char(competencia, 'YYYY-MM') AS mes, valor, to_char(vencimento, 'YYYY-MM-DD') AS vencimento, status AS situacao,
                to_char(pago_em, 'YYYY-MM-DD') AS pago_em, (informado_em IS NOT NULL AND status = 'Aberta') AS pagamento_informado
           FROM faturas WHERE empresa_id = $1 ORDER BY competencia DESC LIMIT 12`, [empresaId]).catch(() => ({ rows: [] }));
      return { faturas: rows.map((r) => ({ ...r, valor: n(r.valor), vencida: r.situacao === 'Aberta' && r.vencimento < new Date().toISOString().slice(0, 10) })) };
    },
  },
};

module.exports = { EXTRAS };
