# Publicar no Marketplace

Checklist para a primeira publicação. Este arquivo não vai para o `.vsix`.

## Antes de publicar

- [ ] `LICENSE`: trocar `marconiguimaraes` pelo nome completo, se preferir.
- [ ] Prints/GIFs em `images/` e referenciados no README (F12 entre fontes, painel de usos,
      contador de usos, autocomplete do SX3). Use fontes sem dados sensíveis da empresa.
- [ ] Conferir que nenhum print, exemplo ou teste empacotado mostra servidor, banco ou código da empresa
      (`npx vsce ls` lista o que vai no pacote).

## Conta e token (uma vez)

1. Criar o publisher `marconijunior` em https://marketplace.visualstudio.com/manage
   (o ID tem que ser igual ao campo `publisher` do `package.json`).
2. Criar um Personal Access Token no Azure DevOps (https://dev.azure.com) com
   organização **All accessible organizations** e escopo **Marketplace → Manage**.
3. `npx vsce login marconijunior` e colar o token quando pedir.

## Publicar

```bash
npm install
npm test
npm run test:integration
npm run publish            # compila, empacota e publica a versão do package.json
```

Para uma nova versão: atualizar o `CHANGELOG.md` e rodar `npx vsce publish patch` (ou `minor`),
que sobe a versão no `package.json` e publica.

A primeira versão está marcada como `"preview": true` (aparece como Preview no Marketplace).
Remover quando estiver estável.
