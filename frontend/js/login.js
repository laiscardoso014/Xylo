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

  function mostrarErro(texto) {
    if (!areaErro) return texto && alert(texto);
    // Mantém o ícone do aviso: escreve só no <span> de dentro, se existir
    const alvo = areaErro.querySelector('span') || areaErro;
    alvo.textContent = texto;
    areaErro.classList.toggle('visivel', Boolean(texto));
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

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('');

    carregando(true);

    try {
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
      mostrarErro(erro.message);
    } finally {
      carregando(false);
    }
  });
});