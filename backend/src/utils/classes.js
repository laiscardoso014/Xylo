// =====================================================================
// CLASSE DE MADEIRA PELO TEXTO (ticket da balança e planilha importada)
//
// Cada classe tem o nome ("Grossa") e, opcional, os nomes que aparecem
// no ticket ("PINUS GROSSO, TORA G, G32+"), cadastrados em Classes de madeira.
// Ordem da busca (a primeira que achar vale):
//   1) o texto é exatamente um dos nomes            "GROSSA"
//   2) o NOME MAIS ESPECÍFICO que aparece no texto  "PINUS FINA ESPECIAL" -> "Fina Especial",
//      e não "Fina" (por isso as classes criadas pela empresa não perdem para as padrão)
//   3) palavras-chave das classes padrão            "PINUS GROSSO" -> Grossa, "EUC" -> Eucalipto
//   4) nome grudado num número ou na espécie       "FINA220", "LIXOPINUS" -> Lixo
// =====================================================================
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const limpar = (s) => norm(s).replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim();

function nomesDa(classe) {
  return [classe.nome, ...String(classe.nomes_ticket || '').split(/[,;\n]/)].map(limpar).filter(Boolean);
}

// palavra inteira do texto: fina/fino/finas/finos, grossa/grosso, média/médio, "euc"...
// ("final" ou "agrossilvo" não contam)
const CHAVES = [[/^lixos?$/, 'lixo'], [/^eucal/, 'eucalipto'], [/^euc$/, 'eucalipto'], [/^gross[ao]s?$/, 'grossa'], [/^medi[ao]s?$/, 'media'], [/^fin[ao]s?$/, 'fina']];

function acharClasse(texto, classes) {
  const n = limpar(texto);
  if (!n || !classes || !classes.length) return null;
  const lista = classes.map((c) => ({ c, nomes: nomesDa(c) }));

  for (const { c, nomes } of lista) if (nomes.includes(n)) return c; // 1

  let melhor = null; let tamanho = 0; // 2
  for (const { c, nomes } of lista) {
    for (const nome of nomes) {
      if (nome.length > tamanho && ` ${n} `.includes(` ${nome} `)) { melhor = c; tamanho = nome.length; }
    }
  }
  if (melhor) return melhor;

  const palavras = n.split(' '); // 3
  for (const [regra, nome] of CHAVES) {
    if (palavras.some((p) => regra.test(p))) {
      const c = classes.find((x) => limpar(x.nome) === nome);
      if (c) return c;
    }
  }

  // 4) nome grudado num número ou na espécie: "FINA220", "LIXOPINUS" (mas não "FINAL")
  const resto = /^(\d.*|pinus|pinu|eucalipto|euc)$/;
  for (const { c, nomes } of lista) {
    for (const nome of nomes) {
      if (nome.includes(' ') || nome.length < 3 || nome.length <= tamanho) continue;
      if (palavras.some((p) => p.startsWith(nome) && resto.test(p.slice(nome.length)))) { melhor = c; tamanho = nome.length; }
    }
  }
  return melhor;
}

// Classes da empresa (com os nomes do ticket). Funciona mesmo antes de rodar a
// migracao_classes_ticket.sql (aí vem sem os nomes do ticket).
async function classesDaEmpresa(executar, empresaId, { soAtivas = true } = {}) {
  const filtro = soAtivas ? 'AND ativo' : '';
  try {
    const { rows } = await executar(`SELECT id, nome, nomes_ticket FROM classes_madeira WHERE empresa_id = $1 ${filtro}`, [empresaId]);
    return rows;
  } catch (err) {
    if (err.code !== '42703') throw err;
    const { rows } = await executar(`SELECT id, nome FROM classes_madeira WHERE empresa_id = $1 ${filtro}`, [empresaId]);
    return rows;
  }
}

module.exports = { acharClasse, classesDaEmpresa, nomesDa };
