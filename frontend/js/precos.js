// =====================================================================
// Xylo - TABELA DE PREÇOS (main.html#precos)
//
//   Venda      -> quanto cada CLIENTE (serraria) paga por tonelada
//   Floresta   -> quanto se paga a cada FLORESTA por tonelada
//   Empreitada -> quanto se paga a cada EMPREITEIRO por tonelada
//
// Reajuste = "Novo preço" com nova data de início: o preço anterior é
// encerrado na véspera e as viagens antigas mantêm o valor da época.
// "Corrigir" serve só para consertar um valor digitado errado.
//
// Depende do comum.js, do api.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

const TIPOS_PRECO = {
  VENDA:      { aba: 'Venda (clientes)',        alvo: 'Cliente',     lista: 'clientes' },
  COMPRA:     { aba: 'Compra (florestas)',      alvo: 'Floresta',    lista: 'florestas' },
  EMPREITADA: { aba: 'Empreitada (empreiteiros)', alvo: 'Empreiteiro', lista: 'empreiteiros' },
};

let abaPreco = 'VENDA';

async function telaPrecos() {
  conteudo.innerHTML = `
    <div class="abas" role="tablist">
      ${Object.entries(TIPOS_PRECO).map(([tipo, t]) =>
        `<button type="button" class="aba ${tipo === abaPreco ? 'ativa' : ''}" data-aba="${tipo}" role="tab">${t.aba}</button>`).join('')}
    </div>
    <div class="barra-ferramentas">
      <input type="search" class="busca" id="busca-preco" placeholder="Buscar…">
      <label class="opcao"><input type="checkbox" id="mostrar-encerrados"> Mostrar preços encerrados</label>
      <span class="contador" id="contador-preco"></span>
      <span class="espaco"></span>
      ${PERFIL.podeEditar ? '<button type="button" class="btn btn-primario" id="btn-novo-preco"><i class="fas fa-plus"></i> Novo preço</button>' : ''}
    </div>
    <div class="card sem-padding"><div id="lista-preco" class="carregando">Carregando…</div></div>
    <p class="nota">Para um <strong>reajuste</strong>, use <strong>Novo preço</strong> com a data em que ele começa a valer:
      o preço anterior é encerrado sozinho na véspera e as viagens já lançadas não mudam.</p>`;

  let precos = [];
  let opcoes = null; // clientes, florestas, empreiteiros e classes (carregados ao abrir o formulário)

  async function carregar() {
    const todos = $('#mostrar-encerrados').checked;
    try {
      precos = await api(`/precos?tipo=${abaPreco}${todos ? '&todos=true' : ''}`);
      if (!$('#lista-preco')) return; // usuário já trocou de tela
      desenhar();
    } catch (erro) {
      $('#lista-preco').className = 'aviso-erro';
      $('#lista-preco').textContent = mensagemErro(erro);
    }
  }

  function vigencia(p) {
    if (!p.data_fim) return `desde ${formatarDataISO(p.data_inicio)}`;
    return `${formatarDataISO(p.data_inicio)} a ${formatarDataISO(p.data_fim)}`;
  }

  function desenhar() {
    const t = TIPOS_PRECO[abaPreco];
    const termo = $('#busca-preco').value.trim().toLowerCase();
    const lista = precos.filter((p) => !termo || `${p.alvo} ${p.classe}`.toLowerCase().includes(termo));
    $('#contador-preco').textContent = `${lista.length} preço(s)`;

    const box = $('#lista-preco');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = precos.length ? 'Nenhum preço encontrado na busca.' : `Nenhum preço de ${t.aba.toLowerCase()} cadastrado ainda.`;
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela">
        <thead><tr><th>${t.alvo}</th><th>Classe</th><th class="num">R$ / tonelada</th><th>Vigência</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${lista.map((p) => `
            <tr class="${p.vigente ? '' : 'inativo'}">
              <td><strong>${esc(p.alvo)}</strong>${p.observacao ? `<div class="sub">${esc(p.observacao)}</div>` : ''}</td>
              <td>${esc(p.classe)}</td>
              <td class="num"><strong>${formatarMoeda(p.valor_tonelada)}</strong></td>
              <td>${vigencia(p)}</td>
              <td><span class="selo ${p.vigente ? 'selo-ativo' : 'selo-inativo'}">${p.vigente ? 'Vigente' : 'Encerrado'}</span></td>
              <td class="acoes">
                ${PERFIL.podeEditar ? `<button type="button" class="icone-botao" data-corrigir="${p.id}" title="Corrigir valor"><i class="fas fa-pen"></i></button>` : ''}
                ${botaoHistorico(p, 'tabelas_precos')}${botaoExcluir(p, 'precos')}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function novoPreco() {
    const t = TIPOS_PRECO[abaPreco];
    if (!opcoes) opcoes = await api('/viagens/opcoes');
    const alvos = opcoes[t.lista];
    if (!alvos.length) {
      toast(`Cadastre primeiro um(a) ${t.alvo.toLowerCase()} ativo(a).`, 'erro');
      return;
    }
    abrirModal(`Novo preço · ${t.aba}`, `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga"><label>${t.alvo} *</label>
            <select name="alvo_id" required><option value="">Selecione…</option>
              ${alvos.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Classe de madeira *</label>
            <select name="classe_id" required><option value="">Selecione…</option>
              ${opcoes.classes.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Valor da tonelada (R$) *</label>
            <input name="valor_tonelada" required inputmode="decimal" placeholder="Ex.: 220,00"></div>
          <div class="campo"><label>Vale a partir de *</label>
            <input name="data_inicio" type="date" required value="${hojeISO()}"></div>
          <div class="campo larga"><label>Observação</label><input name="observacao" maxlength="500" placeholder="Ex.: reajuste combinado em reunião"></div>
        </div>
        <p class="nota">Se já houver preço para essa classe, ele é encerrado na véspera desta data.</p>
        ${RODAPE_FORMULARIO}
      </form>`);

    ligarFormulario(async (dados) => {
      await api('/precos', { metodo: 'POST', corpo: { ...dados, tipo: abaPreco } });
      toast('Preço cadastrado.');
      carregar();
    });
  }

  function corrigirPreco(p) {
    abrirModal('Corrigir valor', `
      <form novalidate>
        <p><strong>${esc(p.alvo)}</strong> · ${esc(p.classe)} · ${vigencia(p)}</p>
        <div class="grade-campos">
          <div class="campo"><label>Valor da tonelada (R$) *</label>
            <input name="valor_tonelada" required inputmode="decimal" value="${esc(Number(p.valor_tonelada).toFixed(2).replace('.', ','))}"></div>
          <div class="campo larga"><label>Observação</label><input name="observacao" maxlength="500" value="${esc(p.observacao)}"></div>
        </div>
        <p class="nota">Use só para consertar um valor digitado errado. Viagens já lançadas mantêm o valor que tinham.
          Para um reajuste, feche e use <strong>Novo preço</strong>.</p>
        ${RODAPE_FORMULARIO}
      </form>`);

    ligarFormulario(async (dados) => {
      await api(`/precos/${p.id}`, { metodo: 'PUT', corpo: dados });
      toast('Valor corrigido.');
      carregar();
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const achar = (id) => precos.find((p) => p.id === Number(id));
    try {
      if (alvo.dataset.aba) {
        abaPreco = alvo.dataset.aba;
        document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === alvo));
        $('#busca-preco').value = '';
        carregar();
      }
      if (alvo.id === 'btn-novo-preco') await novoPreco();
      if (alvo.dataset.corrigir) corrigirPreco(achar(alvo.dataset.corrigir));
      if (alvo.dataset.excluir) {
        const p = achar(alvo.dataset.excluir);
        excluirRegistro({ tipo: 'precos', id: p.id, depois: carregar,
          resumo: `Preço de ${p.alvo} · ${p.classe} · ${formatarMoeda(p.valor_tonelada)}/t (as viagens já lançadas não mudam)` });
      }
      if (alvo.dataset.historico) {
        const p = achar(alvo.dataset.historico);
        abrirHistoricoRegistro('tabelas_precos', p.id, `Preço de ${p.alvo} · ${p.classe}`);
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };

  $('#busca-preco').addEventListener('input', desenhar);
  $('#mostrar-encerrados').addEventListener('change', carregar);
  carregar();
}
