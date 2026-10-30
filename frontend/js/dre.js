// =====================================================================
// Xylo - DRE (Demonstração do Resultado do Exercício)
//
//   telaDRE(box)          aba "DRE" dos Relatórios: período, comparação,
//                         mês a mês, exportar Excel, PDF para apresentação
//                         e a configuração (grupo das categorias, dados fiscais)
//   resumoDRE(alvo, mes)  versão curta para o Início (só visualização)
//   tabelaDRE(d, op)      a tabela (usada também pela página dre.html)
//
// As regras de cálculo ficam no servidor (backend/src/relatorios/dre.js).
// Depende do comum.js (esc, formatarMoeda...), e na tela do sistema do api.js.
// =====================================================================

const DRE_ESTADO = { tipo: 'mes', mes: null, ano: null, tri: null, de: null, ate: null, comparar: '', mensal: false, detalhes: true };

const pctDRE = (v) => (v === null || v === undefined ? '–' : `${Number(v).toFixed(1).replace('.', ',')}%`);
const moedaDRE = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) < 0.005) return '–';
  return n < 0 ? `(${formatarMoeda(Math.abs(n))})` : formatarMoeda(n);
};

// ---------------------------------------------------------------------
// Tabela (tela e apresentação)
//   d = resposta de /relatorios/dre · op = { detalhes: bool }
// ---------------------------------------------------------------------
function tabelaDRE(d, { detalhes = true } = {}) {
  const mensal = Boolean(d.colunas_meses);
  const linhas = d.linhas.filter((l) => detalhes || l.nivel < 2);
  const classe = (l) => [`dre-${l.tipo}`, `dre-nivel-${l.nivel}`, l.tipo === 'resultado' && l.valor < 0 ? 'dre-prejuizo' : ''].join(' ');
  const num = (v, extra = '') => `<td class="num ${extra} ${Number(v) < 0 ? 'neg' : ''}">${moedaDRE(v)}</td>`;
  const cab = [
    '<th>Descrição</th>',
    ...(mensal ? d.colunas_meses.map((m) => `<th class="num">${esc(m.rotulo)}</th>`) : []),
    `<th class="num">${mensal ? 'Total' : esc(d.periodo.nome)}</th>`,
    '<th class="num" title="Análise vertical: % da receita operacional líquida">AV %</th>',
    ...(d.comparativo ? [`<th class="num">${esc(d.comparativo.nome)}</th>`, '<th class="num" title="Variação em relação ao período comparado">Var. %</th>'] : []),
  ].join('');
  const variacao = (l) => {
    if (l.variacao === null || l.variacao === undefined) return '<td class="num sub">–</td>';
    // para custos e despesas (negativos), aumentar é ruim
    const melhorou = l.valor >= l.anterior;
    return `<td class="num var ${Math.abs(l.variacao) < 0.05 ? '' : melhorou ? 'bom' : 'ruim'}">${l.variacao > 0 ? '+' : ''}${pctDRE(l.variacao)}</td>`;
  };
  return `
    <div class="tabela-wrap dre-wrap">
      <table class="tabela sem-ordenar dre-tabela ${mensal ? 'dre-mensal' : ''}">
        <thead><tr>${cab}</tr></thead>
        <tbody>
          ${linhas.map((l) => `
            <tr class="${classe(l)}">
              <td class="dre-rotulo">${esc(l.rotulo)}</td>
              ${mensal ? l.meses.map((v) => num(v)).join('') : ''}
              ${num(l.valor, 'dre-total')}
              <td class="num av">${l.av === null ? '–' : pctDRE(l.av)}</td>
              ${d.comparativo ? `${num(l.anterior)}${variacao(l)}` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function indicadoresDRE(d) {
  const i = d.indicadores;
  const a = d.indicadores_anterior;
  const item = (rotulo, valor, ant, dica) => `
    <div class="dre-ind" title="${esc(dica || '')}"><span>${rotulo}</span><strong>${valor}</strong>${ant !== undefined ? `<small>${esc(d.comparativo.nome)}: ${ant}</small>` : ''}</div>`;
  const moedaT = (v) => (v === null || v === undefined ? '–' : `${formatarMoeda(v)}/t`);
  return `
    <div class="dre-indicadores">
      ${item('Margem bruta', pctDRE(i.margem_bruta), a ? pctDRE(a.margem_bruta) : undefined, 'Lucro bruto ÷ receita líquida')}
      ${item('Margem operacional', pctDRE(i.margem_operacional), a ? pctDRE(a.margem_operacional) : undefined, 'Resultado operacional ÷ receita líquida')}
      ${item('Margem líquida', pctDRE(i.margem_liquida), a ? pctDRE(a.margem_liquida) : undefined, 'Resultado líquido ÷ receita líquida')}
      ${item('Madeira vendida', `${formatarPeso(i.toneladas)} t`, a ? `${formatarPeso(a.toneladas)} t` : undefined, `${i.viagens} viagem(ns)`)}
      ${item('Receita por tonelada', moedaT(i.receita_por_tonelada), a ? moedaT(a.receita_por_tonelada) : undefined, 'Venda de madeira ÷ toneladas')}
      ${item('Custo da madeira por t', moedaT(i.custo_madeira_por_tonelada), a ? moedaT(a.custo_madeira_por_tonelada) : undefined, '(Floresta + empreiteiro) ÷ toneladas')}
      ${item('Resultado por tonelada', moedaT(i.resultado_por_tonelada), a ? moedaT(a.resultado_por_tonelada) : undefined, 'Resultado líquido ÷ toneladas')}
    </div>`;
}

// "Para onde vai cada R$ 100 de receita": deduções, custos, despesas e resultado
function barraDestinoDRE(d) {
  const t = d.totais;
  const bruta = t.receitaBruta;
  if (!bruta) return '';
  const partes = [
    ['Impostos', -t.deducoes, 'ded'], ['Custos', -t.custos, 'cus'], ['Despesas', -t.despesasOp - (t.antesIR - t.resultadoOp) - (t.liquido - t.antesIR), 'des'],
    [t.liquido >= 0 ? 'Lucro' : 'Prejuízo', Math.abs(t.liquido), t.liquido >= 0 ? 'luc' : 'pre'],
  ].filter(([, v]) => v > 0.005);
  const soma = partes.reduce((s, [, v]) => s + v, 0) || 1;
  return `
    <div class="dre-destino" role="img" aria-label="De cada R$ 100 de receita: ${partes.map(([n, v]) => `${n} ${((v / bruta) * 100).toFixed(0)}`).join(', ')}">
      <div class="dre-barra">${partes.map(([n, v, c]) => `<span class="seg-${c}" style="flex:${v / soma}" title="${n}: ${formatarMoeda(v)} (${pctDRE((v / bruta) * 100)} da receita bruta)"></span>`).join('')}</div>
      <div class="dre-legenda">${partes.map(([n, v, c]) => `<span><i class="seg-${c}"></i>${n} <strong>${pctDRE((v / bruta) * 100)}</strong></span>`).join('')}</div>
    </div>`;
}

function avisosDRE(d) {
  const fora = (d.fora_da_dre || []).reduce((s, f) => s + f.valor, 0);
  return `${d.avisos.length ? `<div class="dre-avisos">${d.avisos.map((a) => `<p><i class="fas fa-triangle-exclamation"></i> ${esc(a)}</p>`).join('')}</div>` : ''}
    ${fora ? `<p class="sub dre-fora"><i class="fas fa-circle-info"></i> ${formatarMoeda(fora)} em despesas ficaram fora da DRE de propósito (pagamentos a florestas e empreiteiros, folha paga e adiantamentos: o custo já está nas viagens e na folha do mês).</p>` : ''}`;
}

// ---------------------------------------------------------------------
// Período escolhido -> { de, ate }
// ---------------------------------------------------------------------
function periodoDRE() {
  const e = DRE_ESTADO;
  if (e.tipo === 'mes') return { de: e.mes, ate: e.mes };
  if (e.tipo === 'trimestre') { const ini = (Number(e.tri) - 1) * 3 + 1; return { de: `${e.ano}-${String(ini).padStart(2, '0')}`, ate: `${e.ano}-${String(ini + 2).padStart(2, '0')}` }; }
  if (e.tipo === 'ano') return { de: `${e.ano}-01`, ate: `${e.ano}-12` };
  return { de: e.de, ate: e.ate };
}
function parametrosDRE() {
  const { de, ate } = periodoDRE();
  const p = new URLSearchParams({ de, ate });
  if (DRE_ESTADO.comparar) p.set('comparar', DRE_ESTADO.comparar);
  if (DRE_ESTADO.mensal && de !== ate) p.set('mensal', '1');
  return p;
}

// ---------------------------------------------------------------------
// Aba DRE dos Relatórios
// ---------------------------------------------------------------------
async function telaDRE(box) {
  const hoje = mesAtualISO();
  if (!DRE_ESTADO.ano) {
    const base = DRE_ESTADO.mes || hoje;
    Object.assign(DRE_ESTADO, { mes: base, ano: base.slice(0, 4), tri: String(Math.ceil(Number(base.slice(5, 7)) / 3)), de: `${base.slice(0, 4)}-01`, ate: base });
  }
  const e = DRE_ESTADO;
  box.className = '';
  box.innerHTML = `<div class="dre-tela">
    <div class="card dre-filtros so-tela">
      <div class="dre-filtros-linha">
        <label class="filtro-campo">Período
          <select id="dre-tipo">
            <option value="mes" ${e.tipo === 'mes' ? 'selected' : ''}>Mês</option>
            <option value="trimestre" ${e.tipo === 'trimestre' ? 'selected' : ''}>Trimestre</option>
            <option value="ano" ${e.tipo === 'ano' ? 'selected' : ''}>Ano</option>
            <option value="livre" ${e.tipo === 'livre' ? 'selected' : ''}>De… até…</option>
          </select></label>
        <label class="filtro-campo" data-p="mes">Mês <input type="month" id="dre-mes" value="${e.mes}"></label>
        <label class="filtro-campo" data-p="trimestre">Trimestre <select id="dre-tri">${[1, 2, 3, 4].map((t) => `<option value="${t}" ${String(t) === e.tri ? 'selected' : ''}>${t}º</option>`).join('')}</select></label>
        <label class="filtro-campo" data-p="trimestre ano">Ano <input type="number" id="dre-ano" min="2000" max="2100" value="${e.ano}"></label>
        <label class="filtro-campo" data-p="livre">De <input type="month" id="dre-de" value="${e.de}"></label>
        <label class="filtro-campo" data-p="livre">Até <input type="month" id="dre-ate" value="${e.ate}"></label>
        <label class="filtro-campo">Comparar com
          <select id="dre-comparar">
            <option value="">Nada</option>
            <option value="anterior" ${e.comparar === 'anterior' ? 'selected' : ''}>Período anterior</option>
            <option value="ano_anterior" ${e.comparar === 'ano_anterior' ? 'selected' : ''}>Mesmo período do ano anterior</option>
          </select></label>
      </div>
      <div class="dre-filtros-linha">
        <label class="opcao" data-p="trimestre ano livre"><input type="checkbox" id="dre-mensal" ${e.mensal ? 'checked' : ''}> Mês a mês</label>
        <label class="opcao"><input type="checkbox" id="dre-detalhes" ${e.detalhes ? 'checked' : ''}> Mostrar detalhes (categorias e folha)</label>
        <span class="espaco"></span>
        ${PERFIL.podeEditar ? '<button type="button" class="btn btn-secundario" id="dre-config"><i class="fas fa-sliders"></i> Configurar DRE</button>' : ''}
        <button type="button" class="btn btn-secundario" id="dre-pdf" title="Página pronta para imprimir ou salvar em PDF, com a logo da empresa"><i class="fas fa-file-pdf"></i> PDF para apresentação</button>
        <button type="button" class="btn btn-primario" id="dre-excel" title="Planilha com fórmulas, indicadores, critérios e as despesas de cada linha"><i class="fas fa-file-excel"></i> Exportar Excel</button>
      </div>
    </div>
    <div id="dre-corpo" class="carregando">Carregando…</div></div>`;
  const tela = box.querySelector('.dre-tela'); // os eventos ficam nele (some quando troca de aba)

  let pedido = 0;
  let dados = null;
  const mostrarCampos = () => {
    tela.querySelectorAll('[data-p]').forEach((el) => { el.hidden = !el.dataset.p.split(' ').includes(e.tipo); });
  };

  async function carregar() {
    Object.assign(e, {
      tipo: $('#dre-tipo').value, mes: $('#dre-mes').value || hoje, tri: $('#dre-tri').value, ano: $('#dre-ano').value || hoje.slice(0, 4),
      de: $('#dre-de').value || hoje, ate: $('#dre-ate').value || hoje, comparar: $('#dre-comparar').value,
      mensal: $('#dre-mensal').checked, detalhes: $('#dre-detalhes').checked,
    });
    mostrarCampos();
    const corpo = $('#dre-corpo');
    corpo.className = 'carregando';
    corpo.textContent = 'Carregando…';
    const meu = ++pedido;
    try {
      dados = await api(`/relatorios/dre?${parametrosDRE()}`);
      if (meu !== pedido || !$('#dre-corpo')) return;
      desenhar();
    } catch (erro) {
      if (meu !== pedido || !$('#dre-corpo')) return;
      corpo.className = 'aviso-erro';
      corpo.textContent = mensagemErro(erro);
    }
  }

  function desenhar() {
    const d = dados;
    const t = d.totais;
    const corpo = $('#dre-corpo');
    corpo.className = '';
    const cartao = (rotulo, valor, extra = '') => `<div class="card kpi"><span class="kpi-rotulo">${rotulo}</span><strong class="${valor < 0 ? 'negativo' : ''}">${formatarMoeda(valor)}</strong>${extra}</div>`;
    corpo.innerHTML = `
      ${avisosDRE(d)}
      <div class="cartoes cartoes-kpi">
        ${cartao('Receita líquida', t.receitaLiquida, `<span class="sub">bruta ${formatarMoeda(t.receitaBruta)}</span>`)}
        ${cartao('Lucro bruto', t.lucroBruto, `<span class="sub">margem ${pctDRE(d.indicadores.margem_bruta)}</span>`)}
        ${cartao('Resultado operacional', t.resultadoOp, `<span class="sub">margem ${pctDRE(d.indicadores.margem_operacional)}</span>`)}
        ${cartao(t.liquido >= 0 ? 'Lucro líquido' : 'Prejuízo', t.liquido, `<span class="sub">margem ${pctDRE(d.indicadores.margem_liquida)}</span>`)}
      </div>
      <section class="card">
        <header class="dre-cabecalho">
          <div><h3>DRE · ${esc(d.periodo.nome)}</h3>
            <p class="sub">Regime de competência${d.fiscal.regime_nome ? ` · ${esc(d.fiscal.regime_nome)}` : ''}${d.comparativo ? ` · comparando com ${esc(d.comparativo.nome)}` : ''} · AV % sobre a receita líquida</p></div>
        </header>
        ${barraDestinoDRE(d)}
        ${tabelaDRE(d, { detalhes: e.detalhes })}
      </section>
      <section class="card"><h3>Indicadores</h3>${indicadoresDRE(d)}</section>`;
  }

  // ---- Configuração: grupo de cada categoria + dados fiscais ----------
  async function configurar() {
    let cfg;
    try { cfg = await api('/relatorios/dre/config'); } catch (erro) { toast(mensagemErro(erro), 'erro'); return; }
    const f = cfg.fiscal;
    const decimal = (v) => (v ? String(v).replace('.', ',') : '');
    abrirModal('Configurar a DRE', `
      <form novalidate>
        <fieldset class="dre-config-bloco" ${PERFIL.admin ? '' : 'disabled'}>
          <legend>Impostos (o contador informa) ${PERFIL.admin ? '' : '<small>· só o Administrador altera</small>'}</legend>
          <div class="grade-campos">
            <div class="campo"><label for="cf-regime">Regime tributário</label>
              <select id="cf-regime" name="regime_tributario"><option value="">Não informado</option>
                ${Object.entries(cfg.regimes).map(([k, n]) => `<option value="${k}" ${f.regime_tributario === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="campo"><label for="cf-aliq">Impostos sobre a receita (%)</label>
              <input id="cf-aliq" name="aliquota_receita" inputmode="decimal" value="${decimal(f.aliquota_receita)}" placeholder="Ex.: 6,5">
              <small>Simples: a alíquota efetiva do DAS. Presumido/Real: PIS + COFINS + ICMS/ISS.</small></div>
            <div class="campo"><label for="cf-ir">IRPJ + CSLL (%)</label>
              <input id="cf-ir" name="aliquota_ir_csll" inputmode="decimal" value="${decimal(f.aliquota_ir_csll)}" placeholder="Simples/MEI: 0">
              <small>No Simples e no MEI já estão no DAS: deixe 0.</small></div>
            <div class="campo"><label for="cf-base">IRPJ + CSLL calculados sobre</label>
              <select id="cf-base" name="base_ir_csll">
                <option value="lucro" ${f.base_ir_csll !== 'receita' ? 'selected' : ''}>o lucro (Lucro Real)</option>
                <option value="receita" ${f.base_ir_csll === 'receita' ? 'selected' : ''}>a receita bruta (Lucro Presumido: % efetivo)</option>
              </select></div>
          </div>
        </fieldset>
        <fieldset class="dre-config-bloco">
          <legend>Em que linha da DRE entra cada categoria de despesa</legend>
          <p class="sub">Pagamentos a florestas e empreiteiros, a folha paga e os adiantamentos já ficam fora sozinhos (o custo deles está nas viagens e na folha do mês).</p>
          <div class="dre-categorias">
            ${cfg.categorias.map((c) => `
              <label class="dre-cat ${c.ativo ? '' : 'inativo'}"><span>${esc(c.nome)}<small>${c.despesas} lançamento(s)</small></span>
                <select data-categoria="${c.id}">${Object.entries(cfg.grupos).map(([k, n]) => `<option value="${k}" ${c.grupo_dre === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}
          </div>
        </fieldset>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar</button>
        </div>
      </form>`);
    $('#modal').classList.add('modal-medio');
    ligarFormulario(async (dadosForm) => {
      const corpo = {
        categorias: [...document.querySelectorAll('#modal-corpo [data-categoria]')].map((s) => ({ id: Number(s.dataset.categoria), grupo_dre: s.value })),
      };
      if (PERFIL.admin) {
        corpo.fiscal = {
          regime_tributario: dadosForm.regime_tributario || null, aliquota_receita: dadosForm.aliquota_receita || '0',
          aliquota_ir_csll: dadosForm.aliquota_ir_csll || '0', base_ir_csll: dadosForm.base_ir_csll,
        };
      }
      await api('/relatorios/dre/config', { metodo: 'PUT', corpo });
      toast('Configuração da DRE salva.');
      carregar();
    });
  }

  tela.addEventListener('change', (ev) => { if (ev.target.closest('.dre-filtros')) carregar(); });
  tela.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'dre-config') configurar();
    if (b.id === 'dre-pdf') window.open(`dre.html?${parametrosDRE()}&detalhes=${e.detalhes ? 1 : 0}`, '_blank', 'noopener');
    if (b.id === 'dre-excel') {
      const texto = b.innerHTML;
      b.disabled = true;
      b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando…';
      try {
        const { de, ate } = periodoDRE();
        await baixarArquivo(`/exportacao/dre?${parametrosDRE()}`, `DRE ${de}${de !== ate ? ` a ${ate}` : ''}.xlsx`);
      } catch (erro) {
        toast(mensagemErro(erro), 'erro');
      } finally {
        b.disabled = false;
        b.innerHTML = texto;
      }
    }
  });
  mostrarCampos();
  carregar();
}

// ---------------------------------------------------------------------
// Início: DRE do mês, só para ver (o completo fica em Relatórios › DRE)
// ---------------------------------------------------------------------
async function resumoDRE(alvo, mes) {
  if (!alvo) return;
  try {
    const d = await api(`/relatorios/dre?de=${mes}&ate=${mes}`);
    if (!alvo.isConnected) return;
    const pega = (id) => (d.linhas.find((l) => l.id === id) || { valor: 0, av: null });
    const linha = (id, rotulo, tipo = '') => {
      const l = pega(id);
      return `<tr class="${tipo}"><td>${rotulo}</td><td class="num ${l.valor < 0 ? 'neg' : ''}">${moedaDRE(l.valor)}</td><td class="num av">${l.av === null ? '–' : pctDRE(l.av)}</td></tr>`;
    };
    const liq = d.totais.liquido;
    alvo.innerHTML = `
      <header class="cabecalho-grafico">
        <div><h3>DRE do mês</h3><p class="sub">${esc(d.periodo.nome)} · regime de competência</p></div>
        <a class="link-botao pequeno" href="#relatorios" data-abrir-dre>DRE completa</a>
      </header>
      ${barraDestinoDRE(d)}
      <table class="tabela sem-ordenar dre-tabela dre-resumo">
        <tbody>
          ${linha('receita_bruta', 'Receita bruta', 'dre-grupo')}
          ${linha('deducoes', '(−) Impostos sobre a receita')}
          ${linha('receita_liquida', '(=) Receita líquida', 'dre-subtotal')}
          ${linha('custos', '(−) Custos (madeira, corte, operação)')}
          ${linha('lucro_bruto', '(=) Lucro bruto', 'dre-subtotal')}
          ${linha('despesas_operacionais', '(−) Despesas operacionais')}
          ${linha('resultado_financeiro', '(±) Resultado financeiro')}
          ${linha('ir_csll', '(−) IRPJ e CSLL')}
          <tr class="dre-resultado ${liq < 0 ? 'dre-prejuizo' : ''}"><td>${liq >= 0 ? '(=) Lucro líquido' : '(=) Prejuízo'}</td><td class="num">${moedaDRE(liq)}</td><td class="num av">${pctDRE(d.indicadores.margem_liquida)}</td></tr>
        </tbody>
      </table>
      ${d.avisos.length ? `<p class="sub dre-aviso-curto"><i class="fas fa-triangle-exclamation"></i> ${esc(d.avisos[0])}</p>` : ''}`;
    alvo.querySelector('[data-abrir-dre]').addEventListener('click', () => {
      if (typeof abaRelatorio !== 'undefined') abaRelatorio = 'dre';
      Object.assign(DRE_ESTADO, { tipo: 'mes', mes });
    });
  } catch {
    alvo.innerHTML = '<p class="sub">Não foi possível montar a DRE do mês.</p>';
  }
}
