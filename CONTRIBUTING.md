# Contribuindo com o ToolBox

Obrigado pelo interesse! Este guia resume como colaborar.

## Reportando problemas

Abra uma [issue](https://github.com/filipecard/toolbox/issues) com:

- a versão do ToolBox e do Windows
- o que você fez, o que esperava e o que aconteceu
- prints ou logs, se tiver

Vulnerabilidades de segurança não devem ser publicadas em issues. Use o [relato privado de vulnerabilidades](https://github.com/filipecard/toolbox/security/advisories/new) do GitHub.

## Enviando mudanças

1. Faça um fork e crie um branch a partir de `master`.
2. Configure o ambiente seguindo o [README](README.md#desenvolvimento).
3. Faça a mudança e rode os testes:
   ```sh
   pnpm test
   pnpm build
   cargo test --manifest-path src-tauri/Cargo.toml
   ```
4. Abra um pull request explicando o que mudou e por quê.

## Convenções

- Mensagens de commit no formato `tipo: descrição` (ex.: `add: ...`, `mod: ...`, `fix: ...`).
- O texto da interface é em português do Brasil.
- Siga o estilo do código ao redor: nomes, comentários e organização.
- Uma ferramenta nova fica na própria pasta em `src/tools/` e é registrada em `src/shell/toolCatalog.ts`.
- Não commite segredos, chaves privadas ou arquivos `.env`.

Ao contribuir, você concorda que sua contribuição será licenciada sob a [licença MIT](LICENSE) do projeto.
