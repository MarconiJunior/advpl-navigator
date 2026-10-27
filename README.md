# AdvPL Navigator

Navegação entre fontes e dicionário de dados para **AdvPL/TLPP** (TOTVS Protheus) no VS Code.

Complementa a extensão oficial [TOTVS Developer Studio](https://marketplace.visualstudio.com/items?itemName=totvs.tds-vscode) (compilação, debug e realce de sintaxe) com o que falta de índice: ir para a definição em outro fonte, achar todos os usos de uma função e autocomplete dos campos do SX3.

> **Preview.** Funciona em projetos reais com mais de mil fontes, mas ainda tem limitações conhecidas (veja abaixo). Sugestões e problemas são bem-vindos.

## Recursos

### Ir para a definição entre fontes

**F12** ou **Ctrl+clique** numa chamada leva à declaração, em qualquer fonte do workspace:

- `U_MINHAFUNC(...)`, `ExecBlock("MINHAFUNC")` e `"U_MINHAFUNC()"` dentro de strings → `User Function`
- `Static Function` do próprio fonte, `Function`, classes TLPP (`MinhaClasse():New()`) e métodos (`oObj:Metodo()`)
- Nomes truncados em 10 caracteres do AdvPL clássico também resolvem

Com a extensão da TOTVS instalada, as duas respondem ao F12. O AdvPL Navigator junta os resultados sem repetir o mesmo fonte.

### Encontrar usos

**Shift+F12**, **Alt+F7**, ou **F12/Ctrl+clique no nome da própria declaração**, abrem o painel **AdvPL → Usos**, agrupado por pasta → fonte → linha, com o nome destacado (como o *Find Usages* do IntelliJ). São encontrados:

- `U_NOME(`, `ExecBlock("NOME")`, `ExistBlock("NOME")`, `StaticCall(FONTE, NOME)` e chamadas `:Metodo(`
- Métodos com o mesmo nome em várias classes (`New`, `Destroy`...) são procurados só nos fontes que citam a classe

Acima de cada função, classe e método aparece o contador **"N usos"**; clicar nele abre o painel.

### Busca e hover

- **Ctrl+T** busca qualquer função, classe ou método do projeto pelo nome
- **Hover** numa chamada mostra a assinatura e o bloco `Protheus.doc` da função

### Dicionário de dados (SX3)

Depois de exportar o dicionário do banco do Protheus:

- **Autocomplete de campos** ao digitar `A1_`, `ZZ1_`... (em código, queries e strings) e depois de `SA1->`
- **Autocomplete de tabelas** em `RetSqlName("`, `%table:`, `DbSelectArea("` e `xFilial("`
- **Hover** num campo: título, tipo e tamanho, descrição, opções do combo, consulta F3, picture e se é virtual

## Primeiros passos

1. Abra a pasta com os fontes (`.prw`, `.prx`, `.tlpp`, `.aph`). A indexação começa sozinha e o progresso aparece na barra de status. Depois da primeira vez, o índice fica em cache e só os fontes alterados são relidos.
2. Use **F12**, **Shift+F12** e **Ctrl+T** normalmente.
3. Para o autocomplete de campos, exporte o dicionário (abaixo).

### Exportar o dicionário

> Requer o dicionário no banco (padrão desde o Protheus 12.1.33) em **SQL Server**. Funciona no Windows, macOS e Linux.

`Ctrl+Shift+P` → **AdvPL Navigator: Exportar dicionário (SX2/SX3) do SQL Server**.

Na primeira vez são pedidos o servidor (`SRVSQL\INSTANCIA` ou `10.0.0.5,1433`) e o banco, salvos nas configurações do workspace. Depois:

- **Usuário e senha:** a extensão pede o usuário (login do SQL, ou `DOMINIO\usuario` para login do Windows via NTLM) e a senha, e conecta direto. O usuário fica salvo; a senha não é gravada.
- **Login do Windows da sessão atual (só no Windows):** ative `advplNavigator.dictionary.integratedSecurity`. A exportação roda num terminal PowerShell, sem pedir senha.

A conexão é criptografada. Se o servidor usar um certificado próprio (comum em rede interna) e a conexão falhar por causa do certificado, ative `advplNavigator.dictionary.trustServerCertificate`.

A exportação só faz `SELECT` em `SX2` e `SX3` e grava `.vscode/advpl-dict.json`, recarregado automaticamente. O arquivo fica na sua máquina; nada é enviado para fora. Para outra empresa, ajuste `advplNavigator.dictionary.companySuffix` (`010` = empresa 01).

## Configurações

| Configuração | Padrão | Para quê |
|---|---|---|
| `advplNavigator.include` / `exclude` | todos os fontes | Quais arquivos indexar |
| `advplNavigator.usages.view` | `panel` | `panel` (painel Usos) ou `peek` (janela flutuante do VS Code) |
| `advplNavigator.codeLens.enabled` | `true` | Contador "N usos" acima das declarações |
| `advplNavigator.ctrlClickReferences` | `true` | Ctrl+clique na declaração mostra os usos |
| `advplNavigator.dictionary.*` | | Servidor, banco, empresa, usuário, criptografia e arquivo do dicionário |

## Limitações conhecidas

- **Sem inferência de tipos:** `oObj:Metodo()` lista os métodos com esse nome em todas as classes, e o filtro por classe dos usos é uma aproximação (classes filhas podem ficar de fora).
- **Dicionário de uma empresa por vez.**
- **Exportação do dicionário só de SQL Server** (Oracle e PostgreSQL ainda não).
- **Sem a extensão da TOTVS** os fontes não têm realce de sintaxe, mas navegação, usos e dicionário funcionam.

## Licença

[MIT](LICENSE)
