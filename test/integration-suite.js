// Roda dentro do VS Code de teste (ver integration.js).
const vscode = require('vscode');
const path = require('path');
const assert = require('assert');
const { publisher, name } = require('../package.json');
const EXTENSION_ID = `${publisher}.${name}`;

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;

async function open(rel) {
  return vscode.workspace.openTextDocument(path.isAbsolute(rel) ? rel : path.join(root(), rel));
}

function posOf(doc, needle, line) {
  const text = doc.lineAt(line).text;
  const col = text.indexOf(needle);
  assert.ok(col >= 0, `"${needle}" não está na linha ${line + 1}: ${text}`);
  return new vscode.Position(line, col + 1);
}

async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise(r => setTimeout(r, 250));
  }
}

const definition = (doc, pos) => vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos);

exports.run = async function () {
  const results = [];
  const test = async (name, fn) => {
    try {
      await fn();
      results.push(`  ok   ${name}`);
    } catch (e) {
      results.push(`  FAIL ${name}\n       ${e.message}`);
    }
  };

  // Fontes fictícios em test/fixtures/workspace; as linhas são achadas pelo texto.
  const lineOf = (doc, re) => {
    for (let i = 0; i < doc.lineCount; i++) if (re.test(doc.lineAt(i).text)) return i;
    throw new Error(`${re} não encontrado em ${doc.uri.fsPath}`);
  };
  const rest = await open('RH/API/Vaga/VagaRest.tlpp');
  const est = await open('ESTOQUE/ROTINAS/ZESTA01.prw');
  const pe = await open('COMPRAS/PONTO DE ENTRADA/ZCOMPE01.prw');
  const NEW_CALL = lineOf(rest, /VagaModel\(\):New\(\)/);
  const FROMJSON_CALL = lineOf(rest, /oModel:fromJson\(/);
  const STRING_CALL = lineOf(est, /"U_ZVALLIN\(\)"/);
  const ZVALLIN_DECL = lineOf(est, /^User Function ZVALLIN\(/);
  const DECL = lineOf(pe, /^Static Function EnvAviso\(/);
  const CALL = lineOf(pe, /^\s+EnvAviso\(/);

  await test('F12 entre fontes funciona já na ativação (espera a indexação)', async () => {
    // Sem polling: a primeira chamada precisa esperar o índice e resolver em outro fonte.
    const defs = await definition(rest, posOf(rest, 'VagaModel', NEW_CALL));
    assert.ok(defs?.length, 'definição vazia logo após ativar');
  });

  await test('F12 em "U_ZVALLIN()" (dentro de string) vai para User Function', async () => {
    const [loc] = await definition(est, posOf(est, 'ZVALLIN', STRING_CALL));
    assert.strictEqual(path.basename(loc.uri.fsPath), 'ZESTA01.prw');
    assert.strictEqual(loc.range.start.line, ZVALLIN_DECL);
  });

  await test('F12 em VagaModel():New() vai para a classe em outro fonte', async () => {
    const defs = await definition(rest, posOf(rest, 'VagaModel', NEW_CALL));
    assert.ok(defs.some(l => path.basename(l.uri.fsPath) === 'VagaModel.tlpp'), JSON.stringify(defs.map(l => l.uri.fsPath)));
  });

  await test('F12 em oModel:fromJson() vai para a implementação do método', async () => {
    const model = await open('RH/API/Vaga/VagaModel.tlpp');
    const impl = lineOf(model, /^Method fromJson\(jBody\) Class VagaModel/);
    const defs = await definition(rest, posOf(rest, 'fromJson', FROMJSON_CALL));
    assert.ok(defs.some(l => path.basename(l.uri.fsPath) === 'VagaModel.tlpp' && l.range.start.line === impl), JSON.stringify(defs.map(l => [l.uri.fsPath, l.range.start.line])));
  });

  await test('Shift+F12 em ZVALLIN acha declaração e usos em outros fontes (U_, ExecBlock, ExistBlock)', async () => {
    const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', est.uri, posOf(est, 'ZVALLIN', STRING_CALL));
    const files = new Set(refs.map(l => path.basename(l.uri.fsPath)));
    assert.ok(refs.length >= 5 && files.has('ZFATA02.prw'), JSON.stringify(refs.map(l => [path.basename(l.uri.fsPath), l.range.start.line + 1])));
  });

  await test('Ctrl+T acha VagaModel', async () => {
    const syms = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'VagaModel');
    assert.ok(syms.some(s => s.name === 'VagaModel' && s.kind === vscode.SymbolKind.Class));
  });

  await test('hover mostra a assinatura e o Protheus.doc', async () => {
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', est.uri, posOf(est, 'ZVALLIN', STRING_CALL));
    // appendText escapa o texto para exibir (espaço vira &nbsp;, pontuação ganha "\"): normaliza antes de comparar.
    const text = hovers
      .flatMap(h => h.contents.map(c => c.value ?? c))
      .join('\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/\\(.)/g, '$1');
    assert.match(text, /User Function ZVALLIN\(nLine\)/);
    assert.match(text, /Valida a linha atual do aCols/);
  });

  await test('não duplica definição que outra extensão já devolveu (caminho em minúsculas)', async () => {
    // Simula a tds-vscode: mesmo fonte/linha, URI toda em minúsculas.
    const fake = vscode.languages.registerDefinitionProvider({ scheme: 'file' }, {
      provideDefinition: () => [new vscode.Location(vscode.Uri.file(est.uri.fsPath.toLowerCase()), new vscode.Position(ZVALLIN_DECL, 0))],
    });
    try {
      // Coluna diferente dos testes anteriores: a resposta deles (sem a "tds") está no cache de 3s.
      const defs = await definition(est, posOf(est, 'ZVALLIN', STRING_CALL).translate(0, 2));
      assert.strictEqual(defs.length, 1, JSON.stringify(defs.map(l => [l.uri.fsPath, l.range.start.line])));
      // Onde a outra extensão não acha nada (outro fonte), a nossa continua respondendo.
      const cross = await definition(rest, posOf(rest, 'VagaModel', NEW_CALL));
      assert.ok(cross.some(l => path.basename(l.uri.fsPath) === 'VagaModel.tlpp'));
    } finally {
      fake.dispose();
    }
  });

  await test('F12 com a tds-vscode: na declaração mostra referências; na chamada, a definição (sem duplicar)', async () => {
    const lower = vscode.Uri.file(pe.uri.fsPath.toLowerCase());
    const declRange = new vscode.Range(DECL, 16, DECL, 24);
    const callCol = pe.lineAt(CALL).text.indexOf('EnvAviso');
    // Simula a tds-vscode: devolve tudo com o caminho em minúsculas.
    const fakes = [
      vscode.languages.registerDefinitionProvider({ scheme: 'file' }, {
        provideDefinition: (d) => d.uri.fsPath === pe.uri.fsPath ? [new vscode.Location(lower, declRange)] : [],
      }),
      vscode.languages.registerReferenceProvider({ scheme: 'file' }, {
        provideReferences: (d) => d.uri.fsPath === pe.uri.fsPath
          ? [new vscode.Location(lower, new vscode.Range(CALL, callCol, CALL, callCol + 8)), new vscode.Location(lower, declRange)]
          : [],
      }),
    ];
    try {
      const api = vscode.extensions.getExtension(EXTENSION_ID).exports;
      const show = t => JSON.stringify(t.locations.map(l => [l.uri.fsPath, l.range.start.line + 1]));

      const onDecl = await api.navigationTarget(pe, posOf(pe, 'EnvAviso', DECL));
      assert.strictEqual(onDecl.kind, 'references');
      assert.deepStrictEqual(onDecl.locations.map(l => l.range.start.line + 1).sort((a, b) => a - b), [CALL + 1, DECL + 1], show(onDecl));
      assert.ok(onDecl.locations.every(l => l.uri.fsPath === pe.uri.fsPath), `caminho fora da caixa real: ${show(onDecl)}`);

      const onCall = await api.navigationTarget(pe, posOf(pe, 'EnvAviso', CALL));
      assert.strictEqual(onCall.kind, 'definition');
      assert.deepStrictEqual(onCall.locations.map(l => [l.uri.fsPath, l.range.start.line + 1]), [[pe.uri.fsPath, DECL + 1]]);

      const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', pe.uri, posOf(pe, 'EnvAviso', DECL));
      assert.strictEqual(refs.length, 2, `Shift+F12 duplicou: ${refs.length}`);

      await vscode.window.showTextDocument(pe, { selection: new vscode.Range(posOf(pe, 'EnvAviso', CALL), posOf(pe, 'EnvAviso', CALL)) });
      await vscode.commands.executeCommand('advplNavigator.goToDefinition');
      const line = await until(() => vscode.window.activeTextEditor.selection.active.line === DECL, 3000);
      assert.ok(line, `comando F12 parou na linha ${vscode.window.activeTextEditor.selection.active.line + 1} de ${vscode.window.activeTextEditor.document.uri.fsPath}`);
    } finally {
      fakes.forEach(f => f.dispose());
    }
  });

  await test('Ctrl+clique na declaração: link no nome que abre as referências', async () => {
    await vscode.window.showTextDocument(pe);
    const links = await vscode.commands.executeCommand('vscode.executeLinkProvider', pe.uri);
    const link = links.find(l => l.range.start.line === DECL);
    assert.ok(link, `sem link na linha ${DECL + 1}`);
    assert.strictEqual(pe.getText(link.range), 'EnvAviso');
    assert.strictEqual(link.target.scheme, 'command');
    assert.strictEqual(link.target.path, 'advplNavigator.showReferences');
    const args = JSON.parse(decodeURIComponent(link.target.query));
    await vscode.commands.executeCommand('advplNavigator.showReferences', ...args); // não pode lançar erro
    assert.ok(!links.some(l => l.range.start.line === CALL), `chamada (linha ${CALL + 1}) não deveria ter link`);
  });

  const api = vscode.extensions.getExtension(EXTENSION_ID).exports;

  await test('painel de usos (Shift+F12 / Alt+F7): agrupa e não inclui a declaração', async () => {
    await vscode.window.showTextDocument(pe, { selection: new vscode.Range(posOf(pe, 'EnvAviso', DECL), posOf(pe, 'EnvAviso', DECL)) });
    await vscode.commands.executeCommand('advplNavigator.findUsages');
    const last = api.usagesTree.last;
    assert.strictEqual(last?.symbol.name, 'EnvAviso');
    assert.deepStrictEqual(last.usages.map(u => u.range.start.line + 1), [CALL + 1]);
    const [folder] = api.usagesTree.getChildren();
    assert.strictEqual(api.usagesTree.getTreeItem(folder).label, 'COMPRAS/PONTO DE ENTRADA');
    const [file] = api.usagesTree.getChildren(folder);
    const [usage] = api.usagesTree.getChildren(file);
    const item = api.usagesTree.getTreeItem(usage);
    const [hs, he] = item.label.highlights[0];
    assert.strictEqual(item.label.label.slice(hs, he), 'EnvAviso');
    assert.strictEqual(item.description, `linha ${CALL + 1}`);
  });

  await test('F12 na declaração abre o painel de usos', async () => {
    api.usagesTree.last = undefined;
    const declPos = posOf(est, 'ZVALLIN', ZVALLIN_DECL);
    await vscode.window.showTextDocument(est, { selection: new vscode.Range(declPos, declPos) });
    await vscode.commands.executeCommand('advplNavigator.goToDefinition');
    assert.strictEqual(api.usagesTree.last?.symbol.name, 'ZVALLIN');
    assert.ok(api.usagesTree.last.usages.length >= 3);
  });

  await test('contador "N usos" acima das funções', async () => {
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', pe.uri, 200);
    const lens = lenses.find(l => l.range.start.line === DECL);
    assert.ok(lens, `sem CodeLens na linha ${DECL + 1}`);
    assert.strictEqual(lens.command?.title, '1 uso');
    assert.strictEqual(lens.command.command, 'advplNavigator.showUsagesOf');
  });

  await test('usos de New em várias classes: só os fontes que citam a classe', async () => {
    const model = await open('RH/API/Vaga/VagaModel.tlpp');
    const impl = lineOf(model, /^Method New\(\) Class VagaModel/);
    await vscode.window.showTextDocument(model, { selection: new vscode.Range(posOf(model, 'New', impl), posOf(model, 'New', impl)) });
    await vscode.commands.executeCommand('advplNavigator.findUsages');
    const files = new Set(api.usagesTree.last.usages.map(u => path.basename(u.uri.fsPath)));
    assert.ok(files.has('VagaRest.tlpp') && !files.has('CandidatoModel.tlpp'), [...files].join());
  });

  await test('cache em disco: reabrir usa o cache e não reanalisa os fontes', async () => {
    assert.ok(require('fs').existsSync(api.cachePath()), `cache não gravado em ${api.cachePath()}`);
    await api.reindex(true);
    const s = api.lastStats();
    assert.ok(s.files > 0 && s.fromCache === s.files && s.parsed === 0, JSON.stringify(s));
    const defs = await definition(rest, posOf(rest, 'VagaModel', NEW_CALL));
    assert.ok(defs.some(l => path.basename(l.uri.fsPath) === 'VagaModel.tlpp'), 'índice do cache não resolve');
  });

  await test('mudar advplNavigator.include reindexa com o novo padrão', async () => {
    const all = api.lastStats().files;
    const cfg = vscode.workspace.getConfiguration('advplNavigator');
    await cfg.update('include', '**/RH/**/*.tlpp', vscode.ConfigurationTarget.Global);
    try {
      await until(() => api.lastStats()?.files === 3, 15000);
      assert.strictEqual(api.lastStats().files, 3, JSON.stringify(api.lastStats()));
    } finally {
      await cfg.update('include', undefined, vscode.ConfigurationTarget.Global);
      await until(() => api.lastStats()?.files === all, 15000);
    }
  });

  const scratch = await open(process.env.ADVPL_NAV_SCRATCH);
  const complete = async (line, col) => {
    const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', scratch.uri, new vscode.Position(line, col));
    return list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
  };

  await test('autocomplete A1_ lista campos do SX3', async () => {
    const labels = await until(async () => {
      const l = await complete(2, 10);
      return l.includes('A1_COD') && l;
    }, 10000);
    assert.ok(labels, 'A1_COD não apareceu');
    assert.ok(labels.includes('A1_NOME'));
  });

  await test('autocomplete após SA1-> lista campos', async () => {
    assert.ok((await complete(1, 5)).includes('A1_NOME'));
  });

  await test('hover em campo mostra título e tipo', async () => {
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', scratch.uri, new vscode.Position(3, 12));
    const text = hovers.flatMap(h => h.contents.map(c => c.value ?? c)).join('\n');
    assert.match(text, /A1_COD\*\* — Codigo `C\(6\)`/);
  });

  console.log('\n' + results.join('\n'));
  if (results.some(r => r.includes('FAIL'))) throw new Error('falhas na integração');
};
