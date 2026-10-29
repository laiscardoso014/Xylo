// =====================================================================
// FATURAS DA MENSALIDADE DO XYLO
//
// Cada empresa tem um valor mensal (empresas.mensalidade) e um dia de
// vencimento. "Gerar faturas do mês" cria UMA fatura por empresa ativa
// com mensalidade (quem já tem a do mês fica de fora: pode clicar de novo
// sem duplicar). Cada fatura guarda o seu PIX copia-e-cola.
//
// Situação: Aberta | Paga | Cancelada  (+ "Vencida" = aberta e passou do
// vencimento: é calculada, não fica gravada)
// =====================================================================
const { pool, query } = require('../config/db');
const { montarPix } = require('./pix');
const { enviarEmail } = require('../conta/smtp');
const { moldura, esc, urlDoSistema } = require('../conta/emails');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeDoMes = (iso) => { const [a, m] = String(iso).slice(0, 7).split('-'); return `${MESES[Number(m) - 1]}/${a}`; };
const moeda = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

// Colunas da fatura para as telas (situacao já considera o vencimento)
const CAMPOS = `f.id, f.empresa_id, e.nome AS empresa, e.cnpj, f.numero, to_char(f.competencia, 'YYYY-MM') AS competencia,
  f.descricao, f.valor::float AS valor, to_char(f.vencimento, 'YYYY-MM-DD') AS vencimento, f.status,
  CASE WHEN f.status = 'Aberta' AND f.vencimento < current_date THEN 'Vencida' ELSE f.status END AS situacao,
  (current_date - f.vencimento) AS dias_atraso,
  f.informado_em, to_char(f.pago_em, 'YYYY-MM-DD') AS pago_em, f.valor_pago::float AS valor_pago, f.obs_pagamento,
  f.cancelada_motivo, f.email_enviado_em, f.gerada_por, f.created_at`;

// ---------------------------------------------------------------------
// Configuração de quem recebe (CTech)
// ---------------------------------------------------------------------
async function lerConfig(executar = query) {
  const { rows } = await executar('SELECT * FROM cobranca_config WHERE id = 1');
  return rows[0] || {};
}
function faltaNaConfig(c) {
  const falta = [];
  if (!c.chave_pix) falta.push('chave PIX');
  if (!c.recebedor_nome) falta.push('nome de quem recebe');
  if (!c.cidade) falta.push('cidade');
  return falta;
}

// "2026-11" -> "2026-11-01" (valida)
function competenciaISO(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    const erro = new Error('Mês inválido (use AAAA-MM).');
    erro.status = 400;
    throw erro;
  }
  return `${m[1]}-${m[2]}-01`;
}

// ---------------------------------------------------------------------
// Gera as faturas de um mês.
//   mes: 'AAAA-MM' · opcoes: { empresaId (só uma), origem: 'manual'|'automatico', valor, descricao }
// -> { criadas: [...], ja_tinham: n, sem_mensalidade: [...nomes] }
// ---------------------------------------------------------------------
async function gerarDoMes(mes, { empresaId = null, origem = 'manual', valor = null, descricao = null } = {}) {
  const competencia = competenciaISO(mes);
  const c = await pool.connect();
  const criadas = [];
  let jaTinham = 0;
  let semMensalidade = [];
  try {
    await c.query('BEGIN');
    // uma geração por vez (o agendador e o botão não se atropelam)
    await c.query('SELECT pg_advisory_xact_lock(87001)');
    const cfg = await lerConfig((t, p) => c.query(t, p));
    const falta = faltaNaConfig(cfg);
    if (falta.length) {
      const erro = new Error(`Antes de gerar, preencha em "Dados para receber": ${falta.join(', ')}.`);
      erro.status = 400;
      throw erro;
    }
    const { rows: empresas } = await c.query(
      `SELECT e.id, e.nome, e.mensalidade::float AS mensalidade, e.dia_vencimento,
              EXISTS (SELECT 1 FROM faturas f WHERE f.empresa_id = e.id AND f.competencia = $1 AND f.status <> 'Cancelada') AS ja_tem,
              -- vencimento: dia escolhido do mês; se já passou ou está muito perto, 5 dias a partir de hoje
              GREATEST(make_date(EXTRACT(YEAR FROM $1::date)::int, EXTRACT(MONTH FROM $1::date)::int, e.dia_vencimento),
                       current_date + 5) AS vencimento
         FROM empresas e
        WHERE e.ativo AND ($2::int IS NULL OR e.id = $2)
          AND (e.cobrar_desde IS NULL OR e.cobrar_desde <= $1)
        ORDER BY e.nome`, [competencia, empresaId]);
    if (empresaId && !empresas.length) {
      const erro = new Error('Empresa não encontrada, bloqueada ou ainda não é cobrada neste mês.');
      erro.status = 404;
      throw erro;
    }
    const recebedor = {
      nome: cfg.recebedor_nome, documento: cfg.recebedor_doc, chave: cfg.chave_pix, tipo_chave: cfg.tipo_chave,
      cidade: cfg.cidade, email: cfg.email_contato, whatsapp: cfg.whatsapp, instrucoes: cfg.instrucoes,
    };
    for (const e of empresas) {
      if (e.ja_tem) { jaTinham++; continue; }
      const valorFatura = valor !== null && empresaId ? Number(valor) : e.mensalidade;
      if (!valorFatura || valorFatura <= 0) { semMensalidade.push(e.nome); continue; }
      const id = Number((await c.query("SELECT nextval(pg_get_serial_sequence('faturas', 'id')) AS id")).rows[0].id);
      const numero = `${competencia.slice(0, 4)}${competencia.slice(5, 7)}${String(id).padStart(5, '0')}`;
      const pix = montarPix({
        chave: cfg.chave_pix, nome: cfg.recebedor_nome, cidade: cfg.cidade, valor: valorFatura,
        txid: `XYLO${numero}`, mensagem: `Xylo ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
      });
      const { rows } = await c.query(
        `INSERT INTO faturas (id, empresa_id, numero, competencia, descricao, valor, vencimento, pix_copia_cola, recebedor, gerada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [id, e.id, numero, competencia, descricao || `Mensalidade do Xylo - ${nomeDoMes(competencia)}`, valorFatura,
          e.vencimento, pix, JSON.stringify(recebedor), origem]);
      criadas.push(rows[0].id);
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
  if (empresaId) semMensalidade = semMensalidade.length ? semMensalidade : [];
  const lista = criadas.length ? (await query(`SELECT ${CAMPOS} FROM faturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = ANY($1) ORDER BY e.nome`, [criadas])).rows : [];
  return { competencia: competencia.slice(0, 7), criadas: lista, ja_tinham: jaTinham, sem_mensalidade: semMensalidade };
}

// ---------------------------------------------------------------------
// E-mail da fatura para os administradores da empresa (ativos e confirmados)
// -> { enviados: [...e-mails], modo_teste?: true, erro? }
// ---------------------------------------------------------------------
async function enviarFaturaPorEmail(faturaId) {
  const f = (await query(`SELECT ${CAMPOS}, f.pix_copia_cola, f.recebedor FROM faturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = $1`, [faturaId])).rows[0];
  if (!f) return { enviados: [] };
  const { rows: admins } = await query(
    `SELECT u.nome, u.email FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
      WHERE u.empresa_id = $1 AND p.nome = 'Administrador' AND u.ativo AND u.email_confirmado_em IS NOT NULL`, [f.empresa_id]);
  if (!admins.length) return { enviados: [], erro: 'A empresa não tem administrador ativo com e-mail confirmado.' };
  const link = `${urlDoSistema()}/main.html#financeiro`;
  const assunto = `Fatura do Xylo - ${nomeDoMes(f.competencia)} - ${moeda(f.valor)}`;
  const enviados = [];
  try {
    for (const a of admins) {
      const nome = a.nome.split(/\s+/)[0];
      const html = moldura({
        titulo: `Fatura de ${nomeDoMes(f.competencia)}`,
        paragrafos: [
          `Olá, <strong>${esc(nome)}</strong>!`,
          `A fatura do Xylo da empresa <strong>${esc(f.empresa)}</strong> já está disponível.`,
          `<strong>Valor:</strong> ${esc(moeda(f.valor))}<br><strong>Vencimento:</strong> ${esc(dataBR(f.vencimento))}<br><strong>Fatura nº:</strong> ${esc(f.numero)}`,
          `Pague pelo PIX: abra a fatura no sistema e leia o QR Code, ou copie o código abaixo em "PIX copia e cola" no app do seu banco:<br>
           <span style="display:block;margin-top:6px;padding:10px;border:1px dashed #9ca3af;border-radius:8px;font-family:monospace;font-size:12px;word-break:break-all;color:#111827">${esc(f.pix_copia_cola)}</span>`,
        ],
        botao: 'Ver a fatura no Xylo', link,
        rodape: `Recebedor: ${esc(f.recebedor.nome)}. Depois de pagar, você pode clicar em "Já paguei" na aba Financeiro.`,
      });
      const texto = `Olá, ${nome}!\n\nA fatura do Xylo da empresa ${f.empresa} (${nomeDoMes(f.competencia)}) está disponível.\nValor: ${moeda(f.valor)}\nVencimento: ${dataBR(f.vencimento)}\nFatura nº ${f.numero}\n\nPIX copia e cola:\n${f.pix_copia_cola}\n\nVer a fatura: ${link}\n\nXylo · CTech Sistemas`;
      const r = await enviarEmail({ para: a.email, assunto, texto, html });
      if (r.motivo === 'nao_configurado') {
        console.log(`\n✉  [modo teste] Fatura ${f.numero} para ${a.email}: ${moeda(f.valor)}, vence ${dataBR(f.vencimento)}\n`);
        return { enviados: [], modo_teste: true };
      }
      enviados.push(a.email);
    }
    await query('UPDATE faturas SET email_enviado_em = now() WHERE id = $1', [faturaId]);
    return { enviados };
  } catch (err) {
    console.error(`[fatura ${f.numero}] e-mail falhou:`, err.message);
    return { enviados, erro: err.message };
  }
}

// ---------------------------------------------------------------------
// Geração automática: confere de hora em hora; no dia escolhido (ou
// depois), gera as faturas do mês que ainda não existem e manda os e-mails.
// ---------------------------------------------------------------------
let ultimaChecagem = null;
async function gerarAutomatico() {
  try {
    const cfg = await lerConfig();
    if (!cfg.gerar_automatico || faltaNaConfig(cfg).length) return null;
    const { rows } = await query("SELECT to_char(current_date, 'YYYY-MM') AS mes, EXTRACT(DAY FROM current_date)::int AS dia");
    if (rows[0].dia < cfg.dia_geracao) return null;
    const r = await gerarDoMes(rows[0].mes, { origem: 'automatico' });
    for (const f of r.criadas) await enviarFaturaPorEmail(f.id);
    if (r.criadas.length) console.log(`🧾 Faturas de ${r.competencia} geradas automaticamente: ${r.criadas.length}`);
    ultimaChecagem = new Date();
    return r;
  } catch (err) {
    if (!/42P01|42703/.test(err.code || '')) console.error('[faturas] geração automática falhou:', err.message);
    return null;
  }
}
function iniciarAgendador() {
  setTimeout(gerarAutomatico, 15e3).unref();
  setInterval(gerarAutomatico, 60 * 60e3).unref();
}

module.exports = {
  CAMPOS, lerConfig, faltaNaConfig, competenciaISO, gerarDoMes, enviarFaturaPorEmail, gerarAutomatico, iniciarAgendador,
  nomeDoMes, moeda, dataBR, ultima: () => ultimaChecagem,
};
