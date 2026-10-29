// =====================================================================
// LEITOR DE TICKET DE PESAGEM
//
// Cada balança (serraria, cooperativa, posto) imprime o ticket de um jeito:
// muda a ordem, o nome dos campos ("Peso Líquido", "Liquido", "P. Liq."),
// a unidade (kg ou t) e o que aparece (uns trazem fazenda, outros não).
// Por isso o leitor NÃO depende de um modelo fixo. Ele trabalha em 3 passos:
//
//   1) EXTRAIR  - a IA (visão) lê a foto e devolve os campos como estão
//                 impressos; ou o texto colado é lido por rótulos (regex).
//   2) NORMALIZAR - converte para o formato do sistema: data AAAA-MM-DD,
//                 hora HH:MM, placa sem traço, peso em TONELADAS (kg / 1000),
//                 confere bruto - tara = líquido.
//   3) LIGAR AOS CADASTROS - acha cliente, floresta, empreiteiro e classe
//                 pelo nome; o que faltar vem da última viagem da mesma placa.
//                 Também avisa se o ticket já foi lançado.
//
// Só interessam os campos da planilha: Data, Nº Ticket, Motorista, Placa,
// Local (floresta), Terceiro (empreiteiro), Horário Pesagem, Classe, Peso Líq.
// O resto do ticket (CNPJ, endereço, telefone) é ignorado.
// =====================================================================
const { query } = require('../config/db');
const { motoristasCadastrados, AVISO_CADASTRO } = require('../utils/motoristas');
const { norm } = require('../importacao/importador');

// ---------------------------------------------------------------------
// Instrução para a IA (visão). Pede o texto como está impresso: a conversão
// é feita aqui no servidor, com regras que dá para testar.
// ---------------------------------------------------------------------
const INSTRUCAO = `Você recebe a FOTO de um ticket de pesagem de caminhão de madeira (toras) emitido por uma balança no Brasil.
Cada balança usa um modelo diferente: procure os dados pelo significado, não pela posição.
Responda SOMENTE com um objeto JSON, sem comentários, neste formato (use null quando o dado não estiver impresso):
{
  "legivel": true,
  "emissor": "nome da empresa dona da balança, no topo do ticket",
  "ticket": "número do ticket / pesagem / romaneio",
  "data": "data da pesagem como impressa (DD/MM/AAAA)",
  "hora": "hora da pesagem como impressa (HH:MM ou HH:MM:SS)",
  "placa": "placa do caminhão (cavalo), como impressa",
  "motorista": "nome do motorista",
  "entidade": "campo Entidade / Cliente / Fornecedor / Origem do cadastro, se houver",
  "local": "fazenda / floresta / talhão / procedência, se houver",
  "terceiro": "transportadora / empreiteiro / prestador, se houver",
  "produto": "produto (ex.: TORAS)",
  "tipo_produto": "tipo ou classe do produto (ex.: PINUS, EUCALIPTO, FINA, GROSSA)",
  "peso_bruto": "valor como impresso, com a unidade",
  "tara": "valor como impresso, com a unidade",
  "peso_liquido": "valor como impresso, com a unidade",
  "texto": "transcrição de todas as linhas legíveis do ticket, separadas por \\n"
}
Regras:
- Copie números e letras exatamente como estão; não calcule, não complete e não invente.
- Se houver duas datas/horas (entrada e saída), use as da ÚLTIMA pesagem.
- Placa brasileira tem 7 caracteres (ABC1234 ou ABC1D23); atenção a 0/O e 1/I.
- Se a foto estiver ilegível ou não for um ticket de pesagem, responda {"legivel": false}.`;

const CAMPOS_TEXTO = ['emissor', 'ticket', 'data', 'hora', 'placa', 'motorista', 'entidade', 'local', 'terceiro',
  'produto', 'tipo_produto', 'peso_bruto', 'tara', 'peso_liquido'];

// A resposta da IA pode vir com ```json, com raciocínio <think>…</think> ou com
// texto antes/depois. Pega o primeiro objeto JSON válido.
function extrairJSON(resposta) {
  let t = String(resposta || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const ini = t.indexOf('{');
  if (ini < 0) return null;
  // procura o fechamento que equilibra as chaves (ignorando as que estão dentro de strings)
  let nivel = 0; let emString = false; let escape = false;
  for (let i = ini; i < t.length; i++) {
    const c = t[i];
    if (emString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === '{') nivel++;
    else if (c === '}' && --nivel === 0) {
      try { return JSON.parse(t.slice(ini, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// LEITURA POR RÓTULOS (texto colado, ou para completar o que a IA não trouxe)
// Funciona com "Ticket: 36627", "PESO LÍQUIDO: 43030.0 kg", "Placa MMB2I30"...
// ---------------------------------------------------------------------
const ROTULOS = {
  ticket: /\b(?:ticket|t[ií]quete|n[ºo°]?\s*(?:da\s*)?pesagem|pesagem\s*n[ºo°]?|romaneio|n[ºo°]\s*ticket)\s*[:.#nº°-]*\s*([A-Z]{0,3}-?\d[\d./-]{0,19})/i,
  placa: /\bplaca(?:\s*(?:cavalo|ve[ií]culo|caminh[aã]o))?\s*[:.-]?\s*([A-Z0-9]{3}\s*-?\s*[A-Z0-9]{4})\b/i,
  motorista: /\bmotorista\s*[:.-]?\s*([^\n:]{2,60}?)\s*(?:$|\n|\b(?:placa|cpf|cnh|entidade|produto)\b)/im,
  entidade: /\b(?:entidade|fornecedor|cliente|origem)\s*[:.-]\s*([^\n]{2,80})/i,
  local: /\b(?:fazenda|floresta|procedência|procedencia|talh[aã]o|local)\s*[:.-]\s*([^\n]{2,80})/i,
  terceiro: /\b(?:transportadora|transportador|empreiteiro|terceiro|prestador)\s*[:.-]\s*([^\n]{2,80})/i,
  tipo_produto: /\btipo\s*(?:de\s*)?produto\s*[:.-]?\s*([^\n]{2,60})/i,
  produto: /\bproduto\s*[:.-]\s*([^\n]{2,60})/i,
  peso_liquido: /\b(?:peso\s*)?l[ií]q(?:uido)?\.?\s*[:.-]?\s*([\d.,]+\s*(?:kg|t|ton)?)/i,
  peso_bruto: /\b(?:peso\s*)?bruto\s*[:.-]?\s*([\d.,]+\s*(?:kg|t|ton)?)/i,
  tara: /\b(?:peso\s*)?tara\s*[:.-]?\s*([\d.,]+\s*(?:kg|t|ton)?)/i,
};

function lerPorRotulos(texto) {
  const t = String(texto || '').replace(/\r/g, '');
  const r = {};
  for (const [campo, re] of Object.entries(ROTULOS)) {
    const m = t.match(re);
    if (m) r[campo] = m[1].trim();
  }
  // Data e hora: a última que aparecer (última pesagem)
  const datas = [...t.matchAll(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})(?:\s+(?:às\s+)?(\d{1,2}:\d{2}(?::\d{2})?))?/g)];
  if (datas.length) {
    const ult = datas[datas.length - 1];
    r.data = ult[1];
    if (ult[2]) r.hora = ult[2];
  }
  if (!r.hora) { const h = [...t.matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)]; if (h.length) r.hora = h[h.length - 1][1]; }
  // Emissor: primeira linha com letras que não seja rótulo nem endereço
  const primeira = t.split('\n').map((l) => l.trim()).find((l) => /[A-Za-z]{3}/.test(l) && !/:/.test(l));
  if (primeira) r.emissor = primeira;
  // "Produto: TORAS" não pode pegar a linha "Tipo Produto: PINOS"
  if (r.produto && r.tipo_produto && norm(r.produto) === norm(r.tipo_produto)) {
    const m = t.match(/^(?!.*tipo).*\bproduto\s*[:.-]\s*([^\n]{2,60})/im);
    r.produto = m ? m[1].trim() : null;
  }
  return r;
}

// ---------------------------------------------------------------------
// NORMALIZAÇÃO
// ---------------------------------------------------------------------
const limpo = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && !/^(null|n\/a|-+|nao informado|não informado)$/i.test(s) ? s : null;
};

// Peso para TONELADAS. Aceita "43030.0 kg", "43.030 kg", "43,03 t", "43030".
// Sem unidade: acima de 200 é kg (nenhuma carga tem 200 t).
function pesoEmToneladas(valor) {
  const s = limpo(valor);
  if (!s) return null;
  const unidade = /\bkg\b|quilo/i.test(s) ? 'kg' : /\b(t|ton|tonelada)s?\b/i.test(s) ? 't' : null;
  let n = s.replace(/[^\d.,]/g, '');
  if (!n) return null;
  if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');          // 43.030,00 -> 43030.00
  else if (/^\d{1,3}(\.\d{3})+$/.test(n) && unidade === 'kg') n = n.replace(/\./g, ''); // 43.030 kg -> 43030
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  const kg = unidade === 'kg' || (unidade === null && num > 200);
  return Math.round((kg ? num / 1000 : num) * 100) / 100;
}

function dataISO(valor) {
  const s = limpo(valor);
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function horaHHMM(valor) {
  const m = String(limpo(valor) || '').match(/(\d{1,2})[:h](\d{2})/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Placa: ABC1234 (antiga) ou ABC1D23 (Mercosul). Corrige as trocas comuns da
// leitura (O/0, I/1, S/5, B/8) conforme a posição exige letra ou número.
const PARA_LETRA = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z', 6: 'G', 4: 'A' };
const PARA_NUMERO = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
function normalizarPlaca(valor) {
  const s = String(limpo(valor) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 7) return { placa: s || null, valida: false };
  const c = s.split('');
  for (const i of [0, 1, 2]) c[i] = PARA_LETRA[c[i]] || c[i];
  for (const i of [3, 5, 6]) c[i] = PARA_NUMERO[c[i]] || c[i];
  const placa = c.join('');
  return { placa, valida: /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa), corrigida: placa !== s };
}

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Junta o que a IA leu com a leitura por rótulos do texto e normaliza.
function normalizar(brutos) {
  const daIA = brutos || {};
  const doTexto = lerPorRotulos(daIA.texto || '');
  const pegar = (campo) => limpo(daIA[campo]) || limpo(doTexto[campo]);
  const avisos = [];

  const placa = normalizarPlaca(pegar('placa'));
  if (placa.placa && !placa.valida) avisos.push(`Placa "${placa.placa}" fora do padrão: confira.`);

  let peso = pesoEmToneladas(pegar('peso_liquido'));
  const bruto = pesoEmToneladas(pegar('peso_bruto'));
  const tara = pesoEmToneladas(pegar('tara'));
  if (bruto && tara && bruto > tara) {
    const calculado = Math.round((bruto - tara) * 100) / 100;
    if (!peso) { peso = calculado; avisos.push('Peso líquido calculado: bruto − tara.'); }
    else if (Math.abs(calculado - peso) > 0.015) avisos.push(`Bruto − tara dá ${calculado.toFixed(2).replace('.', ',')} t, mas o ticket diz ${peso.toFixed(2).replace('.', ',')} t: confira.`);
  }
  if (peso && (peso < 1 || peso > 80)) avisos.push(`Peso líquido de ${peso.toFixed(2).replace('.', ',')} t está fora do comum: confira.`);

  const data = dataISO(pegar('data'));
  if (data && data > hojeISO()) avisos.push('A data lida está no futuro: confira.');

  const ticket = (pegar('ticket') || '').replace(/^n[ºo°]\s*/i, '').replace(/\s+/g, '').slice(0, 30) || null;

  return {
    ticket,
    data,
    hora_pesagem: horaHHMM(pegar('hora')),
    placa: placa.placa ? placa.placa.slice(0, 20) : null,
    motorista: pegar('motorista') ? pegar('motorista').slice(0, 150) : null,
    peso_liquido: peso,
    peso_bruto: bruto,
    tara,
    emissor: pegar('emissor'),
    entidade: pegar('entidade'),
    local: pegar('local'),
    terceiro: pegar('terceiro'),
    produto: pegar('produto'),
    tipo_produto: pegar('tipo_produto'),
    avisos,
  };
}

// ---------------------------------------------------------------------
// LIGAR AOS CADASTROS
// ---------------------------------------------------------------------
const PALAVRAS_FRACAS = new Set(['ltda', 'me', 'sa', 'eireli', 'epp', 'madeireira', 'madeiras', 'industria', 'comercio',
  'ind', 'com', 'de', 'da', 'do', 'das', 'dos', 'e', 'fazenda', 'faz', 'floresta', 'serraria', 'transportes', 'transportadora']);
const palavras = (s) => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((p) => p.length >= 3 && !PALAVRAS_FRACAS.has(p));

// Melhor cadastro para um texto lido: nome igual; um contém o outro; ou
// todas as palavras importantes do cadastro aparecem no texto.
function acharPorNome(texto, lista) {
  const t = norm(texto).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 3) return null;
  const ps = new Set(palavras(texto));
  let melhor = null; let nota = 0;
  for (const item of lista) {
    const n = norm(item.nome).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) continue;
    let pontos = 0;
    if (n === t) pontos = 100;
    else if (n.length >= 4 && (` ${t} `.includes(` ${n} `) || ` ${n} `.includes(` ${t} `))) pontos = 80;
    else {
      const pi = palavras(item.nome);
      if (pi.length && pi.every((p) => ps.has(p))) pontos = 60 + pi.length;
    }
    if (pontos > nota) { nota = pontos; melhor = item; }
  }
  return melhor;
}

function acharClasse(texto, classes) {
  const n = norm(texto);
  if (!n) return null;
  const exata = classes.find((c) => norm(c.nome) === n);
  if (exata) return exata;
  // "Pinus fino", "tora grossa", "médio", "EUC"...
  const chaves = [['lixo', 'lixo'], ['eucal', 'eucalipto'], ['euc ', 'eucalipto'], ['gross', 'grossa'], ['medi', 'media'], ['fin', 'fina']];
  for (const [trecho, nome] of chaves) {
    if (` ${n} `.includes(trecho)) { const c = classes.find((x) => norm(x.nome) === nome); if (c) return c; }
  }
  return classes.find((c) => n.includes(norm(c.nome))) || null;
}

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

async function ligarCadastros(empresaId, lido) {
  const [clientes, florestas, empreiteiros, classes, motoristas] = (await Promise.all([
    query('SELECT id, nome FROM clientes WHERE empresa_id = $1 AND ativo', [empresaId]),
    query('SELECT id, nome FROM florestas WHERE empresa_id = $1 AND ativo', [empresaId]),
    query('SELECT id, nome FROM empreiteiros WHERE empresa_id = $1 AND ativo', [empresaId]),
    query('SELECT id, nome FROM classes_madeira WHERE empresa_id = $1 AND ativo', [empresaId]),
    motoristasCadastrados(query, empresaId).then((rows) => ({ rows })),
  ])).map((r) => r.rows);

  const campos = {
    ticket: lido.ticket, data: lido.data, hora_pesagem: lido.hora_pesagem, placa: lido.placa,
    motorista: lido.motorista, motorista_id: null, peso_liquido: lido.peso_liquido,
    cliente_id: null, floresta_id: null, empreiteiro_id: null, classe_id: null,
  };
  // origem de cada campo: 'ticket' (lido) ou 'placa' (sugerido pela última viagem da placa)
  const origem = {};
  for (const c of ['ticket', 'data', 'hora_pesagem', 'placa', 'motorista', 'peso_liquido']) if (campos[c] !== null) origem[c] = 'ticket';
  const avisos = [...lido.avisos];

  // Motorista: só vale se estiver cadastrado (Funcionários, "É motorista"); aceita outra grafia (JUNIOR / Júnior)
  // e o nome do funcionário (ex.: ticket "ODAIR" -> funcionário Odair, que nas cargas é "TIO DAIA")
  if (lido.motorista) {
    const m = motoristas.find((x) => norm(x.nome) === norm(lido.motorista) || norm(x.funcionario) === norm(lido.motorista))
      || acharPorNome(lido.motorista, motoristas);
    if (m) { campos.motorista = m.nome; campos.motorista_id = m.id; origem.motorista_id = 'ticket'; }
    else avisos.push(`O motorista "${lido.motorista}" do ticket não está cadastrado. ${AVISO_CADASTRO}`);
  }

  // Cliente: normalmente é o dono da balança (emissor); senão a "entidade"
  const cliente = acharPorNome(lido.emissor, clientes) || acharPorNome(lido.entidade, clientes);
  if (cliente) { campos.cliente_id = cliente.id; origem.cliente_id = 'ticket'; }
  const floresta = acharPorNome(lido.local, florestas) || acharPorNome(lido.entidade, florestas);
  if (floresta) { campos.floresta_id = floresta.id; origem.floresta_id = 'ticket'; }
  const empreiteiro = acharPorNome(lido.terceiro, empreiteiros) || acharPorNome(lido.entidade, empreiteiros);
  if (empreiteiro) { campos.empreiteiro_id = empreiteiro.id; origem.empreiteiro_id = 'ticket'; }
  const classe = acharClasse(lido.tipo_produto, classes) || acharClasse(lido.produto, classes);
  if (classe) { campos.classe_id = classe.id; origem.classe_id = 'ticket'; }

  // O que faltou: a última viagem do mesmo caminhão costuma repetir a rota
  let ultimaDaPlaca = null;
  if (lido.placa) {
    const { rows } = await query(
      `SELECT v.cliente_id, v.floresta_id, v.empreiteiro_id, v.classe_id, v.motorista_id, v.numero_viagem,
              to_char(v.data, 'YYYY-MM-DD') AS data, c.nome AS cliente
         FROM viagens v JOIN clientes c ON c.id = v.cliente_id
        WHERE v.empresa_id = $1 AND v.status <> 'Cancelada'
          AND upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g')) = $2
        ORDER BY v.data DESC, v.id DESC LIMIT 1`, [empresaId, lido.placa]);
    if (rows.length) {
      ultimaDaPlaca = rows[0];
      const ativos = { cliente_id: clientes, floresta_id: florestas, empreiteiro_id: empreiteiros, classe_id: classes, motorista_id: motoristas };
      for (const c of ['cliente_id', 'floresta_id', 'empreiteiro_id', 'classe_id', 'motorista_id']) {
        const id = ultimaDaPlaca[c];
        if (campos[c] === null && id && ativos[c].some((x) => x.id === id)) { campos[c] = id; origem[c] = 'sugerido'; }
      }
    }
  }

  // Já foi lançado?
  let duplicada = null;
  if (lido.ticket || (lido.placa && lido.data && lido.peso_liquido)) {
    const { rows } = await query(
      `SELECT v.id, v.numero_viagem, to_char(v.data, 'YYYY-MM-DD') AS data, v.ticket, c.nome AS cliente,
              ($2::text IS NOT NULL AND v.ticket = $2) AS pelo_ticket
         FROM viagens v JOIN clientes c ON c.id = v.cliente_id
        WHERE v.empresa_id = $1 AND v.status <> 'Cancelada'
          AND (($2::text IS NOT NULL AND v.ticket = $2)
            OR ($3::text IS NOT NULL AND upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g')) = $3
                AND v.data = $4::date AND v.peso_liquido = $5::numeric))
        ORDER BY pelo_ticket DESC LIMIT 1`,
      [empresaId, lido.ticket, lido.placa, lido.data, lido.peso_liquido]);
    if (rows.length) {
      const d = rows[0];
      duplicada = { id: d.id, numero_viagem: d.numero_viagem, data: d.data, cliente: d.cliente, pelo_ticket: d.pelo_ticket };
      avisos.unshift(d.pelo_ticket
        ? `O ticket ${lido.ticket} já foi lançado: viagem nº ${d.numero_viagem} de ${dataBR(d.data)} (${d.cliente}).`
        : `Já existe viagem com a mesma placa, data e peso: nº ${d.numero_viagem} de ${dataBR(d.data)} (${d.cliente}).`);
    }
  }

  // O mesmo ticket já foi lançado como FRETE? (só avisa: pode ser a mesma carga)
  if (lido.ticket) {
    const fr = await freteComTicket(empresaId, lido.ticket);
    if (fr) avisos.push(`Este ticket também está no frete nº ${fr.numero_carga} de ${dataBR(fr.data)} (${fr.cliente}): confira se é viagem mesmo.`);
  }

  // O que não deu para preencher
  const faltando = [];
  if (!campos.data) faltando.push('data');
  if (!campos.peso_liquido) faltando.push('peso líquido');
  if (!campos.cliente_id) faltando.push('cliente');
  if (!campos.floresta_id) faltando.push('floresta');
  if (!campos.classe_id) faltando.push('classe');
  if (!campos.motorista_id) faltando.push('motorista');

  return {
    campos,
    origem,
    avisos,
    faltando,
    duplicada,
    ultima_da_placa: ultimaDaPlaca && { numero_viagem: ultimaDaPlaca.numero_viagem, data: ultimaDaPlaca.data, cliente: ultimaDaPlaca.cliente },
    sugerido_de: ultimaDaPlaca ? `da última viagem desta placa (nº ${ultimaDaPlaca.numero_viagem} de ${dataBR(ultimaDaPlaca.data)})` : null,
    lido: comoImpresso(lido),
  };
}

// Como estava impresso (para conferir na tela)
const comoImpresso = (lido) => ({
  emissor: lido.emissor, entidade: lido.entidade, local: lido.local, terceiro: lido.terceiro,
  produto: lido.produto, tipo_produto: lido.tipo_produto, peso_bruto: lido.peso_bruto, tara: lido.tara,
});

// Frete que guardou este ticket nas observações ("Ticket 36627 · ...")
async function freteComTicket(empresaId, ticket) {
  const { rows } = await query(
    `SELECT f.numero_carga, to_char(f.data, 'YYYY-MM-DD') AS data, c.nome AS cliente
       FROM fretes f JOIN clientes c ON c.id = f.cliente_id
      WHERE f.empresa_id = $1 AND f.status_pagamento <> 'Cancelado'
        AND f.observacoes ~* ('(^|[^0-9A-Za-z])ticket:? *(n[ºo°.]? *)?' || $2 || '([^0-9A-Za-z]|$)')
      ORDER BY f.data DESC LIMIT 1`,
    [empresaId, ticket.replace(/[^0-9A-Za-z./-]/g, '').replace(/[.]/g, '\\.')]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// FRETE pelo ticket (tela Fretes)
// Planilha FRETES: Nº carga, Data, Cliente, Toneladas, Valor ton, Total.
// Do ticket vêm a data, as toneladas (peso líquido) e o cliente (balança ou
// entidade). Destino e valor da tonelada: sugeridos pelo último frete do
// cliente. O nº do ticket, a placa e o motorista vão para as observações
// (o frete não tem colunas para eles) - e servem para achar ticket repetido.
// ---------------------------------------------------------------------
async function ligarFrete(empresaId, lido) {
  const clientes = (await query('SELECT id, nome FROM clientes WHERE empresa_id = $1 AND ativo', [empresaId])).rows;
  const avisos = [...lido.avisos].filter((a) => !/^Placa/.test(a)); // placa não é campo do frete
  const origem = {};
  const obs = [lido.ticket && `Ticket ${lido.ticket}`, lido.placa && `placa ${lido.placa}`, lido.motorista && `motorista ${lido.motorista}`]
    .filter(Boolean).join(' · ') || null;
  const motoristas = await motoristasCadastrados(query, empresaId);
  const achado = lido.motorista
    ? motoristas.find((m) => norm(m.nome) === norm(lido.motorista) || norm(m.funcionario) === norm(lido.motorista)) || acharPorNome(lido.motorista, motoristas)
    : null;
  if (lido.motorista && !achado) avisos.push(`O motorista "${lido.motorista}" do ticket não está cadastrado. ${AVISO_CADASTRO}`);
  const campos = {
    data: lido.data, toneladas: lido.peso_liquido, cliente_id: null, destino: null,
    cobranca: 'tonelada', valor_tonelada: null, observacoes: obs, motorista: achado ? achado.nome : lido.motorista, motorista_id: achado ? achado.id : null,
  };
  for (const c of ['data', 'toneladas', 'observacoes', 'motorista', 'motorista_id']) if (campos[c] !== null) origem[c] = 'ticket';

  const cliente = acharPorNome(lido.emissor, clientes) || acharPorNome(lido.entidade, clientes);
  if (cliente) { campos.cliente_id = cliente.id; origem.cliente_id = 'ticket'; }

  // Último frete do cliente: destino e valor da tonelada costumam se repetir
  let ultimo = null;
  if (cliente) {
    const { rows } = await query(
      `SELECT numero_carga, to_char(data, 'YYYY-MM-DD') AS data, destino, valor_tonelada, valor_fechado
         FROM fretes WHERE empresa_id = $1 AND cliente_id = $2 AND status_pagamento <> 'Cancelado'
        ORDER BY data DESC, id DESC LIMIT 1`, [empresaId, cliente.id]);
    ultimo = rows[0] || null;
    if (ultimo) {
      if (ultimo.destino) { campos.destino = ultimo.destino; origem.destino = 'sugerido'; }
      if (ultimo.valor_tonelada !== null && ultimo.valor_fechado === null) {
        campos.valor_tonelada = Number(ultimo.valor_tonelada); origem.valor_tonelada = 'sugerido';
      }
    }
  }
  // Sem histórico: o destino é a própria balança (onde a carga foi entregue)
  if (!campos.destino && lido.emissor && !cliente) { campos.destino = lido.emissor.slice(0, 100); origem.destino = 'ticket'; }

  // Repetido?
  let duplicada = null;
  if (lido.ticket) {
    const fr = await freteComTicket(empresaId, lido.ticket);
    if (fr) {
      duplicada = { ...fr, pelo_ticket: true };
      avisos.unshift(`O ticket ${lido.ticket} já foi lançado: frete nº ${fr.numero_carga} de ${dataBR(fr.data)} (${fr.cliente}).`);
    }
    const v = await query(
      `SELECT v.numero_viagem, to_char(v.data, 'YYYY-MM-DD') AS data, c.nome AS cliente FROM viagens v JOIN clientes c ON c.id = v.cliente_id
        WHERE v.empresa_id = $1 AND v.ticket = $2 AND v.status <> 'Cancelada' LIMIT 1`, [empresaId, lido.ticket]);
    if (v.rows.length) {
      const x = v.rows[0];
      avisos.push(`Este ticket também está na viagem nº ${x.numero_viagem} de ${dataBR(x.data)} (${x.cliente}): confira se é frete mesmo.`);
    }
  }
  if (!duplicada && cliente && lido.data && lido.peso_liquido) {
    const { rows } = await query(
      `SELECT numero_carga FROM fretes WHERE empresa_id = $1 AND cliente_id = $2 AND data = $3::date AND toneladas = $4::numeric
          AND status_pagamento <> 'Cancelado' LIMIT 1`, [empresaId, cliente.id, lido.data, lido.peso_liquido]);
    if (rows.length) {
      duplicada = { numero_carga: rows[0].numero_carga, pelo_ticket: false };
      avisos.unshift(`Já existe frete desse cliente com a mesma data e toneladas: nº ${rows[0].numero_carga}.`);
    }
  }

  const faltando = [];
  if (!campos.data) faltando.push('data');
  if (!campos.toneladas) faltando.push('toneladas');
  if (!campos.cliente_id) faltando.push('cliente');
  if (!campos.valor_tonelada) faltando.push('valor do frete');
  if (!campos.motorista_id) faltando.push('motorista');

  return {
    campos, origem, avisos, faltando, duplicada,
    sugerido_de: ultimo ? `do último frete deste cliente (nº ${ultimo.numero_carga} de ${dataBR(ultimo.data)})` : null,
    lido: comoImpresso(lido),
  };
}

module.exports = {
  INSTRUCAO, CAMPOS_TEXTO, extrairJSON, lerPorRotulos, normalizar, ligarCadastros, ligarFrete,
  pesoEmToneladas, dataISO, horaHHMM, normalizarPlaca, acharPorNome, acharClasse,
};
