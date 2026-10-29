// =====================================================================
// Xylo - ASSISTENTE VIRTUAL (painel de chat em todas as telas do sistema)
//
// Botão flutuante no canto -> abre o painel. As perguntas vão para
// POST /api/assistente/mensagem, que responde com a IA (Claude) ou, sem
// chave configurada, no modo básico. A conversa fica guardada só nesta aba
// do navegador (sessionStorage) e some ao sair do sistema.
//
// Depende do comum.js (esc, $, mesAtualISO, mensagemErro) e do api.js.
// =====================================================================
(() => {
  const CHAVE = `xylo_chat_${(Sessao.usuario() || {}).id || ''}`;
  const SUGESTOES = [
    'Conferir este mês',
    'Resumo do mês',
    'Quanto devo aos empreiteiros?',
    'Saldo das florestas',
    'O que falta receber e pagar?',
    'Comparar os últimos 6 meses',
  ];
  const ROTULO = { erro: 'Erro', atencao: 'Atenção', info: 'Lembrete' };

  let mensagens = [];
  let mesChat = mesAtualISO();
  let esperando = false;
  try {
    const salvo = JSON.parse(sessionStorage.getItem(CHAVE) || 'null');
    if (salvo) { mensagens = salvo.mensagens || []; mesChat = salvo.mes || mesChat; }
  } catch { /* sem sessionStorage: conversa só em memória */ }
  const guardar = () => {
    try { sessionStorage.setItem(CHAVE, JSON.stringify({ mensagens: mensagens.slice(-30), mes: mesChat })); } catch { /* ignora */ }
  };

  // ---- Estrutura -----------------------------------------------------
  document.body.insertAdjacentHTML('beforeend', `
    <button type="button" class="botao-assistente" id="abrir-assistente" aria-haspopup="dialog" aria-controls="painel-assistente">
      <span class="icone-ia" aria-hidden="true">✦</span> <span>Assistente</span>
    </button>
    <aside class="painel-assistente" id="painel-assistente" role="dialog" aria-label="Assistente Xylo" hidden>
      <header class="assistente-topo">
        <div>
          <strong>Assistente Xylo</strong>
          <span class="selo-modo" id="modo-assistente">…</span>
        </div>
        <label class="assistente-mes">Mês <input type="month" id="mes-assistente"></label>
        <button type="button" class="icone-botao" id="limpar-assistente" title="Começar nova conversa" aria-label="Começar nova conversa"><span aria-hidden="true">↺</span></button>
        <button type="button" class="icone-botao" id="fechar-assistente" title="Fechar" aria-label="Fechar"><span aria-hidden="true">×</span></button>
      </header>
      <div class="assistente-conversa" id="conversa-assistente" aria-live="polite"></div>
      <div class="assistente-sugestoes" id="sugestoes-assistente"></div>
      <form class="assistente-entrada" id="form-assistente">
        <textarea id="texto-assistente" rows="1" maxlength="2000" placeholder="Pergunte sobre os dados…" aria-label="Sua pergunta"></textarea>
        <button type="submit" class="btn btn-primario" id="enviar-assistente" aria-label="Enviar">Enviar</button>
      </form>
      <p class="assistente-rodape">O assistente só consulta os dados; para alterar, use as telas do menu.</p>
    </aside>`);

  const painel = $('#painel-assistente');
  const conversa = $('#conversa-assistente');
  const campo = $('#texto-assistente');
  $('#mes-assistente').value = mesChat;

  api('/assistente/status').then((s) => {
    const selo = $('#modo-assistente');
    selo.textContent = s.ia ? `IA ativa · ${s.provedor}${s.gratuito ? ' (grátis)' : ''}` : 'Modo básico';
    selo.title = s.ia
      ? `Respostas geradas por IA (${s.provedor}, modelo ${s.modelo}) a partir dos dados do sistema.${s.reserva ? ` Se ela não responder, usa ${s.reserva.provedor}.` : ''}`
      : 'Sem IA configurada: respostas por palavras-chave.';
    if (s.ia && s.reserva) selo.textContent += ` + reserva ${s.reserva.provedor}`;
    selo.classList.toggle('basico', !s.ia);
  }).catch(() => { $('#modo-assistente').textContent = ''; });

  // ---- Texto do assistente: escapa tudo e aceita só **negrito** e listas "- " ----
  function formatar(texto) {
    const blocos = esc(texto).split(/\n{2,}/);
    return blocos.map((bloco) => {
      const linhas = bloco.split('\n');
      const html = [];
      let lista = [];
      const fecharLista = () => { if (lista.length) { html.push(`<ul>${lista.map((l) => `<li>${l}</li>`).join('')}</ul>`); lista = []; } };
      linhas.forEach((l) => {
        const item = l.match(/^\s*[-•]\s+(.*)/);
        if (item) lista.push(item[1]);
        else { fecharLista(); if (l.trim()) html.push(`<p>${l}</p>`); }
      });
      fecharLista();
      return html.join('');
    }).join('').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  // Cartão da conferência: cada achado com seus itens e um atalho para a tela certa
  function cartaoConferencia(c) {
    if (!c || !c.achados) return '';
    const destino = (regra) => (['fretes_atrasados'].includes(regra) ? ['fretes', 'Abrir fretes']
      : ['despesas_atrasadas', 'empreiteiro_negativo'].includes(regra) ? ['despesas', 'Abrir despesas']
        : regra === 'sem_custo_floresta' ? ['precos', 'Abrir tabela de preços'] : ['viagens', 'Abrir viagens']);
    if (!c.achados.length) return `<div class="conferencia ok">✔ ${c.viagens_conferidas} viagens conferidas, nenhum problema.</div>`;
    return `<div class="conferencia">${c.achados.map((a) => {
      const [tela, texto] = destino(a.regra);
      return `<details class="achado ${a.gravidade}">
        <summary><span class="gravidade">${ROTULO[a.gravidade]}</span> ${esc(a.titulo)}</summary>
        <p>${esc(a.detalhe)}</p>
        <ul>${a.itens.map((i) => `<li>${esc(i)}</li>`).join('')}${a.quantidade > a.itens.length ? `<li>… e mais ${a.quantidade - a.itens.length}</li>` : ''}</ul>
        <a href="#${tela}" data-ir="${tela}" data-mes="${esc(c.mes)}">${texto} de ${esc(c.mes.split('-').reverse().join('/'))} →</a>
      </details>`;
    }).join('')}</div>`;
  }

  function desenhar() {
    if (!mensagens.length) {
      conversa.innerHTML = `
        <div class="msg assistente boas-vindas">
          <p><strong>Olá! Sou o assistente do Xylo.</strong></p>
          <p>Respondo com os dados da sua empresa e ajudo a <strong>conferir os lançamentos</strong> do mês:
          viagens sem ticket, preço diferente da tabela, peso estranho, carga lançada em dobro e mais.</p>
        </div>`;
    } else {
      conversa.innerHTML = mensagens.map((m) => `
        <div class="msg ${m.papel}">
          ${m.aviso ? `<p class="msg-aviso">${esc(m.aviso)}${m.modo === 'basico' && PERFIL.admin ? ' <button type="button" class="link-botao pequeno" data-diagnostico>Testar a IA</button>' : ''}</p>` : ''}
          ${m.papel === 'usuario' ? `<p>${esc(m.texto)}</p>` : formatar(m.texto)}
          ${m.conferencia ? cartaoConferencia(m.conferencia) : ''}
        </div>`).join('');
    }
    if (esperando) conversa.insertAdjacentHTML('beforeend', '<div class="msg assistente digitando" aria-label="Consultando os dados"><span></span><span></span><span></span> Consultando os dados…</div>');
    $('#sugestoes-assistente').innerHTML = mensagens.length > 2 ? '' : SUGESTOES.map((s) => `<button type="button" data-sugestao="${esc(s)}">${esc(s)}</button>`).join('');
    conversa.scrollTop = conversa.scrollHeight;
  }

  async function perguntar(texto) {
    texto = texto.trim();
    if (!texto || esperando) return;
    mensagens.push({ papel: 'usuario', texto });
    esperando = true;
    $('#enviar-assistente').disabled = true;
    desenhar();
    try {
      const r = await api('/assistente/mensagem', {
        metodo: 'POST',
        corpo: { mes: mesChat, mensagens: mensagens.filter((m) => !m.diagnostico).map((m) => ({ papel: m.papel, texto: m.texto })) },
      });
      mensagens.push({ papel: 'assistente', texto: r.texto, conferencia: r.conferencia || null, aviso: r.aviso || null, modo: r.modo });
    } catch (erro) {
      mensagens.push({ papel: 'assistente', texto: `Não consegui responder: ${mensagemErro(erro)}`, erro: true });
    } finally {
      esperando = false;
      $('#enviar-assistente').disabled = false;
      guardar();
      desenhar();
      campo.focus();
    }
  }

  // ---- Abrir / fechar ------------------------------------------------
  const abrir = () => {
    painel.hidden = false;
    document.body.classList.add('com-assistente');
    $('#abrir-assistente').setAttribute('aria-expanded', 'true');
    desenhar();
    campo.focus();
  };
  const fechar = () => {
    painel.hidden = true;
    document.body.classList.remove('com-assistente');
    $('#abrir-assistente').setAttribute('aria-expanded', 'false');
    $('#abrir-assistente').focus();
  };
  $('#abrir-assistente').addEventListener('click', () => (painel.hidden ? abrir() : fechar()));
  $('#fechar-assistente').addEventListener('click', fechar);
  painel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').hidden) fechar(); });
  $('#limpar-assistente').addEventListener('click', () => { mensagens = []; guardar(); desenhar(); campo.focus(); });
  $('#mes-assistente').addEventListener('change', (e) => { mesChat = e.target.value || mesAtualISO(); guardar(); });

  $('#form-assistente').addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = campo.value;
    campo.value = '';
    campo.style.height = '';
    perguntar(texto);
  });
  // Enter envia; Shift+Enter quebra a linha. O campo cresce até 5 linhas.
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#form-assistente').requestSubmit(); }
  });
  campo.addEventListener('input', () => { campo.style.height = ''; campo.style.height = `${Math.min(campo.scrollHeight, 120)}px`; });

  // "Testar a IA" (admin): pergunta mínima a cada provedor e mostra o motivo exato
  async function diagnosticar() {
    if (esperando) return;
    esperando = true;
    desenhar();
    try {
      const r = await api('/assistente/diagnostico');
      const linhas = !r.ia ? ['Nenhuma IA configurada no .env do servidor (ASSISTENTE_PROVEDOR e ASSISTENTE_CHAVE).']
        : r.resultados.map((x) => (x.ok
          ? `- **${x.provedor}** (${x.papel}): funcionando, modelo ${x.modelo} (${(x.ms / 1000).toFixed(1).replace('.', ',')} s)`
          : `- **${x.provedor}** (${x.papel}): ${x.motivo}.\n  Resposta do provedor: ${x.detalhe}`));
      mensagens.push({ papel: 'assistente', texto: `**Teste da IA**\n\n${linhas.join('\n')}`, diagnostico: true });
    } catch (erro) {
      mensagens.push({ papel: 'assistente', texto: `Não consegui testar: ${mensagemErro(erro)}`, erro: true });
    } finally {
      esperando = false;
      guardar();
      desenhar();
    }
  }

  painel.addEventListener('click', (e) => {
    if (e.target.closest('[data-diagnostico]')) { diagnosticar(); return; }
    const sugestao = e.target.closest('[data-sugestao]');
    if (sugestao) perguntar(sugestao.dataset.sugestao);
    const ir = e.target.closest('[data-ir]');
    if (ir) {
      // abre a tela já no mês conferido
      const mes = ir.dataset.mes || mesChat;
      if (ir.dataset.ir === 'viagens' && typeof mesViagens !== 'undefined') mesViagens = mes;
      if (ir.dataset.ir === 'fretes' && typeof mesFretes !== 'undefined') mesFretes = mes;
      if (ir.dataset.ir === 'despesas' && typeof mesDespesas !== 'undefined') mesDespesas = mes;
      if (window.innerWidth < 900) fechar();
    }
  });

  // Ao sair do sistema a conversa é apagada
  const sair = $('#btn-sair');
  if (sair) sair.addEventListener('click', () => { try { sessionStorage.removeItem(CHAVE); } catch { /* ignora */ } });
})();
