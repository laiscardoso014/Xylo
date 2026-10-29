// =====================================================================
// Xylo - DESPESAS (main.html#despesas)
//
// O que sai do caixa: adiantamentos, pagamento de floresta e de empreiteiro,
// folha, combustível, manutenção... Cada despesa tem uma categoria e pode ser
// ligada a um empreiteiro e/ou a uma floresta (o relatório do empreiteiro
// desconta os adiantamentos dele).
//
// Depende do comum.js, do api.js, de main.js (conteudo, PERFIL, cliqueDaTela)
// e de FORMAS_PAGAMENTO (fretes.js).
// =====================================================================

let mesDespesas = mesAtualISO();
const NOVA_CATEGORIA = '__nova__';

async function telaDespesas() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Mês <input type="month" id="mes-despesas" value="${mesDespesas}"></label>
      <label class="filtro-campo">Categoria <select id="filtro-categoria"><option value="">Todas</option></select></label>
      <label class="filtro-campo">Situação
        <select id="filtro-situacao-despesa"><option value="">Todas</option><option>Pendente</option><option value="Pago">Paga</option></select></label>
      <input type="search" class="busca" id="busca-despesa" placeholder="Buscar despesa…">
      <label class="opcao"><input type="checkbox" id="mostrar-canceladas-despesa"> Canceladas</label>
      <span class="espaco"></span>
      ${PERFIL.podeEditar ? '<button type="button" class="btn btn-primario" id="btn-nova-despesa"><i class="fas fa-plus"></i> Nova despesa</button>' : ''}
    </div>
    <div class="cartoes cartoes-mini" id="totais-despesas"></div>
    <div class="card" id="por-categoria" hidden></div>
    <div class="card sem-padding"><div id="lista-despesas" class="carregando">Carregando…</div></div>`;

  let despesas = [];
  let opcoes = { categorias: [], empreiteiros: [], florestas: [] };

  async function carregarOpcoes() {
    opcoes = await api('/despesas/opcoes');
    const filtro = $('#filtro-categoria');
    if (!filtro) return;
    const escolhida = filtro.value;
    filtro.innerHTML = '<option value="">Todas</option>'
      + opcoes.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
    filtro.value = escolhida;
  }

  async function carregar() {
    mesDespesas = $('#mes-despesas').value || mesAtualISO();
    const f = new URLSearchParams({ mes: mesDespesas });
    if ($('#filtro-categoria').value) f.set('categoria_id', $('#filtro-categoria').value);
    if ($('#filtro-situacao-despesa').value) f.set('situacao', $('#filtro-situacao-despesa').value);
    if ($('#mostrar-canceladas-despesa').checked) f.set('cancelados', 'true');
    try {
      const r = await api(`/despesas?${f}`);
      if (!$('#lista-despesas')) return; // usuário já trocou de tela
      despesas = r.despesas;
      desenharTotais(r.totais);
      desenharCategorias(r.por_categoria, r.totais.valor_total);
      desenhar();
    } catch (erro) {
      const box = $('#lista-despesas');
      if (!box) return;
      box.className = 'aviso-erro';
      box.textContent = mensagemErro(erro);
    }
  }

  function desenharTotais(t) {
    const cartao = (icone, valor, texto) => `
      <div class="card cartao"><div class="cartao-icone"><i class="fas ${icone}"></i></div>
        <div><strong>${valor}</strong><span>${texto}</span></div></div>`;
    $('#totais-despesas').innerHTML =
      cartao('fa-receipt', t.despesas, 'despesas no mês')
      + cartao('fa-money-bill-wave', formatarMoeda(t.valor_total), 'valor total')
      + cartao('fa-circle-check', formatarMoeda(t.pago), 'pago')
      + cartao('fa-hourglass-half', formatarMoeda(t.a_pagar), 'a pagar');
  }

  // Quanto cada categoria pesa no mês (barra proporcional ao total)
  function desenharCategorias(lista, total) {
    const box = $('#por-categoria');
    box.hidden = !lista.length;
    if (!lista.length) return;
    const soma = Number(total) || 1;
    box.innerHTML = `
      <h3 class="titulo-card">Por categoria</h3>
      <ul class="barras-categoria">
        ${lista.map((c) => {
          const pct = (Number(c.valor) / soma) * 100;
          return `<li>
            <span class="rotulo">${esc(c.categoria)} <small>(${c.despesas})</small></span>
            <span class="barra"><span style="width:${Math.max(pct, 1).toFixed(1)}%"></span></span>
            <span class="valor">${formatarMoeda(c.valor)} <small>${pct.toFixed(0)}%</small></span>
          </li>`;
        }).join('')}
      </ul>`;
  }

  const selo = (s) => ({ Pago: 'selo-ativo', Pendente: 'selo-pendente', Cancelado: 'selo-inativo' }[s] || '');
  const nomeSituacao = (s) => ({ Pago: 'Paga', Cancelado: 'Cancelada' }[s] || s);

  function desenhar() {
    const termo = $('#busca-despesa').value.trim().toLowerCase();
    const lista = despesas.filter((d) => !termo
      || [d.descricao, d.favorecido, d.categoria, d.empreiteiro, d.floresta, d.observacoes]
        .some((x) => String(x || '').toLowerCase().includes(termo)));

    const box = $('#lista-despesas');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = despesas.length ? 'Nenhuma despesa encontrada na busca.' : 'Nenhuma despesa lançada neste mês.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela tabela-viagens">
        <thead><tr>
          <th>Data</th><th>Descrição</th><th>Categoria</th><th>Ligada a</th>
          <th class="num">Valor</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody>
          ${lista.map((d) => `
            <tr class="${d.status === 'Cancelado' ? 'inativo' : ''}">
              <td>${formatarDataISO(d.data)}</td>
              <td><strong>${esc(d.descricao)}</strong>${d.favorecido ? `<div class="sub">${esc(d.favorecido)}</div>` : ''}</td>
              <td>${esc(d.categoria)}</td>
              <td>${[d.empreiteiro && `<i class="fas fa-helmet-safety"></i> ${esc(d.empreiteiro)}`,
                     d.floresta && `<i class="fas fa-tree"></i> ${esc(d.floresta)}`].filter(Boolean).join('<br>') || '<span class="sub">—</span>'}</td>
              <td class="num"><strong>${formatarMoeda(d.valor)}</strong></td>
              <td><span class="selo ${selo(d.status)}">${nomeSituacao(d.status)}</span>
                <div class="sub">${d.data_pagamento ? `em ${formatarDataISO(d.data_pagamento)}` : esc(d.forma_pagamento || '')}</div></td>
              <td class="acoes">
                ${PERFIL.podeEditar && d.status === 'Pendente' ? `<button type="button" class="icone-botao" data-pagar="${d.id}" title="Marcar como paga"><i class="fas fa-circle-check"></i></button>` : ''}
                ${PERFIL.podeEditar && d.status === 'Pago' ? `<button type="button" class="icone-botao" data-despagar="${d.id}" title="Voltar para pendente"><i class="fas fa-rotate-left"></i></button>` : ''}
                ${PERFIL.podeEditar && d.status !== 'Cancelado' ? `<button type="button" class="icone-botao" data-editar="${d.id}" title="Corrigir"><i class="fas fa-pen"></i></button>` : ''}
                ${PERFIL.admin && d.status !== 'Cancelado' ? `<button type="button" class="icone-botao perigo" data-cancelar="${d.id}" title="Cancelar despesa (não aconteceu)"><i class="fas fa-ban"></i></button>` : ''}
                ${botaoHistorico(d, 'despesas')}${botaoExcluir(d, 'despesas')}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ---- Formulário ----------------------------------------------------
  const decimal = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));

  // Mantém no select o item já gravado, mesmo que tenha sido desativado
  const comAtual = (lista, id, nome) => (id && !lista.some((x) => x.id === id)
    ? [...lista, { id, nome: `${nome} (inativo)` }] : lista);
  const opcoesDe = (lista, id) => lista.map((x) => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');

  function formulario(d = {}) {
    const pago = d.status === 'Pago';
    const categorias = comAtual(opcoes.categorias, d.categoria_id, d.categoria);
    const empreiteiros = comAtual(opcoes.empreiteiros, d.empreiteiro_id, d.empreiteiro);
    const florestas = comAtual(opcoes.florestas, d.floresta_id, d.floresta);

    abrirModal(d.id ? 'Corrigir despesa' : 'Nova despesa', `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo"><label>Data *</label><input name="data" type="date" required value="${d.data || hojeISO()}"></div>
          <div class="campo"><label>Valor (R$) *</label><input name="valor" required inputmode="decimal" value="${decimal(d.valor)}" placeholder="Ex.: 7.175,00"></div>
          <div class="campo larga"><label>Descrição *</label><input name="descricao" required maxlength="255" value="${esc(d.descricao)}" placeholder="Ex.: Adiantamento semanal"></div>
          <div class="campo"><label>Categoria *</label>
            <select name="categoria_id" required><option value="">Selecione…</option>
              ${opcoesDe(categorias, d.categoria_id)}
              ${PERFIL.podeEditar ? `<option value="${NOVA_CATEGORIA}">+ Nova categoria…</option>` : ''}</select></div>
          <div class="campo" id="campo-categoria-nova" hidden><label>Nome da nova categoria *</label>
            <input name="categoria_nova" maxlength="100" placeholder="Ex.: Pedágio"></div>
          <div class="campo"><label>Favorecido</label><input name="favorecido" maxlength="150" value="${esc(d.favorecido)}" placeholder="Quem recebeu"></div>
          <div class="campo"><label>Empreiteiro <small>(opcional)</small></label>
            <select name="empreiteiro_id"><option value="">Nenhum</option>${opcoesDe(empreiteiros, d.empreiteiro_id)}</select></div>
          <div class="campo"><label>Floresta <small>(opcional)</small></label>
            <select name="floresta_id"><option value="">Nenhuma</option>${opcoesDe(florestas, d.floresta_id)}</select></div>
          <div class="campo"><label>Forma de pagamento</label>
            <select name="forma_pagamento"><option value="">Não informada</option>
              ${FORMAS_PAGAMENTO.map((x) => `<option ${x === d.forma_pagamento ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="campo"><label>Situação</label>
            <select name="status">
              <option value="Pendente" ${pago ? '' : 'selected'}>Pendente</option><option value="Pago" ${pago ? 'selected' : ''}>Paga</option>
            </select></div>
          <div class="campo" id="campo-pago-em"><label>Paga em</label>
            <input name="data_pagamento" type="date" value="${d.data_pagamento || ''}"></div>
          <div class="campo larga"><label>Observações</label><textarea name="observacoes" rows="2">${esc(d.observacoes)}</textarea></div>
        </div>
        <p class="nota" id="nota-empreiteiro" hidden><i class="fas fa-circle-info"></i>
          Ligada a um empreiteiro, a despesa é descontada do que ele tem a receber no relatório.</p>
        ${RODAPE_FORMULARIO}
      </form>`);

    const form = $('#modal-corpo form');
    const campo = (n) => form.elements[n];

    function ajustar() {
      const nova = campo('categoria_id').value === NOVA_CATEGORIA;
      $('#campo-categoria-nova').hidden = !nova;
      const paga = campo('status').value === 'Pago';
      $('#campo-pago-em').hidden = !paga;
      // Ao marcar como paga, sugere a própria data da despesa
      if (paga && !campo('data_pagamento').value) campo('data_pagamento').value = campo('data').value;
      $('#nota-empreiteiro').hidden = !campo('empreiteiro_id').value;
    }
    form.addEventListener('change', ajustar);
    ajustar();

    ligarFormulario(async (dados) => {
      if (dados.categoria_id === NOVA_CATEGORIA) {
        if (!dados.categoria_nova.trim()) throw new Error('Informe o nome da nova categoria.');
        delete dados.categoria_id;
      } else {
        delete dados.categoria_nova;
      }
      if (d.id) {
        await api(`/despesas/${d.id}`, { metodo: 'PUT', corpo: dados });
        toast('Despesa corrigida.');
      } else {
        const nova = await api('/despesas', { metodo: 'POST', corpo: dados });
        toast(`Despesa lançada: ${formatarMoeda(nova.valor)}.`);
        if (nova.data.slice(0, 7) !== mesDespesas) $('#mes-despesas').value = nova.data.slice(0, 7);
      }
      if (dados.categoria_nova) await carregarOpcoes();
      carregar();
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const achar = (id) => despesas.find((d) => d.id === Number(id));
    try {
      if (alvo.id === 'btn-nova-despesa') formulario();
      if (alvo.dataset.editar) formulario(achar(alvo.dataset.editar));
      if (alvo.dataset.excluir) {
        const d = achar(alvo.dataset.excluir);
        excluirRegistro({ tipo: 'despesas', id: d.id, depois: carregar,
          resumo: `Despesa · ${formatarDataISO(d.data)} · ${d.categoria} · ${d.descricao} · ${formatarMoeda(d.valor)}` });
      }
      if (alvo.dataset.historico) {
        const d = achar(alvo.dataset.historico);
        abrirHistoricoRegistro('despesas', d.id, `Despesa: ${d.descricao}`);
      }
      if (alvo.dataset.pagar) {
        await api(`/despesas/${alvo.dataset.pagar}/pagamento`, { metodo: 'PUT', corpo: { pago: true } });
        toast('Despesa marcada como paga.');
        carregar();
      }
      if (alvo.dataset.despagar) {
        await api(`/despesas/${alvo.dataset.despagar}/pagamento`, { metodo: 'PUT', corpo: { pago: false } });
        toast('Despesa voltou para pendente.');
        carregar();
      }
      if (alvo.dataset.cancelar) {
        const d = achar(alvo.dataset.cancelar);
        if (!confirm(`Cancelar a despesa "${d.descricao}" (${formatarMoeda(d.valor)})? Ela sai dos totais.`)) return;
        await api(`/despesas/${d.id}`, { metodo: 'DELETE' });
        toast('Despesa cancelada.');
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };

  ['#mes-despesas', '#filtro-categoria', '#filtro-situacao-despesa', '#mostrar-canceladas-despesa']
    .forEach((s) => $(s).addEventListener('change', carregar));
  $('#busca-despesa').addEventListener('input', desenhar);

  try {
    await carregarOpcoes();
  } catch (erro) {
    toast(mensagemErro(erro), 'erro');
  }
  carregar();
}
