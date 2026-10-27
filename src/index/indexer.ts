import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { config, forgetDocumentVersions, index, indexChanged, pathKey, READ_BATCH, readSource, setIndexing, whenIndexed } from '../core';
import { PARSER_VERSION } from './parser';
import { IndexedFile } from './symbolIndex';

/** Formato do cache em disco: fontes analisados + data/tamanho para saber se mudaram. */
interface IndexCache {
  version: string;
  files: Record<string, { mtime: number; size: number; entry: IndexedFile }>;
}

export interface IndexStats {
  files: number;
  fromCache: number;
  parsed: number;
  ms: number;
}

let context: vscode.ExtensionContext;
let status: vscode.StatusBarItem;
let watcher: vscode.Disposable | undefined;
let running: Promise<void> | undefined;
let saveTimer: NodeJS.Timeout | undefined;
let dictionaryFields: number | undefined;
/** Data/tamanho em disco de cada fonte indexado a partir do arquivo (não de edição não salva). */
const diskStats = new Map<string, { mtime: number; size: number }>();
export let lastStats: IndexStats | undefined;

export function startIndexer(ctx: vscode.ExtensionContext) {
  context = ctx;
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.command = 'advplNavigator.reindex';
  status.show();
  context.subscriptions.push(
    status,
    { dispose: () => watcher?.dispose() },
    vscode.commands.registerCommand('advplNavigator.reindex', () => reindex(false)),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('advplNavigator.include') || e.affectsConfiguration('advplNavigator.exclude')) {
        createWatcher();
        reindex(false);
      }
    }),
  );
  createWatcher();
  reindex(true);
}

/** Salva o cache pendente ao fechar o VS Code. */
export async function stopIndexer() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    await saveCache();
  }
}

export function setDictionaryStatus(fields: number | undefined) {
  dictionaryFields = fields;
  updateStatus();
}

export const cachePath = () => vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, 'index.json').fsPath;
const cacheVersion = () => `${context.extension.packageJSON.version}/${PARSER_VERSION}`;

/** O watcher usa o glob de "include"; é recriado quando a configuração muda. */
function createWatcher() {
  watcher?.dispose();
  const w = vscode.workspace.createFileSystemWatcher(config().get<string>('include')!);
  const reread = async (uri: vscode.Uri) => {
    await indexFromDisk(uri);
    afterChange();
  };
  watcher = vscode.Disposable.from(
    w,
    w.onDidCreate(reread),
    w.onDidChange(reread),
    w.onDidDelete(uri => {
      index.removeFile(uri.fsPath);
      diskStats.delete(pathKey(uri.fsPath));
      afterChange();
    }),
  );
}

function afterChange() {
  updateStatus();
  indexChanged.fire();
  scheduleSave();
}

/** Lê um fonte (do editor, se aberto; senão do disco) e indexa. */
async function indexFromDisk(uri: vscode.Uri) {
  const key = pathKey(uri.fsPath);
  const open = vscode.workspace.textDocuments.find(d => pathKey(d.uri.fsPath) === key);
  if (open?.isDirty) {
    index.setFile(uri.fsPath, open.getText());
    diskStats.delete(key);
    return;
  }
  const [stat, text] = await Promise.all([fs.stat(uri.fsPath).catch(() => undefined), readSource(uri)]);
  if (!stat || text === undefined) return;
  index.setFile(uri.fsPath, text);
  diskStats.set(key, { mtime: stat.mtimeMs, size: stat.size });
}

export function reindex(useCache: boolean): Promise<void> {
  if (running) return running;
  const task = Promise.resolve(
    vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'AdvPL' }, progress => buildIndex(useCache, progress)),
  )
    .catch(e => void vscode.window.showErrorMessage(`AdvPL Navigator: falha ao indexar: ${(e as Error).message}`))
    .finally(() => (running = undefined));
  running = task;
  setIndexing(task);
  return task;
}

async function buildIndex(useCache: boolean, progress: vscode.Progress<{ message?: string }>) {
  const started = Date.now();
  status.hide();
  const cache = useCache ? await loadCache() : undefined;
  index.clear();
  diskStats.clear();
  forgetDocumentVersions();

  const uris = await vscode.workspace.findFiles(config().get<string>('include')!, config().get<string>('exclude') || undefined);
  const seen = new Set<string>();
  const unique = uris.filter(u => !seen.has(pathKey(u.fsPath)) && seen.add(pathKey(u.fsPath)));
  let fromCache = 0;
  let parsed = 0;

  for (let i = 0; i < unique.length; i += READ_BATCH) {
    const batch = unique.slice(i, i + READ_BATCH);
    await Promise.all(batch.map(async uri => {
      const key = pathKey(uri.fsPath);
      const cached = cache?.files[key];
      const open = vscode.workspace.textDocuments.find(d => pathKey(d.uri.fsPath) === key);
      if (cached && !open?.isDirty) {
        const stat = await fs.stat(uri.fsPath).catch(() => undefined);
        if (stat && stat.mtimeMs === cached.mtime && stat.size === cached.size) {
          index.setParsed({ ...cached.entry, file: uri.fsPath });
          diskStats.set(key, { mtime: cached.mtime, size: cached.size });
          fromCache++;
          return;
        }
      }
      await indexFromDisk(uri);
      parsed++;
    }));
    const done = Math.min(i + READ_BATCH, unique.length);
    progress.report({ message: `indexando ${done}/${unique.length} · ${path.basename(batch[batch.length - 1].fsPath)}` });
  }

  lastStats = { files: unique.length, fromCache, parsed, ms: Date.now() - started };
  updateStatus();
  status.show();
  indexChanged.fire();
  if (parsed || !cache) await saveCache();
}

async function loadCache(): Promise<IndexCache | undefined> {
  try {
    const cache = JSON.parse(await fs.readFile(cachePath(), 'utf8')) as IndexCache;
    return cache.version === cacheVersion() ? cache : undefined;
  } catch {
    return undefined;
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    whenIndexed().then(saveCache);
  }, 15000);
}

async function saveCache() {
  const files: IndexCache['files'] = {};
  for (const file of index.files()) {
    const key = pathKey(file);
    const stat = diskStats.get(key);
    const entry = index.entry(file);
    if (stat && entry) files[key] = { ...stat, entry };
  }
  try {
    await fs.mkdir(path.dirname(cachePath()), { recursive: true });
    await fs.writeFile(cachePath(), JSON.stringify({ version: cacheVersion(), files } satisfies IndexCache));
  } catch {
    // Cache é só otimização; sem ele a próxima abertura reindexa tudo.
  }
}

function updateStatus() {
  const dict = dictionaryFields !== undefined ? `SX3: ${dictionaryFields.toLocaleString('pt-BR')} campos` : 'SX3: sem dicionário';
  const stats = lastStats ? `\nÚltima indexação: ${(lastStats.ms / 1000).toFixed(1)}s (${lastStats.fromCache} do cache, ${lastStats.parsed} analisados)` : '';
  status.text = `$(symbol-function) AdvPL: ${index.symbolCount.toLocaleString('pt-BR')} símbolos`;
  status.tooltip = `${index.fileCount} fontes indexados · ${dict}${stats}\nClique para reindexar.`;
}
