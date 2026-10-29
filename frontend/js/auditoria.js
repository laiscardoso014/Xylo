// =====================================================================
// Xylo - EXCLUIR (lixeira), LIXEIRA e HISTÓRICO
//
// excluirRegistro()       janela "Excluir" com motivo obrigatório, usada em
//                         Viagens, Fretes, Despesas e Tabela de preços.
//                         Depois de excluir, o aviso traz "Desfazer".
// telaLixeira()           (admin) o que foi excluído: quem, quando, por quê;
//                         Restaurar devolve o registro com os mesmos dados.
// telaHistorico()         (admin) quem incluiu, alterou, cancelou, excluiu
//                         ou restaurou o quê, e quem entrou no sistema.
// abrirHistoricoRegistro() o histórico de UM registro (botão do relógio).
//
// Depende do comum.js, do api.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

// Pode excluir? Admin: tudo. Financeiro: só o que ele mesmo lançou.
function podeExcluir(registro) {
  return PERFIL.admin || (PERFIL.podeEditar && registro && registro.criado_por === PERFIL.id);
}
function botaoExcluir(registro, tipo) {
  return podeExcluir(registro)
    ? `<button type="button" class="icone-botao perigo" data-excluir="${registro.id}" data-tipo="${tipo}" title="Excluir (vai para a lixeira)"><i class="fas fa-trash-can"></i></button>`
    : '';
}
function botaoHistorico(registro, tabela) {
  return PERFIL.admin
    ? `<button type="button" class="icone-botao" data-historico="${registro.id}" data-tabela="${tabela}" title="Histórico de alterações"><i class="fas fa-clock-rotate-left"></i></button>`
    : '';
}

const MOTIVOS_RAPIDOS = ['Lançado em duplicidade', 'Valor ou peso errado', 'Cliente ou floresta errado', 'Data errada', 'Lançamento de teste'];
const NOME_TIPO = { viagens: 'viagem', fretes: 'frete', despesas: 'despesa', precos: 'preço' };

// tipo: viagens | fretes | despesas | precos ; resumo: texto que identifica o registro
// depois(): recarrega a tela (depois de excluir e de desfazer)
function excluirRegistro({ tipo, id, resumo, depois }) {
  abrirModal(`Excluir ${NOME_TIPO[tipo]}`, `
    <form novalidate class="form-excluir">
      <div class="excluir-alvo">
        <i class="fas fa-trash-can" aria-hidden="true"></i>
        <div><strong>${esc(resumo)}</strong>
          <span>Sai das telas, dos totais, dos relatórios e do Excel e vai para a <b>lixeira</b>.
          Nada se perde: o administrador pode restaurar.</span></div>
      </div>
      <div class="campo">
        <label for="motivo-exclusao">Por que excluir? *</label>
        <div class="motivos-rapidos">${MOTIVOS_RAPIDOS.map((m) => `<button type="button" class="chip" data-motivo="${esc(m)}">${esc(m)}</button>`).join('')}</div>
        <textarea id="motivo-exclusao" name="motivo" rows="2" maxlength="300" required placeholder="Ex.: lançado em duplicidade (ticket repetido)"></textarea>
        <small>O motivo fica registrado no histórico.</small>
      </div>
      <div class="form-erro" hidden></div>
      <div class="modal-rodape">
        <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-perigo"><i class="fas fa-trash-can"></i> Excluir</button>
      </div>
    </form>`);
  const form = $('#modal-corpo form');
  const motivo = form.elements.motivo;
  motivo.focus();
  form.querySelector('.motivos-rapidos').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-motivo]');
    if (!chip) return;
    motivo.value = chip.dataset.motivo;
    motivo.focus();
  });
  ligarFormulario(async (dados) => {
    if (dados.motivo.trim().length < 5) throw new Error('Escreva o motivo da exclusão (pelo menos 5 letras).');
    const r = await api('/lixeira', { metodo: 'POST', corpo: { tipo, id, motivo: dados.motivo.trim() } });
    const desfazer = async () => {
      try {
        const v = await api(`/lixeira/${r.id}/restaurar`, { metodo: 'POST' });
        toast(['Exclusão desfeita.', ...v.avisos].join(' '));
      } catch (erro) {
        toast(mensagemErro(erro), 'erro');
      }
      if (depois) depois();
    };
    toast(`${r.resumo.split(' · ')[0]} foi para a lixeira.${r.aviso ? ` ${r.aviso}` : ''}`, 'ok', { rotulo: 'Desfazer', fazer: desfazer, ms: 10000 });
    if (depois) depois();
  });
}

// ---------------------------------------------------------------------
// Desenho de um evento do histórico (tela Histórico e janela do registro)
// ---------------------------------------------------------------------
const ICONE_ACAO = {
  INSERT: 'fa-plus', UPDATE: 'fa-pen', CANCELAR: 'fa-ban', EXCLUIR: 'fa-trash-can',
  RESTAURAR: 'fa-rotate-left', DELETE: 'fa-eraser', LOGIN: 'fa-right-to-bracket',
};
function eventoHTML(e, { mostrarTitulo = true } = {}) {
  const lista = e.mudancas.length
    ? `<ul class="mudancas">${e.mudancas.map((m) => `<li><span>${esc(m.campo)}</span> ${m.de ? `<del>${esc(m.de)}</del> <i class="fas fa-arrow-right" aria-label="para"></i> ` : ''}<ins>${esc(m.para)}</ins></li>`).join('')}</ul>`
    : '';
  const dados = e.campos.length
    ? `<details class="dados-evento"><summary>Ver os dados</summary><dl>${e.campos.map((c) => `<div><dt>${esc(c.campo)}</dt><dd>${esc(c.valor)}</dd></div>`).join('')}</dl></details>`
    : '';
  return `
    <li class="evento acao-${e.acao.toLowerCase()}">
      <span class="evento-icone" aria-hidden="true"><i class="fas ${ICONE_ACAO[e.acao] || 'fa-circle'}"></i></span>
      <div class="evento-corpo">
        <p><strong>${esc(e.usuario)}</strong> ${esc(e.acao_texto)}${mostrarTitulo && e.titulo ? ` <span class="evento-alvo">${esc(e.titulo)}</span>` : ''}</p>
        ${e.detalhe ? `<p class="evento-detalhe"><i class="fas fa-comment" aria-hidden="true"></i> ${esc(e.detalhe)}</p>` : ''}
        ${lista}${dados}
        <p class="evento-meta">${esc(e.dia)} às ${esc(e.hora)}${e.perfil ? ` · ${esc(e.perfil)}` : ''}${e.ip ? ` · IP ${esc(e.ip)}` : ''}</p>
      </div>
    </li>`;
}

async function abrirHistoricoRegistro(tabela, id, titulo) {
  abrirModal(`Histórico · ${titulo}`, '<div class="carregando">Carregando…</div>');
  try {
    const r = await api(`/historico?tabela=${tabela}&registro_id=${id}`);
    $('#modal-corpo').innerHTML = r.itens.length
      ? `<ol class="linha-tempo">${r.itens.map((e) => eventoHTML(e, { mostrarTitulo: false })).join('')}</ol>`
      : '<p class="vazio">Nenhum registro no histórico (lançado antes do histórico existir).</p>';
  } catch (erro) {
    $('#modal-corpo').innerHTML = `<p class="aviso-erro">${esc(mensagemErro(erro))}</p>`;
  }
}

// ---------------------------------------------------------------------
// LIXEIRA (admin)
// ---------------------------------------------------------------------
async function telaLixeira() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Tipo <select id="lx-tipo"><option value="">Todos</option>
        <option value="viagens">Viagens</option><option value="fretes">Fretes</option>
        <option value="despesas">Despesas</option><option value="precos">Preços</option></select></label>
      <label class="filtro-campo">Excluído de <input type="date" id="lx-de"></label>
      <label class="filtro-campo">até <input type="date" id="lx-ate"></label>
      <input type="search" class="busca" id="lx-busca" placeholder="Buscar no registro ou no motivo…">
    </div>
    <p class="nota-tela"><i class="fas fa-circle-info" aria-hidden="true"></i>
      <span>O que é excluído fica guardado aqui para sempre e não entra em telas, totais nem relatórios.
      <b>Restaurar</b> devolve o registro como estava. Quem excluiu tem 10 minutos para desfazer sozinho.</span></p>
    <div id="lista-lixeira" class="carregando">Carregando…</div>`;

  let itens = [];
  let espera;
  let consulta = 0;
  async function carregar() {
    const minha = ++consulta;
    const p = new URLSearchParams();
    for (const [k, sel] of [['tipo', '#lx-tipo'], ['de', '#lx-de'], ['ate', '#lx-ate'], ['busca', '#lx-busca']]) {
      if ($(sel).value.trim()) p.set(k, $(sel).value.trim());
    }
    try {
      const r = await api(`/lixeira?${p}`);
      if (!$('#lista-lixeira') || minha !== consulta) return;
      itens = r.itens;
      const total = Object.values(r.contagem).reduce((a, b) => a + b, 0);
      $('#lx-tipo').options[0].textContent = `Todos (${total})`;
      [...$('#lx-tipo').options].slice(1).forEach((o) => { o.textContent = `${o.textContent.replace(/ \(\d+\)$/, '')} (${r.contagem[o.value] || 0})`; });
      desenhar();
    } catch (erro) {
      $('#lista-lixeira').className = 'aviso-erro';
      $('#lista-lixeira').textContent = mensagemErro(erro);
    }
  }
  function desenhar() {
    const box = $('#lista-lixeira');
    if (!itens.length) {
      box.className = 'vazio card';
      box.innerHTML = '<i class="fas fa-trash-can" aria-hidden="true"></i><br>A lixeira está vazia.';
      return;
    }
    box.className = 'lista-lixeira';
    box.innerHTML = itens.map((i) => `
      <article class="card item-lixeira">
        <div class="item-topo">
          <span class="selo selo-tipo">${esc(i.tipo_nome)}</span>
          <strong class="item-resumo">${esc(i.resumo)}</strong>
          ${i.valor !== null ? `<span class="item-valor">${formatarMoeda(i.valor)}${i.tipo === 'precos' ? '/t' : ''}</span>` : ''}
        </div>
        <p class="item-motivo"><i class="fas fa-comment" aria-hidden="true"></i> ${esc(i.motivo)}</p>
        <p class="item-meta">Excluído por <b>${esc(i.excluido_por || '—')}</b> em ${esc(i.excluido_em)}${i.criado_por ? ` · lançado por ${esc(i.criado_por)}` : ''}</p>
        <div class="item-acoes">
          <details class="dados-evento"><summary>Ver os dados</summary>
            <dl>${i.detalhes.map((c) => `<div><dt>${esc(c.campo)}</dt><dd>${esc(c.valor)}</dd></div>`).join('')}</dl></details>
          <button type="button" class="btn btn-secundario pequeno" data-restaurar="${i.id}"><i class="fas fa-rotate-left"></i> Restaurar</button>
        </div>
      </article>`).join('');
  }

  cliqueDaTela = async (e) => {
    const b = e.target.closest('[data-restaurar]');
    if (!b) return;
    const i = itens.find((x) => x.id === Number(b.dataset.restaurar));
    const destino = { viagens: 'Viagens', fretes: 'Fretes', despesas: 'Despesas', precos: 'a Tabela de preços' }[i.tipo];
    if (!confirm(`Restaurar?\n\n${i.resumo}\n\nO registro volta para ${destino} com os mesmos dados.`)) return;
    b.disabled = true;
    try {
      const r = await api(`/lixeira/${i.id}/restaurar`, { metodo: 'POST' });
      toast(['Restaurado.', ...r.avisos].join(' '));
      carregar();
    } catch (erro) {
      b.disabled = false;
      toast(mensagemErro(erro), 'erro');
    }
  };
  ['#lx-tipo', '#lx-de', '#lx-ate'].forEach((s) => $(s).addEventListener('change', carregar));
  $('#lx-busca').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(carregar, 300); });
  carregar();
}

// ---------------------------------------------------------------------
// HISTÓRICO (admin)
// ---------------------------------------------------------------------
async function telaHistorico() {
  const hoje = hojeISO();
  const mesPassado = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">De <input type="date" id="hs-de" value="${mesPassado}"></label>
      <label class="filtro-campo">até <input type="date" id="hs-ate" value="${hoje}"></label>
      <label class="filtro-campo">Quem <select id="hs-usuario"><option value="">Todos</option></select></label>
      <label class="filtro-campo">Onde <select id="hs-tabela"><option value="">Tudo</option></select></label>
      <label class="filtro-campo">O quê <select id="hs-acao"><option value="">Todas as ações</option></select></label>
    </div>
    <p class="nota-tela"><i class="fas fa-shield-halved" aria-hidden="true"></i>
      <span>Registro automático de quem incluiu, alterou, cancelou, excluiu ou restaurou cada lançamento e cadastro, com o antes e o depois.
      Ninguém consegue apagar este histórico pelo sistema.</span></p>
    <div class="card"><ol class="linha-tempo" id="lista-historico"></ol>
      <div id="historico-rodape" class="carregando">Carregando…</div></div>`;

  let pagina = 1;
  let opcoesCarregadas = false;
  let diaAnterior = null;
  let consulta = 0; // trocar filtros rápido: só vale a resposta da última consulta

  async function carregar(mais = false) {
    const minha = ++consulta;
    pagina = mais ? pagina + 1 : 1;
    if (!mais) { $('#lista-historico').innerHTML = ''; diaAnterior = null; }
    const p = new URLSearchParams({ pagina });
    for (const [k, sel] of [['de', '#hs-de'], ['ate', '#hs-ate'], ['usuario_id', '#hs-usuario'], ['tabela', '#hs-tabela'], ['acao', '#hs-acao']]) {
      if ($(sel).value) p.set(k, $(sel).value);
    }
    const rodape = $('#historico-rodape');
    rodape.className = 'carregando';
    rodape.textContent = 'Carregando…';
    try {
      const r = await api(`/historico?${p}`);
      if (!$('#lista-historico') || minha !== consulta) return;
      if (!opcoesCarregadas) {
        $('#hs-usuario').insertAdjacentHTML('beforeend', r.usuarios.map((u) => `<option value="${u.id}">${esc(u.nome)}</option>`).join(''));
        $('#hs-tabela').insertAdjacentHTML('beforeend', r.tabelas.map((t) => `<option value="${t.id}">${esc(t.nome)}</option>`).join(''));
        $('#hs-acao').insertAdjacentHTML('beforeend', r.acoes.map((a) => `<option value="${a.id}">${esc(a.nome[0].toUpperCase() + a.nome.slice(1))}</option>`).join(''));
        opcoesCarregadas = true;
      }
      const html = r.itens.map((e) => {
        const cabecalho = e.dia !== diaAnterior ? `<li class="dia-historico">${esc(e.dia)}</li>` : '';
        diaAnterior = e.dia;
        return cabecalho + eventoHTML(e);
      }).join('');
      $('#lista-historico').insertAdjacentHTML('beforeend', html);
      if (r.tem_mais) {
        rodape.className = 'historico-mais';
        rodape.innerHTML = '<button type="button" class="btn btn-secundario" id="hs-mais">Carregar mais</button>';
      } else {
        rodape.className = pagina === 1 && !r.itens.length ? 'vazio' : 'fim-historico';
        rodape.textContent = pagina === 1 && !r.itens.length ? 'Nada no histórico com esses filtros.' : 'Fim do histórico neste período.';
      }
    } catch (erro) {
      rodape.className = 'aviso-erro';
      rodape.textContent = mensagemErro(erro);
    }
  }
  cliqueDaTela = (e) => { if (e.target.closest('#hs-mais')) carregar(true); };
  ['#hs-de', '#hs-ate', '#hs-usuario', '#hs-tabela', '#hs-acao'].forEach((s) => $(s).addEventListener('change', () => carregar()));
  carregar();
}
