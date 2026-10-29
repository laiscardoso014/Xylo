-- =====================================================================
--  WOODCONTROL - Banco de dados (PostgreSQL 16+)
--  Versão 3 - realinhada com a planilha de fechamento e os requisitos
--
--  Versão 3.1 - inclui o painel do desenvolvedor
--
--  Como rodar (no banco "db_woodcontrol" já criado):
--     psql -U postgres -d db_woodcontrol -f woodcontrol_v3.sql
--
--  ATENÇÃO: este script APAGA as tabelas antigas e recria tudo.
--  Rode só se não houver dados que você precise manter.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. LIMPEZA (remove a estrutura anterior)
-- ---------------------------------------------------------------------
DROP VIEW  IF EXISTS vw_totalizacao_mensal, vw_relatorio_empreiteiro,
                     vw_relatorio_floresta, vw_relatorio_cliente,
                     vw_viagem_empreiteiros CASCADE;
DROP TABLE IF EXISTS desenvolvedores, adiantamento_parcelas, adiantamentos, fechamentos, pagamentos,
                     parceiros_frete, saldos, fornecedores, auditoria, folhas, funcionarios, despesas, categorias_despesa,
                     recebimentos, fretes, viagem_empreiteiros, viagens,
                     tabelas_precos, classes_madeira, empreiteiros, veiculos,
                     motoristas, florestas, fazendas, clientes, usuarios,
                     empresas, perfis, solicitacoes_acesso CASCADE;

-- ---------------------------------------------------------------------
-- Função genérica: atualiza "updated_at" em todo UPDATE
-- (no PostgreSQL não existe o "ON UPDATE CURRENT_TIMESTAMP" do MySQL)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. PERFIS DE ACESSO (globais)
--    As permissões ficam no banco e o backend confere antes de cada ação.
-- =====================================================================
CREATE TABLE perfis (
    id                      SERIAL PRIMARY KEY,
    nome                    VARCHAR(50) NOT NULL UNIQUE,
    pode_gerenciar_usuarios BOOLEAN NOT NULL DEFAULT FALSE, -- criar/editar usuários e perfis
    pode_editar             BOOLEAN NOT NULL DEFAULT FALSE, -- cadastros, viagens, preços
    pode_excluir            BOOLEAN NOT NULL DEFAULT FALSE  -- apagar registros
);

INSERT INTO perfis (id, nome, pode_gerenciar_usuarios, pode_editar, pode_excluir) VALUES
    (1, 'Administrador', TRUE,  TRUE,  TRUE),
    (2, 'Financeiro',    FALSE, TRUE,  FALSE),
    (3, 'Visualização',  FALSE, FALSE, FALSE);
SELECT setval('perfis_id_seq', 3);

-- =====================================================================
-- 2. EMPRESAS (cada empresa cliente do WoodControl) - login pelo CNPJ
-- =====================================================================
CREATE TABLE empresas (
    id           SERIAL PRIMARY KEY,
    nome         VARCHAR(150) NOT NULL,
    razao_social VARCHAR(150),
    cnpj         VARCHAR(14)  NOT NULL UNIQUE,      -- só números
    email        VARCHAR(150),
    telefone     VARCHAR(20),
    endereco     VARCHAR(200),
    cidade       VARCHAR(100),
    uf           CHAR(2),
    logo         TEXT,                               -- imagem (data URL png/jpeg/webp, até 512 KB), sai nos relatórios
    ativo        BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_empresa_cnpj CHECK (cnpj ~ '^[0-9]{14}$')
);

-- =====================================================================
-- 3. USUÁRIOS (login = CNPJ da empresa + e-mail + senha)
-- =====================================================================
CREATE TABLE usuarios (
    id          SERIAL PRIMARY KEY,
    empresa_id  INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    perfil_id   INT NOT NULL REFERENCES perfis(id),
    nome        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NOT NULL,
    senha_hash  VARCHAR(255) NOT NULL,              -- bcrypt, nunca a senha pura
    deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE, -- senha provisória: troca no 1º acesso
    telefone    VARCHAR(20),                        -- só o próprio usuário altera (Meu perfil)
    senha_alterada_em TIMESTAMP,
    ativo       BOOLEAN   NOT NULL DEFAULT TRUE,
    ultimo_login TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_usuario_empresa_email UNIQUE (empresa_id, email)
);

-- =====================================================================
-- 4. CLIENTES (serrarias que compram a madeira: Pau Brasil, Enok...)
-- =====================================================================
CREATE TABLE clientes (
    id           SERIAL PRIMARY KEY,
    empresa_id   INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome         VARCHAR(150) NOT NULL,
    razao_social VARCHAR(150),
    cpf_cnpj     VARCHAR(14),                       -- opcional
    telefone     VARCHAR(20),
    email        VARCHAR(150),
    cidade       VARCHAR(100),
    estado       CHAR(2),
    observacoes  TEXT,
    ativo        BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_cliente_empresa_nome UNIQUE (empresa_id, nome)
);
CREATE UNIQUE INDEX uk_cliente_empresa_doc ON clientes (empresa_id, cpf_cnpj)
    WHERE cpf_cnpj IS NOT NULL;

-- =====================================================================
-- 5. FLORESTAS (origem da madeira: Grazziotin, Alfredo Wagner, Gabirova...)
--    Antes era "fazendas" e pertencia a um cliente. Agora é independente:
--    uma floresta vende para vários clientes.
-- =====================================================================
CREATE TABLE florestas (
    id           SERIAL PRIMARY KEY,
    empresa_id   INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome         VARCHAR(150) NOT NULL,
    proprietario VARCHAR(150),                      -- dono/fornecedor da madeira
    municipio    VARCHAR(100),
    estado       CHAR(2),
    observacoes  TEXT,
    ativo        BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_floresta_empresa_nome UNIQUE (empresa_id, nome)
);

-- =====================================================================
-- 6. EMPREITEIROS (quem corta/carrega: Xande, Cabeçote, Lico, Luiz...)
-- =====================================================================
CREATE TABLE empreiteiros (
    id          SERIAL PRIMARY KEY,
    empresa_id  INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome        VARCHAR(150) NOT NULL,
    cpf_cnpj    VARCHAR(14),
    telefone    VARCHAR(20),
    observacoes TEXT,
    ativo       BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_empreiteiro_empresa_nome UNIQUE (empresa_id, nome)
);

-- =====================================================================
-- 7. MOTORISTAS e VEÍCULOS (opcionais na viagem)
-- =====================================================================
CREATE TABLE motoristas (
    id          SERIAL PRIMARY KEY,
    empresa_id  INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome        VARCHAR(150) NOT NULL,
    cpf         VARCHAR(11),
    cnh         VARCHAR(20),
    validade_cnh DATE,
    telefone    VARCHAR(20),
    ativo       BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_motorista_empresa_nome UNIQUE (empresa_id, nome)
);

CREATE TABLE veiculos (
    id           SERIAL PRIMARY KEY,
    empresa_id   INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    placa        VARCHAR(7) NOT NULL,               -- só letras/números, maiúsculas
    modelo       VARCHAR(100),
    proprietario VARCHAR(150),
    ativo        BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_veiculo_empresa_placa UNIQUE (empresa_id, placa)
);

-- =====================================================================
-- 8. CLASSES DE MADEIRA (Lixo, Fina, Média, Grossa, Eucalipto...)
--    São criadas automaticamente para cada empresa nova (trigger abaixo).
-- =====================================================================
CREATE TABLE classes_madeira (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome           VARCHAR(50) NOT NULL,
    descricao      VARCHAR(150),
    unidade_medida VARCHAR(3) NOT NULL DEFAULT 'TON' CHECK (unidade_medida IN ('TON', 'M3')),
    ativo          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uk_classe_empresa_nome UNIQUE (empresa_id, nome)
);

CREATE OR REPLACE FUNCTION fn_classes_padrao() RETURNS trigger AS $$
BEGIN
    INSERT INTO classes_madeira (empresa_id, nome, descricao, unidade_medida) VALUES
        (NEW.id, 'Lixo',      'Resíduo / lixo de pinus', 'TON'),
        (NEW.id, 'Fina',      'Diâmetro 16 a 25 cm',     'TON'),
        (NEW.id, 'Média',     'Diâmetro 25 a 32 cm',     'TON'),
        (NEW.id, 'Grossa',    'Diâmetro acima de 32 cm', 'TON'),
        (NEW.id, 'Eucalipto', 'Eucalipto',               'M3');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_empresa_classes_padrao
    AFTER INSERT ON empresas
    FOR EACH ROW EXECUTE FUNCTION fn_classes_padrao();

-- =====================================================================
-- 9. TABELA DE PREÇOS (configurável pelo Administrador e Financeiro)
--    Uma carga tem até três preços por tonelada:
--      VENDA      -> o que o CLIENTE paga      (por cliente, opcionalmente por floresta)
--      COMPRA     -> o que se paga à FLORESTA  (por floresta, opcionalmente por cliente)
--      EMPREITADA -> o que se paga ao EMPREITEIRO (por empreiteiro, opcionalmente por floresta)
--    Vigência por data: ao mudar o preço, cria-se um novo registro com nova data_inicio.
-- =====================================================================
CREATE TABLE tabelas_precos (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo           VARCHAR(10) NOT NULL CHECK (tipo IN ('VENDA', 'COMPRA', 'EMPREITADA')),
    classe_id      INT NOT NULL REFERENCES classes_madeira(id) ON DELETE RESTRICT,
    cliente_id     INT REFERENCES clientes(id)     ON DELETE CASCADE,
    floresta_id    INT REFERENCES florestas(id)    ON DELETE CASCADE,
    empreiteiro_id INT REFERENCES empreiteiros(id) ON DELETE CASCADE,
    valor_tonelada NUMERIC(10, 2) NOT NULL CHECK (valor_tonelada >= 0),
    data_inicio    DATE NOT NULL DEFAULT CURRENT_DATE,
    data_fim       DATE,
    observacao     TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_preco_venda      CHECK (tipo <> 'VENDA'      OR cliente_id     IS NOT NULL),
    CONSTRAINT ck_preco_compra     CHECK (tipo <> 'COMPRA'     OR floresta_id    IS NOT NULL),
    CONSTRAINT ck_preco_empreitada CHECK (tipo <> 'EMPREITADA' OR empreiteiro_id IS NOT NULL),
    CONSTRAINT ck_preco_vigencia   CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

-- Busca o preço vigente na data. Se houver preço específico (ex.: cliente + floresta)
-- ele vence o genérico (só cliente).
CREATE OR REPLACE FUNCTION fn_buscar_preco(
    p_empresa INT, p_tipo VARCHAR, p_classe INT, p_data DATE,
    p_cliente INT, p_floresta INT, p_empreiteiro INT
) RETURNS NUMERIC AS $$
    SELECT tp.valor_tonelada
      FROM tabelas_precos tp
     WHERE tp.empresa_id = p_empresa
       AND tp.tipo       = p_tipo
       AND tp.classe_id  = p_classe
       AND tp.data_inicio <= p_data
       AND (tp.data_fim IS NULL OR tp.data_fim >= p_data)
       AND (tp.cliente_id     IS NULL OR tp.cliente_id     = p_cliente)
       AND (tp.floresta_id    IS NULL OR tp.floresta_id    = p_floresta)
       AND (tp.empreiteiro_id IS NULL OR tp.empreiteiro_id = p_empreiteiro)
     ORDER BY (tp.cliente_id IS NOT NULL)::int
            + (tp.floresta_id IS NOT NULL)::int
            + (tp.empreiteiro_id IS NOT NULL)::int DESC,
              tp.data_inicio DESC
     LIMIT 1;
$$ LANGUAGE sql STABLE;

-- =====================================================================
-- 10. VIAGENS (o registro principal do sistema)
--     Campos prioritários: cliente, nº da viagem, data, ticket, placa,
--     floresta, empreiteiro, classe, peso líquido, valor da tonelada e total.
--
--     EMPREITEIRO HÍBRIDO:
--       - padrão: um empreiteiro só  -> preencha empreiteiro_id aqui
--       - carga dividida (casos antigos) -> deixe empreiteiro_id vazio e
--         lance as partes na tabela viagem_empreiteiros
-- =====================================================================
CREATE TABLE viagens (
    id                    SERIAL PRIMARY KEY,
    empresa_id            INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    numero_viagem         VARCHAR(20) NOT NULL,
    data                  DATE NOT NULL,
    ticket                VARCHAR(30),                 -- nem toda carga tem ticket
    placa                 VARCHAR(20),                 -- texto livre (caminhões de terceiros)
    cliente_id            INT NOT NULL REFERENCES clientes(id)        ON DELETE RESTRICT,
    floresta_id           INT NOT NULL REFERENCES florestas(id)       ON DELETE RESTRICT,
    empreiteiro_id        INT          REFERENCES empreiteiros(id)    ON DELETE RESTRICT,
    classe_id             INT NOT NULL REFERENCES classes_madeira(id) ON DELETE RESTRICT,
    motorista_id          INT          REFERENCES motoristas(id)      ON DELETE SET NULL,
    veiculo_id            INT          REFERENCES veiculos(id)        ON DELETE SET NULL,
    hora_pesagem          TIME,
    peso_liquido          NUMERIC(10, 2) NOT NULL CHECK (peso_liquido > 0),
    volume_m3             NUMERIC(10, 2),

    -- Valor de VENDA ao cliente (o "valor da tonelada" da planilha).
    -- Se vier vazio, o banco preenche pela tabela de preços.
    valor_tonelada        NUMERIC(10, 2) NOT NULL CHECK (valor_tonelada >= 0),
    valor_total           NUMERIC(12, 2) GENERATED ALWAYS AS (peso_liquido * valor_tonelada) STORED,

    -- Custos da carga, guardados no dia do lançamento (mudar a tabela de
    -- preços depois NÃO altera viagens antigas).
    valor_ton_floresta    NUMERIC(10, 2),
    total_floresta        NUMERIC(12, 2) GENERATED ALWAYS AS (peso_liquido * COALESCE(valor_ton_floresta, 0)) STORED,
    valor_ton_empreiteiro NUMERIC(10, 2),
    total_empreiteiro     NUMERIC(12, 2) GENERATED ALWAYS AS (peso_liquido * COALESCE(valor_ton_empreiteiro, 0)) STORED,

    status                VARCHAR(20) NOT NULL DEFAULT 'Aberta'
                          CHECK (status IN ('Aberta', 'Conferida', 'Fechada', 'Cancelada')),
    observacoes           TEXT,
    criado_por            INT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT now(),
    updated_at            TIMESTAMP NOT NULL DEFAULT now()
);

-- Ticket não pode repetir na mesma empresa (mas pode ficar vazio em várias)
CREATE UNIQUE INDEX uk_viagem_empresa_ticket ON viagens (empresa_id, ticket)
    WHERE ticket IS NOT NULL AND status <> 'Cancelada';
CREATE INDEX ix_viagem_data        ON viagens (empresa_id, data);
CREATE INDEX ix_viagem_cliente     ON viagens (cliente_id);
CREATE INDEX ix_viagem_floresta    ON viagens (floresta_id);
CREATE INDEX ix_viagem_empreiteiro ON viagens (empreiteiro_id);

-- Antes de gravar: padroniza a placa e busca os preços que não foram informados
CREATE OR REPLACE FUNCTION fn_viagem_preparar() RETURNS trigger AS $$
BEGIN
    IF NEW.placa IS NOT NULL THEN
        NEW.placa := upper(regexp_replace(NEW.placa, '[^A-Za-z0-9 ]', '', 'g'));
    END IF;

    IF NEW.valor_tonelada IS NULL THEN
        NEW.valor_tonelada := fn_buscar_preco(NEW.empresa_id, 'VENDA', NEW.classe_id, NEW.data,
                                              NEW.cliente_id, NEW.floresta_id, NULL);
        IF NEW.valor_tonelada IS NULL THEN
            RAISE EXCEPTION 'Sem preço de venda cadastrado para este cliente/classe na data %', NEW.data;
        END IF;
    END IF;

    IF NEW.valor_ton_floresta IS NULL THEN
        NEW.valor_ton_floresta := fn_buscar_preco(NEW.empresa_id, 'COMPRA', NEW.classe_id, NEW.data,
                                                  NEW.cliente_id, NEW.floresta_id, NULL);
    END IF;

    IF NEW.empreiteiro_id IS NOT NULL AND NEW.valor_ton_empreiteiro IS NULL THEN
        NEW.valor_ton_empreiteiro := fn_buscar_preco(NEW.empresa_id, 'EMPREITADA', NEW.classe_id, NEW.data,
                                                     NULL, NEW.floresta_id, NEW.empreiteiro_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_viagem_preparar
    BEFORE INSERT OR UPDATE ON viagens
    FOR EACH ROW EXECUTE FUNCTION fn_viagem_preparar();

-- =====================================================================
-- 11. VIAGEM_EMPREITEIROS (carga dividida entre mais de um empreiteiro)
--     Ex.: "XANDE/CABEÇOTE" -> duas linhas, cada uma com sua parte do peso.
-- =====================================================================
CREATE TABLE viagem_empreiteiros (
    id             SERIAL PRIMARY KEY,
    viagem_id      INT NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
    empreiteiro_id INT NOT NULL REFERENCES empreiteiros(id) ON DELETE RESTRICT,
    peso_liquido   NUMERIC(10, 3) NOT NULL CHECK (peso_liquido > 0),  -- 3 casas: metade de 48,31 = 24,155
    valor_tonelada NUMERIC(10, 2) NOT NULL CHECK (valor_tonelada >= 0),
    valor_total    NUMERIC(12, 2) GENERATED ALWAYS AS (peso_liquido * valor_tonelada) STORED,
    CONSTRAINT uk_viagem_empreiteiro UNIQUE (viagem_id, empreiteiro_id)
);

-- Regras da divisão: a viagem não pode ter empreiteiro único preenchido,
-- a soma das partes não passa do peso da carga, e o preço vem da tabela se faltar.
CREATE OR REPLACE FUNCTION fn_viagem_empreiteiro_validar() RETURNS trigger AS $$
DECLARE
    v viagens%ROWTYPE;
    soma NUMERIC;
BEGIN
    SELECT * INTO v FROM viagens WHERE id = NEW.viagem_id;

    IF v.empreiteiro_id IS NOT NULL THEN
        RAISE EXCEPTION 'A viagem % já tem empreiteiro único. Para dividir, deixe o empreiteiro da viagem vazio.', v.numero_viagem;
    END IF;

    SELECT COALESCE(SUM(peso_liquido), 0) INTO soma
      FROM viagem_empreiteiros
     WHERE viagem_id = NEW.viagem_id AND id IS DISTINCT FROM NEW.id;

    IF soma + NEW.peso_liquido > v.peso_liquido THEN
        RAISE EXCEPTION 'A soma das partes (% t) passa do peso da carga (% t).',
                        soma + NEW.peso_liquido, v.peso_liquido;
    END IF;

    IF NEW.valor_tonelada IS NULL THEN
        NEW.valor_tonelada := COALESCE(
            fn_buscar_preco(v.empresa_id, 'EMPREITADA', v.classe_id, v.data, NULL, v.floresta_id, NEW.empreiteiro_id), 0);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_viagem_empreiteiro_validar
    BEFORE INSERT OR UPDATE ON viagem_empreiteiros
    FOR EACH ROW EXECUTE FUNCTION fn_viagem_empreiteiro_validar();

-- =====================================================================
-- 12. RECEBIMENTOS (cheques, boletos, PIX recebidos dos clientes)
--     Permite o saldo: remanescente + cargas - recebido.
-- =====================================================================
CREATE TABLE recebimentos (
    id              SERIAL PRIMARY KEY,
    empresa_id      INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id      INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    data            DATE NOT NULL,
    forma           VARCHAR(20) NOT NULL CHECK (forma IN ('Cheque', 'Boleto', 'PIX', 'Dinheiro', 'Transferência')),
    valor           NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
    observacoes     TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- =====================================================================
-- 13. FRETES (serviço de transporte à parte - ex.: Buti/Balneário)
--     Cobrado por tonelada (toneladas x valor da tonelada) OU por valor
--     fechado. Cancelado não é apagado: sai dos totais.
-- =====================================================================
CREATE TABLE fretes (
    id               SERIAL PRIMARY KEY,
    empresa_id       INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    numero_carga     VARCHAR(20) NOT NULL,
    data             DATE NOT NULL,
    cliente_id       INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    destino          VARCHAR(100),
    toneladas        NUMERIC(10, 2) NOT NULL CHECK (toneladas > 0),
    valor_tonelada   NUMERIC(10, 2),
    valor_fechado    NUMERIC(12, 2) CHECK (valor_fechado >= 0),
    valor_total      NUMERIC(12, 2) GENERATED ALWAYS AS
                     (COALESCE(valor_fechado, toneladas * COALESCE(valor_tonelada, 0))) STORED,
    forma_pagamento  VARCHAR(20) CHECK (forma_pagamento IN ('À vista', 'Cheque', 'Boleto', 'PIX', 'Outro')),
    status_pagamento VARCHAR(20) NOT NULL DEFAULT 'Pendente',
    data_pagamento   DATE,
    observacoes      TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    updated_at       TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_frete_status     CHECK (status_pagamento IN ('Pendente', 'Pago', 'Cancelado')),
    CONSTRAINT ck_frete_valor      CHECK (valor_fechado IS NOT NULL OR valor_tonelada IS NOT NULL),
    CONSTRAINT ck_frete_valor_ton  CHECK (valor_tonelada IS NULL OR valor_tonelada >= 0)
);
CREATE INDEX ix_frete_data ON fretes (empresa_id, data);

-- =====================================================================
-- 14. DESPESAS (adiantamentos, pagamentos de floresta/empreiteiro, folha,
--     combustível, manutenção...)
--     Pode ser ligada a um empreiteiro e/ou a uma floresta para os relatórios.
--     Cancelada não é apagada: sai dos totais.
-- =====================================================================
CREATE TABLE categorias_despesa (
    id         SERIAL PRIMARY KEY,
    empresa_id INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome       VARCHAR(100) NOT NULL,
    ativo      BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uk_categoria_empresa_nome UNIQUE (empresa_id, nome)
);

-- Categorias criadas automaticamente para cada empresa nova
CREATE OR REPLACE FUNCTION fn_categorias_padrao() RETURNS trigger AS $$
BEGIN
    INSERT INTO categorias_despesa (empresa_id, nome) VALUES
        (NEW.id, 'Adiantamento'),
        (NEW.id, 'Pagamento de empreiteiro'),
        (NEW.id, 'Pagamento de floresta'),
        (NEW.id, 'Folha de pagamento'),
        (NEW.id, 'Combustível'),
        (NEW.id, 'Manutenção'),
        (NEW.id, 'Outros')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_empresa_categorias_padrao
    AFTER INSERT ON empresas
    FOR EACH ROW EXECUTE FUNCTION fn_categorias_padrao();

CREATE TABLE despesas (
    id              SERIAL PRIMARY KEY,
    empresa_id      INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    categoria_id    INT NOT NULL REFERENCES categorias_despesa(id) ON DELETE RESTRICT,
    empreiteiro_id  INT REFERENCES empreiteiros(id) ON DELETE RESTRICT,   -- opcional
    floresta_id     INT REFERENCES florestas(id)    ON DELETE RESTRICT,   -- opcional
    data            DATE NOT NULL,
    descricao       VARCHAR(255) NOT NULL,
    favorecido      VARCHAR(150),
    valor           NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
    forma_pagamento VARCHAR(20) CHECK (forma_pagamento IN ('À vista', 'Cheque', 'Boleto', 'PIX', 'Outro')),
    status          VARCHAR(20) NOT NULL DEFAULT 'Pendente',
    data_pagamento  DATE,
    observacoes     TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_despesa_status CHECK (status IN ('Pendente', 'Pago', 'Cancelado'))
);
CREATE INDEX ix_despesa_data        ON despesas (empresa_id, data);
CREATE INDEX ix_despesa_empreiteiro ON despesas (empreiteiro_id);
CREATE INDEX ix_despesa_floresta    ON despesas (floresta_id);

-- =====================================================================
-- 15. FUNCIONÁRIOS e FOLHA (comissão por tonelada para motoristas)
-- =====================================================================
CREATE TABLE funcionarios (
    id                SERIAL PRIMARY KEY,
    empresa_id        INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome              VARCHAR(150) NOT NULL,
    cargo             VARCHAR(100) NOT NULL,
    cpf               VARCHAR(11),
    data_admissao     DATE,
    salario_base      NUMERIC(10, 2) NOT NULL DEFAULT 0,
    comissao_por_ton  NUMERIC(10, 2) NOT NULL DEFAULT 0,   -- ex.: 1,50 para motoristas
    ativo             BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE folhas (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    funcionario_id INT NOT NULL REFERENCES funcionarios(id) ON DELETE RESTRICT,
    competencia    CHAR(7) NOT NULL CHECK (competencia ~ '^[0-9]{4}-[0-9]{2}$'),  -- AAAA-MM
    salario_base   NUMERIC(10, 2) NOT NULL DEFAULT 0,
    comissao       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    alimentacao    NUMERIC(10, 2) NOT NULL DEFAULT 0,
    extras         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    adiantamento   NUMERIC(10, 2) NOT NULL DEFAULT 0,
    desconto       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    saldo_pagar    NUMERIC(12, 2) GENERATED ALWAYS AS
                   (salario_base + comissao + alimentacao + extras - adiantamento - desconto) STORED,
    observacoes    TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_folha_funcionario_competencia UNIQUE (funcionario_id, competencia)
);

-- =====================================================================
-- 16. AUDITORIA (quem mudou o quê e quando - histórico auditável)
-- =====================================================================
CREATE TABLE auditoria (
    id               BIGSERIAL PRIMARY KEY,
    empresa_id       INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id       INT REFERENCES usuarios(id) ON DELETE SET NULL,
    acao             VARCHAR(10) NOT NULL CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN')),
    tabela           VARCHAR(50) NOT NULL,
    registro_id      INT,
    dados_anteriores JSONB,
    dados_novos      JSONB,
    ip               VARCHAR(45),
    data_hora        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_empresa_data ON auditoria (empresa_id, data_hora);

-- =====================================================================
-- 17. DESENVOLVEDORES (quem administra o WoodControl: painel dev.html)
--     Login separado dos usuários das empresas.
-- =====================================================================
CREATE TABLE desenvolvedores (
    id           SERIAL PRIMARY KEY,
    nome         VARCHAR(100) NOT NULL,
    email        VARCHAR(150) NOT NULL UNIQUE,
    senha_hash   VARCHAR(255) NOT NULL,
    ativo        BOOLEAN   NOT NULL DEFAULT TRUE,
    ultimo_login TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- =====================================================================
-- 18. SOLICITAÇÕES DE ACESSO (formulário da página de venda)
--     O desenvolvedor aprova no painel -> cria a empresa e o administrador.
-- =====================================================================
CREATE TABLE solicitacoes_acesso (
    id                  SERIAL PRIMARY KEY,
    nome_completo       VARCHAR(150) NOT NULL,
    whatsapp            VARCHAR(20)  NOT NULL,
    email_corporativo   VARCHAR(150) NOT NULL,
    nome_empresa        VARCHAR(150) NOT NULL,
    cnpj                VARCHAR(14),
    numero_funcionarios VARCHAR(20) NOT NULL CHECK (numero_funcionarios IN
                        ('1 a 5', '6 a 15', '16 a 30', '31 a 50', '51 a 100', 'Mais de 100')),
    faturamento_mensal  VARCHAR(30) NOT NULL CHECK (faturamento_mensal IN
                        ('Até R$ 50 mil', 'R$ 50 mil a R$ 100 mil', 'R$ 100 mil a R$ 300 mil',
                         'R$ 300 mil a R$ 500 mil', 'R$ 500 mil a R$ 1 milhão', 'Acima de R$ 1 milhão')),
    regime_fiscal       VARCHAR(30) NOT NULL CHECK (regime_fiscal IN
                        ('MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'Outro / Não sei informar')),
    observacoes         TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'Pendente'
                        CHECK (status IN ('Pendente', 'Em contato', 'Aprovada', 'Recusada')),
    empresa_id          INT REFERENCES empresas(id) ON DELETE SET NULL, -- preenchido quando aprovada
    observacao_interna  TEXT,                                           -- anotações do desenvolvedor
    atendido_por        INT REFERENCES desenvolvedores(id) ON DELETE SET NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- updated_at automático em todas as tabelas que têm a coluna
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'public' AND column_name = 'updated_at'
    LOOP
        EXECUTE format('CREATE TRIGGER tg_%s_updated_at BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t, t);
    END LOOP;
END $$;

-- =====================================================================
-- VIEWS DOS RELATÓRIOS
--   Todas têm empresa_id e mes (AAAA-MM) para o backend filtrar.
--   Viagens canceladas ficam de fora.
-- =====================================================================

-- Empreiteiro de cada carga, já resolvendo o modo híbrido
CREATE VIEW vw_viagem_empreiteiros AS
    SELECT v.id AS viagem_id, v.empresa_id, v.data, v.empreiteiro_id,
           v.peso_liquido, v.valor_ton_empreiteiro AS valor_tonelada, v.total_empreiteiro AS valor_total
      FROM viagens v
     WHERE v.empreiteiro_id IS NOT NULL AND v.status <> 'Cancelada'
    UNION ALL
    SELECT v.id, v.empresa_id, v.data, ve.empreiteiro_id,
           ve.peso_liquido, ve.valor_tonelada, ve.valor_total
      FROM viagem_empreiteiros ve
      JOIN viagens v ON v.id = ve.viagem_id
     WHERE v.status <> 'Cancelada';

-- Relatório por CLIENTE
CREATE VIEW vw_relatorio_cliente AS
    SELECT v.empresa_id, to_char(v.data, 'YYYY-MM') AS mes,
           c.id AS cliente_id, c.nome AS cliente,
           COUNT(*)            AS qtd_viagens,
           SUM(v.peso_liquido) AS toneladas,
           SUM(v.valor_total)  AS valor_total
      FROM viagens v
      JOIN clientes c ON c.id = v.cliente_id
     WHERE v.status <> 'Cancelada'
     GROUP BY v.empresa_id, mes, c.id, c.nome;

-- Relatório por FLORESTA (quanto saiu e quanto se deve à floresta)
CREATE VIEW vw_relatorio_floresta AS
    SELECT v.empresa_id, to_char(v.data, 'YYYY-MM') AS mes,
           f.id AS floresta_id, f.nome AS floresta,
           COUNT(*)              AS qtd_viagens,
           SUM(v.peso_liquido)   AS toneladas,
           SUM(v.valor_total)    AS valor_vendido,
           SUM(v.total_floresta) AS valor_a_pagar_floresta
      FROM viagens v
      JOIN florestas f ON f.id = v.floresta_id
     WHERE v.status <> 'Cancelada'
     GROUP BY v.empresa_id, mes, f.id, f.nome;

-- Relatório por EMPREITEIRO (produção - despesas = líquido a pagar)
CREATE VIEW vw_relatorio_empreiteiro AS
    WITH producao AS (
        SELECT empresa_id, to_char(data, 'YYYY-MM') AS mes, empreiteiro_id,
               COUNT(DISTINCT viagem_id) AS qtd_viagens,
               SUM(peso_liquido) AS toneladas,
               SUM(valor_total)  AS valor_bruto
          FROM vw_viagem_empreiteiros
         GROUP BY empresa_id, mes, empreiteiro_id
    ), gastos AS (
        SELECT empresa_id, to_char(data, 'YYYY-MM') AS mes, empreiteiro_id,
               SUM(valor) AS despesas
          FROM despesas
         WHERE empreiteiro_id IS NOT NULL AND status <> 'Cancelado'
         GROUP BY empresa_id, mes, empreiteiro_id
    )
    SELECT COALESCE(p.empresa_id, g.empresa_id) AS empresa_id,
           COALESCE(p.mes, g.mes)               AS mes,
           e.id AS empreiteiro_id, e.nome AS empreiteiro,
           COALESCE(p.qtd_viagens, 0) AS qtd_viagens,
           COALESCE(p.toneladas, 0)   AS toneladas,
           COALESCE(p.valor_bruto, 0) AS valor_bruto,
           COALESCE(g.despesas, 0)    AS despesas,
           COALESCE(p.valor_bruto, 0) - COALESCE(g.despesas, 0) AS liquido
      FROM producao p
      FULL JOIN gastos g ON g.empresa_id = p.empresa_id AND g.mes = p.mes
                        AND g.empreiteiro_id = p.empreiteiro_id
      JOIN empreiteiros e ON e.id = COALESCE(p.empreiteiro_id, g.empreiteiro_id);

-- TOTALIZAÇÃO MENSAL (toneladas e valores do mês, por classe e no geral)
CREATE VIEW vw_totalizacao_mensal AS
    SELECT v.empresa_id, to_char(v.data, 'YYYY-MM') AS mes,
           COALESCE(cm.nome, 'TOTAL') AS classe,
           COUNT(*)                 AS qtd_viagens,
           SUM(v.peso_liquido)      AS toneladas,
           SUM(v.valor_total)       AS valor_total,
           SUM(v.total_floresta)    AS custo_floresta,
           SUM(v.total_empreiteiro) AS custo_empreiteiro_unico
      FROM viagens v
      JOIN classes_madeira cm ON cm.id = v.classe_id
     WHERE v.status <> 'Cancelada'
     GROUP BY GROUPING SETS ((v.empresa_id, mes, cm.nome), (v.empresa_id, mes));

COMMIT;

-- =====================================================================
-- PRIMEIRO ACESSO
-- O usuário Administrador deve ser criado pelo backend, porque a senha
-- precisa ser gravada com bcrypt (senha_hash). Exemplo de empresa:
--
--   INSERT INTO empresas (nome, cnpj) VALUES ('Minha Empresa', '12345678000199');
--   -- (as classes Lixo/Fina/Média/Grossa/Eucalipto são criadas sozinhas)
-- =====================================================================

-- =====================================================================
-- LIXEIRA (exclusão com recuperação) e HISTÓRICO (auditoria por gatilho)
-- (mesmo conteúdo de migracao_lixeira.sql)
-- =====================================================================
-- 1) Quem lançou -------------------------------------------------------
ALTER TABLE fretes         ADD COLUMN IF NOT EXISTS criado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE despesas       ADD COLUMN IF NOT EXISTS criado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE tabelas_precos ADD COLUMN IF NOT EXISTS criado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;

-- 2) Lixeira -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS lixeira (
    id             BIGSERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tabela         VARCHAR(30) NOT NULL
                   CHECK (tabela IN ('viagens', 'fretes', 'despesas', 'tabelas_precos')),
    registro_id    INT NOT NULL,                   -- volta com o MESMO id ao restaurar
    resumo         VARCHAR(300) NOT NULL,          -- "Viagem nº 12 · 26/10/2026 · POMESUL · 43,03 t"
    data_registro  DATE,                           -- data da viagem/frete/despesa (filtro)
    valor          NUMERIC(12, 2),                 -- valor do registro (para mostrar)
    dados          JSONB NOT NULL,                 -- a linha inteira, como estava
    dependentes    JSONB,                          -- ex.: divisão da carga entre empreiteiros
    motivo         VARCHAR(300) NOT NULL,
    criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,  -- quem tinha lançado
    excluido_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
    excluido_em    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uk_lixeira_registro UNIQUE (tabela, registro_id)
);
CREATE INDEX IF NOT EXISTS ix_lixeira_empresa ON lixeira (empresa_id, excluido_em DESC);

-- 3) Histórico (auditoria) --------------------------------------------
ALTER TABLE auditoria DROP CONSTRAINT IF EXISTS auditoria_acao_check;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_acao_check
    CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'EXCLUIR', 'RESTAURAR', 'CANCELAR'));
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS detalhe VARCHAR(300);   -- ex.: motivo da exclusão
CREATE INDEX IF NOT EXISTS ix_auditoria_registro ON auditoria (empresa_id, tabela, registro_id);

-- O backend informa QUEM está mexendo pelas variáveis da sessão do banco:
--   xylo.usuario_id, xylo.ip   (a cada conexão, ver src/config/db.js)
--   xylo.acao, xylo.detalhe    (só na exclusão/restauração, dentro da transação)
CREATE OR REPLACE FUNCTION fn_auditar() RETURNS trigger AS $$
DECLARE
    v_usuario INT  := NULLIF(current_setting('xylo.usuario_id', true), '')::int;
    v_ip      TEXT := NULLIF(current_setting('xylo.ip', true), '');
    v_acao    TEXT := NULLIF(current_setting('xylo.acao', true), '');
    v_detalhe TEXT := NULLIF(current_setting('xylo.detalhe', true), '');
    -- campos que não entram no histórico (controle interno / sigilo)
    ignorar   TEXT[] := ARRAY['created_at', 'updated_at', 'ultimo_login', 'senha_hash', 'senha_alterada_em', 'logo'];
    antes     JSONB;
    depois    JSONB;
    mud_antes  JSONB := '{}'::jsonb;
    mud_depois JSONB := '{}'::jsonb;
    registro  JSONB;
    v_empresa INT;
    chave     TEXT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN antes  := to_jsonb(OLD); END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN depois := to_jsonb(NEW); END IF;
    registro := COALESCE(depois, antes);
    v_empresa := CASE WHEN TG_TABLE_NAME = 'empresas' THEN (registro->>'id')::int ELSE (registro->>'empresa_id')::int END;

    -- Empresa sendo apagada (painel do desenvolvedor): não há onde registrar
    IF NOT EXISTS (SELECT 1 FROM empresas WHERE id = v_empresa) THEN RETURN NULL; END IF;

    IF TG_OP = 'UPDATE' THEN
        -- só os campos que mudaram
        FOR chave IN SELECT jsonb_object_keys(depois) LOOP
            CONTINUE WHEN (antes -> chave) IS NOT DISTINCT FROM (depois -> chave);
            IF chave = ANY (ignorar) THEN
                IF chave = 'senha_hash' THEN mud_depois := mud_depois || '{"senha": "alterada"}'; END IF;
                IF chave = 'logo'       THEN mud_depois := mud_depois || '{"logo": "alterada"}';  END IF;
                CONTINUE;
            END IF;
            mud_antes  := mud_antes  || jsonb_build_object(chave, antes  -> chave);
            mud_depois := mud_depois || jsonb_build_object(chave, depois -> chave);
        END LOOP;
        IF mud_depois = '{}'::jsonb THEN RETURN NULL; END IF;   -- nada que interesse mudou
        antes := mud_antes;
        depois := mud_depois;
        IF v_acao IS NULL AND (depois->>'status' IN ('Cancelada', 'Cancelado') OR depois->>'status_pagamento' = 'Cancelado') THEN
            v_acao := 'CANCELAR';
        END IF;
    ELSE
        antes  := antes  - ignorar;
        depois := depois - ignorar;
    END IF;

    INSERT INTO auditoria (empresa_id, usuario_id, acao, tabela, registro_id, dados_anteriores, dados_novos, ip, detalhe)
    VALUES (v_empresa, v_usuario, COALESCE(v_acao, TG_OP), TG_TABLE_NAME, (registro->>'id')::int,
            antes, depois, v_ip, left(v_detalhe, 300));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['viagens', 'fretes', 'despesas', 'tabelas_precos', 'clientes', 'florestas',
                             'empreiteiros', 'usuarios', 'categorias_despesa'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_auditoria ON %I', t, t);
        EXECUTE format('CREATE TRIGGER tg_%s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_auditar()', t, t);
    END LOOP;
    -- empresa: só alterações (dados da empresa, logo)
    DROP TRIGGER IF EXISTS tg_empresas_auditoria ON empresas;
    CREATE TRIGGER tg_empresas_auditoria AFTER UPDATE ON empresas FOR EACH ROW EXECUTE FUNCTION fn_auditar();
END $$;

-- =====================================================================
-- FOLHA DE PAGAMENTO: funcionários, faixas de comissão por km, rotas,
-- adiantamentos parcelados (mesmo conteúdo de migracao_folha.sql)
-- =====================================================================
-- 1) Funcionários --------------------------------------------------------
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS alimentacao  NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS telefone     VARCHAR(20);
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS observacoes  TEXT;
ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS motorista_id INT REFERENCES motoristas(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_funcionario_motorista ON funcionarios (motorista_id) WHERE motorista_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_funcionario_empresa ON funcionarios (empresa_id);

-- 2) Faixas de comissão (por funcionário) -------------------------------
CREATE TABLE IF NOT EXISTS comissao_faixas (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    funcionario_id INT NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    km_ate         NUMERIC(7, 1) CHECK (km_ate > 0),          -- vazio = "acima" (última faixa)
    valor_tonelada NUMERIC(10, 2) NOT NULL CHECK (valor_tonelada >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_faixa_km      ON comissao_faixas (funcionario_id, km_ate) WHERE km_ate IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_faixa_acima   ON comissao_faixas (funcionario_id) WHERE km_ate IS NULL;

-- 3) Rotas e distâncias --------------------------------------------------
CREATE TABLE IF NOT EXISTS rotas (
    id            SERIAL PRIMARY KEY,
    empresa_id    INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('viagem', 'frete')),
    floresta_id   INT REFERENCES florestas(id) ON DELETE CASCADE,  -- viagem: de onde sai
    cliente_id    INT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    destino       VARCHAR(100),                                     -- frete: para onde vai
    destino_chave VARCHAR(100) GENERATED ALWAYS AS (upper(btrim(coalesce(destino, '')))) STORED,
    km            NUMERIC(7, 1) NOT NULL CHECK (km > 0),
    observacao    TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_rota_viagem CHECK (tipo <> 'viagem' OR floresta_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_rota_viagem ON rotas (empresa_id, floresta_id, cliente_id) WHERE tipo = 'viagem';
CREATE UNIQUE INDEX IF NOT EXISTS uk_rota_frete  ON rotas (empresa_id, cliente_id, destino_chave) WHERE tipo = 'frete';

ALTER TABLE viagens ADD COLUMN IF NOT EXISTS km NUMERIC(7, 1) CHECK (km > 0);   -- corrige a rota só nesta carga
ALTER TABLE fretes  ADD COLUMN IF NOT EXISTS km NUMERIC(7, 1) CHECK (km > 0);
ALTER TABLE fretes  ADD COLUMN IF NOT EXISTS motorista_id INT REFERENCES motoristas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_viagem_motorista ON viagens (motorista_id);
CREATE INDEX IF NOT EXISTS ix_frete_motorista  ON fretes (motorista_id);

-- 4) Adiantamentos parcelados --------------------------------------------
CREATE TABLE IF NOT EXISTS adiantamentos (
    id             SERIAL PRIMARY KEY,
    empresa_id     INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    funcionario_id INT NOT NULL REFERENCES funcionarios(id) ON DELETE RESTRICT,
    data           DATE NOT NULL,                                  -- quando o dinheiro saiu
    valor          NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    parcelas       INT NOT NULL DEFAULT 1 CHECK (parcelas BETWEEN 1 AND 36),
    descricao      VARCHAR(200),
    despesa_id     INT REFERENCES despesas(id) ON DELETE SET NULL, -- saída de caixa (categoria Adiantamento)
    criado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adiantamento_parcelas (
    id              SERIAL PRIMARY KEY,
    adiantamento_id INT NOT NULL REFERENCES adiantamentos(id) ON DELETE CASCADE,
    numero          INT NOT NULL,
    competencia     CHAR(7) NOT NULL CHECK (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
    valor           NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    CONSTRAINT uk_parcela UNIQUE (adiantamento_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_parcela_competencia ON adiantamento_parcelas (competencia);

-- 5) Folha ---------------------------------------------------------------
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS cargo            VARCHAR(100);   -- como era no mês
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS status           VARCHAR(10) NOT NULL DEFAULT 'Aberta';
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS comissao_manual  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS comissao_detalhe JSONB;          -- cargas usadas (guardado ao fechar)
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS data_pagamento   DATE;
ALTER TABLE folhas ADD COLUMN IF NOT EXISTS despesa_id       INT REFERENCES despesas(id) ON DELETE SET NULL;
ALTER TABLE folhas DROP CONSTRAINT IF EXISTS ck_folha_status;
ALTER TABLE folhas ADD CONSTRAINT ck_folha_status CHECK (status IN ('Aberta', 'Fechada', 'Paga'));
CREATE INDEX IF NOT EXISTS ix_folha_competencia ON folhas (empresa_id, competencia);

-- 6) updated_at e histórico (auditoria) nas tabelas novas ------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['rotas', 'adiantamentos'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_updated_at ON %I', t, t);
        EXECUTE format('CREATE TRIGGER tg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t, t);
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_auditar') THEN
        FOREACH t IN ARRAY ARRAY['funcionarios', 'folhas', 'adiantamentos', 'rotas', 'comissao_faixas'] LOOP
            EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_auditoria ON %I', t, t);
            EXECUTE format('CREATE TRIGGER tg_%s_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                            FOR EACH ROW EXECUTE FUNCTION fn_auditar()', t, t);
        END LOOP;
    END IF;
END $$;

-- =====================================================================
-- CONFIRMAÇÃO DE E-MAIL (mesmo conteúdo de migracao_email.sql)
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'usuarios' AND column_name = 'email_confirmado_em') THEN
        ALTER TABLE usuarios ADD COLUMN email_confirmado_em TIMESTAMP;
        -- só na PRIMEIRA vez: quem já existia continua entrando normalmente
        UPDATE usuarios SET email_confirmado_em = COALESCE(ultimo_login, created_at, now());
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS tokens_conta (
    id          SERIAL PRIMARY KEY,
    usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('convite', 'troca_email', 'nova_senha')),
    token_hash  CHAR(64) NOT NULL UNIQUE,          -- SHA-256 do link (o link em si não fica no banco)
    email_novo  VARCHAR(150),                      -- troca de e-mail: o endereço novo
    expira_em   TIMESTAMP NOT NULL,
    usado_em    TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_token_usuario ON tokens_conta (usuario_id, tipo);


-- =====================================================================
-- MENSALIDADE DO XYLO: faturas com PIX (mesmo conteúdo de migracao_faturas.sql)
-- =====================================================================
-- Plano de cada empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS mensalidade    NUMERIC(10,2) CHECK (mensalidade IS NULL OR mensalidade >= 0);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dia_vencimento SMALLINT NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 28);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cobrar_desde   DATE;  -- 1º mês cobrado (vazio = qualquer mês)

-- Quem recebe (dados da CTech): uma linha só
CREATE TABLE IF NOT EXISTS cobranca_config (
    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    chave_pix         VARCHAR(80),
    tipo_chave        VARCHAR(20),
    recebedor_nome    VARCHAR(100),          -- aparece no app do banco (até 25 letras no PIX)
    recebedor_doc     VARCHAR(14),           -- CPF/CNPJ de quem recebe (só na fatura)
    cidade            VARCHAR(60),
    email_contato     VARCHAR(150),
    whatsapp          VARCHAR(20),
    instrucoes        VARCHAR(300),
    gerar_automatico  BOOLEAN NOT NULL DEFAULT FALSE, -- gera sozinho as faturas do mês
    dia_geracao       SMALLINT NOT NULL DEFAULT 1 CHECK (dia_geracao BETWEEN 1 AND 28),
    updated_at        TIMESTAMP NOT NULL DEFAULT now()
);
INSERT INTO cobranca_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS faturas (
    id              SERIAL PRIMARY KEY,
    empresa_id      INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    numero          VARCHAR(20) NOT NULL UNIQUE,         -- ex.: 2026110003 (aparece na fatura e no PIX)
    competencia     DATE NOT NULL,                       -- 1º dia do mês cobrado
    descricao       VARCHAR(150) NOT NULL,
    valor           NUMERIC(10,2) NOT NULL CHECK (valor > 0),
    vencimento      DATE NOT NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'Aberta' CHECK (status IN ('Aberta', 'Paga', 'Cancelada')),
    pix_copia_cola  TEXT NOT NULL,                       -- código guardado: a fatura não muda se a chave mudar depois
    recebedor       JSONB NOT NULL,                      -- nome, documento, chave e cidade na data da fatura
    informado_em    TIMESTAMP,                           -- a empresa avisou "já paguei"
    informado_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
    pago_em         DATE,
    valor_pago      NUMERIC(10,2),
    obs_pagamento   VARCHAR(200),
    cancelada_motivo VARCHAR(200),
    email_enviado_em TIMESTAMP,
    gerada_por      VARCHAR(20) NOT NULL DEFAULT 'manual', -- manual | automatico
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ck_fatura_competencia CHECK (EXTRACT(DAY FROM competencia) = 1),
    CONSTRAINT ck_fatura_paga CHECK (status <> 'Paga' OR pago_em IS NOT NULL)
);
-- uma fatura (não cancelada) por empresa por mês
CREATE UNIQUE INDEX IF NOT EXISTS ux_fatura_mes ON faturas (empresa_id, competencia) WHERE status <> 'Cancelada';
CREATE INDEX IF NOT EXISTS ix_fatura_competencia ON faturas (competencia);

-- =====================================================================
-- FUSO HORÁRIO DO BANCO: datas de "hoje" (vencimentos, mês atual) no horário
-- de Brasília, também quando o banco fica num servidor no exterior (nuvem).
-- =====================================================================
DO $$ BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Sao_Paulo');
END $$;

-- =====================================================================
-- PREÇOS POR VIAGEM (mesmo conteúdo de migracao_precos_por_viagem.sql):
-- os valores são digitados em cada viagem; o banco não busca mais na tabela de preços.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_viagem_preparar() RETURNS trigger AS $$
BEGIN
    IF NEW.placa IS NOT NULL THEN
        NEW.placa := upper(regexp_replace(NEW.placa, '[^A-Za-z0-9 ]', '', 'g'));
    END IF;

    IF NEW.valor_tonelada IS NULL THEN
        RAISE EXCEPTION 'Informe o valor de venda da tonelada da viagem.';
    END IF;

    -- sem empreiteiro único, não há valor de empreiteiro na viagem (a divisão tem o seu)
    IF NEW.empreiteiro_id IS NULL THEN
        NEW.valor_ton_empreiteiro := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Carga dividida entre empreiteiros: sem valor na parte, usa o valor da viagem (ou zero)
CREATE OR REPLACE FUNCTION fn_viagem_empreiteiro_validar() RETURNS trigger AS $$
DECLARE
    v viagens%ROWTYPE;
    soma NUMERIC;
BEGIN
    SELECT * INTO v FROM viagens WHERE id = NEW.viagem_id;

    IF v.empreiteiro_id IS NOT NULL THEN
        RAISE EXCEPTION 'A viagem % já tem empreiteiro único. Para dividir, deixe o empreiteiro da viagem vazio.', v.numero_viagem;
    END IF;

    SELECT COALESCE(SUM(peso_liquido), 0) INTO soma
      FROM viagem_empreiteiros
     WHERE viagem_id = NEW.viagem_id AND id IS DISTINCT FROM NEW.id;

    IF soma + NEW.peso_liquido > v.peso_liquido THEN
        RAISE EXCEPTION 'A soma das partes (% t) passa do peso da carga (% t).',
                        soma + NEW.peso_liquido, v.peso_liquido;
    END IF;

    IF NEW.valor_tonelada IS NULL THEN
        NEW.valor_tonelada := COALESCE(v.valor_ton_empreiteiro, 0);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
