// =====================================================================
// Xylo - funções compartilhadas por todas as páginas
//
// Carregue este arquivo ANTES dos outros scripts da página:
//   index.html  -> comum.js, script.js
//   login.html  -> comum.js, api.js, login.js
//   main.html   -> comum.js, api.js, main.js
//   dev.html    -> comum.js, dev.js
//
// Antes, estas funções estavam copiadas em vários arquivos. Agora, para
// mudar uma máscara, uma mensagem ou o endereço da API, basta mexer aqui.
// =====================================================================

// Endereço da API (backend). Na publicação, troque só esta linha.
// Endereço da API:
//  - aberto pelo próprio servidor (na web ou em http://localhost:3000): o mesmo site + /api
//  - aberto pelo Live Server (porta 5500) ou direto do arquivo: o servidor local na porta 3000
const API_URL = (location.protocol === 'file:' || location.port === '5500' || location.port === '5501')
  ? 'http://localhost:3000/api'
  : `${location.origin}/api`;

// Atalho para buscar um elemento: $('#id') ou $('.classe')
const $ = (seletor, dentro = document) => dentro.querySelector(seletor);

// ---------------------------------------------------------------------
// Texto e formatação
// ---------------------------------------------------------------------

// Escapa texto antes de colocar no HTML (evita quebrar a tela ou injeção de código)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

// 12345678000199 -> 12.345.678/0001-99
function formatarCnpj(valor) {
  const d = soDigitos(valor);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (valor || '');
}

// CPF (11 números) ou CNPJ (14 números)
function formatarDocumento(valor) {
  const d = soDigitos(valor);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return formatarCnpj(valor);
}

// 49999990000 -> (49) 99999-0000
function formatarTelefone(valor) {
  const d = soDigitos(valor);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return valor || '';
}

// R$ 10.293,80
const formatarMoeda = (v) => (v === null || v === undefined || v === ''
  ? '–'
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// 46,79 (peso em toneladas, sempre com 2 casas)
const formatarPeso = (v) => (v === null || v === undefined || v === ''
  ? '–'
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }));

// Lê um número digitado: "46,79", "1.234,56" ou "46.79" -> 46.79 (NaN se inválido)
function lerNumero(valor) {
  let texto = String(valor ?? '').trim();
  if (texto === '') return NaN;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(texto) ? Number(texto) : NaN;
}

// "2026-01-08" -> 08/01/2026 (sem erro de fuso horário)
function formatarDataISO(iso) {
  if (!iso) return '–';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// Hoje e o mês atual no formato dos campos de data: "2026-10-28" e "2026-10"
function hojeISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}
const mesAtualISO = () => hojeISO().slice(0, 7);

const formatarData = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '–');
const formatarDataHora = (v) => (v
  ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : 'Nunca');

// ---------------------------------------------------------------------
// Máscaras de digitação
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// VALIDAÇÃO de CPF, CNPJ e telefone (mesma regra do backend: src/utils/documentos.js)
// ---------------------------------------------------------------------
function cpfValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const digito = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(c[9]) && digito(10) === Number(c[10]);
}

function cnpjValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const digito = (n) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(c[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(c[12]) && digito(13) === Number(c[13]);
}

const DDDS_BRASIL = [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99];

// Celular: DDD + 9 + 8 números. Fixo: DDD + (2 a 5) + 7 números.
function telefoneValido(valor) {
  const t = soDigitos(valor);
  if (!DDDS_BRASIL.includes(Number(t.slice(0, 2)))) return false;
  if (t.length === 11) return t[2] === '9';
  if (t.length === 10) return /[2-5]/.test(t[2]);
  return false;
}

// Diz o que está errado (ou '' se estiver certo / vazio)
function problemaCnpj(valor) {
  const n = soDigitos(valor).length;
  if (!n) return '';
  if (n < 14) return `Faltam ${14 - n} número${14 - n > 1 ? 's' : ''} no CNPJ.`;
  return cnpjValido(valor) ? '' : 'CNPJ inválido: confira os números.';
}
function problemaDocumento(valor) {
  const n = soDigitos(valor).length;
  if (!n) return '';
  if (n === 11) return cpfValido(valor) ? '' : 'CPF inválido: confira os números.';
  if (n === 14) return cnpjValido(valor) ? '' : 'CNPJ inválido: confira os números.';
  return n < 11 ? `CPF incompleto: faltam ${11 - n} número${11 - n > 1 ? 's' : ''}.` : `CNPJ incompleto: faltam ${14 - n} número${14 - n > 1 ? 's' : ''}.`;
}
function problemaTelefone(valor) {
  const t = soDigitos(valor);
  if (!t.length) return '';
  if (t.length < 10) return 'Telefone incompleto: use DDD + número.';
  if (!DDDS_BRASIL.includes(Number(t.slice(0, 2)))) return `DDD ${t.slice(0, 2)} não existe.`;
  if (t.length === 11 && t[2] !== '9') return 'Celular com 11 números começa com 9 depois do DDD.';
  if (t.length === 10 && !/[2-5]/.test(t[2])) return 'Fixo começa com 2, 3, 4 ou 5 depois do DDD (celular precisa do 9).';
  return '';
}

// ---------------------------------------------------------------------
// MÁSCARAS de digitação
// O campo só aceita números e no máximo a quantidade certa; a pontuação
// entra sozinha. Colar "11.222.333/0001-81" ou "11 2223330001 81" também
// funciona. Ao sair do campo, avisa embaixo se o número estiver errado.
// ---------------------------------------------------------------------
function aplicarMascara(input, { max, formatar, problema, rotulo }) {
  if (!input || input.dataset.mascara) return;
  input.dataset.mascara = '1';
  if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', input.type === 'tel' ? 'tel' : 'numeric');
  // O limite é de NÚMEROS (feito abaixo), não de caracteres: assim colar
  // "CNPJ: 11.222.333/0001-81" funciona, e o maxlength do navegador não corta antes
  input.removeAttribute('maxlength');
  if (!input.getAttribute('autocomplete')) input.setAttribute('autocomplete', 'off');
  if (rotulo) input.setAttribute('aria-label', rotulo);

  // Bloqueia letras/símbolos e o que passar do limite, antes de aparecer na tela
  input.addEventListener('beforeinput', (e) => {
    if (!e.data || !e.inputType.startsWith('insert')) return; // apagar, desfazer etc. sempre podem
    const digitosNovos = soDigitos(e.data);
    if (!digitosNovos) { e.preventDefault(); return; }
    const selecionado = soDigitos(input.value.slice(input.selectionStart, input.selectionEnd)).length;
    if (soDigitos(input.value).length - selecionado + digitosNovos.length > max && e.inputType !== 'insertFromPaste') {
      e.preventDefault();
    }
  });

  // Põe o cursor logo depois do n-ésimo número
  const cursorDepoisDe = (n) => {
    let pos = 0;
    let vistos = 0;
    while (pos < input.value.length && vistos < n) {
      if (/\d/.test(input.value[pos])) vistos++;
      pos++;
    }
    if (document.activeElement === input) input.setSelectionRange(pos, pos);
  };

  // Reformata mantendo o cursor no mesmo número (dá para corrigir no meio)
  const reformatar = () => {
    const digitosAntes = soDigitos(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
    input.value = formatar(soDigitos(input.value).slice(0, max));
    cursorDepoisDe(digitosAntes);
  };

  // Colar: aproveita só os números do texto colado, no lugar do cursor/seleção
  input.addEventListener('paste', (e) => {
    const texto = e.clipboardData ? e.clipboardData.getData('text') : '';
    e.preventDefault();
    const inicio = input.selectionStart ?? input.value.length;
    const fim = input.selectionEnd ?? inicio;
    const antes = soDigitos(input.value.slice(0, inicio));
    const depois = soDigitos(input.value.slice(fim));
    const novos = soDigitos(texto).slice(0, Math.max(max - antes.length - depois.length, 0));
    input.value = formatar(antes + novos + depois);
    cursorDepoisDe(antes.length + novos.length);
    if (input.getAttribute('aria-invalid') === 'true') verificar();
  });
  input.addEventListener('input', () => {
    reformatar();
    if (input.getAttribute('aria-invalid') === 'true') verificar(); // some o aviso assim que corrigir
  });

  // Aviso embaixo do campo
  const aviso = document.createElement('small');
  aviso.className = 'aviso-campo';
  aviso.id = `${input.id || input.name || 'campo'}-aviso-${Math.random().toString(36).slice(2, 7)}`;
  aviso.hidden = true;
  // (no login o campo fica dentro de um "wrapper" com ícone: o aviso vai embaixo dele)
  (input.closest('.input-wrapper') || input).insertAdjacentElement('afterend', aviso);
  input.setAttribute('aria-describedby', aviso.id);
  const verificar = () => {
    const msg = problema(input.value);
    aviso.textContent = msg;
    aviso.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    input.setCustomValidity(msg);
  };
  input.addEventListener('blur', verificar);
  input.addEventListener('change', verificar);

  if (input.value) input.value = formatar(soDigitos(input.value).slice(0, max)); // valor vindo do banco
}

// 00.000.000/0000-00 (formata o que já foi digitado, mesmo incompleto)
function montarCnpj(d) {
  return d.replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
// até 11 números: CPF 000.000.000-00; do 12º em diante: CNPJ
function montarDocumento(d) {
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  }
  return montarCnpj(d);
}
// (49) 3222-2222 (fixo) ou (49) 99999-9999 (celular)
function montarTelefone(d) {
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const meio = d.length === 11 ? 7 : 6;
  if (d.length <= meio) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, meio)}-${d.slice(meio)}`;
}

// No login use { conferir: false }: só exige os 14 números (empresas já cadastradas sempre entram)
const mascaraCnpj = (input, { conferir = true } = {}) => aplicarMascara(input, {
  max: 14, formatar: montarCnpj,
  problema: conferir ? problemaCnpj : (v) => {
    const falta = 14 - soDigitos(v).length;
    return falta > 0 && falta < 14 ? `Falta${falta > 1 ? 'm' : ''} ${falta} número${falta > 1 ? 's' : ''} no CNPJ.` : '';
  },
});
const mascaraDocumento = (input) => aplicarMascara(input, { max: 14, formatar: montarDocumento, problema: problemaDocumento });
const mascaraTelefone = (input) => aplicarMascara(input, { max: 11, formatar: montarTelefone, problema: problemaTelefone });

// ---------------------------------------------------------------------
// E-MAIL: ao sair do campo, pergunta à API se o e-mail parece existir
// (formato, domínio que recebe e-mail, erro de digitação como "gmial.com").
// Erro certo = aviso vermelho e o formulário não envia.
// Suspeita = aviso amarelo com botão "Usar ...", mas deixa enviar.
// (A prova final é o link que a pessoa recebe no e-mail.)
// ---------------------------------------------------------------------
function conferirCampoEmail(input) {
  if (!input || input.dataset.conferirEmail) return;
  input.dataset.conferirEmail = '1';
  const aviso = document.createElement('small');
  aviso.className = 'aviso-campo';
  aviso.id = `${input.id || input.name || 'email'}-aviso-${Math.random().toString(36).slice(2, 7)}`;
  aviso.hidden = true;
  aviso.setAttribute('aria-live', 'polite');
  (input.closest('.input-wrapper') || input).insertAdjacentElement('afterend', aviso);
  input.setAttribute('aria-describedby', aviso.id);
  const original = input.value.trim().toLowerCase(); // e-mail que já estava salvo não precisa conferir
  let consulta = 0;

  const mostrar = (texto, tipo, sugestao) => {
    aviso.hidden = !texto;
    aviso.classList.toggle('aviso-leve', tipo === 'leve');
    aviso.textContent = texto || '';
    if (sugestao) {
      const usar = document.createElement('button');
      usar.type = 'button';
      usar.className = 'aviso-usar';
      usar.textContent = `Usar ${sugestao}`;
      usar.addEventListener('click', () => { input.value = sugestao; input.dispatchEvent(new Event('change')); input.focus(); });
      aviso.append(' ', usar);
    }
    const erro = tipo === 'erro' ? texto : '';
    input.setAttribute('aria-invalid', erro ? 'true' : 'false');
    input.setCustomValidity(erro);
  };

  const conferir = async () => {
    const valor = input.value.trim();
    const minha = ++consulta;
    if (!valor || valor.toLowerCase() === original) return mostrar('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return mostrar('Este e-mail não está num formato válido (ex.: nome@empresa.com.br).', 'erro');
    try {
      const r = await requisicao(`/conta/email?email=${encodeURIComponent(valor)}`);
      if (minha !== consulta || !r.ok || !r.dados) return; // resposta velha, ou API sem conferência: não atrapalha
      if (!r.dados.ok) mostrar(r.dados.motivo, 'erro', r.dados.sugestao);
      else if (r.dados.aviso) mostrar(r.dados.aviso, 'leve', r.dados.sugestao);
      else mostrar('');
    } catch { /* sem conexão: o envio do formulário mostra o erro */ }
  };
  input.addEventListener('blur', conferir);
  input.addEventListener('change', conferir);
  input.addEventListener('input', () => { if (!aviso.hidden) { consulta++; mostrar(''); } });
}

// ---------------------------------------------------------------------
// Comunicação com a API
// ---------------------------------------------------------------------

// Faz a chamada HTTP e devolve { ok, status, dados }.
// Cada página decide o que fazer com erros de login (401): por isso o
// tratamento de sessão fica no api.js (empresas) e no dev.js (painel).
async function requisicao(caminho, { metodo = 'GET', corpo, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let resposta;
  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      method: metodo,
      headers,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (e) {
    throw new Error('Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.');
  }

  const dados = resposta.status === 204 ? null : await resposta.json().catch(() => ({}));
  return { ok: resposta.ok, status: resposta.status, dados };
}

// Transforma a resposta de erro da API em um Error com a lista de campos inválidos
function erroDaResposta(dados) {
  const erro = new Error((dados && dados.erro) || 'Erro na requisição.');
  erro.detalhes = dados && dados.detalhes;
  erro.codigo = dados && dados.codigo;       // ex.: EMAIL_NAO_CONFIRMADO no login
  erro.sugestao = dados && dados.sugestao;   // ex.: e-mail com domínio corrigido
  return erro;
}

// Texto amigável de um erro (junta as mensagens de cada campo, se houver)
function mensagemErro(erro) {
  if (erro.detalhes && erro.detalhes.length) return erro.detalhes.map((d) => d.mensagem).join(' ');
  return erro.message;
}

// ---------------------------------------------------------------------
// Aviso rápido no canto da tela (precisa de <div id="toast"> na página)
// ---------------------------------------------------------------------
// acao (opcional): { rotulo: 'Desfazer', fazer: () => {...}, ms: 10000 } -> botão no aviso
let timerToast;
function toast(texto, tipo = 'ok', acao = null) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = texto;
  t.className = `toast ${tipo}`;
  if (acao) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'toast-acao';
    botao.textContent = acao.rotulo;
    botao.addEventListener('click', () => { clearTimeout(timerToast); t.hidden = true; acao.fazer(); });
    t.append(botao);
  }
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, acao ? acao.ms || 10000 : 3500);
}

// ---------------------------------------------------------------------
// Janela (modal) - precisa de #modal, #modal-titulo, #modal-corpo e
// #modal-fechar na página (main.html e dev.html têm)
// ---------------------------------------------------------------------
const Modal = {
  // Quando true, o modal não fecha (ex.: troca de senha obrigatória)
  obrigatorio: false,
};

// Rodapé padrão dos formulários: caixa de erro + Cancelar / Salvar
const RODAPE_FORMULARIO = `
  <div class="form-erro" hidden></div>
  <div class="modal-rodape">
    <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
    <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar</button>
  </div>`;

function abrirModal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').hidden = false;
  const primeiro = $('#modal-corpo').querySelector('input:not([readonly]), select, textarea');
  if (primeiro) primeiro.focus();
}

function fecharModal() {
  if (Modal.obrigatorio) return;
  $('#modal').hidden = true;
  $('#modal').classList.remove('modal-largo', 'modal-ticket', 'modal-amplo', 'modal-medio');
  $('#modal-corpo').innerHTML = '';
  $('#modal-fechar').hidden = false;
}

// Liga o <form> do modal: lê os campos, chama salvar(dados) e mostra erros.
// Se salvar() devolver false, o modal continua aberto (para mostrar outra coisa nele).
function ligarFormulario(salvar) {
  const form = $('#modal-corpo form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroBox = form.querySelector('.form-erro');
    const botao = form.querySelector('button[type="submit"]');
    erroBox.hidden = true;
    botao.disabled = true;
    try {
      const fechar = await salvar(Object.fromEntries(new FormData(form).entries()));
      if (fechar !== false) fecharModal();
    } catch (erro) {
      erroBox.textContent = mensagemErro(erro);
      erroBox.hidden = false;
    } finally {
      botao.disabled = false;
    }
  });
  const cancelar = form.querySelector('[data-cancelar]');
  if (cancelar) cancelar.addEventListener('click', fecharModal);
}

// Fechar pelo X, clicando fora ou com Esc (só nas páginas que têm o modal)
if ($('#modal')) {
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) fecharModal();
  });
}

// ---------------------------------------------------------------------
// Logo do Xylo: clicar recarrega a página (no sistema, continua na mesma tela).
// Basta colocar data-recarregar no elemento da logo.
// ---------------------------------------------------------------------
document.querySelectorAll('[data-recarregar]').forEach((el) => {
  if (el.tagName !== 'A' && el.tagName !== 'BUTTON') {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
  }
  el.setAttribute('aria-label', 'Xylo — recarregar a página');
  el.style.cursor = 'pointer';
  const recarregar = (e) => { e.preventDefault(); window.location.reload(); };
  el.addEventListener('click', recarregar);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') recarregar(e); });
});

// ---------------------------------------------------------------------
// MOTORISTA de viagens e fretes: só os cadastrados em Funcionários
// ("É motorista"). lista = opcoes.motoristas [{ id, nome, funcionario }]
// Corrigindo carga antiga com motorista que não é funcionário: ele aparece
// como "(não cadastrado)" para não obrigar a trocar.
// ---------------------------------------------------------------------
function campoMotorista(lista, atualId, atualNome, { podeCadastrar = false } = {}) {
  const itens = [...lista];
  if (atualId && !itens.some((m) => m.id === Number(atualId))) itens.push({ id: Number(atualId), nome: `${atualNome || 'Motorista'} (não cadastrado)` });
  const rotulo = (m) => (m.funcionario && m.funcionario.toLowerCase() !== m.nome.toLowerCase() ? `${m.nome} — ${m.funcionario}` : m.nome);
  return `<div class="campo"><label>Motorista *</label>
    <select name="motorista_id" required>
      <option value="">${itens.length ? 'Selecione…' : 'Nenhum motorista cadastrado'}</option>
      ${itens.map((m) => `<option value="${m.id}" ${Number(atualId) === m.id ? 'selected' : ''}>${esc(rotulo(m))}</option>`).join('')}
    </select>
    <small>Não está na lista? ${podeCadastrar ? 'Cadastre em <a href="#funcionarios">Pessoal › Funcionários</a>' : 'Peça para cadastrar em Pessoal › Funcionários'} (marque "É motorista").</small></div>`;
}
