require('dotenv').config();

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
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  conferirBanco(); // avisa se falta rodar alguma migração do banco
  const email = emailConfigurado();
  console.log(email
    ? `✉  E-mail: envia por ${email.host}:${email.porta} como ${email.endereco}`
    : '✉  E-mail: modo teste (sem EMAIL_* no .env) - os links de confirmação aparecem aqui no console');
  iniciarAgendador(); // faturas da mensalidade: geração automática (se ligada no painel)
});
