// =====================================================================
// CONFERIR UM E-MAIL ANTES DE USAR
//
// Ninguém consegue saber com certeza se uma CAIXA de e-mail existe sem
// mandar uma mensagem (por isso a confirmação por link). Mas dá para pegar,
// na hora, os erros mais comuns:
//   1) formato inválido                      (ana@gmail, ana gmail.com)
//   2) domínio digitado errado               (gmial.com -> gmail.com, hotmail.con)
//   3) domínio que não recebe e-mail          (consulta DNS: registro MX)
// Se o DNS não responder (servidor sem internet), não bloqueia: só a
// confirmação por e-mail vai dizer.
// =====================================================================
const dns = require('dns').promises;

const FORMATO = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const COMUNS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'live.com', 'msn.com',
  'hotmail.com.br', 'outlook.com.br', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'protonmail.com'];

function distancia(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) m[i][j] = Math.min(m[i][j], m[i - 2][j - 2] + 1); // letras trocadas
    }
  }
  return m[a.length][b.length];
}

// Domínio parecido com um muito usado? (gmial.com, gmail.con, hotmial.com)
function sugestaoDeDominio(dominio) {
  if (COMUNS.includes(dominio)) return null;
  let melhor = null;
  let menor = 3;
  for (const c of COMUNS) {
    const d = distancia(dominio, c);
    if (d < menor) { menor = d; melhor = c; }
  }
  if (melhor && menor <= (dominio.length > 9 ? 2 : 1)) return melhor;
  // final errado: gmail.co, hotmail.cm, outlook.combr
  const m = dominio.match(/^(gmail|hotmail|outlook|yahoo|icloud|live)\.(co|cm|con|comm|om|cpm|vom|combr|com\.b|br)$/);
  return m ? `${m[1]}.com` : null;
}

const cache = new Map(); // dominio -> { recebe: true|false|null, ate }
const comPrazo = (promessa, ms) => Promise.race([promessa, new Promise((_, falha) => setTimeout(() => falha(Object.assign(new Error('tempo'), { code: 'ETIMEOUT' })), ms))]);

// true = recebe e-mail; false = domínio não existe / não recebe; null = não deu para saber
async function dominioRecebeEmail(dominio) {
  const guardado = cache.get(dominio);
  if (guardado && guardado.ate > Date.now()) return guardado.recebe;
  let recebe = null;
  try {
    const mx = await comPrazo(dns.resolveMx(dominio), 4000);
    recebe = mx.some((r) => r.exchange && r.exchange !== '.') ? true : false; // MX "." = "não recebo e-mail"
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      // sem MX: pela regra, o próprio domínio (registro A) pode receber
      try { recebe = (await comPrazo(dns.resolve4(dominio), 3000)).length > 0; } catch (e2) { recebe = e2.code === 'ENOTFOUND' || e2.code === 'ENODATA' ? false : null; }
    }
  }
  cache.set(dominio, { recebe, ate: Date.now() + (recebe === null ? 60e3 : 6 * 3600e3) });
  return recebe;
}

// O DNS deste servidor funciona? (sem internet, todo domínio pareceria inexistente)
async function dnsFunciona() {
  return (await dominioRecebeEmail('gmail.com')) === true;
}

// -> { ok, conferido, motivo?, sugestao? }
//    ok=false só quando há CERTEZA de problema (formato ou domínio inexistente)
async function conferirEmail(email) {
  const texto = String(email || '').trim().toLowerCase();
  if (!FORMATO.test(texto) || texto.length > 150) return { ok: false, conferido: true, motivo: 'Este e-mail não está num formato válido (ex.: nome@empresa.com.br).' };
  const dominio = texto.split('@')[1];
  const sugestao = sugestaoDeDominio(dominio);
  const recebe = await dominioRecebeEmail(dominio);
  if (recebe === false && await dnsFunciona()) {
    return {
      ok: false, conferido: true,
      motivo: `O domínio "${dominio}" não recebe e-mails.${sugestao ? ` Você quis dizer ${texto.split('@')[0]}@${sugestao}?` : ' Confira o que vem depois do @.'}`,
      sugestao: sugestao ? `${texto.split('@')[0]}@${sugestao}` : null,
    };
  }
  if (sugestao) {
    // domínio existe (ou não deu para conferir), mas é quase igual a um muito usado: só avisa
    return { ok: true, conferido: recebe !== null, aviso: `Confira: não seria ${texto.split('@')[0]}@${sugestao}?`, sugestao: `${texto.split('@')[0]}@${sugestao}` };
  }
  return { ok: true, conferido: recebe === true };
}

module.exports = { conferirEmail, sugestaoDeDominio, dominioRecebeEmail };
