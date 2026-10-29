// =====================================================================
// TICKETS DE PESAGEM - preenchimento automático da viagem
//
//   GET  /api/tickets/status  -> a leitura por foto está disponível? (IA com visão)
//   POST /api/tickets/ler     -> corpo = a FOTO (bytes jpeg/png/webp, até 5 MB)
//   POST /api/tickets/texto   -> { texto } colado (ex.: "copiar texto" do celular)
//   ?para=fretes (ou { para: 'fretes' }) -> preenche um FRETE em vez de uma viagem
//
// Nada é gravado aqui: a resposta só PREENCHE o formulário de Nova viagem,
// e o usuário confere e salva. A foto não fica guardada no servidor.
// Só Administrador e Financeiro (quem lança viagens).
// =====================================================================
const express = require('express');
const { autenticar, podeEditar } = require('../middlewares/auth');
const { configuracoes, lerImagem, pausar, emPausa, explicarErro, motivoSemIA } = require('../assistente/provedores');
const { INSTRUCAO, extrairJSON, lerPorRotulos, normalizar, ligarCadastros, ligarFrete } = require('../tickets/leitor');

// Para qual tela? ?para=viagens (padrão) ou ?para=fretes
const ligar = (req, lido) => (req.query.para === 'fretes' || req.body?.para === 'fretes'
  ? ligarFrete(req.usuario.empresaId, lido)
  : ligarCadastros(req.usuario.empresaId, lido));

const router = express.Router();
router.use(autenticar, podeEditar);

const LIMITE_POR_JANELA = 20;          // leituras de foto por usuário...
const JANELA_MS = 10 * 60 * 1000;      // ...a cada 10 minutos (planos grátis das IAs)
const usos = new Map();
function dentroDoLimite(usuarioId) {
  const agora = Date.now();
  const recentes = (usos.get(usuarioId) || []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length >= LIMITE_POR_JANELA) { usos.set(usuarioId, recentes); return false; }
  recentes.push(agora);
  usos.set(usuarioId, recentes);
  return true;
}

// Tipo da imagem pelos primeiros bytes (não confia no nome do arquivo)
function tipoImagem(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

router.get('/status', (req, res) => {
  const lista = configuracoes();
  res.json({ foto: lista.length > 0, provedores: lista.map((c) => c.nome), motivo: lista.length ? null : motivoSemIA() });
});

router.post('/ler', express.raw({ type: () => true, limit: '5mb' }), async (req, res, next) => {
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ erro: 'Envie a foto do ticket.' });
    const mime = tipoImagem(buf);
    if (!mime) return res.status(400).json({ erro: 'Formato de imagem não aceito. Use JPG, PNG ou WEBP.' });

    const lista = configuracoes();
    if (!lista.length) {
      return res.status(503).json({ erro: `A leitura por foto precisa da IA configurada no servidor. ${motivoSemIA()}` });
    }
    if (!dentroDoLimite(req.usuario.id)) {
      return res.status(429).json({ erro: 'Muitas leituras seguidas. Espere alguns minutos ou digite os dados.' });
    }

    const base64 = buf.toString('base64');
    let resposta = null; let falhas = [];
    for (const cfg of lista) {
      const pausa = emPausa(cfg);
      if (pausa) { falhas.push(`${explicarErro(cfg, { pausa: pausa.motivo, testados: pausa.testados })} (em pausa)`); continue; }
      try {
        const texto = await lerImagem(cfg, { instrucao: INSTRUCAO, base64, mime });
        const json = extrairJSON(texto);
        if (json) { resposta = { json, provedor: cfg.nome }; break; }
        falhas.push(`${cfg.nome}: resposta sem os dados`);
      } catch (err) {
        pausar(cfg, err);
        console.error(`[tickets] ${cfg.nome}:`, err.status || '', err.message);
        falhas.push(explicarErro(cfg, err));
      }
    }
    if (!resposta) {
      return res.status(502).json({ erro: `Não foi possível ler a foto agora: ${falhas.join('; ')}. Cole o texto ou digite os dados.`, detalhes: falhas });
    }
    if (resposta.json.legivel === false) {
      return res.status(422).json({ erro: 'A foto não parece um ticket de pesagem legível. Tire outra foto, mais de perto e com luz.' });
    }

    const lido = normalizar(resposta.json);
    const r = await ligar(req, lido);
    res.json({ ...r, fonte: `da foto · ${resposta.provedor}` });
  } catch (err) {
    next(err);
  }
});

router.post('/texto', async (req, res, next) => {
  try {
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.slice(0, 5000) : '';
    if (texto.trim().length < 5) return res.status(400).json({ erro: 'Cole o texto do ticket.' });
    const brutos = { ...lerPorRotulos(texto), texto };
    const lido = normalizar(brutos);
    if (!lido.ticket && !lido.peso_liquido && !lido.placa) {
      return res.status(422).json({ erro: 'Não encontrei ticket, placa nem peso nesse texto. Confira se colou o ticket inteiro.' });
    }
    const r = await ligar(req, lido);
    res.json({ ...r, fonte: 'do texto colado' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
