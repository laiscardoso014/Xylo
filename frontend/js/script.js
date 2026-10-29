// =====================================================================
// Xylo (CTech) - página de venda (index.html)
//   1. Menu do celular
//   2. Máscaras de WhatsApp e CNPJ
//   3. Envio do formulário "Solicitar acesso" para a API
//   4. Gráfico interativo da abertura
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
// 4. Painel de demonstração da abertura (gráfico interativo)
//    Dados ILUSTRATIVOS: nenhum número real de cliente aparece no site.
//    O faturamento é calculado a partir das toneladas de cada classe,
//    (peso x preço por tonelada), como o sistema faz em cada viagem.
// =====================================================================
(function painelDemonstracao() {
  const painel = document.getElementById('demo-painel');
  if (!painel) return;

  // Preço de exemplo por tonelada, por classe
  const CLASSES = [
    { nome: 'Fina',   preco: 220, cor: '#86efac' },
    { nome: 'Média',  preco: 340, cor: '#22c55e' },
    { nome: 'Grossa', preco: 460, cor: '#15803d' },
    { nome: 'Lixo',   preco: 90,  cor: '#a3a3a3' },
  ];

  // Toneladas por classe em cada mês (Fina, Média, Grossa, Lixo)
  const MESES = [
    { curto: 'Ago', longo: 'Agosto/2025',   ton: [560, 450, 290, 180] },
    { curto: 'Set', longo: 'Setembro/2025', ton: [610, 480, 320, 200] },
    { curto: 'Out', longo: 'Outubro/2025',  ton: [585, 470, 300, 200] },
    { curto: 'Nov', longo: 'Novembro/2025', ton: [640, 520, 350, 210] },
    { curto: 'Dez', longo: 'Dezembro/2025', ton: [520, 420, 270, 185] },
    { curto: 'Jan', longo: 'Janeiro/2026',  ton: [690, 550, 370, 220] },
  ].map((m) => {
    const valores = m.ton.map((t, i) => t * CLASSES[i].preco);
    const totalTon = m.ton.reduce((a, b) => a + b, 0);
    return {
      ...m,
      valores,
      totalTon,
      totalValor: valores.reduce((a, b) => a + b, 0),
      viagens: Math.round(totalTon / 35), // ~35 t por carga
    };
  });

  const fmtTon = (t) => `${t.toLocaleString('pt-BR')} t`;
  const fmtMil = (v) => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: v >= 100000 ? 0 : 1 })} mil`;
  const fmtValor = (metrica, ton, valor) => (metrica === 'ton' ? fmtTon(ton) : fmtMil(valor));

  const barras = document.getElementById('demo-barras');
  const dica = document.getElementById('demo-dica');
  const lista = document.getElementById('demo-classes');
  const abas = painel.querySelectorAll('.demo-abas button');
  const animar = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let metrica = 'ton';
  let selecionado = MESES.length - 1; // começa no mês mais recente

  // Cria uma barra (botão) por mês
  barras.innerHTML = MESES.map((m, i) =>
    `<li><button type="button" class="demo-barra" data-i="${i}" data-mes="${m.curto}" aria-pressed="false"></button></li>`
  ).join('');
  const botoes = [...barras.querySelectorAll('.demo-barra')];

  // Cria as linhas do detalhe por classe
  lista.innerHTML = CLASSES.map((c) =>
    `<li><span class="nome">${c.nome}</span>
         <span class="trilho"><span class="preenche" style="background:${c.cor}"></span></span>
         <span class="valor">–</span></li>`
  ).join('');
  const linhas = [...lista.querySelectorAll('li')];

  function desenharBarras() {
    const valores = MESES.map((m) => (metrica === 'ton' ? m.totalTon : m.totalValor));
    const maximo = Math.max(...valores) * 1.08; // folga no topo
    botoes.forEach((b, i) => {
      const m = MESES[i];
      b.style.height = `${(valores[i] / maximo) * 100}%`;
      b.setAttribute('aria-label', `${m.longo}: ${fmtValor(metrica, m.totalTon, m.totalValor)}`);
    });
  }

  function mostrarMes(i) {
    selecionado = i;
    const m = MESES[i];
    botoes.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    document.getElementById('demo-mes').textContent = m.longo;
    document.getElementById('demo-kpi-ton').textContent = fmtTon(m.totalTon);
    document.getElementById('demo-kpi-valor').textContent = fmtMil(m.totalValor);
    document.getElementById('demo-kpi-viagens').textContent = m.viagens;

    // Detalhe por classe, no indicador escolhido
    const partes = metrica === 'ton' ? m.ton : m.valores;
    const maior = Math.max(...partes);
    linhas.forEach((li, k) => {
      li.querySelector('.preenche').style.width = `${(partes[k] / maior) * 100}%`;
      li.querySelector('.valor').textContent = fmtValor(metrica, m.ton[k], m.valores[k]);
    });
  }

  // Dica flutuante (mouse e teclado)
  function mostrarDica(botao) {
    const m = MESES[botao.dataset.i];
    dica.textContent = `${m.curto}: ${fmtValor(metrica, m.totalTon, m.totalValor)}`;
    dica.hidden = false;
    const caixa = barras.getBoundingClientRect();
    const b = botao.getBoundingClientRect();
    let x = b.left - caixa.left + b.width / 2;
    x = Math.max(dica.offsetWidth / 2, Math.min(caixa.width - dica.offsetWidth / 2, x)); // não sai do painel
    dica.style.left = `${x}px`;
    dica.style.top = `${b.top - caixa.top}px`;
  }
  const esconderDica = () => { dica.hidden = true; };

  botoes.forEach((b) => {
    b.addEventListener('mouseenter', () => mostrarDica(b));
    b.addEventListener('focus', () => mostrarDica(b));
    b.addEventListener('mouseleave', esconderDica);
    b.addEventListener('blur', esconderDica);
    b.addEventListener('click', () => { mostrarMes(Number(b.dataset.i)); mostrarDica(b); });
  });

  abas.forEach((aba) => aba.addEventListener('click', () => {
    metrica = aba.dataset.metrica;
    abas.forEach((a) => a.setAttribute('aria-pressed', String(a === aba)));
    desenharBarras();
    mostrarMes(selecionado);
  }));

  // Começa com as barras em zero e "cresce" quando o painel aparece
  mostrarMes(selecionado);
  if (animar && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) {
        requestAnimationFrame(desenharBarras);
        obs.disconnect();
      }
    }, { threshold: 0.3 });
    obs.observe(painel);
  } else {
    desenharBarras();
  }
})();
