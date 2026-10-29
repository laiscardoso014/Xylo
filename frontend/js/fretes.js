// =====================================================================
// Xylo - FRETES (main.html#fretes)
//
// Transporte cobrado à parte (ex.: Buti/Balneário). Duas formas de cobrança:
//   por tonelada (toneladas x R$/t)  ou  valor fechado (um valor para a carga)
// Controle de recebimento: Pendente -> Pago (com data).
//
// LER TICKET: a foto do ticket de pesagem preenche data, toneladas (peso
// líquido) e cliente; destino e R$/t vêm do último frete do cliente; o nº do
// ticket, a placa e o motorista vão para as observações.
//
// Depende do comum.js, do api.js, do ticket.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

const FORMAS_PAGAMENTO = ['À vista', 'Cheque', 'Boleto', 'PIX', 'Outro'];
let mesFretes = mesAtualISO();

async function telaFretes() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Mês <input type="month" id="mes-fretes" value="${mesFretes}"></label>
      <label class="filtro-campo">Cliente <select id="filtro-cliente-frete"><option value="">Todos</option></select></label>
      <label class="filtro-campo">Situação
        <select id="filtro-situacao"><option value="">Todas</option><option>Pendente</option><option>Pago</option></select></label>
      <input type="search" class="busca" id="busca-frete" placeholder="Destino, nº da carga…">
      <label class="opcao"><input type="checkbox" id="mostrar-cancelados"> Cancelados</label>
      <span class="espaco"></span>
      ${PERFIL.podeEditar ? `
        <button type="button" class="btn btn-secundario" id="btn-ler-ticket-frete" title="Preencher o frete pela foto do ticket de pesagem"><i class="fas fa-camera"></i> Ler ticket</button>
        <button type="button" class="btn btn-primario" id="btn-novo-frete"><i class="fas fa-plus"></i> Novo frete</button>` : ''}
    </div>
    <div class="cartoes cartoes-mini" id="totais-fretes"></div>
    <div class="card sem-padding"><div id="lista-fretes" class="carregando">Carregando…</div></div>`;

  let fretes = [];
  let clientes = [];
  let motoristas = [];

  try {
    const op = await api('/viagens/opcoes');
    clientes = op.clientes;
    motoristas = op.motoristas || [];
    $('#filtro-cliente-frete').insertAdjacentHTML('beforeend',
      clientes.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join(''));
  } catch (erro) {
    toast(mensagemErro(erro), 'erro');
  }

  async function carregar() {
    mesFretes = $('#mes-fretes').value || mesAtualISO();
    const f = new URLSearchParams({ mes: mesFretes });
    if ($('#filtro-cliente-frete').value) f.set('cliente_id', $('#filtro-cliente-frete').value);
    if ($('#filtro-situacao').value) f.set('situacao', $('#filtro-situacao').value);
    if ($('#mostrar-cancelados').checked) f.set('cancelados', 'true');
    try {
      const r = await api(`/fretes?${f}`);
      if (!$('#lista-fretes')) return; // usuário já trocou de tela
      fretes = r.fretes;
      desenharTotais(r.totais);
      desenhar();
    } catch (erro) {
      $('#lista-fretes').className = 'aviso-erro';
      $('#lista-fretes').textContent = mensagemErro(erro);
    }
  }

  function desenharTotais(t) {
    const cartao = (icone, valor, texto) => `
      <div class="card cartao"><div class="cartao-icone"><i class="fas ${icone}"></i></div>
        <div><strong>${valor}</strong><span>${texto}</span></div></div>`;
    $('#totais-fretes').innerHTML =
      cartao('fa-truck-fast', t.fretes, 'fretes no mês')
      + cartao('fa-weight-hanging', `${formatarPeso(t.toneladas)} t`, 'toneladas')
      + cartao('fa-sack-dollar', formatarMoeda(t.valor_total), 'valor total')
      + cartao('fa-circle-check', formatarMoeda(t.recebido), 'recebido')
      + cartao('fa-hourglass-half', formatarMoeda(t.a_receber), 'a receber');
  }

  const selo = (s) => ({ Pago: 'selo-ativo', Pendente: 'selo-pendente', Cancelado: 'selo-inativo' }[s] || '');

  function desenhar() {
    const termo = $('#busca-frete').value.trim().toLowerCase();
    const lista = fretes.filter((f) => !termo
      || [f.destino, f.numero_carga, f.cliente, f.motorista, f.forma_pagamento, f.observacoes].some((x) => String(x || '').toLowerCase().includes(termo)));

    const box = $('#lista-fretes');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = fretes.length ? 'Nenhum frete encontrado na busca.' : 'Nenhum frete lançado neste mês.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela tabela-viagens">
        <thead><tr>
          <th>Carga</th><th>Cliente / destino</th><th class="num">Toneladas</th><th class="num">Cobrança</th>
          <th class="num">Total</th><th>Pagamento</th><th></th>
        </tr></thead>
        <tbody>
          ${lista.map((f) => `
            <tr class="${f.status_pagamento === 'Cancelado' ? 'inativo' : ''}">
              <td><strong>Nº ${esc(f.numero_carga)}</strong><div class="sub">${formatarDataISO(f.data)}</div></td>
              <td>${esc(f.cliente)}<div class="sub">${esc(f.destino) || 'sem destino'}${f.motorista ? ` · ${esc(f.motorista)}` : ''}</div></td>
              <td class="num">${formatarPeso(f.toneladas)}</td>
              <td class="num">${f.valor_fechado !== null ? 'valor fechado' : `${formatarMoeda(f.valor_tonelada)}/t`}</td>
              <td class="num"><strong>${formatarMoeda(f.valor_total)}</strong></td>
              <td><span class="selo ${selo(f.status_pagamento)}">${esc(f.status_pagamento)}</span>
                <div class="sub">${f.data_pagamento ? `em ${formatarDataISO(f.data_pagamento)}` : esc(f.forma_pagamento || '')}</div></td>
              <td class="acoes">
                ${PERFIL.podeEditar && f.status_pagamento === 'Pendente' ? `<button type="button" class="icone-botao" data-pagar="${f.id}" title="Marcar como pago"><i class="fas fa-circle-check"></i></button>` : ''}
                ${PERFIL.podeEditar && f.status_pagamento === 'Pago' ? `<button type="button" class="icone-botao" data-despagar="${f.id}" title="Voltar para pendente"><i class="fas fa-rotate-left"></i></button>` : ''}
                ${PERFIL.podeEditar && f.status_pagamento !== 'Cancelado' ? `<button type="button" class="icone-botao" data-editar="${f.id}" title="Corrigir"><i class="fas fa-pen"></i></button>` : ''}
                ${PERFIL.admin && f.status_pagamento !== 'Cancelado' ? `<button type="button" class="icone-botao perigo" data-cancelar="${f.id}" title="Cancelar frete (não aconteceu)"><i class="fas fa-ban"></i></button>` : ''}
                ${botaoHistorico(f, 'fretes')}${botaoExcluir(f, 'fretes')}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ---- Formulário ----------------------------------------------------
  const decimal = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));

  // leitura (opcional): resultado do "Ler ticket" -> painel e campos destacados
  function formulario(f = {}, leitura = null) {
    const fechado = f.id ? f.valor_fechado !== null : false;
    const pago = f.status_pagamento === 'Pago';
    const lista = f.cliente_id && !clientes.some((c) => c.id === f.cliente_id)
      ? [...clientes, { id: f.cliente_id, nome: `${f.cliente} (inativo)` }] : clientes;

    abrirModal(f.id ? `Corrigir frete nº ${f.numero_carga}` : leitura ? 'Novo frete pelo ticket' : 'Novo frete', `
      <form novalidate>
        ${leitura ? painelLeitura(leitura) : ''}
        <div class="grade-campos">
          <div class="campo"><label>Data *</label><input name="data" type="date" required value="${f.data || hojeISO()}"></div>
          <div class="campo"><label>Nº da carga</label><input name="numero_carga" maxlength="20" value="${esc(f.numero_carga)}" placeholder="Automático"></div>
          <div class="campo"><label>Cliente (quem paga) *</label>
            <select name="cliente_id" required><option value="">Selecione…</option>
              ${lista.map((c) => `<option value="${c.id}" ${c.id === f.cliente_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Destino</label><input name="destino" maxlength="100" value="${esc(f.destino)}" placeholder="Ex.: Balneário"></div>
          <div class="campo"><label>Motorista</label><input name="motorista" maxlength="150" list="lista-motoristas-frete" autocomplete="off" value="${esc(f.motorista)}">
            <datalist id="lista-motoristas-frete">${motoristas.map((m) => `<option value="${esc(m.nome)}">`).join('')}</datalist>
            <small>Conta na comissão dele (folha de pagamento)</small></div>
          <div class="campo"><label>Toneladas *</label><input name="toneladas" required inputmode="decimal" value="${decimal(f.toneladas)}" placeholder="Ex.: 46,57"></div>
          <div class="campo"><label>Cobrança *</label>
            <select name="cobranca">
              <option value="tonelada" ${fechado ? '' : 'selected'}>Por tonelada</option>
              <option value="fechado" ${fechado ? 'selected' : ''}>Valor fechado</option>
            </select></div>
          <div class="campo" data-cobranca="tonelada"><label>Valor da tonelada (R$) *</label>
            <input name="valor_tonelada" inputmode="decimal" value="${decimal(f.valor_tonelada)}" placeholder="Ex.: 120,00"></div>
          <div class="campo" data-cobranca="fechado"><label>Valor fechado (R$) *</label>
            <input name="valor_fechado" inputmode="decimal" value="${decimal(f.valor_fechado)}" placeholder="Ex.: 8.635,00"></div>
          <div class="campo"><label>Forma de pagamento</label>
            <select name="forma_pagamento"><option value="">Não informada</option>
              ${FORMAS_PAGAMENTO.map((x) => `<option ${x === f.forma_pagamento ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="campo"><label>Situação</label>
            <select name="status_pagamento">
              <option ${pago ? '' : 'selected'}>Pendente</option><option ${pago ? 'selected' : ''}>Pago</option>
            </select></div>
          <div class="campo" id="campo-data-pagamento"><label>Pago em</label>
            <input name="data_pagamento" type="date" value="${f.data_pagamento || hojeISO()}"></div>
          <div class="campo larga"><label>Observações</label><textarea name="observacoes" rows="2" placeholder="Ex.: frete pago pelo Jair PH">${esc(f.observacoes)}</textarea></div>
        </div>
        <div class="previa" id="previa-frete" aria-live="polite"></div>
        ${RODAPE_FORMULARIO}
      </form>`);

    const form = $('#modal-corpo form');
    const campo = (n) => form.elements[n];

    // Mostra só o campo de valor da forma de cobrança escolhida, e a data só se estiver pago
    function ajustar() {
      const cobranca = campo('cobranca').value;
      form.querySelectorAll('[data-cobranca]').forEach((el) => { el.hidden = el.dataset.cobranca !== cobranca; });
      $('#campo-data-pagamento').hidden = campo('status_pagamento').value !== 'Pago';

      const ton = lerNumero(campo('toneladas').value);
      const total = cobranca === 'fechado'
        ? lerNumero(campo('valor_fechado').value)
        : ton * lerNumero(campo('valor_tonelada').value);
      $('#previa-frete').innerHTML = Number.isFinite(total)
        ? `Total do frete: <strong>${formatarMoeda(total)}</strong>${cobranca === 'fechado' && Number.isFinite(ton) && ton > 0 ? ` · equivale a ${formatarMoeda(total / ton)}/t` : ''}`
        : 'Preencha as toneladas e o valor para ver o total.';
    }
    form.addEventListener('input', ajustar);
    form.addEventListener('change', ajustar);
    ajustar();
    if (leitura) marcarLidos(form, leitura, ['cliente_id', 'toneladas', 'valor_tonelada', 'data']);

    ligarFormulario(async (dados) => {
      if (f.id) {
        await api(`/fretes/${f.id}`, { metodo: 'PUT', corpo: dados });
        toast('Frete corrigido.');
      } else {
        const novo = await api('/fretes', { metodo: 'POST', corpo: dados });
        toast(`Frete nº ${novo.numero_carga} lançado: ${formatarMoeda(novo.valor_total)}.`);
        if (novo.data.slice(0, 7) !== mesFretes) $('#mes-fretes').value = novo.data.slice(0, 7);
      }
      carregar();
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const achar = (id) => fretes.find((f) => f.id === Number(id));
    try {
      if (alvo.id === 'btn-novo-frete') {
        if (!clientes.length) { toast('Cadastre antes pelo menos um cliente.', 'erro'); return; }
        formulario();
      }
      if (alvo.id === 'btn-ler-ticket-frete') {
        if (!clientes.length) { toast('Cadastre antes pelo menos um cliente.', 'erro'); return; }
        await abrirLeituraTicket({
          para: 'fretes',
          aoLer: (resultado, foto) => {
            const c = resultado.campos;
            formulario({
              data: c.data || hojeISO(), cliente_id: c.cliente_id, destino: c.destino, toneladas: c.toneladas,
              valor_tonelada: c.valor_tonelada, valor_fechado: null, observacoes: c.observacoes, motorista: c.motorista,
            }, { resultado, foto });
          },
        });
      }
      if (alvo.dataset.editar) formulario(achar(alvo.dataset.editar));
      if (alvo.dataset.excluir) {
        const f = achar(alvo.dataset.excluir);
        excluirRegistro({ tipo: 'fretes', id: f.id, depois: carregar,
          resumo: `Frete nº ${f.numero_carga} · ${formatarDataISO(f.data)} · ${f.cliente} · ${formatarMoeda(f.valor_total)}` });
      }
      if (alvo.dataset.historico) {
        const f = achar(alvo.dataset.historico);
        abrirHistoricoRegistro('fretes', f.id, `Frete nº ${f.numero_carga} (${f.cliente})`);
      }
      if (alvo.dataset.pagar) {
        await api(`/fretes/${alvo.dataset.pagar}/pagamento`, { metodo: 'PUT', corpo: { pago: true } });
        toast('Frete marcado como pago.');
        carregar();
      }
      if (alvo.dataset.despagar) {
        await api(`/fretes/${alvo.dataset.despagar}/pagamento`, { metodo: 'PUT', corpo: { pago: false } });
        toast('Frete voltou para pendente.');
        carregar();
      }
      if (alvo.dataset.cancelar) {
        const f = achar(alvo.dataset.cancelar);
        if (!confirm(`Cancelar o frete nº ${f.numero_carga} (${f.cliente}, ${formatarMoeda(f.valor_total)})? Ele sai dos totais.`)) return;
        await api(`/fretes/${f.id}`, { metodo: 'DELETE' });
        toast('Frete cancelado.');
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };

  ['#mes-fretes', '#filtro-cliente-frete', '#filtro-situacao', '#mostrar-cancelados']
    .forEach((s) => $(s).addEventListener('change', carregar));
  $('#busca-frete').addEventListener('input', desenhar);
  carregar();
}
