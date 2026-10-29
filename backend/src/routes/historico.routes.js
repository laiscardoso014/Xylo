// =====================================================================
// HISTÓRICO (auditoria) - quem fez o quê, quando e de onde (só Administrador)
//
//   GET /api/historico?tabela=&registro_id=&usuario_id=&acao=&de=&ate=&pagina=
//
// Os eventos são gravados pelo gatilho fn_auditar() do banco (inclusão,
// alteração, cancelamento, exclusão para a lixeira, restauração) e pelo
// login. Aqui eles viram texto: "Ana alterou Viagem nº 12 · Peso líquido:
// 43,03 t -> 34,03 t".
// =====================================================================
const express = require('express');
const { query: q, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { autenticar, somenteAdmin } = require('../middlewares/auth');
const formatar = require('../auditoria/formatar');

const router = express.Router();
router.use(autenticar, somenteAdmin);

const POR_PAGINA = 50;
const ACOES = {
  INSERT: 'incluiu', UPDATE: 'alterou', DELETE: 'apagou', CANCELAR: 'cancelou',
  EXCLUIR: 'excluiu (lixeira)', RESTAURAR: 'restaurou', LOGIN: 'entrou no sistema',
};

router.get(
  '/',
  [q('tabela').optional({ values: 'falsy' }).isIn(Object.keys(formatar.TABELAS)),
    q('registro_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
    q('usuario_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
    q('acao').optional({ values: 'falsy' }).isIn(Object.keys(ACOES)),
    q('de').optional({ values: 'falsy' }).isISO8601(), q('ate').optional({ values: 'falsy' }).isISO8601(),
    q('pagina').optional({ values: 'falsy' }).isInt({ min: 1, max: 10000 })],
  async (req, res, next) => {
    const erros = validationResult(req);
    if (!erros.isEmpty()) return res.status(400).json({ erro: 'Filtro inválido.' });
    try {
      const empresaId = req.usuario.empresaId;
      const pagina = Number(req.query.pagina) || 1;
      const filtros = [empresaId, req.query.tabela || null, req.query.registro_id || null, req.query.usuario_id || null,
        req.query.acao || null, req.query.de || null, req.query.ate || null];
      const onde = `
        WHERE a.empresa_id = $1
          AND ($2::text IS NULL OR a.tabela = $2)
          AND ($3::int  IS NULL OR a.registro_id = $3)
          AND ($4::int  IS NULL OR a.usuario_id = $4)
          AND ($5::text IS NULL OR a.acao = $5)
          AND ($6::date IS NULL OR a.data_hora >= $6::date)
          AND ($7::date IS NULL OR a.data_hora < $7::date + 1)`;
      const [eventos, nomes, usuarios] = await Promise.all([
        query(`SELECT a.id, a.acao, a.tabela, a.registro_id, a.dados_anteriores, a.dados_novos, a.ip, a.detalhe,
                      to_char(a.data_hora, 'DD/MM/YYYY') AS dia, to_char(a.data_hora, 'HH24:MI') AS hora,
                      u.nome AS usuario, p.nome AS perfil
                 FROM auditoria a
                 LEFT JOIN usuarios u ON u.id = a.usuario_id
                 LEFT JOIN perfis p   ON p.id = u.perfil_id
                 ${onde}
                ORDER BY a.data_hora DESC, a.id DESC
                LIMIT ${POR_PAGINA + 1} OFFSET ${(pagina - 1) * POR_PAGINA}`, filtros),
        formatar.carregarNomes(empresaId),
        query('SELECT id, nome FROM usuarios WHERE empresa_id = $1 ORDER BY nome', [empresaId]),
      ]);
      const linhas = eventos.rows.slice(0, POR_PAGINA);

      // Para o título de uma ALTERAÇÃO (que só guarda o que mudou), busca o
      // registro como está agora - ou como ficou na lixeira.
      const atuais = new Map();
      const porTabela = {};
      for (const e of linhas) {
        if (['UPDATE', 'CANCELAR', 'LOGIN'].includes(e.acao) && formatar.TABELAS[e.tabela] && e.registro_id) {
          (porTabela[e.tabela] ||= new Set()).add(e.registro_id);
        }
      }
      await Promise.all(Object.entries(porTabela).map(async ([tabela, ids]) => {
        const lista = [...ids];
        const daTabela = await query(
          `SELECT to_jsonb(x) AS d FROM ${tabela} x WHERE id = ANY($1::int[]) AND ${tabela === 'empresas' ? 'id' : 'empresa_id'} = $2`,
          [lista, empresaId]);
        daTabela.rows.forEach((r) => atuais.set(`${tabela}:${r.d.id}`, r.d));
        if (['viagens', 'fretes', 'despesas', 'tabelas_precos'].includes(tabela)) {
          const daLixeira = await query('SELECT dados AS d FROM lixeira WHERE tabela = $1 AND registro_id = ANY($2::int[]) AND empresa_id = $3',
            [tabela, lista, empresaId]);
          daLixeira.rows.forEach((r) => { if (!atuais.has(`${tabela}:${r.d.id}`)) atuais.set(`${tabela}:${r.d.id}`, r.d); });
        }
      }));

      const itens = linhas.map((e) => {
        const completo = e.acao === 'INSERT' || e.acao === 'RESTAURAR' ? e.dados_novos
          : e.acao === 'DELETE' || e.acao === 'EXCLUIR' ? e.dados_anteriores
            : { ...(atuais.get(`${e.tabela}:${e.registro_id}`) || {}), ...(e.dados_novos || {}) };
        const alteracao = e.acao === 'UPDATE' || e.acao === 'CANCELAR';
        return {
          id: Number(e.id),
          dia: e.dia,
          hora: e.hora,
          usuario: e.usuario || 'Sistema',
          perfil: e.perfil,
          acao: e.acao,
          acao_texto: ACOES[e.acao] || e.acao,
          tabela: e.tabela,
          tabela_nome: formatar.TABELAS[e.tabela]?.nome || e.tabela,
          registro_id: e.registro_id,
          titulo: e.acao === 'LOGIN' ? '' : formatar.resumo(e.tabela, completo, nomes),
          mudancas: alteracao ? formatar.mudancas(e.dados_anteriores, e.dados_novos, nomes) : [],
          campos: !alteracao && e.acao !== 'LOGIN' ? formatar.campos(completo, nomes) : [],
          detalhe: e.detalhe,
          ip: e.ip,
        };
      });
      res.json({
        itens,
        pagina,
        tem_mais: eventos.rows.length > POR_PAGINA,
        usuarios: usuarios.rows,
        tabelas: Object.entries(formatar.TABELAS).map(([id, t]) => ({ id, nome: t.plural })),
        acoes: Object.entries(ACOES).map(([id, nome]) => ({ id, nome })),
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
