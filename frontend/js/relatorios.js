// =====================================================================
// Xylo - RELATÓRIOS (main.html#relatorios)
//
// Abas: Fechamento do mês | Por cliente | Por floresta | Por empreiteiro |
//       Por classe | Anual
// Cada relatório pode ser impresso (ou salvo em PDF pela impressão) e
// exportado em CSV (abre no Excel). Clicar no nome de um cliente, floresta
// ou empreiteiro (na tabela ou no gráfico) mostra as viagens dele no mês.
// Cada aba tem um gráfico interativo (dica ao passar o mouse, troca de medida).
//
// Depende do comum.js, api.js, graficos.js e de main.js (conteudo, cliqueDaTela, empresa).
// =====================================================================

const RELATORIOS = {
  fechamento:   { aba: 'Fechamento do mês', titulo: 'Fechamento do mês' },
  clientes:     { aba: 'Por cliente',       titulo: 'Relatório por cliente' },
  florestas:    { aba: 'Por floresta',      titulo: 'Relatório por floresta' },
  empreiteiros: { aba: 'Por empreiteiro',   titulo: 'Relatório por empreiteiro' },
  classes:      { aba: 'Por classe',        titulo: 'Totalização mensal por classe' },
  anual:        { aba: 'Anual',             titulo: 'Resumo anual' },
};
const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

let abaRelatorio = 'fechamento';
let mesRelatorio = mesAtualISO();
let anoRelatorio = mesAtualISO().slice(0, 4);

const nomeDoMes = (mes) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;
const numero = (v) => Number(v || 0);
const pct = (parte, todo) => (numero(todo) ? `${((numero(parte) / numero(todo)) * 100).toFixed(1).replace('.', ',')}%` : '–');

async function telaRelatorios() {
  conteudo.innerHTML = `
    <div class="abas so-tela" role="tablist">
      ${Object.entries(RELATORIOS).map(([id, r]) =>
        `<button type="button" class="aba ${id === abaRelatorio ? 'ativa' : ''}" data-aba="${id}" role="tab">${r.aba}</button>`).join('')}
    </div>
    <div class="barra-ferramentas so-tela">
      <label class="filtro-campo" id="campo-mes-rel">Mês <input type="month" id="mes-relatorio" value="${mesRelatorio}"></label>
      <label class="filtro-campo" id="campo-ano-rel">Ano <input type="number" id="ano-relatorio" min="2000" max="2100" value="${anoRelatorio}"></label>
      <span class="espaco"></span>
      <button type="button" class="btn btn-primario" id="btn-excel" title="Planilha formatada com logo, totais e as viagens do mês"><i class="fas fa-file-excel"></i> Exportar Excel</button>
      <button type="button" class="btn btn-secundario" id="btn-csv" title="Arquivo simples, só com os números"><i class="fas fa-file-csv"></i> CSV</button>
      <button type="button" class="btn btn-secundario" id="btn-imprimir"><i class="fas fa-print"></i> Imprimir / PDF</button>
    </div>
    <div class="cabecalho-impressao" id="cabecalho-impressao"></div>
    <div id="relatorio" class="carregando">Carregando…</div>`;

  // Dados do relatório aberto, para exportar em CSV: { nome, cabecalho: [], linhas: [[]] }
  let exportavel = null;
  let pedido = 0; // ignora respostas atrasadas quando o usuário troca de aba depressa

  async function carregar() {
    mesRelatorio = $('#mes-relatorio').value || mesAtualISO();
    anoRelatorio = $('#ano-relatorio').value || mesAtualISO().slice(0, 4);
    const anual = abaRelatorio === 'anual';
    $('#campo-mes-rel').hidden = anual;
    $('#campo-ano-rel').hidden = !anual;

    const periodo = anual ? `ano de ${anoRelatorio}` : nomeDoMes(mesRelatorio);
    $('#cabecalho-impressao').innerHTML = cabecalhoEmpresaHTML(
      `${RELATORIOS[abaRelatorio].titulo} — ${periodo}`,
      `Emitido em ${new Date().toLocaleString('pt-BR')} por ${usuario.nome || ''} · Xylo`);

    const box = $('#relatorio');
    box.className = 'carregando';
    box.textContent = 'Carregando…';
    const meu = ++pedido;
    try {
      const url = anual ? `/relatorios/anual?ano=${anoRelatorio}` : `/relatorios/${abaRelatorio}?mes=${mesRelatorio}`;
      const dados = await api(url);
      if (meu !== pedido || !$('#relatorio')) return; // já trocou de aba ou de tela
      box.className = '';
      ({
        fechamento: desenharFechamento, clientes: desenharClientes, florestas: desenharFlorestas,
        empreiteiros: desenharEmpreiteiros, classes: desenharClasses, anual: desenharAnual,
      })[abaRelatorio](dados, box);
    } catch (erro) {
      if (meu !== pedido || !$('#relatorio')) return;
      box.className = 'aviso-erro';
      box.textContent = mensagemErro(erro);
      exportavel = null;
    }
  }

  const vazio = (box, texto) => {
    box.innerHTML = `<div class="card vazio">${texto}</div>`;
    exportavel = null;
  };

  // Monta uma tabela com linha de total. colunas: [{ titulo, campo|valor(l), num, formato, total }]
  function tabela(colunas, linhas, totais) {
    const celula = (c, l) => {
      const v = c.valor ? c.valor(l) : l[c.campo];
      return c.html ? c.html(l) : (c.formato ? c.formato(v) : esc(v));
    };
    return `
      <div class="card sem-padding"><div class="tabela-wrap">
        <table class="tabela tabela-relatorio">
          <thead><tr>${colunas.map((c) => `<th class="${c.num ? 'num' : ''}">${c.titulo}</th>`).join('')}</tr></thead>
          <tbody>${linhas.map((l) => `<tr>${colunas.map((c) => `<td class="${c.num ? 'num' : ''}">${celula(c, l)}</td>`).join('')}</tr>`).join('')}</tbody>
          ${totais ? `<tfoot><tr>${colunas.map((c, i) => `<td class="${c.num ? 'num' : ''}">${i === 0 ? 'Total' : (c.total !== undefined ? c.total : '')}</td>`).join('')}</tr></tfoot>` : ''}
        </table>
      </div></div>`;
  }

  // Guarda os mesmos dados da tela para o CSV (números sem formatação de moeda)
  function guardarCsv(nome, colunas, linhas) {
    exportavel = {
      nome,
      cabecalho: colunas.map((c) => c.titulo),
      linhas: linhas.map((l) => colunas.map((c) => (c.csv ? c.csv(l) : (c.valor ? c.valor(l) : l[c.campo])))),
    };
  }

  const somar = (linhas, campo) => linhas.reduce((t, l) => t + numero(l[campo]), 0);
  const peso = (v) => formatarPeso(v);
  const botaoDetalhe = (tipo, l) => `<button type="button" class="link-botao" data-detalhe="${tipo}" data-id="${l.id}" data-nome="${esc(l.nome)}">${esc(l.nome)}</button>`;

  // ---- Cartão de gráfico de barras com botões para escolher a medida ----
  // medidas: [{ id, rotulo, campo, formato, dica?(linha) }]. A escolha fica guardada por aba.
  const medidaRel = {};
  function graficoComMedidas(box, titulo, medidas, linhas, tipoDetalhe) {
    const chave = abaRelatorio;
    if (!medidas.some((m) => m.id === medidaRel[chave])) medidaRel[chave] = medidas[0].id;
    const card = document.createElement('section');
    card.className = 'card cartao-grafico';
    card.innerHTML = `
      <header class="cabecalho-grafico">
        <div><h3>${titulo}</h3><p class="sub">${tipoDetalhe ? 'passe o mouse para detalhes · clique numa barra para ver as viagens' : 'passe o mouse para detalhes'}</p></div>
        <div class="segmentos so-tela" role="group" aria-label="Medida do gráfico">
          ${medidas.map((m) => `<button type="button" data-medida="${m.id}">${m.rotulo}</button>`).join('')}
        </div>
      </header>
      <div class="area-barras"></div>`;
    box.prepend(card);
    const desenhar = () => {
      const m = medidas.find((x) => x.id === medidaRel[chave]);
      card.querySelectorAll('[data-medida]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.medida === m.id));
      const ordenadas = [...linhas].sort((a, b) => numero(b[m.campo]) - numero(a[m.campo]));
      Graficos.barras(card.querySelector('.area-barras'), {
        itens: ordenadas.map((l) => ({ rotulo: l.nome, valor: l[m.campo], linha: l })),
        formato: m.formato, cor: Graficos.CORES.verde, corNegativa: Graficos.CORES.perda, max: 10,
        extraDica: m.dica ? (item) => m.dica(item.linha) : undefined,
        aoClicar: tipoDetalhe ? (item) => abrirDetalhe(tipoDetalhe, item.linha.id, item.linha.nome) : undefined,
        dicaClique: 'Clique para ver as viagens',
      });
    };
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-medida]');
      if (!b) return;
      medidaRel[chave] = b.dataset.medida;
      desenhar();
    });
    desenhar();
  }
  const emToneladas = (v) => `${formatarPeso(v)} t`;
  const dicaViagens = (l) => [{ valor: String(l.qtd_viagens), rotulo: 'viagens' }, { valor: emToneladas(l.toneladas), rotulo: '' }];

  // ---- Fechamento do mês (como a aba FECHAMENTO da planilha) ----------
  function desenharFechamento(d, box) {
    if (!d.madeira.viagens && !d.fretes.qtd && !numero(d.despesas.valor)) {
      return vazio(box, `Nenhum lançamento em ${nomeDoMes(d.mes)}.`);
    }
    const linha = (rotulo, valor, extra = '') => `<tr><td>${rotulo}</td><td class="num">${extra}</td><td class="num">${formatarMoeda(valor)}</td></tr>`;
    const cartao = (icone, valor, texto) => `
      <div class="card cartao"><div class="cartao-icone"><i class="fas ${icone}"></i></div>
        <div><strong>${valor}</strong><span>${texto}</span></div></div>`;

    box.innerHTML = `
      <div class="cartoes cartoes-mini">
        ${cartao('fa-weight-hanging', `${peso(d.toneladas_total)} t`, 'toneladas (com fretes)')}
        ${cartao('fa-arrow-trend-up', formatarMoeda(d.faturamento), 'faturamento')}
        ${cartao('fa-arrow-trend-down', formatarMoeda(d.despesas.valor), 'despesas')}
        ${cartao('fa-scale-balanced', formatarMoeda(d.resultado), `resultado (${pct(d.resultado, d.faturamento)})`)}
      </div>
      <section class="card cartao-grafico">
        <header class="cabecalho-grafico">
          <div><h3>Do faturamento ao resultado</h3>
            <p class="sub">entradas em verde, despesas em violeta, totais em cinza · passe o mouse para ver os valores</p></div>
        </header>
        <div id="graf-cascata" class="area-grafico"></div>
      </section>
      <div class="grade-fechamento">
        <div class="card sem-padding">
          <h3 class="titulo-bloco">Faturamento (+)</h3>
          <table class="tabela tabela-relatorio">
            <thead><tr><th>Origem</th><th class="num">Toneladas</th><th class="num">Valor</th></tr></thead>
            <tbody>
              ${d.madeira.por_cliente.map((c) => linha(`Madeira · ${esc(c.cliente)} <span class="sub">(${c.qtd_viagens} viagens)</span>`, c.valor_total, peso(c.toneladas))).join('')}
              ${d.fretes.qtd ? linha(`Fretes <span class="sub">(${d.fretes.qtd})</span>`, d.fretes.valor, peso(d.fretes.toneladas)) : ''}
            </tbody>
            <tfoot><tr><td>Total</td><td class="num">${peso(d.toneladas_total)}</td><td class="num">${formatarMoeda(d.faturamento)}</td></tr></tfoot>
          </table>
        </div>
        <div class="card sem-padding">
          <h3 class="titulo-bloco">Despesas (−)</h3>
          <table class="tabela tabela-relatorio">
            <thead><tr><th>Categoria</th><th class="num">% do fat.</th><th class="num">Valor</th></tr></thead>
            <tbody>
              ${d.despesas.por_categoria.map((c) => linha(`${esc(c.categoria)} <span class="sub">(${c.qtd})</span>`, c.valor, pct(c.valor, d.faturamento))).join('')
                || '<tr><td colspan="3" class="sub">Nenhuma despesa lançada.</td></tr>'}
            </tbody>
            <tfoot><tr><td>Total</td><td class="num">${pct(d.despesas.valor, d.faturamento)}</td><td class="num">${formatarMoeda(d.despesas.valor)}</td></tr></tfoot>
          </table>
        </div>
      </div>
      <div class="card resumo-fechamento">
        <div><span>Faturamento</span><strong>${formatarMoeda(d.faturamento)}</strong></div>
        <div><span>− Despesas</span><strong>${formatarMoeda(d.despesas.valor)}</strong></div>
        <div class="resultado ${d.resultado < 0 ? 'negativo' : ''}"><span>= Resultado</span><strong>${formatarMoeda(d.resultado)}</strong>
          <small>${pct(d.resultado, d.faturamento)} do faturamento</small></div>
      </div>
      <p class="nota"><i class="fas fa-circle-info"></i>
        Pela tabela de preços, as viagens do mês geram <strong>${formatarMoeda(d.custos_previstos.florestas)}</strong> a pagar às florestas
        e <strong>${formatarMoeda(d.custos_previstos.empreiteiros)}</strong> aos empreiteiros. Esses valores entram no resultado
        quando forem pagos e lançados em <a href="#despesas">Despesas</a> — veja o saldo de cada um nas abas Por floresta e Por empreiteiro.</p>`;

    const passos = [
      ...d.madeira.por_cliente.map((c) => ({ rotulo: `Madeira · ${c.cliente}`, valor: c.valor_total, tipo: 'mais', extra: `${peso(c.toneladas)} t` })),
      ...(d.fretes.qtd ? [{ rotulo: 'Fretes', valor: d.fretes.valor, tipo: 'mais', extra: `${d.fretes.qtd} fretes` }] : []),
      { rotulo: 'Faturamento', valor: d.faturamento, tipo: 'total' },
      ...d.despesas.por_categoria.map((c) => ({ rotulo: c.categoria, valor: c.valor, tipo: 'menos', extra: `${pct(c.valor, d.faturamento)} do faturamento` })),
      { rotulo: 'Resultado', valor: d.resultado, tipo: 'total', extra: `${pct(d.resultado, d.faturamento)} do faturamento` },
    ];
    Graficos.cascata($('#graf-cascata'), {
      passos, formato: formatarMoeda,
      descricao: `Faturamento de ${formatarMoeda(d.faturamento)}, despesas de ${formatarMoeda(d.despesas.valor)}, resultado de ${formatarMoeda(d.resultado)}.`,
    });

    exportavel = {
      nome: `fechamento-${d.mes}`,
      cabecalho: ['Grupo', 'Item', 'Toneladas', 'Valor'],
      linhas: [
        ...d.madeira.por_cliente.map((c) => ['Faturamento', `Madeira - ${c.cliente}`, c.toneladas, c.valor_total]),
        ...(d.fretes.qtd ? [['Faturamento', 'Fretes', d.fretes.toneladas, d.fretes.valor]] : []),
        ['Faturamento', 'TOTAL', d.toneladas_total, d.faturamento],
        ...d.despesas.por_categoria.map((c) => ['Despesas', c.categoria, '', c.valor]),
        ['Despesas', 'TOTAL', '', d.despesas.valor],
        ['Resultado', 'Faturamento - Despesas', '', d.resultado],
        ['Previsão', 'A pagar às florestas (tabela de preços)', '', d.custos_previstos.florestas],
        ['Previsão', 'A pagar aos empreiteiros (tabela de preços)', '', d.custos_previstos.empreiteiros],
      ],
    };
  }

  // ---- Por cliente ---------------------------------------------------
  function desenharClientes(linhas, box) {
    if (!linhas.length) return vazio(box, `Nenhuma viagem em ${nomeDoMes(mesRelatorio)}.`);
    const tTon = somar(linhas, 'toneladas');
    const tVal = somar(linhas, 'valor_total');
    const colunas = [
      { titulo: 'Cliente', campo: 'nome', html: (l) => botaoDetalhe('cliente', l) },
      { titulo: 'Viagens', campo: 'qtd_viagens', num: true, total: somar(linhas, 'qtd_viagens') },
      { titulo: 'Toneladas', campo: 'toneladas', num: true, formato: peso, total: peso(tTon) },
      { titulo: 'Preço médio/t', campo: 'preco_medio', num: true, formato: formatarMoeda, total: formatarMoeda(tVal / tTon) },
      { titulo: 'Valor total', campo: 'valor_total', num: true, formato: formatarMoeda, total: formatarMoeda(tVal) },
      { titulo: '% do total', valor: (l) => pct(l.valor_total, tVal), num: true, csv: (l) => (numero(l.valor_total) / tVal * 100).toFixed(2), total: '100%' },
    ];
    box.innerHTML = tabela(colunas, linhas, true);
    graficoComMedidas(box, 'Clientes do mês', [
      { id: 'valor', rotulo: 'Valor', campo: 'valor_total', formato: formatarMoeda, dica: (l) => [...dicaViagens(l), { valor: pct(l.valor_total, tVal), rotulo: 'do total' }] },
      { id: 'ton', rotulo: 'Toneladas', campo: 'toneladas', formato: emToneladas, dica: (l) => [{ valor: formatarMoeda(l.valor_total), rotulo: 'vendido' }, { valor: formatarMoeda(l.preco_medio), rotulo: 'preço médio/t' }] },
    ], linhas, 'cliente');
    guardarCsv(`clientes-${mesRelatorio}`, colunas, linhas);
  }

  // ---- Por floresta --------------------------------------------------
  function desenharFlorestas(linhas, box) {
    if (!linhas.length) return vazio(box, `Nenhuma viagem ou pagamento de floresta em ${nomeDoMes(mesRelatorio)}.`);
    const colunas = [
      { titulo: 'Floresta', campo: 'nome', html: (l) => botaoDetalhe('floresta', l) },
      { titulo: 'Viagens', campo: 'qtd_viagens', num: true, total: somar(linhas, 'qtd_viagens') },
      { titulo: 'Toneladas', campo: 'toneladas', num: true, formato: peso, total: peso(somar(linhas, 'toneladas')) },
      { titulo: 'Vendido', campo: 'valor_vendido', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'valor_vendido')) },
      { titulo: 'A pagar (compra)', campo: 'a_pagar', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'a_pagar')) },
      { titulo: 'Pago no mês', campo: 'pago', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'pago')) },
      { titulo: 'Saldo', campo: 'saldo', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'saldo')) },
    ];
    box.innerHTML = `${tabela(colunas, linhas, true)}
      <p class="nota"><i class="fas fa-circle-info"></i> <strong>A pagar</strong> vem da tabela de preços de compra;
        <strong>Pago no mês</strong> são as despesas ligadas à floresta. Saldo negativo = pagou mais do que a produção do mês (adiantamento).</p>`;
    graficoComMedidas(box, 'Florestas do mês', [
      { id: 'ton', rotulo: 'Toneladas', campo: 'toneladas', formato: emToneladas, dica: (l) => [{ valor: String(l.qtd_viagens), rotulo: 'viagens' }, { valor: formatarMoeda(l.valor_vendido), rotulo: 'vendido' }] },
      { id: 'pagar', rotulo: 'A pagar', campo: 'a_pagar', formato: formatarMoeda, dica: (l) => [{ valor: formatarMoeda(l.pago), rotulo: 'pago no mês' }, { valor: formatarMoeda(l.saldo), rotulo: 'saldo' }] },
      { id: 'saldo', rotulo: 'Saldo', campo: 'saldo', formato: formatarMoeda, dica: (l) => [{ valor: formatarMoeda(l.a_pagar), rotulo: 'a pagar' }, { valor: formatarMoeda(l.pago), rotulo: 'pago no mês' }] },
    ], linhas, 'floresta');
    guardarCsv(`florestas-${mesRelatorio}`, colunas, linhas);
  }

  // ---- Por empreiteiro -----------------------------------------------
  function desenharEmpreiteiros(linhas, box) {
    if (!linhas.length) return vazio(box, `Nenhuma viagem ou despesa de empreiteiro em ${nomeDoMes(mesRelatorio)}.`);
    const colunas = [
      { titulo: 'Empreiteiro', campo: 'nome', html: (l) => botaoDetalhe('empreiteiro', l) },
      { titulo: 'Viagens', campo: 'qtd_viagens', num: true, total: somar(linhas, 'qtd_viagens') },
      { titulo: 'Toneladas', campo: 'toneladas', num: true, formato: peso, total: peso(somar(linhas, 'toneladas')) },
      { titulo: 'Produção', campo: 'valor_bruto', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'valor_bruto')) },
      { titulo: 'Adiantamentos/despesas', campo: 'despesas', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'despesas')) },
      { titulo: 'Líquido a pagar', campo: 'liquido', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'liquido')) },
    ];
    box.innerHTML = `${tabela(colunas, linhas, true)}
      <p class="nota"><i class="fas fa-circle-info"></i> <strong>Produção</strong> = toneladas × preço de empreitada.
        Despesas lançadas com o empreiteiro (adiantamentos, pagamentos) são descontadas do líquido.</p>`;
    graficoComMedidas(box, 'Empreiteiros do mês', [
      { id: 'ton', rotulo: 'Toneladas', campo: 'toneladas', formato: emToneladas, dica: (l) => [{ valor: String(l.qtd_viagens), rotulo: 'viagens' }, { valor: formatarMoeda(l.valor_bruto), rotulo: 'produção' }] },
      { id: 'producao', rotulo: 'Produção', campo: 'valor_bruto', formato: formatarMoeda, dica: (l) => [{ valor: formatarMoeda(l.despesas), rotulo: 'adiantamentos/despesas' }, { valor: formatarMoeda(l.liquido), rotulo: 'líquido' }] },
      { id: 'liquido', rotulo: 'Líquido a pagar', campo: 'liquido', formato: formatarMoeda, dica: (l) => [{ valor: formatarMoeda(l.valor_bruto), rotulo: 'produção' }, { valor: formatarMoeda(l.despesas), rotulo: 'adiantamentos/despesas' }] },
    ], linhas, 'empreiteiro');
    guardarCsv(`empreiteiros-${mesRelatorio}`, colunas, linhas);
  }

  // ---- Por classe (totalização mensal) ------------------------------
  function desenharClasses(linhas, box) {
    if (!linhas.length) return vazio(box, `Nenhuma viagem em ${nomeDoMes(mesRelatorio)}.`);
    const tTon = somar(linhas, 'toneladas');
    const tVal = somar(linhas, 'valor_total');
    const colunas = [
      { titulo: 'Classe', campo: 'nome' },
      { titulo: 'Viagens', campo: 'qtd_viagens', num: true, total: somar(linhas, 'qtd_viagens') },
      { titulo: 'Toneladas', campo: 'toneladas', num: true, formato: peso, total: peso(tTon) },
      { titulo: '% das toneladas', valor: (l) => pct(l.toneladas, tTon), num: true, csv: (l) => (numero(l.toneladas) / tTon * 100).toFixed(2), total: '100%' },
      { titulo: 'Preço médio/t', campo: 'preco_medio', num: true, formato: formatarMoeda, total: formatarMoeda(tVal / tTon) },
      { titulo: 'Valor total', campo: 'valor_total', num: true, formato: formatarMoeda, total: formatarMoeda(tVal) },
    ];
    box.innerHTML = tabela(colunas, linhas, true);
    graficoComMedidas(box, 'Classes do mês', [
      { id: 'ton', rotulo: 'Toneladas', campo: 'toneladas', formato: emToneladas, dica: (l) => [{ valor: pct(l.toneladas, tTon), rotulo: 'das toneladas' }, { valor: String(l.qtd_viagens), rotulo: 'viagens' }] },
      { id: 'valor', rotulo: 'Valor', campo: 'valor_total', formato: formatarMoeda, dica: (l) => [{ valor: formatarMoeda(l.preco_medio), rotulo: 'preço médio/t' }, { valor: emToneladas(l.toneladas), rotulo: '' }] },
    ], linhas, null);
    guardarCsv(`classes-${mesRelatorio}`, colunas, linhas);
  }

  // ---- Anual: gráfico mês a mês (3 visões) + tabela -------------------
  let visaoAnual = 'resultado';
  function desenharAnual(linhas, box) {
    const colunas = [
      { titulo: 'Mês', valor: (l) => nomeDoMes(l.mes), csv: (l) => l.mes },
      { titulo: 'Viagens', campo: 'viagens', num: true, total: somar(linhas, 'viagens') },
      { titulo: 'Toneladas', campo: 'toneladas', num: true, formato: peso, total: peso(somar(linhas, 'toneladas')) },
      { titulo: 'Madeira', campo: 'madeira', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'madeira')) },
      { titulo: 'Fretes', campo: 'fretes', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'fretes')) },
      { titulo: 'Despesas', campo: 'despesas', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'despesas')) },
      { titulo: 'Resultado', campo: 'resultado', num: true, formato: formatarMoeda, total: formatarMoeda(somar(linhas, 'resultado')) },
    ];
    box.innerHTML = `
      <section class="card cartao-grafico">
        <header class="cabecalho-grafico">
          <div><h3>Mês a mês — ${anoRelatorio}</h3><p class="sub">passe o mouse para detalhes · clique num mês para abrir o fechamento</p></div>
          <div class="segmentos so-tela" role="group" aria-label="O que mostrar">
            <button type="button" data-visao-anual="resultado">Resultado</button>
            <button type="button" data-visao-anual="valores">Faturamento x despesas</button>
            <button type="button" data-visao-anual="toneladas">Toneladas</button>
          </div>
        </header>
        <div id="graf-anual" class="area-grafico"></div>
      </section>
      ${tabela(colunas, linhas, true)}`;

    const rotulos = linhas.map((l) => nomeDoMes(l.mes));
    const curtos = linhas.map((l) => NOMES_MES[Number(l.mes.slice(5)) - 1].slice(0, 3));
    const serie = (nome, campo, cor) => ({ nome, valores: linhas.map((l) => numero(l[campo])), cor });
    const moedaCurta = (v) => `R$ ${Graficos.compacto.format(v)}`;
    const abrirMes = (i) => {
      abaRelatorio = 'fechamento';
      $('#mes-relatorio').value = linhas[i].mes;
      document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === 'fechamento'));
      carregar();
    };
    const desenhar = () => {
      box.querySelectorAll('[data-visao-anual]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.visaoAnual === visaoAnual));
      const base = { rotulos, rotulosCurtos: curtos, aoClicar: abrirMes, tituloDica: (i) => rotulos[i] };
      if (visaoAnual === 'resultado') {
        Graficos.colunas($('#graf-anual'), {
          ...base, formato: formatarMoeda, formatoEixo: moedaCurta,
          series: [serie('Resultado', 'resultado', Graficos.CORES.verde)], corNegativa: Graficos.CORES.perda,
          extraDica: (i) => [{ valor: formatarMoeda(linhas[i].faturamento), rotulo: 'faturamento' }, { valor: formatarMoeda(linhas[i].despesas), rotulo: 'despesas' }],
          descricao: `Resultado de cada mês de ${anoRelatorio}; prejuízo aparece abaixo da linha do zero.`,
        });
      } else if (visaoAnual === 'valores') {
        Graficos.colunas($('#graf-anual'), {
          ...base, formato: formatarMoeda, formatoEixo: moedaCurta,
          series: [serie('Faturamento', 'faturamento', Graficos.CORES.verde), serie('Despesas', 'despesas', Graficos.CORES.violeta)],
          extraDica: (i) => [{ valor: formatarMoeda(linhas[i].resultado), rotulo: 'resultado' }],
          descricao: `Faturamento e despesas de cada mês de ${anoRelatorio}.`,
        });
      } else {
        Graficos.colunas($('#graf-anual'), {
          ...base, formato: emToneladas, formatoEixo: (v) => `${Graficos.compacto.format(v)} t`,
          series: [serie('Toneladas', 'toneladas', Graficos.CORES.verde)],
          extraDica: (i) => [{ valor: String(linhas[i].viagens), rotulo: 'viagens' }],
          descricao: `Toneladas de cada mês de ${anoRelatorio}.`,
        });
      }
    };
    box.querySelector('.segmentos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-visao-anual]');
      if (!b) return;
      visaoAnual = b.dataset.visaoAnual;
      desenhar();
    });
    desenhar();
    guardarCsv(`anual-${anoRelatorio}`, colunas, linhas);
  }

  // ---- Detalhe: viagens do cliente/floresta/empreiteiro no mês ------
  async function abrirDetalhe(tipo, id, nome) {
    abrirModal(`${nome} — ${nomeDoMes(mesRelatorio)}`, '<div class="carregando">Carregando…</div>');
    $('#modal').classList.add('modal-largo');
    try {
      const { viagens } = await api(`/viagens?mes=${mesRelatorio}&${tipo}_id=${id}`);
      // Cada relatório mostra o valor que interessa a ele
      const valor = {
        cliente: { titulo: 'Venda', ton: 'valor_tonelada', total: 'valor_total' },
        floresta: { titulo: 'Compra', ton: 'valor_ton_floresta', total: 'total_floresta' },
        empreiteiro: { titulo: 'Empreitada', ton: 'valor_ton_empreiteiro', total: 'total_empreiteiro' },
      }[tipo];
      const outro = tipo === 'cliente' ? (v) => v.floresta : (v) => v.cliente;
      $('#modal-corpo').innerHTML = viagens.length ? `
        <div class="tabela-wrap"><table class="tabela tabela-relatorio">
          <thead><tr><th>Data</th><th>Nº</th><th>Ticket</th><th>${tipo === 'cliente' ? 'Floresta' : 'Cliente'}</th><th>Classe</th>
            <th class="num">Peso</th><th class="num">${valor.titulo} R$/t</th><th class="num">Total</th></tr></thead>
          <tbody>${viagens.map((v) => `<tr>
            <td>${formatarDataISO(v.data)}</td><td>${esc(v.numero_viagem)}</td><td>${esc(v.ticket) || '—'}</td>
            <td>${esc(outro(v))}</td><td>${esc(v.classe)}</td><td class="num">${peso(v.peso_liquido)}</td>
            <td class="num">${v[valor.ton] === null ? '—' : formatarMoeda(v[valor.ton])}</td>
            <td class="num">${formatarMoeda(v[valor.total])}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="5">Total (${viagens.length} viagens)</td>
            <td class="num">${peso(somar(viagens, 'peso_liquido'))}</td><td></td>
            <td class="num">${formatarMoeda(somar(viagens, valor.total))}</td></tr></tfoot>
        </table></div>`
        : '<p class="vazio">Nenhuma viagem neste mês (só despesas/pagamentos).</p>';
    } catch (erro) {
      $('#modal-corpo').innerHTML = `<p class="aviso-erro">${esc(mensagemErro(erro))}</p>`;
    }
  }

  // ---- CSV (separador ";" e vírgula decimal: abre direto no Excel) ---
  function exportarCsv() {
    if (!exportavel) { toast('Não há dados para exportar neste período.', 'erro'); return; }
    const campo = (v) => {
      if (v === null || v === undefined) return '';
      const n = typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v; // 14223.4 -> 14223,40
      const s = /^-?\d+(\.\d+)?$/.test(String(n)) ? String(n).replace('.', ',') : String(n);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const texto = [exportavel.cabecalho, ...exportavel.linhas].map((l) => l.map(campo).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `xylo-${exportavel.nome}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Excel (.xlsx) gerado pelo servidor: logo, totais com fórmula e as viagens do mês
  async function exportarExcel(botao) {
    const periodo = abaRelatorio === 'anual' ? `ano=${anoRelatorio}` : `mes=${mesRelatorio}`;
    const texto = botao.innerHTML;
    botao.disabled = true;
    botao.textContent = 'Gerando…';
    try {
      const nome = await baixarArquivo(`/exportacao/relatorio?tipo=${abaRelatorio}&${periodo}`,
        `xylo-${abaRelatorio}-${abaRelatorio === 'anual' ? anoRelatorio : mesRelatorio}.xlsx`);
      toast(`Planilha ${nome} baixada.`);
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    } finally {
      botao.disabled = false;
      botao.innerHTML = texto;
    }
  }

  cliqueDaTela = (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.aba) {
      abaRelatorio = alvo.dataset.aba;
      document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === alvo));
      carregar();
    }
    if (alvo.dataset.detalhe) abrirDetalhe(alvo.dataset.detalhe, alvo.dataset.id, alvo.dataset.nome);
    if (alvo.id === 'btn-csv') exportarCsv();
    if (alvo.id === 'btn-excel') exportarExcel(alvo);
    if (alvo.id === 'btn-imprimir') window.print();
  };

  $('#mes-relatorio').addEventListener('change', carregar);
  $('#ano-relatorio').addEventListener('change', carregar);
  carregar();
}
