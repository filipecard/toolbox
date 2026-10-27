# ToolBox

Suas ferramentas do dia a dia numa bolinha flutuante.

O ToolBox é um app desktop para Windows que fica como uma pequena bolha sempre à mão na tela. Um clique abre o menu rápido e cada ferramenta abre na própria janela, leve e independente das outras.

## Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| Calculadora | Contas rápidas com variáveis e histórico |
| Notas | Anotações rápidas em Markdown |
| Leitor de imagem (OCR) | Extrai o texto de imagens e prints (via [Tesseract](https://github.com/tesseract-ocr/tesseract)) |
| Seletor de cor | Captura a cor de qualquer ponto da tela e gera harmonias |
| Conversor | Moedas, medidas e unidades |
| Clipboard | Histórico do que você copia e textos prontos |
| Utilitários | JSON, Base64, hash, senhas, UUID e regex |
| Compressor | Reduz o tamanho de imagens e PDFs |
| Tradutor | Traduz textos entre idiomas |
| Transcrição de áudio | Transforma áudio em texto no próprio computador (via [whisper.cpp](https://github.com/ggml-org/whisper.cpp)) |
| Lembretes/Timer | Lembretes e timers com aviso na tela |
| Busca de arquivos | Encontra arquivos do computador na hora |

Também tem atalhos globais, temas, inicialização com o Windows e backup/restauração dos dados em `.zip`.

## Stack

- [Tauri 2](https://tauri.app/) (Rust) no backend nativo
- React 19 + TypeScript + Vite no frontend
- Vitest para os testes do frontend
- Instalador NSIS com template próprio (`src-tauri/installer/`)

## Pré-requisitos

- Windows 10 ou 11 (é a única plataforma suportada hoje)
- [Rust](https://www.rust-lang.org/tools/install) estável
- [Node.js](https://nodejs.org/) 20 ou mais recente
- [pnpm](https://pnpm.io/installation)
- Os [pré-requisitos do Tauri para Windows](https://tauri.app/start/prerequisites/) (Microsoft C++ Build Tools e WebView2)

## Desenvolvimento

```sh
pnpm install
pnpm tauri dev
```

O `tauri dev` sobe o Vite em `http://localhost:1420` e abre o app com recarregamento automático.

### Testes

```sh
pnpm test                         # frontend (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend (Rust)
```

### Build do instalador

```sh
pnpm tauri build
```

O instalador `.exe` (NSIS) fica em `src-tauri/target/release/bundle/nsis/`.

## Contas, planos e servidor

Parte das ferramentas tem limites de uso por plano (Grátis, Básico, Prata, Gold e Diamante). Os limites ficam em [`src-tauri/src/plans.rs`](src-tauri/src/plans.rs). O plano chega ao app num token assinado (Ed25519) pelo servidor do ToolBox, que fica num repositório separado e não faz parte deste projeto.

Sem servidor, o app funciona normalmente no plano Grátis. Para builds de produção, estas variáveis de ambiente são lidas **em tempo de compilação**:

| Variável | Uso | Padrão |
| --- | --- | --- |
| `TOOLBOX_SERVER_URL` | URL da API e do site | `http://127.0.0.1:8787` |
| `TOOLBOX_ENTITLEMENT_PUBLIC_KEY` | Chave pública (base64) que valida o token do plano | Chave de desenvolvimento em `src-tauri/keys/` |

A chave em `src-tauri/keys/` é só a chave **pública** de desenvolvimento. Nenhuma chave privada deve ser commitada.

## Serviços externos

Algumas ferramentas acessam a internet:

- **Conversor**: cotações de moedas em [open.er-api.com](https://open.er-api.com/)
- **Tradutor**: [MyMemory](https://mymemory.translated.net/), que recebe o texto enviado para tradução
- **Transcrição**: baixa o binário do whisper.cpp (GitHub Releases) e o modelo `ggml-base` (Hugging Face) na primeira vez. O áudio é processado localmente
- **Leitor de imagem**: baixa o Tesseract pelo servidor do ToolBox, ou usa um `tesseract` que já esteja no `PATH`

As demais ferramentas funcionam offline, e os dados do usuário (notas, clipboard, lembretes, configurações) ficam salvos localmente.

## Estrutura

```
src/
  bootstrap/     decide qual janela (bolha, menu, ferramenta...) cada webview renderiza
  shell/         bolha, menu rápido, configurações e catálogo de ferramentas
  tools/<nome>/  uma pasta por ferramenta
  shared/        código compartilhado entre janelas
src-tauri/
  src/commands/  comandos Tauri chamados pelo frontend
  src/account/   login, token do plano e dependências baixadas
  src/plans.rs   limites de cada plano
  installer/     template NSIS e imagens do instalador
public/          ícones SVG das ferramentas
```

Para adicionar uma ferramenta, crie a pasta em `src/tools/` e registre-a em [`src/shell/toolCatalog.ts`](src/shell/toolCatalog.ts) com o `load` da janela.

## Contribuindo

Contribuições são bem-vindas. Veja o [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE) © Filipe Cardoso
