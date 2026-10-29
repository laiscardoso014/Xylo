// =====================================================================
// QR CODE (sem biblioteca externa) - usado no PIX da fatura
//
//   qrSvg('texto', { tamanho: 220 })  -> '<svg ...>' pronto para pôr na página
//   gerarQr('texto')                  -> { tamanho, modulos: [[true/false...]] }
//
// Segue a norma ISO/IEC 18004: modo byte (UTF-8), correção de erro "M"
// (aguenta ~15% do código sujo/amassado), versão escolhida pelo tamanho
// do texto, máscara com a menor penalidade.
// =====================================================================
(function (raiz) {
  // Tabelas da norma, índice = versão (1 a 40). Nível M.
  const ECC_POR_BLOCO = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLOCOS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
    31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const NIVEL_M = 0; // bits do nível no "format info" (L=1, M=0, Q=3, H=2)

  // Módulos disponíveis para dados (tirando os padrões fixos)
  function modulosDeDados(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const palavrasDeDados = (v) => Math.floor(modulosDeDados(v) / 8) - ECC_POR_BLOCO[v] * BLOCOS[v];

  // ---- Reed-Solomon em GF(256) ------------------------------------------
  function multiplicar(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(grau) {
    const r = new Array(grau).fill(0);
    r[grau - 1] = 1;
    let raizAtual = 1;
    for (let i = 0; i < grau; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = multiplicar(r[j], raizAtual);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      raizAtual = multiplicar(raizAtual, 0x02);
    }
    return r;
  }
  function resto(dados, div) {
    const r = div.map(() => 0);
    for (const b of dados) {
      const fator = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= multiplicar(c, fator); });
    }
    return r;
  }

  // ---- Texto -> palavras (com correção de erro, intercaladas) ------------
  function utf8(texto) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(texto));
    return Array.from(Buffer.from(texto, 'utf8'));
  }

  function montarPalavras(texto) {
    const bytes = utf8(texto);
    let v = 1;
    for (; v <= 40; v++) {
      const bitsContagem = v <= 9 ? 8 : 16;
      if (4 + bitsContagem + bytes.length * 8 <= palavrasDeDados(v) * 8) break;
    }
    if (v > 40) throw new Error('Texto grande demais para um QR Code.');
    const bits = [];
    const por = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
    por(0x4, 4); // modo byte
    por(bytes.length, v <= 9 ? 8 : 16);
    bytes.forEach((b) => por(b, 8));
    const capacidade = palavrasDeDados(v) * 8;
    por(0, Math.min(4, capacidade - bits.length));
    por(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < capacidade; p ^= 0xec ^ 0x11) por(p, 8);
    const dados = [];
    for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // divide em blocos, calcula a correção de cada um e intercala
    const nBlocos = BLOCOS[v];
    const ecc = ECC_POR_BLOCO[v];
    const totalPalavras = Math.floor(modulosDeDados(v) / 8);
    const curtos = nBlocos - (totalPalavras % nBlocos);
    const tamCurto = Math.floor(totalPalavras / nBlocos);
    const div = divisor(ecc);
    const blocos = [];
    for (let i = 0, k = 0; i < nBlocos; i++) {
      const n = tamCurto - ecc + (i < curtos ? 0 : 1);
      const bloco = dados.slice(k, k + n);
      k += n;
      const correcao = resto(bloco, div);
      if (i < curtos) bloco.push(0); // posição vazia para alinhar
      blocos.push(bloco.concat(correcao));
    }
    const saida = [];
    for (let i = 0; i < blocos[0].length; i++) {
      blocos.forEach((b, j) => { if (i !== tamCurto - ecc || j >= curtos) saida.push(b[i]); });
    }
    return { versao: v, palavras: saida };
  }

  // ---- Desenho da matriz --------------------------------------------------
  function posicoesAlinhamento(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const passo = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = v * 4 + 17 - 7; r.length < n; pos -= passo) r.splice(1, 0, pos);
    return r;
  }

  function gerarQr(texto) {
    const { versao: v, palavras } = montarPalavras(String(texto));
    const tam = v * 4 + 17;
    const mod = Array.from({ length: tam }, () => new Array(tam).fill(false));
    const fixo = Array.from({ length: tam }, () => new Array(tam).fill(false));
    const marcar = (x, y, escuro) => { mod[y][x] = escuro; fixo[y][x] = true; };

    // linhas de tempo
    for (let i = 0; i < tam; i++) { marcar(6, i, i % 2 === 0); marcar(i, 6, i % 2 === 0); }
    // localizadores (os 3 quadrados dos cantos)
    const localizador = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < tam && y >= 0 && y < tam) marcar(x, y, d !== 2 && d !== 4);
        }
      }
    };
    localizador(3, 3); localizador(tam - 4, 3); localizador(3, tam - 4);
    // alinhamento
    const al = posicoesAlinhamento(v);
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) marcar(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // reserva o "format info" (desenhado depois da máscara) e a versão
    const desenharFormato = (mascara) => {
      const dados = (NIVEL_M << 3) | mascara;
      let rem = dados;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((dados << 10) | rem) ^ 0x5412;
      const b = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) marcar(8, i, b(i));
      marcar(8, 7, b(6)); marcar(8, 8, b(7)); marcar(7, 8, b(8));
      for (let i = 9; i < 15; i++) marcar(14 - i, 8, b(i));
      for (let i = 0; i < 8; i++) marcar(tam - 1 - i, 8, b(i));
      for (let i = 8; i < 15; i++) marcar(8, tam - 15 + i, b(i));
      marcar(8, tam - 8, true); // módulo sempre escuro
    };
    desenharFormato(0);
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const escuro = ((bits >>> i) & 1) !== 0;
        const a = tam - 11 + (i % 3);
        const c = Math.floor(i / 3);
        marcar(a, c, escuro); marcar(c, a, escuro);
      }
    }
    // dados em zigue-zague, de baixo para cima, de duas em duas colunas
    let i = 0;
    for (let direita = tam - 1; direita >= 1; direita -= 2) {
      if (direita === 6) direita = 5;
      for (let vert = 0; vert < tam; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = direita - j;
          const subindo = ((direita + 1) & 2) === 0;
          const y = subindo ? tam - 1 - vert : vert;
          if (!fixo[y][x] && i < palavras.length * 8) {
            mod[y][x] = ((palavras[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
    // máscaras: testa as 8 e fica com a de menor penalidade
    const MASCARAS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const aplicar = (m) => {
      for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!fixo[y][x] && MASCARAS[m](x, y)) mod[y][x] = !mod[y][x];
    };
    let melhor = 0;
    let menor = Infinity;
    for (let m = 0; m < 8; m++) {
      aplicar(m);
      desenharFormato(m);
      const p = penalidade(mod, tam);
      if (p < menor) { menor = p; melhor = m; }
      aplicar(m); // desfaz
    }
    aplicar(melhor);
    desenharFormato(melhor);
    return { tamanho: tam, versao: v, modulos: mod };
  }

  // Penalidade da norma (N1 corridas, N2 blocos 2x2, N3 parecido com localizador, N4 equilíbrio)
  function penalidade(mod, tam) {
    let p = 0;
    const somaHist = (n, h) => { if (h[0] === 0) n += tam; h.pop(); h.unshift(n); };
    const contaPadroes = (h) => {
      const n = h[1];
      const meio = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (meio && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (meio && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const linha = (get) => {
      let cor = false;
      let corrida = 0;
      const h = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < tam; i++) {
        if (get(i) === cor) {
          corrida++;
          if (corrida === 5) p += 3; else if (corrida > 5) p++;
        } else {
          somaHist(corrida, h);
          if (!cor) p += contaPadroes(h) * 40;
          cor = get(i);
          corrida = 1;
        }
      }
      if (cor) { somaHist(corrida, h); corrida = 0; }
      somaHist(corrida + tam, h);
      p += contaPadroes(h) * 40;
    };
    for (let y = 0; y < tam; y++) linha((x) => mod[y][x]);
    for (let x = 0; x < tam; x++) linha((y) => mod[y][x]);
    for (let y = 0; y < tam - 1; y++) {
      for (let x = 0; x < tam - 1; x++) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
      }
    }
    let escuros = 0;
    mod.forEach((l) => l.forEach((c) => { if (c) escuros++; }));
    const total = tam * tam;
    p += (Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  // SVG (um único <path>: leve e nítido em qualquer tamanho e na impressão)
  function qrSvg(texto, { tamanho = 220, margem = 4, cor = '#000', fundo = '#fff', titulo = 'QR Code' } = {}) {
    const q = gerarQr(texto);
    const lado = q.tamanho + margem * 2;
    let d = '';
    q.modulos.forEach((l, y) => l.forEach((c, x) => { if (c) d += `M${x + margem},${y + margem}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="${tamanho}" height="${tamanho}" role="img" aria-label="${titulo}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${fundo}"/><path d="${d}" fill="${cor}"/></svg>`;
  }

  const api = { gerarQr, qrSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(raiz, api);
}(typeof window !== 'undefined' ? window : globalThis));
