// =====================================================================
// Xylo (CTech) - Painel: COBRANÇA da mensalidade (dev.html#cobranca)
//   - Dados para receber (chave PIX, nome, cidade...) e geração automática
//   - Gerar as faturas do mês (uma por empresa com mensalidade)
//   - Dar baixa, desfazer, cancelar, reenviar e-mail, abrir/imprimir
//   - Mensalidade de cada empresa (botão na tela Empresas)
// Usa o dev.js (api, conteudo, cliqueDaTela, atualizarBadge) e o comum.js.
// =====================================================================

let mesCobranca = mesAtualISO();
let filtroCobranca = '';
const SELO_COB = { Aberta: 'selo-aberta', Vencida: 'selo-vencida', Paga: 'selo-ativo', Cancelada: 'selo-inativo' };
const MESES_COB = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMesCob = (aaaamm) => { const [a, m] = aaaamm.split('-'); return `${MESES_COB[Number(m) - 1]}/${a}`; };
const valorBR = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));

// ---------------------------------------------------------------------
// Mensalidade de uma empresa (aberto pela tela Empresas)
// ---------------------------------------------------------------------
function editarPlano(e, depois) {
  abrirModal(`Mensalidade · ${e.nome}`, `
    <form novalidate>
      <div class="grade-campos">
        <div class="campo"><label for="pl-valor">Valor mensal (R$)</label>
          <input id="pl-valor" name="mensalidade" inputmode="decimal" placeholder="Ex.: 149,90" value="${esc(valorBR(e.mensalidade))}">
          <small>Vazio = empresa não é cobrada (teste, parceira...).</small></div>
        <div class="campo"><label for="pl-dia">Vence todo dia</label>
          <select id="pl-dia" name="dia_vencimento">${Array.from({ length: 28 }, (_, i) => i + 1)
            .map((d) => `<option ${d === (e.dia_vencimento || 10) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="campo"><label for="pl-desde">Cobrar a partir de</label>
          <input id="pl-desde" name="cobrar_desde" type="month" value="${esc(e.cobrar_desde || '')}">
          <small>Ex.: mês seguinte ao período grátis. Vazio = já cobra.</small></div>
      </div>
      <div class="form-erro" hidden></div>
      <div class="modal-rodape">
        <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar</button>
      </div>
    </form>`);
  ligarFormulario(async (d) => {
    const valor = d.mensalidade.trim() ? lerNumero(d.mensalidade) : null;
    if (Number.isNaN(valor) || (valor !== null && valor < 0)) throw new Error('Valor mensal inválido. Use, por exemplo, 149,90.');
    await api(`/cobranca/empresas/${e.id}`, { metodo: 'PUT', corpo: { mensalidade: valor, dia_vencimento: Number(d.dia_vencimento), cobrar_desde: d.cobrar_desde || null } });
    toast(valor ? `Mensalidade de ${e.nome}: ${formatarMoeda(valor)}, vence dia ${d.dia_vencimento}.` : `${e.nome} não será cobrada.`);
    if (depois) depois();
  });
}

// ---------------------------------------------------------------------
// Dados de quem recebe
// ---------------------------------------------------------------------
async function editarConfigCobranca(depois) {
  let c;
  try {
    c = await api('/cobranca/config');
  } catch (erro) {
    toast(erro.message, 'erro');
    return;
  }
  abrirModal('Dados para receber', `
    <form novalidate>
      <p class="nota-tela"><i class="fas fa-circle-info"></i><span>O QR Code das faturas leva o dinheiro direto para esta chave PIX.
        Faturas já emitidas não mudam: corrija aqui e gere de novo as que ainda não foram pagas (cancele a antiga).</span></p>
      <div class="grade-campos">
        <div class="campo larga"><label for="cf-chave">Chave PIX *</label>
          <input id="cf-chave" name="chave_pix" required maxlength="80" value="${esc(c.chave_pix || '')}" placeholder="CPF, CNPJ, e-mail, +55 49 99999-9999 ou chave aleatória" spellcheck="false">
          <small>${c.tipo_chave ? `Tipo: ${esc(c.tipo_chave)}. ` : ''}Telefone: escreva com +55 ou com DDD entre parênteses.</small></div>
        <div class="campo"><label for="cf-nome">Nome de quem recebe *</label>
          <input id="cf-nome" name="recebedor_nome" required maxlength="100" value="${esc(c.recebedor_nome || '')}">
          <small>O mesmo do titular da chave (o app do banco mostra as 25 primeiras letras).</small></div>
        <div class="campo"><label for="cf-doc">CPF/CNPJ de quem recebe</label>
          <input id="cf-doc" name="recebedor_doc" value="${esc(c.recebedor_doc || '')}"></div>
        <div class="campo"><label for="cf-cidade">Cidade *</label><input id="cf-cidade" name="cidade" required maxlength="60" value="${esc(c.cidade || '')}"></div>
        <div class="campo"><label for="cf-email">E-mail para dúvidas</label><input id="cf-email" name="email_contato" type="email" maxlength="150" value="${esc(c.email_contato || '')}"></div>
        <div class="campo"><label for="cf-whats">WhatsApp</label><input id="cf-whats" name="whatsapp" type="tel" value="${esc(c.whatsapp || '')}"></div>
        <div class="campo larga"><label for="cf-instr">Recado na fatura</label>
          <input id="cf-instr" name="instrucoes" maxlength="300" value="${esc(c.instrucoes || '')}" placeholder="Ex.: Depois de pagar, clique em &quot;Já paguei&quot; no Xylo."></div>
        <div class="campo larga">
          <label class="opcao"><input type="checkbox" name="gerar_automatico" ${c.gerar_automatico ? 'checked' : ''}> Gerar as faturas do mês automaticamente</label>
          <small>O servidor gera sozinho, a partir do dia escolhido, as faturas que ainda não existem e manda o e-mail para os administradores.</small>
        </div>
        <div class="campo"><label for="cf-dia">A partir do dia</label>
          <select id="cf-dia" name="dia_geracao">${Array.from({ length: 28 }, (_, i) => i + 1)
            .map((d) => `<option ${d === (c.dia_geracao || 1) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      </div>
      <div class="form-erro" hidden></div>
      <div class="modal-rodape">
        <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Salvar</button>
      </div>
    </form>`);
  $('#modal').classList.add('modal-medio');
  mascaraDocumento($('#cf-doc'));
  mascaraTelefone($('#cf-whats'));
  ligarFormulario(async (d) => {
    await api('/cobranca/config', {
      metodo: 'PUT',
      corpo: { ...d, gerar_automatico: d.gerar_automatico === 'on', dia_geracao: Number(d.dia_geracao) },
    });
    toast('Dados para receber salvos.');
    if (depois) depois();
  });
}

// ---------------------------------------------------------------------
// Tela Cobrança
// ---------------------------------------------------------------------
async function telaCobranca() {
  conteudo.innerHTML = `
    <div class="barra-ferramentas">
      <label class="filtro-campo">Mês <input type="month" id="mes-cobranca" value="${mesCobranca}"></label>
      <label class="filtro-campo">Situação
        <select id="filtro-cobranca">
          <option value="">Todas</option><option>Aberta</option><option>Vencida</option><option>Paga</option><option>Cancelada</option>
          <option value="informado">Pagamento informado</option>
        </select></label>
      <span class="espaco"></span>
      <button type="button" class="btn btn-secundario" id="btn-config-cobranca"><i class="fas fa-gear"></i> Dados para receber</button>
      <button type="button" class="btn btn-secundario" id="btn-avulsa"><i class="fas fa-plus"></i> Fatura avulsa</button>
      <button type="button" class="btn btn-primario" id="btn-gerar"><i class="fas fa-file-invoice-dollar"></i> Gerar faturas do mês</button>
    </div>
    <div id="aviso-config"></div>
    <div class="cartoes cartoes-mini" id="totais-cobranca"></div>
    <div id="faltam-gerar"></div>
    <div class="card sem-padding"><div id="lista-cobranca" class="carregando">Carregando…</div></div>`;
  $('#filtro-cobranca').value = filtroCobranca;

  let dados = { faturas: [], faltam: [] };
  let empresas = [];

  async function carregar() {
    mesCobranca = $('#mes-cobranca').value || mesAtualISO();
    $('#btn-gerar').innerHTML = `<i class="fas fa-file-invoice-dollar"></i> Gerar faturas de ${esc(nomeMesCob(mesCobranca))}`;
    try {
      const [r, cfg] = await Promise.all([api(`/cobranca/faturas?mes=${mesCobranca}`), api('/cobranca/config')]);
      if (!$('#lista-cobranca')) return;
      dados = r;
      $('#aviso-config').innerHTML = cfg.falta.length ? `
        <div class="aviso-fatura vencida"><i class="fas fa-triangle-exclamation"></i>
          <span>Para emitir faturas, preencha os dados para receber: ${esc(cfg.falta.join(', '))}.</span>
          <button type="button" class="btn btn-primario pequeno" data-config>Preencher agora</button></div>` : '';
      const t = r.totais;
      const cartao = (icone, valor, texto, classe = '') => `<div class="card cartao ${classe}"><div class="cartao-icone"><i class="fas ${icone}"></i></div><div><strong>${valor}</strong><span>${texto}</span></div></div>`;
      $('#totais-cobranca').innerHTML = [
        cartao('fa-file-invoice', esc(formatarMoeda(t.emitido)), `emitido em ${esc(nomeMesCob(mesCobranca))}`),
        cartao('fa-sack-dollar', esc(formatarMoeda(t.recebido)), `recebido (${t.qtd.pagas} paga(s))`),
        cartao('fa-hourglass-half', esc(formatarMoeda(t.aberto)), `em aberto (${t.qtd.abertas})`),
        cartao('fa-triangle-exclamation', esc(formatarMoeda(t.vencido)), `vencido (${t.qtd.vencidas})${r.vencidas_geral.qtd > t.qtd.vencidas ? ` · ${r.vencidas_geral.qtd} em todos os meses` : ''}`, t.qtd.vencidas ? 'cartao-alerta' : ''),
      ].join('');
      $('#faltam-gerar').innerHTML = r.faltam.length ? `
        <p class="nota-tela"><i class="fas fa-circle-info"></i><span>Ainda sem fatura em ${esc(nomeMesCob(mesCobranca))}:
          <strong>${r.faltam.map((e) => `${esc(e.nome)} (${esc(formatarMoeda(e.mensalidade))})`).join(', ')}</strong>.
          Use "Gerar faturas" (quem já tem não é cobrado de novo).</span></p>` : '';
      desenhar();
    } catch (erro) {
      if (!$('#lista-cobranca')) return;
      $('#lista-cobranca').className = 'aviso-erro';
      $('#lista-cobranca').textContent = mensagemErro(erro);
    }
  }

  function desenhar() {
    filtroCobranca = $('#filtro-cobranca').value;
    const lista = dados.faturas.filter((f) => !filtroCobranca
      || (filtroCobranca === 'informado' ? f.status === 'Aberta' && f.informado_em : f.situacao === filtroCobranca));
    const box = $('#lista-cobranca');
    if (!lista.length) {
      box.className = 'vazio';
      box.textContent = dados.faturas.length ? 'Nenhuma fatura nesta situação.' : `Nenhuma fatura emitida em ${nomeMesCob(mesCobranca)}.`;
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela tabela-faturas">
        <thead><tr><th>Empresa</th><th>Fatura</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${lista.map((f) => `
            <tr class="${f.situacao === 'Vencida' ? 'linha-vencida' : ''} ${f.situacao === 'Cancelada' ? 'inativo' : ''}">
              <td><strong>${esc(f.empresa)}</strong><div class="sub">${esc(formatarCnpj(f.cnpj))}</div></td>
              <td>${esc(f.numero)}<div class="sub">${f.gerada_por === 'automatico' ? 'automática · ' : ''}${f.email_enviado_em ? 'e-mail enviado' : 'sem e-mail'}</div></td>
              <td>${esc(formatarDataISO(f.vencimento))}${f.situacao === 'Vencida' ? `<div class="sub">${f.dias_atraso} dia(s) de atraso</div>` : ''}</td>
              <td class="num"><strong>${esc(formatarMoeda(f.valor))}</strong>${f.valor_pago && f.valor_pago !== f.valor ? `<div class="sub">pago ${esc(formatarMoeda(f.valor_pago))}</div>` : ''}</td>
              <td><span class="selo ${SELO_COB[f.situacao] || ''}">${esc(f.situacao)}</span>
                ${f.status === 'Aberta' && f.informado_em ? `<div><span class="selo selo-pendente" title="Avisou em ${esc(formatarDataHora(f.informado_em))}"><i class="fas fa-bell"></i> Pagamento informado</span></div>` : ''}
                ${f.situacao === 'Paga' ? `<div class="sub">em ${esc(formatarDataISO(f.pago_em))}${f.obs_pagamento ? ` · ${esc(f.obs_pagamento)}` : ''}</div>` : ''}
                ${f.situacao === 'Cancelada' ? `<div class="sub">${esc(f.cancelada_motivo || '')}</div>` : ''}</td>
              <td class="acoes">
                ${f.status === 'Aberta' ? `<button type="button" class="btn btn-primario pequeno" data-baixa="${f.id}"><i class="fas fa-check"></i> Dar baixa</button>` : ''}
                <a class="icone-botao" href="fatura.html?id=${f.id}&painel=1" target="_blank" rel="noopener" title="Abrir a fatura" aria-label="Abrir a fatura ${esc(f.numero)}"><i class="fas fa-file-invoice"></i></a>
                ${f.status === 'Aberta' ? `<button type="button" class="icone-botao" data-email="${f.id}" title="Mandar o e-mail da fatura de novo" aria-label="Reenviar e-mail da fatura ${esc(f.numero)}"><i class="fas fa-envelope"></i></button>
                  <button type="button" class="icone-botao perigo" data-cancelar-fatura="${f.id}" title="Cancelar a fatura" aria-label="Cancelar a fatura ${esc(f.numero)}"><i class="fas fa-ban"></i></button>` : ''}
                ${f.status === 'Paga' ? `<button type="button" class="icone-botao" data-desfazer="${f.id}" title="Desfazer a baixa" aria-label="Desfazer a baixa da fatura ${esc(f.numero)}"><i class="fas fa-rotate-left"></i></button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function gerar(corpo, botao) {
    if (botao) botao.disabled = true;
    try {
      const r = await api('/cobranca/gerar', { metodo: 'POST', corpo });
      const partes = [];
      partes.push(r.criadas.length ? `${r.criadas.length} fatura(s) gerada(s)` : 'Nenhuma fatura nova');
      if (r.ja_tinham) partes.push(`${r.ja_tinham} empresa(s) já tinham`);
      if (r.sem_mensalidade.length) partes.push(`sem valor: ${r.sem_mensalidade.join(', ')}`);
      if (r.emails.modo_teste && r.criadas.length) partes.push('e-mail em modo teste (não enviado)');
      else if (r.emails.enviados) partes.push(`${r.emails.enviados} e-mail(s) enviado(s)`);
      toast(`${partes.join(' · ')}.`, r.emails.falhas.length ? 'erro' : 'ok');
      if (r.emails.falhas.length) setTimeout(() => toast(`E-mail não enviado: ${r.emails.falhas.join('; ')}`, 'erro'), 3500);
      await carregar();
      atualizarBadge();
      return true;
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
      return false;
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  async function avulsa() {
    if (!empresas.length) empresas = await api('/empresas');
    const ativas = empresas.filter((e) => e.ativo);
    abrirModal('Fatura avulsa', `
      <form novalidate>
        <p>Para cobrar uma empresa fora da geração do mês, com outro valor (desconto, implantação...). Uma fatura por empresa por mês.</p>
        <div class="grade-campos">
          <div class="campo larga"><label for="av-emp">Empresa *</label>
            <select id="av-emp" name="empresa_id" required><option value="">Escolha…</option>
              ${ativas.map((e) => `<option value="${e.id}" data-valor="${e.mensalidade || ''}">${esc(e.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label for="av-mes">Mês *</label><input id="av-mes" name="mes" type="month" required value="${mesCobranca}"></div>
          <div class="campo"><label for="av-valor">Valor (R$) *</label><input id="av-valor" name="valor" inputmode="decimal" required></div>
          <div class="campo larga"><label for="av-desc">Descrição</label><input id="av-desc" name="descricao" maxlength="150" placeholder="Mensalidade do Xylo - mês/ano"></div>
        </div>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Gerar e enviar</button>
        </div>
      </form>`);
    $('#av-emp').addEventListener('change', (e) => {
      const v = e.target.selectedOptions[0].dataset.valor;
      if (v && !$('#av-valor').value) $('#av-valor').value = valorBR(v);
    });
    ligarFormulario(async (d) => {
      if (!d.empresa_id) throw new Error('Escolha a empresa.');
      const valor = lerNumero(d.valor);
      if (!(valor > 0)) throw new Error('Informe o valor (ex.: 149,90).');
      const r = await api('/cobranca/gerar', { metodo: 'POST', corpo: { mes: d.mes, empresa_id: Number(d.empresa_id), valor, descricao: d.descricao || null } });
      if (!r.criadas.length) throw new Error('Esta empresa já tem fatura neste mês (cancele a atual para emitir outra).');
      toast(`Fatura ${r.criadas[0].numero} gerada${r.emails.enviados ? ' e enviada por e-mail' : ''}.`);
      mesCobranca = d.mes;
      $('#mes-cobranca').value = d.mes;
      carregar();
      atualizarBadge();
    });
  }

  function darBaixa(f) {
    abrirModal(`Dar baixa · ${f.empresa}`, `
      <form novalidate>
        <p>Fatura <strong>${esc(f.numero)}</strong> · ${esc(nomeMesCob(f.competencia))} · ${esc(formatarMoeda(f.valor))}
          ${f.informado_em ? `<br><span class="selo selo-pendente"><i class="fas fa-bell"></i> A empresa avisou o pagamento em ${esc(formatarDataHora(f.informado_em))}</span>` : ''}</p>
        <p class="sub">Confira no extrato do banco o PIX com o identificador <strong>XYLO${esc(f.numero)}</strong>.</p>
        <div class="grade-campos">
          <div class="campo"><label for="bx-data">Recebido em *</label><input id="bx-data" name="pago_em" type="date" required max="${hojeISO()}" value="${hojeISO()}"></div>
          <div class="campo"><label for="bx-valor">Valor recebido (R$) *</label><input id="bx-valor" name="valor_pago" inputmode="decimal" required value="${esc(valorBR(f.valor))}"></div>
          <div class="campo larga"><label for="bx-obs">Observação</label><input id="bx-obs" name="obs" maxlength="200" placeholder="Ex.: PIX Sicredi"></div>
        </div>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primario"><i class="fas fa-check"></i> Confirmar recebimento</button>
        </div>
      </form>`);
    ligarFormulario(async (d) => {
      const valor = lerNumero(d.valor_pago);
      if (!(valor > 0)) throw new Error('Informe o valor recebido.');
      await api(`/cobranca/faturas/${f.id}/pagar`, { metodo: 'POST', corpo: { pago_em: d.pago_em, valor_pago: valor, obs: d.obs || null } });
      toast(`Fatura ${f.numero} marcada como paga.`);
      carregar();
      atualizarBadge();
    });
  }

  function cancelar(f) {
    abrirModal(`Cancelar fatura ${f.numero}`, `
      <form novalidate>
        <p>${esc(f.empresa)} · ${esc(nomeMesCob(f.competencia))} · ${esc(formatarMoeda(f.valor))}.
          A empresa deixa de ver esta fatura e você pode gerar outra para o mesmo mês.</p>
        <div class="campo"><label for="cn-motivo">Motivo *</label><input id="cn-motivo" name="motivo" required maxlength="200" placeholder="Ex.: valor errado, cortesia"></div>
        <div class="form-erro" hidden></div>
        <div class="modal-rodape">
          <button type="button" class="btn btn-secundario" data-cancelar>Voltar</button>
          <button type="submit" class="btn btn-perigo"><i class="fas fa-ban"></i> Cancelar fatura</button>
        </div>
      </form>`);
    ligarFormulario(async (d) => {
      if (!d.motivo.trim()) throw new Error('Informe o motivo.');
      await api(`/cobranca/faturas/${f.id}/cancelar`, { metodo: 'POST', corpo: { motivo: d.motivo } });
      toast('Fatura cancelada.');
      carregar();
      atualizarBadge();
    });
  }

  cliqueDaTela = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const fatura = (id) => dados.faturas.find((f) => f.id === Number(id));
    if (b.id === 'btn-config-cobranca' || b.dataset.config !== undefined) editarConfigCobranca(carregar);
    if (b.id === 'btn-avulsa') avulsa().catch((e) => toast(mensagemErro(e), 'erro'));
    if (b.id === 'btn-gerar') {
      const n = dados.faltam.length;
      if (!n) { toast(`Todas as empresas cobradas já têm fatura em ${nomeMesCob(mesCobranca)}.`); return; }
      if (!confirm(`Gerar ${n} fatura(s) de ${nomeMesCob(mesCobranca)} e mandar por e-mail aos administradores?`)) return;
      gerar({ mes: mesCobranca }, b);
    }
    if (b.dataset.baixa) darBaixa(fatura(b.dataset.baixa));
    if (b.dataset.cancelarFatura) cancelar(fatura(b.dataset.cancelarFatura));
    if (b.dataset.desfazer) {
      const f = fatura(b.dataset.desfazer);
      if (!confirm(`Desfazer a baixa da fatura ${f.numero}? Ela volta a ficar em aberto.`)) return;
      try {
        await api(`/cobranca/faturas/${f.id}/desfazer-pagamento`, { metodo: 'POST' });
        toast('Baixa desfeita.');
        carregar();
        atualizarBadge();
      } catch (erro) { toast(mensagemErro(erro), 'erro'); }
    }
    if (b.dataset.email) {
      b.disabled = true;
      try {
        const r = await api(`/cobranca/faturas/${b.dataset.email}/email`, { metodo: 'POST' });
        if (r.modo_teste) toast('Modo teste: o servidor não tem e-mail configurado (a mensagem saiu no console).');
        else if (r.erro) toast(`E-mail não enviado: ${r.erro}`, 'erro');
        else toast(`E-mail enviado para ${r.enviados.join(', ')}.`);
        carregar();
      } catch (erro) { toast(mensagemErro(erro), 'erro'); } finally { b.disabled = false; }
    }
  };

  $('#mes-cobranca').addEventListener('change', carregar);
  $('#filtro-cobranca').addEventListener('change', desenhar);
  carregar();
}
