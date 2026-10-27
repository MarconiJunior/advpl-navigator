# Desenvolvimento

```bash
npm install
npm run lint              # ESLint (TypeScript e testes)
npm test                  # compila e roda os testes de unidade
npm run test:integration  # abre um VS Code isolado (baixado em .vscode-test/) e testa a extensão
npm run package           # gera advpl-navigator-x.y.z.vsix
```

F5 nesta pasta abre uma janela de desenvolvimento do VS Code com a extensão carregada.

`npm run compile` faz duas coisas: `tsc` verifica os tipos e gera `out/` (usado pelos testes de
unidade), e o esbuild empacota a extensão com as dependências em `dist/extension.js` (o que o
VS Code carrega). Para testar em outra versão do VS Code: `VSCODE_VERSION=1.85.0 npm run test:integration`.

## Testes

- `test/fixtures/workspace/` tem fontes AdvPL/TLPP fictícios que cobrem os casos testados
  (`U_` dentro de string, ExecBlock, Static Function, classe TLPP, `New` em várias classes).
- `test/run.js` testa parser, índice, dicionário e exportação sobre esses fontes. Com uma pasta de
  fontes de um projeto real (`node test/run.js <pasta>`), mede também indexação e busca de usos nele.
- `test/integration.js` abre um VS Code de teste nos fontes de exemplo e testa a extensão de ponta a ponta.
- A conexão real com o SQL Server não tem teste automático; `src/dictionary/export/` separa a
  montagem do JSON e a configuração da conexão (testadas sem banco) do acesso ao banco.

## Estrutura

Código puro (sem `vscode`) fica separado da integração com o editor, para poder ser testado no Node.

| Pasta / arquivo | O quê |
|---|---|
| `src/extension.ts` | Ativação: registra cada área |
| `src/core.ts` | Estado compartilhado (índice, configuração) e utilitários do editor |
| `src/index/parser.ts` | Lê declarações (User/Static Function, classes, métodos, WSMETHOD) e Protheus.doc — puro |
| `src/index/symbolIndex.ts` | Índice de símbolos e de palavras; resolução de chamadas — puro |
| `src/index/indexer.ts` | Indexação do workspace, cache em disco, barra de status |
| `src/navigation/navigation.ts` | Definição, referências, F12, Ctrl+clique, Ctrl+T, hover |
| `src/navigation/usageSearch.ts`, `usagesView.ts` | Busca de usos, painel Usos e contador |
| `src/dictionary/dictionary.ts` | Modelo do dicionário SX3 — puro |
| `src/dictionary/dictionaryFeatures.ts` | Autocomplete, hover e carga do arquivo |
| `src/dictionary/export/` | Exportação: consultas, JSON e conexão (puros) e o comando do VS Code |
| `scripts/export-dict.ps1` | Exportação com o login do Windows da sessão atual (PowerShell) |
