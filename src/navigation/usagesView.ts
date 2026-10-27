import * as path from 'path';
import * as vscode from 'vscode';
import { config, index, indexChanged, SELECTOR, syncDocument } from '../core';
import { AdvplSymbol } from '../index/parser';
import { searchUsages, Usage, usageCount } from './usageSearch';

// Painel "Usos" no estilo do Find Usages do IntelliJ: pasta -> fonte -> linhas.

type Node =
  | { type: 'folder'; label: string; files: Node[]; count: number }
  | { type: 'file'; uri: vscode.Uri; usages: Node[] }
  | { type: 'usage'; usage: Usage };

const VIEW_ID = 'advplNavigator.usages';

class UsagesTree implements vscode.TreeDataProvider<Node> {
  private roots: Node[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  /** Último resultado mostrado (usado pelos testes). */
  last: { symbol: AdvplSymbol; usages: Usage[] } | undefined;

  set(symbol: AdvplSymbol, usages: Usage[]) {
    this.last = { symbol, usages };
    const byFolder = new Map<string, Map<string, Usage[]>>();
    for (const u of usages) {
      const folder = path.dirname(vscode.workspace.asRelativePath(u.uri, false)).replace(/\\/g, '/');
      const files = byFolder.get(folder) ?? new Map<string, Usage[]>();
      byFolder.set(folder, files);
      const list = files.get(u.uri.fsPath) ?? [];
      files.set(u.uri.fsPath, list);
      list.push(u);
    }
    this.roots = [...byFolder].sort(([a], [b]) => a.localeCompare(b)).map(([folder, files]) => ({
      type: 'folder' as const,
      label: folder === '.' ? '(raiz)' : folder,
      count: [...files.values()].reduce((n, l) => n + l.length, 0),
      files: [...files].map(([file, list]) => ({
        type: 'file' as const,
        uri: vscode.Uri.file(file),
        usages: list.map(usage => ({ type: 'usage' as const, usage })),
      })),
    }));
    this.changed.fire();
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.roots;
    if (node.type === 'folder') return node.files;
    if (node.type === 'file') return node.usages;
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'folder') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = vscode.ThemeIcon.Folder;
      item.description = plural(node.count, 'uso', 'usos');
      return item;
    }
    if (node.type === 'file') {
      const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Expanded);
      item.description = plural(node.usages.length, 'uso', 'usos');
      return item;
    }
    const { usage } = node;
    const indent = usage.lineText.length - usage.lineText.trimStart().length;
    const text = usage.lineText.trim();
    const start = usage.range.start.character - indent;
    const item = new vscode.TreeItem({ label: text, highlights: [[start, start + usage.range.end.character - usage.range.start.character]] });
    item.description = `linha ${usage.range.start.line + 1}`;
    item.tooltip = `${path.basename(usage.uri.fsPath)}:${usage.range.start.line + 1}\n${text}`;
    item.command = { command: 'vscode.open', title: 'Abrir', arguments: [usage.uri, { selection: usage.range }] };
    return item;
  }
}

export const usagesTree = new UsagesTree();
let view: vscode.TreeView<Node>;

/** Procura os usos e mostra no painel. */
export async function showUsagesFor(symbol: AdvplSymbol) {
  const label = symbol.kind === 'user' ? `U_${symbol.name}` : symbol.className ? `${symbol.className}:${symbol.name}` : symbol.name;
  const usages = await vscode.window.withProgress(
    { location: { viewId: VIEW_ID } },
    () => searchUsages(symbol),
  );
  const found = usages.filter(u => !u.declaration);
  usagesTree.set(symbol, found);
  const files = new Set(found.map(u => u.uri.fsPath)).size;
  view.title = `Usos de ${label}`;
  view.message = found.length ? `${plural(found.length, 'uso', 'usos')} em ${plural(files, 'fonte', 'fontes')}` : `Nenhum uso de ${label} encontrado.`;
  await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
}

/** "N usos" acima de cada função/classe/método. */
class UsageLens extends vscode.CodeLens {
  constructor(range: vscode.Range, readonly symbol: AdvplSymbol) {
    super(range);
  }
}

class UsageLensProvider implements vscode.CodeLensProvider<UsageLens> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    // Recalcula depois que o índice para de mudar (digitação, saves em sequência).
    indexChanged.event(() => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.changed.fire(), 1000);
    });
  }

  refresh() {
    this.changed.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): UsageLens[] {
    if (!config().get<boolean>('codeLens.enabled')) return [];
    syncDocument(doc);
    return index.symbolsOf(doc.uri.fsPath)
      .filter(s => !s.declarationOnly)
      .map(s => new UsageLens(new vscode.Range(s.line, s.character, s.line, s.character + s.name.length), s));
  }

  async resolveCodeLens(lens: UsageLens, token: vscode.CancellationToken) {
    const n = await usageCount(lens.symbol, token);
    lens.command = {
      title: n ? plural(n, 'uso', 'usos') : 'nenhum uso',
      tooltip: 'Mostrar usos',
      command: 'advplNavigator.showUsagesOf',
      arguments: [lens.symbol],
    };
    return lens;
  }
}

export function registerUsagesView(context: vscode.ExtensionContext) {
  view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: usagesTree, showCollapseAll: true });
  view.message = 'Use Shift+F12, Alt+F7 ou F12 na declaração de uma função para listar os usos aqui.';
  const lenses = new UsageLensProvider();
  context.subscriptions.push(
    view,
    vscode.languages.registerCodeLensProvider(SELECTOR, lenses),
    vscode.commands.registerCommand('advplNavigator.showUsagesOf', (symbol: AdvplSymbol) => showUsagesFor(symbol)),
    vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('advplNavigator.codeLens.enabled') && lenses.refresh()),
  );
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}
