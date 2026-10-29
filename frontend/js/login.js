// =====================================================================
// Xylo - tela de login (login.html)
// Depende do comum.js (mascaraCnpj) e do api.js (api, Sessao).
// =====================================================================

const PAGINA_INICIAL = 'main.html'; // para onde ir depois de entrar

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('formLogin');
  const campoCnpj = document.getElementById('cnpj');
  const campoEmail = document.getElementById('email');
  const campoSenha = document.getElementById('senha');
  const areaErro = document.getElementById('erro');

  if (!form || !campoCnpj || !campoEmail || !campoSenha) {
    console.error('login.js: faltam ids no login.html (formLogin, cnpj, email, senha).');
    return;
  }

  // Abrir a tela de login sempre encerra a sessão anterior:
  // o usuário só entra digitando CNPJ, e-mail e senha.
  Sessao.limpar();

  // Máscara do CNPJ enquanto digita: 00.000.000/0000-00 (comum.js)
  mascaraCnpj(campoCnpj, { conferir: false });

  // Vindo da página de confirmação (confirmar.html): CNPJ e e-mail já preenchidos
  const parametros = new URLSearchParams(window.location.search);
  if (parametros.get('cnpj')) campoCnpj.value = montarCnpj(soDigitos(parametros.get('cnpj')).slice(0, 14));
  if (parametros.get('email')) campoEmail.value = parametros.get('email');
  if (parametros.get('cnpj') && parametros.get('email')) campoSenha.focus();

  // comReenvio: conta ainda não ativada -> botão para mandar o e-mail de novo
  function mostrarErro(texto, comReenvio = false) {
    if (!areaErro) return texto && alert(texto);
    // Mantém o ícone do aviso: escreve só no <span> de dentro, se existir
    const alvo = areaErro.querySelector('span') || areaErro;
    alvo.textContent = texto;
    areaErro.classList.toggle('visivel', Boolean(texto));
    const reenviar = document.getElementById('btnReenviar');
    if (reenviar) reenviar.hidden = !comReenvio;
  }

  // Troca o texto do botão por "Entrando..." enquanto espera a resposta
  function carregando(sim) {
    const botao = form.querySelector('button[type="submit"]');
    if (!botao) return;
    botao.disabled = sim;
    const texto = botao.querySelector('.login-button-text');
    const espera = botao.querySelector('.login-loading');
    if (texto && espera) {
      texto.style.display = sim ? 'none' : '';
      espera.style.display = sim ? '' : 'none';
    }
  }

  // ---- Avisos ------------------------------------------------------------
  const areaAviso = document.getElementById('aviso');
  const btnReenviar = document.getElementById('btnReenviar');
  function mostrarAviso(texto) {
    if (!areaAviso) return;
    areaAviso.querySelector('span').textContent = texto;
    areaAviso.classList.toggle('visivel', Boolean(texto));
  }

  // ---- "Esqueci minha senha": o mesmo formulário, sem o campo de senha ----
  const grupoSenha = document.getElementById('grupoSenha');
  const btnEsqueci = document.getElementById('btnEsqueci');
  const btnVoltar = document.getElementById('btnVoltarLogin');
  const titulo = document.querySelector('.login-card-header h2');
  const subtitulo = document.querySelector('.login-card-header p');
  const rotulo = document.querySelector('.welcome-label');
  const textoBotao = form.querySelector('.login-button-text');
  const textoEspera = form.querySelector('.login-loading');
  const ORIGINAL = {
    rotulo: rotulo && rotulo.textContent, titulo: titulo && titulo.textContent, subtitulo: subtitulo && subtitulo.textContent,
    botao: textoBotao && textoBotao.innerHTML, espera: textoEspera && textoEspera.innerHTML,
  };
  let modoEsqueci = false;

  function trocarModo(esqueci) {
    modoEsqueci = esqueci;
    mostrarErro('');
    mostrarAviso('');
    if (grupoSenha) grupoSenha.hidden = esqueci;
    campoSenha.required = !esqueci;
    if (btnEsqueci) btnEsqueci.parentElement.hidden = esqueci;
    if (btnVoltar) btnVoltar.hidden = !esqueci;
    if (titulo) titulo.textContent = esqueci ? 'Criar nova senha' : ORIGINAL.titulo;
    if (rotulo) rotulo.textContent = esqueci ? 'Recuperar acesso' : ORIGINAL.rotulo;
    if (subtitulo) {
      subtitulo.textContent = esqueci
        ? 'Informe o CNPJ da empresa e o seu e-mail. Enviaremos um link para você criar uma senha nova.'
        : ORIGINAL.subtitulo;
    }
    if (textoBotao) textoBotao.innerHTML = esqueci ? '<i class="fas fa-paper-plane"></i> Enviar link' : ORIGINAL.botao;
    if (textoEspera) textoEspera.innerHTML = esqueci ? '<i class="fas fa-spinner fa-spin"></i> Enviando...' : ORIGINAL.espera;
    (campoCnpj.value ? campoEmail : campoCnpj).focus();
  }
  if (btnEsqueci) btnEsqueci.addEventListener('click', () => trocarModo(true));
  if (btnVoltar) btnVoltar.addEventListener('click', () => trocarModo(false));

  // Pedido de link (nova senha ou reenvio da ativação): a resposta é sempre a mesma
  async function pedirLink(caminho) {
    const r = await requisicao(caminho, { metodo: 'POST', corpo: { cnpj: campoCnpj.value, email: campoEmail.value.trim() } });
    if (!r.ok) throw erroDaResposta(r.dados);
    return r.dados.mensagem;
  }

  if (btnReenviar) {
    btnReenviar.addEventListener('click', async () => {
      btnReenviar.disabled = true;
      try {
        const msg = await pedirLink('/conta/reenviar');
        mostrarErro('');
        mostrarAviso(msg);
      } catch (erro) {
        mostrarErro(erro.message);
      } finally {
        btnReenviar.disabled = false;
      }
    });
  }

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('');
    mostrarAviso('');

    carregando(true);

    try {
      if (modoEsqueci) {
        mostrarAviso(await pedirLink('/conta/esqueci'));
        return;
      }
      const dados = await api('/auth/login', {
        metodo: 'POST',
        corpo: {
          cnpj: campoCnpj.value,
          email: campoEmail.value.trim(),
          senha: campoSenha.value,
        },
      });
      Sessao.salvar(dados);
      window.location.href = PAGINA_INICIAL;
    } catch (erro) {
      mostrarErro(erro.message, erro.codigo === 'EMAIL_NAO_CONFIRMADO');
    } finally {
      carregando(false);
    }
  });
});
