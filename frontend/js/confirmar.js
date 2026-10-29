// =====================================================================
// Xylo - página do link do e-mail (confirmar.html?t=...)
//   convite     -> confirma o e-mail e cria a senha (conta nova)
//   nova_senha  -> cria uma senha nova ("esqueci minha senha")
//   troca_email -> confirma o e-mail novo (o login só muda agora)
// Depende do comum.js (requisicao, erroDaResposta, formatarCnpj).
// =====================================================================
(function () {
  const $id = (id) => document.getElementById(id);
  const token = new URLSearchParams(window.location.search).get('t') || '';
  // Tira o token da barra de endereço (não fica no histórico nem em prints de tela)
  if (token && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);

  const loginCom = (d) => {
    const p = new URLSearchParams();
    if (d && d.cnpj) p.set('cnpj', d.cnpj);
    if (d && d.email) p.set('email', d.email);
    return `login.html${p.toString() ? `?${p}` : ''}`;
  };

  function mostrar(qual) {
    ['carregando', 'formSenha', 'formEmail', 'resultado'].forEach((id) => { $id(id).hidden = id !== qual; });
    $id('linkLogin').hidden = qual === 'resultado';
  }

  function resultado({ ok, titulo, texto, botao, href }) {
    $id('resultadoIcone').className = `estado-icone${ok ? '' : ' ruim'}`;
    $id('resultadoIcone').innerHTML = `<i class="fas ${ok ? 'fa-check' : 'fa-link-slash'}"></i>`;
    $id('resultadoTitulo').textContent = titulo;
    $id('resultadoTexto').textContent = texto;
    $id('resultadoBotao').innerHTML = `<i class="fas fa-right-to-bracket"></i> ${botao || 'Ir para o login'}`;
    $id('resultadoBotao').href = href || 'login.html';
    mostrar('resultado');
    $id('resultadoBotao').focus();
  }

  function linkComProblema(erro, dados) {
    const reenviar = dados && dados.tipo === 'convite'
      ? ' Na tela de login, entre com o seu e-mail e use "Reenviar o e-mail de ativação", ou peça ao administrador da empresa um convite novo.'
      : dados && dados.tipo === 'nova_senha'
        ? ' Na tela de login, use "Esqueci minha senha" para receber outro link.'
        : '';
    resultado({ ok: false, titulo: 'Não foi possível usar este link', texto: `${erro}${reenviar}`, href: loginCom(dados) });
  }

  function erroNoForm(form, texto) {
    const caixa = form.querySelector('.login-error');
    caixa.querySelector('span').textContent = texto;
    caixa.classList.toggle('visivel', Boolean(texto));
  }
  function carregando(form, sim) {
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = sim;
    botao.querySelector('.login-button-text').style.display = sim ? 'none' : '';
    botao.querySelector('.login-loading').style.display = sim ? '' : 'none';
  }

  async function confirmar(form, corpo) {
    erroNoForm(form, '');
    carregando(form, true);
    try {
      const r = await requisicao('/conta/confirmar', { metodo: 'POST', corpo: { t: token, ...corpo } });
      if (r.status === 410) return linkComProblema(r.dados.erro, null);
      if (!r.ok) throw erroDaResposta(r.dados);
      return r.dados;
    } catch (erro) {
      erroNoForm(form, erro.message);
      return null;
    } finally {
      carregando(form, false);
    }
  }

  // ---- Senha: regras ao vivo -------------------------------------------
  const REGRAS = {
    tamanho: (s) => s.length >= 8,
    letra: (s) => /[A-Za-z]/.test(s),
    numero: (s) => /\d/.test(s),
  };
  $id('senha').addEventListener('input', () => {
    document.querySelectorAll('#regras li').forEach((li) => li.classList.toggle('ok', REGRAS[li.dataset.regra]($id('senha').value)));
  });
  document.querySelectorAll('[data-mostrar]').forEach((b) => b.addEventListener('click', () => {
    const campos = [$id('senha'), $id('senha2')];
    const mostrando = campos[0].type === 'text';
    campos.forEach((c) => { c.type = mostrando ? 'password' : 'text'; });
    b.innerHTML = `<i class="fas ${mostrando ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
    b.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Esconder senha');
  }));

  // ---- Início ----------------------------------------------------------
  async function iniciar() {
    if (token.length < 20) {
      return linkComProblema('Este link está incompleto. Abra de novo pelo botão do e-mail ou copie o endereço inteiro.', null);
    }
    let r;
    try {
      r = await requisicao(`/conta/link?t=${encodeURIComponent(token)}`);
    } catch (erro) {
      return resultado({ ok: false, titulo: 'Sem conexão', texto: erro.message, botao: 'Tentar de novo', href: `confirmar.html?t=${encodeURIComponent(token)}` });
    }
    if (!r.ok) return linkComProblema((r.dados && r.dados.erro) || 'Este link não é válido.', r.dados);
    const d = r.dados;
    const primeiroNome = (d.nome || '').split(/\s+/)[0];

    if (d.tipo === 'troca_email') {
      $id('emailTexto').textContent = `${primeiroNome ? `${primeiroNome}, ` : ''}confirme para passar a entrar no Xylo (${d.empresa}) com este e-mail. Até confirmar, o login continua com ${d.email_atual}.`;
      $id('emailNovo').textContent = d.email;
      mostrar('formEmail');
      $id('formEmail').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await confirmar(e.target, {});
        if (ok) {
          resultado({ ok: true, titulo: 'E-mail confirmado', texto: `A partir de agora, entre no Xylo com ${ok.email}.`, href: loginCom(ok) });
        }
      });
      return;
    }

    const convite = d.tipo === 'convite';
    $id('senhaRotulo').textContent = convite ? 'Ativar acesso' : 'Nova senha';
    $id('senhaTitulo').textContent = convite ? `Olá${primeiroNome ? `, ${primeiroNome}` : ''}! Crie a sua senha` : 'Crie uma nova senha';
    $id('senhaTexto').textContent = convite
      ? `O seu e-mail foi confirmado ao abrir este link. Agora crie a senha para entrar no Xylo da empresa ${d.empresa}.`
      : `Escolha a nova senha do seu acesso ao Xylo (${d.empresa}). A senha antiga deixa de valer.`;
    $id('senhaEmail').textContent = d.email;
    $id('senhaBotao').textContent = convite ? 'Ativar meu acesso' : 'Salvar a nova senha';
    mostrar('formSenha');
    $id('senha').focus();

    $id('formSenha').addEventListener('submit', async (e) => {
      e.preventDefault();
      const senha = $id('senha').value;
      const falta = Object.entries(REGRAS).find(([, testar]) => !testar(senha));
      if (falta) return erroNoForm(e.target, 'A senha precisa ter pelo menos 8 caracteres, com letras e números.');
      if (senha !== $id('senha2').value) return erroNoForm(e.target, 'As duas senhas não são iguais.');
      const ok = await confirmar(e.target, { senha });
      if (ok) {
        resultado({
          ok: true,
          titulo: convite ? 'Acesso ativado!' : 'Senha alterada',
          texto: convite ? 'Pronto: o seu e-mail foi confirmado e a senha criada. Entre com o CNPJ da empresa, o seu e-mail e a senha nova.'
            : 'Pronto. Entre com a senha nova.',
          botao: 'Entrar no Xylo',
          href: loginCom(ok),
        });
      }
    });
  }

  iniciar();
}());
