// =====================================================================
// Xylo - FOLHA DE PAGAMENTO (main.html#folha) - Administrador e Financeiro
//
// Aba "Folha do mês" (competência): uma linha por funcionário, como a aba
// FOLHA da planilha: salário + comissão + alimentação + extras
// - adiantamento - desconto = saldo a pagar.
//   - Comissão do motorista: calculada carga por carga (km da rota x faixa
//     dele). O link mostra as cargas; dá para corrigir o km de uma carga.
//   - Adiantamento: as parcelas que caem no mês (aba Adiantamentos).
//   - Situação: Aberta (acompanha os lançamentos) -> Fechada -> Paga
//     (o pagamento gera as despesas "Folha de pagamento").
// Aba "Adiantamentos": vales e adiantamentos parcelados.
//
// Depende do comum.js, do api.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

let competenciaFolha = mesAtualISO();
let abaFolha = 'folha';

async function telaFolha() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Competência <input type="month" id="comp-folha" value="${competenciaFolha}"></label>
      <span id="situacao-folha"></span>
      <span class="espaco"></span>
      <a class="btn btn-secundario" href="#funcionarios"><i class="fas fa-id-card"></i> Funcionários</a>
      <button type="button" class="btn btn-secundario" id="btn-excel-folha"><i class="fas fa-file-excel"></i> Exportar Excel</button>
    </div>
    <div class="abas" role="tablist">
      <button type="button" class="aba ${abaFolha === 'folha' ? 'ativa' : ''}" data-aba-folha="folha" role="tab">Folha do mês</button>
      <button type="button" class="aba ${abaFolha === 'adiantamentos' ? 'ativa' : ''}" data-aba-folha="adiantamentos" role="tab">Adiantamentos</button>
    </div>
    <div id="corpo-folha" class="carregando">Carregando…</div>`;

  let folha = null;
  let adiantamentos = [];
  let funcionarios = [];
  const mesBR = (c) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
  const decimal = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const SELO = { Aberta: 'selo-pendente', Fechada: 'selo-perfil', Paga: 'selo-ativo', Mista: 'selo-inativo', Vazia: 'selo-inativo' };

  async function carregar() {
    competenciaFolha = $('#comp-folha').value || mesAtualISO();
    try {
      if (abaFolha === 'folha') {
        folha = await api(`/folha?competencia=${competenciaFolha}`);
        if (!$('#corpo-folha')) return;
        desenharFolha();
      } else {
        const [a, f] = await Promise.all([api('/folha/adiantamentos'), api('/funcionarios')]);
        if (!$('#corpo-folha')) return;
        adiantamentos = a;
        funcionarios = f.funcionarios;
        desenharAdiantamentos();
      }
    } catch (erro) {
      $('#corpo-folha').className = 'aviso-erro';
      $('#corpo-folha').textContent = mensagemErro(erro);
    }
  }

  // ---- Folha do mês ---------------------------------------------------
  function desenharFolha() {
    const f = folha;
    const t = f.totais;
    $('#situacao-folha').innerHTML = f.situacao === 'Vazia' ? '' : `<span class="selo ${SELO[f.situacao]}">${f.situacao === 'Mista' ? 'Situações diferentes' : `Folha ${f.situacao.toLowerCase()}`}</span>`;
    const box = $('#corpo-folha');
    if (!f.linhas.length) {
      box.className = 'card vazio';
      box.innerHTML = `<p>Ainda não há folha de <strong>${mesBR(f.competencia)}</strong>.</p>
        ${f.funcionarios_sem_folha ? `<p><button type="button" class="btn btn-primario" id="btn-gerar-folha"><i class="fas fa-wand-magic-sparkles"></i> Gerar folha de ${mesBR(f.competencia)}</button></p>
          <p class="sub">Cria uma linha para cada um dos ${f.funcionarios_sem_folha} funcionários ativos, com salário, alimentação, comissão das cargas e as parcelas de adiantamento do mês.</p>`
          : '<p class="sub">Cadastre os funcionários primeiro (botão Funcionários).</p>'}`;
      return;
    }
    const aberta = f.linhas.some((l) => l.status === 'Aberta');
    const fechada = f.linhas.some((l) => l.status === 'Fechada');
    const paga = f.linhas.some((l) => l.status === 'Paga');
    const pendencias = f.linhas.filter((l) => l.pendencias && (l.pendencias.sem_km || l.pendencias.sem_faixa));
    box.className = '';
    box.innerHTML = `
      <div class="cartoes cartoes-mini">
        <div class="card cartao"><div class="cartao-icone"><i class="fas fa-sack-dollar"></i></div><div><strong>${formatarMoeda(t.saldo_pagar)}</strong><span>saldo a pagar</span></div></div>
        <div class="card cartao"><div class="cartao-icone"><i class="fas fa-truck"></i></div><div><strong>${formatarMoeda(t.comissao)}</strong><span>comissões</span></div></div>
        <div class="card cartao"><div class="cartao-icone"><i class="fas fa-hand-holding-dollar"></i></div><div><strong>${formatarMoeda(t.adiantamento)}</strong><span>adiantamentos descontados</span></div></div>
        <div class="card cartao"><div class="cartao-icone"><i class="fas fa-users"></i></div><div><strong>${f.linhas.length}</strong><span>funcionários</span></div></div>
      </div>
      ${pendencias.length ? `<p class="alerta-importacao" role="alert"><i class="fas fa-triangle-exclamation"></i>
        Comissão incompleta: ${pendencias.map((l) => `<a href="#" data-comissao="${l.id}">${esc(l.nome)}</a> (${l.pendencias.sem_km ? `${l.pendencias.sem_km} carga${l.pendencias.sem_km === 1 ? '' : 's'} sem km` : ''}${l.pendencias.sem_km && l.pendencias.sem_faixa ? ', ' : ''}${l.pendencias.sem_faixa ? 'sem faixa para a distância' : ''})`).join(' · ')}.
        Cadastre o km em <a href="#rotas">Rotas e distâncias</a> ou corrija na carga.</p>` : ''}
      ${f.funcionarios_sem_folha && aberta ? `<p class="nota">${f.funcionarios_sem_folha} funcionário(s) ativo(s) ainda sem linha neste mês. <button type="button" class="link-botao pequeno" id="btn-gerar-folha">Incluir na folha</button></p>` : ''}
      <div class="card sem-padding"><div class="tabela-wrap">
        <table class="tabela tabela-folha">
          <thead><tr><th>Funcionário</th><th class="num">Salário base</th><th class="num">Comissão</th><th class="num">Alimentação</th><th class="num">Extras</th>
            <th class="num">Adto</th><th class="num">Desconto</th><th class="num">Saldo a pagar</th><th>Situação</th><th></th></tr></thead>
          <tbody>${f.linhas.map((l) => `
            <tr>
              <td><strong>${esc(l.nome)}</strong><div class="sub">${esc(l.cargo)}${l.observacoes ? ` · ${esc(l.observacoes)}` : ''}</div></td>
              <td class="num">${formatarMoeda(l.salario_base)}</td>
              <td class="num">${l.motorista_id
                ? `<a href="#" data-comissao="${l.id}" title="Ver as cargas">${formatarMoeda(l.comissao)}</a>${l.comissao_manual ? '<div class="sub">digitada</div>' : l.pendencias ? `<div class="sub">${formatarPeso(l.pendencias.toneladas)} t · ${l.pendencias.cargas} carga${l.pendencias.cargas === 1 ? '' : 's'}</div>` : ''}${l.pendencias && (l.pendencias.sem_km || l.pendencias.sem_faixa) ? '<div class="sub alerta">incompleta</div>' : ''}`
                : (Number(l.comissao) ? formatarMoeda(l.comissao) : '–')}</td>
              <td class="num">${Number(l.alimentacao) ? formatarMoeda(l.alimentacao) : '–'}</td>
              <td class="num">${Number(l.extras) ? formatarMoeda(l.extras) : '–'}</td>
              <td class="num">${Number(l.adiantamento) ? `−${formatarMoeda(l.adiantamento)}` : '–'}</td>
              <td class="num">${Number(l.desconto) ? `−${formatarMoeda(l.desconto)}` : '–'}</td>
              <td class="num"><strong>${formatarMoeda(l.saldo_pagar)}</strong></td>
              <td><span class="selo ${SELO[l.status]}">${l.status}</span>${l.data_pagamento ? `<div class="sub">${formatarDataISO(l.data_pagamento)}</div>` : ''}</td>
              <td class="acoes">${l.status === 'Aberta' ? `<button type="button" class="icone-botao" data-editar-folha="${l.id}" title="Editar valores do mês"><i class="fas fa-pen"></i></button>` : ''}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${formatarMoeda(t.salario_base)}</td><td class="num">${formatarMoeda(t.comissao)}</td><td class="num">${formatarMoeda(t.alimentacao)}</td>
            <td class="num">${formatarMoeda(t.extras)}</td><td class="num">−${formatarMoeda(t.adiantamento)}</td><td class="num">−${formatarMoeda(t.desconto)}</td>
            <td class="num">${formatarMoeda(t.saldo_pagar)}</td><td colspan="2"></td></tr></tfoot>
        </table>
      </div></div>
      <div class="acoes-form">
        ${aberta ? `<button type="button" class="btn btn-primario" id="btn-fechar-folha"><i class="fas fa-lock"></i> Fechar folha de ${mesBR(f.competencia)}</button>` : ''}
        ${fechada ? `<button type="button" class="btn btn-primario" id="btn-pagar-folha"><i class="fas fa-money-bill-wave"></i> Registrar pagamento</button>` : ''}
        ${fechada && PERFIL.admin ? '<button type="button" class="btn btn-secundario" id="btn-reabrir-folha"><i class="fas fa-lock-open"></i> Reabrir</button>' : ''}
        ${paga && PERFIL.admin ? '<button type="button" class="btn btn-secundario" id="btn-desfazer-pagamento"><i class="fas fa-rotate-left"></i> Desfazer pagamento</button>' : ''}
        <span class="nota">${aberta ? 'Aberta: a comissão e os adiantamentos acompanham os lançamentos. Ao fechar, os valores ficam congelados.'
          : fechada ? 'Fechada: valores congelados. O pagamento gera uma despesa "Folha de pagamento" para cada funcionário.'
            : 'Paga: as despesas da folha estão lançadas em Despesas.'}</span>
      </div>`;
  }

  function editarLinha(l) {
    abrirModal(`${l.nome} · ${mesBR(l.competencia)}`, `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo"><label>Salário base</label><input name="salario_base" inputmode="decimal" value="${decimal(l.salario_base)}"></div>
          <div class="campo"><label>Comissão</label><input name="comissao" inputmode="decimal" value="${decimal(l.comissao)}" ${l.motorista_id ? '' : ''}>
            <small>${l.motorista_id ? (l.comissao_manual ? 'Digitada à mão. <button type="button" class="link-botao pequeno" id="voltar-calculo">Voltar ao cálculo das cargas</button>' : 'Calculada pelas cargas. Se mudar, fica fixa (não recalcula).') : 'Não é motorista: só se houver.'}</small></div>
          <div class="campo"><label>Alimentação</label><input name="alimentacao" inputmode="decimal" value="${decimal(l.alimentacao)}"></div>
          <div class="campo"><label>Extras</label><input name="extras" inputmode="decimal" value="${decimal(l.extras)}"></div>
          <div class="campo"><label>Adiantamento</label><input value="${decimal(l.adiantamento)}" readonly>
            <small>Vem das parcelas do mês (aba Adiantamentos)</small></div>
          <div class="campo"><label>Desconto</label><input name="desconto" inputmode="decimal" value="${decimal(l.desconto)}"></div>
          <div class="campo larga"><label>Observações</label><textarea name="observacoes" rows="2" placeholder="Ex.: 300 de extra autorizado pelo Lucas">${esc(l.observacoes)}</textarea></div>
        </div>
        <div class="previa" id="previa-saldo"></div>
        ${RODAPE_FORMULARIO}
      </form>`);
    const form = $('#modal-corpo form');
    const v = (n) => { const x = lerNumero(form.elements[n].value); return Number.isFinite(x) ? x : 0; };
    const previa = () => {
      const saldo = v('salario_base') + v('comissao') + v('alimentacao') + v('extras') - Number(l.adiantamento) - v('desconto');
      $('#previa-saldo').innerHTML = `Saldo a pagar: <strong>${formatarMoeda(saldo)}</strong>`;
    };
    form.addEventListener('input', previa);
    previa();
    const voltar = $('#voltar-calculo');
    if (voltar) {
      voltar.addEventListener('click', async () => {
        try { await api(`/folha/${l.id}`, { metodo: 'PUT', corpo: { recalcular_comissao: true } }); fecharModal(); toast('Comissão recalculada pelas cargas.'); carregar(); } catch (erro) { toast(mensagemErro(erro), 'erro'); }
      });
    }
    ligarFormulario(async (d) => {
      await api(`/folha/${l.id}`, { metodo: 'PUT', corpo: d });
      toast('Folha atualizada.');
      carregar();
    });
  }

  async function verComissao(id) {
    abrirModal('Comissão', '<div class="carregando">Carregando as cargas…</div>');
    $('#modal').classList.add('modal-amplo');
    try {
      const c = await api(`/folha/${id}/comissao`);
      const aberta = c.folha.status === 'Aberta';
      $('#modal-titulo').textContent = `Comissão · ${c.folha.nome} · ${mesBR(c.folha.competencia)}`;
      $('#modal-corpo').innerHTML = `
        <div class="detalhe-comissao">
          <p class="sub">Motorista nas cargas: <strong>${esc(c.folha.motorista || '–')}</strong> ·
            Faixas: ${c.faixas.length ? c.faixas.map((x) => `${esc(x.texto)} ${formatarMoeda(x.valor_tonelada)}/t`).join(' · ') : '<span class="alerta">nenhuma (cadastre em Funcionários)</span>'}
            ${c.folha.comissao_manual ? ` · <span class="alerta">na folha está a comissão digitada (${formatarMoeda(c.folha.comissao)})</span>` : ''}</p>
          ${!c.cargas.length ? '<p class="vazio">Nenhuma viagem ou frete com este motorista no mês.</p>' : `
          <div class="tabela-wrap"><table class="tabela tabela-comissao">
            <thead><tr><th>Data</th><th>Carga</th><th>Rota</th><th class="num">Km</th><th>Faixa</th><th class="num">Toneladas</th><th class="num">R$/t</th><th class="num">Comissão</th></tr></thead>
            <tbody>${c.cargas.map((x) => `
              <tr class="${x.pendencia ? 'carga-pendente' : ''}">
                <td>${formatarDataISO(x.data)}</td>
                <td>${x.tipo === 'viagem' ? 'Viagem' : 'Frete'} nº ${esc(x.numero)}${x.ticket ? `<div class="sub">ticket ${esc(x.ticket)}</div>` : ''}</td>
                <td>${esc(x.origem)} → ${esc(x.destino || '(sem destino)')}</td>
                <td class="num">${aberta
                  ? `<input class="km-inline" data-km-carga="${x.id}" data-tipo="${x.tipo}" inputmode="decimal" value="${x.km_origem === 'carga' ? String(x.km).replace('.', ',') : ''}" placeholder="${x.km_rota !== null ? String(x.km_rota).replace('.', ',') : 'km'}" title="${x.km_origem === 'carga' ? 'Km corrigido nesta carga (apague para usar o da rota)' : x.km_rota !== null ? 'Km da rota; digite para corrigir só nesta carga' : 'Rota sem km'}">`
                  : (x.km !== null ? String(x.km).replace('.', ',') : '–')}
                  ${x.km_origem === 'carga' ? '<div class="sub">corrigido</div>' : ''}</td>
                <td>${x.faixa ? esc(x.faixa) : `<span class="alerta">${x.pendencia === 'sem_km' ? 'sem km' : 'sem faixa'}</span>`}</td>
                <td class="num">${formatarPeso(x.toneladas)}</td>
                <td class="num">${x.valor_tonelada !== null ? formatarMoeda(x.valor_tonelada) : '–'}</td>
                <td class="num"><strong>${formatarMoeda(x.valor)}</strong></td>
              </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="5">Total (${c.cargas.length} carga${c.cargas.length === 1 ? '' : 's'})</td><td class="num">${formatarPeso(c.toneladas)}</td><td></td><td class="num">${formatarMoeda(c.total)}</td></tr></tfoot>
          </table></div>`}
          ${c.sem_km ? `<p class="alerta-importacao"><i class="fas fa-triangle-exclamation"></i> ${c.sem_km} carga(s) sem km não entram na comissão. Digite o km na carga ou cadastre a rota em <a href="#rotas" data-fechar>Rotas e distâncias</a> (vale para todas as cargas daquela rota).</p>` : ''}
          ${!aberta ? '<p class="nota">Folha fechada: estas são as cargas como estavam ao fechar.</p>' : ''}
        </div>`;
      $('#modal-corpo').querySelectorAll('[data-km-carga]').forEach((campo) => {
        campo.addEventListener('change', async () => {
          try {
            await api('/rotas/carga', { metodo: 'PUT', corpo: { tipo: campo.dataset.tipo, id: Number(campo.dataset.kmCarga), km: campo.value.trim() } });
            toast(campo.value.trim() ? 'Km corrigido nesta carga.' : 'A carga volta a usar o km da rota.');
            await verComissao(id);
            carregar();
          } catch (erro) {
            toast(mensagemErro(erro), 'erro');
          }
        });
      });
      const link = $('#modal-corpo [data-fechar]');
      if (link) link.addEventListener('click', () => fecharModal());
    } catch (erro) {
      $('#modal-corpo').innerHTML = `<p class="aviso-erro">${esc(mensagemErro(erro))}</p>`;
    }
  }

  function pagar() {
    const fechadas = folha.linhas.filter((l) => l.status === 'Fechada');
    const total = fechadas.reduce((t, l) => t + Math.max(0, Number(l.saldo_pagar)), 0);
    abrirModal(`Pagamento da folha de ${mesBR(folha.competencia)}`, `
      <form novalidate>
        <p>Vai registrar o pagamento de <strong>${fechadas.length}</strong> funcionário(s), somando <strong>${formatarMoeda(total)}</strong>.</p>
        <p class="sub">Para cada um com saldo, entra em Despesas uma despesa paga na categoria <strong>Folha de pagamento</strong>
          (ela aparece no Fechamento do mês do pagamento).</p>
        <div class="campo"><label>Data do pagamento *</label><input name="data" type="date" required value="${hojeISO()}"></div>
        ${RODAPE_FORMULARIO}
      </form>`);
    ligarFormulario(async (d) => {
      const r = await api('/folha/pagar', { metodo: 'POST', corpo: { competencia: folha.competencia, data: d.data } });
      toast(`Pagamento registrado: ${formatarMoeda(r.total)} em ${r.pagas} funcionário(s).`);
      carregar();
    });
  }

  // ---- Adiantamentos --------------------------------------------------
  function desenharAdiantamentos() {
    $('#situacao-folha').innerHTML = '';
    const box = $('#corpo-folha');
    box.className = '';
    const SIT = { descontada: 'selo-ativo', 'na folha aberta': 'selo-pendente', 'a descontar': 'selo-inativo' };
    box.innerHTML = `
      <div class="barra-ferramentas"><span class="sub">Vales e adiantamentos: cada parcela é descontada na folha da competência dela.</span><span class="espaco"></span>
        <button type="button" class="btn btn-primario" id="btn-novo-adto"><i class="fas fa-plus"></i> Novo adiantamento</button></div>
      ${!adiantamentos.length ? '<div class="card vazio">Nenhum adiantamento lançado.</div>' : `
      <div class="lista-adiantamentos">${adiantamentos.map((a) => `
        <article class="card item-adto">
          <div class="item-topo"><strong class="item-resumo">${esc(a.nome)}</strong><span class="item-valor">${formatarMoeda(a.valor)}</span></div>
          <p class="sub">${formatarDataISO(a.data)}${a.descricao ? ` · ${esc(a.descricao)}` : ''} · ${a.parcelas === 1 ? 'parcela única' : `${a.parcelas} parcelas`}${a.despesa_id ? ' · lançado em Despesas' : ''}
            · falta descontar <strong>${formatarMoeda(a.restante)}</strong></p>
          <div class="parcelas">${a.lista.map((p) => `<span class="parcela selo ${SIT[p.situacao]}" title="${p.situacao}">${mesBR(p.competencia)} · ${formatarMoeda(p.valor)}</span>`).join('')}</div>
          ${a.lista.every((p) => p.situacao !== 'descontada') ? `<button type="button" class="link-botao pequeno perigo-texto" data-excluir-adto="${a.id}">Excluir</button>` : ''}
        </article>`).join('')}</div>`}`;
  }

  function novoAdiantamento() {
    const ativos = funcionarios.filter((f) => f.ativo);
    abrirModal('Novo adiantamento', `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga"><label>Funcionário *</label><select name="funcionario_id" required><option value="">Selecione…</option>
            ${ativos.map((f) => `<option value="${f.id}">${esc(f.nome)} · ${esc(f.cargo)}</option>`).join('')}</select></div>
          <div class="campo"><label>Data (quando o dinheiro saiu) *</label><input name="data" type="date" required value="${hojeISO()}"></div>
          <div class="campo"><label>Valor total (R$) *</label><input name="valor" required inputmode="decimal" placeholder="Ex.: 3.805,00"></div>
          <div class="campo"><label>Parcelas</label><input name="parcelas" type="number" min="1" max="36" value="1"></div>
          <div class="campo"><label>Descontar a partir de *</label><input name="competencia" type="month" required value="${competenciaFolha}"></div>
          <div class="campo larga"><label>Descrição</label><input name="descricao" maxlength="200" placeholder="Ex.: vale, gás, conserto do celular"></div>
          <div class="campo larga"><label class="opcao"><input type="checkbox" name="lancar_despesa" checked> Lançar a saída do dinheiro em Despesas (categoria Adiantamento)</label>
            <small>Desmarque se o dinheiro já foi lançado em Despesas por outro caminho.</small></div>
        </div>
        <div class="previa" id="previa-parcelas"></div>
        ${RODAPE_FORMULARIO}
      </form>`);
    const form = $('#modal-corpo form');
    const previa = () => {
      const valor = lerNumero(form.elements.valor.value);
      const n = Math.max(1, Math.min(36, Number(form.elements.parcelas.value) || 1));
      const comp = form.elements.competencia.value;
      if (!Number.isFinite(valor) || valor <= 0 || !comp) { $('#previa-parcelas').textContent = 'Informe o valor para ver as parcelas.'; return; }
      const base = Math.floor((valor / n) * 100) / 100;
      const [a, m] = comp.split('-').map(Number);
      const lista = Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.UTC(a, m - 1 + i, 1));
        const v = i === n - 1 ? Math.round((valor - base * (n - 1)) * 100) / 100 : base;
        return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}: ${formatarMoeda(v)}`;
      });
      $('#previa-parcelas').innerHTML = `Desconto na folha: ${lista.join(' · ')}`;
    };
    form.addEventListener('input', previa);
    previa();
    ligarFormulario(async (d) => {
      await api('/folha/adiantamentos', { metodo: 'POST', corpo: { ...d, lancar_despesa: form.elements.lancar_despesa.checked } });
      toast('Adiantamento lançado.');
      carregar();
    });
  }

  // ---- Eventos ---------------------------------------------------------
  cliqueDaTela = async (e) => {
    const link = e.target.closest('[data-comissao]');
    if (link) { e.preventDefault(); verComissao(Number(link.dataset.comissao)); return; }
    const alvo = e.target.closest('button');
    if (!alvo) return;
    try {
      if (alvo.dataset.abaFolha) {
        abaFolha = alvo.dataset.abaFolha;
        document.querySelectorAll('[data-aba-folha]').forEach((b) => b.classList.toggle('ativa', b === alvo));
        $('#corpo-folha').className = 'carregando';
        $('#corpo-folha').textContent = 'Carregando…';
        carregar();
      }
      if (alvo.id === 'btn-gerar-folha') {
        const r = await api('/folha/gerar', { metodo: 'POST', corpo: { competencia: competenciaFolha } });
        toast(`${r.criadas} funcionário(s) na folha de ${mesBR(competenciaFolha)}.`);
        carregar();
      }
      if (alvo.dataset.editarFolha) editarLinha(folha.linhas.find((l) => l.id === Number(alvo.dataset.editarFolha)));
      if (alvo.id === 'btn-fechar-folha') {
        const pend = folha.linhas.filter((l) => l.pendencias && (l.pendencias.sem_km || l.pendencias.sem_faixa)).length;
        if (!confirm(`Fechar a folha de ${mesBR(competenciaFolha)}? Os valores ficam congelados.${pend ? `\n\nATENÇÃO: ${pend} motorista(s) com comissão incompleta (cargas sem km ou sem faixa).` : ''}`)) return;
        await api('/folha/fechar', { metodo: 'POST', corpo: { competencia: competenciaFolha } });
        toast('Folha fechada.');
        carregar();
      }
      if (alvo.id === 'btn-pagar-folha') pagar();
      if (alvo.id === 'btn-reabrir-folha') {
        if (!confirm('Reabrir a folha? A comissão e os adiantamentos voltam a acompanhar os lançamentos.')) return;
        await api('/folha/reabrir', { metodo: 'POST', corpo: { competencia: competenciaFolha } });
        toast('Folha reaberta.');
        carregar();
      }
      if (alvo.id === 'btn-desfazer-pagamento') {
        if (!confirm('Desfazer o pagamento? As despesas "Folha de pagamento" geradas por ele são apagadas e a folha volta a ficar fechada.')) return;
        await api('/folha/desfazer-pagamento', { metodo: 'POST', corpo: { competencia: competenciaFolha } });
        toast('Pagamento desfeito.');
        carregar();
      }
      if (alvo.id === 'btn-excel-folha') await baixarArquivo(`/folha/excel?competencia=${competenciaFolha}`, `folha-${competenciaFolha}.xlsx`);
      if (alvo.id === 'btn-novo-adto') novoAdiantamento();
      if (alvo.dataset.excluirAdto) {
        const a = adiantamentos.find((x) => x.id === Number(alvo.dataset.excluirAdto));
        if (!confirm(`Excluir o adiantamento de ${formatarMoeda(a.valor)} de ${a.nome}?${a.despesa_id ? ' A despesa lançada junto também sai.' : ''}`)) return;
        await api(`/folha/adiantamentos/${a.id}`, { metodo: 'DELETE' });
        toast('Adiantamento excluído.');
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };
  $('#comp-folha').addEventListener('change', carregar);
  carregar();
}
