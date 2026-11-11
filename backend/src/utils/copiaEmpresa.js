// =====================================================================
// CÓPIA COMPLETA DE UMA EMPRESA (para excluir pelo painel e poder restaurar)
//
// fotografar(): lê TODOS os dados da empresa: as tabelas com empresa_id e as
//   que pertencem a elas sem ter empresa_id (ex.: viagem_empreiteiros,
//   adiantamento_parcelas). O PostgreSQL gera o JSON como texto, então números
//   e datas voltam idênticos.
// restaurar(): devolve tudo com os mesmos ids, na ordem das chaves estrangeiras,
//   com os gatilhos desligados (não recria as categorias padrão, não recalcula
//   viagens e não gera histórico falso).
// Os links de convite/senha (tokens_conta) não entram: o admin pede um novo.
// =====================================================================
const id = (n) => `"${String(n).replace(/"/g, '""')}"`;
const FORA = new Set(['solicitacoes_acesso', 'tokens_conta', 'empresas']);

async function tabelasDaEmpresa(c) {
  const { rows: comEmpresa } = await c.query(
    `SELECT col.table_name AS t FROM information_schema.columns col
       JOIN information_schema.tables tb ON tb.table_name = col.table_name AND tb.table_schema = col.table_schema
      WHERE col.table_schema = current_schema() AND col.column_name = 'empresa_id' AND tb.table_type = 'BASE TABLE'`);
  const donas = new Set(comEmpresa.map((r) => r.t).filter((t) => !FORA.has(t)));
  const { rows: fks } = await c.query(
    `SELECT c.conrelid::regclass::text AS filha, c.confrelid::regclass::text AS mae, a.attname AS coluna
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.conrelid <> c.confrelid`);
  const limpa = (n) => n.replace(/^.*\./, '').replace(/"/g, '');
  // tabelas sem empresa_id que pendem de uma tabela da empresa (um nível basta no Xylo)
  const filhas = new Map();
  for (const f of fks) {
    const filha = limpa(f.filha); const mae = limpa(f.mae);
    if (!donas.has(filha) && !FORA.has(filha) && donas.has(mae) && !filhas.has(filha)) filhas.set(filha, { mae, coluna: f.coluna });
  }
  const todas = [...donas, ...filhas.keys()];
  // ordem: mães antes das filhas
  const maes = new Map(todas.map((t) => [t, new Set()]));
  for (const f of fks) {
    const filha = limpa(f.filha); const mae = limpa(f.mae);
    if (maes.has(filha) && maes.has(mae)) maes.get(filha).add(mae);
  }
  const ordem = []; const visto = new Set();
  const visitar = (t) => { if (visto.has(t)) return; visto.add(t); for (const m of maes.get(t)) visitar(m); ordem.push(t); };
  todas.sort().forEach(visitar);
  return { ordem, donas, filhas };
}

async function fotografar(c, empresaId) {
  const { ordem, donas, filhas } = await tabelasDaEmpresa(c);
  const empresa = (await c.query('SELECT row_to_json(e)::text AS j FROM empresas e WHERE id = $1', [empresaId])).rows[0];
  const tabelas = {}; const contagem = {};
  for (const t of ordem) {
    const onde = donas.has(t)
      ? 'x.empresa_id = $1'
      : `x.${id(filhas.get(t).coluna)} IN (SELECT id FROM ${id(filhas.get(t).mae)} WHERE empresa_id = $1)`;
    const { rows } = await c.query(`SELECT COALESCE(json_agg(x), '[]')::text AS j, count(*)::int AS n FROM ${id(t)} x WHERE ${onde}`, [empresaId]);
    if (rows[0].n) { tabelas[t] = rows[0].j; contagem[t] = rows[0].n; }
  }
  const solicitacoes = (await c.query('SELECT id FROM solicitacoes_acesso WHERE empresa_id = $1', [empresaId])).rows.map((r) => r.id);
  return { formato: 1, empresa: empresa.j, tabelas, contagem, solicitacoes };
}

async function restaurar(c, foto) {
  const empresa = JSON.parse(foto.empresa);
  const jaTem = await c.query('SELECT nome FROM empresas WHERE cnpj = $1 OR id = $2', [empresa.cnpj, empresa.id]);
  if (jaTem.rowCount) {
    const e = new Error(`Já existe uma empresa com este CNPJ (${jaTem.rows[0].nome}). Exclua ou altere a outra antes de restaurar.`);
    e.status = 409; throw e;
  }
  const { ordem } = await tabelasDaEmpresa(c);
  const { rows: cols } = await c.query(
    `SELECT table_name, column_name, (is_generated = 'ALWAYS' OR identity_generation = 'ALWAYS') AS gerada
       FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY ordinal_position`);
  const colunas = (t, chaves) => cols.filter((x) => x.table_name === t && !x.gerada && chaves.has(x.column_name)).map((x) => id(x.column_name)).join(', ');

  const mexidas = ['empresas', ...ordem.filter((t) => foto.tabelas[t])];
  // (se der erro no meio, o ROLLBACK de quem chamou desfaz tudo, inclusive isto)
  for (const t of mexidas) await c.query(`ALTER TABLE ${id(t)} DISABLE TRIGGER USER`);
  const lista = colunas('empresas', new Set(Object.keys(empresa)));
  await c.query(`INSERT INTO empresas (${lista}) SELECT ${lista} FROM json_populate_record(NULL::empresas, $1::json)`, [foto.empresa]);
  for (const t of ordem) {
    const json = foto.tabelas[t];
    if (!json) continue;
    const { rows } = await c.query('SELECT DISTINCT json_object_keys(e) AS k FROM json_array_elements($1::json) e', [json]);
    const l = colunas(t, new Set(rows.map((r) => r.k)));
    await c.query(`INSERT INTO ${id(t)} (${l}) SELECT ${l} FROM json_populate_recordset(NULL::${id(t)}, $1::json)`, [json]);
  }
  for (const t of mexidas) await c.query(`ALTER TABLE ${id(t)} ENABLE TRIGGER USER`);
  if (foto.solicitacoes?.length) {
    await c.query('UPDATE solicitacoes_acesso SET empresa_id = $1 WHERE id = ANY($2::int[]) AND empresa_id IS NULL', [empresa.id, foto.solicitacoes]);
  }
  return empresa;
}

module.exports = { fotografar, restaurar };
