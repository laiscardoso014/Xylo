// =====================================================================
// Xylo (CTech) - página de venda (index.html)
//   1. Menu do celular
//   2. Máscaras de WhatsApp e CNPJ
//   3. Envio do formulário "Solicitar acesso" para a API
//   4. Demonstração da abertura (ticket -> viagem lançada)
// Depende do comum.js (máscaras e requisicao).
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
  // ---- 1. Menu do celular ------------------------------------------------
  const botaoMenu = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');

  if (botaoMenu && menu) {
    botaoMenu.addEventListener('click', () => {
      const aberto = menu.classList.toggle('open');
      botaoMenu.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
      botaoMenu.innerHTML = aberto ? '<i class="fas fa-xmark"></i>' : '<i class="fas fa-bars"></i>';
    });
    // Fecha ao escolher uma opção
    menu.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => {
        menu.classList.remove('open');
        botaoMenu.innerHTML = '<i class="fas fa-bars"></i>';
      })
    );
  }

  // ---- 2. Máscaras (comum.js) ---------------------------------------------
  mascaraTelefone(document.getElementById('whatsapp'));
  mascaraCnpj(document.getElementById('cnpj'));
  conferirCampoEmail(document.querySelector('#form-contratacao [name="email"]'));

  // ---- 3. Formulário de solicitação ---------------------------------------
  const form = document.getElementById('form-contratacao');
  const botao = document.getElementById('btn-enviar');
  const sucesso = document.getElementById('sucesso');
  if (!form) return;

  // Caixa para mostrar erros (criada aqui, logo acima do botão)
  const caixaErro = document.createElement('p');
  caixaErro.setAttribute('role', 'alert');
  caixaErro.style.cssText = 'display:none;margin:1rem 0 0;padding:.8rem 1rem;border-radius:8px;'
    + 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:.95rem;';
  botao.parentElement.insertBefore(caixaErro, botao);

  function mostrarErro(texto) {
    caixaErro.textContent = texto;
    caixaErro.style.display = texto ? 'block' : 'none';
  }

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mostrarErro('');
    sucesso.classList.remove('show');

    if (!form.checkValidity()) {
      form.reportValidity(); // mostra o aviso do próprio navegador no campo que falta
      return;
    }

    const dados = Object.fromEntries(new FormData(form).entries());
    const textoOriginal = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Enviando...</span>';

    try {
      const r = await requisicao('/solicitacoes', { metodo: 'POST', corpo: dados });
      if (!r.ok) throw erroDaResposta(r.dados);

      form.reset();
      sucesso.classList.add('show');
      sucesso.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (erro) {
      mostrarErro(erro.message);
    } finally {
      botao.disabled = false;
      botao.innerHTML = textoOriginal;
    }
  });
});

// =====================================================================
// 4. Demonstração da abertura: o ticket da balança vira a viagem lançada
//    Dados FICTÍCIOS. As contas são as mesmas do sistema:
//    peso x valor da tonelada (venda, floresta, empreiteiro) e a sobra.
// =====================================================================
(function demonstracaoTicket() {
  const demo = document.getElementById('demo-ticket');
  if (!demo) return;
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();

  const EXEMPLOS = [
    { balanca: 'SERRARIA VALE VERDE', ticket: '36627', data: '29/01/2026 14:12', placa: 'QJX-1D23', apelido: 'ODAIR', motorista: 'Odair Souza',
      produto: 'PINUS GROSSA', classe: 'Grossa', bruto: 64320, tara: 17530, venda: 280, floresta: 95, empreiteiro: 45 },
    { balanca: 'MADEIREIRA SÃO JORGE', ticket: '36841', data: '30/01/2026 09:47', placa: 'RLP-6F76', apelido: 'JOAO', motorista: 'João Pereira',
      produto: 'PINUS FINA', classe: 'Fina', bruto: 52140, tara: 16900, venda: 190, floresta: 70, empreiteiro: 38 },
    { balanca: 'LAMINADOS SERRA ALTA', ticket: '2291', data: '31/01/2026 16:05', placa: 'MIL-4B67', apelido: 'MARQUINHO', motorista: 'Marcos Lima',
      produto: 'EUCALIPTO', classe: 'Eucalipto', bruto: 58900, tara: 17200, venda: 230, floresta: 85, empreiteiro: 0 },
  ];
  const kg = (n) => `${n.toLocaleString('pt-BR')} kg`;
  const reais = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const $id = (id) => document.getElementById(id);
  const movimento = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const linhasLidas = ['ticket', 'data', 'placa', 'motorista', 'produto', 'peso'].map((c) => demo.querySelector(`[data-campo="${c}"]`));
  let atual = 0;
  let tempos = [];

  function preencher(e) {
    const liquido = e.bruto - e.tara;
    const t = liquido / 1000;
    const venda = t * e.venda; const floresta = t * e.floresta; const emp = t * e.empreiteiro;
    const sobra = venda - floresta - emp;
    $id('tk-balanca').textContent = e.balanca;
    $id('tk-numero').textContent = e.ticket;
    $id('tk-data').textContent = e.data;
    $id('tk-placa').textContent = e.placa;
    $id('tk-motorista').textContent = e.apelido;
    $id('tk-produto').textContent = e.produto;
    $id('tk-bruto').textContent = kg(e.bruto);
    $id('tk-tara').textContent = kg(e.tara);
    $id('tk-liquido').textContent = kg(liquido);
    $id('lc-motorista').innerHTML = `${e.motorista} <small>pela placa ${e.placa.replace('-', '')}</small>`;
    $id('lc-classe').textContent = e.classe;
    $id('lc-peso').textContent = `${t.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
    $id('lc-venda').textContent = reais(venda);
    $id('lc-floresta').textContent = reais(floresta);
    $id('lc-empreiteiro').textContent = emp ? reais(emp) : 'sem empreiteiro';
    $id('lc-sobra').textContent = reais(sobra);
    const [pf, pe, ps] = demo.querySelectorAll('.parte');
    pf.style.setProperty('--p', `${(floresta / venda) * 100}%`);
    pe.style.setProperty('--p', `${(emp / venda) * 100}%`);
    ps.style.setProperty('--p', `${(sobra / venda) * 100}%`);
  }

  function ler() {
    tempos.forEach(clearTimeout); tempos = [];
    preencher(EXEMPLOS[atual]);
    if (!movimento) return;
    demo.classList.add('antes');
    demo.classList.remove('lendo');
    linhasLidas.forEach((l) => l.classList.remove('lido'));
    void demo.offsetWidth; // reinicia a animação do feixe
    demo.classList.add('lendo');
    linhasLidas.forEach((l, i) => tempos.push(setTimeout(() => l.classList.add('lido'), 250 + i * 190)));
    tempos.push(setTimeout(() => demo.classList.remove('antes'), 1500));
    tempos.push(setTimeout(() => linhasLidas.forEach((l) => l.classList.remove('lido')), 3200));
  }

  $id('demo-outro').addEventListener('click', () => { atual = (atual + 1) % EXEMPLOS.length; ler(); });

  // Lê o primeiro ticket quando a demonstração aparece na tela
  preencher(EXEMPLOS[0]);
  if (movimento && 'IntersectionObserver' in window) {
    demo.classList.add('antes');
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) { obs.disconnect(); setTimeout(ler, 350); }
    }, { threshold: 0.35 });
    obs.observe(demo);
  }
})();
