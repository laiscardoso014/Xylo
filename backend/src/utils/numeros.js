// Lê números digitados no padrão brasileiro ou americano:
//   "46,79" -> 46.79     "1.234,56" -> 1234.56     "220.5" -> 220.5     220 -> 220
// Devolve NaN se não for um número.
function lerNumero(valor) {
  if (typeof valor === 'number') return valor;
  let texto = String(valor ?? '').trim();
  if (texto === '') return NaN;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(texto) ? Number(texto) : NaN;
}

// Regra para o express-validator: número >= mínimo
const numeroValido = (minimo = 0) => (v) => Number.isFinite(lerNumero(v)) && lerNumero(v) >= minimo;

module.exports = { lerNumero, numeroValido };
