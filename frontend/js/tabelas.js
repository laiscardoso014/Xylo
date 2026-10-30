// =====================================================================
// Xylo - ORDENAR E FILTRAR AS TABELAS (todas as telas)
//
// Liga sozinho em toda <table class="tabela"> que aparece na página
// (listas, relatórios, folha, janelas de detalhe):
//   - clique no título da coluna: ordena (crescente -> decrescente -> original)
//   - botão "Filtrar": uma linha de filtros embaixo dos títulos
//       texto  -> "contém" (sem diferenciar acentos/maiúsculas)
//       poucos valores diferentes (cliente, situação, classe...) -> lista
//       números / valores / datas -> 100, >1000, <=50, 10 a 20, >01/10/2026
//   - a linha de TOTAL acompanha o filtro (soma só as linhas visíveis)
// A escolha fica guardada enquanto a aba do navegador estiver aberta: ao
// salvar um registro e a lista recarregar, a ordem e os filtros continuam.
//
// Para deixar uma tabela de fora: class="sem-ordenar" (ex.: a DRE, que tem
// hierarquia de linhas). Para ordenar uma célula por outro valor:
// data-ordem="..." (ex.: a data da viagem em vez do nº).
// Depende do comum.js (formatarMoeda, esc).
// =====================================================================

const TABELAS = (() => {
  const MIN_FILTRO = 5;   // linhas para mostrar o botão Filtrar
  const MAX_LISTA = 12;   // até quantos valores diferentes a coluna vira lista
  const VAZIOS = new Set(['', '–', '—', '-']);
  let estados = {};
  try { estados = JSON.parse(sessionStorage.getItem('xylo-tabelas') || '{}') || {}; } catch { estados = {}; }
  const guardar = () => { try { sessionStorage.setItem('xylo-tabelas', JSON.stringify(estados)); } catch { /* sem armazenamento */ } };

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Texto principal da célula (sem as linhas pequenas .sub); campos digitáveis valem pelo valor
  function textoPrincipal(td) {
    if (!td) return '';
    if (td.dataset.ordem !== undefined) return td.dataset.ordem;
    const campo = td.querySelector('input, select');
    if (campo && !td.textContent.trim()) return campo.value || campo.placeholder || '';
    const copia = td.cloneNode(true);
    copia.querySelectorAll('.sub, button.icone-botao, .etiqueta-origem').forEach((x) => x.remove());
    const t = copia.textContent.replace(/\s+/g, ' ').trim();
    return t || td.textContent.replace(/\s+/g, ' ').trim();
  }
  const textoTodo = (td) => (td ? td.textContent.replace(/\s+/g, ' ').trim() : '');

  // "R$ 1.234,56", "−R$ 10,00", "46,79", "12%", "38,5 t" -> número
  function lerValor(t) {
    const m = String(t).trim().match(/^([−-])?\s*(?:R\$\s*)?([−-])?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(%|t|km|kg)?$/i);
    if (!m) return null;
    const n = Number(`${m[3].replace(/\./g, '')}.${m[4] || '0'}`);
    return (m[1] || m[2]) ? -n : n;
  }
  // "31/10/2026" ou "31/10/2026 14:05" -> número AAAAMMDDhhmm
  function lerData(t) {
    const m = String(t).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2}))?/);
    return m ? Number(`${m[3]}${m[2]}${m[1]}${m[4] || '00'}${m[5] || '00'}`) : null;
  }
  const vazio = (t) => VAZIOS.has(String(t).trim().toLowerCase());

  function tipoDaColuna(valores) {
    const cheios = valores.filter((v) => !vazio(v));
    if (!cheios.length) return 'texto';
    if (cheios.every((v) => lerData(v) !== null)) return 'data';
    if (cheios.every((v) => lerValor(v) !== null)) return 'numero';
    return 'texto';
  }
  const chaveDe = (tipo, t) => (vazio(t) ? null : tipo === 'numero' ? lerValor(t) : tipo === 'data' ? lerData(t) : semAcento(t));

  // Filtro de número/data: "100", ">1000", "<= 50", "10 a 20", "10..20"
  function regraNumerica(txt, tipo) {
    const ler = (x) => (tipo === 'data' ? lerData(completarData(x)) : lerValor(x.replace(/^R\$\s*/i, '')));
    const s = txt.trim();
    let m = s.match(/^(.+?)\s*(?:\.\.|\ba\b|até)\s*(.+)$/i);
    if (m && ler(m[1]) !== null && ler(m[2]) !== null) { const a = ler(m[1]); const b = ler(m[2]); return (v) => v >= Math.min(a, b) && v <= Math.max(a, b); }
    m = s.match(/^(>=|<=|>|<|=)\s*(.+)$/);
    if (m && ler(m[2]) !== null) {
      const x = ler(m[2]);
      return { '>': (v) => v > x, '<': (v) => v < x, '>=': (v) => v >= x, '<=': (v) => v <= x, '=': (v) => v === x }[m[1]];
    }
    return null;
  }
  // "10/2026" ou "15/10" -> data completa para comparar (início do período)
  function completarData(x) {
    const s = x.trim();
    if (/^\d{2}\/\d{4}$/.test(s)) return `01/${s}`;
    if (/^\d{2}\/\d{2}$/.test(s)) return `${s}/${new Date().getFullYear()}`;
    return s;
  }

  // ---------------------------------------------------------------------
  function ligar(tabela) {
    if (tabela._xylo || tabela.classList.contains('sem-ordenar') || tabela.classList.contains('dre-tabela')) return;
    const thead = tabela.tHead;
    const corpo = tabela.tBodies[0];
    if (!thead || !corpo || !thead.rows.length) return;
    const titulos = [...thead.rows[0].cells];
    // só tabelas simples: um título por coluna
    if (titulos.some((th) => th.colSpan > 1)) return;
    const linhas = [...corpo.rows].filter((tr) => tr.cells.length === titulos.length);
    const outras = [...corpo.rows].filter((tr) => tr.cells.length !== titulos.length); // "nenhum registro", etc.
    if (linhas.length < 2) return;
    tabela._xylo = true;

    const nomes = titulos.map((th) => { const c = th.cloneNode(true); c.querySelectorAll('.sub, .ordem-seta').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); });
    const modal = tabela.closest('#modal') ? `modal:${(document.querySelector('#modal-titulo') || {}).textContent || ''}`.replace(/\d{1,2}\/\d{4}|\d+/g, '') : '';
    const chave = `${location.pathname}${location.hash.split(/[?&]/)[0]}|${modal}|${nomes.join('|')}`;
    const estado = estados[chave] || (estados[chave] = { coluna: null, sentido: 1, filtros: {}, aberto: false });

    // Dados de cada coluna
    linhas.forEach((tr, i) => { tr._pos = i; });
    const colunas = titulos.map((th, c) => {
      const principais = linhas.map((tr) => textoPrincipal(tr.cells[c]));
      const tipo = tipoDaColuna(principais);
      const distintos = [...new Set(principais.filter((v) => !vazio(v)))];
      const acoes = !nomes[c] || linhas.every((tr) => tr.cells[c].classList.contains('acoes'));
      return {
        nome: nomes[c], tipo, acoes,
        lista: !acoes && tipo === 'texto' && linhas.length >= MIN_FILTRO && distintos.length >= 2 && distintos.length <= MAX_LISTA && distintos.length < linhas.length
          ? distintos.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })) : null,
      };
    });
    linhas.forEach((tr) => {
      tr._chave = colunas.map((col, c) => chaveDe(col.tipo, textoPrincipal(tr.cells[c])));
      tr._principal = colunas.map((col, c) => textoPrincipal(tr.cells[c]));
      tr._todo = colunas.map((col, c) => semAcento(textoTodo(tr.cells[c])));
    });

    // Totais: só as colunas em que o rodapé é a soma das linhas (assim o filtro pode refazer a conta)
    const rodape = tabela.tFoot && tabela.tFoot.rows.length === 1 ? tabela.tFoot.rows[0] : null;
    const somaveis = [];
    if (rodape) {
      // posição de cada célula do rodapé (com colspan) -> coluna
      let pos = 0;
      [...rodape.cells].forEach((td) => {
        const coluna = pos; pos += td.colSpan;
        td._original = td.innerHTML;
        if (td.colSpan !== 1 || colunas[coluna].tipo !== 'numero') return;
        const total = lerValor(td.textContent);
        if (total === null) return;
        const soma = linhas.reduce((t, tr) => t + (tr._chave[coluna] || 0), 0);
        if (Math.abs(soma - total) <= 0.02 + linhas.length * 0.005) {
          const dec = (td.textContent.match(/,(\d+)/) || ['', ''])[1].length;
          somaveis.push({ td, coluna, moeda: /R\$/.test(td.textContent), dec, menos: /^\s*[−-]/.test(td.textContent) });
        }
      });
    }
    const primeiraDoRodape = rodape ? rodape.cells[0] : null;

    // ---- Cabeçalho: clique para ordenar --------------------------------
    titulos.forEach((th, c) => {
      if (colunas[c].acoes) return;
      th.classList.add('ordenavel');
      th.tabIndex = 0;
      th.title = `Ordenar por ${colunas[c].nome.toLowerCase()}`;
      th.insertAdjacentHTML('beforeend', '<span class="ordem-seta" aria-hidden="true"></span>');
      const ordenar = () => {
        if (estado.coluna !== c) { estado.coluna = c; estado.sentido = 1; }
        else if (estado.sentido === 1) estado.sentido = -1;
        else estado.coluna = null;
        guardar(); aplicar();
      };
      th.addEventListener('click', (e) => { if (!e.target.closest('input, select, button, a')) ordenar(); });
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ordenar(); } });
    });

    // ---- Linha de filtros --------------------------------------------
    const filtrosTr = document.createElement('tr');
    filtrosTr.className = 'linha-filtros';
    filtrosTr.innerHTML = colunas.map((col, c) => {
      if (col.acoes) return '<th></th>';
      const valor = estado.filtros[c] || '';
      const rotulo = `Filtrar ${col.nome.toLowerCase()}`;
      if (col.lista) {
        if (valor && !col.lista.includes(valor)) col.lista.push(valor); // filtro guardado de antes
        return `<th><select data-filtro="${c}" aria-label="${esc(rotulo)}"><option value="">Todos</option>
          ${col.lista.map((v) => `<option ${v === valor ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></th>`;
      }
      const dica = col.tipo === 'numero' && titulos[c].classList.contains('num') ? 'ex.: >100' : col.tipo === 'data' ? 'ex.: 10/2026' : 'contém…';
      return `<th><input type="search" data-filtro="${c}" value="${esc(valor)}" placeholder="${dica}" aria-label="${esc(rotulo)}"
        title="${col.tipo === 'texto' ? 'Parte do texto' : 'Valor, >, <, >=, <= ou intervalo (10 a 20)'}"></th>`;
    }).join('');
    thead.appendChild(filtrosTr);
    filtrosTr.addEventListener('input', (e) => {
      const campo = e.target.closest('[data-filtro]');
      if (!campo) return;
      const c = Number(campo.dataset.filtro);
      if (campo.value.trim()) estado.filtros[c] = campo.value; else delete estado.filtros[c];
      guardar(); aplicar();
    });
    filtrosTr.addEventListener('change', (e) => { if (e.target.matches('select')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });

    // ---- Barra acima da tabela: Filtrar · contador · limpar -------------
    const ancora = tabela.parentElement && tabela.parentElement.classList.contains('tabela-wrap') ? tabela.parentElement : tabela;
    const anterior = ancora.previousElementSibling;
    if (anterior && anterior.classList.contains('barra-tabela')) anterior.remove();
    const barra = document.createElement('div');
    barra.className = 'barra-tabela';
    if (linhas.length < MIN_FILTRO) barra.hidden = true;
    barra.innerHTML = `
      <button type="button" class="link-botao pequeno" data-abrir-filtros aria-expanded="false"><i class="fas fa-filter" aria-hidden="true"></i> Filtrar</button>
      <span class="contagem-tabela" aria-live="polite"></span>
      <button type="button" class="link-botao pequeno" data-limpar-tabela hidden><i class="fas fa-xmark" aria-hidden="true"></i> Limpar filtros e ordem</button>`;
    ancora.before(barra);
    barra.addEventListener('click', (e) => {
      if (e.target.closest('[data-abrir-filtros]')) {
        estado.aberto = !estado.aberto; guardar(); aplicar();
        if (estado.aberto) { const c = filtrosTr.querySelector('input, select'); if (c) c.focus(); }
      }
      if (e.target.closest('[data-limpar-tabela]')) {
        estado.coluna = null; estado.filtros = {}; guardar();
        filtrosTr.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
        aplicar();
      }
    });

    const semResultado = document.createElement('tr');
    semResultado.className = 'sem-resultado-filtro';
    semResultado.innerHTML = `<td colspan="${titulos.length}">Nenhuma linha com estes filtros.</td>`;

    // ---- Aplica ordem e filtros ---------------------------------------
    function passa(tr) {
      return Object.entries(estado.filtros).every(([c, f]) => {
        const col = colunas[c];
        if (!col || !String(f).trim()) return true;
        if (col.lista) return tr._principal[c] === f;
        if (col.tipo !== 'texto') {
          const regra = regraNumerica(f, col.tipo);
          if (regra) return tr._chave[c] !== null && regra(tr._chave[c]);
        }
        return tr._todo[c].includes(semAcento(f));
      });
    }
    function aplicar() {
      const visiveis = [];
      linhas.forEach((tr) => { const ok = passa(tr); tr.hidden = !ok; if (ok) visiveis.push(tr); });
      const ordem = [...linhas];
      const c = estado.coluna;
      if (c !== null && colunas[c]) {
        const s = estado.sentido;
        const tipo = colunas[c].tipo;
        ordem.sort((a, b) => {
          const x = a._chave[c]; const y = b._chave[c];
          if (x === null && y === null) return a._pos - b._pos;
          if (x === null) return 1; // vazios sempre no fim
          if (y === null) return -1;
          const r = tipo === 'texto' ? x.localeCompare(y, 'pt-BR', { numeric: true }) : x - y;
          return r ? r * s : a._pos - b._pos;
        });
      }
      ordem.forEach((tr) => corpo.appendChild(tr));
      outras.forEach((tr) => corpo.appendChild(tr));
      if (!visiveis.length) corpo.appendChild(semResultado); else semResultado.remove();

      titulos.forEach((th, i) => {
        if (colunas[i].acoes) return;
        const ativa = estado.coluna === i;
        th.setAttribute('aria-sort', ativa ? (estado.sentido === 1 ? 'ascending' : 'descending') : 'none');
        th.classList.toggle('ordem-ativa', ativa);
        th.querySelector('.ordem-seta').textContent = ativa ? (estado.sentido === 1 ? '▲' : '▼') : '';
      });

      const nFiltros = Object.values(estado.filtros).filter((f) => String(f).trim()).length;
      const aberto = estado.aberto || nFiltros > 0;
      filtrosTr.hidden = !aberto;
      const abrir = barra.querySelector('[data-abrir-filtros]');
      abrir.setAttribute('aria-expanded', String(aberto));
      abrir.innerHTML = `<i class="fas fa-filter" aria-hidden="true"></i> ${nFiltros ? `Filtros (${nFiltros})` : aberto ? 'Esconder filtros' : 'Filtrar'}`;
      abrir.classList.toggle('filtro-ativo', nFiltros > 0);
      barra.querySelector('.contagem-tabela').textContent = nFiltros ? `${visiveis.length} de ${linhas.length} linhas` : `${linhas.length} linhas`;
      barra.querySelector('[data-limpar-tabela]').hidden = !nFiltros && estado.coluna === null;
      if (nFiltros || estado.coluna !== null) barra.hidden = false;

      // Totais das linhas visíveis
      somaveis.forEach((s) => {
        if (!nFiltros) { s.td.innerHTML = s.td._original; s.td.classList.remove('total-filtrado'); return; }
        const soma = visiveis.reduce((t, tr) => t + (tr._chave[s.coluna] || 0), 0);
        const abs = Math.abs(soma);
        const txt = s.moeda ? formatarMoeda(abs) : abs.toLocaleString('pt-BR', { minimumFractionDigits: s.dec, maximumFractionDigits: s.dec });
        s.td.textContent = `${soma < 0 || (s.menos && soma !== 0) ? '−' : ''}${txt}`;
        s.td.classList.add('total-filtrado');
      });
      if (primeiraDoRodape && somaveis.length) {
        primeiraDoRodape.innerHTML = nFiltros
          ? primeiraDoRodape._original.replace(/\((\d+)(\s)/, `(${visiveis.length}$2`).replace(/^Total\b/, 'Total filtrado')
          : primeiraDoRodape._original;
      }
    }
    aplicar();
  }

  function ligarTodas(raiz = document) {
    raiz.querySelectorAll('table.tabela').forEach((t) => { try { ligar(t); } catch (err) { console.warn('[tabelas]', err); } });
    // barra que ficou sozinha (a lista virou "nenhum registro")
    document.querySelectorAll('.barra-tabela').forEach((b) => {
      const prox = b.nextElementSibling;
      const t = prox && (prox.matches('table') ? prox : prox.querySelector(':scope > table'));
      if (!t || !t._xylo) b.remove();
    });
  }

  // As telas redesenham as tabelas a todo momento: observa a página
  let agendado = false;
  const observador = new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; ligarTodas(); });
  });
  const iniciar = () => { ligarTodas(); observador.observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  return { ligarTodas };
})();
