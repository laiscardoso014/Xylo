// =====================================================================
// Xylo - DRE para apresentação (dre.html?de=&ate=&comparar=&mensal=&detalhes=)
// Folha pronta para imprimir ou salvar em PDF: logo e dados da empresa,
// a demonstração, indicadores, critérios e linhas de assinatura.
// Depende do comum.js e do dre.js (tabelaDRE, indicadoresDRE...).
// =====================================================================
(function () {
  const $id = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const token = localStorage.getItem('wc_token');
  const usuario = (() => { try { return JSON.parse(localStorage.getItem('wc_usuario')) || {}; } catch { return {}; } })();
  $id('mostrar-detalhes').checked = params.get('detalhes') !== '0';
  let dados = null;
  let empresa = {};

  function erro(texto) {
    $id('folha').innerHTML = `<div class="erro-dre"><h1>Não foi possível abrir a DRE</h1><p>${esc(texto)}</p><a class="btn btn-primario" href="login.html">Entrar</a></div>`;
  }

  async function carregar() {
    if (!token) return erro('Entre no sistema para ver a DRE.');
    const consulta = new URLSearchParams();
    ['de', 'ate', 'comparar', 'mensal'].forEach((k) => { if (params.get(k)) consulta.set(k, params.get(k)); });
    const [r, e] = await Promise.all([
      requisicao(`/relatorios/dre?${consulta}`, { token }),
      requisicao('/empresa', { token }),
    ]).catch((x) => [{ ok: false, dados: { erro: x.message } }, {}]);
    if (r.status === 401) return erro('A sua sessão expirou.');
    if (!r.ok) return erro((r.dados && r.dados.erro) || 'Erro ao montar a DRE.');
    dados = r.dados;
    empresa = (e && e.ok && e.dados) || {};
    desenhar();
  }

  function desenhar() {
    const d = dados;
    const e = empresa;
    const largo = Boolean(d.colunas_meses || d.comparativo);
    document.body.classList.toggle('dre-largo', largo);
    // mês a mês ou com comparação: a folha sai deitada
    let pagina = document.getElementById('estilo-pagina');
    if (!pagina) { pagina = document.createElement('style'); pagina.id = 'estilo-pagina'; document.head.appendChild(pagina); }
    pagina.textContent = `@media print { @page { size: A4 ${largo ? 'landscape' : 'portrait'}; margin: 12mm; } }`;
    document.title = `DRE ${d.periodo.nome} · ${e.nome || ''} | Xylo`;
    const local = [e.cidade, e.uf].filter(Boolean).join('/');
    const fora = (d.fora_da_dre || []).reduce((s, f) => s + f.valor, 0);
    $id('folha').innerHTML = `
      <header class="dre-topo">
        ${e.logo ? `<img src="${esc(e.logo)}" alt="Logo ${esc(e.nome || '')}">` : ''}
        <div>
          <strong>${esc(e.razao_social || e.nome || '')}</strong>
          <span>${[e.cnpj ? `CNPJ ${formatarCnpj(e.cnpj)}` : '', local].filter(Boolean).map(esc).join(' · ')}</span>
        </div>
      </header>
      <h1>Demonstração do Resultado do Exercício</h1>
      <p class="dre-periodo">${esc(d.periodo.nome)}${d.comparativo ? ` <span>comparado com ${esc(d.comparativo.nome)}</span>` : ''}</p>
      <p class="dre-sub">Regime de competência · ${d.fiscal.regime_nome ? `Regime tributário: ${esc(d.fiscal.regime_nome)}` : 'Regime tributário não informado'} · Valores em reais (R$); entre parênteses, deduções, custos e despesas · AV % sobre a receita líquida</p>
      ${tabelaDRE(d, { detalhes: $id('mostrar-detalhes').checked })}
      <section class="dre-bloco"><h2>Indicadores</h2>${indicadoresDRE(d)}</section>
      <section class="dre-bloco dre-notas">
        <h2>Notas</h2>
        <ol>
          <li>Receita: valor das viagens de madeira (peso × preço de venda de cada carga) e dos fretes do período, sem os cancelados.</li>
          <li>Custos: valor pago às florestas e aos empreiteiros informado em cada viagem, mais as despesas da operação (combustível, manutenção...).</li>
          <li>Pessoal: folha de pagamento do mês (salários, comissões, alimentação e extras).</li>
          ${fora ? `<li>${formatarMoeda(fora)} em pagamentos a florestas e empreiteiros, folha paga e adiantamentos não entram como despesa: o custo deles já está nas linhas acima.</li>` : ''}
          ${d.fiscal.aliquota_receita ? `<li>Impostos sobre a receita: ${String(d.fiscal.aliquota_receita).replace('.', ',')}% da receita bruta${d.fiscal.aliquota_ir_csll ? `; IRPJ e CSLL: ${String(d.fiscal.aliquota_ir_csll).replace('.', ',')}% sobre ${d.fiscal.base_ir_csll === 'receita' ? 'a receita bruta' : 'o lucro'}` : ''}.</li>` : ''}
          ${d.avisos.map((a) => `<li class="aviso">${esc(a)}</li>`).join('')}
        </ol>
      </section>
      <section class="dre-assinaturas" ${$id('mostrar-assinaturas').checked ? '' : 'hidden'}>
        <div><span></span>${esc(e.razao_social || e.nome || 'Responsável')}<small>Responsável legal</small></div>
        <div><span></span>Contador(a)<small>CRC</small></div>
      </section>
      <footer class="dre-rodape">Emitido em ${new Date().toLocaleString('pt-BR')}${usuario.nome ? ` por ${esc(usuario.nome)}` : ''} · Xylo · CTech Sistemas</footer>`;
  }

  $id('mostrar-detalhes').addEventListener('change', () => dados && desenhar());
  $id('mostrar-assinaturas').addEventListener('change', () => dados && desenhar());
  $id('btn-imprimir').addEventListener('click', () => window.print());
  carregar();
}());
