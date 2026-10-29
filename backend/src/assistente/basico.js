// =====================================================================
// MODO BÁSICO do assistente (sem IA externa)
//
// Usado quando não há chave da API configurada (ou a IA está fora do ar).
// Entende perguntas por palavras-chave e responde com as MESMAS ferramentas
// que a IA usa - então os números são sempre os do banco.
// =====================================================================
const { executarFerramenta } = require('./ferramentas');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ton = (v) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
const nomeMes = (m) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(0, 4)}`;
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Descobre o mês citado na pergunta; se não citar, usa o mês em foco na tela
function mesDaPergunta(texto, mesFoco) {
  const t = semAcento(texto);
  let m = t.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/\b(0?[1-9]|1[0-2])\/(20\d{2})\b/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const [anoFoco, mesF] = mesFoco.split('-').map(Number);
  if (/mes passado|mes anterior/.test(t)) {
    const d = new Date(Date.UTC(anoFoco, mesF - 2, 1));
    return d.toISOString().slice(0, 7);
  }
  const idx = MESES.findIndex((nome) => new RegExp(`\\b${semAcento(nome)}\\b`).test(t));
  if (idx >= 0) {
    const ano = (t.match(/\b(20\d{2})\b/) || [])[1] || anoFoco;
    return `${ano}-${String(idx + 1).padStart(2, '0')}`;
  }
  return mesFoco;
}

const AJUDA = `Posso ajudar com os dados do Xylo. Experimente perguntar:
- **Conferir janeiro** (procura erros nos lançamentos)
- **Resumo do mês** (faturamento, despesas e resultado)
- **Quanto devo aos empreiteiros?**
- **Florestas do mês** · **Clientes do mês** · **Toneladas por classe**
- **Ticket 96403** ou **placa QJL9F85**
- **Tabela de preços de compra**
- **O que falta receber e pagar?**
- **Comparar os últimos 6 meses**`;

async function responderBasico(empresaId, texto, mesFoco) {
  const t = semAcento(texto);
  const mes = mesDaPergunta(texto, mesFoco);
  const usar = (nome, entrada) => executarFerramenta(empresaId, nome, entrada);

  // Ticket ou placa citados
  const ticket = t.match(/ticket\s*(?:n[ºo.]?\s*)?(\d{3,})/);
  if (ticket) return formatarViagens(await usar('buscar_viagens', { ticket: ticket[1] }), `ticket ${ticket[1]}`);
  const placa = texto.toUpperCase().match(/\b([A-Z]{3})-?(\d[A-Z0-9]\d{2})\b/);
  if (placa) return formatarViagens(await usar('buscar_viagens', { placa: placa[1] + placa[2], mes: /\bmes\b|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/.test(t) ? mes : undefined }), `placa ${placa[1]}${placa[2]}`);

  if (/confer|verific|erro|problema|revis|inconsist|errad/.test(t)) {
    const r = await usar('conferir_mes', { mes });
    return { texto: textoConferencia(r), conferencia: r };
  }
  if (/pendent|a receber|a pagar|em aberto|devendo|atrasad/.test(t) && !/empreiteir|floresta/.test(t)) {
    return { texto: textoPendencias(await usar('pendencias', {})) };
  }
  if (/preco|tabela/.test(t)) {
    const tipo = /compra|floresta/.test(t) ? 'COMPRA' : /empreit/.test(t) ? 'EMPREITADA' : /venda|client|serrari/.test(t) ? 'VENDA' : undefined;
    return { texto: textoPrecos(await usar('tabela_de_precos', { tipo }), tipo) };
  }
  if (/compar|evolu|ultimos|tendenc|mes a mes/.test(t)) {
    const qtd = Number((t.match(/(\d{1,2})\s*mes/) || [])[1]) || 6;
    return { texto: textoEvolucao(await usar('evolucao', { ate: mes, meses: qtd })) };
  }
  const tipo = /empreit/.test(t) ? 'empreiteiro' : /floresta/.test(t) ? 'floresta' : /client|serrari/.test(t) ? 'cliente'
    : /classe|lixo|\bfina\b|media|grossa/.test(t) ? 'classe' : null;
  if (tipo) return { texto: textoRelatorio(await usar('relatorio', { tipo, mes })) };
  if (/resum|fechament|fatur|lucro|resultado|despes|gast|tonelad|quant|total|viage|frete/.test(t)) {
    return { texto: textoResumo(await usar('resumo_do_mes', { mes })) };
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda|help)\b/.test(t.trim())) return { texto: AJUDA };
  return { texto: `Não entendi a pergunta no modo básico.\n\n${AJUDA}` };
}

// ---- Textos ----------------------------------------------------------
function textoResumo(r) {
  if (!r.madeira.viagens && !r.fretes.quantidade && !r.despesas_total) return `Não há lançamentos em ${nomeMes(r.mes)}.`;
  const linhas = [
    `**Fechamento de ${nomeMes(r.mes)}**`,
    `- Madeira: ${r.madeira.viagens} viagens, ${ton(r.madeira.toneladas)}, ${brl(r.madeira.valor)}`,
    `- Fretes: ${r.fretes.quantidade}, ${brl(r.fretes.valor)}`,
    `- **Faturamento: ${brl(r.faturamento)}**`,
    `- **Despesas: ${brl(r.despesas_total)}**${r.despesas_por_categoria.length ? ` (${r.despesas_por_categoria.slice(0, 3).map((d) => `${d.categoria} ${brl(d.valor)}`).join(', ')})` : ''}`,
    `- **Resultado: ${brl(r.resultado)}**${r.faturamento ? ` (${((r.resultado / r.faturamento) * 100).toFixed(1).replace('.', ',')}% do faturamento)` : ''}`,
  ];
  if (r.a_pagar_pela_tabela_de_precos.florestas || r.a_pagar_pela_tabela_de_precos.empreiteiros) {
    linhas.push('', `Pela tabela de preços, as viagens geram ${brl(r.a_pagar_pela_tabela_de_precos.florestas)} a pagar às florestas e ${brl(r.a_pagar_pela_tabela_de_precos.empreiteiros)} aos empreiteiros.`);
  }
  return linhas.join('\n');
}

function textoConferencia(r) {
  if (!r.viagens_conferidas && !r.achados.length) return `Não há viagens lançadas em ${nomeMes(r.mes)} para conferir.`;
  if (!r.achados.length) return `Conferi as ${r.viagens_conferidas} viagens de ${nomeMes(r.mes)} e **não encontrei problemas**. ✔`;
  // a lista detalhada vai no cartão da conferência, logo abaixo do texto
  return `Conferi as ${r.viagens_conferidas} viagens de ${nomeMes(r.mes)}: **${r.resumo.erros} erro(s)**, **${r.resumo.atencao} ponto(s) de atenção** e ${r.resumo.info} lembrete(s). Abra cada item abaixo para ver as viagens.`;
}

function textoRelatorio(r) {
  const titulo = { cliente: 'Por cliente', floresta: 'Por floresta', empreiteiro: 'Por empreiteiro', classe: 'Por classe' }[r.tipo];
  if (!r.linhas.length) return `Não há dados de ${titulo.toLowerCase()} em ${nomeMes(r.mes)}.`;
  const linha = {
    cliente: (l) => `- **${l.nome}**: ${l.viagens} viagens, ${ton(l.toneladas)}, ${brl(l.valor_total)}`,
    classe: (l) => `- **${l.nome}**: ${ton(l.toneladas)} em ${l.viagens} viagens, ${brl(l.valor_total)}`,
    floresta: (l) => `- **${l.nome}**: ${ton(l.toneladas)}, a pagar ${brl(l.a_pagar)}, pago ${brl(l.pago_no_mes)}, **saldo ${brl(l.saldo)}**`,
    empreiteiro: (l) => `- **${l.nome}**: produziu ${brl(l.producao)} (${ton(l.toneladas)}), adiantado ${brl(l.adiantamentos_e_pagamentos)}, **líquido ${brl(l.liquido_a_pagar)}**`,
  }[r.tipo];
  const total = r.tipo === 'empreiteiro'
    ? `\n**Total líquido a pagar aos empreiteiros: ${brl(r.linhas.reduce((t, l) => t + l.liquido_a_pagar, 0))}**`
    : r.tipo === 'floresta' ? `\n**Saldo total com as florestas: ${brl(r.linhas.reduce((t, l) => t + l.saldo, 0))}**` : '';
  return [`**${titulo} — ${nomeMes(r.mes)}**`, ...r.linhas.map(linha)].join('\n') + total;
}

function formatarViagens(r, busca) {
  if (!r.total_encontrado) return { texto: `Não encontrei viagens com ${busca}.` };
  const linhas = r.viagens.slice(0, 10).map((v) =>
    `- Nº ${v.numero_viagem} em ${v.data.split('-').reverse().join('/')}: ${v.cliente}, ${v.floresta}${v.empreiteiro ? `/${v.empreiteiro}` : ''}, ${v.classe}, ${ton(v.peso_liquido)} × ${brl(v.valor_tonelada)} = **${brl(v.valor_total)}**${v.ticket ? ` (ticket ${v.ticket})` : ''}`);
  return {
    texto: [`Encontrei **${r.total_encontrado} viagem(ns)** com ${busca} (${ton(r.toneladas_total)}, ${brl(r.valor_total)}):`, ...linhas,
      r.total_encontrado > 10 ? `… e mais ${r.total_encontrado - 10}.` : ''].filter(Boolean).join('\n'),
  };
}

function textoPrecos(r, tipo) {
  if (!r.precos.length) return 'Não há preços válidos hoje para essa busca.';
  const nomes = { VENDA: 'Venda (cliente paga)', COMPRA: 'Compra (pago à floresta)', EMPREITADA: 'Empreitada (pago ao empreiteiro)' };
  const grupos = {};
  r.precos.forEach((p) => { (grupos[p.tipo] = grupos[p.tipo] || []).push(p); });
  return Object.entries(grupos).map(([tp, lista]) =>
    [`**${nomes[tp]}**`, ...lista.map((p) => `- ${p.para || 'todos'} · ${p.classe}: ${brl(p.valor_tonelada)}/t`)].join('\n'))
    .join('\n\n') + (tipo ? '' : '\n\nDica: peça "preços de compra" ou "preços de empreitada" para filtrar.');
}

function textoPendencias(r) {
  const fr = r.fretes_a_receber;
  const de = r.despesas_a_pagar;
  return [
    `**A receber (fretes): ${brl(fr.total)}** em ${fr.quantidade} frete(s)`,
    ...fr.maiores.slice(0, 5).map((f) => `- Carga ${f.numero_carga} (${f.data.split('-').reverse().join('/')}, ${f.cliente}): ${brl(f.valor_total)}`),
    '',
    `**A pagar (despesas): ${brl(de.total)}** em ${de.quantidade} despesa(s)`,
    ...de.maiores.slice(0, 5).map((d) => `- ${d.descricao} (${d.data.split('-').reverse().join('/')}): ${brl(d.valor)}`),
  ].join('\n');
}

function textoEvolucao(r) {
  return ['**Mês a mês**', ...r.meses.map((m) =>
    `- ${nomeMes(m.mes)}: ${ton(m.toneladas)}, faturamento ${brl(m.faturamento)}, despesas ${brl(m.despesas)}, **resultado ${brl(m.resultado)}**`)].join('\n');
}

module.exports = { responderBasico, mesDaPergunta, AJUDA };
