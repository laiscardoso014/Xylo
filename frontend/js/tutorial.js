// =====================================================================
// TUTORIAL DO PRIMEIRO ACESSO (tour guiado)
//
// Destaca uma parte da tela por vez (o resto fica escurecido) e explica
// em um balão. O roteiro muda conforme o perfil do usuário:
//   Administrador · Financeiro · Visualização
// Aparece sozinho no primeiro acesso (o servidor guarda que ele já viu,
// em qualquer computador) e pode ser revisto em: menu do usuário › Ver tutorial.
// Teclado: → próximo · ← voltar · Esc fecha.
// Usa as variáveis globais do main.js: usuario, PERFIL, api, $, esc.
// =====================================================================
(function () {
  const QUEM = PERFIL.admin ? 'admin' : PERFIL.podeEditar ? 'fin' : 'vis';
  const primeiroNome = (usuario.nome || '').split(' ')[0] || '';

  const BOAS_VINDAS = {
    admin: 'Você é <strong>Administrador</strong>: cadastra, lança, vê todos os relatórios e também cuida da equipe (usuários e permissões), do histórico e da lixeira.',
    fin: 'Você é do <strong>Financeiro</strong>: cadastra e lança viagens, fretes, despesas e a folha, e acompanha os relatórios. A parte de usuários fica com o Administrador.',
    vis: 'Seu perfil é de <strong>Visualização</strong>: você consulta tudo (viagens, fretes, despesas e relatórios) e exporta para o Excel, mas não altera nada.',
  };

  // alvo: seletor (ou lista) do que destacar · para: perfis que veem o passo
  // menu: true = o alvo fica na barra lateral (no celular ela é aberta)
  const PASSOS = [
    { titulo: `Bem-vindo(a) ao Xylo${primeiroNome ? `, ${esc(primeiroNome)}` : ''}!`,
      texto: `${BOAS_VINDAS[QUEM]}<br><br>Em 1 minuto mostramos onde fica cada coisa. Você pode pular e rever depois quando quiser.`,
      para: ['admin', 'fin', 'vis'] },
    { alvo: 'a[data-rota="inicio"]', menu: true, titulo: 'Início: o resumo do mês',
      texto: 'Faturamento, toneladas, lucro e gráficos do mês, com a DRE no final da página. É a primeira tela que aparece ao entrar.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: ['a[data-rota="clientes"]', 'a[data-rota="florestas"]', 'a[data-rota="empreiteiros"]'], menu: true, titulo: 'Cadastros: comece por aqui',
      texto: '<strong>Clientes</strong> são quem compra a madeira, <strong>Florestas</strong> são de onde ela sai e <strong>Empreiteiros</strong> fazem o corte e o carregamento. Os preços por tonelada ficam no cadastro de cada um.',
      textoVis: '<strong>Clientes</strong> (quem compra), <strong>Florestas</strong> (de onde sai a madeira) e <strong>Empreiteiros</strong> (corte e carregamento), com os preços de cada um.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: ['a[data-rota="rotas"]', 'a[data-rota="importar"]'], menu: true, titulo: 'Rotas e planilha',
      texto: 'Em <strong>Rotas e distâncias</strong> ficam os km de cada floresta até cada cliente (usados na comissão dos motoristas). Em <strong>Importar planilha</strong> você traz de uma vez a planilha de Excel que usava antes.',
      para: ['admin', 'fin'] },
    { alvo: 'a[data-rota="viagens"]', menu: true, titulo: 'Viagens: o dia a dia',
      texto: 'Cada carga é uma viagem: cliente, floresta, placa e peso. Dica: use <strong>Ler ticket</strong> e tire uma foto do ticket da balança, o Xylo preenche os campos para você conferir.',
      textoVis: 'Cada carga entregue aparece aqui, com cliente, floresta, placa, peso e valores. Use os filtros e clique no título das colunas para ordenar.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: ['a[data-rota="fretes"]', 'a[data-rota="despesas"]'], menu: true, titulo: 'Fretes e despesas',
      texto: '<strong>Fretes</strong> são os transportes feitos para terceiros. Em <strong>Despesas</strong> entram combustível, manutenção e outros gastos, com vencimento e pagamento, que vão direto para a DRE.',
      textoVis: '<strong>Fretes</strong> feitos para terceiros e <strong>Despesas</strong> da empresa (combustível, manutenção…), com o que já foi pago e o que vence.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: 'a[data-rota="relatorios"]', menu: true, titulo: 'Relatórios e DRE',
      texto: 'Fechamento do mês, por cliente, floresta, empreiteiro e classe, o anual e a <strong>DRE</strong>. Tudo pode ser exportado para Excel.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: ['a[data-rota="funcionarios"]', 'a[data-rota="folha"]'], menu: true, titulo: 'Pessoal',
      texto: 'Cadastre os <strong>funcionários</strong> (motoristas com a placa do caminhão, que é como o Xylo os reconhece no ticket) e gere a <strong>folha de pagamento</strong> com comissão e adiantamentos.',
      para: ['admin', 'fin'] },
    { alvo: ['a[data-rota="financeiro"]', 'a[data-rota="usuarios"]', 'a[data-rota="historico"]', 'a[data-rota="lixeira"]'], menu: true, titulo: 'Administração',
      texto: 'Em <strong>Usuários</strong> você convida a sua equipe e escolhe o perfil de cada um. O <strong>Histórico</strong> mostra quem mudou o quê, a <strong>Lixeira</strong> guarda o que foi excluído (dá para restaurar) e o <strong>Financeiro</strong> mostra a mensalidade do Xylo.',
      para: ['admin'] },
    { alvo: '#btn-usuario', titulo: 'Seu menu',
      texto: QUEM === 'admin'
        ? 'Aqui ficam <strong>Meu perfil</strong> (nome e senha), os <strong>Dados da empresa</strong> (logo e razão social, que saem nos relatórios) e o botão para <strong>rever este tutorial</strong>.'
        : 'Aqui ficam <strong>Meu perfil</strong> (nome e senha), o botão para <strong>rever este tutorial</strong> e o Sair.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: '#aparencia', titulo: 'Claro ou escuro',
      texto: 'Troque a aparência do sistema quando quiser. Fica salvo neste navegador.',
      para: ['admin', 'fin', 'vis'] },
    { alvo: '#abrir-assistente', titulo: 'Assistente Xylo',
      texto: 'Pergunte do seu jeito: <em>"quanto faturei em outubro?"</em>, <em>"qual a placa do João?"</em>, <em>"quais despesas vencem esta semana?"</em>. Ele responde com os dados do sistema.',
      para: ['admin', 'fin', 'vis'] },
    { titulo: 'Tudo pronto!',
      texto: {
        admin: 'Um bom começo: preencha os <strong>Dados da empresa</strong>, cadastre os <strong>clientes</strong> e convide a sua equipe em <strong>Usuários</strong>.',
        fin: 'Um bom começo: confira os <strong>cadastros</strong> e lance a primeira <strong>viagem</strong>.',
        vis: 'Comece pelo <strong>Início</strong> e pelos <strong>Relatórios</strong>. Se precisar lançar algo, peça ao Administrador da sua empresa.',
      }[QUEM],
      acoes: {
        admin: [{ texto: 'Dados da empresa', rota: 'empresa' }, { texto: 'Cadastrar clientes', rota: 'clientes' }],
        fin: [{ texto: 'Ver cadastros', rota: 'clientes' }, { texto: 'Lançar viagem', rota: 'viagens' }],
        vis: [{ texto: 'Ver relatórios', rota: 'relatorios' }],
      }[QUEM],
      para: ['admin', 'fin', 'vis'] },
  ];

  const visivel = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const celular = () => matchMedia('(max-width: 900px)').matches;

  let passos = [];
  let atual = 0;
  let camada = null;
  let foco = null;
  let rolagens = []; // posição de rolagem do menu e da página antes do tour

  function alvosDo(p) {
    if (!p.alvo) return [];
    return [].concat(p.alvo).map((s) => document.querySelector(s)).filter(Boolean);
  }

  function montar() {
    camada = document.createElement('div');
    camada.className = 'tour';
    camada.innerHTML = `
      <div class="tour-bloqueio"></div>
      <div class="tour-destaque" aria-hidden="true"></div>
      <div class="tour-balao" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" aria-describedby="tour-texto">
        <div class="tour-progresso"><span id="tour-contador"></span><button type="button" class="tour-pular" data-tour="pular">Pular tutorial</button></div>
        <h2 id="tour-titulo"></h2>
        <p id="tour-texto"></p>
        <div class="tour-acoes-extra" id="tour-extra"></div>
        <div class="tour-rodape">
          <div class="tour-pontos" id="tour-pontos" aria-hidden="true"></div>
          <div class="tour-botoes">
            <button type="button" class="btn btn-secundario pequeno" data-tour="voltar">Voltar</button>
            <button type="button" class="btn btn-primario pequeno" data-tour="proximo">Próximo</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(camada);
    camada.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour], [data-tour-rota]');
      if (!b) return;
      if (b.dataset.tourRota) { encerrar(); location.hash = b.dataset.tourRota; return; }
      if (b.dataset.tour === 'proximo') ir(atual + 1);
      if (b.dataset.tour === 'voltar') ir(atual - 1);
      if (b.dataset.tour === 'pular') encerrar();
    });
    document.addEventListener('keydown', teclado, true);
    window.addEventListener('resize', posicionar);
  }

  function teclado(e) {
    if (!camada) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); encerrar(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); ir(atual + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); ir(atual - 1); }
    if (e.key === 'Tab') { // o foco não sai do balão
      const itens = [...camada.querySelectorAll('.tour-balao button:not([hidden])')];
      const i = itens.indexOf(document.activeElement);
      e.preventDefault();
      itens[(i + (e.shiftKey ? -1 : 1) + itens.length) % itens.length].focus();
    }
  }

  function ir(n) {
    if (n >= passos.length) { encerrar(); return; }
    if (n < 0) return;
    atual = n;
    const p = passos[n];
    const menu = $('#menu');
    if (celular()) menu.classList.toggle('aberto', Boolean(p.menu));
    $('#tour-contador').textContent = `${n + 1} de ${passos.length}`;
    $('#tour-titulo').innerHTML = p.titulo;
    $('#tour-texto').innerHTML = (QUEM === 'vis' && p.textoVis) || p.texto;
    $('#tour-extra').innerHTML = (p.acoes || []).map((a) => `<button type="button" class="btn btn-secundario pequeno" data-tour-rota="${a.rota}">${esc(a.texto)}</button>`).join('');
    $('#tour-pontos').innerHTML = passos.map((_, i) => `<span class="${i === n ? 'ativo' : ''}"></span>`).join('');
    camada.querySelector('[data-tour="voltar"]').hidden = n === 0;
    const ultimo = n === passos.length - 1;
    camada.querySelector('[data-tour="proximo"]').textContent = ultimo ? 'Concluir' : n === 0 ? 'Começar' : 'Próximo';
    camada.querySelector('.tour-pular').hidden = ultimo;
    alvosDo(p).forEach((el) => el.scrollIntoView({ block: 'nearest' }));
    // espera o menu do celular terminar de abrir antes de medir
    setTimeout(posicionar, celular() ? 260 : 0);
    camada.querySelector('[data-tour="proximo"]').focus();
  }

  function posicionar() {
    if (!camada) return;
    const p = passos[atual];
    const destaque = camada.querySelector('.tour-destaque');
    const balao = camada.querySelector('.tour-balao');
    const alvos = alvosDo(p).filter(visivel);
    const vw = innerWidth; const vh = innerHeight; const m = 16;
    const larg = Math.min(360, vw - m * 2);
    balao.style.width = `${larg}px`;

    if (!alvos.length) { // passo sem alvo: balão no meio e tela toda escurecida
      camada.classList.add('tour-centro');
      destaque.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
      balao.style.left = `${(vw - larg) / 2}px`;
      balao.style.top = `${Math.max(m, (vh - balao.offsetHeight) / 2)}px`;
      return;
    }
    camada.classList.remove('tour-centro');
    const r = alvos.map((el) => el.getBoundingClientRect()).reduce((a, b) => ({
      left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
    }));
    const f = 6;
    const box = { left: r.left - f, top: r.top - f, width: r.right - r.left + f * 2, height: r.bottom - r.top + f * 2 };
    destaque.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;`;

    const alt = balao.offsetHeight; const g = 14;
    let left; let top;
    if (box.left + box.width + g + larg + m <= vw) { // à direita (barra lateral)
      left = box.left + box.width + g; top = box.top + box.height / 2 - alt / 2;
    } else if (box.top + box.height + g + alt + m <= vh) { // embaixo (topo da tela)
      left = box.left + box.width / 2 - larg / 2; top = box.top + box.height + g;
    } else if (box.top - g - alt >= m) { // em cima (botão do assistente)
      left = box.left + box.width / 2 - larg / 2; top = box.top - g - alt;
    } else { // à esquerda
      left = box.left - g - larg; top = box.top + box.height / 2 - alt / 2;
    }
    balao.style.left = `${Math.min(Math.max(m, left), vw - larg - m)}px`;
    balao.style.top = `${Math.min(Math.max(m, top), vh - alt - m)}px`;
  }

  function encerrar() {
    if (!camada) return;
    document.removeEventListener('keydown', teclado, true);
    window.removeEventListener('resize', posicionar);
    camada.remove();
    camada = null;
    if (celular()) $('#menu').classList.remove('aberto');
    rolagens.forEach(([el, y]) => { el.scrollTop = y; });
    api('/auth/tutorial', { metodo: 'POST' }).catch(() => {});
    if (foco && document.contains(foco)) foco.focus();
  }

  function iniciar() {
    if (camada) return;
    passos = PASSOS.filter((p) => p.para.includes(QUEM) && (!p.alvo || alvosDo(p).length));
    foco = document.activeElement;
    rolagens = [document.scrollingElement, $('#menu'), $('.menu-itens')].filter(Boolean).map((el) => [el, el.scrollTop]);
    montar();
    ir(0);
  }

  // Primeiro acesso: só depois da tela carregar e sem nenhuma janela aberta
  // (ex.: a troca obrigatória da senha provisória)
  async function automatico() {
    try {
      const r = await api('/auth/tutorial');
      if (r.visto) return;
    } catch { return; }
    const tentar = (vezes) => {
      if (!$('#modal').hidden) { if (vezes) setTimeout(() => tentar(vezes - 1), 1000); return; }
      iniciar();
    };
    setTimeout(() => tentar(30), 700);
  }

  window.Tutorial = { iniciar, automatico };

  const botao = $('#btn-tutorial');
  if (botao) botao.addEventListener('click', iniciar);
  if (!usuario.deve_trocar_senha) automatico(); // quem troca a senha vê depois (main.js chama)
}());
