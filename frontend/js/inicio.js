// =====================================================================
// Xylo - INÍCIO: painel do mês com gráficos interativos (main.html#inicio)
//
//   - indicadores do mês com a variação em relação ao mês anterior
//   - evolução dos últimos 12 meses (faturamento x despesas, resultado, toneladas)
//   - toneladas por dia, clientes do mês, toneladas por classe
//   - o que falta receber (fretes) e pagar (despesas)
// O filtro de mês no topo vale para tudo o que está abaixo dele.
//
// Depende do comum.js, api.js, graficos.js e de main.js (conteudo, usuario, empresa).
// =====================================================================

let mesPainel = mesAtualISO();
let visaoEvolucao = 'valores';

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesCurto = (m) => `${MESES_CURTOS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const mesLongo = (m) => `${MESES_LONGOS[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const moedaCompacta = (v) => `R$ ${Graficos.compacto.format(v)}`;

async function telaInicio() {
  setTimeout(() => avisoDeFatura($('#aviso-fatura')), 0); // js/financeiro.js
  conteudo.innerHTML = `
    <div class="painel-topo">
      <div>
        <h2 class="saudacao">Olá, ${esc((usuario.nome || '').split(' ')[0])}!</h2>
        <p class="sub">${esc(empresa.nome)} · ${esc(usuario.perfil)}</p>
      </div>
      <label class="filtro-campo">Mês <input type="month" id="mes-painel" value="${mesPainel}"></label>
    </div>
    <div id="aviso-fatura"></div>

    <div id="painel">
      <div class="cartoes cartoes-kpi" id="kpis"></div>

      <div class="grade-painel">
        <section class="card painel-largo">
          <header class="cabecalho-grafico">
            <div><h3>Evolução</h3><p class="sub" id="sub-evolucao">últimos 12 meses</p></div>
            <div class="segmentos" role="group" aria-label="O que mostrar">
              <button type="button" data-visao="valores">Faturamento x despesas</button>
              <button type="button" data-visao="resultado">Resultado</button>
              <button type="button" data-visao="toneladas">Toneladas</button>
            </div>
            <button type="button" class="link-botao pequeno" data-tabela="evolucao">Ver tabela</button>
          </header>
          <div id="graf-evolucao" class="area-grafico"></div>
        </section>

        <section class="card painel-largo">
          <header class="cabecalho-grafico">
            <div><h3>Toneladas por dia</h3><p class="sub" id="sub-diario"></p></div>
            <button type="button" class="link-botao pequeno" data-tabela="diario">Ver tabela</button>
          </header>
          <div id="graf-diario" class="area-grafico"></div>
        </section>

        <section class="card">
          <header class="cabecalho-grafico">
            <div><h3>Clientes do mês</h3><p class="sub">valor vendido · clique para ver o relatório</p></div>
          </header>
          <div id="graf-clientes"></div>
        </section>

        <section class="card">
          <header class="cabecalho-grafico">
            <div><h3>Toneladas por classe</h3><p class="sub">lixo, fina, média, grossa…</p></div>
          </header>
          <div id="graf-classes"></div>
        </section>

        <section class="card painel-largo dre-inicio" id="dre-mes"><p class="sub">Montando a DRE do mês…</p></section>
      </div>

      <div class="cartoes cartoes-mini" id="pendencias"></div>
      <p class="sub resumo-cadastros" id="resumo-cadastros"></p>
    </div>`;

  // Guardados para alternar gráfico/tabela sem buscar de novo
  let evolucao = [];
  let diario = [];
  const tabelaAberta = { evolucao: false, diario: false };

  // ---- Indicadores do mês -------------------------------------------
  function desenharKpis() {
    const atual = evolucao[evolucao.length - 1];
    const anterior = evolucao[evolucao.length - 2];
    const delta = (campo, sobeEhBom) => {
      const a = Number(atual[campo]);
      const b = Number(anterior[campo]);
      if (!b) return '<span class="delta neutro">sem comparação com o mês anterior</span>';
      const p = ((a - b) / Math.abs(b)) * 100;
      const subiu = p >= 0;
      const bom = subiu === sobeEhBom;
      return `<span class="delta ${Math.abs(p) < 0.05 ? 'neutro' : bom ? 'bom' : 'ruim'}">
        <span aria-hidden="true">${subiu ? '▲' : '▼'}</span> ${Math.abs(p).toFixed(1).replace('.', ',')}%
        <span class="sub">vs ${mesCurto(anterior.mes)}</span></span>`;
    };
    const kpi = (rotulo, valor, extra, link) => `
      <a class="card kpi" href="${link}">
        <span class="kpi-rotulo">${rotulo}</span>
        <strong>${valor}</strong>${extra}
      </a>`;
    const fat = Number(atual.faturamento);
    const res = Number(atual.resultado);
    $('#kpis').innerHTML =
      kpi('Toneladas', `${formatarPeso(atual.toneladas)} t`, `${delta('toneladas', true)}<span class="sub">${atual.viagens} viagens</span>`, '#viagens')
      + kpi('Faturamento', formatarMoeda(fat), delta('faturamento', true), '#relatorios')
      + kpi('Despesas', formatarMoeda(atual.despesas), delta('despesas', false), '#despesas')
      + kpi('Resultado', `<span class="${res < 0 ? 'negativo' : ''}">${formatarMoeda(res)}</span>`,
        `<span class="sub">${fat ? `${((res / fat) * 100).toFixed(1).replace('.', ',')}% do faturamento` : 'sem faturamento no mês'}</span>`, '#relatorios');
  }

  // ---- Evolução (12 meses) -------------------------------------------
  function desenharEvolucao() {
    const alvo = $('#graf-evolucao');
    document.querySelectorAll('[data-visao]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.visao === visaoEvolucao));
    const rotulos = evolucao.map((l) => mesLongo(l.mes));
    const curtos = evolucao.map((l) => mesCurto(l.mes));
    const serie = (nome, campo, cor, formato) => ({ nome, valores: evolucao.map((l) => Number(l[campo])), cor, formato });

    if (tabelaAberta.evolucao) {
      Graficos.tabela(alvo, {
        primeira: 'Mês', rotulos, formato: formatarMoeda,
        series: [serie('Viagens', 'viagens', '', String), serie('Toneladas', 'toneladas', '', formatarPeso),
          serie('Faturamento', 'faturamento'), serie('Despesas', 'despesas'), serie('Resultado', 'resultado')],
      });
      return;
    }
    if (visaoEvolucao === 'valores') {
      Graficos.linhas(alvo, {
        rotulos, rotulosCurtos: curtos, formato: formatarMoeda, formatoEixo: moedaCompacta,
        series: [serie('Faturamento', 'faturamento', Graficos.CORES.verde), serie('Despesas', 'despesas', Graficos.CORES.violeta)],
        extraDica: (i) => [{ valor: formatarMoeda(evolucao[i].resultado), rotulo: 'resultado' }],
        descricao: 'Faturamento e despesas nos últimos 12 meses.',
      });
    } else if (visaoEvolucao === 'resultado') {
      Graficos.colunas(alvo, {
        rotulos, rotulosCurtos: curtos, formato: formatarMoeda, formatoEixo: moedaCompacta,
        series: [serie('Resultado', 'resultado', Graficos.CORES.verde)], corNegativa: Graficos.CORES.perda,
        extraDica: (i) => [{ valor: formatarMoeda(evolucao[i].faturamento), rotulo: 'faturamento' }, { valor: formatarMoeda(evolucao[i].despesas), rotulo: 'despesas' }],
        aoClicar: (i) => abrirRelatorio('fechamento', evolucao[i].mes),
        descricao: 'Resultado (faturamento menos despesas) nos últimos 12 meses; prejuízo aparece abaixo da linha do zero.',
      });
    } else {
      Graficos.linhas(alvo, {
        rotulos, rotulosCurtos: curtos, area: true, formato: (v) => `${formatarPeso(v)} t`, formatoEixo: (v) => `${Graficos.compacto.format(v)} t`,
        series: [serie('Toneladas', 'toneladas', Graficos.CORES.verde)],
        extraDica: (i) => [{ valor: `${evolucao[i].viagens}`, rotulo: 'viagens' }],
        descricao: 'Toneladas transportadas nos últimos 12 meses.',
      });
    }
  }

  // ---- Toneladas por dia ---------------------------------------------
  function desenharDiario() {
    const alvo = $('#graf-diario');
    const total = diario.reduce((t, d) => t + Number(d.toneladas), 0);
    const dias = diario.filter((d) => d.viagens).length;
    $('#sub-diario').textContent = total
      ? `${formatarPeso(total)} t em ${dias} ${dias === 1 ? 'dia' : 'dias'} com viagem · clique num dia para ver as viagens do mês`
      : `nenhuma viagem em ${mesLongo(mesPainel)}`;
    const rotulos = diario.map((d) => formatarDataISO(d.dia));
    if (tabelaAberta.diario) {
      const comViagem = diario.filter((d) => d.viagens);
      Graficos.tabela(alvo, {
        primeira: 'Dia', rotulos: comViagem.map((d) => formatarDataISO(d.dia)), formato: formatarMoeda,
        series: [{ nome: 'Viagens', valores: comViagem.map((d) => d.viagens), formato: String },
          { nome: 'Toneladas', valores: comViagem.map((d) => d.toneladas), formato: formatarPeso },
          { nome: 'Valor', valores: comViagem.map((d) => d.valor) }],
      });
      return;
    }
    Graficos.colunas(alvo, {
      rotulos, rotulosCurtos: diario.map((d) => String(Number(d.dia.slice(8)))), altura: 200,
      formato: (v) => `${formatarPeso(v)} t`, formatoEixo: (v) => `${Graficos.compacto.format(v)} t`,
      series: [{ nome: 'Toneladas', valores: diario.map((d) => Number(d.toneladas)), cor: Graficos.CORES.verde }],
      extraDica: (i) => (diario[i].viagens
        ? [{ valor: `${diario[i].viagens}`, rotulo: diario[i].viagens === 1 ? 'viagem' : 'viagens' }, { valor: formatarMoeda(diario[i].valor), rotulo: 'vendido' }]
        : [{ valor: '', rotulo: 'sem viagens' }]),
      aoClicar: () => { mesViagens = mesPainel; location.hash = '#viagens'; },
      descricao: `Toneladas por dia em ${mesLongo(mesPainel)}.`,
    });
  }

  // Abre uma aba dos Relatórios já no mês certo
  function abrirRelatorio(aba, mes) {
    abaRelatorio = aba;
    mesRelatorio = mes;
    location.hash = '#relatorios';
  }

  // ---- Carregar tudo do mês -------------------------------------------
  async function carregar() {
    mesPainel = $('#mes-painel').value || mesAtualISO();
    const painel = $('#painel');
    painel.classList.add('atualizando'); // mantém o desenho anterior, mais claro, enquanto busca

    resumoDRE($('#dre-mes'), mesPainel); // js/dre.js (carrega sozinho)
    const pedidos = await Promise.allSettled([
      api(`/relatorios/evolucao?ate=${mesPainel}&meses=12`),
      api(`/relatorios/diario?mes=${mesPainel}`),
      api(`/relatorios/clientes?mes=${mesPainel}`),
      api(`/relatorios/classes?mes=${mesPainel}`),
      api(`/fretes?mes=${mesPainel}`),
      api(`/despesas?mes=${mesPainel}`),
    ]);
    if (!$('#painel')) return; // usuário trocou de tela
    painel.classList.remove('atualizando');
    const [rEvo, rDia, rCli, rCla, rFre, rDes] = pedidos;
    const falhou = (r, sel) => { if (r.status === 'rejected') { $(sel).innerHTML = `<p class="aviso-erro">${esc(mensagemErro(r.reason))}</p>`; return true; } return false; };

    if (!falhou(rEvo, '#graf-evolucao')) {
      evolucao = rEvo.value;
      $('#sub-evolucao').textContent = `${mesCurto(evolucao[0].mes)} a ${mesCurto(evolucao[evolucao.length - 1].mes)}`;
      desenharKpis();
      desenharEvolucao();
    } else {
      $('#kpis').innerHTML = '';
    }
    if (!falhou(rDia, '#graf-diario')) { diario = rDia.value; desenharDiario(); }

    if (!falhou(rCli, '#graf-clientes')) {
      const clientes = rCli.value;
      if (!clientes.length) $('#graf-clientes').innerHTML = '<p class="vazio">Nenhuma viagem no mês.</p>';
      else {
        Graficos.barras($('#graf-clientes'), {
          itens: clientes.map((c) => ({ rotulo: c.nome, valor: c.valor_total, ton: c.toneladas, viagens: c.qtd_viagens })),
          formato: formatarMoeda, cor: Graficos.CORES.verde, max: 6,
          extraDica: (c) => [{ valor: `${formatarPeso(c.ton)} t`, rotulo: `${c.viagens} viagens` }],
          aoClicar: () => abrirRelatorio('clientes', mesPainel), dicaClique: 'Clique para abrir o relatório',
        });
      }
    }
    if (!falhou(rCla, '#graf-classes')) {
      const classes = rCla.value;
      const total = classes.reduce((t, c) => t + Number(c.toneladas), 0);
      if (!classes.length) $('#graf-classes').innerHTML = '<p class="vazio">Nenhuma viagem no mês.</p>';
      else {
        Graficos.barras($('#graf-classes'), {
          itens: classes.map((c) => ({ rotulo: c.nome, valor: c.toneladas, preco: c.preco_medio })),
          formato: (v) => `${formatarPeso(v)} t`, cor: Graficos.CORES.verde,
          extraDica: (c) => [{ valor: `${((c.valor / total) * 100).toFixed(1).replace('.', ',')}%`, rotulo: 'das toneladas' },
            { valor: formatarMoeda(c.preco), rotulo: 'preço médio/t' }],
          aoClicar: () => abrirRelatorio('classes', mesPainel), dicaClique: 'Clique para abrir o relatório',
        });
      }
    }

    // O que falta receber e pagar
    const pend = [];
    if (rFre.status === 'fulfilled') pend.push(['fa-hand-holding-dollar', formatarMoeda(rFre.value.totais.a_receber), 'fretes a receber', '#fretes']);
    if (rDes.status === 'fulfilled') pend.push(['fa-file-invoice-dollar', formatarMoeda(rDes.value.totais.a_pagar), 'despesas a pagar', '#despesas']);
    $('#pendencias').innerHTML = pend.map(([icone, valor, texto, link]) => `
      <a class="card cartao" href="${link}"><div class="cartao-icone"><i class="fas ${icone}"></i></div>
        <div><strong>${valor}</strong><span>${texto} em ${MESES_LONGOS[Number(mesPainel.slice(5)) - 1]}</span></div></a>`).join('');
  }

  // Resumo dos cadastros (não depende do mês)
  Promise.all(['/clientes', '/florestas', '/empreiteiros'].map((r) => api(r).then((l) => l.length).catch(() => '–')))
    .then(([c, f, e]) => {
      const el = $('#resumo-cadastros');
      if (el) el.innerHTML = `Cadastros ativos: <a href="#clientes">${c} clientes</a> · <a href="#florestas">${f} florestas</a> · <a href="#empreiteiros">${e} empreiteiros</a>`;
    });

  cliqueDaTela = (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.visao) {
      visaoEvolucao = alvo.dataset.visao;
      tabelaAberta.evolucao = false;
      $('[data-tabela="evolucao"]').textContent = 'Ver tabela';
      if (evolucao.length) desenharEvolucao();
    }
    if (alvo.dataset.tabela) {
      const qual = alvo.dataset.tabela;
      tabelaAberta[qual] = !tabelaAberta[qual];
      alvo.textContent = tabelaAberta[qual] ? 'Ver gráfico' : 'Ver tabela';
      if (qual === 'evolucao' && evolucao.length) desenharEvolucao();
      if (qual === 'diario' && diario.length) desenharDiario();
    }
  };

  $('#mes-painel').addEventListener('change', carregar);
  await carregar();
}
