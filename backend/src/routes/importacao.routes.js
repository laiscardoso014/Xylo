// =====================================================================
// IMPORTAÇÃO DE PLANILHAS - Administrador e Financeiro
//
//   GET  /api/importacao/modelo?tipo=viagens|fretes|clientes|florestas|empreiteiros   baixa o modelo .xlsx
//   POST /api/importacao/analisar?tipo=...&aba=...&cliente=...&criar=1&valor=1  (corpo = arquivo .xlsx)
//        -> prévia linha a linha, NÃO grava nada
//   POST /api/importacao/gravar?mesmos parâmetros                                 (corpo = arquivo .xlsx)
//        -> refaz a análise e grava as linhas certas, tudo numa transação
//
// O arquivo vai no corpo da requisição (application/octet-stream), até 10 MB.
// =====================================================================
const express = require('express');
const { query: q, validationResult } = require('express-validator');
const { autenticar, podeEditar } = require('../middlewares/auth');
const { lerPasta, novaPasta } = require('../utils/xlsx');
const { analisar, gravar, paraTela } = require('../importacao/importador');

const router = express.Router();
router.use(autenticar, podeEditar);

const TIPOS = ['viagens', 'fretes', 'clientes', 'florestas', 'empreiteiros'];
const arquivo = express.raw({ type: () => true, limit: '10mb' });

function validar(req, res, next) {
  const erros = validationResult(req);
  if (!erros.isEmpty()) return res.status(400).json({ erro: erros.array()[0].msg });
  next();
}
const regras = [
  q('tipo').isIn(TIPOS).withMessage('Escolha o que importar.'),
  q('cliente').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Cliente inválido.'),
];

function opcoes(req) {
  return {
    tipo: req.query.tipo,
    aba: req.query.aba || null,
    clienteFixo: req.query.cliente ? Number(req.query.cliente) : null,
    clienteOrigem: req.query.origem === 'bloco' ? 'bloco' : 'aba',
    criarCadastros: req.query.criar === '1',
    usarValorDaPlanilha: req.query.valor !== '0',
  };
}

function lerArquivo(req) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    throw Object.assign(new Error('Envie o arquivo da planilha (.xlsx).'), { status: 400 });
  }
  if (req.body[0] !== 0x50 || req.body[1] !== 0x4b) { // "PK": todo .xlsx é um ZIP
    throw Object.assign(new Error('O arquivo precisa ser uma planilha do Excel (.xlsx). Se for .xls ou .csv, abra no Excel e use "Salvar como" .xlsx.'), { status: 400 });
  }
  try {
    return lerPasta(req.body);
  } catch (err) {
    throw Object.assign(new Error(`Não consegui ler a planilha: ${err.message}`), { status: 400 });
  }
}

const responderErro = (err, res, next) => (err.status ? res.status(err.status).json({ erro: err.message }) : next(err));

router.post('/analisar', arquivo, regras, validar, async (req, res, next) => {
  try {
    res.json(paraTela(await analisar(req.usuario.empresaId, lerArquivo(req), opcoes(req))));
  } catch (err) {
    responderErro(err, res, next);
  }
});

router.post('/gravar', arquivo, regras, validar, async (req, res, next) => {
  try {
    const pasta = lerArquivo(req);
    const analise = await analisar(req.usuario.empresaId, pasta, opcoes(req));
    const origem = `planilha${req.query.nome ? ` ${String(req.query.nome).slice(0, 80)}` : ''}${analise.aba ? ` (aba ${analise.aba})` : ''}`;
    const r = await gravar(req.usuario.empresaId, req.usuario.id, analise, origem);
    res.json({ ...r, duplicadas: analise.resumo.duplicadas, erros: analise.resumo.erros });
  } catch (err) {
    responderErro(err, res, next);
  }
});

// ---------------------------------------------------------------------
// MODELOS para preencher
// ---------------------------------------------------------------------
const MODELOS = {
  viagens: {
    colunas: [
      ['Data', 'data', 12], ['Cliente', 'texto', 20], ['Floresta', 'texto', 18], ['Empreiteiro', 'texto', 16], ['Classe', 'texto', 11],
      ['Ticket', 'texto', 10], ['Placa', 'texto', 10], ['Peso líquido', 'decimal', 13], ['Valor da tonelada', 'moeda', 17], ['Motorista', 'texto', 14], ['Observações', 'texto', 26],
    ],
    exemplos: [
      ['2026-01-06', 'PAU BRASIL', 'GRAZZIOTIN', 'CABEÇOTE', 'Fina', '96403', 'QJL9F85', 46.79, 220, 'JOELSON', ''],
      ['2026-01-08', 'PAU BRASIL', 'GRAZZIOTIN', 'CABEÇOTE', 'Grossa', '96623', 'MIC5D98', 25.24, 460, 'JOELSON', ''],
    ],
    dicas: [
      'Obrigatórios: Data, Cliente, Floresta, Classe e Peso líquido.',
      'Classe: Lixo, Fina, Média, Grossa ou Eucalipto (pode escrever "FINA 220", "COMPRIDA MEDIA"...).',
      'Valor da tonelada: se ficar vazio, o sistema usa a Tabela de preços.',
      'Viagens com ticket já lançado (ou mesma data, placa e peso) são ignoradas: pode importar de novo sem duplicar.',
      'Também aceita a planilha antiga (abas com "Nº Ticket", "Local", "Terceiro", "Peso Líq.", "Vlr TON").',
    ],
  },
  fretes: {
    colunas: [
      ['Nº carga', 'texto', 9], ['Data', 'data', 12], ['Cliente', 'texto', 22], ['Destino', 'texto', 18], ['Toneladas', 'decimal', 12],
      ['Valor ton', 'moeda', 12], ['Total', 'moeda', 14], ['Situação', 'texto', 11], ['Observações', 'texto', 26],
    ],
    exemplos: [
      ['1', '2026-01-12', 'BUTI', 'Balneário', 45.37, null, 8635, 'Pago', 'valor fechado'],
      ['2', '2026-01-16', 'BUTI', 'Balneário', 46.57, 120, 5588.4, 'Pago', ''],
      ['3', '2026-01-21', 'BUTI', 'JP', 48.57, 60, 2914.2, '', 'frete pago pelo Jair PH'],
    ],
    dicas: [
      'Obrigatórios: Data, Cliente e Toneladas.',
      'Valor ton preenchido: cobrança por tonelada. Só o Total: valor fechado. Sem nenhum dos dois: entra com R$ 0,00.',
      'Cliente "BUTI/BALNEARIO" é lido como cliente BUTI, destino Balneário.',
      'Situação "Pago" marca o frete como recebido (na data do frete). Vazio: Pendente.',
      'O nº da carga é dado pelo sistema. Fretes com mesma data, cliente e toneladas são ignorados: pode importar de novo sem duplicar.',
      'Também aceita a aba FRETES da planilha antiga, inclusive os blocos lado a lado e a coluna "PAGO".',
    ],
  },
  clientes: {
    colunas: [['Nome', 'texto', 26], ['Razão social', 'texto', 30], ['CPF/CNPJ', 'texto', 20], ['Telefone', 'texto', 16], ['E-mail', 'texto', 24], ['Cidade', 'texto', 16], ['UF', 'texto', 6], ['Observações', 'texto', 26]],
    exemplos: [['PAU BRASIL', 'Pau Brasil Madeiras Ltda.', '11.222.333/0001-81', '(49) 3222-1111', 'compras@paubrasil.com.br', 'Lages', 'SC', '']],
    dicas: ['Obrigatório: Nome. CPF/CNPJ e telefone são conferidos (dígitos e DDD).', 'Nomes que já existem são ignorados.'],
  },
  florestas: {
    colunas: [['Nome', 'texto', 24], ['Proprietário', 'texto', 24], ['Município', 'texto', 18], ['UF', 'texto', 6], ['Observações', 'texto', 30]],
    exemplos: [['GRAZZIOTIN', 'Mário Grazziotin', 'Bocaina do Sul', 'SC', '']],
    dicas: ['Obrigatório: Nome. Nomes que já existem são ignorados.'],
  },
  empreiteiros: {
    colunas: [['Nome', 'texto', 24], ['CPF/CNPJ', 'texto', 20], ['Telefone', 'texto', 16], ['Observações', 'texto', 30]],
    exemplos: [['CABEÇOTE', '529.982.247-25', '(49) 99999-0000', '']],
    dicas: ['Obrigatório: Nome. CPF/CNPJ e telefone são conferidos (dígitos e DDD).', 'Nomes que já existem são ignorados.'],
  },
};

router.get('/modelo', [q('tipo').isIn(TIPOS).withMessage('Escolha o modelo.')], validar, (req, res) => {
  const m = MODELOS[req.query.tipo];
  const pasta = novaPasta();
  pasta.aba(req.query.tipo[0].toUpperCase() + req.query.tipo.slice(1), {
    colunas: m.colunas.map(([titulo, formato, largura], i) => ({ titulo, formato, largura, valor: (l) => l[i] })),
    linhas: m.exemplos,
  });
  pasta.aba('Como preencher', {
    titulo: `Modelo de importação — ${req.query.tipo}`,
    subtitulo: 'Xylo · apague as linhas de exemplo e preencha com os seus dados',
    colunas: [{ titulo: 'Dica', largura: 110, valor: (l) => l }],
    linhas: m.dicas,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modelo-${req.query.tipo}.xlsx"`);
  res.send(pasta.gerar());
});

module.exports = router;
