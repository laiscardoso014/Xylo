// =====================================================================
// ENVIO DE E-MAIL por SMTP (sem biblioteca externa)
//
// Funciona com Gmail (senha de app), Outlook/Hotmail, Brevo e qualquer
// servidor SMTP. Configuração no .env:
//
//   EMAIL_SMTP_HOST=smtp.gmail.com
//   EMAIL_SMTP_PORTA=465            (465 = SSL direto; 587 = STARTTLS)
//   EMAIL_USUARIO=suaconta@gmail.com
//   EMAIL_SENHA=abcd efgh ijkl mnop (Gmail: "senha de app", não a senha normal)
//   EMAIL_REMETENTE=Xylo <suaconta@gmail.com>   (opcional)
//
// O protocolo, passo a passo (RFC 5321):
//   servidor: 220 pronto        cliente: EHLO
//   (587) STARTTLS -> a conexão passa a ser criptografada -> EHLO de novo
//   AUTH PLAIN/LOGIN (usuário e senha)    MAIL FROM / RCPT TO / DATA
//   mensagem (cabeçalhos + corpo MIME) terminada em "<CRLF>.<CRLF>"   QUIT
// =====================================================================
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

function configuracao() {
  const e = process.env;
  if (!e.EMAIL_SMTP_HOST || !e.EMAIL_USUARIO || !e.EMAIL_SENHA) return null;
  const porta = Number(e.EMAIL_SMTP_PORTA) || 465;
  const seguranca = (e.EMAIL_SMTP_SEGURANCA || (porta === 465 ? 'ssl' : 'starttls')).toLowerCase();
  const remetente = e.EMAIL_REMETENTE || `Xylo <${e.EMAIL_USUARIO}>`;
  const endereco = (remetente.match(/<([^>]+)>/) || [null, remetente])[1].trim();
  return {
    host: e.EMAIL_SMTP_HOST.trim(), porta, seguranca, usuario: e.EMAIL_USUARIO.trim(),
    senha: String(e.EMAIL_SENHA).replace(/\s+/g, ''), // senha de app do Gmail vem em grupos com espaço
    remetente, endereco,
    // só para testes com servidor local (certificado próprio)
    verificarCertificado: e.EMAIL_SMTP_IGNORAR_CERTIFICADO !== '1',
  };
}

// ---------------------------------------------------------------------
// Mensagem MIME: texto + HTML, UTF-8 (acentos) em base64
// ---------------------------------------------------------------------
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const linhas76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const cabecalhoUtf8 = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function enderecoComNome(texto) {
  const m = String(texto).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? `${cabecalhoUtf8(m[1].replace(/"/g, ''))} <${m[2]}>` : String(texto).trim();
}

function montarMensagem({ de, dominio, para, assunto, texto, html }) {
  const fronteira = `xylo-${crypto.randomBytes(12).toString('hex')}`;
  const cabecalhos = [
    `From: ${enderecoComNome(de)}`,
    `To: ${para}`,
    `Subject: ${cabecalhoUtf8(assunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${dominio}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${fronteira}"`,
  ];
  const parte = (tipo, conteudo) => [
    `--${fronteira}`, `Content-Type: ${tipo}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', linhas76(b64(conteudo)),
  ].join('\r\n');
  return `${cabecalhos.join('\r\n')}\r\n\r\n${parte('text/plain', texto)}\r\n${parte('text/html', html)}\r\n--${fronteira}--\r\n`;
}

// ---------------------------------------------------------------------
// Conversa com o servidor: manda um comando e espera a resposta (código)
// ---------------------------------------------------------------------
class Conversa {
  constructor(socket) { this.trocar(socket); }

  trocar(socket) {
    this.socket = socket;
    this.buffer = '';
    this.espera = null;
    socket.setEncoding('utf8');
    socket.on('data', (d) => { this.buffer += d; this.verificar(); });
    socket.on('error', (err) => { if (this.espera) { const { falhou } = this.espera; this.espera = null; falhou(err); } });
  }

  // Resposta completa: última linha "NNN texto" (as anteriores são "NNN-texto")
  verificar() {
    if (!this.espera) return;
    const linhas = this.buffer.split('\r\n');
    for (let i = 0; i < linhas.length - 1; i++) {
      if (/^\d{3} /.test(linhas[i]) || /^\d{3}$/.test(linhas[i])) {
        const resposta = linhas.slice(0, i + 1);
        this.buffer = linhas.slice(i + 1).join('\r\n');
        const { pronto } = this.espera;
        this.espera = null;
        pronto({ codigo: Number(resposta[i].slice(0, 3)), texto: resposta.map((l) => l.slice(4)).join('\n') });
        return;
      }
    }
  }

  ler() {
    return new Promise((pronto, falhou) => { this.espera = { pronto, falhou }; this.verificar(); });
  }

  async enviar(comando, esperados, oculto = false) {
    if (comando !== null) this.socket.write(`${comando}\r\n`);
    const r = await this.ler();
    if (!esperados.includes(r.codigo)) {
      const erro = new Error(`Servidor de e-mail respondeu ${r.codigo} a ${oculto ? 'AUTH' : (comando || 'conexão').split(' ')[0]}: ${r.texto}`);
      erro.codigoSmtp = r.codigo;
      throw erro;
    }
    return r;
  }
}

// nome do servidor para o certificado (não vale para IP)
const nomeTls = (host) => (net.isIP(host) ? undefined : host);

function conectar(cfg) {
  return new Promise((pronto, falhou) => {
    const opcoes = { host: cfg.host, port: cfg.porta, servername: nomeTls(cfg.host), rejectUnauthorized: cfg.verificarCertificado };
    const socket = cfg.seguranca === 'ssl' ? tls.connect(opcoes) : net.connect(opcoes);
    socket.setTimeout(20000, () => socket.destroy(Object.assign(new Error('O servidor de e-mail demorou demais para responder.'), { code: 'ETIMEDOUT' })));
    socket.once(cfg.seguranca === 'ssl' ? 'secureConnect' : 'connect', () => pronto(socket));
    socket.once('error', falhou);
  });
}

function iniciarTls(socket, cfg) {
  return new Promise((pronto, falhou) => {
    socket.removeAllListeners('data');
    socket.removeAllListeners('error');
    const seguro = tls.connect({ socket, servername: nomeTls(cfg.host), rejectUnauthorized: cfg.verificarCertificado }, () => pronto(seguro));
    seguro.once('error', falhou);
  });
}

// ---------------------------------------------------------------------
// enviarEmail({ para, assunto, texto, html })
//   -> { enviado: true } | { enviado: false, motivo: 'nao_configurado' }
//   Erro de envio (senha errada, servidor fora): lança Error com mensagem clara.
// ---------------------------------------------------------------------
// Erros de rede em português
function explicarFalha(err, cfg) {
  const lugar = `${cfg.host}:${cfg.porta}`;
  const textos = {
    ECONNREFUSED: `Não consegui conectar ao servidor de e-mail ${lugar} (conexão recusada). Confira EMAIL_SMTP_HOST e EMAIL_SMTP_PORTA.`,
    ENOTFOUND: `O servidor de e-mail "${cfg.host}" não foi encontrado. Confira EMAIL_SMTP_HOST e a internet do servidor.`,
    EAI_AGAIN: `Sem internet para chegar ao servidor de e-mail "${cfg.host}".`,
    ETIMEDOUT: `O servidor de e-mail ${lugar} não respondeu a tempo. Confira a porta (465 ou 587) e se a rede bloqueia SMTP.`,
    ECONNRESET: `O servidor de e-mail ${lugar} fechou a conexão. Na porta 465 use EMAIL_SMTP_SEGURANCA=ssl; na 587, starttls.`,
  };
  if (textos[err.code]) return new Error(textos[err.code]);
  if (/certificate|self.signed|CERT_/i.test(err.message || '') || /CERT|SELF_SIGNED/.test(err.code || '')) {
    return new Error(`O certificado de segurança do servidor de e-mail ${cfg.host} não é confiável (${err.message}).`);
  }
  if (/wrong version number|packet length too long/i.test(err.message || '')) {
    return new Error(`A porta ${cfg.porta} não usa SSL direto: para 587 use EMAIL_SMTP_SEGURANCA=starttls (ou a porta 465).`);
  }
  return err;
}

async function enviarEmail(mensagem) {
  const cfg = configuracao();
  if (!cfg) return { enviado: false, motivo: 'nao_configurado' };
  try {
    return await conversar(cfg, mensagem);
  } catch (err) {
    throw explicarFalha(err, cfg);
  }
}

async function conversar(cfg, { para, assunto, texto, html }) {
  const dominio = cfg.endereco.split('@')[1] || 'xylo.local';
  let socket = await conectar(cfg);
  const c = new Conversa(socket);
  try {
    await c.enviar(null, [220]);
    let ehlo = await c.enviar(`EHLO ${dominio}`, [250]);
    if (cfg.seguranca === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.texto)) throw new Error('O servidor de e-mail não oferece conexão segura (STARTTLS) nesta porta.');
      await c.enviar('STARTTLS', [220]);
      socket = await iniciarTls(socket, cfg);
      c.trocar(socket);
      ehlo = await c.enviar(`EHLO ${dominio}`, [250]);
    }
    try {
      if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.texto)) {
        await c.enviar(`AUTH PLAIN ${Buffer.from(`\0${cfg.usuario}\0${cfg.senha}`).toString('base64')}`, [235], true);
      } else {
        await c.enviar('AUTH LOGIN', [334], true);
        await c.enviar(Buffer.from(cfg.usuario).toString('base64'), [334], true);
        await c.enviar(Buffer.from(cfg.senha).toString('base64'), [235], true);
      }
    } catch (err) {
      if (err.codigoSmtp === 535 || err.codigoSmtp === 534) {
        throw new Error('O servidor de e-mail recusou o usuário/senha do .env (no Gmail, use uma "senha de app").');
      }
      throw err;
    }
    await c.enviar(`MAIL FROM:<${cfg.endereco}>`, [250]);
    await c.enviar(`RCPT TO:<${para}>`, [250, 251]);
    await c.enviar('DATA', [354]);
    // linha começando com "." ganha outro "." (senão o servidor acharia que acabou)
    const corpo = montarMensagem({ de: cfg.remetente, dominio, para, assunto, texto, html }).replace(/\r\n\./g, '\r\n..');
    socket.write(`${corpo}\r\n.\r\n`);
    await c.enviar(null, [250]);
    socket.write('QUIT\r\n');
    return { enviado: true };
  } finally {
    setTimeout(() => socket.destroy(), 500);
  }
}

module.exports = { enviarEmail, configuracao, montarMensagem };
