// =====================================================================
// Xylo - FINANCEIRO: mensalidade do Xylo (só Administrador)
// Faturas que a CTech emitiu para a empresa: ver, pagar com PIX
// (QR Code / copia e cola), imprimir e avisar "Já paguei".
// Depende do comum.js, api.js e qrcode.js (qrSvg).
// =====================================================================

const SELO_FATURA = { Aberta: 'selo-aberta', Vencida: 'selo-vencida', Paga: 'selo-ativo', Cancelada: 'selo-inativo' };
const MESES_FATURA = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesFatura = (aaaamm) => { const [a, m] = aaaamm.split('-'); return `${MESES_FATURA[Number(m) - 1]}/${a}`; };

function seloFatura(f) {
  let texto = f.situacao;
  if (f.situacao === 'Vencida') texto = `Vencida há ${f.dias_atraso} dia(s)`;
  if (f.situacao === 'Aberta' && f.informado_em) texto = 'Pagamento informado';
  return `<span class="selo ${SELO_FATURA[f.situacao] || ''}">${esc(texto)}</span>`;
}

async function telaFinanceiro() {
  conteudo.innerHTML = `
    <p class="nota-tela"><i class="fas fa-receipt"></i><span>Aqui ficam as faturas da <strong>mensalidade do Xylo</strong> da sua empresa.
      Pague pelo PIX (QR Code ou copia e cola) e, se quiser, avise com "Já paguei": a CTech confirma o recebimento.</span></p>
    <div class="cartoes cartoes-mini" id="resumo-faturas"></div>
    <div class="card sem-padding"><div id="lista-faturas" class="carregando">Carregando…</div></div>
    <p class="sub" id="contato-ctech"></p>`;

  let faturas = [];

  async function carregar() {
    try {
      const r = await api('/faturas');
      if (!$('#lista-faturas')) return;
      faturas = r.faturas;
      const prox = r.resumo.proxima;
      const cartao = (icone, valor, texto, classe = '') => `
        <div class="card cartao ${classe}"><div class="cartao-icone"><i class="fas ${icone}"></i></div>
          <div><strong>${valor}</strong><span>${texto}</span></div></div>`;
      $('#resumo-faturas').innerHTML = [
        cartao('fa-wallet', esc(formatarMoeda(r.resumo.em_aberto)), 'em aberto', r.resumo.vencidas ? 'cartao-alerta' : ''),
        cartao('fa-calendar-day', prox ? esc(formatarDataISO(prox.vencimento)) : '–', prox ? `próximo vencimento (${esc(mesFatura(prox.competencia))})` : 'nenhuma fatura a pagar'),
        cartao('fa-file-invoice', r.plano && r.plano.mensalidade ? esc(formatarMoeda(r.plano.mensalidade)) : '–',
          r.plano && r.plano.mensalidade ? `por mês · vence todo dia ${r.plano.dia_vencimento}` : 'plano ainda não definido'),
      ].join('');
      const c = r.contato;
      $('#contato-ctech').innerHTML = c.email || c.whatsapp
        ? `Dúvidas sobre a cobrança: ${[c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '',
          c.whatsapp ? `WhatsApp <a href="https://wa.me/55${esc(c.whatsapp)}" target="_blank" rel="noopener">${esc(formatarTelefone(c.whatsapp))}</a>` : '']
          .filter(Boolean).join(' · ')}`
        : '';
      desenhar();
    } catch (erro) {
      if (!$('#lista-faturas')) return;
      $('#lista-faturas').className = 'aviso-erro';
      $('#lista-faturas').textContent = mensagemErro(erro);
    }
  }

  function desenhar() {
    const box = $('#lista-faturas');
    if (!faturas.length) {
      box.className = 'vazio';
      box.innerHTML = 'Nenhuma fatura emitida ainda.';
      return;
    }
    box.className = 'tabela-wrap';
    box.innerHTML = `
      <table class="tabela tabela-faturas">
        <thead><tr><th>Mês</th><th>Fatura</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${faturas.map((f) => {
            const aberta = f.situacao === 'Aberta' || f.situacao === 'Vencida';
            return `
            <tr class="${f.situacao === 'Vencida' ? 'linha-vencida' : ''}">
              <td><strong>${esc(mesFatura(f.competencia))}</strong></td>
              <td>${esc(f.numero)}<div class="sub">${esc(f.descricao)}</div></td>
              <td>${esc(formatarDataISO(f.vencimento))}</td>
              <td class="num"><strong>${esc(formatarMoeda(f.valor))}</strong></td>
              <td>${seloFatura(f)}${f.situacao === 'Paga' ? `<div class="sub">em ${esc(formatarDataISO(f.pago_em))}</div>` : ''}</td>
              <td class="acoes">
                ${aberta ? `<button type="button" class="btn btn-primario pequeno" data-pagar="${f.id}"><i class="fas fa-qrcode"></i> Pagar com PIX</button>` : ''}
                <a class="icone-botao" href="fatura.html?id=${f.id}" target="_blank" rel="noopener" title="Abrir a fatura (imprimir / PDF)" aria-label="Abrir a fatura ${esc(f.numero)}"><i class="fas fa-file-invoice"></i></a>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  async function pagar(id) {
    let f;
    try {
      f = await api(`/faturas/${id}`);
    } catch (erro) {
      toast(mensagemErro(erro), 'erro');
      return;
    }
    abrirModal(`Pagar ${mesFatura(f.competencia)} com PIX`, `
      <div class="pagar-pix">
        <div class="pagar-qr">${qrSvg(f.pix_copia_cola, { tamanho: 220, titulo: 'QR Code PIX da fatura' })}</div>
        <div>
          <p class="valor-pix">${esc(formatarMoeda(f.valor))}</p>
          <p class="sub">Vencimento ${esc(formatarDataISO(f.vencimento))} · Fatura ${esc(f.numero)}<br>Recebedor: <strong>${esc(f.recebedor.nome)}</strong></p>
          <ol class="passos-pix">
            <li>No app do banco, escolha <strong>PIX › Ler QR Code</strong>.</li>
            <li>Aponte para o código: o valor já vem preenchido.</li>
          </ol>
          <label class="rotulo-pix" for="pix-modal">Ou PIX copia e cola</label>
          <textarea id="pix-modal" class="codigo-pix" readonly rows="3" spellcheck="false">${esc(f.pix_copia_cola)}</textarea>
          <button type="button" class="btn btn-secundario" id="copiar-pix"><i class="fas fa-copy"></i> Copiar código</button>
        </div>
      </div>
      ${f.informado_em ? `<p class="nota"><i class="fas fa-circle-check"></i> Você avisou o pagamento em ${esc(formatarDataHora(f.informado_em))}. A CTech vai confirmar.</p>` : ''}
      <div class="modal-rodape">
        <a class="btn btn-secundario" href="fatura.html?id=${f.id}" target="_blank" rel="noopener"><i class="fas fa-print"></i> Abrir fatura</a>
        ${f.informado_em ? '<button type="button" class="btn btn-primario" data-cancelar>Fechar</button>'
          : '<button type="button" class="btn btn-primario" id="ja-paguei"><i class="fas fa-check"></i> Já paguei</button>'}
      </div>`);
    $('#modal').classList.add('modal-medio');
    $('#copiar-pix').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(f.pix_copia_cola); } catch { $('#pix-modal').select(); document.execCommand('copy'); }
      toast('Código PIX copiado. Cole em "PIX copia e cola" no app do banco.');
    });
    const fechar = $('#modal-corpo [data-cancelar]');
    if (fechar) fechar.addEventListener('click', fecharModal);
    const jaPaguei = $('#ja-paguei');
    if (jaPaguei) {
      jaPaguei.addEventListener('click', async () => {
        jaPaguei.disabled = true;
        try {
          await api(`/faturas/${f.id}/informar`, { metodo: 'POST' });
          fecharModal();
          toast('Obrigado! Avisamos a CTech. A fatura fica como paga assim que o recebimento for confirmado.');
          carregar();
          atualizarBadgeFatura();
        } catch (erro) {
          toast(mensagemErro(erro), 'erro');
          jaPaguei.disabled = false;
        }
      });
    }
  }

  cliqueDaTela = (e) => {
    const b = e.target.closest('button[data-pagar]');
    if (b) pagar(Number(b.dataset.pagar));
  };

  carregar();
}

// Início: aviso para o administrador quando há fatura vencida ou vencendo em até 5 dias
async function avisoDeFatura(alvo) {
  if (!PERFIL.admin || !alvo) return;
  try {
    const r = await api('/faturas');
    const p = r.resumo.proxima;
    if (!p || p.informado_em) return;
    const dias = Math.round((new Date(`${p.vencimento}T12:00:00`) - new Date(`${hojeISO()}T12:00:00`)) / 86400e3);
    if (dias > 5) return;
    const vencida = p.situacao === 'Vencida';
    alvo.innerHTML = `
      <div class="aviso-fatura ${vencida ? 'vencida' : ''}" role="status">
        <i class="fas ${vencida ? 'fa-triangle-exclamation' : 'fa-receipt'}"></i>
        <span>${vencida
          ? `A mensalidade do Xylo de ${esc(mesFatura(p.competencia))} venceu em ${esc(formatarDataISO(p.vencimento))}.`
          : `A mensalidade do Xylo de ${esc(mesFatura(p.competencia))} (${esc(formatarMoeda(p.valor))}) vence ${dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`}.`}</span>
        <a class="btn ${vencida ? 'btn-primario' : 'btn-secundario'} pequeno" href="#financeiro">Pagar com PIX</a>
      </div>`;
  } catch { /* sem faturas ou banco desatualizado: não mostra nada */ }
}

// Menu: número de faturas a pagar (vermelho se alguma venceu)
async function atualizarBadgeFatura() {
  const badge = $('#badge-fatura');
  if (!badge) return;
  try {
    const r = await api('/faturas');
    const pendentes = r.faturas.filter((f) => (f.situacao === 'Aberta' || f.situacao === 'Vencida') && !f.informado_em);
    badge.textContent = pendentes.length || '';
    badge.classList.toggle('badge-alerta', pendentes.some((f) => f.situacao === 'Vencida'));
    badge.title = pendentes.length ? `${pendentes.length} fatura(s) a pagar` : '';
  } catch { badge.textContent = ''; }
}
