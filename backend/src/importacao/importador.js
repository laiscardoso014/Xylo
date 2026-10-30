// =====================================================================
// IMPORTAÇÃO DE PLANILHAS (.xlsx)
//
// Tipos: viagens, fretes, clientes, florestas, empreiteiros.
//
// Como lê a planilha:
//  - Procura, em cada aba, as linhas de CABEÇALHO (reconhece os nomes mais
//    comuns das colunas, inclusive os da planilha antiga: "Nº Ticket",
//    "Local" = floresta, "Terceiro" = empreiteiro, "Peso Líq.", "Vlr TON"...).
//  - Uma aba pode ter vários BLOCOS (cabeçalho + linhas até o "TOTAL"). O título
//    acima do bloco (ex.: "PAU BRASIL-01/2026") é usado como cliente quando a
//    planilha não tem a coluna Cliente.
//  - Linhas sem data ou sem peso (linhas em branco do modelo) são ignoradas.
//  - Blocos LADO A LADO na mesma linha (aba FRETES: "FRETES A VISTA/CHEQUE" e
//    "FRETES A JAIR PH PAGA") são lidos separados, cada um com o seu título
//    e o seu TOTAL.
//
// Nada é gravado na análise: ela devolve linha por linha o que vai acontecer
// (importar, duplicada, com erro). A gravação refaz a análise e grava tudo
// numa transação: ou entra tudo o que estava certo, ou nada.
// =====================================================================
const { query, pool } = require('../config/db');
const { lerNumero } = require('../utils/numeros');
const { documentoValido, telefoneValido } = require('../utils/documentos');
const { idDoMotorista, motoristasCadastrados, placaValida, donoDaPlaca } = require('../utils/motoristas');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[º°ª]/g, '').replace(/[^a-z0-9$/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const chaveNome = (s) => norm(s).toUpperCase();

// ---------------------------------------------------------------------
// Colunas reconhecidas (nomes normalizados: sem acento, minúsculos)
// ---------------------------------------------------------------------
const TIPOS = {
  viagens: {
    obrigatorias: ['data', 'peso'],
    colunas: {
      data: ['data', 'dt', 'data viagem', 'data da viagem', 'data carga'],
      ticket: ['ticket', 'n ticket', 'no ticket', 'n do ticket', 'numero ticket', 'numero do ticket', 'ticket balanca'],
      placa: ['placa', 'placa caminhao', 'placa do caminhao', 'caminhao'],
      cliente: ['cliente', 'serraria', 'comprador'],
      floresta: ['floresta', 'local', 'fazenda', 'origem', 'procedencia'],
      empreiteiro: ['empreiteiro', 'terceiro', 'empreiteira', 'empreiteiros'],
      classe: ['classe', 'tipo', 'tipo madeira', 'bitola', 'produto'],
      peso: ['peso liq', 'peso liquido', 'peso', 'peso t', 'toneladas', 'ton', 'peso ton', 'peso liq t'],
      valor_tonelada: ['vlr ton', 'valor ton', 'valor tonelada', 'valor da tonelada', 'preco ton', 'preco tonelada', 'r$/t', 'r$ t', 'preco', 'valor r$/t'],
      valor_total: ['vlr total', 'valor total', 'total r$'],
      // preços pagos (opcionais; a planilha da empresa não tem: completa depois na viagem)
      valor_floresta: ['vlr floresta', 'valor floresta', 'compra', 'vlr compra', 'valor compra', 'preco compra', 'compra floresta', 'compra ton'],
      valor_empreiteiro: ['vlr empreiteiro', 'valor empreiteiro', 'empreitada', 'vlr empreitada', 'valor empreitada', 'vlr terceiro', 'valor terceiro'],
      motorista: ['motorista'],
      hora: ['horario pesagem', 'hora pesagem', 'horario', 'hora'],
      volume_m3: ['m3', 'volume', 'volume m3'],
      observacoes: ['obs', 'observacao', 'observacoes'],
    },
  },
  fretes: {
    obrigatorias: ['data', 'toneladas'],
    situacaoAoLado: true, // coluna sem título logo depois do TOTAL com "PAGO" (aba FRETES)
    colunas: {
      numero_carga: ['n carga', 'no carga', 'n da carga', 'numero carga', 'numero da carga', 'carga'],
      data: ['data', 'dt', 'data frete', 'data carga'],
      cliente: ['cliente', 'cliente destino', 'quem paga'],
      destino: ['destino', 'local entrega', 'entrega'],
      toneladas: ['toneladas', 'ton', 'tons', 'peso', 'peso liq', 'peso liquido', 'peso t'],
      valor_tonelada: ['valor ton', 'vlr ton', 'valor tonelada', 'valor da tonelada', 'r$/t', 'r$ t', 'preco ton', 'frete ton'],
      valor_total: ['total', 'valor total', 'vlr total', 'total r$', 'valor', 'valor frete', 'valor fechado'],
      situacao: ['situacao', 'status', 'pagamento', 'pago', 'recebido'],
      forma_pagamento: ['forma pagamento', 'forma de pagamento', 'pagto', 'forma'],
      observacoes: ['obs', 'observacao', 'observacoes'],
    },
  },
  clientes: {
    obrigatorias: ['nome'],
    colunas: {
      nome: ['nome', 'cliente', 'serraria', 'nome fantasia'],
      razao_social: ['razao social', 'razao'],
      cpf_cnpj: ['cpf cnpj', 'cpf/cnpj', 'cnpj', 'cpf', 'documento'],
      telefone: ['telefone', 'fone', 'celular', 'whatsapp', 'contato'],
      email: ['email', 'e mail'],
      cidade: ['cidade', 'municipio'],
      estado: ['uf', 'estado'],
      observacoes: ['obs', 'observacao', 'observacoes'],
    },
  },
  florestas: {
    obrigatorias: ['nome'],
    colunas: {
      nome: ['nome', 'floresta', 'fazenda', 'local'],
      proprietario: ['proprietario', 'dono', 'fornecedor'],
      municipio: ['municipio', 'cidade'],
      estado: ['uf', 'estado'],
      observacoes: ['obs', 'observacao', 'observacoes'],
    },
  },
  empreiteiros: {
    obrigatorias: ['nome'],
    colunas: {
      nome: ['nome', 'empreiteiro', 'terceiro'],
      cpf_cnpj: ['cpf cnpj', 'cpf/cnpj', 'cnpj', 'cpf', 'documento'],
      telefone: ['telefone', 'fone', 'celular', 'whatsapp', 'contato'],
      observacoes: ['obs', 'observacao', 'observacoes'],
    },
  },
};

// Descobre que campo é cada coluna desta linha (se for um cabeçalho)
function lerCabecalho(linha, def) {
  const mapa = {};
  (linha || []).forEach((cel, i) => {
    if (typeof cel !== 'string') return;
    const n = norm(cel);
    if (!n) return;
    for (const [campo, nomes] of Object.entries(def.colunas)) {
      if (mapa[campo] === undefined && nomes.includes(n)) { mapa[campo] = i; return; }
    }
  });
  const reconhecidas = Object.keys(mapa).length;
  const temObrigatorias = def.obrigatorias.every((c) => mapa[c] !== undefined);
  return temObrigatorias && reconhecidas >= Math.min(2, Object.keys(def.colunas).length) ? mapa : null;
}

// Título de um bloco ("PAU BRASIL-01/2026" -> "PAU BRASIL")
function tituloDoBloco(linhas, iCab) {
  for (let i = iCab - 1; i >= Math.max(0, iCab - 2); i--) {
    const textos = (linhas[i] || []).filter((v) => typeof v === 'string' && v.trim());
    if (textos.length === 1 && (linhas[i] || []).filter((v) => v !== null && v !== undefined && v !== '').length === 1) {
      const t = textos[0].trim();
      if (/^total/i.test(t)) return null;
      return t.replace(/\s*[-–]?\s*\d{1,2}\/\d{4}\s*$/, '').replace(/\s*[-–]\s*$/, '').split(/\s+[-–]\s+|-(?=[A-ZÇÃÕÁÉÍÓÚ]{3,})/)[0].trim() || null;
    }
  }
  return null;
}

// Vários cabeçalhos na MESMA linha (blocos lado a lado): quando um nome de
// coluna se repete, começa outro bloco. Devolve [{ mapa, ini, fim }] válidos.
function lerCabecalhos(linha, def) {
  const grupos = [];
  let atual = { mapa: {}, ini: null };
  (linha || []).forEach((cel, i) => {
    if (typeof cel !== 'string') return;
    const n = norm(cel);
    if (!n) return;
    const campo = Object.entries(def.colunas).find(([, nomes]) => nomes.includes(n));
    if (!campo) return;
    if (atual.mapa[campo[0]] !== undefined) { grupos.push(atual); atual = { mapa: {}, ini: null }; }
    atual.mapa[campo[0]] = i;
    if (atual.ini === null) atual.ini = i;
  });
  grupos.push(atual);
  const validos = grupos.filter((g) => def.obrigatorias.every((c) => g.mapa[c] !== undefined) && Object.keys(g.mapa).length >= 2);
  return validos.map((g, k) => ({ mapa: g.mapa, ini: g.ini, fim: k + 1 < validos.length ? validos[k + 1].ini - 1 : Infinity }));
}

// Título acima de um bloco, procurando só nas colunas dele
function tituloNaFaixa(linhas, iCab, ini, fim) {
  for (let i = iCab - 1; i >= Math.max(0, iCab - 2); i--) {
    const textos = (linhas[i] || []).map((v, c) => (c >= ini && c <= fim && typeof v === 'string' && v.trim() ? v.trim() : null)).filter(Boolean);
    if (textos.length === 1 && !/^total/i.test(textos[0])) return textos[0];
  }
  return null;
}

// Separa a aba em blocos e devolve as linhas de dados: { linha (nº no Excel), bloco, valores: {campo: valor} }
function extrairLinhas(aba, def) {
  const saida = [];
  const linhas = aba.linhas;
  let ativos = []; // blocos abertos: { mapa, bloco, ini, fim, lado }
  const ehTotal = (v) => typeof v === 'string' && /^(total|totaliza)/.test(norm(v));
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] || [];
    const grupos = lerCabecalhos(l, def);
    if (grupos.length >= 2) {
      // blocos lado a lado: cada um com o seu título e o seu TOTAL
      ativos = grupos.map((g) => ({ ...g, bloco: tituloNaFaixa(linhas, i, g.ini, g.fim), lado: true }));
    } else {
      const cab = lerCabecalho(l, def);
      if (cab) {
        const ini = Math.min(...Object.values(cab));
        ativos = [{ mapa: cab, ini, fim: Infinity, lado: false,
          bloco: def.situacaoAoLado ? tituloNaFaixa(linhas, i, ini, Math.max(...Object.values(cab)) + 1) : tituloDoBloco(linhas, i) }];
      }
    }
    if (grupos.length >= 2 || lerCabecalho(l, def)) {
      // Coluna sem título logo depois da última (ex.: "PAGO" ao lado do TOTAL)
      if (def.situacaoAoLado) {
        for (const a of ativos) {
          if (a.mapa.situacao !== undefined) continue;
          const col = Math.max(...Object.values(a.mapa)) + 1;
          if (col <= a.fim && (l[col] === null || l[col] === undefined || l[col] === '')) a.mapa.situacao = col;
        }
      }
      continue;
    }
    if (!ativos.length) continue;
    // linha de TOTAL encerra o bloco; o que vem depois é resumo, não lançamento.
    // Bloco sozinho: TOTAL em qualquer coluna. Lado a lado: só nas colunas do bloco.
    if (ativos.some((a) => !a.lado) && l.some(ehTotal)) { ativos = []; continue; }
    ativos = ativos.filter((a) => !(a.lado && l.some((v, c) => c >= a.ini && c <= a.fim && ehTotal(v))));
    for (const a of ativos) {
      const valores = {};
      for (const [campo, col] of Object.entries(a.mapa)) valores[campo] = l[col] ?? null;
      saida.push({ linha: i + 1, bloco: a.bloco, valores });
    }
  }
  return saida;
}

// ---------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------
function paraData(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    let m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
      const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return Number.isNaN(Date.parse(iso)) ? null : iso;
    }
    m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}
const paraNumero = (v) => (typeof v === 'number' ? v : (v === null || v === undefined || v === '' ? NaN : lerNumero(v)));
const paraTexto = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  return t || null;
};
const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

// Classe pelo texto: "FINA 220" -> Fina, "COMPRIDA MEDIA" -> Média, "LIXO-PINUS" -> Lixo
function acharClasse(texto, classes) {
  const n = norm(texto);
  if (!n) return null;
  const exata = classes.find((c) => norm(c.nome) === n);
  if (exata) return exata;
  const chaves = [['lixo', 'lixo'], ['eucal', 'eucalipto'], ['grossa', 'grossa'], ['media', 'media'], ['fina', 'fina']];
  for (const [trecho, nome] of chaves) {
    if (n.includes(trecho)) { const c = classes.find((x) => norm(x.nome) === nome); if (c) return c; }
  }
  return classes.find((c) => n.includes(norm(c.nome))) || null;
}

// ---------------------------------------------------------------------
// ANÁLISE
// opcoes: { tipo, aba (nome), clienteFixo (id|null), clienteOrigem ('aba'|'bloco'),
//           criarCadastros (bool), usarValorDaPlanilha (bool) }
//   Sem coluna Cliente, o cliente vem do NOME DA ABA (padrão) ou do TÍTULO DE CADA BLOCO.
// ---------------------------------------------------------------------
async function analisar(empresaId, pasta, opcoes) {
  const def = TIPOS[opcoes.tipo];
  if (!def) throw Object.assign(new Error('Tipo de importação inválido.'), { status: 400 });

  // Abas que têm pelo menos um cabeçalho reconhecível
  const abasValidas = pasta.abas.map((a) => ({ nome: a.nome, linhas: extrairLinhas(a, def).length }));
  let aba = opcoes.aba ? pasta.abas.find((a) => a.nome === opcoes.aba) : null;
  if (!aba) aba = pasta.abas.find((a) => extrairLinhas(a, def).length) || null;
  const base = { tipo: opcoes.tipo, abas: abasValidas, aba: aba ? aba.nome : null };
  if (!aba) return { ...base, linhas: [], resumo: { importar: 0, duplicadas: 0, erros: 0 }, novos: {}, colunas: [] };

  const brutas = extrairLinhas(aba, def);
  const colunas = [...new Set(aba.linhas.flatMap((l) => { const m = lerCabecalho(l, def); return m ? Object.keys(m) : []; }))];
  const resultado = opcoes.tipo === 'viagens'
    ? await analisarViagens(empresaId, brutas, { ...opcoes, nomeAba: aba.nome })
    : opcoes.tipo === 'fretes'
      ? await analisarFretes(empresaId, brutas, opcoes)
      : await analisarCadastros(empresaId, brutas, opcoes.tipo);
  return { ...base, colunas, ...resultado };
}

async function analisarViagens(empresaId, brutas, opcoes) {
  const [cli, flo, emp, cla, mot] = await Promise.all([
    query('SELECT id, nome, ativo FROM clientes WHERE empresa_id = $1', [empresaId]),
    query('SELECT id, nome, ativo FROM florestas WHERE empresa_id = $1', [empresaId]),
    query('SELECT id, nome, ativo FROM empreiteiros WHERE empresa_id = $1', [empresaId]),
    query('SELECT id, nome FROM classes_madeira WHERE empresa_id = $1', [empresaId]),
    motoristasCadastrados(query, empresaId),
  ]);
  const indice = (rows) => new Map(rows.map((r) => [chaveNome(r.nome), r]));
  // motorista: só os cadastrados como funcionário (pelo nome nas cargas ou pelo nome do funcionário)
  const mapaMotoristas = new Map();
  mot.forEach((m) => {
    mapaMotoristas.set(chaveNome(m.funcionario), { id: m.id, nome: m.nome, ativo: true });
    mapaMotoristas.set(chaveNome(m.nome), { id: m.id, nome: m.nome, ativo: true });
  });
  const mapas = { cliente: indice(cli.rows), floresta: indice(flo.rows), empreiteiro: indice(emp.rows), motorista: mapaMotoristas };
  // placa -> motorista: quem usava a placa na data da carga (motorista_placas)
  const clienteFixo = opcoes.clienteFixo ? cli.rows.find((c) => c.id === Number(opcoes.clienteFixo)) : null;
  const novos = { cliente: new Map(), floresta: new Map(), empreiteiro: new Map(), motorista: new Map() };

  // Viagens já lançadas nos meses da planilha (para achar duplicadas)
  const datas = brutas.map((b) => paraData(b.valores.data)).filter(Boolean);
  const existentes = { tickets: new Set(), chaves: new Set() };
  if (datas.length) {
    const ini = datas.reduce((a, b) => (a < b ? a : b));
    const fim = datas.reduce((a, b) => (a > b ? a : b));
    const r = await query(
      `SELECT ticket, to_char(data,'YYYY-MM-DD') AS data, upper(regexp_replace(coalesce(placa,''),'[^A-Za-z0-9]','','g')) AS placa, peso_liquido
         FROM viagens WHERE empresa_id = $1 AND status <> 'Cancelada'
          AND (ticket IS NOT NULL OR data BETWEEN $2::date AND $3::date)`, [empresaId, ini, fim]);
    r.rows.forEach((v) => {
      if (v.ticket) existentes.tickets.add(String(v.ticket).trim());
      existentes.chaves.add(`${v.data}|${v.placa}|${Number(v.peso_liquido).toFixed(2)}`);
    });
  }
  const noArquivo = { tickets: new Set(), chaves: new Set() };
  const novosComPlaca = new Map(); // motorista novo -> 1ª placa dele na planilha (vai para o cadastro)

  const resolver = (tipo, nome, erros, avisos, obrigatorio) => {
    if (vazio(nome)) { if (obrigatorio) erros.push(`Falta ${tipo}.`); return null; }
    const chave = chaveNome(nome);
    const achado = mapas[tipo].get(chave);
    if (achado) {
      if (!achado.ativo) avisos.push(`${tipo[0].toUpperCase()}${tipo.slice(1)} "${achado.nome}" está inativo.`);
      return { id: achado.id, nome: achado.nome };
    }
    if (opcoes.criarCadastros) {
      if (!novos[tipo].has(chave)) novos[tipo].set(chave, String(nome).trim());
      // (os cadastros novos aparecem uma vez só, no resumo acima da tabela)
      return { id: null, novo: chave, nome: String(nome).trim() };
    }
    erros.push(`${tipo[0].toUpperCase()}${tipo.slice(1)} "${String(nome).trim()}" não está cadastrado${tipo === 'motorista' ? ' (Pessoal › Funcionários, "É motorista")' : ''}.`);
    return null;
  };

  const linhas = [];
  for (const b of brutas) {
    const v = b.valores;
    const data = paraData(v.data);
    const peso = paraNumero(v.peso);
    // linha "em branco" do modelo da planilha (só o número da viagem): ignora em silêncio
    if (!data && (!Number.isFinite(peso) || peso === 0) && vazio(v.ticket) && vazio(v.placa)) continue;
    // sem floresta, classe, placa e ticket não é uma viagem (é um resumo/anotação ao lado)
    if (vazio(v.floresta) && vazio(v.classe) && vazio(v.placa) && vazio(v.ticket)) continue;

    const erros = [];
    const avisos = [];
    if (!data) erros.push('Data inválida ou vazia.');
    if (!Number.isFinite(peso) || peso <= 0) erros.push('Peso inválido ou vazio.');
    else if (peso > 80) erros.push(`Peso de ${peso} t não parece de uma carga (confira a vírgula).`);
    else if (peso < 5) avisos.push(`Peso baixo (${peso} t): confira.`);

    const nomeCliente = clienteFixo ? clienteFixo.nome
      : !vazio(v.cliente) ? v.cliente
        : opcoes.clienteOrigem === 'bloco' ? (b.bloco || opcoes.nomeAba) : opcoes.nomeAba;
    const cliente = clienteFixo ? { id: clienteFixo.id, nome: clienteFixo.nome } : resolver('cliente', nomeCliente, erros, avisos, true);
    const floresta = resolver('floresta', v.floresta, erros, avisos, true);
    let empreiteiro = null;
    if (!vazio(v.empreiteiro) && /[/&+]/.test(String(v.empreiteiro))) {
      avisos.push(`Carga dividida (${v.empreiteiro}): importada sem empreiteiro; divida depois na viagem.`);
    } else {
      empreiteiro = resolver('empreiteiro', v.empreiteiro, erros, avisos, false);
    }
    // Motorista: tem que estar cadastrado (ou ser criado como funcionário, com "criar cadastros").
    // Planilha antiga sem motorista na linha: importa sem (só a importação aceita).
    // Pela PLACA primeiro: na planilha pode vir só o 1º nome ou apelido.
    const placa = paraTexto(v.placa) ? paraTexto(v.placa).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    const dono = placa ? donoDaPlaca(mot, placa, data) : null;
    let motoristaRef = null;
    if (dono) {
      motoristaRef = { id: dono.id, nome: dono.nome };
      const escrito = paraTexto(v.motorista);
      const doNome = escrito ? mapaMotoristas.get(chaveNome(escrito)) : null;
      if (escrito && doNome && doNome.id !== dono.id) {
        avisos.push(`Na planilha o motorista é "${escrito}", mas a placa ${placa} é de ${dono.funcionario || dono.nome}: importada como ${dono.nome}.`);
      }
    } else {
      motoristaRef = vazio(v.motorista) ? null : resolver('motorista', paraTexto(v.motorista), erros, avisos, false);
      if (motoristaRef && motoristaRef.novo) {
        if (placa && !novosComPlaca.has(motoristaRef.novo)) novosComPlaca.set(motoristaRef.novo, placa);
        motoristaRef.placa = novosComPlaca.get(motoristaRef.novo) || null;
      }
      if (vazio(v.motorista)) avisos.push('Sem motorista na planilha: importada sem motorista.');
    }
    const classe = acharClasse(v.classe, cla.rows);
    if (classe && ['lixo', 'fina', 'media', 'grossa', 'eucal'].filter((k) => norm(v.classe).includes(k)).length > 1) {
      avisos.push(`Classe "${v.classe}" cita mais de uma: importada como ${classe.nome}.`);
    }
    if (!classe) erros.push(vazio(v.classe) ? 'Falta a classe.' : `Classe "${v.classe}" não reconhecida (use Lixo, Fina, Média, Grossa ou Eucalipto).`);

    const ticket = paraTexto(v.ticket);
    let valorTon = opcoes.usarValorDaPlanilha ? paraNumero(v.valor_tonelada) : NaN;
    if (!Number.isFinite(valorTon) || valorTon <= 0) valorTon = null;
    const totalPlanilha = paraNumero(v.valor_total);
    // Carga com valor fechado (R$/t vazio ou zero, só o total): calcula o R$/t
    if (!valorTon && opcoes.usarValorDaPlanilha && Number.isFinite(totalPlanilha) && totalPlanilha > 0 && Number.isFinite(peso) && peso > 0) {
      valorTon = Math.round((totalPlanilha / peso) * 100) / 100;
      avisos.push(`Valor fechado na planilha (R$ ${totalPlanilha.toFixed(2).replace('.', ',')}): importado como R$ ${valorTon.toFixed(2).replace('.', ',')}/t.`);
    }
    if (valorTon && Number.isFinite(peso) && Number.isFinite(totalPlanilha) && totalPlanilha > 0
      && Math.abs(Math.round(peso * valorTon * 100) / 100 - totalPlanilha) > Math.max(0.05, peso * 0.005 + 0.01)) {
      avisos.push(`Total da planilha (${totalPlanilha.toFixed(2)}) diferente de peso × valor (${(peso * valorTon).toFixed(2)}).`);
    }

    // Preços pagos (só se a planilha tiver as colunas)
    const compra = paraNumero(v.valor_floresta);
    const valorFloresta = Number.isFinite(compra) && compra >= 0 ? compra : null;
    const emp = paraNumero(v.valor_empreiteiro);
    const valorEmpreiteiro = empreiteiro && Number.isFinite(emp) && emp >= 0 ? emp : null;
    if (!valorTon) erros.push('Sem valor da tonelada: informe o valor de venda na planilha (coluna Vlr TON ou Vlr Total).');
    if (valorFloresta === null) avisos.push('Sem valor de compra da floresta: complete depois na viagem.');
    if (empreiteiro && valorEmpreiteiro === null) avisos.push('Sem valor do empreiteiro: complete depois na viagem.');

    // Duplicadas: mesmo ticket, ou mesma data + placa + peso
    let status = erros.length ? 'erro' : 'importar';
    const chave = data && Number.isFinite(peso) ? `${data}|${placa || ''}|${peso.toFixed(2)}` : null;
    if (status === 'importar') {
      if (ticket && existentes.tickets.has(ticket)) { status = 'duplicada'; avisos.unshift(`Ticket ${ticket} já está no sistema.`); }
      else if (chave && placa && existentes.chaves.has(chave)) { status = 'duplicada'; avisos.unshift('Já existe viagem com a mesma data, placa e peso.'); }
      else if (ticket && noArquivo.tickets.has(ticket)) { status = 'duplicada'; avisos.unshift(`Ticket ${ticket} repetido na planilha.`); }
      else if (chave && placa && noArquivo.chaves.has(chave)) { status = 'duplicada'; avisos.unshift('Repetida na planilha (mesma data, placa e peso).'); }
    }
    if (status === 'importar') { if (ticket) noArquivo.tickets.add(ticket); if (chave && placa) noArquivo.chaves.add(chave); }

    const hora = typeof v.hora === 'string' && /^\d{1,2}:\d{2}/.test(v.hora) ? v.hora.slice(0, 5) : null;
    const volume = paraNumero(v.volume_m3);
    const obs = paraTexto(v.observacoes) || null;
    const motorista = motoristaRef;

    linhas.push({
      linha: b.linha, bloco: b.bloco, status, erros, avisos,
      dados: {
        data, ticket, placa, peso: Number.isFinite(peso) ? peso : null, valor_tonelada: valorTon,
        cliente: cliente?.nome || (vazio(nomeCliente) ? null : String(nomeCliente)), floresta: floresta?.nome || paraTexto(v.floresta),
        empreiteiro: empreiteiro?.nome || null, classe: classe?.nome || paraTexto(v.classe), hora, motorista: motorista?.nome || null,
      },
      _gravar: { data, ticket, placa, peso, valorTon, valorFloresta, valorEmpreiteiro, cliente, floresta, empreiteiro, classe, hora, motorista, volume: Number.isFinite(volume) && volume > 0 ? volume : null, obs },
    });
  }

  // Cadastros novos só entram se alguma linha que vai ser importada usar
  const usados = { cliente: new Set(), floresta: new Set(), empreiteiro: new Set(), motorista: new Set() };
  linhas.filter((l) => l.status === 'importar').forEach((l) => {
    ['cliente', 'floresta', 'empreiteiro', 'motorista'].forEach((t) => { if (l._gravar[t]?.novo) usados[t].add(l._gravar[t].novo); });
  });
  const listaNovos = (t) => [...novos[t]].filter(([k]) => usados[t].has(k)).map(([, nome]) => nome);

  // Aba de EMPREITEIRO (ex.: CABEÇOTE): o "Vlr TON" dela é o preço de empreitada, não o de venda
  const alertas = [];
  const comEmpreiteiro = brutas.filter((b) => !vazio(b.valores.empreiteiro));
  if (!clienteFixo && comEmpreiteiro.length >= 2
    && comEmpreiteiro.filter((b) => chaveNome(b.valores.empreiteiro).includes(chaveNome(opcoes.nomeAba))).length / comEmpreiteiro.length >= 0.8) {
    alertas.push(`A aba "${opcoes.nomeAba}" parece ser de um EMPREITEIRO: os valores dela costumam ser de empreitada, não de venda. `
      + 'Importe as viagens pelas abas dos clientes (serrarias); as repetidas são ignoradas.');
  }

  return {
    alertas,
    linhas,
    resumo: {
      importar: linhas.filter((l) => l.status === 'importar').length,
      duplicadas: linhas.filter((l) => l.status === 'duplicada').length,
      erros: linhas.filter((l) => l.status === 'erro').length,
      toneladas: Math.round(linhas.filter((l) => l.status === 'importar').reduce((t, l) => t + l._gravar.peso, 0) * 100) / 100,
    },
    novos: { clientes: listaNovos('cliente'), florestas: listaNovos('floresta'), empreiteiros: listaNovos('empreiteiro'), motoristas: listaNovos('motorista') },
  };
}

// ---------------------------------------------------------------------
// FRETES (aba FRETES da planilha: Nº carga, Data, Cliente, Toneladas, Valor ton, Total)
//  - "BUTI/BALNEARIO" = cliente BUTI, destino BALNEARIO (se não houver coluna Destino)
//  - com Valor ton: cobrança por tonelada; só o Total: valor fechado
//  - sem valor nenhum: entra com R$ 0,00 (na planilha o valor costuma estar
//    somado em outra carga - assim o total do mês bate com o FECHAMENTO)
//  - "PAGO" na coluna ao lado: situação Pago
//  - o nº da carga é dado pelo sistema (na planilha cada bloco recomeça do 1)
// ---------------------------------------------------------------------
const FORMAS = ['À vista', 'Cheque', 'Boleto', 'PIX', 'Outro'];
async function analisarFretes(empresaId, brutas, opcoes) {
  const cli = await query('SELECT id, nome, ativo FROM clientes WHERE empresa_id = $1', [empresaId]);
  const indice = new Map(cli.rows.map((r) => [chaveNome(r.nome), r]));
  const clienteFixo = opcoes.clienteFixo ? cli.rows.find((c) => c.id === Number(opcoes.clienteFixo)) : null;
  const novos = new Map();

  // Fretes já lançados no período (duplicadas: mesma data, cliente e toneladas)
  const datas = brutas.map((b) => paraData(b.valores.data)).filter(Boolean);
  const existentes = new Set();
  if (datas.length) {
    const r = await query(
      `SELECT to_char(f.data,'YYYY-MM-DD') AS data, c.nome AS cliente, f.toneladas FROM fretes f JOIN clientes c ON c.id = f.cliente_id
        WHERE f.empresa_id = $1 AND f.status_pagamento <> 'Cancelado' AND f.data BETWEEN $2::date AND $3::date`,
      [empresaId, datas.reduce((a, b) => (a < b ? a : b)), datas.reduce((a, b) => (a > b ? a : b))]);
    r.rows.forEach((f) => existentes.add(`${f.data}|${chaveNome(f.cliente)}|${Number(f.toneladas).toFixed(2)}`));
  }
  const noArquivo = new Set();

  const linhas = [];
  for (const b of brutas) {
    const v = b.valores;
    const data = paraData(v.data);
    const ton = paraNumero(v.toneladas);
    // linha em branco do modelo (só o nº da carga, ou total 0): ignora em silêncio
    if (!data && (!Number.isFinite(ton) || ton === 0)) continue;

    const erros = [];
    const avisos = [];
    if (!data) erros.push('Data inválida ou vazia.');
    if (!Number.isFinite(ton) || ton <= 0) erros.push('Toneladas inválidas ou vazias.');
    else if (ton > 80) erros.push(`${ton} t não parece de uma carga (confira a vírgula).`);

    // Cliente e destino
    let nomeCliente = clienteFixo ? clienteFixo.nome : paraTexto(v.cliente);
    let destino = paraTexto(v.destino);
    let cliente = null;
    if (clienteFixo) cliente = { id: clienteFixo.id, nome: clienteFixo.nome };
    else if (vazio(nomeCliente)) erros.push('Falta o cliente.');
    else {
      let achado = indice.get(chaveNome(nomeCliente));
      const partes = String(nomeCliente).split(/\s*\/\s*|\s+[-–]\s+/);
      if (!achado && partes.length > 1) {
        // "BUTI/BALNEARIO": cliente antes da barra, destino depois
        achado = indice.get(chaveNome(partes[0])) || null;
        nomeCliente = partes[0].trim();
        if (!destino) destino = partes.slice(1).join(' / ').trim();
      }
      if (achado) {
        if (!achado.ativo) avisos.push(`Cliente "${achado.nome}" está inativo.`);
        cliente = { id: achado.id, nome: achado.nome };
      } else if (opcoes.criarCadastros) {
        const chave = chaveNome(nomeCliente);
        if (!novos.has(chave)) novos.set(chave, nomeCliente);
        cliente = { id: null, novo: chave, nome: nomeCliente };
      } else erros.push(`Cliente "${nomeCliente}" não está cadastrado.`);
    }

    // Valor: por tonelada, fechado ou nenhum
    let valorTon = paraNumero(v.valor_tonelada);
    if (!Number.isFinite(valorTon) || valorTon <= 0) valorTon = null;
    const total = paraNumero(v.valor_total);
    let valorFechado = null;
    if (valorTon) {
      if (Number.isFinite(ton) && Number.isFinite(total) && total > 0 && Math.abs(Math.round(ton * valorTon * 100) / 100 - total) > Math.max(0.05, ton * 0.005 + 0.01)) {
        avisos.push(`Total da planilha (${total.toFixed(2).replace('.', ',')}) diferente de toneladas × valor (${(ton * valorTon).toFixed(2).replace('.', ',')}).`);
      }
    } else if (Number.isFinite(total) && total > 0) {
      valorFechado = Math.round(total * 100) / 100;
      avisos.push('Valor fechado (só o total na planilha).');
    } else {
      valorFechado = 0;
      avisos.push('Sem valor na planilha: entra com R$ 0,00 (o valor pode estar somado em outra carga).');
    }

    // Situação e forma de pagamento
    const sit = norm(paraTexto(v.situacao));
    const pago = /^(pago|paga|recebido|ok|sim|quitado)/.test(sit);
    const formaTexto = norm(paraTexto(v.forma_pagamento));
    const forma = FORMAS.find((f) => norm(f) === formaTexto || (formaTexto && norm(f).startsWith(formaTexto))) || null;
    const obs = [paraTexto(v.observacoes), b.bloco && !/^fretes?$/i.test(b.bloco.trim()) ? b.bloco : null].filter(Boolean).join(' · ') || null;

    let status = erros.length ? 'erro' : 'importar';
    const chave = data && Number.isFinite(ton) && cliente ? `${data}|${chaveNome(cliente.nome)}|${ton.toFixed(2)}` : null;
    if (status === 'importar' && chave) {
      if (existentes.has(chave)) { status = 'duplicada'; avisos.unshift('Já existe frete deste cliente com a mesma data e toneladas.'); }
      else if (noArquivo.has(chave)) { status = 'duplicada'; avisos.unshift('Repetido na planilha (mesma data, cliente e toneladas).'); }
    }
    if (status === 'importar' && chave) noArquivo.add(chave);

    const valorTotal = valorTon && Number.isFinite(ton) ? Math.round(ton * valorTon * 100) / 100 : valorFechado;
    linhas.push({
      linha: b.linha, bloco: b.bloco, status, erros, avisos,
      dados: {
        data, cliente: cliente?.nome || paraTexto(v.cliente), destino, toneladas: Number.isFinite(ton) ? ton : null,
        valor_tonelada: valorTon, valor_fechado: valorFechado, valor_total: valorTotal, situacao: pago ? 'Pago' : 'Pendente',
      },
      _gravar: { data, cliente, destino: destino ? destino.slice(0, 100) : null, ton, valorTon, valorFechado, pago, forma, obs, valorTotal },
    });
  }

  const usados = new Set(linhas.filter((l) => l.status === 'importar' && l._gravar.cliente?.novo).map((l) => l._gravar.cliente.novo));
  const ok = linhas.filter((l) => l.status === 'importar');
  return {
    alertas: [],
    linhas,
    resumo: {
      importar: ok.length,
      duplicadas: linhas.filter((l) => l.status === 'duplicada').length,
      erros: linhas.filter((l) => l.status === 'erro').length,
      toneladas: Math.round(ok.reduce((t, l) => t + l._gravar.ton, 0) * 100) / 100,
      valor: Math.round(ok.reduce((t, l) => t + (l._gravar.valorTotal || 0), 0) * 100) / 100,
    },
    novos: { clientes: [...novos].filter(([k]) => usados.has(k)).map(([, nome]) => nome) },
  };
}

async function analisarCadastros(empresaId, brutas, tipo) {
  const tabela = { clientes: 'clientes', florestas: 'florestas', empreiteiros: 'empreiteiros' }[tipo];
  const temDoc = tipo !== 'florestas';
  const r = await query(`SELECT nome${temDoc ? ', cpf_cnpj' : ''} FROM ${tabela} WHERE empresa_id = $1`, [empresaId]);
  const nomes = new Set(r.rows.map((x) => chaveNome(x.nome)));
  const docs = new Set(r.rows.map((x) => x.cpf_cnpj).filter(Boolean));
  const noArquivo = new Set();
  const linhas = [];
  for (const b of brutas) {
    const v = b.valores;
    if (vazio(v.nome)) continue;
    const erros = [];
    const avisos = [];
    const nome = String(paraTexto(v.nome)).slice(0, 150);
    const dados = { nome };
    for (const campo of Object.keys(TIPOS[tipo].colunas)) if (campo !== 'nome') dados[campo] = paraTexto(v[campo]);
    if (dados.cpf_cnpj) {
      dados.cpf_cnpj = dados.cpf_cnpj.replace(/\D/g, '');
      if (dados.cpf_cnpj.length && dados.cpf_cnpj.length < 11) dados.cpf_cnpj = dados.cpf_cnpj.padStart(11, '0'); // Excel tira zeros à esquerda
      if (dados.cpf_cnpj.length === 12 || dados.cpf_cnpj.length === 13) dados.cpf_cnpj = dados.cpf_cnpj.padStart(14, '0');
      if (!documentoValido(dados.cpf_cnpj)) erros.push(`CPF/CNPJ ${v.cpf_cnpj} inválido.`);
    }
    if (dados.telefone) {
      dados.telefone = dados.telefone.replace(/\D/g, '');
      if (!telefoneValido(dados.telefone)) erros.push(`Telefone ${v.telefone} inválido (use DDD + número).`);
    }
    if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) erros.push(`E-mail ${dados.email} inválido.`);
    if (dados.estado) { dados.estado = dados.estado.toUpperCase(); if (!/^[A-Z]{2}$/.test(dados.estado)) erros.push('UF deve ter 2 letras (ex.: SC).'); }
    let status = erros.length ? 'erro' : 'importar';
    const chave = chaveNome(nome);
    if (status === 'importar') {
      if (nomes.has(chave)) { status = 'duplicada'; avisos.push('Já existe com este nome.'); }
      else if (dados.cpf_cnpj && docs.has(dados.cpf_cnpj)) { status = 'duplicada'; avisos.push('Já existe com este CPF/CNPJ.'); }
      else if (noArquivo.has(chave)) { status = 'duplicada'; avisos.push('Repetido na planilha.'); }
    }
    if (status === 'importar') noArquivo.add(chave);
    linhas.push({ linha: b.linha, status, erros, avisos, dados, _gravar: dados });
  }
  return {
    linhas,
    resumo: {
      importar: linhas.filter((l) => l.status === 'importar').length,
      duplicadas: linhas.filter((l) => l.status === 'duplicada').length,
      erros: linhas.filter((l) => l.status === 'erro').length,
    },
    novos: {},
  };
}

// ---------------------------------------------------------------------
// GRAVAÇÃO (tudo numa transação)
// ---------------------------------------------------------------------
async function gravar(empresaId, usuarioId, analise, origem) {
  const aGravar = analise.linhas.filter((l) => l.status === 'importar');
  if (!aGravar.length) return { importadas: 0, novos: { clientes: 0, florestas: 0, empreiteiros: 0, motoristas: 0 } };
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    let importadas = 0;
    const criados = { clientes: 0, florestas: 0, empreiteiros: 0, motoristas: 0 };

    if (analise.tipo === 'viagens') {
      // 1) cadastros novos (só os usados)
      const ids = { cliente: new Map(), floresta: new Map(), empreiteiro: new Map(), motorista: new Map() };
      const tabelas = { cliente: ['clientes', 'clientes', false], floresta: ['florestas', 'florestas', true], empreiteiro: ['empreiteiros', 'empreiteiros', true] };
      for (const l of aGravar) {
        for (const t of ['cliente', 'floresta', 'empreiteiro']) {
          const ref = l._gravar[t];
          if (!ref || !ref.novo || ids[t].has(ref.novo)) continue;
          const [tabela, conta, maiusculo] = tabelas[t];
          const r = await cliente.query(`INSERT INTO ${tabela} (empresa_id, nome) VALUES ($1, ${maiusculo ? 'upper($2)' : '$2'}) RETURNING id`, [empresaId, ref.nome]);
          ids[t].set(ref.novo, r.rows[0].id);
          criados[conta]++;
        }
        // motorista novo: vira FUNCIONÁRIO (cargo Motorista, salário zerado para completar) + nome nas cargas
        const ref = l._gravar.motorista;
        if (ref && ref.novo && !ids.motorista.has(ref.novo)) {
          const executar = (sql, p) => cliente.query(sql, p);
          const motoristaId = await idDoMotorista(executar, empresaId, ref.nome);
          // a placa da 1ª carga dele na planilha (se nenhum outro motorista já tem)
          if (ref.placa && placaValida(ref.placa)) {
            await cliente.query(
              `UPDATE motoristas m SET placa = $1 WHERE m.id = $2 AND m.placa IS NULL
                  AND NOT EXISTS (SELECT 1 FROM motoristas o WHERE o.empresa_id = m.empresa_id AND o.placa = $1 AND o.id <> m.id)`,
              [ref.placa, motoristaId]);
            await cliente.query(
              `INSERT INTO motorista_placas (empresa_id, motorista_id, placa)
               SELECT $1, m.id, m.placa FROM motoristas m
                WHERE m.id = $2 AND m.placa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM motorista_placas x WHERE x.motorista_id = m.id)`,
              [empresaId, motoristaId]);
          }
          const ligado = await cliente.query('SELECT 1 FROM funcionarios WHERE motorista_id = $1', [motoristaId]);
          if (!ligado.rowCount) {
            await cliente.query(
              `INSERT INTO funcionarios (empresa_id, nome, cargo, salario_base, observacoes, motorista_id)
               VALUES ($1, $2, 'Motorista', 0, $3, $4)`,
              [empresaId, ref.nome, `Criado pela importação de ${origem}: complete salário, CPF, a placa e as faixas de comissão.`, motoristaId]);
          }
          ids.motorista.set(ref.novo, motoristaId);
          criados.motoristas++;
        }
      }
      // 2) viagens em ordem de data (o nº da viagem segue a sequência do mês de cada cliente)
      const ordenadas = [...aGravar].sort((a, b) => (a._gravar.data < b._gravar.data ? -1 : a._gravar.data > b._gravar.data ? 1 : a.linha - b.linha));
      for (const l of ordenadas) {
        const g = l._gravar;
        const id = (t) => (g[t] ? g[t].id || ids[t].get(g[t].novo) : null);
        const obs = [g.obs, `Importada de ${origem} (linha ${l.linha})`].filter(Boolean).join(' · ');
        await cliente.query(
          `INSERT INTO viagens (empresa_id, numero_viagem, data, ticket, placa, cliente_id, floresta_id, empreiteiro_id, classe_id,
                                peso_liquido, valor_tonelada, hora_pesagem, volume_m3, observacoes, criado_por, motorista_id,
                                valor_ton_floresta, valor_ton_empreiteiro)
           VALUES ($1, (SELECT (COALESCE(MAX(numero_viagem::int), 0) + 1)::text FROM viagens
                         WHERE empresa_id = $1 AND cliente_id = $5 AND numero_viagem ~ '^[0-9]+$'
                           AND date_trunc('month', data) = date_trunc('month', $2::date)),
                   $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [empresaId, g.data, g.ticket, g.placa, id('cliente'), id('floresta'), id('empreiteiro'), g.classe.id,
            g.peso, g.valorTon, g.hora, g.volume, obs.slice(0, 2000), usuarioId,
            g.motorista ? (g.motorista.id || ids.motorista.get(g.motorista.novo)) : null,
            g.valorFloresta ?? null, g.valorEmpreiteiro ?? null]
        );
        importadas++;
      }
    } else if (analise.tipo === 'fretes') {
      // 1) clientes novos (só os usados)
      const ids = new Map();
      for (const l of aGravar) {
        const ref = l._gravar.cliente;
        if (!ref || !ref.novo || ids.has(ref.novo)) continue;
        const r = await cliente.query('INSERT INTO clientes (empresa_id, nome) VALUES ($1, $2) RETURNING id', [empresaId, ref.nome]);
        ids.set(ref.novo, r.rows[0].id);
        criados.clientes++;
      }
      // 2) fretes em ordem de data (o nº da carga segue a sequência do mês)
      const ordenadas = [...aGravar].sort((a, b) => (a._gravar.data < b._gravar.data ? -1 : a._gravar.data > b._gravar.data ? 1 : a.linha - b.linha));
      for (const l of ordenadas) {
        const g = l._gravar;
        const obs = [g.obs, `Importado de ${origem} (linha ${l.linha})`].filter(Boolean).join(' · ');
        await cliente.query(
          `INSERT INTO fretes (empresa_id, numero_carga, data, cliente_id, destino, toneladas, valor_tonelada, valor_fechado,
                               forma_pagamento, status_pagamento, data_pagamento, observacoes, criado_por)
           VALUES ($1, (SELECT (COALESCE(MAX(numero_carga::int), 0) + 1)::text FROM fretes
                         WHERE empresa_id = $1 AND numero_carga ~ '^[0-9]+$'
                           AND date_trunc('month', data) = date_trunc('month', $2::date)),
                   $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [empresaId, g.data, g.cliente.id || ids.get(g.cliente.novo), g.destino, g.ton, g.valorTon, g.valorFechado,
            g.forma, g.pago ? 'Pago' : 'Pendente', g.pago ? g.data : null, obs.slice(0, 2000), usuarioId]
        );
        importadas++;
      }
    } else {
      const sql = {
        clientes: ['INSERT INTO clientes (empresa_id, nome, razao_social, cpf_cnpj, telefone, email, cidade, estado, observacoes) VALUES ($1,$2,$3,$4,$5,lower($6),$7,$8,$9)',
          (d) => [d.nome, d.razao_social, d.cpf_cnpj || null, d.telefone || null, d.email, d.cidade, d.estado, d.observacoes]],
        florestas: ['INSERT INTO florestas (empresa_id, nome, proprietario, municipio, estado, observacoes) VALUES ($1,upper($2),$3,$4,$5,$6)',
          (d) => [d.nome, d.proprietario, d.municipio, d.estado, d.observacoes]],
        empreiteiros: ['INSERT INTO empreiteiros (empresa_id, nome, cpf_cnpj, telefone, observacoes) VALUES ($1,upper($2),$3,$4,$5)',
          (d) => [d.nome, d.cpf_cnpj || null, d.telefone || null, d.observacoes]],
      }[analise.tipo];
      for (const l of aGravar) { await cliente.query(sql[0], [empresaId, ...sql[1](l._gravar)]); importadas++; }
    }
    await cliente.query('COMMIT');
    return { importadas, novos: criados };
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

// Tira os campos internos antes de mandar para a tela
const paraTela = (analise) => ({ ...analise, linhas: analise.linhas.map(({ _gravar, ...l }) => l) });

module.exports = { analisar, gravar, paraTela, TIPOS, norm };
