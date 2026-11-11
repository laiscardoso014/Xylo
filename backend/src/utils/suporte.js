// E-mail de suporte da CTech: aparece nos e-mails do sistema, nas mensagens de erro,
// nas faturas e no assistente. Pode ser trocado pela variável SUPORTE_EMAIL.
const SUPORTE_EMAIL = (process.env.SUPORTE_EMAIL || 'suportectechdev@gmail.com').trim();
module.exports = { SUPORTE_EMAIL };
