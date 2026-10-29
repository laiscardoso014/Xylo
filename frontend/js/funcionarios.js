// =====================================================================
// Xylo - FUNCIONÁRIOS (main.html#funcionarios) - Administrador e Financeiro
//
// Cadastro para a folha: cargo, admissão, salário base, alimentação.
// MOTORISTA: liga o funcionário ao nome que aparece nas viagens/fretes e
// define as FAIXAS DE COMISSÃO dele (cada motorista tem as suas):
//   até 50 km -> R$ 1,20/t · até 100 km -> R$ 1,50/t · acima -> R$ 2,00/t
//
// Depende do comum.js, do api.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

const CARGOS = ['Motorista', 'Operacional', 'Admin', 'Mecânico', 'Tratorista', 'Operador de máquina', 'Ajudante'];

function resumoFaixas(faixas) {
  if (!faixas || !faixas.length) return '';
  return faixas.map((f) => `${f.texto}: ${formatarMoeda(f.valor_tonelada)}/t`).join(' · ');
}

async function telaFuncionarios() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <input type="search" class="busca" id="busca-func" placeholder="Nome, cargo ou motorista…">
      <label class="opcao"><input type="checkbox" id="mostrar-inativos-func"> Inativos</label>
      <span class="espaco"></span>
      <a class="btn btn-secundario" href="#rotas"><i class="fas fa-map-signs"></i> Rotas e distâncias</a>
      <button type="button" class="btn btn-primario" id="btn-novo-func"><i class="fas fa-plus"></i> Novo funcionário</button>
    </div>
    <div id="motoristas-livres"></div>
    <div class="card sem-padding"><div id="lista-func" class="carregando">Carregando…</div></div>`;

  let funcionarios = [];
  let livres = [];
  let motoristas = [];

  async function carregar() {
    try {
      const [r, op] = await Promise.all([
        api(`/funcionarios?inativos=${$('#mostrar-inativos-func').checked}`),
        api('/viagens/opcoes'),
      ]);
      if (!$('#lista-func')) return;
      funcionarios = r.funcionarios;
      livres = r.motoristas_livres;
      motoristas = op.motoristas_nomes || op.motoristas || [];
      desenhar();
    } catch (erro) {
      $('#lista-func').className = 'aviso-erro';
      $('#lista-func').textContent = mensagemErro(erro);
    }
  }

  function desenhar() {
    $('#motoristas-livres').innerHTML = livres.length ? `
      <div class="nota-tela"><i class="fas fa-id-card" aria-hidden="true"></i>
        <span>Motoristas que aparecem nas cargas e ainda não são funcionários (sem cadastro, não recebem comissão pela folha):
        ${livres.map((m) => `<button type="button" class="chip-acao" data-cadastrar-motorista="${esc(m.nome)}">${esc(m.nome)} <small>${m.cargas} carga${m.cargas === 1 ? '' : 's'}</small></button>`).join(' ')}</span>
      </div>` : '';

    const termo = $('#busca-func').value.trim().toLowerCase();
    const lista = funcionarios.filter((f) => !termo || [f.nome, f.cargo, f.motorista].some((x) => String(x || '').toLowerCase().includes(termo)));
    const box = $('#lista-func');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = funcionarios.length ? 'Nenhum funcionário encontrado na busca.' : 'Nenhum funcionário cadastrado ainda. Comece pelos motoristas acima.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela">
        <thead><tr><th>Funcionário</th><th>Admissão</th><th class="num">Salário base</th><th class="num">Alimentação</th><th>Comissão</th><th></th></tr></thead>
        <tbody>${lista.map((f) => `
          <tr class="${f.ativo ? '' : 'inativo'}">
            <td><strong>${esc(f.nome)}</strong><div class="sub">${esc(f.cargo)}${f.ativo ? '' : ' · inativo'}</div></td>
            <td>${f.data_admissao ? formatarDataISO(f.data_admissao) : '–'}</td>
            <td class="num">${formatarMoeda(f.salario_base)}</td>
            <td class="num">${Number(f.alimentacao) ? formatarMoeda(f.alimentacao) : '–'}</td>
            <td>${f.motorista
              ? `<span class="selo selo-ativo"><i class="fas fa-truck" aria-hidden="true"></i> ${esc(f.motorista)}</span>
                 <div class="sub">${f.faixas.length ? esc(resumoFaixas(f.faixas)) : '<span class="alerta">sem faixas de comissão</span>'}</div>`
              : '<span class="sub">não é motorista</span>'}</td>
            <td class="acoes">
              <button type="button" class="icone-botao" data-editar="${f.id}" title="Editar"><i class="fas fa-pen"></i></button>
              ${PERFIL.admin && f.ativo ? `<button type="button" class="icone-botao perigo" data-desativar="${f.id}" title="Desativar"><i class="fas fa-user-slash"></i></button>` : ''}
              ${PERFIL.admin && !f.ativo ? `<button type="button" class="icone-botao" data-reativar="${f.id}" title="Reativar"><i class="fas fa-user-check"></i></button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  // ---- Formulário ----------------------------------------------------
  const decimal = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const kmTexto = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));

  function linhaFaixa(f = {}) {
    return `<div class="faixa-linha">
      <label>Até <input name="km_ate" inputmode="decimal" value="${esc(kmTexto(f.km_ate))}" placeholder="acima" aria-label="Até quantos km"> km</label>
      <label>R$ <input name="valor_tonelada" inputmode="decimal" value="${esc(decimal(f.valor_tonelada))}" placeholder="1,50" aria-label="Reais por tonelada"> por tonelada</label>
      <button type="button" class="icone-botao perigo" data-remover-faixa title="Remover faixa"><i class="fas fa-xmark"></i></button>
    </div>`;
  }

  function formulario(f = {}) {
    const motorista = !!(f.motorista || f.cargo === 'Motorista' || (!f.id && f.motorista !== undefined));
    abrirModal(f.id ? `Editar ${f.nome}` : 'Novo funcionário', `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo"><label>Nome *</label><input name="nome" required maxlength="150" value="${esc(f.nome)}"></div>
          <div class="campo"><label>Cargo *</label><input name="cargo" required maxlength="100" list="lista-cargos" value="${esc(f.cargo || (motorista ? 'Motorista' : ''))}">
            <datalist id="lista-cargos">${CARGOS.map((c) => `<option value="${c}">`).join('')}</datalist></div>
          <div class="campo"><label>Admissão</label><input name="data_admissao" type="date" value="${esc(f.data_admissao)}"></div>
          <div class="campo"><label>CPF</label><input name="cpf" value="${esc(f.cpf ? formatarDocumento(f.cpf) : '')}"></div>
          <div class="campo"><label>Salário base (R$)</label><input name="salario_base" inputmode="decimal" value="${esc(decimal(f.salario_base))}" placeholder="Ex.: 3.000,00"></div>
          <div class="campo"><label>Alimentação por mês (R$)</label><input name="alimentacao" inputmode="decimal" value="${esc(decimal(f.alimentacao))}" placeholder="Ex.: 500,00">
            <small>Entra sozinha na folha de cada mês (dá para mudar no mês)</small></div>
          <div class="campo"><label>Telefone</label><input name="telefone" type="tel" value="${esc(f.telefone ? formatarTelefone(f.telefone) : '')}"></div>
          <div class="campo larga"><label>Observações</label><textarea name="observacoes" rows="2">${esc(f.observacoes)}</textarea></div>
        </div>
        <fieldset class="bloco-comissao">
          <legend><label class="opcao"><input type="checkbox" id="eh-motorista" ${motorista ? 'checked' : ''}> É motorista (recebe comissão por carga)</label></legend>
          <div id="campos-motorista" ${motorista ? '' : 'hidden'}>
            <div class="campo"><label>Nome do motorista nas cargas e no ticket</label>
              <input name="motorista" list="lista-motoristas-func" autocomplete="off" value="${esc(f.motorista)}" placeholder="Apelido, se usar (ex.: POPO). Vazio = o nome dele">
              <datalist id="lista-motoristas-func">${motoristas.map((m) => `<option value="${esc(m.nome)}">`).join('')}</datalist>
              <small>Só motoristas cadastrados aqui podem ser escolhidos nas viagens e nos fretes. A folha encontra as cargas dele por este nome.</small></div>
            <p class="rotulo-faixas">Comissão por tonelada, conforme a distância da rota
              ${funcionarios.some((x) => x.id !== f.id && x.faixas.length) ? `<select id="copiar-faixas" aria-label="Copiar faixas de outro motorista"><option value="">Copiar faixas de…</option>
                ${funcionarios.filter((x) => x.id !== f.id && x.faixas.length).map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select>` : ''}</p>
            <div id="faixas">${(f.faixas && f.faixas.length ? f.faixas : [{ km_ate: 50 }, { km_ate: 100 }, { km_ate: null }]).map(linhaFaixa).join('')}</div>
            <button type="button" class="link-botao pequeno" id="mais-faixa"><i class="fas fa-plus"></i> Adicionar faixa</button>
            <p class="nota">Deixe o "até" vazio na última faixa: vale para qualquer distância acima. A distância de cada carga vem de
              <a href="#rotas">Rotas e distâncias</a>.</p>
          </div>
        </fieldset>
        ${RODAPE_FORMULARIO}
      </form>`);
    const form = $('#modal-corpo form');
    aplicarMascara(form.elements.cpf, { max: 11, formatar: montarDocumento, problema: problemaDocumento });
    mascaraTelefone(form.elements.telefone);
    $('#eh-motorista').addEventListener('change', (e) => {
      $('#campos-motorista').hidden = !e.target.checked;
      if (e.target.checked && !form.elements.cargo.value) form.elements.cargo.value = 'Motorista';
    });
    $('#mais-faixa').addEventListener('click', () => {
      $('#faixas').insertAdjacentHTML('beforeend', linhaFaixa());
      $('#faixas .faixa-linha:last-child input').focus();
    });
    $('#faixas').addEventListener('click', (e) => { if (e.target.closest('[data-remover-faixa]')) e.target.closest('.faixa-linha').remove(); });
    const copiar = $('#copiar-faixas');
    if (copiar) {
      copiar.addEventListener('change', () => {
        const origem = funcionarios.find((x) => x.id === Number(copiar.value));
        if (origem) $('#faixas').innerHTML = origem.faixas.map(linhaFaixa).join('');
        copiar.value = '';
      });
    }

    ligarFormulario(async (dados) => {
      const motoristaMarcado = $('#eh-motorista').checked;
      const faixas = [...form.querySelectorAll('.faixa-linha')].map((l) => ({
        km_ate: l.querySelector('[name=km_ate]').value.trim(),
        valor_tonelada: l.querySelector('[name=valor_tonelada]').value.trim(),
      }));
      if (motoristaMarcado && !dados.motorista.trim()) dados.motorista = dados.nome; // sem apelido: usa o nome do funcionário
      const corpo = {
        nome: dados.nome, cargo: dados.cargo, data_admissao: dados.data_admissao, cpf: soDigitos(dados.cpf),
        telefone: soDigitos(dados.telefone), salario_base: dados.salario_base, alimentacao: dados.alimentacao, observacoes: dados.observacoes,
        motorista: motoristaMarcado ? dados.motorista : '', faixas: motoristaMarcado ? faixas : [],
      };
      if (f.id) {
        await api(`/funcionarios/${f.id}`, { metodo: 'PUT', corpo });
        toast('Funcionário atualizado.');
      } else {
        await api('/funcionarios', { metodo: 'POST', corpo });
        toast('Funcionário cadastrado.');
      }
      carregar();
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const achar = (id) => funcionarios.find((f) => f.id === Number(id));
    try {
      if (alvo.id === 'btn-novo-func') formulario();
      if (alvo.dataset.cadastrarMotorista) formulario({ motorista: alvo.dataset.cadastrarMotorista, cargo: 'Motorista', nome: alvo.dataset.cadastrarMotorista });
      if (alvo.dataset.editar) formulario(achar(alvo.dataset.editar));
      if (alvo.dataset.desativar) {
        const f = achar(alvo.dataset.desativar);
        if (!confirm(`Desativar ${f.nome}? Ele sai das próximas folhas (as antigas continuam).`)) return;
        await api(`/funcionarios/${f.id}`, { metodo: 'DELETE' });
        toast('Funcionário desativado.');
        carregar();
      }
      if (alvo.dataset.reativar) {
        const f = achar(alvo.dataset.reativar);
        await api(`/funcionarios/${f.id}`, { metodo: 'PUT', corpo: { ...f, ativo: true, faixas: undefined } });
        toast('Funcionário reativado.');
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };
  $('#busca-func').addEventListener('input', desenhar);
  $('#mostrar-inativos-func').addEventListener('change', carregar);
  carregar();
}
