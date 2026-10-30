// =====================================================================
// Xylo - VIAGENS (main.html#viagens)
//
// Lançamento das cargas: cliente, nº, data, ticket, placa, floresta,
// empreiteiro, classe, peso líquido, valor da tonelada e valor total.
//
// PREÇOS: não são fixos. Cada viagem tem os seus valores por tonelada:
// venda ao cliente, compra da floresta e empreiteiro (se houver). O
// formulário sugere os valores da última viagem parecida (marcados como
// "sugestão") e mostra a venda, os custos e a sobra da carga antes de salvar.
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
          <th>Ticket / placa</th><th class="num">Peso (t)</th><th class="num">R$ / t<div class="sub">venda · compra</div></th><th class="num">Total</th><th></th>
        </tr></thead>
        <tbody>
          ${lista.map((v) => `
            <tr class="${v.status === 'Cancelada' ? 'inativo' : ''}">
              <td data-ordem="${esc(v.data)} ${String(v.hora_pesagem || '').padStart(5, '0')} ${String(v.numero_viagem).padStart(6, '0')}"><strong>Nº ${esc(v.numero_viagem)}</strong><div class="sub">${formatarDataISO(v.data)}${v.hora_pesagem ? ` · ${esc(v.hora_pesagem)}` : ''}</div></td>
              <td>${esc(v.cliente)}</td>
              <td>${esc(v.floresta)}<div class="sub">${esc(v.empreiteiro) || 'sem empreiteiro'}</div></td>
              <td>${esc(v.classe)}</td>
              <td>${esc(v.ticket) || '–'}${v.placa || v.motorista ? `<div class="sub">${[v.placa, v.motorista].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</td>
              <td class="num">${formatarPeso(v.peso_liquido)}</td>
              <td class="num">${formatarMoeda(v.valor_tonelada)}<div class="sub" title="Compra da floresta">${v.valor_ton_floresta !== null && v.valor_ton_floresta !== undefined ? `compra ${formatarMoeda(v.valor_ton_floresta)}` : '<span class="alerta">sem compra</span>'}</div></td>
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

  // Preços por tonelada da viagem (não são fixos: cada carga tem os seus)
  //   depende = de quem é o preço; a sugestão é o valor da última viagem com ele
  const PRECOS = [
    { nome: 'valor_tonelada', chave: 'venda', depende: 'cliente_id', rotulo: 'Venda ao cliente (R$/t)', quem: 'deste cliente',
      ajuda: 'Quanto o cliente paga por tonelada nesta carga' },
    { nome: 'valor_ton_floresta', chave: 'floresta', depende: 'floresta_id', rotulo: 'Compra da floresta (R$/t)', quem: 'desta floresta',
      ajuda: 'Quanto foi pago à floresta por tonelada (0 se a floresta é própria)' },
    { nome: 'valor_ton_empreiteiro', chave: 'empreiteiro', depende: 'empreiteiro_id', rotulo: 'Empreiteiro (R$/t)', quem: 'deste empreiteiro',
      ajuda: 'Quanto o empreiteiro recebe por tonelada nesta carga' },
  ];
  const valorCampo = (x) => (x !== null && x !== undefined && x !== '' ? Number(x).toFixed(2).replace('.', ',') : '');

  function formulario(v = {}, leitura = null) {
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
          <div class="campo"><label>Placa</label><input name="placa" maxlength="20" value="${esc(v.placa)}" placeholder="ABC1D23">
            <small id="aviso-placa" aria-live="polite">Pela placa o sistema escolhe o motorista.</small></div>
          ${campoMotorista(opcoes.motoristas || [], v.motorista_id, v.motorista, { podeCadastrar: PERFIL.podeEditar })}
          <div class="campo"><label>Horário da pesagem</label><input name="hora_pesagem" type="time" value="${esc(v.hora_pesagem)}"></div>
          <div class="campo"><label>Peso líquido (t) *</label><input name="peso_liquido" required inputmode="decimal" placeholder="Ex.: 46,79"
              value="${esc(pesoDigitado)}"></div>
        </div>
        <fieldset class="precos-viagem">
          <legend>Preços desta carga <small>(mudam de carga para carga)</small></legend>
          <div class="grade-campos">
            ${PRECOS.map((pr) => `
              <div class="campo" data-preco="${pr.chave}" ${pr.chave === 'empreiteiro' && !v.empreiteiro_id ? 'hidden' : ''}>
                <label for="preco-${pr.chave}">${pr.rotulo} *</label>
                <input id="preco-${pr.chave}" name="${pr.nome}" inputmode="decimal" required placeholder="Ex.: ${pr.chave === 'venda' ? '280,00' : pr.chave === 'floresta' ? '95,00' : '45,00'}"
                  value="${esc(valorCampo(v[pr.nome]))}">
                <small class="ajuda-preco">${pr.ajuda}</small>
              </div>`).join('')}
          </div>
        </fieldset>
        <div class="grade-campos"><div class="campo larga"><label>Observações</label><textarea name="observacoes" rows="2">${esc(v.observacoes)}</textarea></div></div>
        <div class="previa" id="previa-viagem" aria-live="polite">Informe o peso e os preços para ver os totais da carga.</div>
        ${RODAPE_FORMULARIO}
      </form>`);

    const form = $('#modal-corpo form');
    const campo = (n) => form.elements[n];
    const caixa = (pr) => form.querySelector(`[data-preco="${pr.chave}"]`);
    let sugestoes = {};
    let consulta = 0;

    // Destaca o que veio do ticket (verde) ou da última viagem da placa (roxo)
    if (leitura) marcarLidos(form, leitura, ['cliente_id', 'floresta_id', 'classe_id', 'motorista_id', 'peso_liquido', 'data']);

    const numero = (n) => { const x = lerNumero(campo(n).value); return Number.isFinite(x) ? x : null; };

    // ---- Placa <-> motorista: cada motorista dirige sempre o mesmo caminhão ----
    // O motorista pode ter trocado de caminhão: vale a placa que ele usava NA DATA da carga
    const placaDe = (txt) => String(txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const dataCarga = () => campo('data').value || hojeISO();
    const placasDo = (m) => (m.placas && m.placas.length ? m.placas : m.placa ? [{ placa: m.placa }] : []);
    const vale = (p, d) => (!p.desde || d >= p.desde) && (!p.ate || d <= p.ate);
    const placaNaData = (m, d) => (placasDo(m).find((p) => vale(p, d)) || {}).placa || null;
    const donoNaData = (placa, d) => (opcoes.motoristas || []).find((m) => placasDo(m).some((p) => p.placa === placa && vale(p, d)));
    const motoristaEscolhido = () => (opcoes.motoristas || []).find((m) => String(m.id) === campo('motorista_id').value);
    function conferirPlaca() {
      const placa = placaDe(campo('placa').value);
      const m = motoristaEscolhido();
      const doMotorista = m && placaNaData(m, dataCarga());
      const aviso = $('#aviso-placa');
      aviso.classList.remove('alerta');
      if (placa && doMotorista && placa !== doMotorista) {
        const dono = donoNaData(placa, dataCarga());
        aviso.textContent = dono
          ? `Nesta data a placa é de ${dono.funcionario || dono.nome}, não do motorista escolhido.`
          : `Nesta data o motorista escolhido usava a placa ${doMotorista}.`;
        aviso.classList.add('alerta');
      } else {
        aviso.textContent = 'Pela placa o sistema escolhe o motorista.';
      }
    }
    function escolherPelaPlaca() {
      const placa = placaDe(campo('placa').value);
      const dono = placa && donoNaData(placa, dataCarga());
      if (dono && String(dono.id) !== campo('motorista_id').value) {
        campo('motorista_id').value = String(dono.id);
        toast(`Motorista: ${dono.funcionario || dono.nome} (placa ${placa} nesta data).`);
      }
      conferirPlaca();
    }
    campo('placa').addEventListener('change', escolherPelaPlaca);
    campo('data').addEventListener('change', escolherPelaPlaca);
    campo('motorista_id').addEventListener('change', () => {
      const m = motoristaEscolhido();
      const p = m && placaNaData(m, dataCarga());
      if (p && !campo('placa').value.trim()) campo('placa').value = p;
      conferirPlaca();
    });
    conferirPlaca();

    function atualizarTotal() {
      const peso = numero('peso_liquido');
      const venda = numero('valor_tonelada');
      const floresta = numero('valor_ton_floresta');
      const temEmp = Boolean(campo('empreiteiro_id').value);
      const emp = temEmp ? numero('valor_ton_empreiteiro') : 0;
      const linhas = [];
      if (peso !== null && peso > 0) {
        if (venda !== null) linhas.push(`Venda da carga: <strong>${formatarMoeda(peso * venda)}</strong>`);
        if (floresta !== null) linhas.push(`floresta ${formatarMoeda(peso * floresta)}`);
        if (temEmp && emp !== null) linhas.push(`empreiteiro ${formatarMoeda(peso * emp)}`);
        if (venda !== null && floresta !== null && emp !== null) {
          const sobra = peso * (venda - floresta - emp);
          linhas.push(`<span class="${sobra < 0 ? 'alerta' : ''}">sobra <strong>${formatarMoeda(sobra)}</strong> (${formatarMoeda(venda - floresta - emp)}/t)</span>`);
        }
      }
      $('#previa-viagem').innerHTML = linhas.length ? linhas.join(' · ') : 'Informe o peso e os preços para ver os totais da carga.';
    }

    // ---- Sugestões: última viagem parecida -----------------------------
    function marcarSugestao(pr, u) {
      const c = caixa(pr);
      c.classList.add('campo-sugerido');
      campo(pr.nome).dataset.sugerido = '1';
      if (!c.querySelector('.etiqueta-origem')) {
        c.querySelector('label').insertAdjacentHTML('beforeend',
          `<span class="etiqueta-origem" title="Última viagem ${pr.quem}: nº ${esc(u.numero_viagem)}, ${formatarDataISO(u.data)}">sugestão</span>`);
      }
    }
    function tirarSugestao(pr) {
      const c = caixa(pr);
      c.classList.remove('campo-sugerido');
      c.querySelector('.etiqueta-origem')?.remove();
      delete campo(pr.nome).dataset.sugerido;
    }
    // Texto embaixo do campo: a última vez (com botão para usar)
    function ajuda(pr) {
      const u = sugestoes[pr.chave];
      const el = caixa(pr).querySelector('.ajuda-preco');
      if (!u) { el.textContent = pr.ajuda; return; }
      el.innerHTML = `Última ${pr.quem}${u.mesma_classe ? '' : ` (${esc(u.classe)})`}: `
        + `<button type="button" class="link-botao pequeno" data-usar-preco="${pr.chave}">${formatarMoeda(u.valor)}/t</button> em ${formatarDataISO(u.data)}`;
    }
    // Viagem nova (ou campo vazio): já preenche com a última da mesma classe, marcado como sugestão
    function aplicarSugestoes() {
      for (const pr of PRECOS) {
        const el = campo(pr.nome);
        const u = sugestoes[pr.chave];
        if (u && u.mesma_classe && (!el.value.trim() || el.dataset.sugerido)) {
          el.value = valorCampo(u.valor);
          marcarSugestao(pr, u);
        } else if (el.dataset.sugerido && !u) {
          el.value = '';
          tirarSugestao(pr);
        }
        ajuda(pr);
      }
      atualizarTotal();
    }
    async function buscarSugestoes() {
      const p = new URLSearchParams({
        cliente_id: campo('cliente_id').value, floresta_id: campo('floresta_id').value,
        empreiteiro_id: campo('empreiteiro_id').value, classe_id: campo('classe_id').value,
      });
      if (v.id) p.set('ignorar_id', v.id);
      const minha = ++consulta;
      try {
        const r = await api(`/viagens/sugestoes?${p}`);
        if (minha !== consulta) return;
        sugestoes = r;
      } catch {
        sugestoes = {};
      }
      aplicarSugestoes();
    }

    form.querySelector('.precos-viagem').addEventListener('click', (e) => {
      const b = e.target.closest('[data-usar-preco]');
      if (!b) return;
      const pr = PRECOS.find((x) => x.chave === b.dataset.usarPreco);
      campo(pr.nome).value = valorCampo(sugestoes[pr.chave].valor);
      tirarSugestao(pr);
      atualizarTotal();
      campo(pr.nome).focus();
    });
    PRECOS.forEach((pr) => campo(pr.nome).addEventListener('input', () => { tirarSugestao(pr); atualizarTotal(); }));

    // Trocou cliente/floresta/empreiteiro: o preço era de outro, então limpa e sugere de novo.
    // Trocou a classe: só os valores sugeridos são trocados (o digitado fica).
    PRECOS.forEach((pr) => campo(pr.depende).addEventListener('change', () => {
      campo(pr.nome).value = '';
      tirarSugestao(pr);
      buscarSugestoes();
    }));
    campo('classe_id').addEventListener('change', buscarSugestoes);
    campo('empreiteiro_id').addEventListener('change', () => {
      const emp = PRECOS[2];
      caixa(emp).hidden = !campo('empreiteiro_id').value;
      if (caixa(emp).hidden) campo(emp.nome).value = '';
      atualizarTotal();
    });
    campo('peso_liquido').addEventListener('input', atualizarTotal);
    buscarSugestoes();

    ligarFormulario(async (dados) => {
      if (!dados.empreiteiro_id) delete dados.valor_ton_empreiteiro;
      if (v.id) {
        await api(`/viagens/${v.id}`, { metodo: 'PUT', corpo: dados });
        toast('Viagem corrigida.');
      } else {
        const nova = await api('/viagens', { metodo: 'POST', corpo: dados });
        toast(`Viagem nº ${nova.numero_viagem} lançada: ${formatarMoeda(nova.valor_total)}.`);
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
          data: c.data || hojeISO(), ticket: c.ticket, placa: c.placa, motorista_id: c.motorista_id, hora_pesagem: c.hora_pesagem,
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
        if (!opcoes.clientes.length || !opcoes.florestas.length || !(opcoes.motoristas || []).length) {
          toast(!(opcoes.motoristas || []).length && opcoes.clientes.length && opcoes.florestas.length
            ? 'Cadastre antes pelo menos um motorista em Pessoal › Funcionários (marque "É motorista").'
            : 'Cadastre antes pelo menos um cliente, uma floresta e um motorista (em Funcionários).', 'erro');
          return;
        }
        formulario();
      }
      if (alvo.id === 'btn-ler-ticket') {
        if (!opcoes.clientes.length || !opcoes.florestas.length || !(opcoes.motoristas || []).length) {
          toast(!(opcoes.motoristas || []).length && opcoes.clientes.length && opcoes.florestas.length
            ? 'Cadastre antes pelo menos um motorista em Pessoal › Funcionários (marque "É motorista").'
            : 'Cadastre antes pelo menos um cliente, uma floresta e um motorista (em Funcionários).', 'erro');
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
