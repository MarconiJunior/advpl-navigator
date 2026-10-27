import * as path from 'path';
import * as vscode from 'vscode';
import { config, index, isOnDeclaration, pathKey, SELECTOR, symbolAt, syncDocument, toLocation, whenIndexed, WORD } from '../core';
import { searchUsages } from './usageSearch';
import { showUsagesFor } from './usagesView';

// A extensão da TOTVS devolve caminhos em minúsculas; o VS Code não junta URIs
// que só diferem na caixa e mostra o mesmo fonte duas vezes. Por isso cada
// provider pergunta aos outros o que já foi devolvido e não repete.

type AnyLocation = vscode.Location | vscode.LocationLink;
type LocationCommand = 'vscode.executeDefinitionProvider' | 'vscode.executeReferenceProvider';

const requestKey = (command: LocationCommand, doc: vscode.TextDocument, pos: vscode.Position) =>
  `${command}|${doc.uri.toString()}#${pos.line}:${pos.character}`;

/** Pedidos em que estamos consultando os outros providers: os nossos ficam de fora (evita recursão). */
const delegating = new Set<string>();
/** Pedidos feitos pelos nossos comandos, que já juntam e deduplicam tudo no final. */
const merging = new Set<string>();

/** Respostas recentes dos outros providers, para não perguntar duas vezes à tds-vscode. */
const othersCache = new Map<string, { at: number; version: number; result: Promise<AnyLocation[]> }>();
const OTHERS_TTL = 3000;

/** O que os outros providers (ex.: tds-vscode) devolvem para o mesmo pedido, sem o nosso. */
function othersFor(command: LocationCommand, doc: vscode.TextDocument, pos: vscode.Position): Promise<AnyLocation[]> {
  const key = requestKey(command, doc, pos);
  const cached = othersCache.get(key);
  if (cached && cached.version === doc.version && Date.now() - cached.at < OTHERS_TTL) return cached.result;
  for (const [k, v] of othersCache) if (Date.now() - v.at > OTHERS_TTL) othersCache.delete(k);

  delegating.add(key);
  const request = Promise.resolve(vscode.commands.executeCommand<AnyLocation[]>(command, doc.uri, pos)).then(r => r ?? [], () => []);
  const timeout = new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1500));
  const result = Promise.race([request, timeout]).then(r => {
    // Só guarda resposta de verdade; se a tds-vscode demorou, a próxima vez pergunta de novo.
    if (r === undefined) othersCache.delete(key);
    return r ?? [];
  }).finally(() => delegating.delete(key));
  othersCache.set(key, { at: Date.now(), version: doc.version, result });
  return result;
}

/** Executa um provider "geral" a partir dos nossos comandos, sem a deduplicação interna. */
async function executeMerged(command: LocationCommand, doc: vscode.TextDocument, pos: vscode.Position): Promise<AnyLocation[]> {
  const key = requestKey(command, doc, pos);
  merging.add(key);
  try {
    return (await vscode.commands.executeCommand<AnyLocation[]>(command, doc.uri, pos)) ?? [];
  } finally {
    merging.delete(key);
  }
}

function asLocation(l: AnyLocation): vscode.Location {
  return 'targetUri' in l ? new vscode.Location(l.targetUri, l.targetSelectionRange ?? l.targetRange) : l;
}

function locationKey(l: AnyLocation) {
  const loc = asLocation(l);
  return `${pathKey(loc.uri.fsPath)}#${loc.range.start.line}`;
}

/** Junta resultados de várias extensões: sem repetidos e com o caminho na caixa real do arquivo. */
function mergeLocations(list: AnyLocation[], doc: vscode.TextDocument): vscode.Location[] {
  const seen = new Set<string>();
  const out: vscode.Location[] = [];
  for (const l of list) {
    const key = locationKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = asLocation(l);
    const real = pathKey(loc.uri.fsPath) === pathKey(doc.uri.fsPath) ? doc.uri.fsPath : index.originalPath(loc.uri.fsPath);
    out.push(real ? new vscode.Location(vscode.Uri.file(real), loc.range) : loc);
  }
  return out;
}

// ---------------------------------------------------------------- providers

async function provideDefinition(doc: vscode.TextDocument, pos: vscode.Position) {
  const key = requestKey('vscode.executeDefinitionProvider', doc, pos);
  if (delegating.has(key)) return undefined;
  await whenIndexed();
  const found = symbolAt(doc, pos);
  if (!found.length) return undefined;
  if (merging.has(key)) return found.map(toLocation);

  const taken = new Set((await othersFor('vscode.executeDefinitionProvider', doc, pos)).map(locationKey));
  const mine = found.filter(s => !taken.has(`${pathKey(s.file)}#${s.line}`));
  return mine.length ? mine.map(toLocation) : undefined;
}

async function provideReferences(doc: vscode.TextDocument, pos: vscode.Position, ctx: vscode.ReferenceContext, token: vscode.CancellationToken) {
  const key = requestKey('vscode.executeReferenceProvider', doc, pos);
  if (delegating.has(key)) return undefined;
  await whenIndexed();
  const found = symbolAt(doc, pos);
  if (!found.length) return undefined;
  const usages = (await searchUsages(found[0], token)).filter(u => ctx.includeDeclaration || !u.declaration);
  const mine = usages.map(u => new vscode.Location(u.uri, u.range));
  if (merging.has(key)) return mine;
  const taken = new Set((await othersFor('vscode.executeReferenceProvider', doc, pos)).map(locationKey));
  return mine.filter(l => !taken.has(locationKey(l)));
}

const usagesInPanel = () => config().get<string>('usages.view') !== 'peek';

/** Usos do símbolo no painel ou no peek, conforme advplNavigator.usages.view. */
async function showUsagesAt(doc: vscode.TextDocument, pos: vscode.Position) {
  await whenIndexed();
  const found = symbolAt(doc, pos);
  if (!found.length) return vscode.commands.executeCommand('editor.action.goToReferences');
  if (usagesInPanel()) return showUsagesFor(found[0]);
  const refs = mergeLocations(await executeMerged('vscode.executeReferenceProvider', doc, pos), doc);
  return vscode.commands.executeCommand('editor.action.goToLocations', doc.uri, pos, refs, 'peek', 'Nenhuma referência encontrada');
}

/**
 * F12 nos fontes AdvPL. Na própria declaração mostra os usos (o que o VS Code
 * faria sozinho se a tds-vscode não devolvesse o caminho em minúsculas); fora
 * dela vai para a definição, juntando os resultados de todas as extensões.
 */
async function goToDefinition() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const pos = editor.selection.active;
  await whenIndexed();
  if (isOnDeclaration(doc, pos, symbolAt(doc, pos))) return showUsagesAt(doc, pos);
  const locations = mergeLocations(await executeMerged('vscode.executeDefinitionProvider', doc, pos), doc);
  if (!locations.length) return vscode.commands.executeCommand('editor.action.revealDefinition'); // mensagem padrão
  const mode = locations.length > 1
    ? vscode.workspace.getConfiguration('editor.gotoLocation').get<string>('multipleDefinitions', 'peek')
    : 'goto';
  await vscode.commands.executeCommand('editor.action.goToLocations', doc.uri, pos, locations, mode, 'Nenhuma definição encontrada');
}

/** Usado pelo F12 e pelos testes: na declaração devolve as referências; fora, as definições. */
async function navigationTarget(doc: vscode.TextDocument, pos: vscode.Position) {
  await whenIndexed();
  const onDeclaration = isOnDeclaration(doc, pos, symbolAt(doc, pos));
  const command: LocationCommand = onDeclaration ? 'vscode.executeReferenceProvider' : 'vscode.executeDefinitionProvider';
  return {
    kind: onDeclaration ? ('references' as const) : ('definition' as const),
    locations: mergeLocations(await executeMerged(command, doc, pos), doc),
  };
}

/** Shift+F12 / Alt+F7 nos fontes AdvPL. */
async function findUsages() {
  const editor = vscode.window.activeTextEditor;
  if (editor) await showUsagesAt(editor.document, editor.selection.active);
}

/**
 * Ctrl+clique no nome de uma declaração. O Ctrl+clique de definição não passa
 * pelo atalho F12 e a tds-vscode responde com o caminho em minúsculas, então o
 * VS Code não percebe que o cursor já está na definição. Um DocumentLink no nome
 * também reage ao Ctrl+clique e abre os usos.
 */
function provideDocumentLinks(doc: vscode.TextDocument) {
  if (!config().get<boolean>('ctrlClickReferences')) return [];
  syncDocument(doc);
  return index.symbolsOf(doc.uri.fsPath).map(s => {
    const args = encodeURIComponent(JSON.stringify([doc.uri.toString(), s.line, s.character]));
    const link = new vscode.DocumentLink(
      new vscode.Range(s.line, s.character, s.line, s.character + s.name.length),
      vscode.Uri.parse(`command:advplNavigator.showReferences?${args}`),
    );
    link.tooltip = 'Mostrar usos';
    return link;
  });
}

async function showReferences(uri: string, line: number, character: number) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
  await showUsagesAt(doc, new vscode.Position(line, character));
}

async function provideWorkspaceSymbols(query: string) {
  await whenIndexed();
  const kinds: Record<string, vscode.SymbolKind> = {
    user: vscode.SymbolKind.Function,
    static: vscode.SymbolKind.Function,
    function: vscode.SymbolKind.Function,
    class: vscode.SymbolKind.Class,
    method: vscode.SymbolKind.Method,
    wsmethod: vscode.SymbolKind.Method,
  };
  return index.search(query).map(s => {
    const label = s.kind === 'user' ? `U_${s.name}` : s.name;
    const container = s.className ?? `${s.kind === 'static' ? 'Static · ' : ''}${path.basename(s.file)}`;
    return new vscode.SymbolInformation(label, kinds[s.kind], container, toLocation(s));
  });
}

/** Assinatura + Protheus.doc da função chamada. */
function provideHover(doc: vscode.TextDocument, pos: vscode.Position) {
  const range = doc.getWordRangeAtPosition(pos, WORD);
  if (!range) return undefined;
  const found = symbolAt(doc, pos).filter(s => !(pathKey(s.file) === pathKey(doc.uri.fsPath) && s.line === pos.line));
  if (!found.length) return undefined;
  const s = found[0];
  const md = new vscode.MarkdownString();
  md.appendCodeblock(s.signature, 'advpl');
  if (s.doc) md.appendText(s.doc + '\n');
  md.appendMarkdown(`\n*${path.basename(s.file)}:${s.line + 1}*${found.length > 1 ? ` · +${found.length - 1} definições` : ''}`);
  return new vscode.Hover(md, range);
}

export function registerNavigation(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(SELECTOR, { provideDefinition }),
    vscode.languages.registerReferenceProvider(SELECTOR, { provideReferences }),
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover }),
    vscode.languages.registerWorkspaceSymbolProvider({ provideWorkspaceSymbols }),
    vscode.languages.registerDocumentLinkProvider(SELECTOR, { provideDocumentLinks }),
    vscode.commands.registerCommand('advplNavigator.goToDefinition', goToDefinition),
    vscode.commands.registerCommand('advplNavigator.findUsages', findUsages),
    vscode.commands.registerCommand('advplNavigator.showReferences', showReferences),
  );
  return { navigationTarget };
}
