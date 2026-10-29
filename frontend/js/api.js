// =====================================================================
// Xylo - sessão e chamadas à API do sistema das empresas
// Usado por login.html e main.html. Depende do comum.js (requisicao).
// =====================================================================

const PAGINA_LOGIN = 'login.html';

// ---- Sessão (token e dados do usuário) --------------------------------
const Sessao = {
  salvar(dados) {
    localStorage.setItem('wc_token', dados.token);
    localStorage.setItem('wc_usuario', JSON.stringify(dados.usuario));
    localStorage.setItem('wc_empresa', JSON.stringify(dados.empresa));
  },
  token() {
    return localStorage.getItem('wc_token');
  },
  usuario() {
    try { return JSON.parse(localStorage.getItem('wc_usuario')); } catch { return null; }
  },
  empresa() {
    try { return JSON.parse(localStorage.getItem('wc_empresa')); } catch { return null; }
  },
  limpar() {
    localStorage.removeItem('wc_token');
    localStorage.removeItem('wc_usuario');
    localStorage.removeItem('wc_empresa');
  },
};

// ---- Chamada à API com a sessão da empresa -----------------------------
// Exemplos:
//   const clientes = await api('/clientes');
//   await api('/clientes', { metodo: 'POST', corpo: { nome: 'ENOK' } });
async function api(caminho, opcoes = {}) {
  const r = await requisicao(caminho, { ...opcoes, token: Sessao.token() });

  // Token vencido ou acesso encerrado: volta para o login (exceto na própria tela de login)
  if (r.status === 401 && caminho !== '/auth/login') {
    Sessao.limpar();
    window.location.href = PAGINA_LOGIN;
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  if (!r.ok) throw erroDaResposta(r.dados);
  return r.dados;
}

// ---- Atalhos para as páginas -------------------------------------------
// Coloque  exigirLogin();  no começo das páginas internas (main.html)
function exigirLogin() {
  if (!Sessao.token()) window.location.href = PAGINA_LOGIN;
}

function sair() {
  Sessao.limpar();
  window.location.href = PAGINA_LOGIN;
}

// ---- Arquivos ------------------------------------------------------------
// Baixa um arquivo da API (ex.: planilha Excel) com a sessão e salva no computador.
//   await baixarArquivo('/exportacao/relatorio?tipo=clientes&mes=2026-01', 'relatorio.xlsx');
async function baixarArquivo(caminho, nomePadrao) {
  let resposta;
  try {
    resposta = await fetch(`${API_URL}${caminho}`, { headers: { Authorization: `Bearer ${Sessao.token()}` } });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.');
  }
  if (resposta.status === 401) { sair(); throw new Error('Sessão expirada. Faça login novamente.'); }
  if (!resposta.ok) throw erroDaResposta(await resposta.json().catch(() => ({})));
  const nome = (/filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '') || [])[1] || nomePadrao;
  const url = URL.createObjectURL(await resposta.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return nome;
}

// Envia um arquivo (o conteúdo vai direto no corpo) e devolve a resposta JSON.
//   await enviarArquivo('/importacao/analisar?tipo=viagens', arquivoDoInput);
async function enviarArquivo(caminho, arquivo) {
  let resposta;
  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${Sessao.token()}` },
      body: arquivo,
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.');
  }
  if (resposta.status === 401) { sair(); throw new Error('Sessão expirada. Faça login novamente.'); }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw erroDaResposta(dados);
  return dados;
}
