// =====================================================================
// FOLHA DE PAGAMENTO - cálculo
//
// COMISSÃO DO MOTORISTA (cada um tem a sua tabela de faixas):
//   para cada carga que ELE fez no mês (viagens e fretes, sem as canceladas):
//     km = km corrigido na carga  ou  km da ROTA (floresta -> cliente /
//          cliente -> destino do frete)
//     faixa = a primeira faixa dele com km <= "até" (a sem limite = acima)
//     comissão da carga = toneladas x R$/t da faixa
//   comissão do mês = soma das cargas
//   Carga sem km (rota não cadastrada) ou sem faixa entra como PENDÊNCIA
//   (aparece na tela para corrigir) e vale R$ 0 até ser resolvida.
//
// ADIANTAMENTO do mês = soma das parcelas com competência = mês da folha.
// SALDO A PAGAR = salário + comissão + alimentação + extras - adiantamento - desconto
//   (calculado pelo banco: coluna folhas.saldo_pagar)
// =====================================================================
const { query } = require('../config/db');

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (n) => (n === null || n === undefined ? null : Number(n));

// Faixas em ordem: as com limite (menor -> maior) e por último a "acima"
function ordenarFaixas(faixas) {
  return [...faixas].map((f) => ({ km_ate: num(f.km_ate), valor_tonelada: Number(f.valor_tonelada) }))
    .sort((a, b) => (a.km_ate === null) - (b.km_ate === null) || a.km_ate - b.km_ate);
}
function faixaDoKm(faixas, km) {
  return ordenarFaixas(faixas).find((f) => f.km_ate === null || km <= f.km_ate) || null;
}
const kmTexto = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
function textoFaixa(faixas, f) {
  const lista = ordenarFaixas(faixas);
  const i = lista.findIndex((x) => x.km_ate === f.km_ate);
  const anterior = i > 0 ? lista[i - 1].km_ate : null;
  if (f.km_ate === null) return anterior ? `acima de ${kmTexto(anterior)} km` : 'qualquer distância';
  return anterior ? `${kmTexto(anterior)}–${kmTexto(f.km_ate)} km` : `até ${kmTexto(f.km_ate)} km`;
}

// Cargas do motorista no mês, já com o km da rota (se houver)
async function cargasDoMotorista(empresaId, motoristaId, competencia) {
  const [viagens, fretes] = await Promise.all([
    query(
      `SELECT 'viagem' AS tipo, v.id, v.numero_viagem AS numero, to_char(v.data, 'YYYY-MM-DD') AS data,
              f.nome AS origem, c.nome AS destino, v.peso_liquido AS toneladas, v.km AS km_carga, r.km AS km_rota,
              v.ticket
         FROM viagens v
         JOIN florestas f ON f.id = v.floresta_id
         JOIN clientes c  ON c.id = v.cliente_id
         LEFT JOIN rotas r ON r.empresa_id = v.empresa_id AND r.tipo = 'viagem'
                          AND r.floresta_id = v.floresta_id AND r.cliente_id = v.cliente_id
        WHERE v.empresa_id = $1 AND v.motorista_id = $2 AND to_char(v.data, 'YYYY-MM') = $3 AND v.status <> 'Cancelada'
        ORDER BY v.data, v.id`, [empresaId, motoristaId, competencia]),
    query(
      `SELECT 'frete' AS tipo, fr.id, fr.numero_carga AS numero, to_char(fr.data, 'YYYY-MM-DD') AS data,
              c.nome AS origem, fr.destino, fr.toneladas, fr.km AS km_carga, r.km AS km_rota, NULL AS ticket
         FROM fretes fr
         JOIN clientes c ON c.id = fr.cliente_id
         LEFT JOIN rotas r ON r.empresa_id = fr.empresa_id AND r.tipo = 'frete' AND r.cliente_id = fr.cliente_id
                          AND r.destino_chave = upper(btrim(coalesce(fr.destino, '')))
        WHERE fr.empresa_id = $1 AND fr.motorista_id = $2 AND to_char(fr.data, 'YYYY-MM') = $3 AND fr.status_pagamento <> 'Cancelado'
        ORDER BY fr.data, fr.id`, [empresaId, motoristaId, competencia]),
  ]);
  return [...viagens.rows, ...fretes.rows].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// funcionario: { id, motorista_id }
async function calcularComissao(empresaId, funcionario, competencia) {
  if (!funcionario.motorista_id) return { total: 0, cargas: [], sem_km: 0, sem_faixa: false, faixas: [], motorista: false };
  const faixas = (await query('SELECT km_ate, valor_tonelada FROM comissao_faixas WHERE funcionario_id = $1', [funcionario.id])).rows;
  const cargas = (await cargasDoMotorista(empresaId, funcionario.motorista_id, competencia)).map((c) => {
    const km = num(c.km_carga) ?? num(c.km_rota);
    const toneladas = Number(c.toneladas);
    const item = {
      tipo: c.tipo, id: c.id, numero: c.numero, data: c.data, origem: c.origem, destino: c.destino || null,
      ticket: c.ticket, toneladas, km, km_origem: c.km_carga !== null ? 'carga' : c.km_rota !== null ? 'rota' : null,
      km_rota: num(c.km_rota), faixa: null, valor_tonelada: null, valor: 0, pendencia: null,
    };
    if (!faixas.length) return item; // motorista sem comissão por tonelada: a carga não gera comissão
    if (km === null) { item.pendencia = 'sem_km'; return item; }
    const f = faixaDoKm(faixas, km);
    if (!f) { item.pendencia = 'sem_faixa'; return item; }
    item.faixa = textoFaixa(faixas, f);
    item.valor_tonelada = f.valor_tonelada;
    item.valor = r2(toneladas * f.valor_tonelada);
    return item;
  });
  return {
    total: r2(cargas.reduce((t, c) => t + c.valor, 0)),
    toneladas: r2(cargas.reduce((t, c) => t + c.toneladas, 0)),
    cargas,
    sem_km: cargas.filter((c) => c.pendencia === 'sem_km').length,
    sem_faixa: cargas.some((c) => c.pendencia === 'sem_faixa'),
    sem_comissao: !faixas.length,
    faixas: ordenarFaixas(faixas).map((f) => ({ ...f, texto: textoFaixa(faixas, f) })),
    motorista: true,
  };
}

async function adiantamentoDoMes(empresaId, funcionarioId, competencia) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(p.valor), 0) AS total FROM adiantamento_parcelas p JOIN adiantamentos a ON a.id = p.adiantamento_id
      WHERE a.empresa_id = $1 AND a.funcionario_id = $2 AND p.competencia = $3`, [empresaId, funcionarioId, competencia]);
  return Number(rows[0].total);
}

// Último dia do mês (para saber quem já tinha sido admitido)
const fimDoMes = (competencia) => {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

// Cria a folha do mês para quem ainda não tem (funcionários ativos já admitidos)
async function gerarFolha(empresaId, competencia) {
  const { rows: funcs } = await query(
    `SELECT f.* FROM funcionarios f
      WHERE f.empresa_id = $1 AND f.ativo AND (f.data_admissao IS NULL OR f.data_admissao <= $2::date)
        AND NOT EXISTS (SELECT 1 FROM folhas x WHERE x.funcionario_id = f.id AND x.competencia = $3)
      ORDER BY f.nome`, [empresaId, fimDoMes(competencia), competencia]);
  for (const f of funcs) {
    const [comissao, adiantamento] = await Promise.all([calcularComissao(empresaId, f, competencia), adiantamentoDoMes(empresaId, f.id, competencia)]);
    await query(
      `INSERT INTO folhas (empresa_id, funcionario_id, competencia, cargo, salario_base, comissao, alimentacao, adiantamento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (funcionario_id, competencia) DO NOTHING`,
      [empresaId, f.id, competencia, f.cargo, f.salario_base, comissao.total, f.alimentacao, adiantamento]);
  }
  return funcs.length;
}

// Folha ABERTA acompanha os lançamentos: recalcula comissão (se não foi
// digitada à mão) e adiantamento. Fechada/Paga fica como está.
async function atualizarAbertas(empresaId, competencia) {
  const { rows } = await query(
    `SELECT x.id, x.comissao, x.adiantamento, x.comissao_manual, f.id AS funcionario_id, f.motorista_id
       FROM folhas x JOIN funcionarios f ON f.id = x.funcionario_id
      WHERE x.empresa_id = $1 AND x.competencia = $2 AND x.status = 'Aberta'`, [empresaId, competencia]);
  for (const x of rows) {
    const adiantamento = await adiantamentoDoMes(empresaId, x.funcionario_id, competencia);
    const comissao = x.comissao_manual ? Number(x.comissao)
      : (await calcularComissao(empresaId, { id: x.funcionario_id, motorista_id: x.motorista_id }, competencia)).total;
    if (r2(comissao) !== r2(x.comissao) || r2(adiantamento) !== r2(x.adiantamento)) {
      await query('UPDATE folhas SET comissao = $2, adiantamento = $3 WHERE id = $1', [x.id, comissao, adiantamento]);
    }
  }
}

module.exports = { calcularComissao, adiantamentoDoMes, gerarFolha, atualizarAbertas, faixaDoKm, textoFaixa, ordenarFaixas, fimDoMes, r2 };
