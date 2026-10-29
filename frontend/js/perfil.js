// =====================================================================
// Xylo - MEU PERFIL (#perfil) e DADOS DA EMPRESA (#empresa)
//
// Meu perfil: cada usuário vê e altera SÓ os próprios dados (nome, e-mail,
// telefone e senha). Nenhum outro perfil tem acesso a eles.
// Dados da empresa: só o Administrador. A logo enviada aqui aparece no topo
// do sistema e no cabeçalho dos relatórios impressos / PDF.
//
// Depende do comum.js, api.js e main.js (conteudo, usuario, dadosEmpresa,
// aplicarUsuario, aplicarEmpresa, iniciais, PERFIL).
// =====================================================================

// Cabeçalho com a identidade da empresa (usado nos relatórios e na prévia)
function cabecalhoEmpresaHTML(titulo, subtitulo) {
  const e = dadosEmpresa || {};
  const local = [e.cidade, e.uf].filter(Boolean).join('/');
  const linha2 = [e.razao_social && e.razao_social !== e.nome ? e.razao_social : '', e.cnpj ? `CNPJ ${formatarCnpj(e.cnpj)}` : '', local]
    .filter(Boolean).map(esc).join(' · ');
  return `
    <div class="cabecalho-empresa">
      ${e.logo ? `<img src="${esc(e.logo)}" alt="Logo ${esc(e.nome)}">` : ''}
      <div>
        <strong>${esc(e.nome || '')}</strong>
        ${linha2 ? `<span>${linha2}</span>` : ''}
        ${e.telefone || e.email ? `<span>${[e.telefone ? formatarTelefone(e.telefone) : '', e.email || ''].filter(Boolean).map(esc).join(' · ')}</span>` : ''}
      </div>
    </div>
    ${titulo ? `<h2>${esc(titulo)}</h2>` : ''}
    ${subtitulo ? `<span class="emitido">${esc(subtitulo)}</span>` : ''}`;
}

// ---------------------------------------------------------------------
// MEU PERFIL
// ---------------------------------------------------------------------
async function telaPerfil() {
  conteudo.innerHTML = '<div class="carregando">Carregando…</div>';
  let eu;
  try {
    eu = await api('/usuarios/eu');
  } catch (erro) {
    conteudo.innerHTML = `<p class="aviso-erro">${esc(mensagemErro(erro))}</p>`;
    return;
  }
  if (!$('#conteudo') || location.hash !== '#perfil') return;

  const quando = (d) => (d ? formatarDataHora(d) : 'nunca');
  conteudo.innerHTML = `
    <section class="card perfil-cabecalho">
      <span class="avatar enorme" aria-hidden="true" id="perfil-avatar">${esc(iniciais(eu.nome))}</span>
      <div>
        <h2 id="perfil-nome">${esc(eu.nome)}</h2>
        <p><span class="selo selo-perfil">${esc(eu.perfil)}</span> · ${esc(dadosEmpresa.nome || '')}</p>
        <p class="sub">Acesso atual desde ${esc(quando(eu.ultimo_login))} · Usuário desde ${esc(formatarData(eu.created_at))}</p>
      </div>
    </section>

    <p class="nota aviso-privado"><i class="fas fa-lock"></i> Estes dados são só seus: nenhum outro usuário, nem o administrador, consegue ver a sua senha ou alterar o seu nome, e-mail e telefone.</p>

    <div class="grade-perfil">
      <section class="card">
        <h3>Dados pessoais</h3>
        <form id="form-perfil" novalidate>
          <div class="campo"><label for="p-nome">Nome completo *</label><input id="p-nome" name="nome" required maxlength="100" autocomplete="name" value="${esc(eu.nome)}"></div>
          <div class="campo"><label for="p-email">E-mail (usado no login) *</label><input id="p-email" name="email" type="email" required maxlength="150" autocomplete="email" value="${esc(eu.email)}"></div>
          <div class="campo" id="campo-confirma-email" hidden>
            <label for="p-senha-email">Sua senha atual</label>
            <input id="p-senha-email" name="senha_atual" type="password" autocomplete="current-password">
            <small>Para trocar o e-mail de login, confirme que é você. Vamos mandar um link para o e-mail novo: o login só muda depois que você clicar nele.</small>
          </div>
          <p class="nota" id="email-pendente" style="margin: 0 0 14px" ${eu.email_pendente ? '' : 'hidden'}><i class="fas fa-envelope"></i> <span>${eu.email_pendente ? `Aguardando você confirmar <strong>${esc(eu.email_pendente)}</strong> pelo link enviado. Até lá, o login continua com ${esc(eu.email)}.` : ''}</span></p>
          <div class="campo"><label for="p-telefone">Telefone / WhatsApp</label><input id="p-telefone" name="telefone" type="tel" placeholder="(49) 99999-9999" value="${esc(eu.telefone || '')}"></div>
          <div class="form-erro" hidden></div>
          <div class="acoes-form"><button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar dados</button></div>
        </form>
      </section>

      <section class="card">
        <h3>Senha</h3>
        <p class="sub">Última troca: ${esc(eu.senha_alterada_em ? formatarDataHora(eu.senha_alterada_em) : 'ainda não trocada')}</p>
        <form id="form-senha" novalidate>
          <div class="campo"><label for="s-atual">Senha atual *</label><input id="s-atual" name="senha_atual" type="password" required autocomplete="current-password"></div>
          <div class="campo">
            <label for="s-nova">Nova senha *</label>
            <input id="s-nova" name="nova_senha" type="password" required minlength="6" autocomplete="new-password" aria-describedby="forca-senha">
            <div class="forca" id="forca-senha" aria-live="polite"><span class="barra-forca"><span></span></span><small></small></div>
          </div>
          <div class="campo"><label for="s-confirma">Repita a nova senha *</label><input id="s-confirma" name="confirmar" type="password" required autocomplete="new-password"></div>
          <label class="opcao"><input type="checkbox" id="mostrar-senhas"> Mostrar senhas</label>
          <div class="form-erro" hidden></div>
          <div class="acoes-form"><button type="submit" class="btn btn-primario"><i class="fas fa-key"></i> Trocar senha</button></div>
        </form>
      </section>
    </div>`;

  mascaraTelefone($('#p-telefone'));
  conferirCampoEmail($('#p-email'));

  // Trocou o e-mail? Pede a senha atual
  $('#p-email').addEventListener('input', (e) => {
    $('#campo-confirma-email').hidden = e.target.value.trim().toLowerCase() === eu.email;
  });

  // Força da senha (orientação; o mínimo exigido é 6 caracteres)
  const avaliar = (s) => {
    if (!s) return [0, ''];
    let pontos = 0;
    if (s.length >= 8) pontos++;
    if (s.length >= 12) pontos++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) pontos++;
    if (/\d/.test(s)) pontos++;
    if (/[^A-Za-z0-9]/.test(s)) pontos++;
    if (s.length < 6) return [1, 'Curta demais: use pelo menos 6 caracteres'];
    return pontos <= 1 ? [1, 'Fraca'] : pontos <= 3 ? [2, 'Média'] : [3, 'Forte'];
  };
  $('#s-nova').addEventListener('input', (e) => {
    const [nivel, texto] = avaliar(e.target.value);
    const forca = $('#forca-senha');
    forca.dataset.nivel = nivel;
    forca.querySelector('small').textContent = texto;
  });
  $('#mostrar-senhas').addEventListener('change', (e) => {
    document.querySelectorAll('#form-senha input[type="password"], #form-senha input[data-senha]').forEach((i) => {
      i.dataset.senha = '1';
      i.type = e.target.checked ? 'text' : 'password';
    });
  });

  // Envio dos formulários (erros aparecem dentro do próprio formulário)
  const ligar = (form, salvar) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erroBox = form.querySelector('.form-erro');
      const botao = form.querySelector('button[type="submit"]');
      erroBox.hidden = true;
      botao.disabled = true;
      try {
        await salvar(Object.fromEntries(new FormData(form).entries()));
      } catch (erro) {
        erroBox.textContent = mensagemErro(erro);
        erroBox.hidden = false;
      } finally {
        botao.disabled = false;
      }
    });
  };

  ligar($('#form-perfil'), async (d) => {
    const corpo = { nome: d.nome, email: d.email, telefone: d.telefone };
    if (!$('#campo-confirma-email').hidden) corpo.senha_atual = d.senha_atual;
    eu = await api('/usuarios/eu', { metodo: 'PUT', corpo });
    // atualiza a sessão e o topo da tela
    Object.assign(usuario, { nome: eu.nome, email: eu.email });
    try { localStorage.setItem('wc_usuario', JSON.stringify(usuario)); } catch { /* ignora */ }
    aplicarUsuario();
    $('#perfil-nome').textContent = eu.nome;
    $('#perfil-avatar').textContent = iniciais(eu.nome);
    $('#campo-confirma-email').hidden = true;
    $('#p-senha-email').value = '';
    const conf = eu.confirmacao_email;
    if (conf) {
      // o e-mail de login ainda é o antigo: volta o campo e mostra o aviso
      $('#p-email').value = eu.email;
      const aviso = $('#email-pendente');
      aviso.querySelector('span').innerHTML = `Aguardando você confirmar <strong>${esc(conf.para)}</strong> pelo link enviado. Até lá, o login continua com ${esc(eu.email)}.`;
      aviso.hidden = false;
      toast(conf.enviado
        ? `Enviamos um link para ${conf.para}. Abra esse e-mail e confirme: só então o login muda.`
        : 'Modo teste: o servidor não tem e-mail configurado. O link de confirmação apareceu no console do servidor.', conf.enviado ? 'ok' : 'aviso');
    } else {
      toast('Seus dados foram atualizados.');
    }
  });

  ligar($('#form-senha'), async (d) => {
    if (d.nova_senha.length < 6) throw new Error('A nova senha precisa ter pelo menos 6 caracteres.');
    if (d.nova_senha !== d.confirmar) throw new Error('As senhas novas não são iguais.');
    if (d.nova_senha === d.senha_atual) throw new Error('A nova senha precisa ser diferente da atual.');
    await api('/usuarios/minha-senha', { metodo: 'PUT', corpo: { senha_atual: d.senha_atual, nova_senha: d.nova_senha } });
    $('#form-senha').reset();
    $('#forca-senha').dataset.nivel = 0;
    $('#forca-senha small').textContent = '';
    toast('Senha alterada.');
  });
}

// ---------------------------------------------------------------------
// DADOS DA EMPRESA (só Administrador)
// ---------------------------------------------------------------------
async function telaEmpresa() {
  if (!PERFIL.admin) {
    conteudo.innerHTML = '<p class="aviso-erro">Acesso restrito ao Administrador.</p>';
    return;
  }
  conteudo.innerHTML = '<div class="carregando">Carregando…</div>';
  let e;
  try {
    e = await api('/empresa');
  } catch (erro) {
    conteudo.innerHTML = `<p class="aviso-erro">${esc(mensagemErro(erro))}</p>`;
    return;
  }
  if (location.hash !== '#empresa') return;

  conteudo.innerHTML = `
    <div class="grade-perfil">
      <section class="card">
        <h3>Logo da empresa</h3>
        <p class="sub">Aparece no topo do sistema e no cabeçalho dos relatórios impressos e em PDF.</p>
        <div class="area-logo" id="area-logo"></div>
        <input type="file" id="arquivo-logo" accept="image/png,image/jpeg,image/webp" hidden>
        <div class="acoes-form">
          <button type="button" class="btn btn-primario" id="btn-enviar-logo"><i class="fas fa-upload"></i> Enviar logo</button>
          <button type="button" class="btn btn-secundario" id="btn-remover-logo"><i class="fas fa-trash"></i> Remover</button>
        </div>
        <small class="sub">PNG, JPG ou WEBP. De preferência com fundo transparente. A imagem é ajustada sozinha.</small>
      </section>

      <section class="card">
        <h3>Dados cadastrais</h3>
        <form id="form-empresa" novalidate>
          <div class="grade-campos">
            <div class="campo larga"><label for="e-nome">Nome (fantasia) *</label><input id="e-nome" name="nome" required maxlength="150" value="${esc(e.nome)}"></div>
            <div class="campo larga"><label for="e-razao">Razão social</label><input id="e-razao" name="razao_social" maxlength="150" value="${esc(e.razao_social || '')}"></div>
            <div class="campo"><label for="e-cnpj">CNPJ</label><input id="e-cnpj" value="${esc(formatarCnpj(e.cnpj))}" readonly aria-describedby="ajuda-cnpj">
              <small id="ajuda-cnpj">É o login da empresa: para alterar, fale com o suporte CTech.</small></div>
            <div class="campo"><label for="e-telefone">Telefone</label><input id="e-telefone" name="telefone" type="tel" value="${esc(e.telefone || '')}" placeholder="(49) 3222-2222"></div>
            <div class="campo larga"><label for="e-email">E-mail</label><input id="e-email" name="email" type="email" maxlength="150" value="${esc(e.email || '')}"></div>
            <div class="campo larga"><label for="e-endereco">Endereço</label><input id="e-endereco" name="endereco" maxlength="200" value="${esc(e.endereco || '')}" placeholder="Rua, número, bairro"></div>
            <div class="campo"><label for="e-cidade">Cidade</label><input id="e-cidade" name="cidade" maxlength="100" value="${esc(e.cidade || '')}"></div>
            <div class="campo"><label for="e-uf">UF</label><input id="e-uf" name="uf" maxlength="2" value="${esc(e.uf || '')}" placeholder="SC"></div>
          </div>
          <div class="form-erro" hidden></div>
          <div class="acoes-form"><button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar dados</button></div>
        </form>
      </section>
    </div>

    <section class="card">
      <h3>Prévia do cabeçalho dos relatórios</h3>
      <div class="previa-cabecalho" id="previa-cabecalho"></div>
    </section>`;

  mascaraTelefone($('#e-telefone'));
  $('#e-uf').addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/[^a-z]/gi, '').toUpperCase(); });

  const atualizarTudo = (dados) => {
    dadosEmpresa = dados;
    aplicarEmpresa();
    $('#area-logo').innerHTML = dados.logo
      ? `<img src="${esc(dados.logo)}" alt="Logo atual da empresa">`
      : `<span class="sem-logo" aria-label="Sem logo">${esc(iniciais(dados.nome))}</span><small>Nenhuma logo enviada</small>`;
    $('#btn-remover-logo').hidden = !dados.logo;
    $('#previa-cabecalho').innerHTML = cabecalhoEmpresaHTML('Fechamento do mês — janeiro/2026', `Emitido em ${new Date().toLocaleString('pt-BR')} · Xylo`);
  };
  atualizarTudo(e);

  // Logo: reduz para no máximo 600×240 px antes de enviar (fica leve e nítida)
  async function prepararLogo(arquivo) {
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) throw new Error('Envie uma imagem PNG, JPG ou WEBP.');
    if (arquivo.size > 8 * 1024 * 1024) throw new Error('Imagem grande demais (máximo 8 MB).');
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((ok, falha) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => falha(new Error('Não foi possível abrir a imagem.'));
        i.src = url;
      });
      const escala = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // PNG mantém o fundo transparente; JPG fica menor
      let dados = arquivo.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
      if (dados.length > 680000) dados = canvas.toDataURL('image/jpeg', 0.8);
      return dados;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $('#btn-enviar-logo').addEventListener('click', () => $('#arquivo-logo').click());
  $('#arquivo-logo').addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    ev.target.value = '';
    if (!arquivo) return;
    const botao = $('#btn-enviar-logo');
    botao.disabled = true;
    try {
      const logo = await prepararLogo(arquivo);
      atualizarTudo(await api('/empresa/logo', { metodo: 'PUT', corpo: { logo } }));
      toast('Logo atualizada.');
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    } finally {
      botao.disabled = false;
    }
  });
  $('#btn-remover-logo').addEventListener('click', async () => {
    if (!confirm('Remover a logo da empresa?')) return;
    try {
      await api('/empresa/logo', { metodo: 'DELETE' });
      atualizarTudo({ ...dadosEmpresa, logo: null });
      toast('Logo removida.');
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  });

  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const erroBox = form.querySelector('.form-erro');
    const botao = form.querySelector('button[type="submit"]');
    erroBox.hidden = true;
    botao.disabled = true;
    try {
      atualizarTudo(await api('/empresa', { metodo: 'PUT', corpo: Object.fromEntries(new FormData(form).entries()) }));
      toast('Dados da empresa atualizados.');
    } catch (erro) {
      erroBox.textContent = mensagemErro(erro);
      erroBox.hidden = false;
    } finally {
      botao.disabled = false;
    }
  });
}
