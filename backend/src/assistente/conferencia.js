// =====================================================================
// CONFERÊNCIA DO MÊS - procura lançamentos que merecem uma segunda olhada
//
// É o "auxiliar de conferência" do TCC. Funciona sozinho (botão Conferir)
// e também é uma das ferramentas que a IA usa para responder.
//
// Cada achado: { regra, gravidade: 'erro'|'atencao'|'info', titulo, detalhe, itens: [...] }
//   erro    = quase certamente está errado (ex.: viagem com data no futuro)
//   atencao = pode estar certo, mas vale conferir (ex.: preço bem fora do comum)
//   info    = lembrete (ex.: fretes pendentes)
// =====================================================================
const { query } = require('../config/db');

// Limites de peso de uma carga (toneladas) fora dos quais vale conferir
const PESO_MIN = 10;
const PESO_MAX = 60;
const LIMITE_ITENS = 15; // no máximo 15 exemplos por regra (o total vem em "quantidade")

async function conferirMes(empresaId, mes) {
  const p = [empresaId, mes];
  const doMes = "empresa_id = $1 AND to_char(data, 'YYYY-MM') = $2";
  const viagensAtivas = `v.empresa_id = $1 AND to_char(v.data, 'YYYY-MM') = $2 AND v.status <> 'Cancelada'`;

  const consultas = {
    // Viagem sem ticket: na planilha toda carga da serraria tem ticket de pesagem
    semTicket: query(
      `SELECT v.id, v.numero_viagem, to_char(v.data, 'DD/MM/YYYY') AS data, c.nome AS cliente, v.placa, v.peso_liquido
         FROM viagens v JOIN clientes c ON c.id = v.cliente_id
        WHERE ${viagensAtivas} AND (v.ticket IS NULL OR v.ticket = '')
        ORDER BY v.data, v.id`, p),

    // Preço de venda bem diferente (mais de 20%) da média do mês para o mesmo cliente e classe:
    // os preços mudam, mas uma diferença grande costuma ser erro de digitação
    precoDiferente: query(
      `SELECT * FROM (
         SELECT v.id, v.numero_viagem, to_char(v.data, 'DD/MM/YYYY') AS data, c.nome AS cliente, cm.nome AS classe,
                v.valor_tonelada AS cobrado,
                ROUND(AVG(v.valor_tonelada) OVER (PARTITION BY v.cliente_id, v.classe_id), 2) AS media,
                COUNT(*) OVER (PARTITION BY v.cliente_id, v.classe_id) AS n
           FROM viagens v
           JOIN clientes c ON c.id = v.cliente_id
           JOIN classes_madeira cm ON cm.id = v.classe_id
          WHERE ${viagensAtivas}) x
        WHERE n >= 3 AND media > 0 AND ABS(cobrado - media) / media > 0.20
        ORDER BY data, id`, p),

    // Peso muito baixo ou muito alto para uma carga de caminhão
    pesoForaDoNormal: query(
      `SELECT v.id, v.numero_viagem, to_char(v.data, 'DD/MM/YYYY') AS data, v.ticket, v.placa, v.peso_liquido
         FROM viagens v
        WHERE ${viagensAtivas} AND (v.peso_liquido < ${PESO_MIN} OR v.peso_liquido > ${PESO_MAX})
        ORDER BY v.peso_liquido`, p),

    // A mesma placa em 3 ou mais viagens no mesmo dia (pode ser lançamento repetido)
    placaRepetida: query(
      `SELECT v.placa, to_char(v.data, 'DD/MM/YYYY') AS data, COUNT(*)::int AS viagens,
              string_agg(COALESCE(v.ticket, 'sem ticket'), ', ' ORDER BY v.id) AS tickets
         FROM viagens v
        WHERE ${viagensAtivas} AND v.placa IS NOT NULL AND v.placa <> ''
        GROUP BY v.placa, v.data HAVING COUNT(*) >= 3
        ORDER BY v.data`, p),

    // Mesmo peso, mesma placa e mesmo dia: forte suspeita de viagem lançada duas vezes
    duplicada: query(
      `SELECT v.placa, to_char(v.data, 'DD/MM/YYYY') AS data, v.peso_liquido, COUNT(*)::int AS vezes,
              string_agg(v.numero_viagem, ', ' ORDER BY v.id) AS numeros
         FROM viagens v
        WHERE ${viagensAtivas}
        GROUP BY v.placa, v.data, v.peso_liquido HAVING COUNT(*) > 1
        ORDER BY v.data`, p),

    // Viagem com data no futuro
    dataFutura: query(
      `SELECT v.id, v.numero_viagem, to_char(v.data, 'DD/MM/YYYY') AS data, v.ticket
         FROM viagens v WHERE ${viagensAtivas} AND v.data > CURRENT_DATE`, p),

    // Sem valor de compra da floresta (ex.: viagens importadas do Excel)
    semCustoFloresta: query(
      `SELECT f.nome AS floresta, cm.nome AS classe, COUNT(*)::int AS viagens, SUM(v.peso_liquido) AS toneladas
         FROM viagens v JOIN florestas f ON f.id = v.floresta_id JOIN classes_madeira cm ON cm.id = v.classe_id
        WHERE ${viagensAtivas} AND v.valor_ton_floresta IS NULL
        GROUP BY f.nome, cm.nome ORDER BY f.nome`, p),

    // Tem empreiteiro, mas sem o valor pago a ele
    semValorEmpreiteiro: query(
      `SELECT e.nome AS empreiteiro, COUNT(*)::int AS viagens, SUM(v.peso_liquido) AS toneladas
         FROM viagens v JOIN empreiteiros e ON e.id = v.empreiteiro_id
        WHERE ${viagensAtivas} AND v.valor_ton_empreiteiro IS NULL
        GROUP BY e.nome ORDER BY e.nome`, p),

    // Sem empreiteiro (e sem divisão de carga): ninguém recebe por essa produção
    semEmpreiteiro: query(
      `SELECT v.id, v.numero_viagem, to_char(v.data, 'DD/MM/YYYY') AS data, v.ticket
         FROM viagens v
        WHERE ${viagensAtivas} AND v.empreiteiro_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM viagem_empreiteiros ve WHERE ve.viagem_id = v.id)
        ORDER BY v.data`, p),

    // Empreiteiro que recebeu (adiantamentos) mais do que produziu no mês
    empreiteiroNegativo: query(
      `SELECT empreiteiro, valor_bruto, despesas, liquido FROM vw_relatorio_empreiteiro
        WHERE empresa_id = $1 AND mes = $2 AND liquido < 0 ORDER BY liquido`, p),

    // Fretes ainda não recebidos com mais de 30 dias
    fretesAtrasados: query(
      `SELECT fr.numero_carga, to_char(fr.data, 'DD/MM/YYYY') AS data, c.nome AS cliente, fr.valor_total,
              (CURRENT_DATE - fr.data) AS dias
         FROM fretes fr JOIN clientes c ON c.id = fr.cliente_id
        WHERE fr.${doMes} AND fr.status_pagamento = 'Pendente' AND fr.data < CURRENT_DATE - 30
        ORDER BY fr.data`, p),

    // Despesas pendentes com mais de 30 dias
    despesasAtrasadas: query(
      `SELECT d.descricao, to_char(d.data, 'DD/MM/YYYY') AS data, d.valor, (CURRENT_DATE - d.data) AS dias
         FROM despesas d
        WHERE d.${doMes} AND d.status = 'Pendente' AND d.data < CURRENT_DATE - 30
        ORDER BY d.data`, p),

    total: query(`SELECT COUNT(*)::int AS viagens FROM viagens v WHERE ${viagensAtivas}`, p),
  };

  const r = Object.fromEntries(await Promise.all(
    Object.entries(consultas).map(async ([k, c]) => [k, (await c).rows])
  ));

  const achados = [];
  const add = (regra, gravidade, linhas, titulo, detalhe, item) => {
    if (!linhas.length) return;
    achados.push({ regra, gravidade, quantidade: linhas.length, titulo: titulo(linhas.length), detalhe, itens: linhas.slice(0, LIMITE_ITENS).map(item) });
  };
  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ton = (v) => `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;

  add('data_futura', 'erro', r.dataFutura, (n) => `${n} viagem(ns) com data no futuro`,
    'Provavelmente a data foi digitada errada.', (v) => `Viagem nº ${v.numero_viagem} em ${v.data}${v.ticket ? ` (ticket ${v.ticket})` : ''}`);
  add('duplicada', 'erro', r.duplicada, (n) => `${n} possível(is) viagem(ns) lançada(s) em dobro`,
    'Mesma placa, mesmo dia e mesmo peso. Confira se não é a mesma carga lançada duas vezes.',
    (v) => `${v.placa || 'sem placa'} em ${v.data}: ${v.vezes}× ${ton(v.peso_liquido)} (viagens nº ${v.numeros})`);
  add('preco_diferente', 'atencao', r.precoDiferente, (n) => `${n} viagem(ns) com preço bem fora do comum`,
    'O valor da tonelada está mais de 20% acima ou abaixo da média do mês para o mesmo cliente e classe. Pode ser erro de digitação.',
    (v) => `Viagem nº ${v.numero_viagem} (${v.data}, ${v.cliente}, ${v.classe}): ${brl(v.cobrado)}/t, média do mês ${brl(v.media)}/t`);
  add('sem_ticket', 'atencao', r.semTicket, (n) => `${n} viagem(ns) sem ticket`,
    'Sem o ticket fica difícil conferir com o romaneio da serraria.',
    (v) => `Viagem nº ${v.numero_viagem} em ${v.data} (${v.cliente}${v.placa ? `, placa ${v.placa}` : ''}, ${ton(v.peso_liquido)})`);
  add('peso', 'atencao', r.pesoForaDoNormal, (n) => `${n} viagem(ns) com peso fora do normal`,
    `Peso abaixo de ${PESO_MIN} t ou acima de ${PESO_MAX} t. Pode ser erro de digitação (vírgula no lugar errado).`,
    (v) => `Viagem nº ${v.numero_viagem} em ${v.data}: ${ton(v.peso_liquido)}${v.ticket ? ` (ticket ${v.ticket})` : ''}`);
  add('placa_repetida', 'atencao', r.placaRepetida, (n) => `${n} caso(s) de placa com 3+ viagens no mesmo dia`,
    'É possível, mas incomum. Confira os tickets.', (v) => `${v.placa} em ${v.data}: ${v.viagens} viagens (tickets ${v.tickets})`);
  add('sem_custo_floresta', 'atencao', r.semCustoFloresta, (n) => `${n} floresta/classe sem valor de compra`,
    'Essas viagens estão sem o valor pago à floresta (o custo fica zero). Abra as viagens e informe a compra da floresta.',
    (v) => `${v.floresta} · ${v.classe}: ${v.viagens} viagem(ns), ${ton(v.toneladas)}`);
  add('sem_valor_empreiteiro', 'atencao', r.semValorEmpreiteiro, (n) => `${n} empreiteiro(s) com viagens sem valor`,
    'Essas viagens têm empreiteiro, mas sem o valor pago a ele por tonelada. Informe o valor nas viagens.',
    (v) => `${v.empreiteiro}: ${v.viagens} viagem(ns), ${ton(v.toneladas)}`);
  add('sem_empreiteiro', 'info', r.semEmpreiteiro, (n) => `${n} viagem(ns) sem empreiteiro`,
    'Ninguém recebe por essa produção no relatório de empreiteiros.',
    (v) => `Viagem nº ${v.numero_viagem} em ${v.data}${v.ticket ? ` (ticket ${v.ticket})` : ''}`);
  add('empreiteiro_negativo', 'atencao', r.empreiteiroNegativo, (n) => `${n} empreiteiro(s) com saldo negativo`,
    'Recebeu mais (adiantamentos/pagamentos) do que produziu no mês.',
    (v) => `${v.empreiteiro}: produziu ${brl(v.valor_bruto)}, recebeu ${brl(v.despesas)}, saldo ${brl(v.liquido)}`);
  add('fretes_atrasados', 'info', r.fretesAtrasados, (n) => `${n} frete(s) a receber há mais de 30 dias`,
    'Ainda constam como pendentes.', (v) => `Carga nº ${v.numero_carga} (${v.data}, ${v.cliente}): ${brl(v.valor_total)}, há ${v.dias} dias`);
  add('despesas_atrasadas', 'info', r.despesasAtrasadas, (n) => `${n} despesa(s) a pagar há mais de 30 dias`,
    'Ainda constam como pendentes.', (v) => `${v.descricao} (${v.data}): ${brl(v.valor)}, há ${v.dias} dias`);

  const ordem = { erro: 0, atencao: 1, info: 2 };
  achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
  return {
    mes,
    viagens_conferidas: r.total[0].viagens,
    resumo: {
      erros: achados.filter((a) => a.gravidade === 'erro').length,
      atencao: achados.filter((a) => a.gravidade === 'atencao').length,
      info: achados.filter((a) => a.gravidade === 'info').length,
    },
    achados,
  };
}

module.exports = { conferirMes };
