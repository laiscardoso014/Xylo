// =====================================================================
// CONFERE SE O BANCO ESTÁ ATUALIZADO (roda quando o servidor inicia)
//
// Cada versão nova do Xylo pode precisar de uma migração (arquivo .sql em
// database/). Se alguma não foi rodada, o servidor avisa no console QUAL
// arquivo falta e o comando exato - e as telas mostram "banco
// desatualizado" em vez de um "erro interno" sem explicação.
// =====================================================================
const { query } = require('./db');

// Em ordem: o que cada migração cria (basta conferir uma marca de cada)
const MIGRACOES = [
  { arquivo: 'migracao_painel_dev.sql', tabela: 'desenvolvedores', coluna: null },
  { arquivo: 'migracao_painel_dev.sql', tabela: 'usuarios', coluna: 'deve_trocar_senha' },
  { arquivo: 'migracao_fretes.sql', tabela: 'fretes', coluna: 'valor_fechado' },
  { arquivo: 'migracao_despesas.sql', tabela: 'despesas', coluna: 'data_pagamento' },
  { arquivo: 'migracao_perfil.sql', tabela: 'empresas', coluna: 'logo' },
  { arquivo: 'migracao_perfil.sql', tabela: 'usuarios', coluna: 'telefone' },
  { arquivo: 'migracao_lixeira.sql', tabela: 'despesas', coluna: 'criado_por' },
  { arquivo: 'migracao_lixeira.sql', tabela: 'lixeira', coluna: null },
  { arquivo: 'migracao_lixeira.sql', tabela: 'auditoria', coluna: 'detalhe' },
  { arquivo: 'migracao_folha.sql', tabela: 'rotas', coluna: null },
  { arquivo: 'migracao_folha.sql', tabela: 'adiantamentos', coluna: null },
  { arquivo: 'migracao_folha.sql', tabela: 'folhas', coluna: 'status' },
  { arquivo: 'migracao_folha.sql', tabela: 'fretes', coluna: 'motorista_id' },
  { arquivo: 'migracao_email.sql', tabela: 'usuarios', coluna: 'email_confirmado_em' },
  { arquivo: 'migracao_email.sql', tabela: 'tokens_conta', coluna: null },
  { arquivo: 'migracao_faturas.sql', tabela: 'faturas', coluna: null },
  { arquivo: 'migracao_faturas.sql', tabela: 'empresas', coluna: 'mensalidade' },
  { arquivo: 'migracao_precos_por_viagem.sql', funcao: 'fn_viagem_preparar', sem: 'fn_buscar_preco' },
  { arquivo: 'migracao_dre.sql', tabela: 'categorias_despesa', coluna: 'grupo_dre' },
  { arquivo: 'migracao_dre.sql', tabela: 'empresas', coluna: 'aliquota_receita' },
  { arquivo: 'migracao_placa_motorista.sql', tabela: 'motoristas', coluna: 'placa' },
  { arquivo: 'migracao_placas_historico.sql', tabela: 'motorista_placas', coluna: null },
  { arquivo: 'migracao_dev_equipe.sql', tabela: 'dev_historico', coluna: null },
];

let pendentes = []; // arquivos que faltam rodar (usado na mensagem de erro das telas)

async function conferirBanco() {
  try {
    const { rows } = await query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`);
    const existe = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const tabelas = new Set(rows.map((r) => r.table_name));
    // migrações que só trocam uma função: confere o texto da função no banco
    const funcoes = new Map((await query(
      `SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema()`)).rows.map((r) => [r.proname, r.prosrc]));
    const falta = (m) => {
      if (m.funcao) return !funcoes.has(m.funcao) || funcoes.get(m.funcao).includes(m.sem);
      return m.coluna ? !existe.has(`${m.tabela}.${m.coluna}`) : !tabelas.has(m.tabela);
    };
    pendentes = [...new Set(MIGRACOES.filter(falta).map((m) => m.arquivo))];
    if (pendentes.length) {
      const linha = '='.repeat(72);
      console.warn(`\n${linha}\n ⚠  BANCO DE DADOS DESATUALIZADO - algumas telas vão dar erro.\n`
        + ' Rode, NESTA ORDEM, dentro da pasta backend:\n\n'
        + pendentes.map((a) => `   & "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -U postgres -d db_woodcontrol -f database/${a}`).join('\n')
        + `\n\n Depois reinicie o servidor (as migrações não apagam nada e podem rodar de novo).\n${linha}\n`);
    } else {
      console.log('✔ Banco de dados atualizado.');
    }
  } catch (err) {
    console.error('Não consegui conferir o banco de dados:', err.message);
  }
  return pendentes;
}

const migracoesPendentes = () => pendentes;

module.exports = { conferirBanco, migracoesPendentes };
