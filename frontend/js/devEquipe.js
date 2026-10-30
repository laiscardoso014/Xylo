// =====================================================================
// Xylo - PAINEL DO DESENVOLVEDOR: Usuários (equipe CTech e usuários das
// empresas), Histórico do painel e Lixeira.
// Usa o dev.js (api, conteudo, cliqueDaTela, atualizarBadge) e o comum.js.
// Carregar ANTES do dev.js (as telas entram na lista TELAS dele).
// =====================================================================

const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const regrasSenhaTexto = 'Pelo menos 8 caracteres, com letra e número.';

// ---------------------------------------------------------------------
// USUÁRIOS: equipe CTech (quem entra no painel) + usuários das empresas
// ---------------------------------------------------------------------
let abaUsuarios = 'equipe';

async function telaUsuarios() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <div class="filtros" role="tablist">
        <button type="button" class="filtro ${abaUsuarios === 'equipe' ? 'ativo' : ''}" data-aba-usuarios="equipe" role="tab">Equipe CTech</button>
        <button type="button" class="filtro ${abaUsuarios === 'empresas' ? 'ativo' : ''}" data-aba-usuarios="empresas" role="tab">Usuários das empresas</button>
      </div>
      <span class="espaco"></span>
      <div id="acoes-usuarios"></div>
    </div>
    <div id="area-usuarios"><div class="carregando">Carregando…</div></div>`;

  let equipe = [];
  let empresas = [];
  let usuarios = [];

  async function carregar() {
    const area = $('#area-usuarios');
    try {
      if (abaUsuarios === 'equipe') {
        equipe = await api('/equipe');
        $('#acoes-usuarios').innerHTML = `
          <button type="button" class="btn btn-secundario" data-minha-senha><i class="fas fa-key"></i> Trocar minha senha</button>
          <button type="button" class="btn btn-primario" data-novo-membro><i class="fas fa-user-plus"></i> Novo membro</button>`;
        area.innerHTML = `
          <p class="nota-tela"><i class="fas fa-circle-info" aria-hidden="true"></i>
            <span>Quem está aqui entra no painel do desenvolvedor e vê todas as empresas. Desative quem sair da equipe: o histórico do que a pessoa fez continua guardado.</span></p>
          <div class="card sem-padding"><div class="tabela-wrap"><table class="tabela">
            <thead><tr><th>Membro</th><th>Último acesso</th><th>Na equipe desde</th><th>Situação</th><th></th></tr></thead>
            <tbody>${equipe.map((d) => `
              <tr class="${d.ativo ? '' : 'inativo'}">
                <td><strong>${esc(d.nome)}</strong>${d.eu ? ' <span class="selo selo-perfil">você</span>' : ''}<div class="sub">${esc(d.email)}</div></td>
                <td>${dataHoraBR(d.ultimo_login)}</td>
                <td>${d.desde ? d.desde.split('-').reverse().join('/') : '–'}</td>
                <td><span class="selo ${d.ativo ? 'selo-ativo' : 'selo-inativo'}">${d.ativo ? 'Ativo' : 'Desativado'}</span></td>
                <td class="acoes">
                  <button type="button" class="icone-botao" data-editar-membro="${d.id}" title="Editar"><i class="fas fa-pen"></i></button>
                  ${d.eu ? '' : `<button type="button" class="icone-botao" data-senha-membro="${d.id}" title="Definir senha nova"><i class="fas fa-key"></i></button>`}
                  ${d.eu ? '' : d.ativo
                    ? `<button type="button" class="icone-botao perigo" data-desativar-membro="${d.id}" title="Desativar acesso"><i class="fas fa-user-slash"></i></button>`
                    : `<button type="button" class="icone-botao" data-reativar-membro="${d.id}" title="Reativar acesso"><i class="fas fa-user-check"></i></button>`}
                </td>
              </tr>`).join('')}</tbody>
          </table></div></div>`;
      } else {
        if (!empresas.length) empresas = await api('/empresas');
        $('#acoes-usuarios').innerHTML = `
          <select id="filtro-empresa-usu" aria-label="Empresa"><option value="">Todas as empresas</option>
            ${empresas.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')}</select>`;
        $('#filtro-empresa-usu').addEventListener('change', carregarUsuarios);
        await carregarUsuarios();
      }
    } catch (erro) {
      area.innerHTML = `<div class="aviso-erro">${esc(mensagemErro(erro))}</div>`;
    }
  }

  async function carregarUsuarios() {
    const area = $('#area-usuarios');
    const id = $('#filtro-empresa-usu') ? $('#filtro-empresa-usu').value : '';
    usuarios = await api(`/usuarios${id ? `?empresa_id=${id}` : ''}`);
    area.innerHTML = `
      <p class="nota-tela"><i class="fas fa-circle-info" aria-hidden="true"></i>
        <span>Só consulta: quem cadastra, muda o perfil ou desativa usuários é o Administrador de cada empresa (Administração › Usuários).
        Para reenviar o acesso do Administrador, use Empresas.</span></p>
      ${usuarios.length ? `<div class="card sem-padding"><div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Usuário</th><th>Empresa</th><th>Perfil</th><th>Acesso</th><th>Último acesso</th></tr></thead>
        <tbody>${usuarios.map((u) => `
          <tr class="${u.ativo && u.empresa_ativa ? '' : 'inativo'}">
            <td><strong>${esc(u.nome)}</strong><div class="sub">${esc(u.email)}</div></td>
            <td>${esc(u.empresa)}${u.empresa_ativa ? '' : '<div class="sub">empresa bloqueada</div>'}</td>
            <td><span class="selo selo-perfil">${esc(u.perfil)}</span></td>
            <td>${!u.ativo ? '<span class="selo selo-inativo">Desativado</span>' : u.ativado ? '<span class="selo selo-ativo">Ativo</span>' : '<span class="selo selo-pendente">Aguardando ativação</span>'}</td>
            <td>${dataHoraBR(u.ultimo_login)}</td>
          </tr>`).join('')}</tbody>
      </table></div></div>` : '<div class="card vazio">Nenhum usuário encontrado.</div>'}`;
  }

  function formMembro(d = {}) {
    abrirModal(d.id ? `Editar ${d.nome}` : 'Novo membro da equipe', `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga"><label>Nome *</label><input name="nome" required maxlength="100" value="${esc(d.nome)}"></div>
          <div class="campo larga"><label>E-mail (login do painel) *</label><input name="email" type="email" required maxlength="150" value="${esc(d.email)}"></div>
          ${d.id ? '' : `<div class="campo larga"><label>Senha inicial *</label><input name="senha" type="password" required minlength="8" autocomplete="new-password">
            <small>${regrasSenhaTexto} Passe a senha para a pessoa por um canal seguro; ela pode trocar depois.</small></div>`}
        </div>
        ${RODAPE_FORMULARIO}
      </form>`);
    ligarFormulario(async (dados) => {
      if (d.id) await api(`/equipe/${d.id}`, { metodo: 'PUT', corpo: { nome: dados.nome, email: dados.email } });
      else await api('/equipe', { metodo: 'POST', corpo: dados });
      toast(d.id ? 'Cadastro atualizado.' : 'Membro adicionado à equipe.');
      carregar();
    });
  }

  function formSenha(titulo, enviar, comAtual = false) {
    abrirModal(titulo, `
      <form novalidate>
        <div class="grade-campos">
          ${comAtual ? '<div class="campo larga"><label>Senha atual *</label><input name="atual" type="password" required autocomplete="current-password"></div>' : ''}
          <div class="campo larga"><label>Senha nova *</label><input name="nova" type="password" required minlength="8" autocomplete="new-password"><small>${regrasSenhaTexto}</small></div>
          <div class="campo larga"><label>Repita a senha nova *</label><input name="nova2" type="password" required autocomplete="new-password"></div>
        </div>
        ${RODAPE_FORMULARIO}
      </form>`);
    ligarFormulario(async (dados) => {
      if (dados.nova !== dados.nova2) throw new Error('As duas senhas novas não são iguais.');
      await enviar(dados);
      toast('Senha alterada.');
    });
  }

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    const membro = (id) => equipe.find((d) => d.id === Number(id));
    try {
      if (alvo.dataset.abaUsuarios) { abaUsuarios = alvo.dataset.abaUsuarios; telaUsuarios(); return; }
      if (alvo.hasAttribute('data-novo-membro')) formMembro();
      if (alvo.hasAttribute('data-minha-senha')) formSenha('Trocar minha senha', (d) => api('/minha-senha', { metodo: 'PUT', corpo: { atual: d.atual, nova: d.nova } }), true);
      if (alvo.dataset.editarMembro) formMembro(membro(alvo.dataset.editarMembro));
      if (alvo.dataset.senhaMembro) {
        const d = membro(alvo.dataset.senhaMembro);
        formSenha(`Senha nova para ${d.nome}`, (x) => api(`/equipe/${d.id}/senha`, { metodo: 'POST', corpo: { senha: x.nova } }));
      }
      if (alvo.dataset.desativarMembro) {
        const d = membro(alvo.dataset.desativarMembro);
        if (!confirm(`Desativar o acesso de ${d.nome} ao painel?`)) return;
        await api(`/equipe/${d.id}`, { metodo: 'PUT', corpo: { ativo: false } });
        toast('Acesso desativado.'); carregar();
      }
      if (alvo.dataset.reativarMembro) {
        await api(`/equipe/${alvo.dataset.reativarMembro}`, { metodo: 'PUT', corpo: { ativo: true } });
        toast('Acesso reativado.'); carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };

  carregar();
}

// ---------------------------------------------------------------------
// HISTÓRICO DO PAINEL
// ---------------------------------------------------------------------
const AREAS_HISTORICO = { acesso: 'Acessos', solicitacoes: 'Solicitações', empresas: 'Empresas', cobranca: 'Cobrança', equipe: 'Equipe', lixeira: 'Lixeira' };
const ICONE_AREA = { acesso: 'fa-right-to-bracket', solicitacoes: 'fa-inbox', empresas: 'fa-building', cobranca: 'fa-receipt', equipe: 'fa-user-shield', lixeira: 'fa-trash-can', outros: 'fa-circle' };

async function telaHistorico() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Período <select id="hist-dias"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Último ano</option></select></label>
      <label class="filtro-campo">Área <select id="hist-area"><option value="">Todas</option>${Object.entries(AREAS_HISTORICO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="filtro-campo">Quem <select id="hist-dev"><option value="">Toda a equipe</option></select></label>
    </div>
    <div id="lista-hist" class="carregando">Carregando…</div>`;

  try {
    const equipe = await api('/equipe');
    $('#hist-dev').insertAdjacentHTML('beforeend', equipe.map((d) => `<option value="${d.id}">${esc(d.nome)}</option>`).join(''));
  } catch { /* o filtro fica só com "toda a equipe" */ }

  async function carregar() {
    const box = $('#lista-hist');
    try {
      const p = new URLSearchParams({ dias: $('#hist-dias').value });
      if ($('#hist-area').value) p.set('area', $('#hist-area').value);
      if ($('#hist-dev').value) p.set('dev_id', $('#hist-dev').value);
      const itens = await api(`/historico?${p}`);
      if (!itens.length) { box.className = 'card vazio'; box.textContent = 'Nada registrado neste período.'; return; }
      // agrupa por dia
      const dias = new Map();
      itens.forEach((h) => { const d = h.data_hora.slice(0, 10); if (!dias.has(d)) dias.set(d, []); dias.get(d).push(h); });
      box.className = '';
      box.innerHTML = [...dias.entries()].map(([dia, lista]) => `
        <h3 class="dia-historico">${new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
        <div class="card sem-padding"><ul class="lista-hist-dev">${lista.map((h) => `
          <li><i class="fas ${ICONE_AREA[h.area] || ICONE_AREA.outros}" aria-hidden="true"></i>
            <div><strong>${esc(h.acao)}</strong><span class="sub">${esc(h.quem)} · ${h.data_hora.slice(11, 16)}${h.ip ? ` · IP ${esc(h.ip)}` : ''}</span></div>
            <span class="selo selo-tipo">${esc(AREAS_HISTORICO[h.area] || 'Outros')}</span></li>`).join('')}</ul></div>`).join('');
    } catch (erro) {
      box.className = 'aviso-erro'; box.textContent = mensagemErro(erro);
    }
  }
  ['#hist-dias', '#hist-area', '#hist-dev'].forEach((s) => $(s).addEventListener('change', carregar));
  carregar();
}

// ---------------------------------------------------------------------
// LIXEIRA DO PAINEL (solicitações excluídas)
// ---------------------------------------------------------------------
async function telaLixeira() {
  conteudo.innerHTML = `
    <p class="nota-tela"><i class="fas fa-circle-info" aria-hidden="true"></i>
      <span>Solicitações de acesso excluídas (teste, spam, duplicadas). Restaurar devolve a solicitação para a lista com a mesma situação. "Apagar de vez" não tem volta.</span></p>
    <div id="lista-lix" class="carregando">Carregando…</div>`;
  let itens = [];
  async function carregar() {
    const box = $('#lista-lix');
    try {
      itens = await api('/lixeira');
      if (!itens.length) { box.className = 'card vazio'; box.textContent = 'A lixeira está vazia.'; return; }
      box.className = 'card sem-padding';
      box.innerHTML = `<div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Solicitação</th><th>Excluída</th><th>Motivo</th><th></th></tr></thead>
        <tbody>${itens.map((l) => `
          <tr>
            <td><strong>${esc(l.dados.nome_empresa || l.resumo)}</strong><div class="sub">${esc(l.dados.nome_completo || '')}${l.dados.email_corporativo ? ` · ${esc(l.dados.email_corporativo)}` : ''}</div></td>
            <td>${dataHoraBR(l.excluido_em)}<div class="sub">por ${esc(l.excluido_por || '–')}</div></td>
            <td>${esc(l.motivo) || '<span class="sub">–</span>'}</td>
            <td class="acoes">
              <button type="button" class="btn btn-secundario pequeno" data-restaurar="${l.id}"><i class="fas fa-rotate-left"></i> Restaurar</button>
              <button type="button" class="icone-botao perigo" data-apagar="${l.id}" title="Apagar de vez"><i class="fas fa-trash-can"></i></button>
            </td>
          </tr>`).join('')}</tbody></table></div>`;
    } catch (erro) {
      box.className = 'aviso-erro'; box.textContent = mensagemErro(erro);
    }
  }
  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    try {
      if (alvo.dataset.restaurar) {
        await api(`/lixeira/${alvo.dataset.restaurar}/restaurar`, { metodo: 'POST' });
        toast('Solicitação restaurada.'); atualizarBadge(); carregar();
      }
      if (alvo.dataset.apagar) {
        const l = itens.find((x) => x.id === Number(alvo.dataset.apagar));
        if (!confirm(`Apagar de vez "${l.resumo}"? Não tem como desfazer.`)) return;
        await api(`/lixeira/${l.id}`, { metodo: 'DELETE' });
        toast('Apagada de vez.'); carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };
  carregar();
}
