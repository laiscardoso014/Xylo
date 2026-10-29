// =====================================================================
// Xylo - VIAGENS (main.html#viagens)
//
// Lançamento das cargas: cliente, nº, data, ticket, placa, floresta,
// empreiteiro, classe, peso líquido, valor da tonelada e valor total.
//
// O valor da tonelada vem da Tabela de Preços (dá para digitar outro, se
// precisar). O formulário mostra a prévia do preço e do total antes de
// salvar. Os valores de floresta e empreiteiro também vêm da tabela.
//
// LER TICKET: foto (ou texto colado) do ticket de pesagem -> o servidor
// extrai só os campos da planilha (ticket, data, horário, placa, motorista,
// peso líquido; floresta/empreiteiro/cliente/classe quando der) e abre a
// Nova viagem já preenchida, com os campos lidos destacados para conferir.
//
// Depende do comum.js, do api.js, do ticket.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

let mesViagens = mesAtualISO();

async function telaViagens() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Mês <input type="month" id="mes-viagens" value="${mesViagens}"></label>
      <label class="filtro-campo">Cliente <select id="filtro-cliente"><option value="">Todos</option></select></label>
      <input type="search" class="busca" id="busca-viagem" placeholder="Ticket, placa, floresta…">
      <label class="opcao"><input type="checkbox" id="mostrar-canceladas"> Canceladas</label>
      <span class="espaco"></span>
      ${PERFIL.podeEditar ? `
        <button type="button" class="btn btn-secundario" id="btn-ler-ticket" title="Preencher a viagem pela foto do ticket de pesagem"><i class="fas fa-camera"></i> Ler ticket</button>
        <button type="button" class="btn btn-primario" id="btn-nova-viagem"><i class="fas fa-plus"></i> Nova viagem</button>` : ''}
    </div>
    <div class="cartoes cartoes-mini" id="totais-viagens"></div>
    <div class="card sem-padding"><div id="lista-viagens" class="carregando">Carregando…</div></div>`;

  let viagens = [];
  let opcoes = { clientes: [], florestas: [], empreiteiros: [], classes: [], motoristas: [] };

  // Opções dos selects (clientes, florestas, empreiteiros e classes ativos)
  try {
    opcoes = await api('/viagens/opcoes');
    $('#filtro-cliente').insertAdjacentHTML('beforeend',
      opcoes.clientes.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join(''));
  } catch (erro) {
    toast(mensagemErro(erro), 'erro');
  }

  async function carregar() {
    mesViagens = $('#mes-viagens').value || mesAtualISO();
    const filtros = new URLSearchParams({ mes: mesViagens });
    if ($('#filtro-cliente').value) filtros.set('cliente_id', $('#filtro-cliente').value);
    if ($('#mostrar-canceladas').checked) filtros.set('canceladas', 'true');
    try {
      const r = await api(`/viagens?${filtros}`);
      if (!$('#lista-viagens')) return; // usuário já trocou de tela
      viagens = r.viagens;
      desenharTotais(r.totais);
      desenhar();
    } catch (erro) {
      $('#lista-viagens').className = 'aviso-erro';
      $('#lista-viagens').textContent = mensagemErro(erro);
    }
  }

  function desenharTotais(t) {
    const cartao = (icone, valor, texto) => `
      <div class="card cartao"><div class="cartao-icone"><i class="fas ${icone}"></i></div>
        <div><strong>${valor}</strong><span>${texto}</span></div></div>`;
    $('#totais-viagens').innerHTML =
      cartao('fa-truck', t.viagens, 'viagens no mês')
      + cartao('fa-weight-hanging', `${formatarPeso(t.toneladas)} t`, 'toneladas')
      + cartao('fa-sack-dollar', formatarMoeda(t.valor_total), 'valor total (venda)')
      + cartao('fa-tree', formatarMoeda(t.custo_floresta), 'a pagar às florestas')
      + cartao('fa-helmet-safety', formatarMoeda(t.custo_empreiteiro), 'a pagar aos empreiteiros');
  }

  function desenhar() {
    const termo = $('#busca-viagem').value.trim().toLowerCase();
    const lista = viagens.filter((v) => !termo
      || [v.ticket, v.placa, v.motorista, v.floresta, v.empreiteiro, v.cliente, v.classe, v.numero_viagem]
        .some((x) => String(x || '').toLowerCase().includes(termo)));

    const box = $('#lista-viagens');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = viagens.length ? 'Nenhuma viagem encontrada na busca.' : 'Nenhuma viagem lançada neste mês.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela tabela-viagens">
        <thead><tr>
          <th>Viagem</th><th>Cliente</th><th>Floresta / empreiteiro</th><th>Classe</th>
          <th>Ticket / placa</th><th class="num">Peso (t)</th><th class="num">R$ / t</th><th class="num">Total</th><th></th>
        </tr></thead>
        <tbody>
          ${lista.map((v) => `
            <tr class="${v.status === 'Cancelada' ? 'inativo' : ''}">
              <td><strong>Nº ${esc(v.numero_viagem)}</strong><div class="sub">${formatarDataISO(v.data)}${v.hora_pesagem ? ` · ${esc(v.hora_pesagem)}` : ''}</div></td>
              <td>${esc(v.cliente)}</td>
              <td>${esc(v.floresta)}<div class="sub">${esc(v.empreiteiro) || 'sem empreiteiro'}</div></td>
              <td>${esc(v.classe)}</td>
              <td>${esc(v.ticket) || '–'}${v.placa || v.motorista ? `<div class="sub">${[v.placa, v.motorista].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</td>
              <td class="num">${formatarPeso(v.peso_liquido)}</td>
              <td class="num">${formatarMoeda(v.valor_tonelada)}</td>
              <td class="num"><strong>${formatarMoeda(v.valor_total)}</strong>
                ${v.status === 'Cancelada' ? '<div class="sub">Cancelada</div>' : ''}</td>
              <td class="acoes">
                ${PERFIL.podeEditar && v.status !== 'Cancelada' ? `<button type="button" class="icone-botao" data-editar="${v.id}" title="Corrigir"><i class="fas fa-pen"></i></button>` : ''}
                ${PERFIL.admin && v.status !== 'Cancelada' ? `<button type="button" class="icone-botao perigo" data-cancelar="${v.id}" title="Cancelar viagem (a carga não aconteceu)"><i class="fas fa-ban"></i></button>` : ''}
                ${botaoHistorico(v, 'viagens')}${botaoExcluir(v, 'viagens')}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ---- Formulário de nova viagem / correção -----------------------------
  function select(nome, rotulo, itens, valor, obrigatorio = true, vazio = 'Selecione…') {
    return `<div class="campo"><label>${rotulo}${obrigatorio ? ' *' : ''}</label>
      <select name="${nome}" ${obrigatorio ? 'required' : ''}>
        <option value="">${vazio}</option>
        ${itens.map((i) => `<option value="${i.id}" ${Number(valor) === i.id ? 'selected' : ''}>${esc(i.nome)}</option>`).join('')}
      </select></div>`;
  }

  // Garante que um cadastro desativado continue aparecendo ao corrigir uma viagem antiga
  const comAtual = (lista, id, nome) => (id && !lista.some((i) => i.id === id) ? [...lista, { id, nome: `${nome} (inativo)` }] : lista);

  function formulario(v = {}, leitura = null) {
    const valorDigitado = v.id ? Number(v.valor_tonelada).toFixed(2).replace('.', ',') : '';
    const pesoDigitado = v.peso_liquido !== undefined && v.peso_liquido !== null ? String(v.peso_liquido).replace('.', ',') : '';
    abrirModal(v.id ? `Corrigir viagem nº ${v.numero_viagem}` : leitura ? 'Nova viagem pelo ticket' : 'Nova viagem', `
      <form novalidate>
        ${leitura ? painelLeitura(leitura) : ''}
        <div class="grade-campos">
          <div class="campo"><label>Data *</label><input name="data" type="date" required value="${v.data || hojeISO()}"></div>
          <div class="campo"><label>Nº da viagem</label><input name="numero_viagem" maxlength="20" value="${esc(v.numero_viagem)}" placeholder="Automático"></div>
          ${select('cliente_id', 'Cliente', comAtual(opcoes.clientes, v.cliente_id, v.cliente), v.cliente_id)}
          ${select('floresta_id', 'Floresta', comAtual(opcoes.florestas, v.floresta_id, v.floresta), v.floresta_id)}
          ${select('empreiteiro_id', 'Empreiteiro', comAtual(opcoes.empreiteiros, v.empreiteiro_id, v.empreiteiro), v.empreiteiro_id, false, 'Sem empreiteiro')}
          ${select('classe_id', 'Classe', opcoes.classes, v.classe_id)}
          <div class="campo"><label>Ticket</label><input name="ticket" maxlength="30" value="${esc(v.ticket)}"></div>
          <div class="campo"><label>Placa</label><input name="placa" maxlength="20" value="${esc(v.placa)}" placeholder="ABC1D23"></div>
          <div class="campo"><label>Motorista</label><input name="motorista" maxlength="150" list="lista-motoristas" autocomplete="off" value="${esc(v.motorista)}">
            <datalist id="lista-motoristas">${(opcoes.motoristas || []).map((m) => `<option value="${esc(m.nome)}">`).join('')}</datalist></div>
          <div class="campo"><label>Horário da pesagem</label><input name="hora_pesagem" type="time" value="${esc(v.hora_pesagem)}"></div>
          <div class="campo"><label>Peso líquido (t) *</label><input name="peso_liquido" required inputmode="decimal" placeholder="Ex.: 46,79"
              value="${esc(pesoDigitado)}"></div>
          <div class="campo"><label>Valor da tonelada (R$)</label><input name="valor_tonelada" inputmode="decimal" value="${valorDigitado}" placeholder="Da tabela de preços">
            <small>Em branco: usa a tabela de preços</small></div>
          <div class="campo larga"><label>Observações</label><textarea name="observacoes" rows="2">${esc(v.observacoes)}</textarea></div>
        </div>
        <div class="previa" id="previa-viagem" aria-live="polite">Escolha cliente, floresta, classe e data para ver o preço.</div>
        ${RODAPE_FORMULARIO}
      </form>`);

    const form = $('#modal-corpo form');
    const campo = (n) => form.elements[n];
    let precoTabela = null;

    // Destaca o que veio do ticket (verde) ou da última viagem da placa (roxo)
    if (leitura) marcarLidos(form, leitura, ['cliente_id', 'floresta_id', 'classe_id', 'peso_liquido', 'data']);
    let consulta = 0;

    function atualizarTotal() {
      const peso = lerNumero(campo('peso_liquido').value);
      const digitado = lerNumero(campo('valor_tonelada').value);
      const valor = Number.isFinite(digitado) ? digitado : precoTabela && Number(precoTabela.venda);
      const linhas = [];
      if (precoTabela) {
        linhas.push(precoTabela.venda !== null
          ? `Tabela de preços: <strong>${formatarMoeda(precoTabela.venda)}/t</strong>`
          : '<span class="alerta">Sem preço de venda cadastrado para este cliente e classe nessa data: informe o valor da tonelada.</span>');
        if (precoTabela.compra !== null) linhas.push(`floresta ${formatarMoeda(precoTabela.compra)}/t`);
        if (precoTabela.empreitada !== null) linhas.push(`empreiteiro ${formatarMoeda(precoTabela.empreitada)}/t`);
      }
      if (Number.isFinite(peso) && Number.isFinite(valor) && valor !== null) {
        linhas.push(`Total da carga: <strong>${formatarMoeda(peso * valor)}</strong>`);
      }
      $('#previa-viagem').innerHTML = linhas.length ? linhas.join(' · ') : 'Escolha cliente, floresta, classe e data para ver o preço.';
    }

    async function buscarPreco() {
      const p = new URLSearchParams({
        cliente_id: campo('cliente_id').value, floresta_id: campo('floresta_id').value,
        empreiteiro_id: campo('empreiteiro_id').value, classe_id: campo('classe_id').value, data: campo('data').value,
      });
      if (!p.get('classe_id') || !p.get('data') || !p.get('cliente_id')) { precoTabela = null; atualizarTotal(); return; }
      const minha = ++consulta;
      try {
        const r = await api(`/viagens/preco?${p}`);
        if (minha === consulta) { precoTabela = r; atualizarTotal(); }
      } catch {
        precoTabela = null; atualizarTotal();
      }
    }

    ['cliente_id', 'floresta_id', 'empreiteiro_id', 'classe_id', 'data'].forEach((n) => campo(n).addEventListener('change', buscarPreco));

    // Corrigindo uma viagem: se mudar cliente, classe ou data, o preço antigo não vale mais,
    // então o campo é limpo e a tabela de preços volta a definir o valor.
    if (v.id) {
      ['cliente_id', 'classe_id', 'data'].forEach((n) => campo(n).addEventListener('change', () => {
        campo('valor_tonelada').value = '';
        atualizarTotal();
      }));
    }
    ['peso_liquido', 'valor_tonelada'].forEach((n) => campo(n).addEventListener('input', atualizarTotal));
    buscarPreco();

    ligarFormulario(async (dados) => {
      if (v.id) {
        await api(`/viagens/${v.id}`, { metodo: 'PUT', corpo: dados });
        toast('Viagem corrigida.');
      } else {
        const nova = await api('/viagens', { metodo: 'POST', corpo: dados });
        toast(`Viagem nº ${nova.numero_viagem} lançada: ${formatarMoeda(nova.valor_total)}.`);
        if (dados.motorista && !(opcoes.motoristas || []).some((m) => m.nome.toLowerCase() === dados.motorista.trim().toLowerCase())) {
          opcoes.motoristas = [...(opcoes.motoristas || []), { nome: dados.motorista.trim() }];
        }
        // O mês da tela acompanha a data lançada
        if (nova.data.slice(0, 7) !== mesViagens) $('#mes-viagens').value = nova.data.slice(0, 7);
      }
      carregar();
    });
  }

  // ---- Ler ticket de pesagem (js/ticket.js) ---------------------------
  function lerTicket() {
    return abrirLeituraTicket({
      para: 'viagens',
      aoLer: (resultado, foto) => {
        const c = resultado.campos;
        formulario({
          data: c.data || hojeISO(), ticket: c.ticket, placa: c.placa, motorista: c.motorista, hora_pesagem: c.hora_pesagem,
          peso_liquido: c.peso_liquido, cliente_id: c.cliente_id, floresta_id: c.floresta_id,
          empreiteiro_id: c.empreiteiro_id, classe_id: c.classe_id,
        }, { resultado, foto });
      },
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const achar = (id) => viagens.find((v) => v.id === Number(id));
    try {
      if (alvo.id === 'btn-nova-viagem') {
        if (!opcoes.clientes.length || !opcoes.florestas.length) {
          toast('Cadastre antes pelo menos um cliente e uma floresta.', 'erro');
          return;
        }
        formulario();
      }
      if (alvo.id === 'btn-ler-ticket') {
        if (!opcoes.clientes.length || !opcoes.florestas.length) {
          toast('Cadastre antes pelo menos um cliente e uma floresta.', 'erro');
          return;
        }
        await lerTicket();
      }
      if (alvo.dataset.editar) formulario(achar(alvo.dataset.editar));
      if (alvo.dataset.excluir) {
        const v = achar(alvo.dataset.excluir);
        excluirRegistro({ tipo: 'viagens', id: v.id, depois: carregar,
          resumo: `Viagem nº ${v.numero_viagem} · ${formatarDataISO(v.data)} · ${v.cliente} · ${formatarPeso(v.peso_liquido)} t${v.ticket ? ` · ticket ${v.ticket}` : ''}` });
      }
      if (alvo.dataset.historico) {
        const v = achar(alvo.dataset.historico);
        abrirHistoricoRegistro('viagens', v.id, `Viagem nº ${v.numero_viagem} (${v.cliente})`);
      }
      if (alvo.dataset.cancelar) {
        const v = achar(alvo.dataset.cancelar);
        if (!confirm(`Cancelar a viagem nº ${v.numero_viagem} (${v.cliente}, ${formatarPeso(v.peso_liquido)} t)? Ela sai dos totais e o ticket fica livre.`)) return;
        await api(`/viagens/${v.id}`, { metodo: 'DELETE' });
        toast('Viagem cancelada.');
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };

  $('#mes-viagens').addEventListener('change', carregar);
  $('#filtro-cliente').addEventListener('change', carregar);
  $('#mostrar-canceladas').addEventListener('change', carregar);
  $('#busca-viagem').addEventListener('input', desenhar);
  carregar();
}
