# Xylo na AWS: passo a passo (serverless, econômico e com backup)

Este guia coloca o Xylo no ar na AWS usando **microsserviços serverless**.
Ninguém precisa ligar ou desligar servidores: você só paga pelo que usar, e no
tamanho atual do Xylo isso fica em **US$ 0 a US$ 1 por mês**.

```
                         Usuário (navegador)
                                 │  https://dxxxx.cloudfront.net
                                 ▼
                    ┌──────────────────────────┐
                    │        CloudFront         │  HTTPS, cache e proteção
                    └──────────────────────────┘
          páginas  │            │ /api/*               │ /api/tickets/* e /api/assistente/*
                   ▼            ▼                      ▼
             ┌─────────┐  ┌────────────┐        ┌────────────┐
             │   S3    │  │  xylo-api  │        │  xylo-ia   │  (tempo e memória maiores)
             │ (site)  │  │  (Lambda)  │        │  (Lambda)  │──► Groq / Gemini
             └─────────┘  └─────┬──────┘        └─────┬──────┘
                                └───────────┬─────────┘
                                            ▼
                                ┌──────────────────────┐
     EventBridge Scheduler ──►  │ PostgreSQL no Neon   │
       03:00 xylo-backup  ──────┤                      │──► S3 (backups, 30 dias)
       07:00 xylo-rotinas ──────┤                      │
                                └──────────────────────┘
```

| Peça | O que faz | Custo esperado |
|---|---|---|
| **S3 (site)** | guarda as páginas (pasta `frontend`) | centavos (poucos MB) |
| **CloudFront** | endereço HTTPS único; manda `/api` para as funções | grátis até 1 TB/mês e 10 milhões de acessos |
| **Lambda `xylo-api`** | a API do sistema (login, viagens, folha, relatórios…) | grátis até 1 milhão de chamadas/mês |
| **Lambda `xylo-ia`** | leitura do ticket por foto e o assistente (IA) | idem |
| **Lambda `xylo-rotinas`** | gera as faturas da mensalidade (1x por dia) | idem |
| **Lambda `xylo-backup`** | copia o banco inteiro para o S3 todo dia às 03:00 | idem |
| **EventBridge Scheduler** | o "despertador" das duas rotinas | grátis (14 milhões/mês) |
| **Neon** | o banco PostgreSQL (o mesmo que você já criou) | grátis |

> **Sobre o plano da AWS:** contas novas começam no *Free plan* (6 meses ou até
> acabarem os créditos de US$ 100–200). Ele não cobra nada. Antes dos 6 meses,
> a AWS avisa por e-mail e você passa para o *Paid plan* (o Xylo continua custando
> quase zero). **Não deixe o prazo de 90 dias passar sem fazer a troca**, senão a
> conta é fechada e os backups que estão no S3 vão junto.

---

## 0. O que ter em mãos antes

- [ ] A **string de conexão do Neon** testada (sem `-pooler`). Teste no seu computador:
      `psql "SUA_STRING" -c "SELECT 1"` → tem que responder `1`.
- [ ] Um **JWT_SECRET** e um **ORIGEM_SEGREDO** (duas senhas longas e aleatórias, uma de cada).
      Gere cada uma no PowerShell, dentro de `C:\Xylo\backend`:
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] As chaves da IA (Groq / Gemini) que você já usa no `.env`.
- [ ] Opcional: a chave da Brevo (e-mails).
- [ ] O pacote das funções: em `C:\Xylo`, rode
      `powershell -ExecutionPolicy Bypass -File aws\empacotar.ps1`
      → gera `C:\Xylo\aws\xylo-lambda.zip` (uns 3 MB).

> Guarde essas senhas num lugar seguro (um gerenciador de senhas). Nunca
> coloque o arquivo `.env` no GitHub nem mande para ninguém.

---

## 1. Criar a conta e proteger

1. Acesse **aws.amazon.com** → *Criar uma conta da AWS*. Pede cartão de crédito
   (é para verificação; o Free plan não cobra).
2. Escolha o **Free plan** quando perguntar.
3. Entre no console. No canto superior direito: seu nome → **Credenciais de segurança**
   → **Atribuir dispositivo de MFA** (use o Google Authenticator ou similar).
   Isso protege a conta caso alguém descubra a senha.
4. **Região.** Sua conta é da *nova experiência da AWS* (login social, "projetos"):
   nela a região é **fixa, definida pelo endereço do cadastro**, e não dá para criar
   funções em outra. Confira qual é em **AWS Settings → View all projects → Overview →
   Additional Info → Region** (com endereço no Brasil, deve ser **São Paulo, `sa-east-1`**).
   Tudo daqui para frente é criado **nessa região**.
5. **Deixe o banco perto das funções.** Cada tela faz várias consultas ao banco; com as
   funções em São Paulo e o banco nos EUA, cada consulta leva uns 120 ms a mais e o
   sistema fica lento. No Neon, crie um projeto novo na região
   **AWS South America (São Paulo) `aws-sa-east-1`**, rode o `database.sql` nele e use
   essa string de conexão. (Se já tiver dados no banco antigo, gere um backup e restaure
   no novo com o `restaurar-backup.js`, ver seção 8.)

## 2. Alerta de gastos (faça antes de qualquer outra coisa)

1. Na busca do console digite **Budgets** → **Criar orçamento**.
2. Escolha o modelo **Orçamento de gasto zero** (*Zero spend budget*)
   **ou** *Orçamento de custo mensal* de **US$ 1,00**.
3. Coloque seu e-mail → **Criar orçamento**.

Se qualquer coisa começar a cobrar, você recebe um e-mail na hora.

---

## 3. S3: dois "baldes" (buckets)

Na busca do console: **S3** → **Criar bucket**. Crie **dois**:

### 3.1 Bucket do site

- Nome: `xylo-site-lais` (o nome precisa ser único no mundo; troque o final se já existir)
- **Bloquear todo o acesso público: deixe MARCADO** (o CloudFront é que vai ler, não o público)
- Resto padrão → **Criar bucket**.
- Abra o bucket → **Carregar** → **Adicionar pasta**/**Adicionar arquivos** e envie
  **o conteúdo** de `C:\Xylo\frontend` (os arquivos `index.html`, `login.html`… e as
  pastas `css`, `js`, `img`… precisam ficar na raiz do bucket, **não** dentro de uma
  pasta `frontend`). Dica: abra a pasta `frontend`, selecione tudo (Ctrl+A) e arraste.

### 3.2 Bucket dos backups

- Nome: `xylo-backups-lais`
- **Bloquear todo o acesso público: MARCADO**
- **Versionamento de bucket: Ativar** (protege contra um backup apagar o outro)
- Criptografia padrão: **SSE-S3** (já vem assim)
- **Criar bucket**.
- Abra o bucket → aba **Gerenciamento** → **Criar regra de ciclo de vida**:
  - Nome: `apagar-depois-de-30-dias`
  - Escopo: *Aplicar a todos os objetos do bucket* (marque o aviso)
  - Ações: marque **Expirar versões atuais dos objetos** → **30** dias
    e **Excluir permanentemente versões não atuais** → **1** dia
  - **Criar regra**.

Assim sempre existem os **últimos 30 dias** de backup, e os antigos somem sozinhos.

---

## 4. As funções Lambda (os microsserviços)

Na busca do console: **Lambda** → **Criar função**.

### 4.1 `xylo-api`

1. *Criar do zero* · Nome **`xylo-api`** · Tempo de execução **Node.js 22.x** ·
   Arquitetura **arm64** (mais barata) → **Criar função**.
2. Aba **Código** → **Fazer upload de** → **Arquivo .zip** → escolha `xylo-lambda.zip` → **Salvar**.
3. Ainda em **Código**, desça até **Configurações de tempo de execução** → **Editar** →
   Manipulador (*Handler*): **`lambda.api`** → **Salvar**.
4. Aba **Configuração** → **Configuração geral** → **Editar**:
   Memória **512 MB** · Tempo limite **30 s** → **Salvar**.
5. **Configuração** → **Variáveis de ambiente** → **Editar** → adicione:

   | Chave | Valor |
   |---|---|
   | `CONNECTION_STRING` | a string do Neon (sem aspas) |
   | `JWT_SECRET` | o segredo gerado no passo 0 |
   | `ORIGEM_SEGREDO` | o outro segredo do passo 0 |
   | `PG_POOL_MAX` | `3` |
   | `APP_URL` | por enquanto `https://exemplo.com`; você troca no passo 6 |
   | `ASSISTENTE_...` | as mesmas variáveis da IA que estão no seu `.env` |
   | `EMAIL_BREVO_CHAVE` / `EMAIL_REMETENTE` | (opcional) as da Brevo |

   **Não** coloque `PORT`, `TZ` nem as `EMAIL_SMTP_*` (o `TZ` é reservado da AWS;
   o Xylo já usa o horário de Brasília sozinho).
6. **Configuração** → **URL da função** → **Criar URL da função** →
   Tipo de autenticação **NONE** · CORS **desmarcado** → **Salvar**.
   Copie o endereço (algo como `https://abc123.lambda-url.us-east-1.on.aws/`).

   > "NONE" parece aberto, mas a função recusa (403) qualquer chamada que não traga
   > o `ORIGEM_SEGREDO`, que só o CloudFront conhece.

### 4.2 `xylo-ia`

Igual à `xylo-api` (mesmo zip, mesmo Handler **`lambda.api`**, mesmas variáveis), mas:
- Memória **1024 MB** · Tempo limite **65 s** (a IA demora mais para ler a foto)
- Também crie a **URL da função** (NONE) e copie o endereço.

> Dica para não digitar tudo de novo: as variáveis podem ser copiadas de uma
> função para a outra com Ctrl+C/Ctrl+V, linha por linha.

### 4.3 `xylo-rotinas`

- Mesmo zip · Handler **`lambda.rotinas`** · Memória 256 MB · Tempo limite **2 min**
- Variáveis: `CONNECTION_STRING`, `JWT_SECRET`, `APP_URL` e, se usar, as da Brevo
  (é ela que manda as faturas por e-mail).
- **Sem** URL da função.

### 4.4 `xylo-backup`

- Mesmo zip · Handler **`lambda.backup`** · Memória 512 MB · Tempo limite **5 min**
- Variáveis: `CONNECTION_STRING` e `BACKUP_BUCKET` = `xylo-backups-lais`
- **Sem** URL da função.
- **Permissão para gravar no S3:** aba **Configuração** → **Permissões** → clique no
  nome da *Função de execução* (abre o IAM) → **Adicionar permissões** →
  **Criar política em linha** → aba **JSON** → cole (trocando o nome do bucket):

  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::xylo-backups-lais/backups/*"
    }]
  }
  ```
  → Nome `gravar-backup` → **Criar política**.
- **Teste agora:** volte na função → aba **Testar** → **Testar** (o evento pode ficar `{}`).
  Deve aparecer *Bem-sucedido* e no log algo como
  `[backup] 32 tabelas, 367 linhas ... -> s3://xylo-backups-lais/backups/2026/11/xylo-2026-11-04.json.gz`.
  Confira o arquivo no bucket.

---

## 5. CloudFront: o endereço do sistema

Na busca do console: **CloudFront** → **Criar distribuição**.

1. Se o console perguntar o **plano de preços**, escolha **Free** (US$ 0, sem cobrança extra).
2. **Origem:** escolha o bucket **`xylo-site-lais`** (tipo *Amazon S3*).
   Em acesso, use **Origin access control (OAC)**/*Configurações recomendadas*. Quando
   terminar, o console mostra um aviso para **copiar a política do bucket**: clique
   em **Copiar política** → vá no bucket `xylo-site-lais` → **Permissões** →
   **Política do bucket** → **Editar** → cole → **Salvar**.
   (Em alguns consoles ele faz isso sozinho, com um botão *Atualizar política*.)
3. **Objeto raiz padrão:** `index.html`
4. **Proteções de segurança (WAF):** se o plano for o Free, já vem incluso. Se perguntar
   e for cobrado à parte, escolha *Não ativar*.
5. **Criar distribuição**. Anote o **nome de domínio**: `dxxxxxxxxxxxx.cloudfront.net`.

### 5.1 Adicionar as duas funções como origens

Na distribuição → aba **Origens** → **Criar origem**, duas vezes:

| Campo | Origem da API | Origem da IA |
|---|---|---|
| Domínio de origem | endereço da URL da `xylo-api` **sem** `https://` e **sem** a `/` do fim | o da `xylo-ia` |
| Protocolo | **Somente HTTPS** | **Somente HTTPS** |
| Adicionar cabeçalho personalizado | nome `x-xylo-origem`, valor = seu `ORIGEM_SEGREDO` | o mesmo |
| Tempo limite de resposta | 30 | **60** |
| Nome | `api` | `ia` |

### 5.2 Comportamentos (quem atende cada endereço)

Aba **Comportamentos** → **Criar comportamento**, três vezes:

| Padrão de caminho | Origem | 
|---|---|
| `/api/tickets/*` | `ia` |
| `/api/assistente/*` | `ia` |
| `/api/*` | `api` |

Em **todos** os três:
- Política de protocolo do visualizador: **Redirect HTTP to HTTPS**
- Métodos HTTP permitidos: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
- Política de cache: **CachingDisabled**
- Política de solicitação de origem: **AllViewerExceptHostHeader**
- Compactar objetos automaticamente: **Sim**

Na aba **Comportamentos** confira a ordem: os dois de `ia` **acima** do `/api/*`, e o
*Padrão (\*)* (o site no S3) por último. Use **Mover para cima** se precisar.

Edite também o comportamento **Padrão (\*)** → *Política de cabeçalhos de resposta*:
**SecurityHeadersPolicy** (cabeçalhos de segurança no site).

> **Não** configure "Páginas de erro personalizadas": elas trocariam também as
> respostas de erro da API (ex.: "sem permissão") por uma página HTML.

Espere o *Status* da distribuição sair de *Implantando* (5 a 10 minutos).

---

## 6. Ajustar o endereço e testar

1. Nas funções **`xylo-api`, `xylo-ia` e `xylo-rotinas`**, troque a variável `APP_URL`
   para `https://dxxxxxxxxxxxx.cloudfront.net` (o seu, sem `/` no fim).
   É esse endereço que vai nos e-mails de ativação.
2. Abra `https://dxxxxxxxxxxxx.cloudfront.net/api/health` → deve mostrar
   `{"ok":true,"banco":"conectado",...}`.
3. Abra `https://dxxxxxxxxxxxx.cloudfront.net` → a página de vendas.
   Entre pelo **login.html** e teste: cadastro, viagem, ticket por foto, assistente, Excel.
4. Painel do desenvolvedor: **`https://dxxxxxxxxxxxx.cloudfront.net/dev.html`**
   (na AWS precisa do `.html` no final).
5. Teste a proteção: abra direto a URL da `xylo-api` + `api/health` → deve dar
   `{"erro":"Acesso direto não permitido."}`. 

---

## 7. Agendar backup e rotinas (EventBridge Scheduler)

Na busca do console: **EventBridge** → menu **Scheduler** → **Programações** → **Criar programação**.

### 7.1 Backup diário

- Nome: `xylo-backup-diario`
- Padrão: **Programação recorrente** · **Baseada em cron**: `0 3 * * ? *`
- Fuso horário: **America/Sao_Paulo**
- Janela de tempo flexível: **Desativado**
- Destino: **AWS Lambda – Invoke** → função **`xylo-backup`** · carga útil `{}`
- Política de repetição: ativada, **2 tentativas**
- Permissões: *Criar nova função para esta programação* → **Criar programação**.

### 7.2 Rotinas (faturas da mensalidade)

Mesma coisa com nome `xylo-rotinas-diario`, cron `0 7 * * ? *` e função **`xylo-rotinas`**.
(O próprio Xylo confere se hoje é o dia configurado no painel; nos outros dias ela não faz nada.)

### 7.3 Guardar os logs por pouco tempo

**CloudWatch** → **Grupos de logs** → para cada `/aws/lambda/xylo-...` →
**Ações** → **Editar configuração de retenção** → **2 semanas**.
(Os logs nunca crescem a ponto de cobrar.)

---

## 8. Como os dados ficam protegidos

| Camada | Protege contra | Onde |
|---|---|---|
| Transações + chaves estrangeiras | gravação pela metade | o próprio PostgreSQL |
| Lixeira e histórico do Xylo | exclusão por engano de um registro | dentro do sistema |
| Restauração do Neon | erro grave nas últimas horas | painel do Neon (*Restore*/*Branches*) |
| **Backup diário no S3** | perder o banco, conta do Neon com problema, erro descoberto dias depois | `xylo-backups-lais`, últimos **30 dias** |
| Cópia no seu computador (recomendado 1x por mês) | perder a conta da AWS | baixe um `.json.gz` do S3 e guarde |

O backup é um arquivo `.json.gz` comum (abre no 7-Zip e em qualquer editor), com
todas as tabelas exatamente como estavam.

### Restaurar um backup

1. No S3, abra `xylo-backups-lais/backups/AAAA/MM/` e **baixe** o arquivo do dia desejado.
2. **Jeito seguro:** no Neon crie um **branch novo** (ou um banco novo), rode o
   `backend/database/database.sql` nele, e no seu `C:\Xylo\backend\.env` aponte o
   `CONNECTION_STRING` para esse branch.
3. Na pasta `C:\Xylo\backend`, **primeiro só confira** o que tem no arquivo:
   ```
   node database/restaurar-backup.js C:\Users\...\Downloads\xylo-2026-11-04.json.gz
   ```
4. Se estiver certo, restaure de verdade:
   ```
   node database/restaurar-backup.js C:\Users\...\Downloads\xylo-2026-11-04.json.gz --confirmar
   ```
   Tudo é feito numa transação: se der qualquer erro, nada é alterado.
5. Conferiu? Troque o `CONNECTION_STRING` das funções Lambda para o branch restaurado.

---

## 9. Publicar uma atualização

- **Mudou o backend** (`backend/`): rode o `empacotar.ps1` de novo e, em cada função
  (`xylo-api`, `xylo-ia`, `xylo-rotinas`, `xylo-backup`), **Código** → **Fazer upload de** →
  **Arquivo .zip**.
- **Mudou o frontend** (`frontend/`): envie os arquivos alterados para o bucket
  `xylo-site-lais` (mesmas pastas) e depois, no CloudFront → **Invalidações** →
  **Criar invalidação** → `/*` (limpa o cache; as primeiras 1.000 por mês são grátis).

---

## 10. Se algo der errado

| Sintoma | Causa provável |
|---|---|
| `{"erro":"Acesso direto não permitido."}` pelo endereço do CloudFront | o cabeçalho `x-xylo-origem` da origem está diferente do `ORIGEM_SEGREDO` da função |
| 502 / *Internal server error* | Handler errado (tem que ser `lambda.api`, `lambda.rotinas` ou `lambda.backup`) ou zip com uma pasta a mais dentro; veja o log em **Monitorar** → **Logs do CloudWatch** |
| 504 ao ler ticket | IA demorou mais de 60 s; tente de novo ou use uma foto menor |
| Página branca / `AccessDenied` em XML | arquivos dentro de uma pasta `frontend/` no bucket, ou política do bucket não colada (passo 5, item 2) |
| `password authentication failed` no log | `CONNECTION_STRING` errada; teste com `psql` antes de colar |
| E-mail com link para `exemplo.com` | faltou trocar o `APP_URL` (passo 6) |
| Backup falha com `AccessDenied` | faltou a política `gravar-backup` (passo 4.4) ou o nome do bucket está diferente |

Limite da AWS: cada envio pode ter no máximo **6 MB** (o Xylo já reduz a foto do ticket
antes de enviar; planilhas de importação muito grandes podem precisar ser divididas).

---

## 11. Checklist de segurança

- [ ] MFA ativado na conta raiz; nunca criar "chaves de acesso" da conta raiz
- [ ] Alerta de orçamento criado
- [ ] Buckets com acesso público **bloqueado**
- [ ] `ORIGEM_SEGREDO` e `JWT_SECRET` longos e aleatórios, guardados só nas variáveis da AWS
- [ ] `.env` fora do GitHub (o `.gitignore` já cuida disso)
- [ ] Não rodar `seed.js` no banco de produção (ele cria um admin de teste com senha fraca)
- [ ] Trocar o Free plan pelo Paid plan antes de 6 meses
- [ ] Baixar um backup para o computador uma vez por mês
