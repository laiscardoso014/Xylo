// =====================================================================
// Xylo (CTech) - Painel do Desenvolvedor (dev.html)
//   - Solicitações vindas do formulário do index.html
//   - Aprovar: cria a empresa + o Administrador com senha provisória
//   - Empresas: bloquear/desbloquear e gerar nova senha do administrador
// Sessão separada da sessão das empresas (chave wc_dev_token).
// Usa o comum.js ($, esc, toast, modal, máscaras, formatação, requisicao).
// =====================================================================

const CHAVE_TOKEN = 'wc_dev_token';
const CHAVE_DEV = 'wc_dev';

const conteudo = $('#conteudo');

// ---------------------------------------------------------------------
// Sessão e chamadas à API
// ---------------------------------------------------------------------
const SessaoDev = {
  token: () => localStorage.getItem(CHAVE_TOKEN),
  dev: () => { try { return JSON.parse(localStorage.getItem(CHAVE_DEV)) || {}; } catch { return {}; } },
  salvar(d) { localStorage.setItem(CHAVE_TOKEN, d.token); localStorage.setItem(CHAVE_DEV, JSON.stringify(d.dev)); },
  limpar() { localStorage.removeItem(CHAVE_TOKEN); localStorage.removeItem(CHAVE_DEV); },
};

// Chamada à API do painel (todas as rotas começam com /dev)
async function api(caminho, opcoes = {}) {
  const r = await requisicao(`/dev${caminho}`, { ...opcoes, token: SessaoDev.token() });

  if (r.status === 401 && caminho !== '/login') {
    SessaoDev.limpar();
    mostrarLogin('Sua sessão expirou. Entre novamente.');
    throw new Error('Sessão expirada.');
  }
  if (!r.ok) throw erroDaResposta(r.dados);
  return r.dados;
}

// ---------------------------------------------------------------------
// Cores dos status das solicitações (classes do dev.css)
// ---------------------------------------------------------------------
const CLASSE_STATUS = {
  Pendente: 'selo-pendente', 'Em contato': 'selo-contato', Aprovada: 'selo-ativo', Recusada: 'selo-recusada',
};

// ---------------------------------------------------------------------
// Mostra os dados de acesso (só aparecem UMA vez: a senha não fica salva)
// ---------------------------------------------------------------------
function mostrarAcesso(titulo, acesso, nomePessoa, whatsapp) {
  if (acesso.convite) return mostrarConvite(titulo, acesso, nomePessoa, whatsapp);
  const linkLogin = new URL('login.html', location.href).href;
  const mensagem =
`Olá${nomePessoa ? ', ' + nomePessoa.split(' ')[0] : ''}! Seu acesso ao Xylo está pronto.

Acesse: ${linkLogin}
CNPJ: ${formatarCnpj(acesso.cnpj)}
E-mail: ${acesso.email}
Senha provisória: ${acesso.senha_provisoria}

No primeiro acesso você vai criar a sua própria senha.`;

  const fone = String(whatsapp || '').replace(/\D/g, '');
  const linkWhats = fone ? `https://wa.me/55${fone}?text=${encodeURIComponent(mensagem)}` : '';

  abrirModal(titulo, `
    <div class="aviso-info"><i class="fas fa-triangle-exclamation"></i>
      Copie agora: por segurança, a senha provisória <strong>não fica salva</strong> e não aparece de novo.</div>
    <div class="credenciais" id="texto-acesso">${esc(mensagem)}</div>
    <div class="modal-rodape">
      ${linkWhats ? `<a class="btn btn-secundario" href="${esc(linkWhats)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Enviar no WhatsApp</a>` : ''}
      <button type="button" class="btn btn-primario" id="btn-copiar"><i class="fas fa-copy"></i> Copiar mensagem</button>
    </div>`);

  $('#btn-copiar').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(mensagem);
      toast('Mensagem copiada.');
    } catch {
      // navegador sem permissão de área de transferência: seleciona o texto para Ctrl+C
      const r = document.createRange();
      r.selectNodeContents($('#texto-acesso'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Texto selecionado: use Ctrl+C.');
    }
  });
}

// Empresa nova: o administrador recebe o e-mail de ativação (confirma o
// e-mail e cria a senha). Aqui só mostramos se o e-mail saiu.
function mostrarConvite(titulo, acesso, nomePessoa, whatsapp) {
  const c = acesso.convite;
  const primeiro = nomePessoa ? `, ${nomePessoa.split(' ')[0]}` : '';
  const mensagem = c.modo_teste
    ? `Olá${primeiro}! Seu acesso ao Xylo está pronto.\n\nAbra este link para confirmar o seu e-mail e criar a sua senha (vale 48 horas):\n${c.link_teste}\n\nDepois, entre com o CNPJ ${formatarCnpj(acesso.cnpj)} e o e-mail ${acesso.email}.`
    : `Olá${primeiro}! Seu acesso ao Xylo está pronto.\n\nEnviamos um e-mail para ${acesso.email} com o link para confirmar o endereço e criar a sua senha (vale 48 horas). Confira também a caixa de spam.\n\nDepois, entre com o CNPJ ${formatarCnpj(acesso.cnpj)} e esse e-mail.`;
  const aviso = c.enviado
    ? `<div class="aviso-info ok"><i class="fas fa-envelope-circle-check"></i> E-mail de ativação enviado para <strong>${esc(acesso.email)}</strong>.</div>`
    : c.modo_teste
      ? '<div class="aviso-info"><i class="fas fa-triangle-exclamation"></i> Modo teste: o servidor não tem e-mail configurado (EMAIL_* no .env). Mande o link abaixo para a pessoa.</div>'
      : `<div class="aviso-info"><i class="fas fa-triangle-exclamation"></i> A empresa foi criada, mas o e-mail não saiu: ${esc(c.erro || 'erro no servidor de e-mail')}. Corrija e use "Nova senha" do administrador, ou peça para a pessoa usar "Esqueci minha senha" no login.</div>`;
  const fone = String(whatsapp || '').replace(/\D/g, '');
  const linkWhats = fone && (c.enviado || c.modo_teste) ? `https://wa.me/55${fone}?text=${encodeURIComponent(mensagem)}` : '';
  abrirModal(titulo, `
    ${aviso}
    ${c.enviado || c.modo_teste ? `<div class="credenciais" id="texto-acesso">${esc(mensagem)}</div>` : ''}
    <div class="modal-rodape">
      ${linkWhats ? `<a class="btn btn-secundario" href="${esc(linkWhats)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Avisar no WhatsApp</a>` : ''}
      ${c.enviado || c.modo_teste ? '<button type="button" class="btn btn-primario" id="btn-copiar"><i class="fas fa-copy"></i> Copiar mensagem</button>' : '<button type="button" class="btn btn-primario" data-cancelar>Fechar</button>'}
    </div>`);
  const copiar = $('#btn-copiar');
  if (copiar) {
    copiar.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(mensagem); toast('Mensagem copiada.'); } catch { toast('Selecione o texto e use Ctrl+C.'); }
    });
  }
  const fechar = $('#modal-corpo [data-cancelar]');
  if (fechar) fechar.addEventListener('click', fecharModal);
}

// ---------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------
function mostrarLogin(mensagem) {
  $('#tela-painel').hidden = true;
  $('#tela-login').hidden = false;
  fecharModal();
  document.title = 'Painel CTech · Xylo';
  const erro = $('#dev-erro');
  erro.textContent = mensagem || '';
  erro.hidden = !mensagem;
  $('#dev-email').focus();
}

$('#form-login-dev').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = $('#btn-entrar-dev');
  $('#dev-erro').hidden = true;
  botao.disabled = true;
  try {
    const d = await api('/login', { metodo: 'POST', corpo: { email: $('#dev-email').value.trim(), senha: $('#dev-senha').value } });
    SessaoDev.salvar(d);
    $('#dev-senha').value = '';
    iniciarPainel();
  } catch (erro) {
    $('#dev-erro').textContent = erro.message;
    $('#dev-erro').hidden = false;
  } finally {
    botao.disabled = false;
  }
});

$('#btn-sair').addEventListener('click', () => {
  SessaoDev.limpar();
  location.hash = '';
  mostrarLogin();
});

$('#btn-menu').addEventListener('click', () => $('#menu').classList.toggle('aberto'));

// ---------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------
let cliqueDaTela = null;
conteudo.addEventListener('click', (e) => { if (cliqueDaTela) cliqueDaTela(e); });

const TELAS = {
  inicio: { titulo: 'Visão geral', desenhar: telaInicio },
  solicitacoes: { titulo: 'Solicitações', desenhar: telaSolicitacoes },
  empresas: { titulo: 'Empresas', desenhar: telaEmpresas },
  cobranca: { titulo: 'Cobrança · mensalidades', desenhar: () => telaCobranca() }, // js/devCobranca.js
};

function navegar() {
  if (!SessaoDev.token()) return;
  const rota = TELAS[location.hash.replace('#', '')] ? location.hash.replace('#', '') : 'inicio';
  document.querySelectorAll('.menu-itens a[data-rota]').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === rota));
  $('#menu').classList.remove('aberto');
  cliqueDaTela = null;
  $('#titulo-pagina').textContent = TELAS[rota].titulo;
  document.title = `${TELAS[rota].titulo} · Painel CTech`;
  TELAS[rota].desenhar();
}
window.addEventListener('hashchange', navegar);

async function atualizarBadge() {
  try {
    const r = await api('/resumo');
    $('#badge-pendentes').textContent = r.pendentes || '';
    // Cobrança: faturas vencidas + pagamentos que a empresa avisou (para dar baixa)
    const cobrar = (r.faturas_vencidas || 0) + (r.pagamentos_informados || 0);
    $('#badge-cobranca').textContent = cobrar || '';
    $('#badge-cobranca').title = cobrar ? `${r.faturas_vencidas || 0} vencida(s), ${r.pagamentos_informados || 0} pagamento(s) informado(s)` : '';
    return r;
  } catch {
    return null;
  }
}

function iniciarPainel() {
  $('#tela-login').hidden = true;
  $('#tela-painel').hidden = false;
  $('#info-dev').textContent = SessaoDev.dev().nome || '';
  atualizarBadge();
  navegar();
}

// ---------------------------------------------------------------------
// VISÃO GERAL
// ---------------------------------------------------------------------
async function telaInicio() {
  conteudo.innerHTML = '<div class="carregando">Carregando…</div>';
  const r = await atualizarBadge();
  if (!r) {
    conteudo.innerHTML = '<div class="aviso-erro">Não foi possível carregar o resumo.</div>';
    return;
  }
  const cartao = (icone, valor, texto, link) => `
    <a class="card cartao" href="${link}" style="text-decoration:none">
      <div class="cartao-icone"><i class="fas ${icone}"></i></div>
      <div><strong>${valor}</strong><span>${texto}</span></div>
    </a>`;
  conteudo.innerHTML = `
    <div class="card">
      <h2>Olá, ${esc(SessaoDev.dev().nome)}!</h2>
      <p>${r.pendentes
        ? `Você tem <strong>${r.pendentes}</strong> solicitação(ões) esperando resposta.`
        : 'Nenhuma solicitação pendente no momento.'}</p>
    </div>
    <div class="cartoes">
      ${cartao('fa-inbox', r.pendentes, 'Solicitações pendentes', '#solicitacoes')}
      ${cartao('fa-phone', r.em_contato, 'Em contato', '#solicitacoes')}
      ${cartao('fa-building', r.empresas_ativas, 'Empresas ativas', '#empresas')}
      ${cartao('fa-lock', r.empresas_bloqueadas, 'Empresas bloqueadas', '#empresas')}
      ${cartao('fa-users', r.usuarios_ativos, 'Usuários ativos', '#empresas')}
      ${cartao('fa-sack-dollar', esc(formatarMoeda(r.recebido_mes || 0)), 'Recebido no mês', '#cobranca')}
      ${cartao('fa-triangle-exclamation', r.faturas_vencidas || 0, 'Faturas vencidas', '#cobranca')}
      ${cartao('fa-bell', r.pagamentos_informados || 0, 'Pagamentos para confirmar', '#cobranca')}
    </div>`;
}

// ---------------------------------------------------------------------
// SOLICITAÇÕES
// ---------------------------------------------------------------------
let filtroStatus = 'abertas';

async function telaSolicitacoes() {
  const filtros = [['abertas', 'Em aberto'], ['Pendente', 'Pendentes'], ['Em contato', 'Em contato'],
    ['Aprovada', 'Aprovadas'], ['Recusada', 'Recusadas'], ['todas', 'Todas']];

  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <div class="filtros">${filtros.map(([v, t]) =>
        `<button type="button" class="filtro ${v === filtroStatus ? 'ativo' : ''}" data-filtro="${v}">${t}</button>`).join('')}</div>
      <span class="espaco"></span>
      <span class="contador" id="contador-sol"></span>
    </div>
    <div class="card sem-padding"><div id="lista-sol" class="carregando">Carregando…</div></div>`;

  let lista = [];

  async function carregar() {
    try {
      const todas = await api('/solicitacoes');
      lista = todas.filter((s) => filtroStatus === 'todas'
        || (filtroStatus === 'abertas' ? ['Pendente', 'Em contato'].includes(s.status) : s.status === filtroStatus));
      $('#contador-sol').textContent = `${lista.length} solicitação(ões)`;
      desenhar();
      atualizarBadge();
    } catch (erro) {
      $('#lista-sol').className = 'aviso-erro';
      $('#lista-sol').textContent = erro.message;
    }
  }

  function desenhar() {
    const box = $('#lista-sol');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = 'Nenhuma solicitação neste filtro.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela">
        <thead><tr><th>Recebida</th><th>Empresa</th><th>Contato</th><th>Porte</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${lista.map((s) => `
            <tr>
              <td>${formatarData(s.created_at)}</td>
              <td><strong>${esc(s.nome_empresa)}</strong><div class="sub">${esc(formatarCnpj(s.cnpj)) || 'CNPJ não informado'}</div></td>
              <td>${esc(s.nome_completo)}<div class="sub">${esc(formatarTelefone(s.whatsapp))} · ${esc(s.email_corporativo)}</div></td>
              <td>${esc(s.numero_funcionarios)} func.<div class="sub">${esc(s.faturamento_mensal)}</div></td>
              <td><span class="selo ${CLASSE_STATUS[s.status] || ''}">${esc(s.status)}</span>
                  ${s.empresa_criada ? `<div class="sub">→ ${esc(s.empresa_criada)}</div>` : ''}</td>
              <td class="acoes">
                <button type="button" class="icone-botao" data-ver="${s.id}" title="Ver detalhes"><i class="fas fa-eye"></i></button>
                ${s.status !== 'Aprovada' ? `<button type="button" class="btn btn-primario pequeno" data-aprovar="${s.id}"><i class="fas fa-check"></i> Aprovar</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function verDetalhes(s) {
    abrirModal(s.nome_empresa, `
      <dl class="detalhes">
        <dt>Situação</dt><dd><span class="selo ${CLASSE_STATUS[s.status] || ''}">${esc(s.status)}</span>
          ${s.atendido_por_nome ? ` · por ${esc(s.atendido_por_nome)}` : ''}</dd>
        <dt>Recebida em</dt><dd>${esc(formatarDataHora(s.created_at))}</dd>
        <dt>Responsável</dt><dd>${esc(s.nome_completo)}</dd>
        <dt>WhatsApp</dt><dd>${esc(formatarTelefone(s.whatsapp))}</dd>
        <dt>E-mail</dt><dd>${esc(s.email_corporativo)}</dd>
        <dt>CNPJ</dt><dd>${esc(formatarCnpj(s.cnpj)) || '–'}</dd>
        <dt>Funcionários</dt><dd>${esc(s.numero_funcionarios)}</dd>
        <dt>Faturamento</dt><dd>${esc(s.faturamento_mensal)}</dd>
        <dt>Regime fiscal</dt><dd>${esc(s.regime_fiscal)}</dd>
        <dt>Mensagem</dt><dd>${esc(s.observacoes) || '–'}</dd>
      </dl>
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga">
            <label>Anotação interna (só você vê)</label>
            <textarea name="observacao_interna" rows="3" placeholder="Ex.: liguei dia 26, pediu demonstração">${esc(s.observacao_interna)}</textarea>
          </div>
          ${s.status !== 'Aprovada' ? `
          <div class="campo">
            <label>Situação</label>
            <select name="status">
              ${['Pendente', 'Em contato', 'Recusada'].map((st) => `<option ${st === s.status ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Fechar</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar</button>
        </div>
      </form>`);

    ligarFormulario(async (dados) => {
      await api(`/solicitacoes/${s.id}`, { metodo: 'PUT', corpo: dados });
      toast('Solicitação atualizada.');
      carregar();
    });
  }

  function aprovar(s) {
    abrirModal('Aprovar e criar empresa', `
      <p>Confira os dados. Ao confirmar, o sistema cria a empresa e o usuário <strong>Administrador</strong> dela
         com uma senha provisória.</p>
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga"><label>Nome da empresa *</label><input name="nome_empresa" required maxlength="150" value="${esc(s.nome_empresa)}"></div>
          <div class="campo larga"><label>Razão social</label><input name="razao_social" maxlength="150"></div>
          <div class="campo larga"><label>CNPJ *</label><input name="cnpj" id="ap-cnpj" required maxlength="18" value="${esc(formatarCnpj(s.cnpj))}">
            <small>É com este CNPJ que a empresa vai entrar no sistema.</small></div>
          <div class="campo"><label>Nome do administrador *</label><input name="admin_nome" required maxlength="100" value="${esc(s.nome_completo)}"></div>
          <div class="campo"><label>E-mail do administrador *</label><input name="admin_email" type="email" required maxlength="150" value="${esc(s.email_corporativo)}"></div>
        </div>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-building-circle-check"></i> Criar empresa</button>
        </div>
      </form>`);
    mascaraCnpj($('#ap-cnpj'));
    conferirCampoEmail($('#modal-corpo [name="admin_email"]'));

    ligarFormulario(async (dados) => {
      const r = await api(`/solicitacoes/${s.id}/aprovar`, { metodo: 'POST', corpo: dados });
      carregar();
      mostrarAcesso(`Empresa criada: ${r.empresa.nome}`, r.acesso, dados.admin_nome, s.whatsapp);
      return false; // o modal agora mostra os dados de acesso
    });
  }

  cliqueDaTela = (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.filtro) {
      filtroStatus = alvo.dataset.filtro;
      document.querySelectorAll('.filtro').forEach((f) => f.classList.toggle('ativo', f === alvo));
      carregar();
    }
    const achar = (id) => lista.find((s) => s.id === Number(id));
    if (alvo.dataset.ver) verDetalhes(achar(alvo.dataset.ver));
    if (alvo.dataset.aprovar) aprovar(achar(alvo.dataset.aprovar));
  };

  carregar();
}

// ---------------------------------------------------------------------
// EMPRESAS
// ---------------------------------------------------------------------
async function telaEmpresas() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <input type="search" class="busca" id="busca-empresa" placeholder="Buscar por nome ou CNPJ…">
      <span class="contador" id="contador-emp"></span>
      <span class="espaco"></span>
      <button type="button" class="btn btn-primario" id="btn-nova-empresa"><i class="fas fa-plus"></i> Nova empresa</button>
    </div>
    <div class="card sem-padding"><div id="lista-emp" class="carregando">Carregando…</div></div>`;

  let empresas = [];

  async function carregar() {
    try {
      empresas = await api('/empresas');
      desenhar();
      atualizarBadge();
    } catch (erro) {
      $('#lista-emp').className = 'aviso-erro';
      $('#lista-emp').textContent = erro.message;
    }
  }

  function desenhar() {
    const termo = $('#busca-empresa').value.trim().toLowerCase();
    const termoNum = termo.replace(/\D/g, '');
    const lista = empresas.filter((e) => !termo || e.nome.toLowerCase().includes(termo) || (termoNum && e.cnpj.includes(termoNum)));
    $('#contador-emp').textContent = `${lista.length} de ${empresas.length}`;

    const box = $('#lista-emp');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = empresas.length ? 'Nenhuma empresa encontrada na busca.' : 'Nenhuma empresa cadastrada ainda.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela">
        <thead><tr><th>Empresa</th><th>Administrador</th><th>Uso</th><th>Mensalidade</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${lista.map((e) => `
            <tr class="${e.ativo ? '' : 'inativo'}">
              <td><strong>${esc(e.nome)}</strong><div class="sub">${esc(formatarCnpj(e.cnpj))}</div></td>
              <td>${esc(e.admin_email || '–')}</td>
              <td>${e.usuarios} usuário(s)<div class="sub">${e.viagens} viagem(ns)</div></td>
              <td>${e.mensalidade ? `${esc(formatarMoeda(e.mensalidade))}<div class="sub">vence dia ${e.dia_vencimento}${e.cobrar_desde ? ` · desde ${esc(e.cobrar_desde.split('-').reverse().join('/'))}` : ''}</div>` : '<span class="sub">não cobrada</span>'}
                ${e.faturas_vencidas ? `<div><span class="selo selo-vencida">${e.faturas_vencidas} vencida(s)</span></div>` : ''}</td>
              <td>${esc(formatarDataHora(e.ultimo_acesso))}</td>
              <td><span class="selo ${e.ativo ? 'selo-ativo' : 'selo-recusada'}">${e.ativo ? 'Ativa' : 'Bloqueada'}</span></td>
              <td class="acoes">
                <button type="button" class="icone-botao" data-plano="${e.id}" title="Mensalidade e vencimento" aria-label="Mensalidade de ${esc(e.nome)}"><i class="fas fa-receipt"></i></button>
                <button type="button" class="icone-botao" data-senha="${e.id}" title="Gerar nova senha do administrador"><i class="fas fa-key"></i></button>
                ${e.ativo
                  ? `<button type="button" class="icone-botao perigo" data-bloquear="${e.id}" title="Bloquear acesso"><i class="fas fa-lock"></i></button>`
                  : `<button type="button" class="icone-botao" data-desbloquear="${e.id}" title="Desbloquear acesso"><i class="fas fa-lock-open"></i></button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function novaEmpresa() {
    abrirModal('Nova empresa', `
      <p>Use quando a empresa fechou com você sem passar pelo formulário do site.</p>
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga"><label>Nome da empresa *</label><input name="nome_empresa" required maxlength="150"></div>
          <div class="campo larga"><label>Razão social</label><input name="razao_social" maxlength="150"></div>
          <div class="campo"><label>CNPJ *</label><input name="cnpj" id="ne-cnpj" required maxlength="18"></div>
          <div class="campo"><label>Telefone</label><input name="telefone" id="ne-telefone" maxlength="15" placeholder="(49) 99999-9999"></div>
          <div class="campo"><label>Nome do administrador *</label><input name="admin_nome" required maxlength="100"></div>
          <div class="campo"><label>E-mail do administrador *</label><input name="admin_email" type="email" required maxlength="150"></div>
        </div>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Criar empresa</button>
        </div>
      </form>`);
    mascaraCnpj($('#ne-cnpj'));
    conferirCampoEmail($('#modal-corpo [name="admin_email"]'));
    mascaraTelefone($('#ne-telefone'));

    ligarFormulario(async (dados) => {
      const r = await api('/empresas', { metodo: 'POST', corpo: dados });
      carregar();
      mostrarAcesso(`Empresa criada: ${r.empresa.nome}`, r.acesso, dados.admin_nome, dados.telefone);
      return false;
    });
  }

  cliqueDaTela = async (ev) => {
    const alvo = ev.target.closest('button');
    if (!alvo) return;
    const empresa = (id) => empresas.find((e) => e.id === Number(id));
    try {
      if (alvo.id === 'btn-nova-empresa') novaEmpresa();
      if (alvo.dataset.plano) editarPlano(empresa(alvo.dataset.plano), carregar); // js/devCobranca.js

      if (alvo.dataset.bloquear) {
        const e = empresa(alvo.dataset.bloquear);
        if (!confirm(`Bloquear ${e.nome}? Todos os usuários dela perdem o acesso na hora (os dados são mantidos).`)) return;
        await api(`/empresas/${e.id}`, { metodo: 'PUT', corpo: { ativo: false } });
        toast('Empresa bloqueada.');
        carregar();
      }
      if (alvo.dataset.desbloquear) {
        await api(`/empresas/${alvo.dataset.desbloquear}`, { metodo: 'PUT', corpo: { ativo: true } });
        toast('Empresa desbloqueada.');
        carregar();
      }
      if (alvo.dataset.senha) {
        const e = empresa(alvo.dataset.senha);
        if (!confirm(`Gerar uma nova senha provisória para o administrador de ${e.nome}? A senha atual dele deixa de funcionar.`)) return;
        const r = await api(`/empresas/${e.id}/nova-senha-admin`, { metodo: 'POST' });
        mostrarAcesso(`Nova senha: ${e.nome}`, r.acesso, '', e.telefone);
      }
    } catch (erro) {
      toast(erro.message, 'erro');
    }
  };

  $('#busca-empresa').addEventListener('input', desenhar);
  carregar();
}

// ---------------------------------------------------------------------
// Começa
// ---------------------------------------------------------------------
if (SessaoDev.token()) iniciarPainel();
else mostrarLogin();
