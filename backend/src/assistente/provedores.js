// =====================================================================
// PROVEDORES DE IA do assistente
//
// Escolha no .env com ASSISTENTE_PROVEDOR:
//
//   groq      GRÁTIS (sem cartão). Rápido; não guarda os dados por padrão.  <- recomendado
//             Chave em https://console.groq.com/keys
//   gemini    GRÁTIS (sem cartão). No plano grátis o Google pode usar as
//             perguntas para melhorar os produtos dele.
//             Chave em https://aistudio.google.com/apikey
//   ollama    GRÁTIS e offline: a IA roda no próprio computador/servidor
//             (https://ollama.com). Não precisa de chave.
//   anthropic Claude (pago por uso). Chave em https://console.anthropic.com
//   (vazio)   sem IA: o assistente responde no modo básico (palavras-chave)
//
// RESERVA (opcional): ASSISTENTE_RESERVA=gemini + ASSISTENTE_RESERVA_CHAVE.
// Se a principal falhar (limite grátis, fora do ar, chave errada), a pergunta
// vai para a reserva; só se as duas falharem o assistente usa o modo básico.
//
// Groq, Gemini e Ollama usam o mesmo formato ("compatível com OpenAI"),
// então um único código atende os três.
//
// MODELOS DESATIVADOS: os provedores aposentam modelos de tempos em tempos
// (ex.: a Groq desligou o llama-3.3-70b-versatile em 16/08/2026). Por isso
// cada provedor tem uma LISTA de modelos: se o primeiro foi desativado, o
// sistema passa sozinho para o próximo e lembra qual funcionou. O modelo do
// .env (ASSISTENTE_MODELO), se houver, é tentado primeiro.
// =====================================================================

const PADROES = {
  groq: {
    nome: 'Groq', artigo: 'a',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelo: 'openai/gpt-oss-120b',
    modelos: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    modeloVisao: 'qwen/qwen3.8-27b',          // lê imagens (ticket de pesagem)
    modelosVisao: ['qwen/qwen3.8-27b'],
    gratuito: true,
    formato: 'openai',
  },
  gemini: {
    nome: 'Gemini', artigo: 'o',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelo: 'gemini-3.8-flash',
    modelos: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'],
    modeloVisao: 'gemini-3.8-flash',          // o mesmo modelo lê imagens
    modelosVisao: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'],
    gratuito: true,
    formato: 'openai',
  },
  ollama: {
    nome: 'Ollama (local)', artigo: 'o',
    url: 'http://localhost:11434/v1/chat/completions',
    modelo: 'qwen2.5:7b',
    modelos: ['qwen2.5:7b'],
    modeloVisao: 'qwen2.5vl:7b',              // precisa: ollama pull qwen2.5vl:7b
    modelosVisao: ['qwen2.5vl:7b'],
    gratuito: true,
    semChave: true,
    formato: 'openai',
  },
  anthropic: {
    nome: 'Claude', artigo: 'o',
    url: 'https://api.anthropic.com/v1/messages',
    modelo: 'claude-haiku-5-5',
    modelos: ['claude-haiku-5-5'],
    modeloVisao: 'claude-haiku-5-5',
    modelosVisao: ['claude-haiku-5-5'],
    gratuito: false,
    formato: 'anthropic',
  },
};

// Último modelo que respondeu, por provedor (para não testar de novo os desativados)
const modeloQueFunciona = new Map();

function montar(id, chave, url, modelo, modeloVisao) {
  const base = PADROES[id];
  if (!base) return null;
  if (!base.semChave && !chave) return null; // provedor escolhido, mas sem chave
  // O modelo escolhido no .env vem primeiro; os padrões ficam como reserva
  const lista = (escolhido, padroes) => [...new Set([escolhido, ...padroes].filter(Boolean))];
  const modelos = lista(modelo, base.modelos);
  const modelosVisao = lista(modeloVisao, base.modelosVisao);
  return {
    id, ...base, chave: chave || '', url: url || base.url,
    modelos, modelosVisao, modelo: modeloQueFunciona.get(`${id}:chat`) || modelos[0],
    modeloVisao: modeloQueFunciona.get(`${id}:visao`) || modelosVisao[0],
  };
}

// Lê o .env a cada chamada (assim o status reflete o que está configurado).
// Devolve a lista em ordem de uso: [principal, reserva]. Lista vazia = modo básico.
//   ASSISTENTE_PROVEDOR / ASSISTENTE_CHAVE / ASSISTENTE_MODELO            -> principal
//   ASSISTENTE_RESERVA  / ASSISTENTE_RESERVA_CHAVE / ASSISTENTE_RESERVA_MODELO -> usada se a principal falhar
function configuracoes() {
  const env = process.env;
  let id = (env.ASSISTENTE_PROVEDOR || '').trim().toLowerCase();
  if (!id && env.ANTHROPIC_API_KEY) id = 'anthropic'; // compatibilidade com a versão anterior
  const principal = montar(id, env.ASSISTENTE_CHAVE || (id === 'anthropic' ? env.ANTHROPIC_API_KEY : ''),
    env.ASSISTENTE_URL || env.ASSISTENTE_API_URL, env.ASSISTENTE_MODELO, env.ASSISTENTE_VISAO_MODELO);
  const idReserva = (env.ASSISTENTE_RESERVA || '').trim().toLowerCase();
  const reserva = idReserva && idReserva !== id
    ? montar(idReserva, env.ASSISTENTE_RESERVA_CHAVE, env.ASSISTENTE_RESERVA_URL, env.ASSISTENTE_RESERVA_MODELO, env.ASSISTENTE_RESERVA_VISAO_MODELO)
    : null;
  return [principal, reserva].filter(Boolean).map((c, i) => ({ ...c, papel: i === 0 ? 'principal' : 'reserva' }));
}
const configuracao = () => configuracoes()[0] || null;

// ---------------------------------------------------------------------
// PAUSA: se um provedor estourou o limite grátis (429) ou recusou a chave,
// fica de lado por um tempo e as perguntas vão direto para o próximo,
// sem gastar uma tentativa (e o tempo do usuário) a cada mensagem.
// ---------------------------------------------------------------------
const pausados = new Map(); // id -> { ate: timestamp, motivo }

// O erro diz que o MODELO não existe / foi desativado? (cada provedor escreve de um jeito)
function erroDeModelo(err) {
  const msg = String(err && err.message || '').toLowerCase();
  if (err && err.status === 404) return true;
  return [400, 404, 410].includes(err && err.status)
    && /model|modelo/.test(msg)
    && /decommission|deprecat|not found|does not exist|no longer|not supported|unsupported|retired|invalid model|is not available|not available/.test(msg);
}
// O servidor não conseguiu nem chegar ao provedor (internet, firewall, antivírus, proxy)
function erroDeRede(err) {
  const codigo = err && (err.cause?.code || err.code);
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(codigo)
    || /fetch failed/i.test(String(err && err.message));
}
// Motivo em palavras simples (vai para o aviso do assistente e para o "Testar a IA")
function explicarErro(cfg, err) {
  const de = `d${cfg.artigo} ${cfg.nome}`;
  if (err.pausa === 'limite' || err.status === 429) return `o limite gratuito ${de} acabou por agora`;
  if (err.pausa === 'chave' || err.status === 401 || err.status === 403) return `a chave ${de} está inválida (confira o .env)`;
  if (err.pausa === 'modelo' || err.semModelo) {
    return `nenhum modelo ${de} está disponível${err.testados && err.testados.length ? ` (${err.testados.join(', ')})` : ''}: confira ASSISTENTE_MODELO no .env`;
  }
  if (typeof fetch !== 'function' || /fetch is not defined/.test(String(err.message))) return 'o Node.js do servidor é antigo demais (instale o Node 20 ou mais novo)';
  if (err.cause?.code === 'ECONNREFUSED' && cfg.id === 'ollama') return 'o Ollama não está rodando neste computador';
  if (erroDeRede(err)) return `o servidor não conseguiu se conectar ${cfg.artigo === 'a' ? 'à' : 'ao'} ${cfg.nome} (internet, firewall ou antivírus)`;
  if (err.status === 504) return `${cfg.artigo} ${cfg.nome} demorou demais para responder`;
  if (err.status >= 500) return `${cfg.artigo} ${cfg.nome} está fora do ar no momento`;
  return `${cfg.artigo} ${cfg.nome} recusou o pedido (${err.status || 'erro'}: ${String(err.message).slice(0, 120)})`;
}

function pausar(cfg, err) {
  let segundos = 0;
  let motivo = null;
  if (err.status === 429) { segundos = Math.min(Math.max(Number(err.retryAfter) || 60, 20), 3600); motivo = 'limite'; }
  else if (err.status === 401 || err.status === 403) { segundos = 600; motivo = 'chave'; }
  else if (err.semModelo) { segundos = 1800; motivo = 'modelo'; }
  if (segundos) pausados.set(cfg.id, { ate: Date.now() + segundos * 1000, motivo, testados: err.testados });
}
function emPausa(cfg) {
  const p = pausados.get(cfg.id);
  if (!p) return null;
  if (Date.now() > p.ate) { pausados.delete(cfg.id); return null; }
  return p;
}

async function postar(url, cabecalhos, corpo, tempoMs = 60000) {
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), tempoMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = dados?.error?.message || (Array.isArray(dados) && dados[0]?.error?.message) || `HTTP ${resp.status}`;
      const erro = new Error(msg);
      erro.status = resp.status;
      erro.retryAfter = resp.headers.get('retry-after');
      throw erro;
    }
    return dados;
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('A IA demorou demais para responder.'); e.status = 504; throw e; }
    throw err;
  } finally {
    clearTimeout(tempo);
  }
}

// ---------------------------------------------------------------------
// Tenta os modelos do provedor em ordem até um responder.
// tipo: 'chat' | 'visao'.  fn(cfgComOModelo) -> resultado
// Só pula para o próximo se o erro for de MODELO (desativado / não existe);
// limite, chave ou rede valem para o provedor todo e sobem na hora.
// ---------------------------------------------------------------------
async function comModelo(cfg, tipo, fn) {
  const campo = tipo === 'visao' ? 'modeloVisao' : 'modelo';
  const lista = tipo === 'visao' ? cfg.modelosVisao : cfg.modelos;
  const chave = `${cfg.id}:${tipo}`;
  const ordem = [...new Set([modeloQueFunciona.get(chave), ...lista].filter(Boolean))];
  const testados = [];
  let ultimoErro = null;
  for (const modelo of ordem) {
    try {
      const r = await fn({ ...cfg, [campo]: modelo });
      if (modeloQueFunciona.get(chave) !== modelo) {
        if (modelo !== lista[0]) console.warn(`[IA] ${cfg.nome}: usando o modelo ${modelo} (${testados.join(', ')} indisponível).`);
        modeloQueFunciona.set(chave, modelo);
      }
      return r;
    } catch (err) {
      if (!erroDeModelo(err)) throw err;
      console.warn(`[IA] ${cfg.nome}: modelo ${modelo} indisponível: ${err.message}`);
      testados.push(modelo);
      ultimoErro = err;
      if (modeloQueFunciona.get(chave) === modelo) modeloQueFunciona.delete(chave);
    }
  }
  throw Object.assign(new Error(ultimoErro ? ultimoErro.message : 'Nenhum modelo configurado.'),
    { status: ultimoErro?.status, semModelo: true, testados });
}

// Modelos que "pensam" antes de responder: pensar pouco (mais rápido e
// não gasta o limite de tokens só pensando)
function extrasDoModelo(cfg, modelo) {
  if (/gpt-oss/.test(modelo)) return { reasoning_effort: 'low' };
  if (cfg.id === 'groq' && /qwen/.test(modelo)) return { reasoning_format: 'hidden' };
  if (cfg.id === 'gemini' && /^gemini-3/.test(modelo)) return { reasoning_effort: 'low' };
  return {};
}
const semPensamento = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

// ---------------------------------------------------------------------
// Conversa com ferramentas.  ferramentas = [{ name, description, input_schema }]
// executar(nome, entrada) -> resultado (objeto).  Devolve o texto final.
// ---------------------------------------------------------------------
async function conversar(cfg, { sistema, mensagens, ferramentas, executar, maxRodadas = 6, limiteResultado = 9000 }) {
  return comModelo(cfg, 'chat', (c) => (c.formato === 'anthropic'
    ? conversarAnthropic(c, { sistema, mensagens, ferramentas, executar, maxRodadas, limiteResultado })
    : conversarOpenAI(c, { sistema, mensagens, ferramentas, executar, maxRodadas, limiteResultado })));
}

async function rodarFerramenta(executar, nome, entrada, limite) {
  try {
    return { ok: true, texto: JSON.stringify(await executar(nome, entrada)).slice(0, limite) };
  } catch (err) {
    return { ok: false, texto: `Erro: ${err.message}` };
  }
}

// Formato OpenAI (Groq, Gemini, Ollama)
async function conversarOpenAI(cfg, { sistema, mensagens, ferramentas, executar, maxRodadas, limiteResultado }) {
  const conversa = [
    { role: 'system', content: sistema },
    ...mensagens.map((m) => ({ role: m.papel === 'assistente' ? 'assistant' : 'user', content: m.texto })),
  ];
  const tools = ferramentas.map((f) => ({ type: 'function', function: { name: f.name, description: f.description, parameters: f.input_schema } }));
  const cabecalhos = cfg.chave ? { authorization: `Bearer ${cfg.chave}` } : {};

  for (let rodada = 0; rodada < maxRodadas; rodada++) {
    const r = await postar(cfg.url, cabecalhos, {
      model: cfg.modelo, messages: conversa, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 3000,
      ...extrasDoModelo(cfg, cfg.modelo),
    });
    const msg = r.choices?.[0]?.message || {};
    const chamadas = msg.tool_calls || [];
    if (!chamadas.length) return semPensamento(msg.content);

    conversa.push({ role: 'assistant', content: semPensamento(msg.content), tool_calls: chamadas });
    for (const c of chamadas) {
      let entrada = {};
      try { entrada = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch { entrada = {}; }
      const res = await rodarFerramenta(executar, c.function?.name, entrada, limiteResultado);
      conversa.push({ role: 'tool', tool_call_id: c.id, name: c.function?.name, content: res.texto });
    }
  }
  return null;
}

// Formato Anthropic (Claude)
async function conversarAnthropic(cfg, { sistema, mensagens, ferramentas, executar, maxRodadas, limiteResultado }) {
  const conversa = mensagens.map((m) => ({ role: m.papel === 'assistente' ? 'assistant' : 'user', content: m.texto }));
  const cabecalhos = { 'x-api-key': cfg.chave, 'anthropic-version': '2023-06-01' };

  for (let rodada = 0; rodada < maxRodadas; rodada++) {
    const r = await postar(cfg.url, cabecalhos, { model: cfg.modelo, max_tokens: 1200, system: sistema, tools: ferramentas, messages: conversa });
    conversa.push({ role: 'assistant', content: r.content });
    const pedidos = (r.content || []).filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !pedidos.length) {
      return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    const resultados = [];
    for (const p of pedidos) {
      const res = await rodarFerramenta(executar, p.name, p.input, limiteResultado);
      resultados.push({ type: 'tool_result', tool_use_id: p.id, content: res.texto, ...(res.ok ? {} : { is_error: true }) });
    }
    conversa.push({ role: 'user', content: resultados });
  }
  return null;
}

// ---------------------------------------------------------------------
// LER IMAGEM (ticket de pesagem). Uma pergunta só, sem ferramentas.
// Usa o modelo de visão do provedor (ASSISTENTE_VISAO_MODELO para trocar).
// Devolve o texto da resposta.
// ---------------------------------------------------------------------
async function lerImagem(cfg, entrada) {
  return comModelo(cfg, 'visao', (c) => lerImagemCom(c, entrada));
}
async function lerImagemCom(cfg, { instrucao, base64, mime }) {
  if (cfg.formato === 'anthropic') {
    const r = await postar(cfg.url, { 'x-api-key': cfg.chave, 'anthropic-version': '2023-06-01' }, {
      model: cfg.modeloVisao, max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: instrucao },
      ] }],
    }, 90000);
    return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }
  const r = await postar(cfg.url, cfg.chave ? { authorization: `Bearer ${cfg.chave}` } : {}, {
    model: cfg.modeloVisao, temperature: 0, max_tokens: 4000, ...extrasDoModelo(cfg, cfg.modeloVisao),
    messages: [{ role: 'user', content: [
      { type: 'text', text: instrucao },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
    ] }],
  }, 90000);
  return r.choices?.[0]?.message?.content || '';
}

// ---------------------------------------------------------------------
// TESTAR: uma pergunta mínima, sem ferramentas, para o botão "Testar a IA".
// Ignora a pausa (o administrador quer saber como está AGORA).
// ---------------------------------------------------------------------
async function testar(cfg) {
  const inicio = Date.now();
  try {
    const modelo = await comModelo(cfg, 'chat', async (c) => {
      if (c.formato === 'anthropic') {
        await postar(c.url, { 'x-api-key': c.chave, 'anthropic-version': '2023-06-01' },
          { model: c.modelo, max_tokens: 20, messages: [{ role: 'user', content: 'Responda apenas: ok' }] }, 30000);
      } else {
        await postar(c.url, c.chave ? { authorization: `Bearer ${c.chave}` } : {},
          { model: c.modelo, max_tokens: 300, messages: [{ role: 'user', content: 'Responda apenas: ok' }], ...extrasDoModelo(c, c.modelo) }, 30000);
      }
      return c.modelo;
    });
    pausados.delete(cfg.id);
    return { provedor: cfg.nome, papel: cfg.papel, ok: true, modelo, ms: Date.now() - inicio };
  } catch (err) {
    return { provedor: cfg.nome, papel: cfg.papel, ok: false, modelo: cfg.modelo, motivo: explicarErro(cfg, err), detalhe: String(err.message).slice(0, 300), ms: Date.now() - inicio };
  }
}

module.exports = { configuracao, configuracoes, conversar, lerImagem, pausar, emPausa, explicarErro, testar, PADROES };
