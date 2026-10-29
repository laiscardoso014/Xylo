// =====================================================================
// Xylo - fatura da mensalidade para ver, pagar (PIX) e imprimir
//   fatura.html?id=12           administrador da empresa (sessão do sistema)
//   fatura.html?id=12&painel=1  equipe CTech (sessão do painel)
// Depende do comum.js (requisicao, esc, formatar...) e do qrcode.js (qrSvg).
// =====================================================================
(function () {
  const $id = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const id = Number(params.get('id'));
  const painel = params.get('painel') === '1';
  const token = localStorage.getItem(painel ? 'wc_dev_token' : 'wc_token');
  const caminho = painel ? `/dev/cobranca/faturas/${id}` : `/faturas/${id}`;
  if (painel) { $id('link-voltar').href = 'dev.html#cobranca'; }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nomeMes = (aaaamm) => { const [a, m] = aaaamm.split('-'); return `${MESES[Number(m) - 1]} de ${a}`; };
  const documento = (d) => (d ? (String(d).length === 14 ? formatarCnpj(d) : formatarDocumento(d)) : '');

  function avisar(texto) {
    const a = $id('aviso');
    a.textContent = texto;
    a.hidden = false;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => { a.hidden = true; }, 2500);
  }
  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const campo = $id('pix-codigo');
      campo.focus();
      campo.select();
      document.execCommand('copy');
    }
    avisar('Código PIX copiado. Cole em "PIX copia e cola" no app do banco.');
  }

  function erro(texto, login) {
    $id('folha').innerHTML = `<div class="erro-fatura"><h1>Não foi possível abrir a fatura</h1><p>${esc(texto)}</p>
      ${login ? `<a class="botao" href="${painel ? 'dev.html' : 'login.html'}">Entrar</a>` : ''}</div>`;
  }

  async function carregar() {
    if (!id) return erro('Link da fatura incompleto.');
    if (!token) return erro('Entre no sistema para ver a fatura.', true);
    let r;
    try {
      r = await requisicao(caminho, { token });
    } catch (e) {
      return erro(e.message);
    }
    if (r.status === 401) return erro('A sua sessão expirou. Entre de novo para ver a fatura.', true);
    if (!r.ok) return erro((r.dados && r.dados.erro) || 'Fatura não encontrada.');
    desenhar(r.dados);
  }

  function desenhar(f) {
    const rec = f.recebedor || {};
    const aberta = f.situacao === 'Aberta' || f.situacao === 'Vencida';
    document.title = `Fatura ${f.numero} · ${f.empresa} | Xylo`;
    const carimbo = {
      Paga: `<div class="carimbo paga">PAGA<small>em ${esc(formatarDataISO(f.pago_em))}</small></div>`,
      Vencida: `<div class="carimbo vencida">VENCIDA<small>há ${f.dias_atraso} dia(s)</small></div>`,
      Cancelada: '<div class="carimbo cancelada">CANCELADA</div>',
    }[f.situacao] || '';

    $id('folha').innerHTML = `
      ${carimbo}
      <header class="cabecalho">
        <div class="marca">
          <span class="marca-icone"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="9.9" y="1.6" width="4.2" height="20.8" rx="2.1" fill="currentColor" transform="rotate(45 12 12)"/><rect x="9.9" y="1.6" width="4.2" height="20.8" rx="2.1" fill="currentColor" opacity=".72" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r="1.5" fill="#15803d"/></svg></span>
          <div><strong>Xylo</strong><span>CTech Sistemas</span></div>
        </div>
        <div class="numero">
          <span>Fatura nº</span>
          <strong>${esc(f.numero)}</strong>
          <span>Emitida em ${esc(formatarData(f.created_at))}</span>
        </div>
      </header>

      <section class="partes">
        <div>
          <h2>Quem recebe</h2>
          <p><strong>${esc(rec.nome || '')}</strong></p>
          ${rec.documento ? `<p>${rec.documento.length === 14 ? 'CNPJ' : 'CPF'} ${esc(documento(rec.documento))}</p>` : ''}
          ${rec.cidade ? `<p>${esc(rec.cidade)}</p>` : ''}
          ${rec.email ? `<p>${esc(rec.email)}</p>` : ''}
          ${rec.whatsapp ? `<p>WhatsApp ${esc(formatarTelefone(rec.whatsapp))}</p>` : ''}
        </div>
        <div>
          <h2>Cliente</h2>
          <p><strong>${esc(f.razao_social || f.empresa)}</strong></p>
          <p>CNPJ ${esc(formatarCnpj(f.cnpj))}</p>
          ${f.empresa_cidade ? `<p>${esc(f.empresa_cidade)}${f.empresa_uf ? `/${esc(f.empresa_uf)}` : ''}</p>` : ''}
          ${f.empresa_email ? `<p>${esc(f.empresa_email)}</p>` : ''}
        </div>
      </section>

      <section class="resumo-fatura">
        <div><span>Referente a</span><strong>${esc(nomeMes(f.competencia))}</strong></div>
        <div><span>Vencimento</span><strong class="${f.situacao === 'Vencida' ? 'atrasada' : ''}">${esc(formatarDataISO(f.vencimento))}</strong></div>
        <div class="total"><span>Valor a pagar</span><strong>${esc(formatarMoeda(f.valor))}</strong></div>
      </section>

      <table class="itens">
        <thead><tr><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody><tr><td>${esc(f.descricao)}</td><td class="num">${esc(formatarMoeda(f.valor))}</td></tr></tbody>
        <tfoot><tr><td>Total</td><td class="num">${esc(formatarMoeda(f.valor))}</td></tr></tfoot>
      </table>

      ${aberta ? `
      <section class="pix">
        <div class="pix-qr" id="pix-qr" aria-label="QR Code PIX"></div>
        <div class="pix-texto">
          <h2>Pague com PIX</h2>
          <ol>
            <li>Abra o app do seu banco e escolha <strong>PIX › Ler QR Code</strong>.</li>
            <li>Aponte a câmera para o código ao lado. O valor de <strong>${esc(formatarMoeda(f.valor))}</strong> já vem preenchido.</li>
            <li>Confira o recebedor (<strong>${esc(rec.nome || '')}</strong>) e confirme.</li>
          </ol>
          <label for="pix-codigo">Ou use o PIX copia e cola:</label>
          <div class="copia-cola">
            <textarea id="pix-codigo" readonly rows="3" spellcheck="false">${esc(f.pix_copia_cola)}</textarea>
            <button type="button" class="botao" id="btn-copiar"><i class="fas fa-copy"></i> Copiar</button>
          </div>
          <p class="miudo">Identificador do pagamento: XYLO${esc(f.numero)}</p>
        </div>
      </section>` : f.situacao === 'Paga' ? `
      <section class="quitada"><i class="fas fa-circle-check"></i> Pagamento de ${esc(formatarMoeda(f.valor_pago))} recebido em ${esc(formatarDataISO(f.pago_em))}. Obrigado!</section>` : ''}

      ${rec.instrucoes ? `<p class="instrucoes">${esc(rec.instrucoes)}</p>` : ''}
      <footer class="rodape-fatura">Xylo · gestão de fretes e fornecimento de madeira · CTech Sistemas</footer>`;

    if (aberta) {
      $id('pix-qr').innerHTML = qrSvg(f.pix_copia_cola, { tamanho: 210, titulo: 'QR Code PIX da fatura' });
      $id('btn-copiar').addEventListener('click', () => copiar(f.pix_copia_cola));
      $id('btn-copiar-topo').hidden = false;
      $id('btn-copiar-topo').addEventListener('click', () => copiar(f.pix_copia_cola));
    }
  }

  $id('btn-imprimir').addEventListener('click', () => window.print());
  carregar();
}());
