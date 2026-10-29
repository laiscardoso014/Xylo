// =====================================================================
// PIX "COPIA E COLA" (BR Code) - padrão do Banco Central
//
// É um texto no formato EMV: cada campo = ID (2 dígitos) + TAMANHO
// (2 dígitos) + VALOR. O último campo (63) é um CRC16 que o app do banco
// confere. O mesmo texto vira o QR Code da fatura.
//
//   montarPix({ chave, nome, cidade, valor, txid, mensagem })
//
// Estático com valor: qualquer app de banco lê, já vem com o valor e o
// identificador (txid) da fatura. Não precisa de banco nem de API: o
// dinheiro cai direto na conta da chave PIX. A baixa é feita no painel.
// =====================================================================

// Campo EMV: id + tamanho + valor
function campo(id, valor) {
  const v = String(valor);
  if (v.length > 99) throw new Error(`Campo PIX ${id} grande demais.`);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
}

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido pelo BR Code
function crc16(texto) {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Nome e cidade: só letras sem acento (alguns bancos recusam acentos)
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ./-]/g, '').trim();

// ---------------------------------------------------------------------
// Chave PIX: confere e deixa no formato que o Banco Central pede
//   CPF/CNPJ: só números · telefone: +55DDDNUMERO · e-mail: minúsculo
//   aleatória: 8-4-4-4-12 (letras e números)
// -> { chave, tipo } ou lança Error com a explicação
// ---------------------------------------------------------------------
function normalizarChave(bruta) {
  const v = String(bruta || '').trim();
  if (!v) throw new Error('Informe a chave PIX.');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return { chave: v.toLowerCase(), tipo: 'Aleatória' };
  if (v.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 77) throw new Error('Chave PIX de e-mail inválida.');
    return { chave: v.toLowerCase(), tipo: 'E-mail' };
  }
  const digitos = v.replace(/\D/g, '');
  if (v.startsWith('+') || /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(v)) {
    const nac = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
    if (nac.length !== 10 && nac.length !== 11) throw new Error('Telefone da chave PIX inválido: use DDD + número.');
    return { chave: `+55${nac}`, tipo: 'Telefone' };
  }
  if (digitos.length === 11 && /^[\d.\-\s]+$/.test(v)) return { chave: digitos, tipo: 'CPF' };
  if (digitos.length === 14 && /^[\d./\-\s]+$/.test(v)) return { chave: digitos, tipo: 'CNPJ' };
  throw new Error('Chave PIX não reconhecida: use CPF, CNPJ, e-mail, telefone (+55...) ou a chave aleatória.');
}

// txid: só letras e números, até 25
const limparTxid = (t) => String(t || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

function montarPix({ chave, nome, cidade, valor, txid, mensagem }) {
  const { chave: k } = normalizarChave(chave);
  const nomeOk = semAcento(nome).slice(0, 25);
  const cidadeOk = semAcento(cidade).toUpperCase().slice(0, 15);
  if (!nomeOk) throw new Error('Informe o nome de quem recebe o PIX.');
  if (!cidadeOk) throw new Error('Informe a cidade de quem recebe o PIX.');
  // mensagem opcional: cabe só se o campo 26 ficar com até 99 caracteres
  let conta = campo('00', 'br.gov.bcb.pix') + campo('01', k);
  const msg = semAcento(mensagem).slice(0, Math.max(0, 99 - conta.length - 4));
  if (msg) conta += campo('02', msg);

  // (sem o campo 01: código estático, aceito por todos os bancos; o txid identifica a fatura)
  let texto = campo('00', '01')
    + campo('26', conta)
    + campo('52', '0000')
    + campo('53', '986'); // real
  if (valor !== undefined && valor !== null && Number(valor) > 0) texto += campo('54', Number(valor).toFixed(2));
  texto += campo('58', 'BR') + campo('59', nomeOk) + campo('60', cidadeOk) + campo('62', campo('05', limparTxid(txid)));
  texto += '6304';
  return texto + crc16(texto);
}

module.exports = { montarPix, normalizarChave, crc16, semAcento };
