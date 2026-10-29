// Lê o .env que fica AO LADO deste arquivo (pasta backend), de onde quer que o servidor seja iniciado
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

if (!process.env.CONNECTION_STRING) {
  console.error('Falta CONNECTION_STRING no arquivo .env. Veja o .env.example.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET no arquivo .env. Veja o .env.example.');
  process.exit(1);
}

const app = require('./src/app');
const { conferirBanco } = require('./src/config/conferirBanco');
const { configuracao: emailConfigurado } = require('./src/conta/smtp');
const { iniciarAgendador } = require('./src/faturas/faturas');

const PORT = process.env.PORT || 3000;
app.listen(PORT, (erro) => {
  // Express 5 avisa aqui quando a porta não abriu (ex.: outro servidor já está usando)
  if (erro) {
    console.error(erro.code === 'EADDRINUSE'
      ? `\n❌ A porta ${PORT} já está em uso: tem OUTRO servidor do Xylo aberto (outra janela do PowerShell/VS Code).\n`
        + '   Feche a outra janela ou rode:  Get-Process node | Stop-Process   e depois inicie de novo.\n'
      : `\n❌ O servidor não conseguiu abrir a porta ${PORT}: ${erro.message}\n`);
    process.exit(1);
  }
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  conferirBanco(); // avisa se falta rodar alguma migração do banco
  const email = emailConfigurado();
  console.log(email
    ? `✉  E-mail: envia por ${email.host}:${email.porta} como ${email.endereco}`
    : '✉  E-mail: modo teste (sem EMAIL_* no .env) - os links de confirmação aparecem aqui no console');
  console.log(require('./src/assistente/provedores').resumoIA());
  iniciarAgendador(); // faturas da mensalidade: geração automática (se ligada no painel)
});
