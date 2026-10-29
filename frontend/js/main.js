// =====================================================================
// Xylo (CTech) - tela principal (main.html)
// Desenha cada tela dentro de <main id="conteudo"> conforme o menu (#rota).
// Usa o comum.js ($, esc, toast, modal, formatação) e o api.js (api, Sessao, sair).
//
// As permissões aqui só escondem botões. Quem bloqueia de verdade é o
// backend (middlewares/auth.js), que confere o perfil em cada requisição.
// =====================================================================

exigirLogin();

const usuario = Sessao.usuario() || {};
const empresa = Sessao.empresa() || {};

const PERFIL = {
  id: usuario.id,
  admin: usuario.perfil === 'Administrador',
  podeEditar: usuario.perfil === 'Administrador' || usuario.perfil === 'Financeiro',
};

const conteudo = $('#conteudo');

// Um único "ouvinte" de cliques para a área de conteúdo; cada tela define o seu.
let cliqueDaTela = null;
conteudo.addEventListener('click', (e) => { if (cliqueDaTela) cliqueDaTela(e); });

// ---------------------------------------------------------------------
// Cabeçalho: data/hora, empresa (logo) e menu do usuário
// ---------------------------------------------------------------------
const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).filter(Boolean)
  .map((p, i, a) => (i === 0 || i === a.length - 1 ? p[0] : '')).join('').slice(0, 2).toUpperCase();

// Mostra nome, perfil e iniciais do usuário (chamado de novo quando ele edita o perfil)
function aplicarUsuario() {
  $('#info-usuario').textContent = (usuario.nome || '').split(' ')[0];
  $('#info-perfil').textContent = usuario.perfil || '';
  $('#avatar-usuario').textContent = iniciais(usuario.nome);
  $('#menu-nome').textContent = usuario.nome || '';
  $('#menu-email').textContent = usuario.email || '';
  $('#btn-usuario').setAttribute('aria-label', `${usuario.nome} (${usuario.perfil}) — abrir menu do usuário`);
}

// Dados da empresa (logo, razão social...) usados no topo e nos relatórios
let dadosEmpresa = { ...empresa };
function aplicarEmpresa() {
  $('#info-empresa').textContent = dadosEmpresa.nome || '';
  const img = $('#logo-empresa');
  if (dadosEmpresa.logo) { img.src = dadosEmpresa.logo; img.alt = `Logo ${dadosEmpresa.nome || ''}`; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
}
api('/empresa').then((d) => { dadosEmpresa = d; aplicarEmpresa(); }).catch(() => aplicarEmpresa());

// Data e hora, atualizadas a cada 20 segundos
function atualizarRelogio() {
  const agora = new Date();
  // "Qua., 28 de out." — monta as partes para não depender do formato de cada navegador
  const semana = agora.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  const mesCurto = agora.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const data = `${semana.charAt(0).toUpperCase()}${semana.slice(1)}., ${agora.getDate()} de ${mesCurto}.`;
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const el = $('#relogio');
  el.innerHTML = `<span class="relogio-data">${esc(data)}</span> <strong>${esc(hora)}</strong>`;
  el.setAttribute('datetime', agora.toISOString());
  el.title = agora.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
}
atualizarRelogio();
setInterval(atualizarRelogio, 20000);

aplicarUsuario();
aplicarEmpresa();

if (!PERFIL.admin) {
  document.querySelectorAll('[data-somente-admin]').forEach((el) => el.remove());
}
if (!PERFIL.podeEditar) {
  document.querySelectorAll('[data-pode-editar]').forEach((el) => el.remove());
}

// Menu do usuário (abre/fecha; fecha com Esc, clique fora ou ao escolher um item)
const menuUsuario = $('#menu-usuario');
function alternarMenuUsuario(abrir) {
  menuUsuario.hidden = !abrir;
  $('#btn-usuario').setAttribute('aria-expanded', String(abrir));
  if (abrir) menuUsuario.querySelector('a, button').focus();
}
$('#btn-usuario').addEventListener('click', (e) => { e.stopPropagation(); alternarMenuUsuario(menuUsuario.hidden); });
menuUsuario.addEventListener('click', (e) => { if (e.target.closest('a, button')) alternarMenuUsuario(false); });
document.addEventListener('click', (e) => { if (!menuUsuario.hidden && !e.target.closest('.usuario-topo')) alternarMenuUsuario(false); });
menuUsuario.addEventListener('keydown', (e) => {
  const itens = [...menuUsuario.querySelectorAll('a, button')];
  const i = itens.indexOf(document.activeElement);
  if (e.key === 'Escape') { alternarMenuUsuario(false); $('#btn-usuario').focus(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus(); }
});

$('#btn-sair').addEventListener('click', sair);           // sair() está no api.js
$('#btn-menu').addEventListener('click', () => $('#menu').classList.toggle('aberto'));

// ---------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------
const TELAS = {
  inicio: { titulo: 'Início', desenhar: telaInicio },
  clientes: { titulo: 'Clientes', desenhar: () => telaCadastro(CADASTROS.clientes) },
  florestas: { titulo: 'Florestas', desenhar: () => telaCadastro(CADASTROS.florestas) },
  empreiteiros: { titulo: 'Empreiteiros', desenhar: () => telaCadastro(CADASTROS.empreiteiros) },
  precos: { titulo: 'Tabela de preços', desenhar: telaPrecos },     // js/precos.js
  viagens: { titulo: 'Viagens', desenhar: telaViagens },            // js/viagens.js
  fretes: { titulo: 'Fretes', desenhar: telaFretes },               // js/fretes.js
  despesas: { titulo: 'Despesas', desenhar: telaDespesas },         // js/despesas.js
  relatorios: { titulo: 'Relatórios', desenhar: telaRelatorios },   // js/relatorios.js
  perfil: { titulo: 'Meu perfil', desenhar: telaPerfil },           // js/perfil.js
  importar: { titulo: 'Importar planilha', desenhar: telaImportar, somenteEditor: true }, // js/importar.js
  empresa: { titulo: 'Dados da empresa', desenhar: telaEmpresa, somenteAdmin: true }, // js/perfil.js
  usuarios: { titulo: 'Usuários', desenhar: telaUsuarios, somenteAdmin: true },
  funcionarios: { titulo: 'Funcionários', desenhar: telaFuncionarios, somenteEditor: true }, // js/funcionarios.js
  folha: { titulo: 'Folha de pagamento', desenhar: telaFolha, somenteEditor: true },      // js/folha.js
  rotas: { titulo: 'Rotas e distâncias', desenhar: telaRotas, somenteEditor: true },      // js/rotas.js
  lixeira: { titulo: 'Lixeira', desenhar: telaLixeira, somenteAdmin: true },       // js/auditoria.js
  historico: { titulo: 'Histórico', desenhar: telaHistorico, somenteAdmin: true }, // js/auditoria.js
};

function navegar() {
  let rota = location.hash.replace('#', '') || 'inicio';
  if (!TELAS[rota] || (TELAS[rota].somenteAdmin && !PERFIL.admin) || (TELAS[rota].somenteEditor && !PERFIL.podeEditar)) rota = 'inicio';

  document.querySelectorAll('.menu-itens a').forEach((a) => {
    a.classList.toggle('ativo', a.dataset.rota === rota);
  });
  $('#menu').classList.remove('aberto');
  cliqueDaTela = null;
  $('#titulo-pagina').textContent = TELAS[rota].titulo;
  document.title = `${TELAS[rota].titulo} · Xylo`;
  TELAS[rota].desenhar();
}

window.addEventListener('hashchange', navegar);

// ---------------------------------------------------------------------
// INÍCIO
// ---------------------------------------------------------------------
// telaInicio está em js/inicio.js (painel com gráficos)

// ---------------------------------------------------------------------
// TELA DE CADASTRO GENÉRICA
// Clientes, Florestas (e os próximos cadastros) usam a mesma tela: lista com
// busca, "mostrar inativos", formulário de novo/editar e desativar/reativar.
// Cada cadastro só descreve os seus campos e colunas (ver CADASTROS abaixo).
// ---------------------------------------------------------------------
async function telaCadastro(cfg) {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <input type="search" class="busca" id="busca-cadastro" placeholder="Buscar ${cfg.singular}…">
      <label class="opcao"><input type="checkbox" id="mostrar-inativos"> Mostrar inativos</label>
      <span class="contador" id="contador-cadastro"></span>
      <span class="espaco"></span>
      ${PERFIL.podeEditar ? `<button type="button" class="btn btn-primario" id="btn-novo"><i class="fas fa-plus"></i> ${cfg.novo}</button>` : ''}
    </div>
    <div class="card sem-padding"><div id="lista-cadastro" class="carregando">Carregando…</div></div>`;

  let todos = [];

  async function carregar() {
    const inativos = $('#mostrar-inativos').checked;
    try {
      todos = await api(`${cfg.rota}${inativos ? '?ativo=false' : ''}`);
      desenhar();
    } catch (erro) {
      $('#lista-cadastro').className = 'aviso-erro';
      $('#lista-cadastro').textContent = mensagemErro(erro);
    }
  }

  function desenhar() {
    const termo = $('#busca-cadastro').value.trim().toLowerCase();
    const lista = todos.filter((item) => !termo
      || cfg.busca.some((campo) => String(item[campo] || '').toLowerCase().includes(termo)));
    $('#contador-cadastro').textContent = `${lista.length} de ${todos.length}`;

    const box = $('#lista-cadastro');
    if (lista.length === 0) {
      box.className = 'vazio';
      box.textContent = todos.length ? `Nenhum resultado para a busca.` : cfg.vazio;
      return;
    }

    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela">
        <thead><tr>${cfg.colunas.map((c) => `<th>${c.titulo}</th>`).join('')}<th>Situação</th><th></th></tr></thead>
        <tbody>
          ${lista.map((item) => `
            <tr class="${item.ativo ? '' : 'inativo'}">
              ${cfg.colunas.map((c) => `<td>${c.valor(item) || '–'}</td>`).join('')}
              <td><span class="selo ${item.ativo ? 'selo-ativo' : 'selo-inativo'}">${item.ativo ? 'Ativo' : 'Inativo'}</span></td>
              <td class="acoes">
                ${PERFIL.podeEditar ? `<button type="button" class="icone-botao" data-editar="${item.id}" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
                ${PERFIL.admin && item.ativo ? `<button type="button" class="icone-botao perigo" data-desativar="${item.id}" title="Desativar"><i class="fas fa-ban"></i></button>` : ''}
                ${PERFIL.admin && !item.ativo ? `<button type="button" class="icone-botao" data-reativar="${item.id}" title="Reativar"><i class="fas fa-rotate-left"></i></button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // Monta um campo do formulário a partir da descrição em cfg.campos
  function campoHtml(c, item) {
    const valor = c.formatar ? c.formatar(item[c.nome]) : item[c.nome];
    const comum = `name="${c.nome}" ${c.obrigatorio ? 'required' : ''} ${c.max ? `maxlength="${c.max}"` : ''} ${c.dica ? `placeholder="${c.dica}"` : ''}`;
    const entrada = c.tipo === 'textarea'
      ? `<textarea ${comum} rows="3">${esc(valor)}</textarea>`
      : `<input ${comum} type="${c.tipo || 'text'}" value="${esc(valor)}">`;
    return `<div class="campo ${c.larga ? 'larga' : ''}">
      <label>${c.rotulo}${c.obrigatorio ? ' *' : ''}</label>${entrada}${c.ajuda ? `<small>${c.ajuda}</small>` : ''}
    </div>`;
  }

  function formulario(item = {}) {
    abrirModal(item.id ? `Editar ${cfg.singular}` : cfg.novo, `
      <form novalidate>
        <div class="grade-campos">${cfg.campos.map((c) => campoHtml(c, item)).join('')}</div>
        ${RODAPE_FORMULARIO}
      </form>`);

    // Máscaras de digitação (ex.: telefone, CPF/CNPJ), quando o campo pede
    cfg.campos.filter((c) => c.mascara).forEach((c) => c.mascara($(`#modal-corpo [name="${c.nome}"]`)));

    ligarFormulario(async (dados) => {
      if (item.id) {
        await api(`${cfg.rota}/${item.id}`, { metodo: 'PUT', corpo: dados });
        toast(`${cfg.Singular} atualizad${cfg.genero}.`);
      } else {
        await api(cfg.rota, { metodo: 'POST', corpo: dados });
        toast(`${cfg.Singular} cadastrad${cfg.genero}.`);
      }
      carregar();
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const achar = (id) => todos.find((x) => x.id === Number(id));
    try {
      if (alvo.id === 'btn-novo') formulario();
      if (alvo.dataset.editar) formulario(achar(alvo.dataset.editar));
      if (alvo.dataset.desativar) {
        const item = achar(alvo.dataset.desativar);
        if (!confirm(`Desativar ${cfg.artigo} ${cfg.singular} ${item.nome}? ${cfg.Artigo} ${cfg.singular} some das listas, mas o histórico de viagens continua.`)) return;
        await api(`${cfg.rota}/${item.id}`, { metodo: 'DELETE' });
        toast(`${cfg.Singular} desativad${cfg.genero}.`);
        carregar();
      }
      if (alvo.dataset.reativar) {
        await api(`${cfg.rota}/${alvo.dataset.reativar}`, { metodo: 'PUT', corpo: { ativo: true } });
        toast(`${cfg.Singular} reativad${cfg.genero}.`);
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };

  $('#busca-cadastro').addEventListener('input', desenhar);
  $('#mostrar-inativos').addEventListener('change', carregar);
  carregar();
}

// Município/UF numa coluna só: "Lages/SC"
const localidade = (cidade, uf) => (cidade ? `${esc(cidade)}${uf ? '/' + esc(uf) : ''}` : '');
const comSub = (principal, sub) => `${principal}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;

// ---------------------------------------------------------------------
// CADASTROS: cada um só descreve os seus campos e colunas
// ---------------------------------------------------------------------
const CADASTROS = {
  // CLIENTES (serrarias que compram a madeira)
  clientes: {
    rota: '/clientes', singular: 'cliente', Singular: 'Cliente', artigo: 'o', Artigo: 'O', genero: 'o',
    novo: 'Novo cliente', vazio: 'Nenhum cliente cadastrado ainda.',
    busca: ['nome', 'razao_social', 'cidade'],
    colunas: [
      { titulo: 'Cliente', valor: (c) => comSub(`<strong>${esc(c.nome)}</strong>`, c.razao_social) },
      { titulo: 'CPF/CNPJ', valor: (c) => esc(formatarDocumento(c.cpf_cnpj)) },
      { titulo: 'Cidade', valor: (c) => localidade(c.cidade, c.estado) },
      { titulo: 'Contato', valor: (c) => comSub(esc(formatarTelefone(c.telefone)), c.email) },
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true, max: 150, larga: true },
      { nome: 'razao_social', rotulo: 'Razão social', max: 150, larga: true },
      { nome: 'cpf_cnpj', rotulo: 'CPF/CNPJ', max: 18, ajuda: 'Opcional', formatar: formatarDocumento, mascara: mascaraDocumento },
      { nome: 'telefone', rotulo: 'Telefone / WhatsApp', max: 15, dica: '(49) 99999-9999', formatar: formatarTelefone, mascara: mascaraTelefone },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 150, larga: true },
      { nome: 'cidade', rotulo: 'Cidade', max: 100 },
      { nome: 'estado', rotulo: 'Estado', max: 2, dica: 'SC' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', larga: true },
    ],
  },

  // FLORESTAS (de onde a madeira sai)
  florestas: {
    rota: '/florestas', singular: 'floresta', Singular: 'Floresta', artigo: 'a', Artigo: 'A', genero: 'a',
    novo: 'Nova floresta', vazio: 'Nenhuma floresta cadastrada ainda.',
    busca: ['nome', 'proprietario', 'municipio'],
    colunas: [
      { titulo: 'Floresta', valor: (f) => `<strong>${esc(f.nome)}</strong>` },
      { titulo: 'Proprietário', valor: (f) => esc(f.proprietario) },
      { titulo: 'Município', valor: (f) => localidade(f.municipio, f.estado) },
      { titulo: 'Observações', valor: (f) => esc(f.observacoes) },
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome da floresta', obrigatorio: true, max: 150, larga: true, dica: 'Ex.: Grazziotin' },
      { nome: 'proprietario', rotulo: 'Proprietário / fornecedor', max: 150, larga: true, ajuda: 'Quem vende a madeira da floresta' },
      { nome: 'municipio', rotulo: 'Município', max: 100 },
      { nome: 'estado', rotulo: 'Estado', max: 2, dica: 'SC' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', larga: true },
    ],
  },

  // EMPREITEIROS (quem corta e carrega a madeira)
  empreiteiros: {
    rota: '/empreiteiros', singular: 'empreiteiro', Singular: 'Empreiteiro', artigo: 'o', Artigo: 'O', genero: 'o',
    novo: 'Novo empreiteiro', vazio: 'Nenhum empreiteiro cadastrado ainda.',
    busca: ['nome', 'cpf_cnpj', 'telefone'],
    colunas: [
      { titulo: 'Empreiteiro', valor: (e) => `<strong>${esc(e.nome)}</strong>` },
      { titulo: 'CPF/CNPJ', valor: (e) => esc(formatarDocumento(e.cpf_cnpj)) },
      { titulo: 'Telefone', valor: (e) => esc(formatarTelefone(e.telefone)) },
      { titulo: 'Observações', valor: (e) => esc(e.observacoes) },
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome do empreiteiro', obrigatorio: true, max: 150, larga: true, dica: 'Ex.: Xande' },
      { nome: 'cpf_cnpj', rotulo: 'CPF/CNPJ', max: 18, ajuda: 'Opcional', formatar: formatarDocumento, mascara: mascaraDocumento },
      { nome: 'telefone', rotulo: 'Telefone / WhatsApp', max: 15, dica: '(49) 99999-9999', formatar: formatarTelefone, mascara: mascaraTelefone },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', larga: true },
    ],
  },
};

// ---------------------------------------------------------------------
// USUÁRIOS (só Administrador)
// ---------------------------------------------------------------------
async function telaUsuarios() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <span class="contador" id="contador-usuarios"></span>
      <span class="espaco"></span>
      <button type="button" class="btn btn-primario" id="btn-novo-usuario"><i class="fas fa-user-plus"></i> Novo usuário</button>
    </div>
    <div class="card sem-padding"><div id="lista-usuarios" class="carregando">Carregando…</div></div>
    <div class="card">
      <h3>Perfis de acesso</h3>
      <p><strong>Administrador:</strong> altera tudo, inclusive usuários e perfis.<br>
         <strong>Financeiro:</strong> cadastra, lança viagens e altera valores.<br>
         <strong>Visualização:</strong> só consulta, não altera nada.</p>
    </div>`;

  let usuarios = [];
  let perfis = [];

  async function carregar() {
    try {
      [usuarios, perfis] = await Promise.all([api('/usuarios'), perfis.length ? perfis : api('/usuarios/perfis')]);
      $('#contador-usuarios').textContent = `${usuarios.length} usuário(s)`;
      const box = $('#lista-usuarios');
      box.className = 'tabela-wrap';
      box.innerHTML = `
        <table class="tabela">
          <thead><tr><th>Nome</th><th>Perfil</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            ${usuarios.map((u) => `
              <tr class="${u.ativo ? '' : 'inativo'}">
                <td><strong>${esc(u.nome)}</strong><div class="sub">${esc(u.email)}</div></td>
                <td><span class="selo selo-perfil">${esc(u.perfil)}</span></td>
                <td>${esc(formatarDataHora(u.ultimo_login))}</td>
                <td><span class="selo ${u.ativo ? 'selo-ativo' : 'selo-inativo'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td class="acoes"><button type="button" class="icone-botao" data-editar="${u.id}" title="Perfil, situação e senha provisória"><i class="fas fa-pen"></i></button></td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (erro) {
      $('#lista-usuarios').className = 'aviso-erro';
      $('#lista-usuarios').textContent = mensagemErro(erro);
    }
  }

  // Senha provisória fácil de ditar (sem letras que confundem: l, 1, O, 0)
  const gerarProvisoria = () => {
    const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const n = new Uint32Array(10);
    crypto.getRandomValues(n);
    return Array.from(n, (x) => letras[x % letras.length]).join('');
  };

  function formularioUsuario(u = {}) {
    const souEu = u.id === usuario.id;
    const novo = !u.id;
    abrirModal(novo ? 'Novo usuário' : 'Acesso do usuário', `
      <form novalidate>
        <div class="grade-campos">
          ${novo ? `
            <div class="campo larga"><label>Nome *</label><input name="nome" required maxlength="100"></div>
            <div class="campo larga"><label>E-mail (login) *</label><input name="email" type="email" required maxlength="150"></div>`
          : `
            <div class="campo larga dados-pessoais">
              <span class="avatar grande" aria-hidden="true">${esc(iniciais(u.nome))}</span>
              <div><strong>${esc(u.nome)}</strong><span>${esc(u.email)}</span></div>
            </div>
            <p class="nota larga"><i class="fas fa-lock"></i> Nome, e-mail e senha são pessoais: só ${souEu ? 'você altera, em <a href="#perfil">Meu perfil</a>' : 'o próprio usuário altera, em Meu perfil'}.</p>`}
          <div class="campo">
            <label>Perfil *</label>
            <select name="perfil_id" ${souEu ? 'disabled' : ''}>
              ${perfis.map((p) => `<option value="${p.id}" ${p.id === (u.perfil_id || 3) ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
            </select>
            ${souEu ? '<small>Você não pode mudar o seu próprio perfil.</small>' : ''}
          </div>
          <div class="campo">
            <label>Situação</label>
            <select name="ativo" ${souEu ? 'disabled' : ''}>
              <option value="true" ${u.ativo !== false ? 'selected' : ''}>Ativo</option>
              <option value="false" ${u.ativo === false ? 'selected' : ''}>Inativo</option>
            </select>
          </div>
          ${souEu ? '' : `
          <div class="campo larga">
            <label>${novo ? 'Senha provisória *' : 'Nova senha provisória (para quem esqueceu)'}</label>
            <div class="linha-senha">
              <input name="senha" type="text" minlength="6" autocomplete="off" spellcheck="false" ${novo ? 'required' : ''}>
              <button type="button" class="btn btn-secundario" id="gerar-provisoria">Gerar</button>
            </div>
            <small>${novo ? 'Passe para a pessoa: no primeiro acesso ela é obrigada a criar a senha dela.' : 'Deixe em branco para não mexer. Se preencher, a pessoa entra com ela e é obrigada a criar uma nova.'}</small>
          </div>`}
        </div>
        ${RODAPE_FORMULARIO}
      </form>`);

    const gerar = $('#gerar-provisoria');
    if (gerar) gerar.addEventListener('click', () => { $('#modal-corpo [name="senha"]').value = gerarProvisoria(); });

    ligarFormulario(async (dados) => {
      const corpo = {};
      if (!souEu) {
        corpo.perfil_id = Number(dados.perfil_id);
        corpo.ativo = dados.ativo === 'true';
        if (dados.senha) corpo.senha = dados.senha;
      }
      if (novo) {
        await api('/usuarios', { metodo: 'POST', corpo: { ...corpo, nome: dados.nome, email: dados.email } });
        toast('Usuário criado. Passe a senha provisória para a pessoa.');
      } else if (!souEu) {
        await api(`/usuarios/${u.id}`, { metodo: 'PUT', corpo });
        toast(dados.senha ? 'Senha provisória definida.' : 'Acesso atualizado.');
      }
      carregar();
    });
  }

  cliqueDaTela = (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    if (alvo.id === 'btn-novo-usuario') formularioUsuario();
    if (alvo.dataset.editar) formularioUsuario(usuarios.find((u) => u.id === Number(alvo.dataset.editar)));
  };

  carregar();
}

// ---------------------------------------------------------------------
// TROCAR A PRÓPRIA SENHA (qualquer perfil)
// ---------------------------------------------------------------------
function abrirTrocaSenha(obrigatoria = false) {
  Modal.obrigatorio = obrigatoria;
  $('#modal-fechar').hidden = obrigatoria;

  abrirModal(obrigatoria ? 'Crie a sua senha' : 'Trocar senha', `
    <form novalidate>
      ${obrigatoria ? `<p>Bem-vindo(a) ao Xylo! Você entrou com uma <strong>senha provisória</strong>.
         Para continuar, crie uma senha só sua.</p>` : ''}
      <div class="grade-campos">
        <div class="campo larga"><label>${obrigatoria ? 'Senha provisória' : 'Senha atual'}</label><input name="senha_atual" type="password" required autocomplete="current-password"></div>
        <div class="campo larga"><label>Nova senha</label><input name="nova_senha" type="password" required minlength="6" autocomplete="new-password"><small>Mínimo de 6 caracteres.</small></div>
        <div class="campo larga"><label>Repita a nova senha</label><input name="confirmar" type="password" required autocomplete="new-password"></div>
      </div>
      ${obrigatoria ? `
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" id="btn-sair-troca">Sair</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar e continuar</button>
        </div>` : RODAPE_FORMULARIO}
    </form>`);

  if (obrigatoria) $('#btn-sair-troca').addEventListener('click', sair);

  ligarFormulario(async (dados) => {
    if (dados.nova_senha !== dados.confirmar) throw new Error('As senhas novas não são iguais.');
    if (dados.nova_senha === dados.senha_atual) throw new Error('A nova senha precisa ser diferente da atual.');
    await api('/usuarios/minha-senha', { metodo: 'PUT', corpo: { senha_atual: dados.senha_atual, nova_senha: dados.nova_senha } });

    // Atualiza a sessão para não pedir de novo
    usuario.deve_trocar_senha = false;
    localStorage.setItem('wc_usuario', JSON.stringify(usuario));
    Modal.obrigatorio = false;
    toast(obrigatoria ? 'Senha criada. Bom trabalho!' : 'Senha alterada.');
  });
}

// Começa
navegar();

// Entrou com senha provisória? Obriga a criar uma senha própria antes de usar o sistema.
if (usuario.deve_trocar_senha) abrirTrocaSenha(true);
