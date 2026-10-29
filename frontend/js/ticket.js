// =====================================================================
// Xylo - LER TICKET DE PESAGEM (usado em Viagens e Fretes)
//
// abrirLeituraTicket({ para, aoLer })
//   Janela para tirar/escolher a foto (ou colar o texto) do ticket. O
//   servidor lê só o que interessa e devolve os campos já ligados aos
//   cadastros; aoLer(resultado, urlDaFoto) abre o formulário preenchido.
//   para: 'viagens' | 'fretes'
// painelLeitura(leitura)  painel "Lido do ticket" no topo do formulário
// marcarLidos(form, leitura, focar) destaca os campos: verde = do ticket,
//   roxo = sugerido (última viagem da placa / último frete do cliente)
//
// Depende do comum.js e do api.js.
// =====================================================================

let statusTicket = null; // { foto: true|false } - a leitura por foto depende da IA no servidor

// Reduz a foto do celular (3-5 MB) para ~300 KB antes de enviar:
// mais rápido no 4G e dentro do limite das IAs grátis.
async function reduzirImagem(arquivo, lado = 2000) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error('Não consegui abrir essa imagem. Use uma foto JPG ou PNG.'));
      i.src = url;
    });
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const tela = document.createElement('canvas');
    tela.width = Math.round(img.naturalWidth * escala);
    tela.height = Math.round(img.naturalHeight * escala);
    tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
    const blob = await new Promise((ok) => tela.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Não consegui preparar a imagem.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Colar uma imagem (Ctrl+V, ex.: copiada do WhatsApp Web) com a leitura aberta
document.addEventListener('paste', (e) => {
  const zona = document.getElementById('ticket-soltar');
  if (!zona) return;
  const arquivo = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (arquivo) { e.preventDefault(); zona.dispatchEvent(new CustomEvent('arquivo', { detail: arquivo })); }
});

// Painel "Lido do ticket": foto, o que estava impresso e os avisos
function painelLeitura(leitura) {
  const r = leitura.resultado;
  const l = r.lido || {};
  const kg = (t) => (t ? `${formatarPeso(t)} t` : null);
  const impresso = [
    ['Balança', l.emissor], ['Entidade', l.entidade], ['Local', l.local], ['Terceiro', l.terceiro],
    ['Produto', [l.produto, l.tipo_produto].filter(Boolean).join(' · ')], ['Bruto', kg(l.peso_bruto)], ['Tara', kg(l.tara)],
  ].filter(([, valor]) => valor);
  const avisos = r.avisos.map((a) => `<li${r.duplicada && a === r.avisos[0] ? ' class="grave"' : ''}>${esc(a)}</li>`).join('');
  const naoAchados = [];
  if (!r.campos.cliente_id && l.emissor) naoAchados.push(`a balança ${esc(l.emissor)} não está nos clientes`);
  const temSugestao = Object.values(r.origem).includes('sugerido') && r.sugerido_de;
  return `
    <div class="leitura-ticket">
      ${leitura.foto ? `<a class="leitura-foto" href="${leitura.foto}" target="_blank" rel="noopener" title="Abrir a foto"><img src="${leitura.foto}" alt="Foto do ticket"></a>` : ''}
      <div class="leitura-info">
        <strong><i class="fas fa-receipt"></i> Lido ${esc(r.fonte)}</strong>
        <p class="sub">Em <span class="marca-lido">verde</span>, o que veio do ticket${temSugestao
          ? `; em <span class="marca-sugerido">roxo</span>, o que veio ${esc(r.sugerido_de)}` : ''}.
          Confira antes de salvar.</p>
        ${impresso.length ? `<dl class="leitura-impresso">${impresso.map(([k, valor]) => `<div><dt>${k}</dt><dd>${esc(valor)}</dd></div>`).join('')}</dl>` : ''}
        ${avisos ? `<ul class="leitura-avisos">${avisos}</ul>` : ''}
        ${r.faltando.length ? `<p class="leitura-falta"><i class="fas fa-pen-to-square"></i> Complete: ${r.faltando.join(', ')}${naoAchados.length ? ` (${naoAchados.join('; ')})` : ''}.</p>` : ''}
      </div>
    </div>`;
}

// Destaca os campos preenchidos pela leitura; mexer no campo tira o destaque
// (o valor passou a ser do usuário). focar: ordem dos campos para pôr o cursor no 1º vazio.
function marcarLidos(form, leitura, focar = []) {
  const r = leitura.resultado;
  for (const [nome, de] of Object.entries(r.origem)) {
    const el = form.elements[nome];
    if (!el) continue;
    const caixa = el.closest('.campo');
    const sugerido = de !== 'ticket';
    caixa.classList.add(sugerido ? 'campo-sugerido' : 'campo-lido');
    caixa.querySelector('label').insertAdjacentHTML('beforeend',
      `<span class="etiqueta-origem">${sugerido ? 'sugestão' : 'do ticket'}</span>`);
    if (sugerido && r.sugerido_de) caixa.querySelector('.etiqueta-origem').title = `Veio ${r.sugerido_de}`;
    const tirar = () => { caixa.classList.remove('campo-lido', 'campo-sugerido'); caixa.querySelector('.etiqueta-origem')?.remove(); };
    el.addEventListener('input', tirar, { once: true });
    el.addEventListener('change', tirar, { once: true });
  }
  const vazio = focar.map((n) => form.elements[n]).find((el) => el && !el.value);
  if (vazio) vazio.focus();
}

async function abrirLeituraTicket({ para = 'viagens', aoLer }) {
  if (!statusTicket) statusTicket = await api('/tickets/status').catch(() => ({ foto: false }));
  const foto = statusTicket.foto;
  abrirModal('Ler ticket de pesagem', `
    <form novalidate class="ler-ticket">
      ${foto ? `
        <label class="ticket-soltar" id="ticket-soltar" tabindex="0">
          <input type="file" id="ticket-arquivo" accept="image/*" hidden>
          <img id="ticket-previa" alt="Foto escolhida" hidden>
          <span class="ticket-convite"><i class="fas fa-camera"></i>
            <strong>Tirar foto ou escolher imagem</strong>
            <small>Também dá para arrastar a foto aqui ou colar (Ctrl+V).</small></span>
        </label>
        <p class="dica-ticket">Foto de perto, com o ticket inteiro, reto e sem sombra. Serve qualquer modelo de balança.
          A foto é usada só para a leitura e não fica guardada.</p>`
      : '<div class="alerta-importacao">A leitura por foto precisa da IA configurada no servidor. Por enquanto, cole o texto do ticket abaixo.</div>'}
      <details class="ticket-texto" ${foto ? '' : 'open'}>
        <summary>${foto ? 'Ou cole o texto do ticket' : 'Texto do ticket'}</summary>
        <textarea id="ticket-texto" rows="7" placeholder="No celular: abra a foto do ticket, toque em “Copiar texto” e cole aqui."></textarea>
      </details>
      <div class="form-erro" hidden></div>
      <div class="modal-rodape">
        <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-primario"><i class="fas fa-wand-magic-sparkles"></i> Ler ticket</button>
      </div>
    </form>`);
  $('#modal').classList.add('modal-ticket');

  const form = $('#modal-corpo form');
  const erroBox = form.querySelector('.form-erro');
  let imagem = null; // Blob reduzido
  let urlPrevia = null;

  async function usarArquivo(arquivo) {
    erroBox.hidden = true;
    if (!arquivo) return;
    if (!arquivo.type.startsWith('image/')) { erroBox.textContent = 'Escolha uma imagem (foto do ticket).'; erroBox.hidden = false; return; }
    try {
      imagem = await reduzirImagem(arquivo);
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      urlPrevia = URL.createObjectURL(imagem);
      const previa = $('#ticket-previa');
      previa.src = urlPrevia; previa.hidden = false;
      $('#ticket-soltar').classList.add('com-foto');
      $('#ticket-soltar .ticket-convite strong').textContent = 'Trocar foto';
    } catch (erro) {
      imagem = null; erroBox.textContent = mensagemErro(erro); erroBox.hidden = false;
    }
  }

  if (foto) {
    const zona = $('#ticket-soltar');
    $('#ticket-arquivo').addEventListener('change', (e) => usarArquivo(e.target.files[0]));
    zona.addEventListener('arquivo', (e) => usarArquivo(e.detail));
    zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#ticket-arquivo').click(); } });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
    zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastando'); usarArquivo(e.dataTransfer.files[0]); });
  }
  form.querySelector('[data-cancelar]').addEventListener('click', fecharModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = $('#ticket-texto').value.trim();
    if (!imagem && !texto) {
      erroBox.textContent = foto ? 'Escolha a foto do ticket ou cole o texto.' : 'Cole o texto do ticket.';
      erroBox.hidden = false; return;
    }
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true; erroBox.hidden = true;
    botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Lendo o ticket…';
    try {
      const resultado = imagem
        ? await enviarArquivo(`/tickets/ler?para=${para}`, imagem)
        : await api('/tickets/texto', { metodo: 'POST', corpo: { texto, para } });
      aoLer(resultado, imagem ? urlPrevia : null);
      $('#modal').classList.add('modal-ticket');
    } catch (erro) {
      erroBox.textContent = mensagemErro(erro); erroBox.hidden = false;
      botao.disabled = false;
      botao.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Ler ticket';
    }
  });
}
