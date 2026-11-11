// =====================================================================
// REGIMES TRIBUTÁRIOS E IMPOSTOS SUGERIDOS PARA A DRE
//
// O regime vem do formulário de demonstração (página de vendas) e é copiado
// para a empresa quando o desenvolvedor aprova a solicitação. A DRE já começa
// com os impostos típicos daquele regime; o contador confere e ajusta em
// Relatórios › DRE › Configurar (quando ele salva, deixa de ser "sugestão").
//
// Valores (sobre a receita bruta, sem créditos nem ICMS do estado):
//   MEI ......... DAS mensal fixo: lance como despesa (categoria de impostos)
//   Simples ..... 6%   alíquota inicial; a efetiva depende do anexo e da faixa (PGDAS)
//   Presumido ... 3,65% PIS (0,65) + COFINS (3)
//                 2,28% IRPJ 15% x 8% + CSLL 9% x 12% (presunção de comércio e de
//                       transporte de cargas), sobre a receita
//   Real ........ 9,25% PIS (1,65) + COFINS (7,6) não cumulativos, antes dos créditos
//                 24%   IRPJ 15% + CSLL 9% sobre o lucro (+10% de adicional do IRPJ
//                       na parte do lucro acima de R$ 20 mil por mês)
// Os mesmos números estão em database/migracao_regime_empresa.sql.
// =====================================================================
const REGIMES = { mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real', outro: 'Outro' };

const SUGESTOES = {
  mei: {
    aliquota_receita: 0, aliquota_ir_csll: 0, base_ir_csll: 'receita',
    nota: 'O MEI paga um DAS fixo por mês: lance-o em Despesas, numa categoria de impostos.',
  },
  simples: {
    aliquota_receita: 6, aliquota_ir_csll: 0, base_ir_csll: 'receita',
    nota: 'Alíquota inicial do Simples. A efetiva depende do anexo e do faturamento dos últimos 12 meses (está no PGDAS). IRPJ e CSLL já estão no DAS.',
  },
  presumido: {
    aliquota_receita: 3.65, aliquota_ir_csll: 2.28, base_ir_csll: 'receita',
    nota: 'PIS 0,65% + COFINS 3%; IRPJ e CSLL pela presunção de 8% e 12% da receita. Não inclui o ICMS: some a alíquota do seu estado, se houver.',
  },
  real: {
    aliquota_receita: 9.25, aliquota_ir_csll: 24, base_ir_csll: 'lucro',
    nota: 'PIS 1,65% + COFINS 7,6% antes dos créditos; IRPJ 15% + CSLL 9% sobre o lucro (mais 10% na parte do lucro acima de R$ 20 mil/mês). Não inclui o ICMS.',
  },
};

// Texto gravado na solicitação ("Simples Nacional") -> código da empresa ("simples")
const PELO_NOME = { MEI: 'mei', 'Simples Nacional': 'simples', 'Lucro Presumido': 'presumido', 'Lucro Real': 'real' };
function regimeDoTexto(texto) {
  if (!texto) return null;
  if (REGIMES[texto]) return texto;          // já é o código
  return PELO_NOME[String(texto).trim()] || null; // "Outro / Não sei informar" fica sem regime
}

// Dados fiscais iniciais de uma empresa nova
function fiscalInicial(regime) {
  const s = SUGESTOES[regime];
  if (!s) return { regime_tributario: regime || null, aliquota_receita: 0, aliquota_ir_csll: 0, base_ir_csll: 'lucro', fiscal_sugerido: false };
  return { regime_tributario: regime, aliquota_receita: s.aliquota_receita, aliquota_ir_csll: s.aliquota_ir_csll, base_ir_csll: s.base_ir_csll, fiscal_sugerido: true };
}

module.exports = { REGIMES, SUGESTOES, regimeDoTexto, fiscalInicial };
