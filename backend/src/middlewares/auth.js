const jwt = require('jsonwebtoken');
const { query, contexto } = require('../config/db');

// Perfis do sistema (iguais aos da tabela "perfis" do banco)
//   Administrador -> altera tudo, inclusive usuários e perfis
//   Financeiro    -> cadastra, lança e altera valores; exclui (para a lixeira) só o que ELE lançou
//   Visualização  -> só consulta
const PERFIS = {
  ADMIN: 'Administrador',
  FINANCEIRO: 'Financeiro',
  VISUALIZACAO: 'Visualização',
};

// Exige o cabeçalho  Authorization: Bearer <token>
// Depois disso, req.usuario tem { id, empresaId, perfil }.
// IMPORTANTE: o empresaId vem SEMPRE do token, nunca do que o frontend envia.
//
// A cada requisição o banco é consultado para confirmar que o usuário e a
// empresa continuam ativos. Assim, se o desenvolvedor bloquear a empresa ou o
// administrador desativar alguém / mudar o perfil, vale NA HORA, sem esperar
// o token expirar.
async function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization || '';
  const [tipo, token] = cabecalho.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token não informado.' });
  }

  let dados;
  try {
    dados = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }

  // Token do painel do desenvolvedor não serve para o sistema das empresas
  if (dados.tipo === 'dev' || !dados.empresa_id) {
    return res.status(401).json({ erro: 'Token inválido para esta área.' });
  }

  try {
    const { rows } = await query(
      `SELECT p.nome AS perfil
         FROM usuarios u
         JOIN empresas e ON e.id = u.empresa_id
         JOIN perfis   p ON p.id = u.perfil_id
        WHERE u.id = $1 AND u.empresa_id = $2 AND u.ativo AND e.ativo`,
      [Number(dados.sub), dados.empresa_id]
    );
    if (!rows[0]) {
      return res.status(401).json({ erro: 'Seu acesso foi encerrado. Entre novamente ou fale com o administrador.' });
    }

    req.usuario = {
      id: Number(dados.sub),
      empresaId: dados.empresa_id,
      perfil: rows[0].perfil, // perfil atual do banco (não o do momento do login)
    };
    // Daqui em diante, toda gravação no banco fica registrada no histórico com este usuário e IP
    contexto.run({ usuarioId: req.usuario.id, empresaId: req.usuario.empresaId, ip: req.ip }, next);
  } catch (err) {
    next(err);
  }
}

// Uso: exigirPerfil('Administrador', 'Financeiro')
// A checagem é feita AQUI, no servidor: esconder botão no front não basta.
function exigirPerfil(...perfisPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !perfisPermitidos.includes(req.usuario.perfil)) {
      return res.status(403).json({ erro: 'Seu perfil não tem permissão para esta ação.' });
    }
    next();
  };
}

// Atalhos usados nas rotas
const podeEditar = exigirPerfil(PERFIS.ADMIN, PERFIS.FINANCEIRO); // cadastrar, lançar, alterar valores
const somenteAdmin = exigirPerfil(PERFIS.ADMIN);                  // excluir/desativar e gerenciar usuários

module.exports = { autenticar, exigirPerfil, podeEditar, somenteAdmin, PERFIS };
