// =====================================================================
// MODO BÁSICO do assistente (sem IA externa)
//
// Usado quando não há chave da API configurada (ou a IA está fora do ar).
// Entende perguntas por palavras-chave e responde com as MESMAS ferramentas
// que a IA usa - então os números são sempre os do banco.
// =====================================================================
const { query } = require('../config/db');
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
- **Preços de compra** (praticados nas viagens)
- **O que falta receber e pagar?**
- **Comparar os últimos 6 meses**
- **Folha do mês** · **Comissão do POPO** · **Adiantamentos**
- **Funcionários** · **Despesas do mês** · **DRE do mês**
- **Fretes do BUTI**`;

async function responderBasico(empresaId, texto, mesFoco, perfil = 'Visualização') {
  const t = semAcento(texto);
  const mes = mesDaPergunta(texto, mesFoco);
  const usar = (nome, entrada) => executarFerramenta(empresaId, nome, entrada, perfil);

  // Ticket ou placa citados
  const ticket = t.match(/ticket\s*(?:n[ºo.]?\s*)?(\d{3,})/);
  if (ticket) return formatarViagens(await usar('buscar_viagens', { ticket: ticket[1] }), `ticket ${ticket[1]}`);
  const placa = texto.toUpperCase().match(/\b([A-Z]{3})-?(\d[A-Z0-9]\d{2})\b/);
  if (placa) return formatarViagens(await usar('buscar_viagens', { placa: placa[1] + placa[2], mes: /\bmes\b|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/.test(t) ? mes : undefined }), `placa ${placa[1]}${placa[2]}`);

  // Pessoal (Administrador e Financeiro)
  const pessoal = perfil === 'Administrador' || perfil === 'Financeiro';
  const semAcesso = { texto: 'Informações de pessoal (salários, folha e adiantamentos) são só para os perfis Administrador e Financeiro.' };
  if (/comiss/.test(t)) {
    if (!pessoal) return semAcesso;
    const quem = texto.replace(/comiss[aã]o|do|da|de|motorista|em|no|mes|m[eê]s|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\d{4}|[?!.,]/gi, ' ').trim();
    if (quem.length >= 3) return { texto: textoComissao(await usar('comissao_motorista', { motorista: quem, mes })) };
    return { texto: textoFolha(await usar('folha_do_mes', { mes })) };
  }
  if (/folha|salario|pagamento dos funcionarios/.test(t)) return pessoal ? { texto: textoFolha(await usar('folha_do_mes', { mes })) } : semAcesso;
  if (/adiantament|\bvales?\b/.test(t)) return pessoal ? { texto: textoAdiantamentos(await usar('adiantamentos', { so_em_aberto: true })) } : semAcesso;
  if (/funcionari|motorista|placa dos/.test(t)) {
    if (pessoal) return { texto: textoFuncionarios(await usar('funcionarios', {})) };
    return { texto: textoMotoristas(await usar('cadastros', { tipo: 'motoristas' })) };
  }
  if (/\bdre\b|lucro liquido|margem|demonstra/.test(t)) return { texto: textoDRE(await usar('dre', { de: mes })) };
  if (/despesas? (de|do|da|com)|gastos? (de|do|da|com)|categoria/.test(t) && !/resumo/.test(t)) {
    return { texto: textoDespesas(await usar('buscar_despesas', { mes }), mes) };
  }

  if (/confer|verific|erro|problema|revis|inconsist|errad/.test(t)) {
    const r = await usar('conferir_mes', { mes });
    return { texto: textoConferencia(r), conferencia: r };
  }
  if (/pendent|a receber|a pagar|em aberto|devendo|atrasad/.test(t) && !/empreiteir|floresta/.test(t)) {
    return { texto: textoPendencias(await usar('pendencias', {})) };
  }
  if (/preco|tabela/.test(t)) {
    const tipo = /compra|floresta/.test(t) ? 'COMPRA' : /empreit/.test(t) ? 'EMPREITADA' : /venda|client|serrari/.test(t) ? 'VENDA' : undefined;
    return { texto: textoPrecos(await usar('precos_praticados', { tipo }), tipo) };
  }
  if (/compar|evolu|ultimos|tendenc|mes a mes/.test(t)) {
    const qtd = Number((t.match(/(\d{1,2})\s*mes/) || [])[1]) || 6;
    return { texto: textoEvolucao(await usar('evolucao', { ate: mes, meses: qtd })) };
  }
  // Fretes (e de um cliente citado pelo nome)
  if (/frete/.test(t)) {
    const cliente = await clienteCitado(empresaId, t);
    return { texto: formatarFretes(await usar('buscar_fretes', { mes, cliente: cliente || undefined }), mes, cliente) };
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
  if (r.a_pagar_florestas_empreiteiros.florestas || r.a_pagar_florestas_empreiteiros.empreiteiros) {
    linhas.push('', `Pelos valores das viagens, há ${brl(r.a_pagar_florestas_empreiteiros.florestas)} a pagar às florestas e ${brl(r.a_pagar_florestas_empreiteiros.empreiteiros)} aos empreiteiros.`);
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
    cliente: (l) => `- **${l.nome}**: ${[l.viagens && `${l.viagens} viagens (${ton(l.toneladas_madeira)}, ${brl(l.valor_madeira)})`, l.fretes && `${l.fretes} frete${l.fretes === 1 ? '' : 's'} (${ton(l.toneladas_fretes)}, ${brl(l.valor_fretes)})`].filter(Boolean).join(' + ')}, **${brl(l.valor_total)}**`,
    classe: (l) => `- **${l.nome}**: ${ton(l.toneladas)} em ${l.viagens} viagens, ${brl(l.valor_total)}`,
    floresta: (l) => `- **${l.nome}**: ${ton(l.toneladas)}, a pagar ${brl(l.a_pagar)}, pago ${brl(l.pago_no_mes)}, **saldo ${brl(l.saldo)}**`,
    empreiteiro: (l) => `- **${l.nome}**: produziu ${brl(l.producao)} (${ton(l.toneladas)}), adiantado ${brl(l.adiantamentos_e_pagamentos)}, **líquido ${brl(l.liquido_a_pagar)}**`,
  }[r.tipo];
  const total = r.tipo === 'empreiteiro'
    ? `\n**Total líquido a pagar aos empreiteiros: ${brl(r.linhas.reduce((t, l) => t + l.liquido_a_pagar, 0))}**`
    : r.tipo === 'floresta' ? `\n**Saldo total com as florestas: ${brl(r.linhas.reduce((t, l) => t + l.saldo, 0))}**` : '';
  return [`**${titulo} — ${nomeMes(r.mes)}**`, ...r.linhas.map(linha)].join('\n') + total;
}

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function textoFolha(r) {
  if (!r.linhas) return `${r.aviso}`;
  const t = r.totais;
  return [`**Folha de ${nomeMes(r.mes)}** (${r.situacao}, ${r.funcionarios} funcionários): **saldo a pagar ${brl(t.saldo_a_pagar)}**`,
    `- Salários ${brl(t.salario_base)} · comissões ${brl(t.comissao)} · alimentação ${brl(t.alimentacao)} · extras ${brl(t.extras)}`,
    `- Adiantamentos descontados ${brl(t.adiantamento)}${t.desconto ? ` · descontos ${brl(t.desconto)}` : ''}`,
    ...r.linhas.map((l) => `- ${l.nome}: ${brl(l.saldo_a_pagar)}${l.comissao ? ` (comissão ${brl(l.comissao)})` : ''}${l.pendencias ? ' · comissão incompleta' : ''}`)].join('\n');
}
function textoComissao(r) {
  if (!r.encontrado && r.aviso) return r.aviso;
  const pend = [r.cargas_sem_km && `${r.cargas_sem_km} carga(s) sem km`, r.sem_faixa && 'sem faixa para alguma distância'].filter(Boolean);
  return [`**Comissão de ${r.funcionario}${r.nome_nas_cargas && r.nome_nas_cargas !== r.funcionario ? ` (${r.nome_nas_cargas})` : ''} em ${nomeMes(r.mes)}: ${brl(r.comissao_total)}**`,
    `- ${r.cargas} cargas, ${ton(r.toneladas)}${r.placa ? ` · placa ${r.placa}` : ''}`,
    r.faixas.length ? `- Faixas: ${r.faixas.join(' · ')}` : '- Sem faixas de comissão cadastradas (Pessoal › Funcionários)',
    pend.length ? `- Atenção: ${pend.join(', ')}. Cadastre o km em Rotas e distâncias.` : ''].filter(Boolean).join('\n');
}
function textoAdiantamentos(r) {
  if (!r.quantidade) return 'Não há adiantamentos com valor a descontar.';
  return [`**Adiantamentos a descontar: ${brl(r.falta_descontar)}** (${r.quantidade})`,
    ...r.adiantamentos.slice(0, 12).map((a) => `- ${a.nome}: ${brl(a.valor)} em ${dataBR(a.data)}, falta ${brl(a.falta_descontar)} (${a.parcelas}x)`)].join('\n');
}
function textoFuncionarios(r) {
  if (!r.quantidade) return 'Nenhum funcionário cadastrado (Pessoal › Funcionários).';
  return [`**${r.quantidade} funcionários ativos** (${r.motoristas} motoristas) · base mensal ${brl(r.folha_base_mensal)}`,
    ...r.funcionarios.map((f) => `- ${f.nome} (${f.cargo})${f.motorista ? ` · cargas: ${f.nome_nas_cargas}${f.placa_atual ? `, placa ${f.placa_atual}` : ', **sem placa**'}` : ''}`)].join('\n');
}
function textoMotoristas(r) {
  if (!r.quantidade) return 'Nenhum motorista cadastrado.';
  return [`**${r.quantidade} motoristas**`, ...r.itens.map((m) => `- ${m.nome_nas_cargas} (${m.funcionario})${m.placa_atual ? ` · ${m.placa_atual}` : ''}`)].join('\n');
}
function textoDRE(r) {
  const linhas = r.linhas.filter((l) => l.tipo !== 'item');
  return [`**DRE — ${r.periodo}**`, ...linhas.map((l) => `- ${l.linha}: **${brl(l.valor)}**${l.percentual_da_receita_liquida !== null ? ` (${String(l.percentual_da_receita_liquida).replace('.', ',')}%)` : ''}`),
    ...(r.avisos || []).map((a) => `- _${a}_`), 'Veja completa em Relatórios › DRE.'].join('\n');
}
function textoDespesas(r, mes) {
  if (!r.total_encontrado) return `Não há despesas lançadas em ${nomeMes(mes)}.`;
  return [`**Despesas de ${nomeMes(mes)}: ${brl(r.valor_total)}**${r.pendente ? ` (pendente ${brl(r.pendente)})` : ''}`,
    ...r.por_categoria.map((c) => `- ${c.categoria}: ${brl(c.valor)}`)].join('\n');
}

// Nome de cliente que aparece na pergunta ("fretes do KNIES")
async function clienteCitado(empresaId, texto) {
  const t = texto.replace(/[^a-z0-9]+/g, ' ');
  const { rows } = await query('SELECT nome FROM clientes WHERE empresa_id = $1 AND ativo', [empresaId]);
  const achado = rows.map((r) => r.nome).sort((a, b) => b.length - a.length)
    .find((nome) => { const n = semAcento(nome).replace(/[^a-z0-9]+/g, ' ').trim(); return n.length >= 3 && ` ${t} `.includes(` ${n} `); });
  return achado || null;
}

function formatarFretes(r, mes, cliente) {
  const de = `${cliente ? `de ${cliente} ` : ''}em ${nomeMes(mes)}`;
  if (!r.total_encontrado) return `Não há fretes lançados ${de}.`;
  const linhas = r.fretes.slice(0, 10).map((f) => `- Nº ${f.numero_carga} (${f.data.split('-').reverse().join('/')}): ${f.cliente}${f.destino ? ` → ${f.destino}` : ''}, ${ton(f.toneladas)}, ${brl(f.valor_total)} · ${f.situacao}`);
  return [`**${r.total_encontrado} frete${r.total_encontrado === 1 ? '' : 's'} ${de}: ${ton(r.toneladas_total)}, ${brl(r.valor_total)}**`,
    ...linhas, r.total_encontrado > 10 ? `- … e mais ${r.total_encontrado - 10}` : '', r.a_receber ? `A receber: **${brl(r.a_receber)}**` : ''].filter(Boolean).join('\n');
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
  if (!r.precos.length) return 'Não encontrei viagens com esses preços nos últimos 90 dias.';
  const nomes = { VENDA: 'Venda (cliente paga)', COMPRA: 'Compra (pago à floresta)', EMPREITADA: 'Empreitada (pago ao empreiteiro)' };
  const grupos = {};
  r.precos.forEach((p) => { (grupos[p.tipo] = grupos[p.tipo] || []).push(p); });
  return `Preços praticados nas viagens (${r.periodo}):\n\n` + Object.entries(grupos).map(([tp, lista]) =>
    [`**${nomes[tp]}**`, ...lista.map((p) => `- ${p.para} · ${p.classe}: último ${brl(p.ultimo)}/t (média ${brl(p.media)}${p.menor !== p.maior ? `, de ${brl(p.menor)} a ${brl(p.maior)}` : ''}; ${p.viagens} viagem(ns))`)].join('\n'))
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
