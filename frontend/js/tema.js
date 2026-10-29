// =====================================================================
// Xylo - APARÊNCIA (tema claro/escuro e cor do plano de fundo)
//
// Carregado no <head> (antes de desenhar a página) para não "piscar"
// a tela clara antes de aplicar o tema escuro.
//
// A escolha fica guardada NESTE navegador (localStorage). Cada pessoa /
// computador escolhe a sua; não muda nada para os outros usuários.
//
//   <html data-tema="claro|escuro" data-fundo="padrao|verde|areia|azul|lilas|branco">
//   O CSS (main.css, seção APARÊNCIA) faz o resto.
//
// Botão: um <div id="aparencia"> na barra superior (main.html e dev.html).
// =====================================================================
(function () {
  const CHAVE = 'xylo.aparencia';
  const TEMAS = [
    { id: 'claro', nome: 'Claro', icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
    { id: 'escuro', nome: 'Escuro', icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>' },
    { id: 'auto', nome: 'Automático', icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>' },
  ];
  // Amostras: a mesma escolha tem uma versão clara e uma escura
  const FUNDOS = [
    { id: 'padrao', nome: 'Padrão', claro: '#f9fafb', escuro: '#0f131a' },
    { id: 'verde', nome: 'Verde', claro: '#eef6f0', escuro: '#0d1e14' },
    { id: 'areia', nome: 'Areia', claro: '#f6f1e7', escuro: '#1f190e' },
    { id: 'azul', nome: 'Azul', claro: '#eef3f9', escuro: '#0d1829' },
    { id: 'lilas', nome: 'Lilás', claro: '#f3f1fa', escuro: '#1a152b' },
    { id: 'branco', nome: 'Branco', nomeEscuro: 'Preto', claro: '#ffffff', escuro: '#050608' },
  ];

  const midia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function ler() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch { v = {}; }
    return {
      tema: TEMAS.some((t) => t.id === v.tema) ? v.tema : 'claro',
      fundo: FUNDOS.some((f) => f.id === v.fundo) ? v.fundo : 'padrao',
    };
  }
  const resolver = (tema) => (tema === 'auto' ? (midia && midia.matches ? 'escuro' : 'claro') : tema);

  let atual = ler();
  function aplicar() {
    const html = document.documentElement;
    html.dataset.tema = resolver(atual.tema);
    html.dataset.fundo = atual.fundo;
  }
  aplicar();

  function definir(novo) {
    atual = { ...atual, ...novo };
    aplicar();
    try { localStorage.setItem(CHAVE, JSON.stringify(atual)); } catch { /* navegador sem armazenamento: vale só nesta página */ }
    desenhar();
  }

  // "Automático" acompanha o sistema na hora; outra aba muda -> esta acompanha
  if (midia) {
    const mudou = () => { if (atual.tema === 'auto') { aplicar(); desenhar(); } };
    if (midia.addEventListener) midia.addEventListener('change', mudou); else if (midia.addListener) midia.addListener(mudou);
  }
  window.addEventListener('storage', (e) => { if (e.key === CHAVE) { atual = ler(); aplicar(); desenhar(); } });

  window.Aparencia = { atual: () => ({ ...atual, resolvido: resolver(atual.tema) }), definir };

  // ---------------------------------------------------------------
  // Botão + painel
  // ---------------------------------------------------------------
  let caixa = null;
  function montar() {
    caixa = document.getElementById('aparencia');
    if (!caixa) return;
    caixa.innerHTML = `
      <button type="button" class="botao-tema" id="btn-tema" aria-haspopup="dialog" aria-expanded="false" aria-controls="painel-tema"
              title="Aparência: tema e cor de fundo"></button>
      <div class="painel-tema" id="painel-tema" role="dialog" aria-label="Aparência" hidden>
        <h3 id="titulo-tema">Tema</h3>
        <div class="opcoes-tema" role="group" aria-labelledby="titulo-tema">
          ${TEMAS.map((t) => `<button type="button" data-escolha-tema="${t.id}" aria-pressed="false">${t.icone}<span>${t.nome}</span></button>`).join('')}
        </div>
        <h3 id="titulo-fundo">Cor de fundo</h3>
        <div class="cores-fundo" role="group" aria-labelledby="titulo-fundo">
          ${FUNDOS.map((f) => `<button type="button" data-escolha-fundo="${f.id}" aria-pressed="false"></button>`).join('')}
        </div>
        <p class="nome-fundo" id="nome-fundo"></p>
      </div>`;

    const botao = caixa.querySelector('#btn-tema');
    const painel = caixa.querySelector('#painel-tema');
    const abrir = (sim) => {
      painel.hidden = !sim;
      botao.setAttribute('aria-expanded', String(sim));
      if (sim) (painel.querySelector('[aria-pressed="true"]') || painel.querySelector('button')).focus();
    };
    botao.addEventListener('click', () => abrir(painel.hidden));
    painel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.escolhaTema) definir({ tema: b.dataset.escolhaTema });
      if (b.dataset.escolhaFundo) definir({ fundo: b.dataset.escolhaFundo });
    });
    // Fecha clicando fora (em captura: funciona mesmo se outro botão parar o clique) ou com Esc
    document.addEventListener('click', (e) => { if (!painel.hidden && !caixa.contains(e.target)) abrir(false); }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !painel.hidden) { abrir(false); botao.focus(); }
    });
    desenhar();
  }

  function desenhar() {
    if (!caixa || !caixa.querySelector('#btn-tema')) return;
    const escuro = resolver(atual.tema) === 'escuro';
    const temaAtual = TEMAS.find((t) => t.id === atual.tema);
    const botao = caixa.querySelector('#btn-tema');
    botao.innerHTML = TEMAS.find((t) => t.id === (escuro ? 'escuro' : 'claro')).icone;
    botao.setAttribute('aria-label', `Aparência (tema ${temaAtual.nome.toLowerCase()})`);
    caixa.querySelectorAll("[data-escolha-tema]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.escolhaTema === atual.tema)));
    caixa.querySelectorAll("[data-escolha-fundo]").forEach((b) => {
      const f = FUNDOS.find((x) => x.id === b.dataset.escolhaFundo);
      const nome = escuro && f.nomeEscuro ? f.nomeEscuro : f.nome;
      b.style.setProperty('--amostra', escuro ? f.escuro : f.claro);
      b.title = nome;
      b.setAttribute('aria-label', `Fundo ${nome}`);
      b.setAttribute('aria-pressed', String(b.dataset.escolhaFundo === atual.fundo));
    });
    const f = FUNDOS.find((x) => x.id === atual.fundo);
    caixa.querySelector('#nome-fundo').textContent = `Fundo: ${escuro && f.nomeEscuro ? f.nomeEscuro : f.nome}`
      + (atual.tema === 'auto' ? ` · segue o sistema (${escuro ? 'escuro' : 'claro'} agora)` : '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
}());
