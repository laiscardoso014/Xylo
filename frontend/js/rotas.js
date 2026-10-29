// =====================================================================
// Xylo - ROTAS E DISTÂNCIAS (main.html#rotas) - Administrador e Financeiro
//
// A comissão dos motoristas depende do km de cada carga:
//   viagem: floresta -> cliente      frete: cliente -> destino
// Informe o km uma vez por rota; todas as cargas daquela rota usam esse km
// (uma carga diferente pode ter o km corrigido na folha, no detalhe da comissão).
// "Faltam km": rotas que já aparecem nas cargas e ainda não têm distância.
//
// Depende do comum.js, do api.js e de main.js (conteudo, PERFIL, cliqueDaTela).
// =====================================================================

async function telaRotas() {
  conteudo.innerHTML = `<div id="tela-rotas">
    <div class="barra-ferramentas">
      <input type="search" class="busca" id="busca-rota" placeholder="Floresta, cliente ou destino…">
      <span class="espaco"></span>
      <button type="button" class="btn btn-primario" id="btn-nova-rota"><i class="fas fa-plus"></i> Nova rota</button>
    </div>
    <div id="rotas-pendentes"></div>
    <section class="card sem-padding bloco-rotas"><h3>Viagens <span class="sub">floresta → cliente</span></h3><div id="rotas-viagem" class="carregando">Carregando…</div></section>
    <section class="card sem-padding bloco-rotas"><h3>Fretes <span class="sub">cliente → destino</span></h3><div id="rotas-frete"></div></section></div>`;

  let dados = { rotas: [], pendentes: [] };
  let opcoes = { clientes: [], florestas: [] };
  const kmTexto = (v) => (v === null || v === undefined ? '' : String(Number(v)).replace('.', ','));
  const nomeRota = (r) => (r.tipo === 'viagem' ? `${r.floresta} → ${r.cliente}` : `${r.cliente} → ${r.destino || '(sem destino)'}`);

  async function carregar() {
    try {
      const [r, op] = await Promise.all([api('/rotas'), api('/viagens/opcoes')]);
      if (!$('#rotas-viagem')) return;
      dados = r;
      opcoes = op;
      desenhar();
    } catch (erro) {
      $('#rotas-viagem').className = 'aviso-erro';
      $('#rotas-viagem').textContent = mensagemErro(erro);
    }
  }

  function desenhar() {
    const termo = $('#busca-rota').value.trim().toLowerCase();
    const filtra = (r) => !termo || nomeRota(r).toLowerCase().includes(termo);
    const pend = dados.pendentes.filter(filtra);
    $('#rotas-pendentes').innerHTML = pend.length ? `
      <section class="card bloco-pendentes">
        <h3><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Faltam km (${pend.length})</h3>
        <p class="sub">Rotas que já aparecem nas cargas. Sem o km, a carga não entra na comissão do motorista.</p>
        <div class="lista-pendentes">${pend.map((p, i) => `
          <form class="pendente" data-pendente="${i}" novalidate>
            <div><strong>${esc(nomeRota(p))}</strong>
              <span class="sub">${p.tipo === 'viagem' ? 'viagem' : 'frete'} · ${p.cargas} carga${p.cargas === 1 ? '' : 's'}${p.com_motorista ? ` · ${p.com_motorista} com motorista` : ''} · última ${formatarDataISO(p.ultima)}</span></div>
            <label class="km-campo"><input name="km" inputmode="decimal" placeholder="km" aria-label="Distância em km de ${esc(nomeRota(p))}"> km</label>
            <button type="submit" class="btn btn-secundario pequeno">Salvar</button>
          </form>`).join('')}</div>
      </section>` : '';

    for (const tipo of ['viagem', 'frete']) {
      const lista = dados.rotas.filter((r) => r.tipo === tipo && filtra(r));
      const box = $(`#rotas-${tipo}`);
      if (!lista.length) { box.className = 'vazio'; box.textContent = 'Nenhuma rota cadastrada.'; continue; }
      box.className = 'tabela-wrap';
      box.innerHTML = `<table class="tabela"><thead><tr><th>Rota</th><th class="num">Km</th><th class="num">Cargas</th><th>Observação</th><th></th></tr></thead>
        <tbody>${lista.map((r) => `
          <tr>
            <td><strong>${esc(nomeRota(r))}</strong></td>
            <td class="num"><input class="km-inline" data-rota-km="${r.id}" inputmode="decimal" value="${esc(kmTexto(r.km))}" aria-label="Km de ${esc(nomeRota(r))}"></td>
            <td class="num">${r.cargas}</td>
            <td class="sub">${esc(r.observacao) || ''}</td>
            <td class="acoes"><button type="button" class="icone-botao perigo" data-excluir-rota="${r.id}" title="Excluir rota"><i class="fas fa-trash-can"></i></button></td>
          </tr>`).join('')}</tbody></table>`;
    }
  }

  async function salvarPendente(form) {
    const p = dados.pendentes.filter((x) => { const t = $('#busca-rota').value.trim().toLowerCase(); return !t || nomeRota(x).toLowerCase().includes(t); })[Number(form.dataset.pendente)];
    const km = form.elements.km.value.trim();
    if (!km) { form.elements.km.focus(); return; }
    try {
      await api('/rotas', { metodo: 'POST', corpo: { tipo: p.tipo, floresta_id: p.floresta_id, cliente_id: p.cliente_id, destino: p.destino, km } });
      toast(`Rota ${nomeRota(p)}: ${km} km.`);
      await carregar();
      const proximo = $('#rotas-pendentes input[name=km]');
      if (proximo) proximo.focus(); // segue para a próxima
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  }

  function novaRota() {
    abrirModal('Nova rota', `
      <form novalidate>
        <div class="grade-campos">
          <div class="campo larga"><label>Tipo</label>
            <select name="tipo"><option value="viagem">Viagem (floresta → cliente)</option><option value="frete">Frete (cliente → destino)</option></select></div>
          <div class="campo" data-so="viagem"><label>Floresta *</label><select name="floresta_id"><option value="">Selecione…</option>
            ${opcoes.florestas.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Cliente *</label><select name="cliente_id" required><option value="">Selecione…</option>
            ${opcoes.clientes.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
          <div class="campo" data-so="frete" hidden><label>Destino</label><input name="destino" maxlength="100" placeholder="Ex.: Balneário"></div>
          <div class="campo"><label>Distância (km) *</label><input name="km" required inputmode="decimal" placeholder="Ex.: 85"></div>
          <div class="campo larga"><label>Observação</label><input name="observacao" maxlength="200" placeholder="Ex.: estrada de chão a partir do trevo"></div>
        </div>
        ${RODAPE_FORMULARIO}
      </form>`);
    const form = $('#modal-corpo form');
    form.elements.tipo.addEventListener('change', () => {
      form.querySelectorAll('[data-so]').forEach((el) => { el.hidden = el.dataset.so !== form.elements.tipo.value; });
    });
    ligarFormulario(async (d) => {
      await api('/rotas', { metodo: 'POST', corpo: { ...d, floresta_id: d.tipo === 'viagem' ? d.floresta_id : null } });
      toast('Rota cadastrada.');
      carregar();
    });
  }

  // (eventos presos ao #tela-rotas, que é recriado a cada visita: não acumulam)
  const tela = $('#tela-rotas');
  tela.addEventListener('submit', (e) => {
    const form = e.target.closest('form.pendente');
    if (!form) return;
    e.preventDefault();
    salvarPendente(form);
  });
  tela.addEventListener('change', async (e) => {
    const campo = e.target.closest('[data-rota-km]');
    if (!campo) return;
    try {
      await api(`/rotas/${campo.dataset.rotaKm}`, { metodo: 'PUT', corpo: { km: campo.value, observacao: dados.rotas.find((r) => r.id === Number(campo.dataset.rotaKm)).observacao } });
      campo.classList.add('salvo');
      setTimeout(() => campo.classList.remove('salvo'), 1200);
      toast('Distância atualizada: as folhas abertas recalculam a comissão.');
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
      carregar();
    }
  });
  cliqueDaTela = async (e) => {
    const alvo = e.target.closest('button');
    if (!alvo) return;
    try {
      if (alvo.id === 'btn-nova-rota') novaRota();
      if (alvo.dataset.excluirRota) {
        const r = dados.rotas.find((x) => x.id === Number(alvo.dataset.excluirRota));
        if (!confirm(`Excluir a rota ${nomeRota(r)}? As cargas dela ficam sem km (fora da comissão) até cadastrar de novo.`)) return;
        await api(`/rotas/${r.id}`, { metodo: 'DELETE' });
        toast('Rota excluída.');
        carregar();
      }
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
    }
  };
  $('#busca-rota').addEventListener('input', desenhar);
  carregar();
}
