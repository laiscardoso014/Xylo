// =====================================================================
// Xylo na AWS - pontos de entrada dos microsserviços (AWS Lambda)
//
// Um só pacote (.zip) com o backend, publicado em 4 funções Lambda.
// Cada função usa um "handler" diferente (campo Handler no console):
//
//   xylo-api      lambda.api      API do sistema (login, viagens, relatórios...)
//                                 chamada pela Function URL, atrás do CloudFront
//   xylo-ia       lambda.api      o mesmo código, mas recebe só /api/tickets e
//                                 /api/assistente (IA): tempo limite maior e mais
//                                 memória, sem atrasar o resto do sistema
//   xylo-rotinas  lambda.rotinas  agendada (EventBridge Scheduler): gera as
//                                 faturas da mensalidade no dia configurado
//   xylo-backup   lambda.backup   agendada todo dia: copia o banco inteiro
//                                 para o S3 (BACKUP_BUCKET), um arquivo por dia
//
// As páginas (pasta frontend) ficam no S3 e são entregues pelo CloudFront,
// que manda tudo o que começa com /api/ para estas funções.
// O banco continua no Neon (PostgreSQL).
// =====================================================================
const http = require('http');
const zlib = require('zlib');
const path = require('path');

// No computador (para testar) lê o .env; na AWS as variáveis vêm da configuração da função
try { require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true }); } catch { /* sem dotenv: ok */ }
// TZ é reservada no Lambda (sempre UTC); o Node aceita trocar aqui, antes de qualquer data
process.env.TZ = process.env.FUSO_HORARIO || 'America/Sao_Paulo';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1'; // o IP de verdade vem no X-Forwarded-For

let servidor = null;  // o Express sobe UMA vez por contêiner (cold start) e é reaproveitado
let porta = null;

function subirExpress() {
  if (servidor) return servidor;
  servidor = new Promise((ok, falha) => {
    const app = require('./src/app');
    const s = http.createServer(app);
    s.keepAliveTimeout = 60e3;
    s.listen(0, '127.0.0.1', () => { porta = s.address().port; ok(); });
    s.on('error', falha);
    // confere o banco (migrações) sem atrasar a primeira resposta
    require('./src/config/conferirBanco').conferirBanco().catch(() => {});
  });
  return servidor;
}

// Tipos de resposta que vão como texto; o resto (Excel, imagens) vai em base64
const TEXTO = /^(text\/|application\/(json|javascript|xml)|image\/svg)/i;

// ---------------------------------------------------------------------
// xylo-api e xylo-ia: evento da Function URL (formato 2.0) -> Express
// ---------------------------------------------------------------------
async function api(evento) {
  await subirExpress();
  const ctx = evento.requestContext || {};
  const metodo = (ctx.http && ctx.http.method) || evento.httpMethod || 'GET';
  const caminho = (evento.rawPath || evento.path || '/') + (evento.rawQueryString ? `?${evento.rawQueryString}` : '');
  const corpo = evento.body ? Buffer.from(evento.body, evento.isBase64Encoded ? 'base64' : 'utf8') : null;

  const cabecalhos = {};
  for (const [k, v] of Object.entries(evento.headers || {})) cabecalhos[k.toLowerCase()] = v;

  // Só o CloudFront pode chamar esta função: ele envia um cabeçalho secreto
  // (configurado na origem do CloudFront). Quem tentar o endereço da função direto leva 403.
  const segredo = process.env.ORIGEM_SEGREDO;
  if (segredo && cabecalhos['x-xylo-origem'] !== segredo) {
    return { statusCode: 403, headers: { 'content-type': 'application/json' }, body: '{"erro":"Acesso direto não permitido."}' };
  }
  delete cabecalhos['x-xylo-origem'];

  if (evento.cookies && evento.cookies.length) cabecalhos.cookie = evento.cookies.join('; ');
  // IP do visitante: o CloudFront ACRESCENTA o IP real no fim do X-Forwarded-For
  // (o que vier antes pode ter sido inventado por quem chamou). Se o próprio Lambda
  // tiver acrescentado o IP do CloudFront, ele é descartado.
  const ipChamador = (ctx.http && ctx.http.sourceIp) || '';
  const lista = String(cabecalhos['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (lista.length > 1 && lista[lista.length - 1] === ipChamador) lista.pop();
  const ipVisitante = lista[lista.length - 1] || ipChamador;
  if (ipVisitante) cabecalhos['x-forwarded-for'] = ipVisitante;
  delete cabecalhos['content-length'];
  if (corpo) cabecalhos['content-length'] = String(corpo.length);

  const resposta = await new Promise((ok, falha) => {
    const r = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabecalhos }, (res) => {
      const partes = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }));
    });
    r.on('error', falha);
    if (corpo) r.write(corpo);
    r.end();
  });

  const headers = {};
  const cookies = [];
  for (const [k, v] of Object.entries(resposta.headers)) {
    if (k === 'set-cookie') cookies.push(...[].concat(v));
    else if (!['connection', 'transfer-encoding', 'keep-alive'].includes(k)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  const texto = TEXTO.test(headers['content-type'] || 'text/plain');
  return {
    statusCode: resposta.status,
    headers,
    ...(cookies.length ? { cookies } : {}),
    body: resposta.corpo.toString(texto ? 'utf8' : 'base64'),
    isBase64Encoded: !texto,
  };
}

// ---------------------------------------------------------------------
// xylo-rotinas: faturas da mensalidade (o agendamento chama 1x por dia)
// ---------------------------------------------------------------------
async function rotinas() {
  const { gerarAutomatico } = require('./src/faturas/faturas');
  const r = await gerarAutomatico();
  const resumo = r ? { competencia: r.competencia, criadas: r.criadas.length } : { criadas: 0, motivo: 'nada a gerar hoje (ou geração automática desligada no painel)' };
  console.log('[rotinas]', JSON.stringify(resumo));
  return resumo;
}

// ---------------------------------------------------------------------
// xylo-backup: copia TODAS as tabelas para o S3
//   s3://BACKUP_BUCKET/backups/AAAA/MM/xylo-AAAA-MM-DD.json.gz
// O próprio PostgreSQL gera o JSON (datas e números exatamente como estão).
// O arquivo é .json.gz comum: abre com 7-Zip/WinRAR e qualquer editor de texto.
// Restaurar: backend/database/restaurar-backup.js (ver AWS.md).
// Para testar no computador sem AWS: BACKUP_PASTA_LOCAL=c:\pasta
// ---------------------------------------------------------------------
async function gerarBackup() {
  const { query } = require('./src/config/db');
  const { rows: tabelas } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`);
  // Cada tabela fica guardada como o TEXTO JSON exato que o PostgreSQL gerou
  // (sem passar pelo JavaScript): números como 0.00 e datas voltam idênticos.
  const dados = {};
  let linhas = 0;
  for (const { table_name: t } of tabelas) {
    const { rows } = await query(`SELECT COALESCE(json_agg(x), '[]')::text AS j, count(*)::int AS n FROM "${t.replace(/"/g, '')}" x`);
    dados[t] = rows[0].j;
    linhas += rows[0].n;
  }
  const agora = new Date();
  const dia = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const conteudo = { sistema: 'Xylo', formato: 2, gerado_em: agora.toISOString(), tabelas: dados };
  return { dia, linhas, tabelas: tabelas.length, gz: zlib.gzipSync(Buffer.from(JSON.stringify(conteudo)), { level: 9 }) };
}

async function backup() {
  const b = await gerarBackup();
  const nome = `backups/${b.dia.slice(0, 4)}/${b.dia.slice(5, 7)}/xylo-${b.dia}.json.gz`;
  if (process.env.BACKUP_PASTA_LOCAL) {
    const fs = require('fs');
    const destino = path.join(process.env.BACKUP_PASTA_LOCAL, path.basename(nome));
    fs.writeFileSync(destino, b.gz);
    console.log(`[backup] ${b.tabelas} tabelas, ${b.linhas} linhas -> ${destino}`);
    return { arquivo: destino, linhas: b.linhas, bytes: b.gz.length };
  }
  if (!process.env.BACKUP_BUCKET) throw new Error('Falta a variável BACKUP_BUCKET (nome do bucket S3 dos backups).');
  // O SDK da AWS já vem no ambiente Node.js do Lambda (não precisa instalar)
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  await new S3Client({}).send(new PutObjectCommand({
    Bucket: process.env.BACKUP_BUCKET, Key: nome, Body: b.gz,
    ContentType: 'application/json', ContentEncoding: 'gzip', ServerSideEncryption: 'AES256',
  }));
  console.log(`[backup] ${b.tabelas} tabelas, ${b.linhas} linhas, ${(b.gz.length / 1024).toFixed(1)} KB -> s3://${process.env.BACKUP_BUCKET}/${nome}`);
  return { arquivo: `s3://${process.env.BACKUP_BUCKET}/${nome}`, linhas: b.linhas, bytes: b.gz.length };
}

module.exports = { api, rotinas, backup, gerarBackup };
