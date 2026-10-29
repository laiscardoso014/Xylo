// =====================================================================
// FORMATAÇÃO do histórico e da lixeira
//
// O banco guarda os dados como estão nas tabelas (cliente_id: 7,
// peso_liquido: 43.03, data: "2026-10-26"). Aqui isso vira texto para
// gente ler: "Cliente: POMESUL", "Peso líquido: 43,03 t", "26/10/2026".
// =====================================================================
const { query } = require('../config/db');

// Nome de cada tabela na tela
const TABELAS = {
  viagens: { nome: 'Viagem', plural: 'Viagens', rota: 'viagens' },
  fretes: { nome: 'Frete', plural: 'Fretes', rota: 'fretes' },
  despesas: { nome: 'Despesa', plural: 'Despesas', rota: 'despesas' },
  tabelas_precos: { nome: 'Preço', plural: 'Tabela de preços', rota: 'precos' },
  clientes: { nome: 'Cliente', plural: 'Clientes', rota: 'clientes' },
  florestas: { nome: 'Floresta', plural: 'Florestas', rota: 'florestas' },
  empreiteiros: { nome: 'Empreiteiro', plural: 'Empreiteiros', rota: 'empreiteiros' },
  usuarios: { nome: 'Usuário', plural: 'Usuários', rota: 'usuarios' },
  categorias_despesa: { nome: 'Categoria de despesa', plural: 'Categorias de despesa', rota: 'despesas' },
  empresas: { nome: 'Empresa', plural: 'Dados da empresa', rota: 'empresa' },
  funcionarios: { nome: 'Funcionário', plural: 'Funcionários', rota: 'funcionarios' },
  folhas: { nome: 'Folha', plural: 'Folha de pagamento', rota: 'folha' },
  adiantamentos: { nome: 'Adiantamento', plural: 'Adiantamentos', rota: 'folha' },
  rotas: { nome: 'Rota', plural: 'Rotas e distâncias', rota: 'rotas' },
  comissao_faixas: { nome: 'Faixa de comissão', plural: 'Faixas de comissão', rota: 'funcionarios' },
};

// Rótulo de cada campo (o que não está aqui não aparece)
const CAMPOS = {
  numero_viagem: 'Nº da viagem', numero_carga: 'Nº da carga', data: 'Data', ticket: 'Ticket', placa: 'Placa',
  cliente_id: 'Cliente', floresta_id: 'Floresta', empreiteiro_id: 'Empreiteiro', classe_id: 'Classe',
  motorista_id: 'Motorista', categoria_id: 'Categoria', perfil_id: 'Perfil',
  hora_pesagem: 'Horário da pesagem', peso_liquido: 'Peso líquido', volume_m3: 'Volume (m³)', toneladas: 'Toneladas',
  valor_tonelada: 'Valor R$/t', valor_total: 'Valor total', valor_fechado: 'Valor fechado', valor: 'Valor',
  valor_ton_floresta: 'Floresta R$/t', total_floresta: 'Total floresta',
  valor_ton_empreiteiro: 'Empreiteiro R$/t', total_empreiteiro: 'Total empreiteiro',
  status: 'Situação', status_pagamento: 'Pagamento', forma_pagamento: 'Forma de pagamento', data_pagamento: 'Pago em',
  destino: 'Destino', descricao: 'Descrição', favorecido: 'Favorecido',
  tipo: 'Tipo de preço', data_inicio: 'Vigente desde', data_fim: 'Vigente até', observacao: 'Observação', observacoes: 'Observações',
  nome: 'Nome', razao_social: 'Razão social', cpf_cnpj: 'CPF/CNPJ', cnpj: 'CNPJ', telefone: 'Telefone', email: 'E-mail',
  cidade: 'Cidade', estado: 'UF', uf: 'UF', municipio: 'Município', proprietario: 'Proprietário', endereco: 'Endereço',
  ativo: 'Ativo', deve_trocar_senha: 'Senha provisória', senha: 'Senha', logo: 'Logo',
  cargo: 'Cargo', cpf: 'CPF', data_admissao: 'Admissão', salario_base: 'Salário base', alimentacao: 'Alimentação',
  competencia: 'Competência', comissao: 'Comissão', extras: 'Extras', adiantamento: 'Adiantamento', desconto: 'Desconto',
  saldo_pagar: 'Saldo a pagar', comissao_manual: 'Comissão digitada à mão', funcionario_id: 'Funcionário',
  parcelas: 'Parcelas', km: 'Distância', km_ate: 'Até (km)',
};
const DINHEIRO = new Set(['valor_tonelada', 'valor_total', 'valor_fechado', 'valor', 'valor_ton_floresta', 'total_floresta', 'valor_ton_empreiteiro', 'total_empreiteiro',
  'salario_base', 'alimentacao', 'comissao', 'extras', 'adiantamento', 'desconto', 'saldo_pagar']);
const PESO = new Set(['peso_liquido', 'toneladas']);
const REFERENCIAS = {
  cliente_id: 'clientes', floresta_id: 'florestas', empreiteiro_id: 'empreiteiros', classe_id: 'classes',
  motorista_id: 'motoristas', categoria_id: 'categorias', perfil_id: 'perfis', funcionario_id: 'funcionarios',
};
const TIPO_PRECO = { VENDA: 'Venda (cliente)', COMPRA: 'Compra (floresta)', EMPREITADA: 'Empreitada' };

const numeroBR = (n, casas = 2) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dinheiro = (n) => `R$ ${numeroBR(n)}`;
const dataBR = (s) => {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
};

// Nomes de tudo que é referenciado por id, da empresa (uma consulta por tipo)
async function carregarNomes(empresaId) {
  const lista = async (sql) => new Map((await query(sql, [empresaId])).rows.map((r) => [r.id, r.nome]));
  const [clientes, florestas, empreiteiros, classes, motoristas, categorias, usuarios, perfis] = await Promise.all([
    lista('SELECT id, nome FROM clientes WHERE empresa_id = $1'),
    lista('SELECT id, nome FROM florestas WHERE empresa_id = $1'),
    lista('SELECT id, nome FROM empreiteiros WHERE empresa_id = $1'),
    lista('SELECT id, nome FROM classes_madeira WHERE empresa_id = $1'),
    lista('SELECT id, nome FROM motoristas WHERE empresa_id = $1'),
    lista('SELECT id, nome FROM categorias_despesa WHERE empresa_id = $1'),
    lista('SELECT id, nome FROM usuarios WHERE empresa_id = $1'),
    query('SELECT id, nome FROM perfis').then((r) => new Map(r.rows.map((x) => [x.id, x.nome]))),
  ]);
  const funcionarios = await lista('SELECT id, nome FROM funcionarios WHERE empresa_id = $1').catch(() => new Map());
  return { clientes, florestas, empreiteiros, classes, motoristas, categorias, usuarios, perfis, funcionarios };
}

// Um valor de um campo, pronto para a tela
function valorTexto(campo, valor, nomes) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (REFERENCIAS[campo]) return nomes[REFERENCIAS[campo]].get(Number(valor)) || `nº ${valor}`;
  if (DINHEIRO.has(campo)) return dinheiro(valor);
  if (PESO.has(campo)) return `${numeroBR(valor)} t`;
  if (campo === 'volume_m3') return `${numeroBR(valor)} m³`;
  if (campo === 'km' || campo === 'km_ate') return `${numeroBR(valor, 1)} km`;
  if (campo === 'competencia') return `${String(valor).slice(5, 7)}/${String(valor).slice(0, 4)}`;
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (campo === 'tipo') return TIPO_PRECO[valor] || valor;
  if (campo === 'hora_pesagem') return String(valor).slice(0, 5);
  if (/^data/.test(campo)) return dataBR(valor);
  return String(valor);
}

// Lista "Campo: valor" de um registro inteiro (inclusão / lixeira)
function campos(dados, nomes) {
  return Object.keys(CAMPOS)
    .filter((c) => dados && Object.prototype.hasOwnProperty.call(dados, c) && dados[c] !== null && dados[c] !== '')
    .map((c) => ({ campo: CAMPOS[c], valor: valorTexto(c, dados[c], nomes) }));
}

// Lista "Campo: de -> para" de uma alteração
function mudancas(antes, depois, nomes) {
  // na ordem natural dos campos (peso antes do valor total etc.)
  const chaves = Object.keys(CAMPOS).filter((c) => depois && Object.prototype.hasOwnProperty.call(depois, c));
  return chaves.map((c) => ({
    campo: CAMPOS[c],
    de: c === 'senha' || c === 'logo' ? '' : valorTexto(c, antes ? antes[c] : null, nomes),
    para: c === 'senha' || c === 'logo' ? 'alterada' : valorTexto(c, depois[c], nomes),
  }));
}

// Uma linha que identifica o registro: "Viagem nº 12 · 26/10/2026 · POMESUL · 43,03 t"
function resumo(tabela, d, nomes) {
  if (!d) return TABELAS[tabela]?.nome || tabela;
  const n = (campo) => valorTexto(campo, d[campo], nomes);
  const partes = {
    viagens: () => [`Viagem nº ${d.numero_viagem}`, n('data'), n('cliente_id'), n('floresta_id'), n('peso_liquido'), d.ticket ? `ticket ${d.ticket}` : null],
    fretes: () => [`Frete carga ${d.numero_carga}`, n('data'), n('cliente_id'), n('toneladas'), d.destino],
    despesas: () => [`Despesa`, n('data'), n('categoria_id'), d.descricao, n('valor')],
    tabelas_precos: () => [`Preço de ${(TIPO_PRECO[d.tipo] || d.tipo || '').toLowerCase()}`,
      n(d.cliente_id ? 'cliente_id' : d.floresta_id ? 'floresta_id' : 'empreiteiro_id'), n('classe_id'),
      `${n('valor_tonelada')}/t desde ${n('data_inicio')}`],
    usuarios: () => [`Usuário ${d.nome || ''}`.trim(), d.email],
    funcionarios: () => [`Funcionário ${d.nome || ''}`.trim(), d.cargo],
    folhas: () => [`Folha ${valorTexto('competencia', d.competencia, nomes)}`, n('funcionario_id')],
    adiantamentos: () => ['Adiantamento', n('funcionario_id'), n('valor'), d.parcelas > 1 ? `${d.parcelas}x` : null],
    rotas: () => [d.tipo === 'frete' ? `Rota de frete · ${n('cliente_id')}${d.destino ? ` → ${d.destino}` : ''}` : `Rota ${n('floresta_id')} → ${n('cliente_id')}`, d.km ? n('km') : null],
    comissao_faixas: () => ['Faixa de comissão', n('funcionario_id'), d.km_ate ? `até ${n('km_ate')}` : 'acima', `${n('valor_tonelada')}/t`],
    empresas: () => ['Dados da empresa'],
  }[tabela];
  const lista = partes ? partes() : [`${TABELAS[tabela]?.nome || tabela} ${d.nome || ''}`.trim()];
  return lista.filter((x) => x && x !== '—').join(' · ').slice(0, 300);
}

module.exports = { TABELAS, CAMPOS, carregarNomes, valorTexto, campos, mudancas, resumo, dinheiro, dataBR };
