// =====================================================================
// Xylo - IMPORTAR PLANILHA (#importar) - Administrador e Financeiro
//
// 1) escolhe o que importar (viagens, fretes, clientes, florestas, empreiteiros)
// 2) envia o .xlsx (o modelo do sistema ou a planilha antiga)
// 3) confere a PRÉVIA linha a linha: o que entra, o que já existe (duplicada)
//    e o que tem erro - nada é gravado ainda
// 4) importa: só as linhas certas, tudo de uma vez
//
// Depende do comum.js, api.js (enviarArquivo, baixarArquivo) e main.js.
// =====================================================================

const TIPOS_IMPORTACAO = {
  viagens: { titulo: 'Viagens', icone: 'fa-route', texto: 'Cargas com data, cliente, floresta, classe, ticket, placa e peso. Aceita também a planilha antiga, aba por aba.' },
  fretes: { titulo: 'Fretes', icone: 'fa-truck-moving', texto: 'Transporte cobrado à parte: data, cliente/destino, toneladas, valor da tonelada ou total. Aceita a aba FRETES da planilha antiga.' },
  clientes: { titulo: 'Clientes', icone: 'fa-handshake', texto: 'Serrarias que compram a madeira: nome, CNPJ, telefone, e-mail, cidade.' },
  florestas: { titulo: 'Florestas', icone: 'fa-tree', texto: 'De onde sai a madeira: nome, proprietário, município.' },
  empreiteiros: { titulo: 'Empreiteiros', icone: 'fa-helmet-safety', texto: 'Quem corta e carrega: nome, CPF/CNPJ, telefone.' },
};
const SITUACAO = {
  importar: { rotulo: 'Importar', classe: 'selo-ativo' },
  duplicada: { rotulo: 'Já existe', classe: 'selo-inativo' },
  erro: { rotulo: 'Com erro', classe: 'selo-erro' },
};

async function telaImportar() {
  if (!PERFIL.podeEditar) {
    conteudo.innerHTML = '<p class="aviso-erro">Somente Administrador e Financeiro podem importar planilhas.</p>';
    return;
  }

  const estado = { tipo: null, arquivo: null, analise: null, filtro: 'todas', aba: '', origem: 'aba', cliente: '', criar: true, valor: true };
  let clientes = [];

  conteudo.innerHTML = `
    <section class="card">
      <h3 class="passo"><span>1</span> O que você quer importar?</h3>
      <div class="tipos-importacao" role="radiogroup" aria-label="Tipo de importação">
        ${Object.entries(TIPOS_IMPORTACAO).map(([id, t]) => `
          <button type="button" class="tipo-importacao" data-tipo="${id}" role="radio" aria-checked="false">
            <i class="fas ${t.icone}" aria-hidden="true"></i><strong>${t.titulo}</strong><span>${t.texto}</span>
          </button>`).join('')}
      </div>
    </section>
    <section class="card" id="passo-arquivo" hidden>
      <h3 class="passo"><span>2</span> Envie a planilha</h3>
      <div class="zona-arquivo" id="zona-arquivo" tabindex="0" role="button" aria-label="Escolher a planilha .xlsx">
        <i class="fas fa-file-excel" aria-hidden="true"></i>
        <strong id="nome-arquivo">Arraste o arquivo .xlsx aqui ou clique para escolher</strong>
        <span>Até 10 MB. Para planilhas .xls ou .csv, abra no Excel e use "Salvar como" .xlsx.</span>
      </div>
      <input type="file" id="arquivo-importacao" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      <p class="nota">Não tem a planilha pronta? <button type="button" class="link-botao" id="baixar-modelo">Baixe o modelo de <span id="nome-modelo"></span></button>, preencha e envie.</p>
    </section>
    <section id="passo-previa"></section>`;

  try { clientes = await api('/clientes'); } catch { clientes = []; }

  const tipoTexto = () => TIPOS_IMPORTACAO[estado.tipo].titulo.toLowerCase();

  function parametros() {
    const p = new URLSearchParams({ tipo: estado.tipo });
    if (estado.aba) p.set('aba', estado.aba);
    if (estado.tipo === 'viagens') {
      if (estado.cliente) p.set('cliente', estado.cliente); else p.set('origem', estado.origem);
      p.set('criar', estado.criar ? '1' : '0');
      p.set('valor', estado.valor ? '1' : '0');
    }
    if (estado.tipo === 'fretes') {
      if (estado.cliente) p.set('cliente', estado.cliente);
      p.set('criar', estado.criar ? '1' : '0');
    }
    if (estado.arquivo) p.set('nome', estado.arquivo.name);
    return p;
  }

  async function analisar() {
    const box = $('#passo-previa');
    box.innerHTML = '<div class="card carregando">Lendo a planilha…</div>';
    try {
      estado.analise = await enviarArquivo(`/importacao/analisar?${parametros()}`, estado.arquivo);
      if (!$('#passo-previa')) return;
      estado.aba = estado.analise.aba || '';
      desenharPrevia();
    } catch (erro) {
      if (!$('#passo-previa')) return;
      box.innerHTML = `<div class="card"><p class="aviso-erro">${esc(mensagemErro(erro))}</p></div>`;
    }
  }

  function opcoesFretes() {
    return `
      <div class="opcoes-importacao">
        <label class="filtro-campo">Cliente dos fretes
          <select id="op-cliente">
            <option value="" ${!estado.cliente ? 'selected' : ''}>Coluna Cliente da planilha (ex.: BUTI/BALNEARIO)</option>
            <optgroup label="Todas as linhas para o cliente:">
              ${clientes.map((c) => `<option value="${c.id}" ${String(c.id) === String(estado.cliente) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
            </optgroup>
          </select>
        </label>
        <label class="opcao"><input type="checkbox" id="op-criar" ${estado.criar ? 'checked' : ''}> Cadastrar clientes novos</label>
      </div>
      <p class="nota">"BUTI/BALNEARIO" vira cliente <strong>BUTI</strong> com destino <strong>Balneário</strong>. Com Valor ton: cobrança por tonelada; só o Total: valor fechado; "PAGO" ao lado: recebido.</p>`;
  }

  function opcoesViagens() {
    if (estado.tipo === 'fretes') return opcoesFretes();
    if (estado.tipo !== 'viagens') return '';
    return `
      <div class="opcoes-importacao">
        <label class="filtro-campo">Cliente das viagens
          <select id="op-cliente">
            <option value="aba" ${!estado.cliente && estado.origem === 'aba' ? 'selected' : ''}>Nome da aba (ex.: aba PAU BRASIL)</option>
            <option value="bloco" ${!estado.cliente && estado.origem === 'bloco' ? 'selected' : ''}>Título de cada bloco da aba</option>
            <optgroup label="Todas as linhas para o cliente:">
              ${clientes.map((c) => `<option value="${c.id}" ${String(c.id) === String(estado.cliente) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
            </optgroup>
          </select>
        </label>
        <label class="opcao"><input type="checkbox" id="op-criar" ${estado.criar ? 'checked' : ''}> Cadastrar clientes, florestas e empreiteiros novos</label>
        <p class="nota">O valor de venda vem da planilha (Vlr TON ou Vlr Total). Compra da floresta e valor do empreiteiro entram se a planilha tiver essas colunas; senão, complete depois em cada viagem.</p>
      </div>
      <p class="nota">Se a planilha tiver a coluna <strong>Cliente</strong>, ela vale sempre.</p>`;
  }

  function desenharPrevia() {
    const a = estado.analise;
    const box = $('#passo-previa');
    if (!a.aba) {
      box.innerHTML = `<div class="card"><p class="aviso-erro">Não encontrei ${tipoTexto()} nesta planilha. Confira se a primeira linha tem os títulos das colunas
        (ex.: ${{ viagens: 'Data, Cliente, Floresta, Classe, Peso líquido', fretes: 'Nº carga, Data, Cliente, Toneladas, Valor ton, Total' }[estado.tipo] || 'Nome'}) ou use o modelo.</p></div>`;
      return;
    }
    const r = a.resumo;
    const novos = Object.entries(a.novos || {}).filter(([, l]) => l.length);
    const linhas = a.linhas.filter((l) => estado.filtro === 'todas' || l.status === estado.filtro);
    const LIMITE = 400;
    const cols = estado.tipo === 'fretes'
      ? [['Data', (d) => (d.data ? formatarDataISO(d.data) : '—')], ['Cliente', (d) => esc(d.cliente || '—')], ['Destino', (d) => esc(d.destino || '—')],
        ['Toneladas', (d) => (d.toneladas !== null ? formatarPeso(d.toneladas) : '—'), 'num'],
        ['R$/t', (d) => (d.valor_tonelada ? formatarMoeda(d.valor_tonelada) : (d.valor_fechado !== null ? 'fechado' : '—')), 'num'],
        ['Total', (d) => (d.valor_total !== null ? formatarMoeda(d.valor_total) : '—'), 'num'], ['Situação', (d) => esc(d.situacao)]]
      : estado.tipo === 'viagens'
      ? [['Data', (d) => (d.data ? formatarDataISO(d.data) : '—')], ['Cliente', (d) => esc(d.cliente || '—')], ['Floresta', (d) => esc(d.floresta || '—')],
        ['Empreiteiro', (d) => esc(d.empreiteiro || '—')], ['Classe', (d) => esc(d.classe || '—')], ['Ticket', (d) => esc(d.ticket || '—')],
        ['Placa', (d) => esc(d.placa || '—')], ['Peso', (d) => (d.peso !== null ? formatarPeso(d.peso) : '—'), 'num'], ['R$/t', (d) => (d.valor_tonelada ? formatarMoeda(d.valor_tonelada) : '—'), 'num']]
      : [['Nome', (d) => `<strong>${esc(d.nome)}</strong>`], ['CPF/CNPJ', (d) => esc(d.cpf_cnpj ? formatarDocumento(d.cpf_cnpj) : '—')],
        ['Telefone', (d) => esc(d.telefone ? formatarTelefone(d.telefone) : '—')], ['Cidade', (d) => esc([d.cidade || d.municipio, d.estado].filter(Boolean).join('/') || '—')]];

    box.innerHTML = `
      <section class="card">
        <h3 class="passo"><span>3</span> Confira antes de importar</h3>
        <div class="opcoes-importacao">
          <label class="filtro-campo">Aba da planilha
            <select id="op-aba">${a.abas.map((x) => `<option value="${esc(x.nome)}" ${x.nome === a.aba ? 'selected' : ''} ${x.linhas ? '' : 'disabled'}>${esc(x.nome)}${x.linhas ? ` (${x.linhas} linhas)` : ' — sem dados'}</option>`).join('')}</select>
          </label>
        </div>
        ${opcoesViagens()}
        ${(a.alertas || []).map((t) => `<p class="alerta-importacao" role="alert"><i class="fas fa-triangle-exclamation"></i> ${esc(t)}</p>`).join('')}
        <div class="cartoes cartoes-mini resumo-importacao">
          <div class="card cartao"><div><strong>${r.importar}</strong><span>${r.importar === 1 ? 'linha será importada' : 'linhas serão importadas'}${r.toneladas ? ` · ${formatarPeso(r.toneladas)} t` : ''}${r.valor !== undefined ? ` · ${formatarMoeda(r.valor)}` : ''}</span></div></div>
          <div class="card cartao"><div><strong>${r.duplicadas}</strong><span>já existem (ficam de fora)</span></div></div>
          <div class="card cartao"><div><strong>${r.erros}</strong><span>com erro (ficam de fora)</span></div></div>
        </div>
        ${novos.length ? `<p class="nota"><strong>Cadastros novos que serão criados:</strong> ${novos.map(([t, l]) => `${t}: ${l.map(esc).join(', ')}`).join(' · ')}</p>` : ''}
        <div class="abas abas-filtro" role="tablist">
          ${[['todas', `Todas (${a.linhas.length})`], ['importar', `A importar (${r.importar})`], ['duplicada', `Já existem (${r.duplicadas})`], ['erro', `Com erro (${r.erros})`]]
            .map(([id, t]) => `<button type="button" class="aba ${estado.filtro === id ? 'ativa' : ''}" data-filtro="${id}" role="tab">${t}</button>`).join('')}
        </div>
        <div class="tabela-wrap">
          <table class="tabela tabela-relatorio tabela-previa">
            <thead><tr><th>Linha</th><th>Situação</th>${cols.map(([t, , c]) => `<th class="${c || ''}">${t}</th>`).join('')}<th>Observações</th></tr></thead>
            <tbody>${linhas.slice(0, LIMITE).map((l) => `
              <tr class="previa-${l.status}">
                <td>${l.linha}</td>
                <td><span class="selo ${SITUACAO[l.status].classe}">${SITUACAO[l.status].rotulo}</span></td>
                ${cols.map(([, f, c]) => `<td class="${c || ''}">${f(l.dados)}</td>`).join('')}
                <td class="obs-previa">${l.erros.map((e) => `<span class="erro-linha">${esc(e)}</span>`).join('')}${l.avisos.map((e) => `<span>${esc(e)}</span>`).join('')}</td>
              </tr>`).join('') || `<tr><td colspan="${cols.length + 3}" class="vazio">Nenhuma linha neste filtro.</td></tr>`}</tbody>
          </table>
        </div>
        ${linhas.length > LIMITE ? `<p class="nota">Mostrando as primeiras ${LIMITE} de ${linhas.length} linhas.</p>` : ''}
        <div class="acoes-form">
          <button type="button" class="btn btn-primario" id="btn-importar" ${r.importar ? '' : 'disabled'}>
            <i class="fas fa-file-import"></i> Importar ${r.importar} ${r.importar === 1 ? 'linha' : 'linhas'}</button>
          ${r.erros ? '<span class="nota">As linhas com erro ficam de fora: corrija na planilha e envie de novo (as já importadas não duplicam).</span>' : ''}
        </div>
      </section>`;

    $('#op-aba').addEventListener('change', (e) => { estado.aba = e.target.value; estado.filtro = 'todas'; analisar(); });
    if (estado.tipo === 'fretes') {
      $('#op-cliente').addEventListener('change', (e) => { estado.cliente = e.target.value; analisar(); });
      $('#op-criar').addEventListener('change', (e) => { estado.criar = e.target.checked; analisar(); });
    }
    if (estado.tipo === 'viagens') {
      $('#op-cliente').addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === 'aba' || v === 'bloco') { estado.origem = v; estado.cliente = ''; } else estado.cliente = v;
        analisar();
      });
      $('#op-criar').addEventListener('change', (e) => { estado.criar = e.target.checked; analisar(); });

    }
  }

  async function importar(botao) {
    const r = estado.analise.resumo;
    if (!confirm(`Importar ${r.importar} ${r.importar === 1 ? 'linha' : 'linhas'} de ${tipoTexto()} da aba "${estado.analise.aba}"?`)) return;
    botao.disabled = true;
    botao.textContent = 'Importando…';
    try {
      const res = await enviarArquivo(`/importacao/gravar?${parametros()}`, estado.arquivo);
      const criados = Object.entries(res.novos || {}).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`).join(', ');
      toast(`${res.importadas} ${res.importadas === 1 ? 'linha importada' : 'linhas importadas'}.`);
      const meses = [...new Set(estado.analise.linhas.filter((l) => l.status === 'importar' && l.dados.data).map((l) => l.dados.data.slice(0, 7)))].sort();
      $('#passo-previa').innerHTML = `
        <section class="card resultado-importacao">
          <h3><i class="fas fa-circle-check"></i> Importação concluída</h3>
          <p><strong>${res.importadas}</strong> ${res.importadas === 1 ? 'linha importada' : 'linhas importadas'} da aba "${esc(estado.analise.aba)}".
            ${res.duplicadas ? `${res.duplicadas} já existiam e ficaram de fora.` : ''} ${res.erros ? `${res.erros} com erro ficaram de fora.` : ''}</p>
          ${criados ? `<p>Cadastros criados: ${esc(criados)}. Lembre de completar os dados deles (CNPJ, telefone).</p>` : ''}
          <div class="acoes-form">
            ${estado.tipo === 'viagens' && meses.length ? `<a class="btn btn-primario" href="#viagens" data-mes="${meses[0]}" id="ver-importadas">Ver viagens de ${esc(meses[0].split('-').reverse().join('/'))}</a>` : ''}
            ${estado.tipo === 'fretes' && meses.length ? `<a class="btn btn-primario" href="#fretes" data-mes="${meses[0]}" id="ver-fretes-importados">Ver fretes de ${esc(meses[0].split('-').reverse().join('/'))}</a>` : ''}
            ${estado.tipo !== 'viagens' && estado.tipo !== 'fretes' ? `<a class="btn btn-primario" href="#${estado.tipo}">Ver ${tipoTexto()}</a>` : ''}
            <button type="button" class="btn btn-secundario" id="importar-outra">Importar outra aba ou planilha</button>
          </div>
        </section>`;
      const ver = $('#ver-importadas');
      if (ver) ver.addEventListener('click', () => { mesViagens = ver.dataset.mes; });
      const verFretes = $('#ver-fretes-importados');
      if (verFretes) verFretes.addEventListener('click', () => { mesFretes = verFretes.dataset.mes; });
      try { clientes = await api('/clientes'); } catch { /* mantém a lista */ }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
      botao.disabled = false;
      botao.innerHTML = '<i class="fas fa-file-import"></i> Tentar de novo';
    }
  }

  function escolherArquivo(arquivo) {
    if (!arquivo) return;
    if (!/\.xlsx$/i.test(arquivo.name)) { toast('Envie um arquivo .xlsx (Excel).', 'erro'); return; }
    if (arquivo.size > 10 * 1024 * 1024) { toast('Arquivo grande demais (máximo 10 MB).', 'erro'); return; }
    estado.arquivo = arquivo;
    estado.aba = '';
    estado.filtro = 'todas';
    $('#nome-arquivo').textContent = arquivo.name;
    $('#zona-arquivo').classList.add('com-arquivo');
    analisar();
  }

  // ---- Eventos ---------------------------------------------------------
  const zona = $('#zona-arquivo');
  zona.addEventListener('click', () => $('#arquivo-importacao').click());
  zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#arquivo-importacao').click(); } });
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastando'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastando'); escolherArquivo(e.dataTransfer.files[0]); });
  $('#arquivo-importacao').addEventListener('change', (e) => { escolherArquivo(e.target.files[0]); e.target.value = ''; });

  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.tipo) {
      estado.tipo = alvo.dataset.tipo;
      document.querySelectorAll('.tipo-importacao').forEach((b) => b.setAttribute('aria-checked', String(b === alvo)));
      $('#passo-arquivo').hidden = false;
      $('#nome-modelo').textContent = tipoTexto();
      if (estado.arquivo) { estado.aba = ''; analisar(); } else $('#passo-previa').innerHTML = '';
    }
    if (alvo.id === 'baixar-modelo') {
      try { await baixarArquivo(`/importacao/modelo?tipo=${estado.tipo}`, `modelo-${estado.tipo}.xlsx`); } catch (erro) { toast(mensagemErro(erro), 'erro'); }
    }
    if (alvo.dataset.filtro) { estado.filtro = alvo.dataset.filtro; desenharPrevia(); }
    if (alvo.id === 'btn-importar') importar(alvo);
    if (alvo.id === 'importar-outra') { estado.analise = null; analisar(); }
  };
}
