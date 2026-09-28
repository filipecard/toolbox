# ToolBox: contas, licenças e downloads

Três partes no mesmo repositório:

| Pasta | O que é |
|---|---|
| `server/` | API (Cloudflare Worker + Hono). Banco no **D1**, instaladores e dependências no **R2**. Também serve o site. |
| `web/` | Site (React + Vite): cadastro, login, conta, planos, termos, download, ativação do app e painel admin. |
| `packages/shared/` | Catálogo de ferramentas, tabela de planos e tipos da API, usados pelo site e pela API. |
| `src-tauri/src/account/` | Lado do app desktop: login pelo navegador, token no Cofre de Credenciais do Windows, verificação do plano assinado, download de dependências. |

## Como a segurança funciona

- **Senhas**: PBKDF2-SHA256 com 100 000 iterações e salt aleatório. Login com e-mail inexistente leva o mesmo tempo que senha errada, e a resposta é a mesma (não revela quais e-mails têm conta).
- **Sessões**: token de acesso de 15 minutos (HS256), mais um refresh token opaco que **muda a cada uso**. Um refresh token antigo reapresentado indica roubo, e a sessão inteira é derrubada. No site, o refresh token fica num cookie `HttpOnly; SameSite=Strict` restrito a `/api/auth`, e o token de acesso só em memória. Toda requisição confere no banco se a sessão e a conta continuam ativas, então bloquear ou desconectar vale na hora.
- **App desktop**: login pelo navegador (OAuth Device Flow, RFC 8628). O app mostra um código, o usuário confirma no site já logado, e a senha nunca passa pelo app. O refresh token fica no **Cofre de Credenciais do Windows**. Conectar o app exige e-mail confirmado e termos aceitos.
- **Plano**: o servidor emite o plano como token **assinado com Ed25519**, e o app confere com a chave pública embutida no binário. Editar arquivos locais não libera nada. O token vale 7 dias, que é o tempo que o app funciona sem internet. Voltar o relógio do PC não estende esse prazo.
- **Downloads**: só por links assinados (HMAC) de 10 minutos, amarrados ao usuário. O app confere o SHA-256 de cada dependência antes de instalar.
- **Limites de tentativas** (no D1): login por IP e por e-mail, cadastro, e-mails, códigos de dispositivo.
- **Auditoria**: logins, falhas, planos liberados, ações do admin e downloads ficam registrados (Admin, aba Auditoria).

## Desenvolvimento

```bash
pnpm install
pnpm --filter @toolbox/server keys            # gera server/.dev.vars e src-tauri/keys/entitlement_public.b64
# em server/.dev.vars, coloque seu e-mail em ADMIN_EMAILS para virar admin
pnpm --filter @toolbox/server db:migrate:local
pnpm --filter @toolbox/web build              # o Worker serve o site buildado
pnpm --filter @toolbox/server dev             # API + site em http://127.0.0.1:8787
pnpm --filter @toolbox/web dev                # (opcional) site com recarga rápida em http://localhost:5173
pnpm tauri dev                                # app desktop, apontando para 127.0.0.1:8787
```

- Sem domínio de e-mail configurado, os e-mails (confirmação, redefinição de senha) **não são enviados**. O link aparece no terminal do `wrangler dev`.
- Em modo de desenvolvimento, a janela de login do app tem "Continuar sem conta", para usar o app sem a API rodando. Esse botão não existe na versão de produção.

Testes:

```bash
pnpm --filter @toolbox/server test            # unitários (criptografia, tokens, tabela de planos igual à do Rust)
node server/test/e2e.mjs                      # ponta a ponta contra o wrangler dev (63 verificações)
cd src-tauri && cargo test                    # inclui a verificação da assinatura do plano
```

## Colocar no ar

1. **Recursos na Cloudflare**
   ```bash
   cd server
   npx wrangler login
   npx wrangler d1 create toolbox               # copie o database_id para wrangler.jsonc
   npx wrangler r2 bucket create toolbox-files
   npx wrangler d1 migrations apply toolbox --remote
   ```
2. **Segredos**: `pnpm --filter @toolbox/server keys --prod` gera tudo e mostra os comandos `wrangler secret put`. Guarde a chave privada num cofre: trocá-la exige publicar uma versão nova do app.
3. **Variáveis** em `wrangler.jsonc`: `WEB_BASE_URL` (endereço público do site), `EMAIL_FROM` e `ADMIN_EMAILS`.
4. **E-mail**: `npx wrangler email sending enable seudominio.com` e depois descomente o bloco `send_email` no `wrangler.jsonc`.
5. **Deploy**: `pnpm --filter @toolbox/server deploy` (builda o site e publica o Worker).
6. **App desktop de produção**: compile com as variáveis de ambiente
   ```bash
   TOOLBOX_SERVER_URL=https://seudominio.com
   TOOLBOX_ENTITLEMENT_PUBLIC_KEY=<chave pública do passo 2>
   pnpm tauri build
   ```
   Sem elas, o app usa `127.0.0.1:8787` e a chave de desenvolvimento.
7. **Publicar o instalador**: Admin, aba Versões, "Aplicativo para Windows". Arquivos acima de 100 MB (ex.: pacotes de dependência grandes) vão primeiro para o R2 com `npx wrangler r2 object put toolbox-files/<chave> --file <arquivo> --remote` e depois são registrados na mesma tela.

## Dependências por ferramenta

O instalador é um só, e o código das ferramentas ocupa poucos KB. O que pesa são os motores externos, baixados só por quem usa a ferramenta:

- **Tesseract** (Leitor de imagem): publique um `.zip` com `tesseract.exe` e a pasta `tessdata/` (com `por.traineddata` e `eng.traineddata`) como "Dependência: Tesseract OCR". O app oferece "Baixar Tesseract" quando não encontra o motor.
- **Whisper** (Transcrição): continua com a configuração automática que já existia (baixa do GitHub e do Hugging Face).

A seleção de ferramentas feita na página de download é aplicada no primeiro login do app naquele computador: as ferramentas não escolhidas ficam escondidas do menu rápido e podem ser ativadas depois nas Configurações.
