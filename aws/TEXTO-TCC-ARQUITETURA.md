# Texto para o TCC: arquitetura de implantação

*(Sugestão de seção para o capítulo de desenvolvimento/implementação. Ajuste a
numeração, as figuras e as referências ao padrão ABNT do seu documento.)*

---

## X.X Arquitetura de implantação em nuvem

Para a disponibilização do Xylo em ambiente de produção, adotou-se uma arquitetura
*serverless* (sem servidor) na plataforma Amazon Web Services (AWS), organizada em
microsserviços. Nesse modelo, a infraestrutura não permanece em execução contínua:
os recursos computacionais são alocados sob demanda, a cada requisição, e a cobrança
ocorre apenas pelo tempo efetivamente utilizado. A escolha justifica-se pelo perfil
do sistema, voltado a pequenas e médias empresas do setor madeireiro, cujo volume de
acessos é concentrado em horário comercial. Com isso, o custo operacional permanece
próximo de zero nas faixas gratuitas permanentes dos serviços utilizados, sem
prejuízo da disponibilidade.

A aplicação foi dividida em quatro funções no AWS Lambda, cada uma com
responsabilidade, tempo limite e memória próprios:

a) **xylo-api**: atende as operações do sistema (autenticação, cadastros, viagens,
fretes, folha de pagamento, relatórios e exportações);

b) **xylo-ia**: concentra as funcionalidades de inteligência artificial (leitura do
ticket de pesagem por imagem e assistente virtual). Por dependerem de serviços
externos de IA, essas requisições são mais demoradas; isolá-las em uma função
própria, com tempo limite e memória maiores, evita que afetem o desempenho das
demais operações;

c) **xylo-rotinas**: executada diariamente, gera as faturas de mensalidade das
empresas clientes na data configurada;

d) **xylo-backup**: executada diariamente às 3h (horário de Brasília), exporta todas
as tabelas do banco de dados para o Amazon S3.

As funções compartilham o mesmo código-fonte (Node.js com Express), o que mantém
uma única base de código e reduz a manutenção. Cada função utiliza um ponto de
entrada (*handler*) diferente. A interface do usuário (HTML, CSS e JavaScript) é
armazenada no Amazon S3 e distribuída pelo Amazon CloudFront, rede de entrega de
conteúdo que fornece o endereço único do sistema com criptografia HTTPS. O
CloudFront direciona as requisições de páginas ao S3 e as requisições iniciadas por
`/api` à função correspondente, de modo que o navegador se comunica com um único
domínio. As funções só aceitam chamadas que contenham um cabeçalho secreto,
conhecido apenas pelo CloudFront, o que impede o acesso direto que contorne essa
camada. As execuções agendadas são disparadas pelo Amazon EventBridge Scheduler.

O banco de dados PostgreSQL é mantido no serviço gerenciado Neon, que também opera
na infraestrutura da AWS. A Figura X apresenta a arquitetura descrita.

**Figura X – Arquitetura de implantação do Xylo**

```
Usuário ──HTTPS──► CloudFront ──┬──► S3 (interface web)
                                ├──► Lambda xylo-api ───┐
                                └──► Lambda xylo-ia ────┤──► PostgreSQL (Neon)
EventBridge Scheduler ──┬──► Lambda xylo-rotinas ───────┤
                        └──► Lambda xylo-backup ────────┘──► S3 (backups, 30 dias)
```
*Fonte: elaborado pela autora (2026).*

### X.X.1 Política de cópias de segurança

A proteção dos dados foi organizada em camadas. No nível da aplicação, as operações
são executadas em transações, e os registros excluídos passam por uma lixeira com
histórico de auditoria, o que permite restaurar exclusões feitas por engano. No
nível do banco, o serviço Neon oferece restauração para um ponto recente no tempo.
Complementarmente, a função *xylo-backup* gera diariamente um arquivo compactado com
o conteúdo integral de todas as tabelas. O próprio PostgreSQL produz esse conteúdo
em formato JSON, preservando datas e valores numéricos sem perda de precisão. O
arquivo é armazenado em um *bucket* do Amazon S3 com acesso público bloqueado,
criptografia e versionamento, e uma regra de ciclo de vida mantém os últimos 30
dias, eliminando automaticamente as cópias mais antigas.

Para a recuperação, foi desenvolvido um script de restauração que, em uma única
transação, insere os dados respeitando a ordem das chaves estrangeiras, desativa
temporariamente os gatilhos de auditoria e ajusta as sequências de identificadores.
Em caso de falha, nenhuma alteração é aplicada. O procedimento foi validado com a
geração de um backup, sua restauração em um banco de dados vazio e a comparação do
resumo criptográfico (MD5) do conteúdo de cada tabela: as 32 tabelas restauradas
mostraram-se idênticas às originais.
