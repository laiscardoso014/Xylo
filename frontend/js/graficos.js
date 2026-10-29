// =====================================================================
// Xylo - GRÁFICOS INTERATIVOS (SVG/HTML desenhados aqui, sem biblioteca)
//
//   Graficos.colunas(alvo, opcoes)   colunas por categoria (1 ou 2 séries; negativos para baixo)
//   Graficos.linhas(alvo, opcoes)    evolução no tempo com linha-guia (crosshair)
//   Graficos.barras(alvo, opcoes)    ranking em barras horizontais (clicáveis)
//   Graficos.cascata(alvo, opcoes)   faturamento -> despesas -> resultado
//   Graficos.tabela(alvo, opcoes)    os mesmos dados em tabela (acessibilidade)
//
// Todos: dica (tooltip) ao passar o mouse, tocar ou focar pelo teclado (Tab),
// redesenham sozinhos quando a largura muda, e escrevem nomes com textContent
// (nome de cliente/floresta vem do banco: nunca vira HTML).
//
// Cores: verde = faturamento/valor, violeta = despesas (par testado para
// daltonismo), laranja = prejuízo (sempre abaixo da linha do zero).
// =====================================================================
const Graficos = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const CORES = {
    verde: '#16a34a',
    violeta: '#6250d6',
    perda: '#c2410c',
    total: '#374151',
  };
  const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

  // ---- utilitários ---------------------------------------------------
  function svg(tag, atributos = {}, pai = null) {
    const el = document.createElementNS(NS, tag);
    Object.entries(atributos).forEach(([k, v]) => el.setAttribute(k, v));
    if (pai) pai.appendChild(el);
    return el;
  }
  function texto(pai, x, y, conteudo, classe, ancora = 'middle') {
    const t = svg('text', { x, y, class: classe, 'text-anchor': ancora }, pai);
    t.textContent = conteudo;
    return t;
  }
  function html(tag, classe, pai, conteudo) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (conteudo !== undefined) el.textContent = conteudo;
    if (pai) pai.appendChild(el);
    return el;
  }

  // Escala com números "redondos" (0, 25 mil, 50 mil...) e sempre incluindo o zero
  function escala(valores) {
    let min = Math.min(0, ...valores);
    let max = Math.max(0, ...valores);
    if (min === max) max = min + 1;
    const bruto = (max - min) / 4;
    const potencia = 10 ** Math.floor(Math.log10(bruto));
    const f = bruto / potencia;
    const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * potencia;
    min = Math.floor(min / passo) * passo;
    max = Math.ceil(max / passo) * passo;
    const marcas = [];
    for (let v = min; v <= max + passo / 2; v += passo) marcas.push(Math.round(v / passo) * passo);
    return { min, max, marcas };
  }

  // Coluna com a ponta arredondada (4px) e a base reta, para cima ou para baixo
  function caminhoBarra(x, y, l, a, paraCima) {
    const r = Math.min(4, l / 2, a);
    return paraCima
      ? `M${x},${y + a}V${y + r}Q${x},${y} ${x + r},${y}H${x + l - r}Q${x + l},${y} ${x + l},${y + r}V${y + a}Z`
      : `M${x},${y}H${x + l}V${y + a - r}Q${x + l},${y + a} ${x + l - r},${y + a}H${x + r}Q${x},${y + a} ${x},${y + a - r}Z`;
  }

  const encurtar = (s, max) => (s.length > max ? `${s.slice(0, Math.max(max - 1, 1))}…` : s);

  // Monta o gráfico e redesenha quando a largura do espaço muda
  function montar(alvo, desenhar) {
    alvo.classList.add('grafico');
    const render = () => {
      const largura = alvo.clientWidth;
      if (!largura) return;
      alvo.replaceChildren();
      const dica = html('div', 'dica-grafico');
      dica.hidden = true;
      dica.setAttribute('role', 'status');
      desenhar(largura, dica);
      alvo.appendChild(dica);
    };
    render();
    if (alvo.observador) alvo.observador.disconnect();
    let ultima = alvo.clientWidth;
    alvo.observador = new ResizeObserver(() => {
      if (Math.abs(alvo.clientWidth - ultima) > 4) {
        ultima = alvo.clientWidth;
        requestAnimationFrame(render);
      }
    });
    alvo.observador.observe(alvo);
  }

  // Dica: título + linhas { cor, valor, rotulo }. Valor em destaque, nome depois.
  function mostrarDica(dica, alvo, titulo, linhas, x, y) {
    dica.replaceChildren();
    html('strong', 'dica-titulo', dica, titulo);
    linhas.forEach((l) => {
      const linha = html('span', 'dica-linha', dica);
      if (l.cor) html('i', 'dica-chave', linha).style.background = l.cor;
      html('b', '', linha, l.valor);
      if (l.rotulo) html('span', '', linha, l.rotulo);
    });
    dica.hidden = false;
    const largura = alvo.clientWidth;
    let esquerda = x + 14;
    if (esquerda + dica.offsetWidth > largura - 4) esquerda = x - dica.offsetWidth - 14;
    dica.style.left = `${Math.max(esquerda, 4)}px`;
    dica.style.top = `${Math.max(y - dica.offsetHeight / 2, 0)}px`;
  }
  const esconderDica = (dica) => { dica.hidden = true; };

  // Posição do ponteiro relativa ao gráfico
  function ponto(evento, alvo) {
    const r = alvo.getBoundingClientRect();
    return [evento.clientX - r.left, evento.clientY - r.top];
  }

  function legenda(alvo, series, forma) {
    if (series.length < 2) return;
    const box = html('div', 'legenda-grafico', alvo);
    series.forEach((s) => {
      const item = html('span', '', box);
      html('i', `amostra-${forma}`, item).style.background = s.cor;
      item.appendChild(document.createTextNode(s.nome));
    });
  }

  // Eixo Y com linhas de grade bem claras; devolve a função y(valor)
  function eixoY(s, marcas, min, max, topo, altura, esquerda, direita, formatoEixo) {
    const y = (v) => topo + ((max - v) / (max - min)) * altura;
    marcas.forEach((m) => {
      svg('line', { x1: esquerda, x2: direita, y1: y(m), y2: y(m), class: m === 0 ? 'linha-zero' : 'linha-grade' }, s);
      texto(s, esquerda - 8, y(m) + 4, formatoEixo(m), 'rotulo-eixo', 'end');
    });
    return y;
  }
  const larguraEixo = (marcas, formatoEixo) => Math.max(...marcas.map((m) => formatoEixo(m).length)) * 6.6 + 14;

  // ---- COLUNAS ---------------------------------------------------------
  // opcoes: rotulos[], rotulosCurtos?[], series[{nome, valores[], cor}], formato(v),
  //         formatoEixo?(v), corNegativa?, altura?, tituloDica?(i), extraDica?(i) -> [{valor, rotulo}],
  //         aoClicar?(i), descricao
  function colunas(alvo, o) {
    montar(alvo, (L, dica) => {
      legenda(alvo, o.series, 'caixa');
      const H = o.altura || 240;
      const n = o.rotulos.length;
      const { min, max, marcas } = escala(o.series.flatMap((s) => s.valores.map(Number)));
      const fEixo = o.formatoEixo || ((v) => compacto.format(v));
      const mE = larguraEixo(marcas, fEixo);
      const mT = 10; const mB = 26; const mD = 6;
      const s = svg('svg', { width: L, height: H, viewBox: `0 0 ${L} ${H}`, role: 'img', 'aria-label': o.descricao || '' }, alvo);
      const y = eixoY(s, marcas, min, max, mT, H - mT - mB, mE, L - mD, fEixo);
      const banda = (L - mE - mD) / n;
      const nS = o.series.length;
      const largura = Math.max(Math.min(24, (banda * 0.72 - (nS - 1) * 2) / nS), 2);
      const curtos = o.rotulosCurtos || o.rotulos;
      const passoRotulo = Math.max(1, Math.ceil(Math.max(...curtos.map((r) => r.length)) * 7 / banda));

      for (let i = 0; i < n; i++) {
        const x0 = mE + i * banda;
        const resumo = o.series.map((se) => `${se.nome}: ${o.formato(se.valores[i])}`).join(', ');
        const g = svg('g', { class: `coluna-grafico${o.aoClicar ? ' clicavel' : ''}`, tabindex: 0, 'aria-label': `${o.rotulos[i]} — ${resumo}` }, s);
        if (o.aoClicar) g.setAttribute('role', 'button');
        svg('rect', { x: x0 + 1, y: mT, width: Math.max(banda - 2, 1), height: H - mT - mB, class: 'faixa', rx: 4 }, g);
        const inicio = x0 + (banda - (nS * largura + (nS - 1) * 2)) / 2;
        o.series.forEach((se, j) => {
          const v = Number(se.valores[i]);
          if (!v) return;
          const topo = Math.min(y(v), y(0));
          const alt = Math.abs(y(0) - y(v));
          if (alt < 0.5) return;
          svg('path', { d: caminhoBarra(inicio + j * (largura + 2), topo, largura, alt, v > 0), fill: v < 0 && o.corNegativa ? o.corNegativa : se.cor, class: 'marca' }, g);
        });
        if (i % passoRotulo === 0) texto(s, x0 + banda / 2, H - 8, curtos[i], 'rotulo-eixo');

        const linhasDica = () => [
          ...o.series.map((se) => ({ cor: Number(se.valores[i]) < 0 && o.corNegativa ? o.corNegativa : se.cor, valor: o.formato(se.valores[i]), rotulo: nS > 1 || o.nomeNaDica ? se.nome : '' })),
          ...(o.extraDica ? o.extraDica(i) : []),
        ];
        const titulo = o.tituloDica ? o.tituloDica(i) : o.rotulos[i];
        g.addEventListener('pointermove', (e) => { const [px, py] = ponto(e, alvo); mostrarDica(dica, alvo, titulo, linhasDica(), px, py); });
        g.addEventListener('focus', () => mostrarDica(dica, alvo, titulo, linhasDica(), x0 + banda / 2, mT + 40));
        g.addEventListener('pointerleave', () => esconderDica(dica));
        g.addEventListener('blur', () => esconderDica(dica));
        if (o.aoClicar) {
          g.addEventListener('click', () => o.aoClicar(i));
          g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.aoClicar(i); } });
        }
      }
    });
  }

  // ---- LINHAS ----------------------------------------------------------
  // opcoes: rotulos[], rotulosCurtos?[], series[{nome, valores[], cor}], formato(v), formatoEixo?,
  //         area? (só com 1 série), altura?, tituloDica?(i), extraDica?(i), descricao
  function linhas(alvo, o) {
    montar(alvo, (L, dica) => {
      legenda(alvo, o.series, 'linha');
      const H = o.altura || 240;
      const n = o.rotulos.length;
      const { min, max, marcas } = escala(o.series.flatMap((s) => s.valores.map(Number)));
      const fEixo = o.formatoEixo || ((v) => compacto.format(v));
      const mE = larguraEixo(marcas, fEixo);
      const mT = 12; const mB = 26; const mD = 14;
      const s = svg('svg', { width: L, height: H, viewBox: `0 0 ${L} ${H}`, role: 'img', 'aria-label': o.descricao || '' }, alvo);
      const y = eixoY(s, marcas, min, max, mT, H - mT - mB, mE, L - mD, fEixo);
      const x0 = mE + 10; const x1 = L - mD - 4;
      const x = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1));
      const curtos = o.rotulosCurtos || o.rotulos;
      const espaco = n > 1 ? (x1 - x0) / (n - 1) : x1 - x0;
      const passoRotulo = Math.max(1, Math.ceil(Math.max(...curtos.map((r) => r.length)) * 7 / espaco));
      // rótulos espaçados; o último sempre aparece, e o vizinho que encostaria nele é pulado
      curtos.forEach((r, i) => {
        const ultimo = i === n - 1;
        if (ultimo || (i % passoRotulo === 0 && n - 1 - i >= passoRotulo)) texto(s, x(i), H - 8, r, 'rotulo-eixo');
      });

      o.series.forEach((se) => {
        const pts = se.valores.map((v, i) => `${x(i)},${y(Number(v))}`);
        if (o.area && o.series.length === 1) {
          svg('path', { d: `M${x(0)},${y(0)}L${pts.join('L')}L${x(n - 1)},${y(0)}Z`, fill: se.cor, 'fill-opacity': 0.1 }, s);
        }
        svg('path', { d: `M${pts.join('L')}`, fill: 'none', stroke: se.cor, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
        // ponto final (o mês mais recente) marcado
        svg('circle', { cx: x(n - 1), cy: y(Number(se.valores[n - 1])), r: 4, fill: se.cor, stroke: '#fff', 'stroke-width': 2 }, s);
      });

      // Linha-guia + marcadores do ponto sob o ponteiro
      const guia = svg('line', { y1: mT, y2: H - mB, class: 'linha-guia', visibility: 'hidden' }, s);
      const marcadores = o.series.map((se) => svg('circle', { r: 4.5, fill: se.cor, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }, s));
      const camada = svg('rect', { x: mE, y: mT, width: L - mE - mD, height: H - mT - mB, fill: 'transparent', tabindex: 0, class: 'camada-foco', 'aria-label': `${o.descricao || ''} Use as setas para percorrer os meses.` }, s);
      let atual = n - 1;
      const mostrar = (i, py) => {
        atual = i;
        guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i)); guia.setAttribute('visibility', 'visible');
        o.series.forEach((se, j) => {
          marcadores[j].setAttribute('cx', x(i)); marcadores[j].setAttribute('cy', y(Number(se.valores[i])));
          marcadores[j].setAttribute('visibility', 'visible');
        });
        const linhasDica = [
          ...o.series.map((se) => ({ cor: se.cor, valor: o.formato(se.valores[i]), rotulo: o.series.length > 1 ? se.nome : '' })),
          ...(o.extraDica ? o.extraDica(i) : []),
        ];
        mostrarDica(dica, alvo, o.tituloDica ? o.tituloDica(i) : o.rotulos[i], linhasDica, x(i), py ?? mT + 50);
      };
      const esconder = () => {
        guia.setAttribute('visibility', 'hidden');
        marcadores.forEach((m) => m.setAttribute('visibility', 'hidden'));
        esconderDica(dica);
      };
      camada.addEventListener('pointermove', (e) => {
        const [px, py] = ponto(e, alvo);
        const i = n === 1 ? 0 : Math.round(((px - x0) / (x1 - x0)) * (n - 1));
        mostrar(Math.min(Math.max(i, 0), n - 1), py);
      });
      camada.addEventListener('pointerleave', esconder);
      camada.addEventListener('focus', () => mostrar(atual));
      camada.addEventListener('blur', esconder);
      camada.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); mostrar(Math.min(atual + 1, n - 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); mostrar(Math.max(atual - 1, 0)); }
      });
    });
  }

  // ---- BARRAS HORIZONTAIS (ranking) -------------------------------------
  // opcoes: itens[{rotulo, valor, ...}], formato(v), cor, corNegativa?, aoClicar?(item),
  //         extraDica?(item) -> [{valor, rotulo}], max? (quantas mostrar; o resto vira "Outros")
  function barras(alvo, o) {
    alvo.classList.add('grafico', 'grafico-barras');
    alvo.replaceChildren();
    let itens = o.itens.map((i) => ({ ...i, valor: Number(i.valor) }));
    if (o.max && itens.length > o.max) {
      const resto = itens.slice(o.max - 1);
      itens = [...itens.slice(0, o.max - 1), { rotulo: `Outros (${resto.length})`, valor: resto.reduce((t, i) => t + i.valor, 0), outros: true }];
    }
    const maxPos = Math.max(0, ...itens.map((i) => i.valor));
    const maxNeg = Math.max(0, ...itens.map((i) => -i.valor));
    const escalaTotal = maxPos + maxNeg || 1;
    const zero = (maxNeg / escalaTotal) * 100;
    const dica = html('div', 'dica-grafico');
    dica.hidden = true;

    itens.forEach((item) => {
      const clicavel = o.aoClicar && !item.outros;
      const linha = html(clicavel ? 'button' : 'div', `linha-barra${clicavel ? ' clicavel' : ''}`, alvo);
      if (clicavel) linha.type = 'button';
      else linha.tabIndex = 0;
      linha.setAttribute('aria-label', `${item.rotulo}: ${o.formato(item.valor)}`);
      html('span', 'rotulo', linha, item.rotulo).title = item.rotulo;
      const trilho = html('span', 'trilho', linha);
      if (maxNeg) html('span', 'zero', trilho).style.left = `${zero}%`;
      const largura = (Math.abs(item.valor) / escalaTotal) * 100;
      const p = html('span', `preenchimento${item.valor < 0 ? ' negativo' : ''}`, trilho);
      p.style.width = `${Math.max(largura, item.valor ? 0.8 : 0)}%`;
      p.style.left = `${item.valor < 0 ? zero - largura : zero}%`;
      p.style.background = item.valor < 0 && o.corNegativa ? o.corNegativa : (item.outros ? '#9ca3af' : o.cor);
      html('span', 'valor', linha, o.formato(item.valor));

      const conteudo = () => [{ cor: p.style.background, valor: o.formato(item.valor) }, ...(o.extraDica && !item.outros ? o.extraDica(item) : [])];
      const rodape = clicavel ? [{ valor: '', rotulo: o.dicaClique || 'Clique para ver os detalhes' }] : [];
      linha.addEventListener('pointermove', (e) => { const [px, py] = ponto(e, alvo); mostrarDica(dica, alvo, item.rotulo, [...conteudo(), ...rodape], px, py); });
      linha.addEventListener('focus', () => mostrarDica(dica, alvo, item.rotulo, conteudo(), linha.offsetLeft + linha.offsetWidth / 2, linha.offsetTop + 20));
      linha.addEventListener('pointerleave', () => esconderDica(dica));
      linha.addEventListener('blur', () => esconderDica(dica));
      if (clicavel) linha.addEventListener('click', () => o.aoClicar(item));
    });
    alvo.appendChild(dica);
  }

  // ---- CASCATA (fechamento) ---------------------------------------------
  // opcoes: passos[{rotulo, valor, tipo: 'mais'|'menos'|'total'}], formato(v), altura?, descricao
  function cascata(alvo, o) {
    montar(alvo, (L, dica) => {
      const H = o.altura || 260;
      // posição de cada barra: de "antes" até "depois"
      let acumulado = 0;
      const barrasC = o.passos.map((p) => {
        const v = Number(p.valor);
        let de; let ate;
        if (p.tipo === 'total') { de = 0; ate = acumulado; } else if (p.tipo === 'menos') { de = acumulado; ate = acumulado - v; acumulado = ate; } else { de = acumulado; ate = acumulado + v; acumulado = ate; }
        return { ...p, de, ate };
      });
      const { min, max, marcas } = escala(barrasC.flatMap((b) => [b.de, b.ate]));
      const fEixo = (v) => compacto.format(v);
      const mE = larguraEixo(marcas, fEixo);
      const mT = 22; const mB = 28; const mD = 6;
      const s = svg('svg', { width: L, height: H, viewBox: `0 0 ${L} ${H}`, role: 'img', 'aria-label': o.descricao || '' }, alvo);
      const y = eixoY(s, marcas, min, max, mT, H - mT - mB, mE, L - mD, fEixo);
      const n = barrasC.length;
      const banda = (L - mE - mD) / n;
      const largura = Math.min(40, banda * 0.6);
      const maxLetras = Math.floor(banda / 6.4);
      const cor = { mais: CORES.verde, menos: CORES.violeta, total: CORES.total };

      barrasC.forEach((b, i) => {
        const x0 = mE + i * banda;
        const xb = x0 + (banda - largura) / 2;
        // conector com a barra seguinte
        if (i < n - 1) svg('line', { x1: xb + largura, x2: xb + banda, y1: y(b.ate), y2: y(b.ate), class: 'conector' }, s);
        const g = svg('g', { class: 'coluna-grafico', tabindex: 0, 'aria-label': `${b.rotulo}: ${b.tipo === 'menos' ? '−' : ''}${o.formato(b.valor)}` }, s);
        svg('rect', { x: x0 + 1, y: mT - 16, width: Math.max(banda - 2, 1), height: H - mT - mB + 16, class: 'faixa', rx: 4 }, g);
        const topo = y(Math.max(b.de, b.ate));
        const alt = Math.max(Math.abs(y(b.de) - y(b.ate)), 1);
        const r = Math.min(3, alt / 2);
        svg('rect', { x: xb, y: topo, width: largura, height: alt, rx: r, fill: cor[b.tipo], class: 'marca' }, g);
        // valor só nos totais (rótulo seletivo); o resto fica na dica e na tabela
        if (b.tipo === 'total') texto(s, xb + largura / 2, Math.min(topo, y(0)) - 6, compacto.format(b.ate), 'rotulo-valor');
        texto(s, x0 + banda / 2, H - 9, encurtar(b.rotulo, maxLetras), 'rotulo-eixo');

        const conteudo = () => [{ cor: cor[b.tipo], valor: `${b.tipo === 'menos' ? '− ' : ''}${o.formato(b.valor)}`, rotulo: b.extra || '' }];
        g.addEventListener('pointermove', (e) => { const [px, py] = ponto(e, alvo); mostrarDica(dica, alvo, b.rotulo, conteudo(), px, py); });
        g.addEventListener('focus', () => mostrarDica(dica, alvo, b.rotulo, conteudo(), x0 + banda / 2, topo));
        g.addEventListener('pointerleave', () => esconderDica(dica));
        g.addEventListener('blur', () => esconderDica(dica));
      });
    });
  }

  // ---- TABELA (os mesmos dados do gráfico) -------------------------------
  // opcoes: rotulos[], series[{nome, valores[]}], formato(v), primeira? (título da 1ª coluna)
  function tabela(alvo, o) {
    alvo.classList.remove('grafico');
    if (alvo.observador) alvo.observador.disconnect();
    alvo.replaceChildren();
    const wrap = html('div', 'tabela-wrap', alvo);
    const t = html('table', 'tabela tabela-relatorio', wrap);
    const cab = html('tr', '', html('thead', '', t));
    html('th', '', cab, o.primeira || '');
    o.series.forEach((s) => html('th', 'num', cab, s.nome));
    const corpo = html('tbody', '', t);
    o.rotulos.forEach((r, i) => {
      const tr = html('tr', '', corpo);
      html('td', '', tr, r);
      o.series.forEach((s) => html('td', 'num', tr, (s.formato || o.formato)(s.valores[i])));
    });
  }

  return { colunas, linhas, barras, cascata, tabela, CORES, compacto };
})();
