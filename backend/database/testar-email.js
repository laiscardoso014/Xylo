// =====================================================================
// TESTAR O ENVIO DE E-MAIL (usa o mesmo código do sistema e o .env)
// De dentro da pasta backend:
//   node database/testar-email.js                 (manda para o próprio EMAIL_USUARIO)
//   node database/testar-email.js outro@email.com (manda para outro endereço)
// Mostra qual conta está sendo usada e, se der erro, a resposta do servidor.
// =====================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { enviarEmail, configuracao } = require('../src/conta/smtp');

(async () => {
  const cfg = configuracao();
  if (!cfg) {
    console.log('✖ E-mail não configurado: confira EMAIL_SMTP_HOST, EMAIL_USUARIO e EMAIL_SENHA no backend/.env');
    process.exit(1);
  }
  if (cfg.tipo === 'brevo') {
    console.log(`Enviando pela Brevo como ${cfg.endereco}`);
  } else {
    console.log(`Servidor : ${cfg.host}:${cfg.porta} (${cfg.seguranca})`);
    console.log(`Usuário  : ${cfg.usuario}`);
    console.log(`Senha    : ${cfg.senha.length} caracteres (senha de app do Gmail tem 16)`);
    if (/seu\.email|suaconta|exemplo/i.test(cfg.usuario)) {
      console.log('⚠ EMAIL_USUARIO ainda é um e-mail de exemplo: troque pelo seu Gmail de verdade.');
    }
  }
  const para = process.argv[2] || cfg.usuario || cfg.endereco;
  try {
    await enviarEmail({
      para,
      assunto: 'Teste de e-mail do Xylo',
      texto: 'Se você recebeu esta mensagem, o envio de e-mail do Xylo está funcionando.',
      html: '<p>Se você recebeu esta mensagem, o envio de e-mail do Xylo está <strong>funcionando</strong>.</p>',
    });
    console.log(`✔ E-mail enviado para ${para}. Confira a caixa de entrada (e o spam).`);
  } catch (err) {
    console.log(`✖ Falhou: ${err.message}`);
    process.exit(1);
  }
})();