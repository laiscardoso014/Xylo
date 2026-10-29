# Publicar o Xylo na web (grátis)

Montagem: **Render** (servidor: páginas + API, num endereço só) · **Neon** (PostgreSQL) · **Brevo** (e-mails) · **GitHub** (código).

> Os planos grátis mudam com o tempo. Confira os limites atuais nos sites antes de apresentar.

## 1. GitHub: subir o código
1. Crie uma conta em github.com e um repositório **privado** (ex.: `xylo`).
2. Envie a pasta do projeto (a que tem `backend`, `frontend` e `render.yaml`). O jeito mais fácil é o GitHub Desktop.
3. O arquivo `.gitignore` já impede o envio do `.env` (senhas) e da pasta `node_modules`. Confira no GitHub que o `.env` **não** aparece.

## 2. Neon: banco de dados
1. Crie a conta em neon.com e um projeto. Região: **AWS US East (N. Virginia)**, perto do servidor do Render.
2. Em **Connect**, **desligue "Connection pooling"** e copie a connection string. O endereço **não** pode ter `-pooler`. O histórico (auditoria) usa variáveis de sessão, e essas variáveis não funcionam pelo pooler.
3. No seu computador, na pasta `backend`, crie as tabelas (PowerShell):
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" "COLE_A_CONNECTION_STRING_AQUI" -f database/database.sql
   ```
4. Crie o seu acesso ao painel CTech no banco da nuvem:
   ```powershell
   $env:CONNECTION_STRING="COLE_A_CONNECTION_STRING_AQUI"
   node database/criar-dev.js
   Remove-Item Env:CONNECTION_STRING
   ```
   **Não** rode o `seed.js` na nuvem: ele cria a empresa de teste com a senha `admin123`.

## 3. Brevo: e-mails (grátis, 300 por dia)
O Render grátis bloqueia o envio por SMTP (portas 25, 465 e 587). Por isso, na web, o Xylo manda e-mail pela API da Brevo.
1. Crie a conta em brevo.com.
2. Em **Senders**, adicione o e-mail que vai aparecer como remetente e confirme pelo link que a Brevo mandar.
3. Em **SMTP & API → API Keys**, gere uma chave (começa com `xkeysib-`).

## 4. Render: servidor
1. Crie a conta em render.com, entrando com o GitHub.
2. Clique em **New → Blueprint**, escolha o repositório e preencha:
   | Variável | Valor |
   |---|---|
   | `CONNECTION_STRING` | a do Neon (sem `-pooler`) |
   | `APP_URL` | o endereço do site, ex.: `https://xylo.onrender.com` (dá para ajustar depois) |
   | `EMAIL_BREVO_CHAVE` | a chave da Brevo |
   | `EMAIL_REMETENTE` | `Xylo <o-email-confirmado@...>` |
   | `ASSISTENTE_CHAVE` / `ASSISTENTE_RESERVA_CHAVE` | as chaves do Groq e do Gemini (opcional) |

   O `JWT_SECRET` o Render gera sozinho.
3. Espere o deploy terminar e abra:
   - `https://SEU-SERVICO.onrender.com/api/health`: deve aparecer `"banco":"conectado"`
   - `https://SEU-SERVICO.onrender.com/dev.html`: o painel CTech
   - `https://SEU-SERVICO.onrender.com/`: a página de venda
4. Cada `git push` no GitHub publica a versão nova sozinho.

## 5. Domínio
- **Grátis, sem fazer nada:** `https://xylo-xxxx.onrender.com`.
- **Domínio próprio grátis por 1 ano (estudante):** o GitHub Student Developer Pack, validado com o e-mail da faculdade, dá um `.me` (Namecheap), um `.tech` ou um domínio da Name.com. Depois do primeiro ano a renovação é paga.
- **`.com.br`:** é pago, por volta de R$ 40 por ano no registro.br (confira o preço lá). Exige CPF ou CNPJ.

Para ligar o domínio:
1. No Render, abra **Settings → Custom Domains → Add** e digite `www.seudominio.com.br`.
2. No site onde comprou o domínio, crie o registro **CNAME** que o Render mostrar.
3. O cadeado (HTTPS) sai sozinho em alguns minutos.
4. Troque o `APP_URL` para o domínio novo, para que os links dos e-mails usem esse endereço.

## 6. Limites do plano grátis (bom saber)
- **Render:** o servidor "dorme" depois de 15 minutos sem acesso. O primeiro acesso depois disso demora cerca de 1 minuto.
- **Geração automática de faturas:** só roda com o servidor acordado. Assim que alguém entra no site, o servidor confere o mês e gera o que falta.
- **Neon:**
  - 1 GB por projeto.
  - O banco pausa depois de 5 minutos parado. A primeira consulta depois disso é um pouco mais lenta.
  - O plano grátis não tem backup. De vez em quando, exporte uma cópia:
    ```powershell
    & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" "CONNECTION_STRING" -f backup-xylo.sql
    ```
- **Para clientes de verdade:** passe o Render para um plano pago (o servidor não dorme) e ative backups no Neon.
