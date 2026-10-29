const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { pool } = require('./config/db');
const { migracoesPendentes } = require('./config/conferirBanco');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : true,
    exposedHeaders: ['Content-Disposition'], // o navegador precisa ver o nome do arquivo baixado
  })
);
app.use(express.json({ limit: '1mb' })); // 1 MB: cabe a logo da empresa
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ message: 'Xylo API (CTech) está no ar!' });
});

// Teste rápido do banco: abra http://localhost:3000/api/health no navegador
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT now() AS agora');
    res.json({ ok: true, banco: 'conectado', agora: r.rows[0].agora });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, banco: 'erro', mensagem: err.message });
  }
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/conta', require('./routes/conta.routes'));            // pública: links do e-mail (confirmar, criar senha)
app.use('/api/solicitacoes', require('./routes/solicitacoes.routes')); // pública (página de venda)
app.use('/api/dev', require('./routes/dev.routes'));                 // painel do desenvolvedor
app.use('/api/usuarios', require('./routes/usuarios.routes'));
app.use('/api/clientes', require('./routes/clientes.routes'));
app.use('/api/florestas', require('./routes/florestas.routes'));
app.use('/api/empreiteiros', require('./routes/empreiteiros.routes'));
app.use('/api/precos', require('./routes/precos.routes'));
app.use('/api/viagens', require('./routes/viagens.routes'));
app.use('/api/fretes', require('./routes/fretes.routes'));
app.use('/api/despesas', require('./routes/despesas.routes'));
app.use('/api/relatorios', require('./routes/relatorios.routes'));
app.use('/api/assistente', require('./routes/assistente.routes'));
app.use('/api/empresa', require('./routes/empresa.routes'));
app.use('/api/exportacao', require('./routes/exportacao.routes'));
app.use('/api/importacao', require('./routes/importacao.routes'));
app.use('/api/tickets', require('./routes/tickets.routes'));       // leitura do ticket de pesagem
app.use('/api/lixeira', require('./routes/lixeira.routes'));       // excluir com motivo / restaurar
app.use('/api/historico', require('./routes/historico.routes'));   // auditoria (só admin)
app.use('/api/funcionarios', require('./routes/funcionarios.routes')); // folha: cadastro e faixas de comissão
app.use('/api/rotas', require('./routes/rotas.routes'));           // distâncias para a comissão
app.use('/api/faturas', require('./routes/faturas.routes'));     // mensalidade do Xylo (admin da empresa)
app.use('/api/folha', require('./routes/folha.routes'));           // folha de pagamento e adiantamentos

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Trata os erros mais comuns do PostgreSQL com mensagens claras
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados enviados em formato inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais. Envie um arquivo menor.' });
  if (err.code === 'P0001') return res.status(400).json({ erro: err.message });
  if (err.code === '23505') return res.status(409).json({ erro: 'Já existe um registro com esses dados.' });
  if (err.code === '23503') return res.status(409).json({ erro: 'Este registro está ligado a outros e não pode ser alterado/removido.' });
  if (err.code === '23514' || err.code === '23502') return res.status(400).json({ erro: 'Dados não permitidos pelo banco: ' + (err.detail || err.message) });
  if (err.code === '22P02') return res.status(400).json({ erro: 'Valor inválido em um dos campos.' });
  // Coluna/tabela que não existe: o código é mais novo que o banco (falta migração)
  if (err.code === '42703' || err.code === '42P01') {
    const faltam = migracoesPendentes();
    return res.status(500).json({
      erro: `O banco de dados está desatualizado${faltam.length ? `: falta rodar ${faltam.join(', ')} (pasta backend/database)` : ''}. `
        + 'O administrador do sistema precisa rodar a migração e reiniciar o servidor.',
    });
  }
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

module.exports = app;
