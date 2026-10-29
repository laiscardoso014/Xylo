// =====================================================================
// E-MAILS DA CONTA: convite (confirmar e criar a senha), troca de e-mail
// e "esqueci minha senha".
//
// O link leva um TOKEN aleatório (32 bytes). No banco fica só o hash
// SHA-256 dele: quem tiver acesso ao banco não consegue usar os links.
// Cada link vale uma vez e expira (convite 48 h, troca de e-mail 24 h,
// nova senha 1 h).
//
// Sem servidor de e-mail configurado (.env), o sistema funciona em
// "modo teste": o e-mail aparece no console do servidor e a tela mostra o
// link para o administrador copiar.
// =====================================================================
const crypto = require('crypto');
const { enviarEmail, configuracao } = require('./smtp');

const VALIDADE_HORAS = { convite: 48, troca_email: 24, nova_senha: 1 };
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Endereço do sistema para montar os links (o frontend)
function urlDoSistema() {
  const base = process.env.APP_URL || (process.env.FRONTEND_URL || '').split(',')[0] || 'http://localhost:5500';
  return base.trim().replace(/\/+$/, '');
}

// Cria um link novo (os anteriores do mesmo tipo deixam de valer). "executar" = query ou client.query
async function criarToken(executar, usuarioId, tipo, emailNovo = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  await executar("UPDATE tokens_conta SET usado_em = now() WHERE usuario_id = $1 AND tipo = $2 AND usado_em IS NULL", [usuarioId, tipo]);
  await executar(
    `INSERT INTO tokens_conta (usuario_id, tipo, token_hash, email_novo, expira_em)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [usuarioId, tipo, hashToken(token), emailNovo, VALIDADE_HORAS[tipo]]);
  return token;
}

// ---------------------------------------------------------------------
// Modelos (HTML simples, com estilos na própria tag: é o que os
// programas de e-mail aceitam)
// ---------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function moldura({ titulo, paragrafos, botao, link, rodape }) {
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb">
<tr><td style="padding:22px 28px 6px"><span style="display:inline-block;background:#15803d;color:#fff;font-weight:800;border-radius:8px;padding:6px 10px;font-size:15px">✕ Xylo</span></td></tr>
<tr><td style="padding:10px 28px 4px"><h1 style="margin:0;font-size:20px;color:#111827">${esc(titulo)}</h1></td></tr>
<tr><td style="padding:6px 28px 4px;font-size:15px;line-height:1.55">${paragrafos.map((p) => `<p style="margin:10px 0">${p}</p>`).join('')}</td></tr>
<tr><td style="padding:14px 28px 6px"><a href="${esc(link)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:15px">${esc(botao)}</a></td></tr>
<tr><td style="padding:8px 28px 20px;font-size:12.5px;color:#6b7280;line-height:1.5">Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all;color:#15803d">${esc(link)}</span></td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5">${rodape}<br>Xylo · gestão de fretes e fornecimento de madeira · CTech Sistemas</td></tr>
</table></td></tr></table></body></html>`;
  return html;
}

function modelo(tipo, d) {
  const nome = d.nome ? d.nome.split(/\s+/)[0] : '';
  if (tipo === 'convite') {
    const assunto = 'Sua conta no Xylo foi criada';
    const paragrafos = [
      `Olá${nome ? `, <strong>${esc(nome)}</strong>` : ''}!`,
      `${d.quemCriou ? esc(d.quemCriou) : 'O administrador'} criou um acesso para você no Xylo da empresa <strong>${esc(d.empresa)}</strong>${d.perfil ? ` (perfil ${esc(d.perfil)})` : ''}.`,
      'Para ativar, confirme que este e-mail é seu e crie a sua senha:',
    ];
    return {
      assunto,
      html: moldura({ titulo: assunto, paragrafos, botao: 'Confirmar e-mail e criar minha senha', link: d.link,
        rodape: `O link vale por ${VALIDADE_HORAS.convite} horas e só pode ser usado uma vez. Se você não esperava este convite, ignore este e-mail.` }),
      texto: `Olá${nome ? `, ${nome}` : ''}!\n\n${d.quemCriou || 'O administrador'} criou um acesso para você no Xylo da empresa ${d.empresa}${d.perfil ? ` (perfil ${d.perfil})` : ''}.\n\nConfirme o seu e-mail e crie a sua senha:\n${d.link}\n\nO link vale por ${VALIDADE_HORAS.convite} horas. Se você não esperava este convite, ignore este e-mail.\n\nXylo · CTech Sistemas`,
    };
  }
  if (tipo === 'troca_email') {
    const assunto = 'Confirme o seu novo e-mail no Xylo';
    return {
      assunto,
      html: moldura({ titulo: assunto, botao: 'Confirmar o novo e-mail', link: d.link,
        paragrafos: [`Olá${nome ? `, <strong>${esc(nome)}</strong>` : ''}!`, `Você pediu para trocar o e-mail de acesso ao Xylo (${esc(d.empresa)}) para <strong>${esc(d.emailNovo)}</strong>.`,
          'O e-mail só muda depois que você confirmar:'],
        rodape: `O link vale por ${VALIDADE_HORAS.troca_email} horas. Se não foi você, ignore: o e-mail antigo continua valendo.` }),
      texto: `Olá${nome ? `, ${nome}` : ''}!\n\nVocê pediu para trocar o e-mail de acesso ao Xylo (${d.empresa}) para ${d.emailNovo}.\nConfirme aqui:\n${d.link}\n\nSe não foi você, ignore este e-mail.\n\nXylo · CTech Sistemas`,
    };
  }
  const assunto = 'Criar uma nova senha no Xylo';
  return {
    assunto,
    html: moldura({ titulo: assunto, botao: 'Criar nova senha', link: d.link,
      paragrafos: [`Olá${nome ? `, <strong>${esc(nome)}</strong>` : ''}!`, `Recebemos um pedido para criar uma nova senha do seu acesso ao Xylo (${esc(d.empresa)}).`],
      rodape: `O link vale por ${VALIDADE_HORAS.nova_senha} hora. Se não foi você, ignore: a sua senha atual continua valendo.` }),
    texto: `Olá${nome ? `, ${nome}` : ''}!\n\nPara criar uma nova senha do Xylo (${d.empresa}), abra:\n${d.link}\n\nO link vale por 1 hora. Se não foi você, ignore este e-mail.\n\nXylo · CTech Sistemas`,
  };
}

// ---------------------------------------------------------------------
// Envia o e-mail de um tipo para um usuário.
//   d: { nome, empresa, perfil, quemCriou, emailNovo }
// Devolve { enviado, para, link_teste? }  (link_teste só no modo teste)
// Erro no envio (ex.: senha do Gmail errada): devolve { enviado: false, erro }
// ---------------------------------------------------------------------
async function enviarLink(executar, usuarioId, tipo, para, d) {
  const token = await criarToken(executar, usuarioId, tipo, tipo === 'troca_email' ? para : null);
  const link = `${urlDoSistema()}/confirmar.html?t=${token}`;
  const m = modelo(tipo, { ...d, link, emailNovo: para });
  if (!configuracao()) {
    console.log(`\n✉  [modo teste - e-mail não configurado no .env] Para: ${para}\n   Assunto: ${m.assunto}\n   Link: ${link}\n`);
    return { enviado: false, modo_teste: true, para, link_teste: link };
  }
  try {
    await enviarEmail({ para, assunto: m.assunto, texto: m.texto, html: m.html });
    return { enviado: true, para };
  } catch (err) {
    console.error(`[e-mail] falhou para ${para}:`, err.message);
    return { enviado: false, para, erro: err.message };
  }
}

module.exports = { enviarLink, criarToken, hashToken, modelo, moldura, esc, urlDoSistema, VALIDADE_HORAS };
