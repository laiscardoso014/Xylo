// =====================================================================
// DRE - DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO
//
// Regime de COMPETÊNCIA: cada valor entra no mês em que aconteceu
// (a viagem, o frete, a folha do mês, a despesa), não no mês em que foi pago.
//
//   RECEITA OPERACIONAL BRUTA ........ viagens (venda de madeira) + fretes
//   (−) Deduções ..................... impostos sobre a receita (% da empresa)
//                                      + despesas do grupo "impostos"
//   (=) RECEITA OPERACIONAL LÍQUIDA
//   (−) Custos ....................... compra de madeira (florestas, valor de cada viagem)
//                                      + corte e carregamento (empreiteiros)
//                                      + despesas do grupo "custo" (combustível, manutenção...)
//   (=) LUCRO BRUTO
//   (−) Despesas operacionais ........ pessoal (folha do mês + despesas "pessoal"),
//                                      administrativas, comerciais
//   (=) RESULTADO OPERACIONAL
//   (−) Resultado financeiro ......... despesas "financeira" (juros, tarifas)
//   (=) RESULTADO ANTES DO IR E CSLL
//   (−) IRPJ e CSLL .................. % da empresa (sobre o lucro ou a receita) + despesas "ir_csll"
//   (=) RESULTADO LÍQUIDO DO PERÍODO
//
// Para não contar duas vezes, ficam FORA (o custo já está em outro lugar):
//   - despesas ligadas a uma floresta ou a um empreiteiro (pagamentos e adiantamentos:
//     o custo é o valor das viagens);
//   - a despesa gerada ao pagar a folha e a de adiantamento da folha (o custo é a folha do mês);
//   - categorias marcadas "não entra na DRE".
// =====================================================================
const { query } = require('../config/db');

const GRUPOS = {
  custo: 'Custos da operação',
  pessoal: 'Despesas com pessoal',
  administrativa: 'Despesas administrativas e gerais',
  comercial: 'Despesas comerciais',
  financeira: 'Despesas financeiras',
  impostos: 'Impostos sobre a receita',
  ir_csll: 'IRPJ e CSLL',
  nao_entra: 'Não entra na DRE',
};
const REGIMES = { mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real', outro: 'Outro' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const n = (v) => Number(v) || 0;

// ---------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------
function mesesEntre(de, ate) {
  const lista = [];
  let [a, m] = de.split('-').map(Number);
  const [af, mf] = ate.split('-').map(Number);
  while (a < af || (a === af && m <= mf)) {
    lista.push(`${a}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; a++; }
    if (lista.length > 60) break;
  }
  return lista;
}
function somarMeses(mes, qtd) {
  let [a, m] = mes.split('-').map(Number);
  m += qtd;
  while (m > 12) { m -= 12; a++; }
  while (m < 1) { m += 12; a--; }
  return `${a}-${String(m).padStart(2, '0')}`;
}
const nomeMes = (mes) => `${MESES_LONGOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;
const mesCurto = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
function nomePeriodo(de, ate) {
  if (de === ate) return nomeMes(de);
  if (de.slice(0, 4) === ate.slice(0, 4) && de.endsWith('-01') && ate.endsWith('-12')) return `ano de ${de.slice(0, 4)}`;
  const trimestres = { '01-03': '1º', '04-06': '2º', '07-09': '3º', '10-12': '4º' };
  const t = trimestres[`${de.slice(5)}-${ate.slice(5)}`];
  if (t && de.slice(0, 4) === ate.slice(0, 4)) return `${t} trimestre de ${de.slice(0, 4)}`;
  return `${nomeMes(de)} a ${nomeMes(ate)}`;
}

// ---------------------------------------------------------------------
// Configuração (dados fiscais + grupo de cada categoria)
// ---------------------------------------------------------------------
async function lerConfig(empresaId) {
  const [emp, cats] = await Promise.all([
    query(`SELECT regime_tributario, aliquota_receita::float AS aliquota_receita, aliquota_ir_csll::float AS aliquota_ir_csll, base_ir_csll
             FROM empresas WHERE id = $1`, [empresaId]),
    query(`SELECT c.id, c.nome, c.ativo, COALESCE(c.grupo_dre, fn_grupo_dre_sugerido(c.nome)) AS grupo_dre,
                  (SELECT COUNT(*) FROM despesas d WHERE d.categoria_id = c.id AND d.status <> 'Cancelado')::int AS despesas
             FROM categorias_despesa c WHERE c.empresa_id = $1 ORDER BY c.ativo DESC, c.nome`, [empresaId]),
  ]);
  return { fiscal: emp.rows[0] || {}, categorias: cats.rows };
}

// ---------------------------------------------------------------------
// Dados brutos, mês a mês
// ---------------------------------------------------------------------
async function dadosPorMes(empresaId, de, ate) {
  const p = [empresaId, de, ate];
  const noPeriodo = (col) => `to_char(${col}, 'YYYY-MM') BETWEEN $2 AND $3`;
  const [viagens, empreiteiros, fretes, folhas, despesas, fora] = await Promise.all([
    query(`SELECT to_char(data, 'YYYY-MM') AS mes, COUNT(*)::int AS qtd, SUM(peso_liquido) AS toneladas,
                  SUM(valor_total) AS receita, SUM(total_floresta) AS floresta,
                  COUNT(*) FILTER (WHERE valor_ton_floresta IS NULL)::int AS sem_compra
             FROM viagens WHERE empresa_id = $1 AND status <> 'Cancelada' AND ${noPeriodo('data')} GROUP BY 1`, p),
    query(`SELECT to_char(data, 'YYYY-MM') AS mes, SUM(valor_total) AS valor
             FROM vw_viagem_empreiteiros WHERE empresa_id = $1 AND ${noPeriodo('data')} GROUP BY 1`, p),
    query(`SELECT to_char(data, 'YYYY-MM') AS mes, COUNT(*)::int AS qtd, SUM(toneladas) AS toneladas, SUM(valor_total) AS receita
             FROM fretes WHERE empresa_id = $1 AND status_pagamento <> 'Cancelado' AND ${noPeriodo('data')} GROUP BY 1`, p),
    query(`SELECT competencia AS mes, SUM(salario_base) AS salarios, SUM(comissao) AS comissoes,
                  SUM(alimentacao) AS alimentacao, SUM(extras) AS extras, COUNT(*)::int AS qtd
             FROM folhas WHERE empresa_id = $1 AND competencia BETWEEN $2 AND $3 GROUP BY 1`, p),
    // despesas que ENTRAM na DRE, por categoria
    query(`SELECT to_char(d.data, 'YYYY-MM') AS mes, c.id AS categoria_id, c.nome AS categoria,
                  COALESCE(c.grupo_dre, fn_grupo_dre_sugerido(c.nome)) AS grupo, SUM(d.valor) AS valor, COUNT(*)::int AS qtd
             FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
            WHERE d.empresa_id = $1 AND d.status <> 'Cancelado' AND ${noPeriodo('d.data')}
              AND d.floresta_id IS NULL AND d.empreiteiro_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM folhas fo WHERE fo.despesa_id = d.id)
              AND NOT EXISTS (SELECT 1 FROM adiantamentos ad WHERE ad.despesa_id = d.id)
              AND COALESCE(c.grupo_dre, fn_grupo_dre_sugerido(c.nome)) <> 'nao_entra'
            GROUP BY 1, 2, 3, 4`, p),
    // o que ficou fora (para a nota de conferência)
    query(`SELECT CASE WHEN d.floresta_id IS NOT NULL THEN 'floresta'
                       WHEN d.empreiteiro_id IS NOT NULL THEN 'empreiteiro'
                       WHEN EXISTS (SELECT 1 FROM folhas fo WHERE fo.despesa_id = d.id) THEN 'folha'
                       WHEN EXISTS (SELECT 1 FROM adiantamentos ad WHERE ad.despesa_id = d.id) THEN 'adiantamento'
                       ELSE 'categoria' END AS motivo, SUM(d.valor) AS valor, COUNT(*)::int AS qtd
             FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
            WHERE d.empresa_id = $1 AND d.status <> 'Cancelado' AND ${noPeriodo('d.data')}
              AND (d.floresta_id IS NOT NULL OR d.empreiteiro_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM folhas fo WHERE fo.despesa_id = d.id)
                   OR EXISTS (SELECT 1 FROM adiantamentos ad WHERE ad.despesa_id = d.id)
                   OR COALESCE(c.grupo_dre, fn_grupo_dre_sugerido(c.nome)) = 'nao_entra')
            GROUP BY 1`, p),
  ]);
  const meses = mesesEntre(de, ate);
  const porMes = Object.fromEntries(meses.map((m) => [m, {
    receita_madeira: 0, toneladas: 0, viagens: 0, sem_compra: 0, receita_fretes: 0, fretes: 0, toneladas_fretes: 0,
    floresta: 0, empreiteiros: 0, salarios: 0, comissoes: 0, alimentacao: 0, extras: 0, folhas: 0, categorias: {},
  }]));
  viagens.rows.forEach((r) => Object.assign(porMes[r.mes] || {}, { receita_madeira: n(r.receita), toneladas: n(r.toneladas), viagens: r.qtd, floresta: n(r.floresta), sem_compra: r.sem_compra }));
  empreiteiros.rows.forEach((r) => { if (porMes[r.mes]) porMes[r.mes].empreiteiros = n(r.valor); });
  fretes.rows.forEach((r) => Object.assign(porMes[r.mes] || {}, { receita_fretes: n(r.receita), fretes: r.qtd, toneladas_fretes: n(r.toneladas) }));
  folhas.rows.forEach((r) => Object.assign(porMes[r.mes] || {}, { salarios: n(r.salarios), comissoes: n(r.comissoes), alimentacao: n(r.alimentacao), extras: n(r.extras), folhas: r.qtd }));
  const categorias = new Map(); // id -> { id, nome, grupo }
  despesas.rows.forEach((r) => {
    if (!porMes[r.mes]) return;
    porMes[r.mes].categorias[r.categoria_id] = (porMes[r.mes].categorias[r.categoria_id] || 0) + n(r.valor);
    categorias.set(r.categoria_id, { id: r.categoria_id, nome: r.categoria, grupo: r.grupo });
  });
  return { meses, porMes, categorias: [...categorias.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), fora: fora.rows.map((f) => ({ ...f, valor: n(f.valor) })) };
}

// ---------------------------------------------------------------------
// Monta as linhas da DRE para um conjunto de valores (um mês ou a soma)
//   v = { receita_madeira, ..., categorias: { id: valor } }
// Linhas: { id, rotulo, nivel (0 título/subtotal, 1 item, 2 detalhe), tipo, valor (com sinal) }
// ---------------------------------------------------------------------
function montarLinhas(v, categorias, fiscal) {
  const L = [];
  const add = (id, rotulo, tipo, valor, nivel = 1, extra = {}) => { L.push({ id, rotulo, tipo, nivel, valor: r2(valor), ...extra }); return r2(valor); };
  const doGrupo = (grupo) => categorias.filter((c) => c.grupo === grupo);
  const somaGrupo = (grupo) => doGrupo(grupo).reduce((t, c) => t + n(v.categorias[c.id]), 0);

  // 1. Receita bruta
  const receitaBruta = v.receita_madeira + v.receita_fretes;
  add('receita_bruta', 'RECEITA OPERACIONAL BRUTA', 'grupo', receitaBruta, 0);
  add('receita_madeira', 'Venda de madeira', 'item', v.receita_madeira);
  add('receita_fretes', 'Serviços de frete', 'item', v.receita_fretes);

  // 2. Deduções
  const aliq = n(fiscal.aliquota_receita);
  const impostoCalc = -receitaBruta * (aliq / 100);
  const impostosLancados = -somaGrupo('impostos');
  const deducoes = impostoCalc + impostosLancados;
  add('deducoes', '(−) DEDUÇÕES DA RECEITA BRUTA', 'grupo', deducoes, 0);
  add('impostos_calc', `Impostos sobre a receita${aliq ? ` (${String(aliq).replace('.', ',')}%${fiscal.regime_tributario ? ` · ${REGIMES[fiscal.regime_tributario]}` : ''})` : ' (alíquota não informada)'}`, 'item', impostoCalc, 1, { sempre: true });
  doGrupo('impostos').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 1));

  // 3. Receita líquida
  const receitaLiquida = receitaBruta + deducoes;
  add('receita_liquida', '(=) RECEITA OPERACIONAL LÍQUIDA', 'subtotal', receitaLiquida, 0);

  // 4. Custos
  const custoOperacao = somaGrupo('custo');
  const custos = -(v.floresta + v.empreiteiros + custoOperacao);
  add('custos', '(−) CUSTOS DOS PRODUTOS E SERVIÇOS VENDIDOS', 'grupo', custos, 0);
  add('custo_floresta', 'Compra de madeira (florestas)', 'item', -v.floresta, 1, { sempre: true });
  add('custo_empreiteiros', 'Corte e carregamento (empreiteiros)', 'item', -v.empreiteiros, 1, { sempre: true });
  add('custo_operacao', 'Custos da operação e transporte', 'item', -custoOperacao);
  doGrupo('custo').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 2));

  // 5. Lucro bruto
  const lucroBruto = receitaLiquida + custos;
  add('lucro_bruto', '(=) LUCRO BRUTO', 'subtotal', lucroBruto, 0);

  // 6. Despesas operacionais
  const folha = v.salarios + v.comissoes + v.alimentacao + v.extras;
  const pessoalLancado = somaGrupo('pessoal');
  const adm = somaGrupo('administrativa');
  const com = somaGrupo('comercial');
  const despesasOp = -(folha + pessoalLancado + adm + com);
  add('despesas_operacionais', '(−) DESPESAS OPERACIONAIS', 'grupo', despesasOp, 0);
  add('pessoal', 'Despesas com pessoal', 'item', -(folha + pessoalLancado), 1, { sempre: true });
  add('folha_salarios', 'Salários (folha)', 'item', -v.salarios, 2);
  add('folha_comissoes', 'Comissões de motoristas (folha)', 'item', -v.comissoes, 2);
  add('folha_alimentacao', 'Alimentação (folha)', 'item', -v.alimentacao, 2);
  add('folha_extras', 'Extras e adicionais (folha)', 'item', -v.extras, 2);
  doGrupo('pessoal').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 2));
  add('administrativas', 'Despesas administrativas e gerais', 'item', -adm, 1, { sempre: true });
  doGrupo('administrativa').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 2));
  add('comerciais', 'Despesas comerciais', 'item', -com);
  doGrupo('comercial').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 2));

  // 7. Resultado operacional
  const resultadoOp = lucroBruto + despesasOp;
  add('resultado_operacional', '(=) RESULTADO OPERACIONAL', 'subtotal', resultadoOp, 0);

  // 8. Resultado financeiro
  const fin = -somaGrupo('financeira');
  add('resultado_financeiro', '(±) RESULTADO FINANCEIRO', 'grupo', fin, 0);
  add('despesas_financeiras', 'Despesas financeiras', 'item', fin, 1, { sempre: true });
  doGrupo('financeira').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 2));

  // 9. Antes do IR
  const antesIR = resultadoOp + fin;
  add('resultado_antes_ir', '(=) RESULTADO ANTES DO IRPJ E CSLL', 'subtotal', antesIR, 0);

  // 10. IRPJ/CSLL
  const aliqIR = n(fiscal.aliquota_ir_csll);
  const baseReceita = fiscal.base_ir_csll === 'receita';
  const irCalc = aliqIR ? -(baseReceita ? receitaBruta : Math.max(antesIR, 0)) * (aliqIR / 100) : 0;
  const irLancado = -somaGrupo('ir_csll');
  const ir = irCalc + irLancado;
  add('ir_csll', '(−) IRPJ E CSLL', 'grupo', ir, 0);
  if (aliqIR) add('ir_calc', `Provisão de IRPJ e CSLL (${String(aliqIR).replace('.', ',')}% sobre ${baseReceita ? 'a receita bruta' : 'o lucro'})`, 'item', irCalc);
  doGrupo('ir_csll').forEach((c) => add(`cat:${c.id}`, c.nome, 'item', -n(v.categorias[c.id]), 1));

  // 11. Resultado líquido
  const liquido = antesIR + ir;
  add('resultado_liquido', liquido >= 0 ? '(=) LUCRO LÍQUIDO DO PERÍODO' : '(=) PREJUÍZO DO PERÍODO', 'resultado', liquido, 0);

  const pctDe = (x) => (receitaLiquida ? r2((x / receitaLiquida) * 100) : null);
  const tonTotal = v.toneladas;
  return {
    linhas: L,
    totais: { receitaBruta: r2(receitaBruta), receitaLiquida: r2(receitaLiquida), lucroBruto: r2(lucroBruto), resultadoOp: r2(resultadoOp), antesIR: r2(antesIR), liquido: r2(liquido), custos: r2(custos), despesasOp: r2(despesasOp), deducoes: r2(deducoes) },
    indicadores: {
      margem_bruta: pctDe(lucroBruto),
      margem_operacional: pctDe(resultadoOp),
      margem_liquida: pctDe(liquido),
      toneladas: r2(tonTotal),
      viagens: v.viagens,
      fretes: v.fretes,
      receita_por_tonelada: tonTotal ? r2(v.receita_madeira / tonTotal) : null,
      custo_madeira_por_tonelada: tonTotal ? r2((v.floresta + v.empreiteiros) / tonTotal) : null,
      resultado_por_tonelada: tonTotal ? r2(liquido / tonTotal) : null,
    },
  };
}

// Soma os valores de vários meses
function somar(porMes, meses) {
  const t = { receita_madeira: 0, toneladas: 0, viagens: 0, sem_compra: 0, receita_fretes: 0, fretes: 0, toneladas_fretes: 0, floresta: 0, empreiteiros: 0, salarios: 0, comissoes: 0, alimentacao: 0, extras: 0, folhas: 0, categorias: {} };
  meses.forEach((m) => {
    const v = porMes[m];
    if (!v) return;
    for (const k of Object.keys(t)) if (k !== 'categorias') t[k] += v[k];
    for (const [id, valor] of Object.entries(v.categorias)) t.categorias[id] = (t.categorias[id] || 0) + valor;
  });
  return t;
}

// ---------------------------------------------------------------------
// DRE completa
//   de, ate: 'AAAA-MM' · comparar: 'anterior' | 'ano_anterior' | null · mensal: colunas mês a mês
// ---------------------------------------------------------------------
async function calcularDRE(empresaId, { de, ate, comparar = null, mensal = false }) {
  if (de > ate) [de, ate] = [ate, de];
  const { fiscal } = await lerConfig(empresaId);
  const qtdMeses = mesesEntre(de, ate).length;
  let comp = null;
  if (comparar === 'anterior') comp = { de: somarMeses(de, -qtdMeses), ate: somarMeses(de, -1) };
  if (comparar === 'ano_anterior') comp = { de: somarMeses(de, -12), ate: somarMeses(ate, -12) };

  const atual = await dadosPorMes(empresaId, de, ate);
  const anterior = comp ? await dadosPorMes(empresaId, comp.de, comp.ate) : null;
  // categorias que aparecem em qualquer um dos períodos (para as linhas baterem)
  const cats = new Map([...atual.categorias, ...(anterior ? anterior.categorias : [])].map((c) => [c.id, c]));
  const categorias = [...cats.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const totalAtual = somar(atual.porMes, atual.meses);
  const principal = montarLinhas(totalAtual, categorias, fiscal);
  const outro = anterior ? montarLinhas(somar(anterior.porMes, anterior.meses), categorias, fiscal) : null;
  const porMes = mensal ? atual.meses.map((m) => ({ mes: m, rotulo: mesCurto(m), ...montarLinhas(atual.porMes[m], categorias, fiscal) })) : null;

  // junta as colunas e tira linhas zeradas em tudo (menos as que sempre aparecem)
  const base = principal.totais.receitaLiquida;
  const linhas = principal.linhas.map((l, i) => {
    const linha = { ...l, av: base ? r2((l.valor / base) * 100) : null };
    if (outro) {
      const ant = outro.linhas[i].valor;
      linha.anterior = ant;
      linha.variacao = ant ? r2(((l.valor - ant) / Math.abs(ant)) * 100) : null;
    }
    if (porMes) linha.meses = porMes.map((pm) => pm.linhas[i].valor);
    return linha;
  }).filter((l) => l.nivel === 0 || l.sempre || l.valor !== 0 || (l.anterior || 0) !== 0 || (l.meses || []).some((x) => x !== 0));

  // avisos de conferência
  const avisos = [];
  if (totalAtual.sem_compra) avisos.push(`${totalAtual.sem_compra} viagem(ns) sem o valor de compra da floresta: o custo da madeira está menor do que o real.`);
  if (!n(fiscal.aliquota_receita) && !categorias.some((c) => c.grupo === 'impostos')) avisos.push('Sem alíquota de impostos sobre a receita: informe em Dados da empresa (regime e alíquota) para a DRE descontar os impostos.');
  if (!totalAtual.folhas && atual.meses.length) avisos.push('Nenhuma folha de pagamento gerada no período: salários e comissões não aparecem (gere a folha em Pessoal › Folha de pagamento).');

  return {
    periodo: { de, ate, nome: nomePeriodo(de, ate), meses: atual.meses.length },
    comparativo: comp ? { ...comp, nome: nomePeriodo(comp.de, comp.ate), tipo: comparar } : null,
    colunas_meses: porMes ? porMes.map((pm) => ({ mes: pm.mes, rotulo: pm.rotulo })) : null,
    fiscal: { ...fiscal, regime_nome: fiscal.regime_tributario ? REGIMES[fiscal.regime_tributario] : null },
    linhas,
    totais: principal.totais,
    indicadores: principal.indicadores,
    indicadores_anterior: outro ? outro.indicadores : null,
    fora_da_dre: atual.fora,
    avisos,
  };
}

module.exports = { calcularDRE, lerConfig, GRUPOS, REGIMES, mesesEntre, nomePeriodo, somarMeses };
