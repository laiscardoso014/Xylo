// =====================================================================
// Validação de CPF, CNPJ e telefone (a mesma regra do comum.js no navegador)
//
//   cpfValido('529.982.247-25')      -> true   (confere os 2 dígitos verificadores)
//   cnpjValido('11.222.333/0001-81') -> true
//   documentoValido(v)               -> CPF (11 números) ou CNPJ (14 números)
//   telefoneValido('(49) 99999-0000')-> true   (DDD existente; celular começa com 9)
//
// Sequências repetidas (111.111.111-11, 00.000.000/0000-00) passam na conta
// dos dígitos, mas não são documentos reais: são recusadas.
// =====================================================================
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

function cpfValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const digito = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(c[9]) && digito(10) === Number(c[10]);
}

function cnpjValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const digito = (n) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(c[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(c[12]) && digito(13) === Number(c[13]);
}

const documentoValido = (valor) => {
  const n = soDigitos(valor).length;
  return n === 11 ? cpfValido(valor) : n === 14 ? cnpjValido(valor) : false;
};

// DDDs que existem no Brasil (Anatel)
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

// Celular: DDD + 9 + 8 números (11 no total). Fixo: DDD + 2 a 5 + 7 números (10 no total).
function telefoneValido(valor) {
  const t = soDigitos(valor);
  if (!DDDS.has(Number(t.slice(0, 2)))) return false;
  if (t.length === 11) return t[2] === '9';
  if (t.length === 10) return /[2-5]/.test(t[2]);
  return false;
}

// Mensagens prontas para os validadores das rotas
const MSG = {
  documento: 'CPF ou CNPJ inválido. Confira os números (o CPF tem 11 e o CNPJ, 14).',
  cnpj: 'CNPJ inválido. Confira os 14 números.',
  telefone: 'Telefone inválido. Use DDD + número: (49) 99999-9999 para celular ou (49) 3222-2222 para fixo.',
};

module.exports = { soDigitos, cpfValido, cnpjValido, documentoValido, telefoneValido, MSG };
